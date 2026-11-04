import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, totpCode } from "@secretvariable/crypto";
import { createMemoryMailer } from "../src/mailer.js";
import { Client, register, setup } from "./helpers.js";

const mailer = createMemoryMailer();
let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { ctx = await setup({}, { mailer }); });
afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

const PW = "correct horse battery";
/** A code for the current step (offset 0) or a neighbouring one. */
const code = (secret: string, offsetSteps = 0) => totpCode(base32Decode(secret), Date.now() + offsetSteps * 30_000);

async function withTwoFactor(name = "Mfa") {
  const u = await register(ctx.app, name);
  const setupRes = await u.client.post("/api/v1/me/2fa/setup", { password: PW });
  expect(setupRes.status).toBe(200);
  const secret: string = setupRes.body.secret;
  const enabled = await u.client.post("/api/v1/me/2fa/enable", { code: code(secret) });
  expect(enabled.status).toBe(200);
  return { ...u, secret, recovery: enabled.body.recoveryCodes as string[] };
}
const login = (u: { email: string }) => new Client(ctx.app).post("/api/v1/auth/login", { email: u.email, password: PW, name: "test" });
const verify = (challenge: string, method: string, c: string) => new Client(ctx.app).post("/api/v1/auth/2fa/verify", { challenge, method, code: c });

