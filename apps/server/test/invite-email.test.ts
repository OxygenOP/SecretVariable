import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMailer, createMemoryMailer, type Mailer } from "../src/mailer.js";
import { register, setup } from "./helpers.js";

async function scenario(app: Awaited<ReturnType<typeof setup>>["app"]) {
  const owner = await register(app, "Owner");
  const pid = (await owner.client.post(`/api/v1/orgs/${owner.org.id}/projects`, { name: "Team" })).body.project.id;
  const envs = (await owner.client.get(`/api/v1/projects/${pid}/environments`)).body.environments as any[];
  return { owner, pid, env: Object.fromEntries(envs.map((e) => [e.name, e.id])) };
}
const linkIn = (text: string) => /(https?:\/\/\S+\/invite\/svi_\S+)/.exec(text)?.[1] ?? "";

describe("emailed invitations (SMTP configured)", () => {
  const mailer = createMemoryMailer();
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { ctx = await setup({ publicUrl: "https://secrets.example.com" }, { mailer }); });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it("tells clients that email is available", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/api/config" });
    expect(r.json().emailEnabled).toBe(true);
  });

  it("emails the invitation when asked, with a working link and the access that was granted", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Dana");
    mailer.outbox.length = 0;
    const r = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, {
      email: person.email, role: "editor", scope: "selected", sendEmail: true,
      grants: [{ environmentId: s.env.development, access: "write" }, { environmentId: s.env.staging, access: "read" }],
    });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(true);
    expect(mailer.outbox).toHaveLength(1);
    const m = mailer.outbox[0]!;
    expect(m.to).toBe(person.email);
    expect(m.subject).toContain("Team");
    expect(m.text).toContain("development (write), staging (read)");
    expect(m.text).toContain("editor");
    const link = linkIn(m.text);
    expect(link.startsWith("https://secrets.example.com/invite/")).toBe(true);
    // the emailed link is the real one
    const token = link.split("/invite/")[1]!;
    expect(token).toBe(r.body.token);
    expect((await person.client.post("/api/v1/invites/accept", { token })).status).toBe(200);
  });

  it("does not email unless asked", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Quiet");
    mailer.outbox.length = 0;
    const r = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, role: "viewer" });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(false);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("resends with a fresh link and retires the old one", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Again");
    const first = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, role: "viewer" });
    mailer.outbox.length = 0;
    const re = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites/${first.body.invite.id}/resend`);
    expect(re.status).toBe(200);
    expect(mailer.outbox).toHaveLength(1);
    expect(linkIn(mailer.outbox[0]!.text)).toContain(re.body.token);
    expect(re.body.token).not.toBe(first.body.token);
    expect((await person.client.post("/api/v1/invites/accept", { token: first.body.token })).status).toBe(404);
    expect((await person.client.post("/api/v1/invites/accept", { token: re.body.token })).status).toBe(200);
  });

  it("will not resend an expired invitation, and only project admins can send", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Late");
    const inv = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, role: "viewer" });
    await ctx.pool.query("UPDATE invites SET expires_at = now() - interval '1 day' WHERE id = $1", [inv.body.invite.id]);
    expect((await s.owner.client.post(`/api/v1/projects/${s.pid}/invites/${inv.body.invite.id}/resend`)).status).toBe(409);
    const stranger = await register(ctx.app, "Stranger");
    expect([403, 404]).toContain((await stranger.client.post(`/api/v1/projects/${s.pid}/invites/${inv.body.invite.id}/resend`)).status);
    expect([403, 404]).toContain((await stranger.client.post(`/api/v1/projects/${s.pid}/invites`, { email: "x@example.com", role: "viewer", sendEmail: true })).status);
  });

  it("is audited", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Logged");
    await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, role: "viewer", sendEmail: true });
    const a = await ctx.pool.query("SELECT action, target FROM audit_log WHERE project_id = $1 AND action = 'invite.email'", [s.pid]);
    expect(a.rows).toEqual([{ action: "invite.email", target: person.email }]);
  });
});

describe("emailed invitations when the mail server fails", () => {
  const failing: Mailer = { enabled: true, send: async () => { throw new Error("connection refused"); } };
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { ctx = await setup({}, { mailer: failing }); });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it("still creates the invitation and reports the failure so the link can be shared by hand", async () => {
    const s = await scenario(ctx.app);
    const person = await register(ctx.app, "Unlucky");
    const r = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, role: "viewer", sendEmail: true });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(false);
    expect(r.body.emailError).toContain("connection refused");
    expect(r.body.token).toMatch(/^svi_/);
    // a failed resend keeps the existing link working
    const re = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites/${r.body.invite.id}/resend`);
    expect(re.status).toBe(502);
    expect((await person.client.post("/api/v1/invites/accept", { token: r.body.token })).status).toBe(200);
  });
});

describe("invitations without SMTP", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { ctx = await setup({}, { mailer: createMailer({ smtpUrl: null, mailFrom: "x@example.com" }) }); });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  it("hides email, refuses to send, and creates nothing when asked to", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/config" })).json().emailEnabled).toBe(false);
    const s = await scenario(ctx.app);
    const r = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: "nobody@example.com", role: "viewer", sendEmail: true });
    expect(r.status).toBe(400);
    expect((await s.owner.client.get(`/api/v1/projects/${s.pid}/invites`)).body.invites).toHaveLength(0);
    // links still work exactly as before
    const ok = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: "nobody@example.com", role: "viewer" });
    expect(ok.status).toBe(201);
    expect(ok.body.emailed).toBe(false);
    expect((await s.owner.client.post(`/api/v1/projects/${s.pid}/invites/${ok.body.invite.id}/resend`)).status).toBe(400);
  });
});
