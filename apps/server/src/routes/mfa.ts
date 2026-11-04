import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  generateNumericCode, generateRecoveryCodes, generateTotpSecret, hashToken, maskEmail, normalizeRecoveryCode,
  otpauthUri, base32Encode, unwrapKey, verifyTotp, wrapKey,
} from "@secretvariable/crypto";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate, createToken, verifyPassword, type AuthContext } from "../auth.js";
import { tx, type Q } from "../db.js";
import { badRequest, conflict, forbidden, HttpError, unauthorized } from "../errors.js";
import { parse } from "../util.js";

const MAX_ATTEMPTS = 5;
const EMAIL_CODE_TTL_MIN = 10;
const EMAIL_RESEND_SECONDS = 60;
const MAX_EMAIL_SENDS = 3;
const PENDING_SETUP_MIN = 15;

export const invalidCode = (left: number) => new HttpError(401, "invalid_code", left > 0 ? `That code is not correct. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : "Too many incorrect codes. Sign in again.");

export function mfaRoutes(app: FastifyInstance, ctx: AppCtx): void {
  const { pool, config, mailer } = ctx;
  const limit = { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } };
  const emailCodeHash = (challengeId: string, code: string) => createHmac("sha256", config.masterKey).update(`mfa-email:${challengeId}:${code}`).digest("hex");
  const recoveryHash = (userId: string, code: string) => createHmac("sha256", config.masterKey).update(`recovery:${userId}:${normalizeRecoveryCode(code)}`).digest("hex");
  const secretOf = (userId: string, enc: string) => unwrapKey(config.masterKey, enc, `totp:${userId}`);

  async function sessionOnly(req: Parameters<typeof authenticate>[1]): Promise<AuthContext> {
    const a = await authenticate(pool, req);
    if (a.token.kind !== "session") throw forbidden("Sign in to the web app or CLI with your password to manage two-step verification");
    return a;
  }
  async function requirePassword(userId: string, password: string) {
    const r = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (!r.rows[0] || !(await verifyPassword(r.rows[0].password_hash, password))) throw new HttpError(401, "wrong_password", "Wrong password");
  }
  async function statusOf(userId: string) {
    const r = await pool.query(
      `SELECT totp_enabled_at, email_backup, (SELECT count(*)::int FROM recovery_codes WHERE user_id = u.id AND used_at IS NULL) AS remaining
         FROM users u WHERE id = $1`, [userId]);
    const u = r.rows[0];
    return { enabled: !!u.totp_enabled_at, enabledAt: u.totp_enabled_at, emailBackup: !!u.totp_enabled_at && u.email_backup, emailAvailable: mailer.enabled, recoveryCodesRemaining: u.remaining as number };
  }
  async function storeRecoveryCodes(c: Q, userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes(10);
    await c.query("DELETE FROM recovery_codes WHERE user_id = $1", [userId]);
    for (const code of codes) await c.query("INSERT INTO recovery_codes(user_id, code_hash) VALUES ($1,$2)", [userId, recoveryHash(userId, code)]);
    return codes;
  }

  /** Validates a TOTP or recovery code for an already signed-in user (used by sensitive actions). Consumes it. */
  async function checkSecondFactor(c: Q, userId: string, code: string): Promise<boolean> {
    const u = (await c.query("SELECT totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE", [userId])).rows[0];
    if (!u?.totp_secret_enc) return false;
    const step = verifyTotp(secretOf(userId, u.totp_secret_enc), code, { lastStep: Number(u.totp_last_step) });
    if (step !== null) { await c.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [userId, step]); return true; }
    const r = await c.query("UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL", [userId, recoveryHash(userId, code)]);
    return (r.rowCount ?? 0) > 0;
  }

  // ------------------------------------------------------------ management (signed in)
  app.get("/api/v1/me/2fa", async (req) => {
    const a = await authenticate(pool, req);
    return statusOf(a.user.id);
  });

  app.post("/api/v1/me/2fa/setup", limit, async (req) => {
    const a = await sessionOnly(req);
    const { password } = parse(z.object({ password: z.string().max(200) }), req.body);
    await requirePassword(a.user.id, password);
    if ((await statusOf(a.user.id)).enabled) throw conflict("Two-step verification is already on");
    const secret = generateTotpSecret();
    await pool.query("UPDATE users SET totp_pending_enc = $2, totp_pending_at = now() WHERE id = $1", [a.user.id, wrapKey(config.masterKey, secret, `totp:${a.user.id}`)]);
    return { secret: base32Encode(secret), otpauthUri: otpauthUri({ secret, account: a.user.email, issuer: "SecretVariable" }) };
  });

  app.post("/api/v1/me/2fa/enable", limit, async (req) => {
    const a = await sessionOnly(req);
    const { code } = parse(z.object({ code: z.string().max(20) }), req.body);
    const codes = await tx(pool, async (c) => {
      const u = (await c.query("SELECT totp_pending_enc, totp_pending_at, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE", [a.user.id])).rows[0];
      if (u.totp_enabled_at) throw conflict("Two-step verification is already on");
      if (!u.totp_pending_enc || Date.now() - new Date(u.totp_pending_at).getTime() > PENDING_SETUP_MIN * 60_000) throw badRequest("Start the setup again: it took too long");
      const step = verifyTotp(secretOf(a.user.id, u.totp_pending_enc), code);
      if (step === null) throw new HttpError(401, "invalid_code", "That code is not correct. Check the time on your phone and try the next code.");
      await c.query(
        `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_pending_at = NULL, totp_enabled_at = now(),
                totp_last_step = $2, email_backup = true WHERE id = $1`, [a.user.id, step]);
      // any other signed-in session predates two-step verification, so sign them out
      await c.query("UPDATE tokens SET revoked_at = now() WHERE user_id = $1 AND kind = 'session' AND id <> $2 AND revoked_at IS NULL", [a.user.id, a.token.id]);
      const fresh = await storeRecoveryCodes(c, a.user.id);
      await audit(c, { actorId: a.user.id, action: "2fa.enable", ip: req.ip });
      return fresh;
    });
    return { recoveryCodes: codes };
  });

  app.post("/api/v1/me/2fa/disable", limit, async (req) => {
    const a = await sessionOnly(req);
    const body = parse(z.object({ password: z.string().max(200), code: z.string().max(40) }), req.body);
    await requirePassword(a.user.id, body.password);
    await tx(pool, async (c) => {
      if (!(await checkSecondFactor(c, a.user.id, body.code))) throw new HttpError(401, "invalid_code", "That code is not correct");
      await c.query("UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = -1, totp_pending_enc = NULL, totp_pending_at = NULL WHERE id = $1", [a.user.id]);
      await c.query("DELETE FROM recovery_codes WHERE user_id = $1", [a.user.id]);
      await audit(c, { actorId: a.user.id, action: "2fa.disable", ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/api/v1/me/2fa/recovery-codes", limit, async (req) => {
    const a = await sessionOnly(req);
    const body = parse(z.object({ password: z.string().max(200), code: z.string().max(40) }), req.body);
    await requirePassword(a.user.id, body.password);
    const codes = await tx(pool, async (c) => {
      if (!(await checkSecondFactor(c, a.user.id, body.code))) throw new HttpError(401, "invalid_code", "That code is not correct");
      const fresh = await storeRecoveryCodes(c, a.user.id);
      await audit(c, { actorId: a.user.id, action: "2fa.recovery.regenerate", ip: req.ip });
      return fresh;
    });
    return { recoveryCodes: codes };
  });

  app.patch("/api/v1/me/2fa", limit, async (req) => {
    const a = await sessionOnly(req);
    const body = parse(z.object({ password: z.string().max(200), emailBackup: z.boolean() }), req.body);
    await requirePassword(a.user.id, body.password);
    if (!(await statusOf(a.user.id)).enabled) throw badRequest("Turn on two-step verification first");
    if (body.emailBackup && !mailer.enabled) throw badRequest("This server has no email configured, so email codes cannot be turned on");
    await pool.query("UPDATE users SET email_backup = $2 WHERE id = $1", [a.user.id, body.emailBackup]);
    await audit(pool, { actorId: a.user.id, action: body.emailBackup ? "2fa.email.on" : "2fa.email.off", ip: req.ip });
    return statusOf(a.user.id);
  });

  // ------------------------------------------------------------ second step of sign-in
  /** Counts the attempt first (atomically), so parallel guesses cannot exceed the limit. */
  async function takeAttempt(token: string) {
    const r = await pool.query(
      `UPDATE mfa_challenges SET attempts = attempts + 1
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2
        RETURNING id, user_id, attempts, client_name, email_code_hash, email_code_expires_at`, [hashToken(token), MAX_ATTEMPTS]);
    const ch = r.rows[0];
    if (!ch) throw unauthorized("This sign-in expired or was used up. Sign in again.");
    return ch as { id: string; user_id: string; attempts: number; client_name: string; email_code_hash: string | null; email_code_expires_at: Date | null };
  }

  app.post("/api/v1/auth/2fa/verify", limit, async (req) => {
    const body = parse(z.object({ challenge: z.string().min(10).max(200), method: z.enum(["totp", "email", "recovery"]), code: z.string().min(1).max(40) }), req.body);
    const ch = await takeAttempt(body.challenge);
    const left = MAX_ATTEMPTS - ch.attempts;
    const user = (await pool.query("SELECT id, email, name, totp_secret_enc, totp_last_step, email_backup FROM users WHERE id = $1", [ch.user_id])).rows[0];
    if (!user?.totp_secret_enc) throw unauthorized("This sign-in expired. Sign in again.");

    let ok = false;
    let step: number | null = null;
    let recoveryCode: string | null = null;
    if (body.method === "totp") {
      step = verifyTotp(secretOf(user.id, user.totp_secret_enc), body.code, { lastStep: Number(user.totp_last_step) });
      ok = step !== null;
    } else if (body.method === "email") {
      ok = !!ch.email_code_hash && !!ch.email_code_expires_at && ch.email_code_expires_at.getTime() > Date.now()
        && emailCodeHash(ch.id, body.code.replace(/\s/g, "")) === ch.email_code_hash;
    } else {
      recoveryCode = body.code;
      ok = true; // decided atomically below
    }
    if (!ok) {
      await audit(pool, { actorId: user.id, action: "2fa.failed", meta: { method: body.method }, ip: req.ip });
      throw invalidCode(left);
    }

    const result = await tx(pool, async (c) => {
      const used = await c.query("UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL", [ch.id]);
      if (!used.rowCount) throw unauthorized("This sign-in was already completed");
      if (step !== null) {
        const r = await c.query("UPDATE users SET totp_last_step = $2 WHERE id = $1 AND totp_last_step < $2", [user.id, step]);
        if (!r.rowCount) throw new HttpError(401, "invalid_code", "That code was already used. Wait for the next one.");
      }
      if (recoveryCode !== null) {
        const r = await c.query("UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL", [user.id, recoveryHash(user.id, recoveryCode)]);
        if (!r.rowCount) throw new HttpError(401, "invalid_code", "That recovery code is not valid or was already used");
      }
      const t = await createToken(c, { userId: user.id, kind: "session", name: ch.client_name || "login", expiresAt: new Date(Date.now() + config.sessionTtlDays * 86_400_000) });
      const remaining = (await c.query("SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL", [user.id])).rows[0].n as number;
      await audit(c, { actorId: user.id, action: "2fa.login", meta: { method: body.method }, ip: req.ip });
      return { token: t.token, remaining };
    }).catch(async (e) => {
      if (e instanceof HttpError) await audit(pool, { actorId: user.id, action: "2fa.failed", meta: { method: body.method }, ip: req.ip });
      throw e;
    });
    return { token: result.token, user: { id: user.id, email: user.email, name: user.name }, ...(body.method === "recovery" ? { recoveryCodesRemaining: result.remaining } : {}) };
  });

  app.post("/api/v1/auth/2fa/email", limit, async (req) => {
    const body = parse(z.object({ challenge: z.string().min(10).max(200) }), req.body);
    const r = await pool.query(
      `SELECT c.id, c.user_id, c.email_sent_at, c.email_sends, u.email, u.email_backup
         FROM mfa_challenges c JOIN users u ON u.id = c.user_id
        WHERE c.token_hash = $1 AND c.consumed_at IS NULL AND c.expires_at > now() AND c.attempts < $2`, [hashToken(body.challenge), MAX_ATTEMPTS]);
    const ch = r.rows[0];
    if (!ch) throw unauthorized("This sign-in expired or was used up. Sign in again.");
    if (!mailer.enabled || !ch.email_backup) throw badRequest("Email codes are not available for this account");
    if (ch.email_sends >= MAX_EMAIL_SENDS) throw new HttpError(429, "too_many_codes", "Too many codes requested. Use your authenticator app or a recovery code.");
    if (ch.email_sent_at && Date.now() - new Date(ch.email_sent_at).getTime() < EMAIL_RESEND_SECONDS * 1000) {
      throw new HttpError(429, "wait", `Wait a minute before asking for another code.`);
    }
    const code = generateNumericCode(6);
    await pool.query(
      `UPDATE mfa_challenges SET email_code_hash = $2, email_code_expires_at = now() + ($3 || ' minutes')::interval, email_sent_at = now(), email_sends = email_sends + 1 WHERE id = $1`,
      [ch.id, emailCodeHash(ch.id, code), String(EMAIL_CODE_TTL_MIN)]);
    try {
      await mailer.send({
        to: ch.email,
        subject: `Your SecretVariable sign-in code: ${code}`,
        text: `Your SecretVariable sign-in code is ${code}.\n\nIt expires in ${EMAIL_CODE_TTL_MIN} minutes and works once. If you did not try to sign in, someone has your password: change it now.\n`,
      });
    } catch (e) {
      req.log.error(e, "failed to send sign-in email");
      throw new HttpError(502, "mail_failed", "Could not send the email. Use your authenticator app or a recovery code.");
    }
    await audit(pool, { actorId: ch.user_id, action: "2fa.email.sent", target: maskEmail(ch.email), ip: req.ip });
    return { sent: true, to: maskEmail(ch.email), expiresInMinutes: EMAIL_CODE_TTL_MIN };
  });
}