describe("setting up two-step verification", () => {
  it("needs the password, a correct first code, and gives recovery codes once", async () => {
    const u = await register(ctx.app, "Setup");
    expect((await u.client.get("/api/v1/me/2fa")).body).toMatchObject({ enabled: false, emailAvailable: true, recoveryCodesRemaining: 0 });
    const wrongPw = await u.client.post("/api/v1/me/2fa/setup", { password: "wrong password!" });
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.error.code).toBe("wrong_password"); // not "unauthorized", so the web app does not sign the user out
    expect((await u.client.get("/api/v1/me")).status).toBe(200);
    const s = await u.client.post("/api/v1/me/2fa/setup", { password: PW });
    expect(s.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(s.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect((await u.client.post("/api/v1/me/2fa/enable", { code: "000000" })).status).toBe(401);
    expect((await u.client.get("/api/v1/me/2fa")).body.enabled).toBe(false);
    const on = await u.client.post("/api/v1/me/2fa/enable", { code: code(s.body.secret) });
    expect(on.status).toBe(200);
    expect(on.body.recoveryCodes).toHaveLength(10);
    expect((await u.client.get("/api/v1/me/2fa")).body).toMatchObject({ enabled: true, emailBackup: true, recoveryCodesRemaining: 10 });
    expect((await u.client.post("/api/v1/me/2fa/setup", { password: PW })).status).toBe(409);
  });

  it("signs out other sessions when turned on, and never stores the secret in plain text", async () => {
    const u = await register(ctx.app, "Other");
    const other = await login(u);
    const otherClient = u.client.withToken(other.body.token);
    expect((await otherClient.get("/api/v1/me")).status).toBe(200);
    const s = await u.client.post("/api/v1/me/2fa/setup", { password: PW });
    await u.client.post("/api/v1/me/2fa/enable", { code: code(s.body.secret) });
    expect((await otherClient.get("/api/v1/me")).status).toBe(401);
    expect((await u.client.get("/api/v1/me")).status).toBe(200); // the session that did it stays
    const row = (await ctx.pool.query("SELECT totp_secret_enc FROM users WHERE email = $1", [u.email])).rows[0];
    expect(row.totp_secret_enc).not.toContain(s.body.secret);
    expect(row.totp_secret_enc.startsWith("v1.")).toBe(true);
  });

  it("only works from a password session, not from tokens", async () => {
    const u = await register(ctx.app, "Tok");
    const t = await u.client.post("/api/v1/tokens", { name: "cli", kind: "personal", access: "write" });
    const pat = u.client.withToken(t.body.token);
    expect((await pat.post("/api/v1/me/2fa/setup", { password: PW })).status).toBe(403);
  });
});

describe("signing in with a second step", () => {
  it("withholds the session until the code is right", async () => {
    const u = await withTwoFactor("Login");
    const first = await login(u);
    expect(first.status).toBe(200);
    expect(first.body.mfaRequired).toBe(true);
    expect(first.body.token).toBeUndefined();
    expect(first.body.methods).toEqual(["totp", "recovery", "email"]);
    expect(first.body.emailHint).toMatch(/^l\*\*\*@/);
    // the password alone gets nothing
    expect((await new Client(ctx.app, first.body.challenge).get("/api/v1/me")).status).toBe(401);
    const ok = await verify(first.body.challenge, "totp", code(u.secret, 1));
    expect(ok.status).toBe(200);
    expect((await u.client.withToken(ok.body.token).get("/api/v1/me")).body.user.email).toBe(u.email);
  });

  it("rejects a code used twice, and a challenge used twice", async () => {
    const u = await withTwoFactor("Replay");
    const a = await login(u);
    const c = code(u.secret, 1);
    expect((await verify(a.body.challenge, "totp", c)).status).toBe(200);
    expect((await verify(a.body.challenge, "totp", code(u.secret, 1))).status).toBe(401); // challenge consumed
    const b = await login(u);
    const replay = await verify(b.body.challenge, "totp", c);
    expect(replay.status).toBe(401); // same 30-second step already used
  });

  it("locks a challenge after 5 wrong codes, even if the 6th is right", async () => {
    const u = await withTwoFactor("Brute");
    const ch = (await login(u)).body.challenge;
    const bad = u.secret === "" ? "000000" : (code(u.secret, 1) === "111111" ? "222222" : "111111");
    const msgs: string[] = [];
    for (let i = 0; i < 5; i++) { const r = await verify(ch, "totp", bad); expect(r.status).toBe(401); msgs.push(r.body.error.message); }
    expect(msgs[3]).toContain("1 attempt left");
    expect(msgs[4]).toContain("Too many");
    const late = await verify(ch, "totp", code(u.secret, 1));
    expect(late.status).toBe(401);
    expect(late.body.error.message).toContain("Sign in again");
    // parallel guesses cannot beat the limit either
    const ch2 = (await login(u)).body.challenge;
    const par = await Promise.all(Array.from({ length: 12 }, (_, i) => verify(ch2, "totp", String(100000 + i))));
    expect(par.filter((r) => r.status === 401 && r.body.error.message.includes("expired or was used up")).length).toBeGreaterThanOrEqual(7);
  });

  it("expires challenges after 5 minutes", async () => {
    const u = await withTwoFactor("Expiry");
    const ch = (await login(u)).body.challenge;
    await ctx.pool.query("UPDATE mfa_challenges SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [u.email]);
    expect((await verify(ch, "totp", code(u.secret, 1))).status).toBe(401);
  });

  it("accepts each recovery code once", async () => {
    const u = await withTwoFactor("Recover");
    const r1 = await verify((await login(u)).body.challenge, "recovery", u.recovery[0]!.toUpperCase());
    expect(r1.status).toBe(200);
    expect(r1.body.recoveryCodesRemaining).toBe(9);
    expect((await verify((await login(u)).body.challenge, "recovery", u.recovery[0]!)).status).toBe(401);
    expect((await verify((await login(u)).body.challenge, "recovery", "aaaaa-bbbbb")).status).toBe(401);
    expect((await verify((await login(u)).body.challenge, "recovery", u.recovery[1]!)).status).toBe(200);
  });

  it("does not affect personal or service tokens", async () => {
    const u = await withTwoFactor("Pat");
    const t = await u.client.post("/api/v1/tokens", { name: "cli", kind: "personal", access: "write" });
    expect(t.status).toBe(201);
    expect((await u.client.withToken(t.body.token).get("/api/v1/orgs")).status).toBe(200);
  });
});

describe("email codes as a backup", () => {
  it("sends a code, accepts it once, and rate-limits sending", async () => {
    const u = await withTwoFactor("Mail");
    const ch = (await login(u)).body.challenge;
    mailer.outbox.length = 0;
    const sent = await new Client(ctx.app).post("/api/v1/auth/2fa/email", { challenge: ch });
    expect(sent.status).toBe(200);
    expect(sent.body.to).toMatch(/^m\*\*\*@/);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]!.to).toBe(u.email);
    const emailed = /(\d{6})/.exec(mailer.outbox[0]!.text)![1]!;
    // the code is stored hashed
    const row = (await ctx.pool.query("SELECT email_code_hash FROM mfa_challenges ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(row.email_code_hash).not.toContain(emailed);
    expect((await new Client(ctx.app).post("/api/v1/auth/2fa/email", { challenge: ch })).status).toBe(429); // 60 s throttle
    expect((await verify(ch, "email", emailed === "000000" ? "000001" : "000000")).status).toBe(401);
    const ok = await verify(ch, "email", emailed);
    expect(ok.status).toBe(200);
    expect((await verify(ch, "email", emailed)).status).toBe(401); // used up
  });

  it("rejects expired email codes and a code from another sign-in", async () => {
    const u = await withTwoFactor("MailExp");
    const ch = (await login(u)).body.challenge;
    mailer.outbox.length = 0;
    await new Client(ctx.app).post("/api/v1/auth/2fa/email", { challenge: ch });
    const emailed = /(\d{6})/.exec(mailer.outbox[0]!.text)![1]!;
    await ctx.pool.query("UPDATE mfa_challenges SET email_code_expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [u.email]);
    expect((await verify(ch, "email", emailed)).status).toBe(401);
    const other = (await login(u)).body.challenge;
    expect((await verify(other, "email", emailed)).status).toBe(401); // never requested for this sign-in
  });

  it("can be switched off, and is unavailable when the server has no email", async () => {
    const u = await withTwoFactor("NoMail");
    expect((await u.client.patch("/api/v1/me/2fa", { password: "wrong password!", emailBackup: false })).status).toBe(401);
    expect((await u.client.patch("/api/v1/me/2fa", { password: PW, emailBackup: false })).body.emailBackup).toBe(false);
    const l = await login(u);
    expect(l.body.methods).toEqual(["totp", "recovery"]);
    expect((await new Client(ctx.app).post("/api/v1/auth/2fa/email", { challenge: l.body.challenge })).status).toBe(400);

    const bare = await setup({}); // no mailer
    const b = await register(bare.app, "Bare");
    const s = await b.client.post("/api/v1/me/2fa/setup", { password: PW });
    await b.client.post("/api/v1/me/2fa/enable", { code: code(s.body.secret) });
    expect((await b.client.get("/api/v1/me/2fa")).body.emailAvailable).toBe(false);
    const bl = await new Client(bare.app).post("/api/v1/auth/login", { email: b.email, password: PW });
    expect(bl.body.methods).toEqual(["totp", "recovery"]);
    expect((await b.client.patch("/api/v1/me/2fa", { password: PW, emailBackup: true })).status).toBe(400);
    await bare.app.close(); await bare.pool.end();
    ctx = await setup({}, { mailer });
  });
});

describe("turning it off and recovery codes", () => {
  it("needs password and a valid code; removes everything", async () => {
    const u = await withTwoFactor("Off");
    expect((await u.client.post("/api/v1/me/2fa/disable", { password: "wrong password!", code: code(u.secret, 1) })).status).toBe(401);
    expect((await u.client.post("/api/v1/me/2fa/disable", { password: PW, code: "000000" })).status).toBe(401);
    expect((await u.client.post("/api/v1/me/2fa/disable", { password: PW, code: u.recovery[0]! })).status).toBe(200); // a recovery code works too
    expect((await u.client.get("/api/v1/me/2fa")).body).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
    const l = await login(u);
    expect(l.body.token).toBeTruthy();
    expect(l.body.mfaRequired).toBeUndefined();
  });

  it("regenerating recovery codes invalidates the old ones", async () => {
    const u = await withTwoFactor("Regen");
    const r = await u.client.post("/api/v1/me/2fa/recovery-codes", { password: PW, code: code(u.secret, 1) });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCodes).toHaveLength(10);
    expect(r.body.recoveryCodes).not.toContain(u.recovery[0]);
    expect((await verify((await login(u)).body.challenge, "recovery", u.recovery[0]!)).status).toBe(401);
    expect((await verify((await login(u)).body.challenge, "recovery", r.body.recoveryCodes[0])).status).toBe(200);
  });

  it("records events in the audit log without codes", async () => {
    const u = await withTwoFactor("Audit");
    await verify((await login(u)).body.challenge, "totp", code(u.secret, 1));
    const rows = (await ctx.pool.query("SELECT action, meta::text AS meta, target FROM audit_log WHERE actor_id = (SELECT id FROM users WHERE email = $1)", [u.email])).rows;
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["2fa.enable", "2fa.challenge", "2fa.login"]));
    expect(JSON.stringify(rows)).not.toContain(u.secret);
  });
});

