import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppCtx } from "../app-context.js";
import { audit } from "../audit.js";
import { authenticate, createToken, hashPassword, verifyPassword } from "../auth.js";
import { tx } from "../db.js";
import { generateToken, hashToken, maskEmail } from "@secretvariable/crypto";
import { conflict, forbidden, unauthorized } from "../errors.js";
import { parse, slugify } from "../util.js";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, "must be at least 10 characters").max(200);

export function authRoutes(app: FastifyInstance, ctx: AppCtx): void {
  const { pool, config, mailer } = ctx;
  const limit = { config: { rateLimit: { max: config.rateLimitMax, timeWindow: "1 minute" } } };
  const sessionExpiry = () => new Date(Date.now() + config.sessionTtlDays * 86_400_000);

  app.get("/api/config", async () => ({ allowRegistration: config.allowRegistration, emailEnabled: mailer.enabled }));

  app.post("/api/v1/auth/register", limit, async (req, reply) => {
    if (!config.allowRegistration) throw forbidden("Registration is disabled on this server");
    const body = parse(z.object({ email, name: z.string().trim().min(1).max(80), password }), req.body);
    const hash = await hashPassword(body.password);
    const result = await tx(pool, async (c) => {
      const exists = await c.query("SELECT 1 FROM users WHERE email = $1", [body.email]);
      if (exists.rowCount) throw conflict("An account with that email already exists");
      const u = await c.query("INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id", [body.email, body.name, hash]);
      const userId = u.rows[0].id as string;
      // every user starts with a personal organisation
      const base = slugify(body.name);
      let slug = base;
      for (let i = 2; (await c.query("SELECT 1 FROM orgs WHERE slug = $1", [slug])).rowCount; i++) slug = `${base}-${i}`;
      const o = await c.query("INSERT INTO orgs(name, slug, created_by) VALUES ($1,$2,$3) RETURNING id", [`${body.name}'s workspace`, slug, userId]);
      await c.query("INSERT INTO org_members(org_id, user_id, role) VALUES ($1,$2,'owner')", [o.rows[0].id, userId]);
      const t = await createToken(c, { userId, kind: "session", name: "web", expiresAt: sessionExpiry() });
      await audit(c, { orgId: o.rows[0].id, actorId: userId, action: "user.register", ip: req.ip });
      return { userId, token: t.token };
    });
    reply.code(201);
    return { token: result.token, user: { id: result.userId, email: body.email, name: body.name } };
  });

  app.post("/api/v1/auth/login", limit, async (req) => {
    const body = parse(z.object({ email, password: z.string().max(200), name: z.string().max(60).optional() }), req.body);
    const r = await pool.query("SELECT id, email, name, password_hash, totp_enabled_at, email_backup FROM users WHERE email = $1", [body.email]);
    const u = r.rows[0];
    const ok = u ? await verifyPassword(u.password_hash, body.password) : (await hashPassword("x"), false);
    if (!u || !ok) throw unauthorized("Wrong email or password");
    if (u.totp_enabled_at) {
      // password is right but a second step is required: no session yet, only a short-lived challenge
      const challenge = generateToken("svm");
      await pool.query("INSERT INTO mfa_challenges(user_id, token_hash, client_name, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')", [u.id, hashToken(challenge), body.name ?? "login"]);
      await audit(pool, { actorId: u.id, action: "2fa.challenge", ip: req.ip });
      const methods = ["totp", "recovery", ...(mailer.enabled && u.email_backup ? ["email"] : [])];
      return { mfaRequired: true, challenge, methods, emailHint: methods.includes("email") ? maskEmail(u.email) : null };
    }
    const t = await createToken(pool, { userId: u.id, kind: "session", name: body.name ?? "login", expiresAt: sessionExpiry() });
    await audit(pool, { actorId: u.id, action: "user.login", ip: req.ip });
    return { token: t.token, user: { id: u.id, email: u.email, name: u.name } };
  });

  app.post("/api/v1/auth/logout", async (req) => {
    const a = await authenticate(pool, req);
    await pool.query("UPDATE tokens SET revoked_at = now() WHERE id = $1", [a.token.id]);
    return { ok: true };
  });

  app.get("/api/v1/me", async (req) => {
    const a = await authenticate(pool, req);
    return { user: a.user, token: { kind: a.token.kind, projectId: a.token.projectId, environmentId: a.token.environmentId, access: a.token.access } };
  });
}
