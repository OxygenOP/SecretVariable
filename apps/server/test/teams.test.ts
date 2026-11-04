import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, register, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

async function scenario() {
  const owner = await register(ctx.app, "Owner");
  const pid = (await owner.client.post(`/api/v1/orgs/${owner.org.id}/projects`, { name: "Team" })).body.project.id;
  const envs = (await owner.client.get(`/api/v1/projects/${pid}/environments`)).body.environments as any[];
  const byName = Object.fromEntries(envs.map((e) => [e.name, e.id]));
  for (const n of Object.keys(byName)) await owner.client.post(`/api/v1/environments/${byName[n]}/versions`, { variables: { WHERE: n } });
  return { owner, pid, env: byName };
}

async function invite(s: Awaited<ReturnType<typeof scenario>>, person: Awaited<ReturnType<typeof register>>, body: object) {
  const inv = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: person.email, ...body });
  expect(inv.status).toBe(201);
  const acc = await person.client.post("/api/v1/invites/accept", { token: inv.body.token });
  expect(acc.status).toBe(200);
}

describe("invites and roles", () => {
  it("lets a viewer read but not write or administer", async () => {
    const s = await scenario();
    const viewer = await register(ctx.app, "Viewer");
    expect((await viewer.client.get(`/api/v1/projects/${s.pid}`)).status).toBe(404);
    await invite(s, viewer, { role: "viewer" });
    expect((await viewer.client.get(`/api/v1/environments/${s.env.production}/versions/head`)).body.variables).toEqual({ WHERE: "production" });
    expect((await viewer.client.post(`/api/v1/environments/${s.env.production}/versions`, { variables: { X: "1" } })).status).toBe(403);
    expect((await viewer.client.post(`/api/v1/projects/${s.pid}/invites`, { email: "z@example.com", role: "viewer" })).status).toBe(403);
    expect((await viewer.client.get(`/api/v1/projects/${s.pid}/audit`)).status).toBe(403);
    expect((await viewer.client.del(`/api/v1/projects/${s.pid}`)).status).toBe(403);
    expect((await viewer.client.get(`/api/v1/projects/${s.pid}/members`)).body.members).toHaveLength(1);
  });

  it("lets an editor write", async () => {
    const s = await scenario();
    const ed = await register(ctx.app, "Editor");
    await invite(s, ed, { role: "editor" });
    const w = await ed.client.post(`/api/v1/environments/${s.env.development}/versions`, { variables: { NEW: "1" }, message: "from editor" });
    expect(w.status).toBe(201);
    expect((await ed.client.post(`/api/v1/projects/${s.pid}/environments`, { name: "extra" })).status).toBe(403);
  });

  it("limits access to selected environments with per-environment grants", async () => {
    const s = await scenario();
    const dev = await register(ctx.app, "Dev");
    await invite(s, dev, { role: "editor", scope: "selected", grants: [{ environmentId: s.env.development, access: "write" }, { environmentId: s.env.staging, access: "read" }] });
    const visible = (await dev.client.get(`/api/v1/projects/${s.pid}/environments`)).body.environments;
    expect(visible.map((e: any) => [e.name, e.access])).toEqual([["development", "write"], ["staging", "read"]]);
    expect((await dev.client.get(`/api/v1/environments/${s.env.production}/versions/head`)).status).toBe(404);
    expect((await dev.client.post(`/api/v1/environments/${s.env.production}/versions`, { variables: { A: "1" } })).status).toBe(404);
    expect((await dev.client.post(`/api/v1/environments/${s.env.staging}/versions`, { variables: { A: "1" } })).status).toBe(403);
    expect((await dev.client.post(`/api/v1/environments/${s.env.development}/versions`, { variables: { A: "1" } })).status).toBe(201);
    // a viewer role caps a write grant to read
    const v = await register(ctx.app, "Viewer2");
    await invite(s, v, { role: "viewer", scope: "selected", grants: [{ environmentId: s.env.development, access: "write" }] });
    expect((await v.client.post(`/api/v1/environments/${s.env.development}/versions`, { variables: { B: "1" } })).status).toBe(403);
    // admin can change the grants later
    const members = (await s.owner.client.get(`/api/v1/projects/${s.pid}/members`)).body.members;
    const devId = members.find((m: any) => m.email === dev.email).userId;
    await s.owner.client.req("PUT", `/api/v1/projects/${s.pid}/members/${devId}`, { role: "editor", scope: "selected", grants: [{ environmentId: s.env.production, access: "read" }] });
    expect((await dev.client.get(`/api/v1/environments/${s.env.production}/versions/head`)).status).toBe(200);
    expect((await dev.client.get(`/api/v1/environments/${s.env.development}/versions/head`)).status).toBe(404);
  });

  it("only accepts invites for the right email, once, and respects revocation", async () => {
    const s = await scenario();
    const a = await register(ctx.app, "A");
    const b = await register(ctx.app, "B");
    const inv = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: a.email, role: "viewer" });
    expect((await b.client.post("/api/v1/invites/accept", { token: inv.body.token })).status).toBe(403);
    expect((await a.client.get("/api/v1/me/invites")).body.invites).toHaveLength(1);
    expect((await a.client.post("/api/v1/invites/accept", { token: inv.body.token })).status).toBe(200);
    expect((await a.client.post("/api/v1/invites/accept", { token: inv.body.token })).status).toBe(404);
    const second = await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: b.email, role: "viewer" });
    expect((await s.owner.client.del(`/api/v1/projects/${s.pid}/invites/${second.body.invite.id}`)).status).toBe(200);
    expect((await b.client.post("/api/v1/invites/accept", { token: second.body.token })).status).toBe(404);
    expect((await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: a.email, role: "viewer" })).status).toBe(409);
    expect((await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: "x@example.com", role: "viewer", scope: "selected" })).status).toBe(400);
  });

  it("accepts an invite by id for a signed-in user", async () => {
    const s = await scenario();
    const a = await register(ctx.app, "ById");
    await s.owner.client.post(`/api/v1/projects/${s.pid}/invites`, { email: a.email, role: "viewer" });
    const id = (await a.client.get("/api/v1/me/invites")).body.invites[0].id;
    expect((await a.client.post(`/api/v1/invites/${id}/accept`)).status).toBe(200);
    expect((await a.client.get(`/api/v1/projects/${s.pid}`)).status).toBe(200);
  });

  it("removes members and keeps at least one admin", async () => {
    const s = await scenario();
    const v = await register(ctx.app, "Leaver");
    await invite(s, v, { role: "viewer" });
    const me = s.owner.user.id;
    expect((await s.owner.client.del(`/api/v1/projects/${s.pid}/members/${me}`)).status).toBe(409);
    expect((await s.owner.client.req("PUT", `/api/v1/projects/${s.pid}/members/${me}`, { role: "viewer" })).status).toBe(409);
    expect((await v.client.del(`/api/v1/projects/${s.pid}/members/${me}`)).status).toBe(403);
    expect((await v.client.del(`/api/v1/projects/${s.pid}/members/${v.user.id}`)).status).toBe(200);
    expect((await v.client.get(`/api/v1/projects/${s.pid}`)).status).toBe(404);
  });

  it("gives org owners and admins access to every project", async () => {
    const s = await scenario();
    const admin = await register(ctx.app, "OrgAdmin");
    await invite(s, admin, { role: "viewer" }); // joins the org as a member
    expect((await s.owner.client.patch(`/api/v1/orgs/${s.owner.org.id}/members/${admin.user.id}`, { role: "admin" })).status).toBe(200);
    expect((await admin.client.get(`/api/v1/projects/${s.pid}/audit`)).status).toBe(200);
    expect((await s.owner.client.patch(`/api/v1/orgs/${s.owner.org.id}/members/${s.owner.user.id}`, { role: "member" })).status).toBe(409);
    expect((await admin.client.patch(`/api/v1/orgs/${s.owner.org.id}/members/${admin.user.id}`, { role: "owner" })).status).toBe(403);
    // removing someone from the org removes their project access
    expect((await s.owner.client.del(`/api/v1/orgs/${s.owner.org.id}/members/${admin.user.id}`)).status).toBe(200);
    expect((await admin.client.get(`/api/v1/projects/${s.pid}`)).status).toBe(404);
  });
});