describe("invite expiry", () => {
  async function inviteScenario() {
    const owner = await register(ctx.app, "Inviter");
    const pid = (await owner.client.post(`/api/v1/orgs/${owner.org.id}/projects`, { name: "Inv" })).body.project.id;
    const guest = await register(ctx.app, "Guest");
    return { owner, pid, guest };
  }
  it("uses the chosen expiry and rejects out-of-range values", async () => {
    const { owner, pid, guest } = await inviteScenario();
    const inv = await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: guest.email, role: "viewer", expiresInDays: 1 });
    const hours = (new Date(inv.body.invite.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23); expect(hours).toBeLessThan(25);
    expect((await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: "x@example.com", role: "viewer", expiresInDays: 0 })).status).toBe(400);
    expect((await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: "y@example.com", role: "viewer", expiresInDays: 31 })).status).toBe(400);
  });
  it("says so when an invitation has expired, lists it, and lets an admin extend it", async () => {
    const { owner, pid, guest } = await inviteScenario();
    const inv = await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: guest.email, role: "viewer", expiresInDays: 1 });
    await ctx.pool.query("UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1", [inv.body.invite.id]);
    const gone = await guest.client.post("/api/v1/invites/accept", { token: inv.body.token });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe("invite_expired");
    expect((await guest.client.get("/api/v1/me/invites")).body.invites).toHaveLength(0);
    const list = (await owner.client.get(`/api/v1/projects/${pid}/invites`)).body.invites;
    expect(list).toHaveLength(1);
    expect(list[0].expired).toBe(true);
    expect((await guest.client.post("/api/v1/projects/" + pid + "/invites/" + inv.body.invite.id + "/extend", { expiresInDays: 3 })).status).toBe(404);
    const ext = await owner.client.post(`/api/v1/projects/${pid}/invites/${inv.body.invite.id}/extend`, { expiresInDays: 3 });
    expect(ext.status).toBe(200);
    expect((await owner.client.get(`/api/v1/projects/${pid}/invites`)).body.invites[0].expired).toBe(false);
    expect((await guest.client.post("/api/v1/invites/accept", { token: inv.body.token })).status).toBe(200); // same link works again
    expect((await owner.client.post(`/api/v1/projects/${pid}/invites/${inv.body.invite.id}/extend`, { expiresInDays: 3 })).status).toBe(404); // accepted
  });
  it("only admins can extend", async () => {
    const { owner, pid, guest } = await inviteScenario();
    const viewer = await register(ctx.app, "Viewer");
    const v = await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: viewer.email, role: "viewer" });
    await viewer.client.post("/api/v1/invites/accept", { token: v.body.token });
    const other = await owner.client.post(`/api/v1/projects/${pid}/invites`, { email: guest.email, role: "viewer" });
    expect((await viewer.client.post(`/api/v1/projects/${pid}/invites/${other.body.invite.id}/extend`, { expiresInDays: 7 })).status).toBe(403);
  });
});