describe("tokens", () => {
  it("scopes service tokens to a project environment and access level", async () => {
    const s = await scenario();
    const other = (await s.owner.client.post(`/api/v1/orgs/${s.owner.org.id}/projects`, { name: "Other" })).body.project.id;
    const t = await s.owner.client.post("/api/v1/tokens", { name: "ci", kind: "service", projectId: s.pid, environmentId: s.env.production, access: "read" });
    expect(t.status).toBe(201);
    expect(t.body.token.startsWith("svt_")).toBe(true);
    const ci = s.owner.client.withToken(t.body.token);
    expect((await ci.get(`/api/v1/environments/${s.env.production}/versions/head`)).body.variables).toEqual({ WHERE: "production" });
    expect((await ci.get(`/api/v1/environments/${s.env.development}/versions/head`)).status).toBe(404);
    expect((await ci.get(`/api/v1/projects/${other}`)).status).toBe(404);
    expect((await ci.post(`/api/v1/environments/${s.env.production}/versions`, { variables: { A: "1" } })).status).toBe(403);
    expect((await ci.post("/api/v1/tokens", { name: "x", kind: "personal" })).status).toBe(403);
    expect((await ci.get("/api/v1/tokens")).status).toBe(403);
    expect((await ci.del(`/api/v1/projects/${s.pid}`)).status).toBe(403);
    // list and revoke
    const list = (await s.owner.client.get("/api/v1/tokens")).body.tokens;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(t.body.token);
    expect((await s.owner.client.del(`/api/v1/tokens/${t.body.id}`)).status).toBe(200);
    expect((await ci.get(`/api/v1/environments/${s.env.production}/versions/head`)).status).toBe(401);
  });

  it("caps a read-only personal token", async () => {
    const s = await scenario();
    const t = await s.owner.client.post("/api/v1/tokens", { name: "ro", kind: "personal", access: "read" });
    const ro = s.owner.client.withToken(t.body.token);
    expect((await ro.get(`/api/v1/environments/${s.env.development}/versions/head`)).status).toBe(200);
    expect((await ro.post(`/api/v1/environments/${s.env.development}/versions`, { variables: { A: "1" } })).status).toBe(403);
    expect((await ro.del(`/api/v1/projects/${s.pid}`)).status).toBe(403);
  });

  it("revokes service tokens when the owner loses access", async () => {
    const s = await scenario();
    const m = await register(ctx.app, "Temp");
    await invite(s, m, { role: "admin" });
    const t = await m.client.post("/api/v1/tokens", { name: "ci", kind: "service", projectId: s.pid });
    const svc = m.client.withToken(t.body.token);
    expect((await svc.get(`/api/v1/projects/${s.pid}`)).status).toBe(200);
    await s.owner.client.del(`/api/v1/projects/${s.pid}/members/${m.user.id}`);
    expect((await svc.get(`/api/v1/projects/${s.pid}`)).status).toBe(401);
  });

  it("serialises concurrent writes into distinct versions", async () => {
    const s = await scenario();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      s.owner.client.post(`/api/v1/environments/${s.env.development}/versions`, { variables: { N: String(i) } })));
    expect(results.map((r) => r.status + ":" + JSON.stringify(r.body).slice(0, 120))).toEqual(results.map(() => expect.stringMatching(/^201/)));
    const nums = results.map((r) => r.body.version.number).sort();
    expect(nums).toEqual([2, 3, 4, 5, 6, 7]);
  });
});
