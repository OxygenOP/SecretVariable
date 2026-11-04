import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, register, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { ctx = await setup(); });
afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

describe("auth", () => {
  it("registers, logs in, returns me, logs out", async () => {
    const c = new Client(ctx.app);
    const reg = await c.post("/api/v1/auth/register", { email: "Bob@Example.com", name: "Bob", password: "a long password!" });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe("bob@example.com");
    const login = await c.post("/api/v1/auth/login", { email: "bob@example.com", password: "a long password!" });
    expect(login.status).toBe(200);
    const authed = c.withToken(login.body.token);
    expect((await authed.get("/api/v1/me")).body.user.name).toBe("Bob");
    expect((await authed.post("/api/v1/auth/logout")).status).toBe(200);
    expect((await authed.get("/api/v1/me")).status).toBe(401);
  });
  it("rejects duplicates, weak passwords and bad logins", async () => {
    const c = new Client(ctx.app);
    const body = { email: "dup@example.com", name: "Dup", password: "a long password!" };
    expect((await c.post("/api/v1/auth/register", body)).status).toBe(201);
    expect((await c.post("/api/v1/auth/register", body)).status).toBe(409);
    expect((await c.post("/api/v1/auth/register", { ...body, email: "x@example.com", password: "short" })).status).toBe(400);
    expect((await c.post("/api/v1/auth/login", { email: "dup@example.com", password: "wrong password" })).status).toBe(401);
    expect((await c.post("/api/v1/auth/login", { email: "nobody@example.com", password: "whatever long" })).status).toBe(401);
  });
  it("requires a token", async () => {
    expect((await new Client(ctx.app).get("/api/v1/orgs")).status).toBe(401);
    expect((await new Client(ctx.app, "svs_bogus").get("/api/v1/orgs")).status).toBe(401);
  });
  it("can disable registration", async () => {
    const closed = await setup({ allowRegistration: false });
    const r = await new Client(closed.app).post("/api/v1/auth/register", { email: "a@example.com", name: "A", password: "a long password!" });
    expect(r.status).toBe(403);
    await closed.app.close(); await closed.pool.end();
    ctx = await setup();
  });
});

describe("projects, environments and versions", () => {
  it("runs the full lifecycle", async () => {
    const { client, org } = await register(ctx.app);
    const created = await client.post(`/api/v1/orgs/${org.id}/projects`, { name: "My API" });
    expect(created.status).toBe(201);
    const pid = created.body.project.id;

    const envs = (await client.get(`/api/v1/projects/${pid}/environments`)).body.environments;
    expect(envs.map((e: any) => e.name)).toEqual(["development", "staging", "production"]);
    expect(envs[0].headNumber).toBeNull();
    const dev = envs[0].id;

    // empty environment has no head
    expect((await client.get(`/api/v1/environments/${dev}/versions/head`)).status).toBe(404);

    const v1 = await client.post(`/api/v1/environments/${dev}/versions`, { variables: { DB_URL: "postgres://x", API_KEY: "k1" }, message: "first" });
    expect(v1.status).toBe(201);
    expect(v1.body.version.number).toBe(1);

    // identical content creates no new version
    const same = await client.post(`/api/v1/environments/${dev}/versions`, { variables: { API_KEY: "k1", DB_URL: "postgres://x" } });
    expect(same.status).toBe(200);
    expect(same.body.unchanged).toBe(true);

    const v2 = await client.post(`/api/v1/environments/${dev}/versions`, { variables: { DB_URL: "postgres://y", NEW: "1" }, message: "second" });
    expect(v2.body.version.number).toBe(2);

    const head = await client.get(`/api/v1/environments/${dev}/versions/head`);
    expect(head.body.variables).toEqual({ DB_URL: "postgres://y", NEW: "1" });
    const old = await client.get(`/api/v1/environments/${dev}/versions/1`);
    expect(old.body.variables).toEqual({ DB_URL: "postgres://x", API_KEY: "k1" });

    const list = await client.get(`/api/v1/environments/${dev}/versions`);
    expect(list.body.versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect(list.body.versions[0].message).toBe("second");

    const diff = await client.get(`/api/v1/environments/${dev}/diff?from=1&to=2`);
    expect(diff.body.added).toEqual([{ key: "NEW" }]);
    expect(diff.body.removed).toEqual([{ key: "API_KEY" }]);
    expect(diff.body.changed).toEqual([{ key: "DB_URL" }]);
    const revealed = await client.get(`/api/v1/environments/${dev}/diff?from=1&to=2&reveal=1`);
    expect(revealed.body.changed).toEqual([{ key: "DB_URL", old: "postgres://x", new: "postgres://y" }]);

    const rb = await client.post(`/api/v1/environments/${dev}/rollback`, { number: 1 });
    expect(rb.body.version.number).toBe(3);
    expect((await client.get(`/api/v1/environments/${dev}/versions/head`)).body.variables).toEqual({ DB_URL: "postgres://x", API_KEY: "k1" });
    expect((await client.post(`/api/v1/environments/${dev}/rollback`, { number: 99 })).status).toBe(404);

    // copy into a new environment
    const copy = await client.post(`/api/v1/projects/${pid}/environments`, { name: "preview", copyFromVersionId: v1.body.version.id });
    expect(copy.status).toBe(201);
    expect((await client.get(`/api/v1/environments/${copy.body.environment.id}/versions/head`)).body.variables).toEqual({ DB_URL: "postgres://x", API_KEY: "k1" });
    expect((await client.post(`/api/v1/projects/${pid}/environments`, { name: "preview" })).status).toBe(409);
  });

  it("validates input", async () => {
    const { client, org } = await register(ctx.app);
    const pid = (await client.post(`/api/v1/orgs/${org.id}/projects`, { name: "P", environments: ["dev"] })).body.project.id;
    const dev = (await client.get(`/api/v1/projects/${pid}/environments`)).body.environments[0].id;
    expect((await client.post(`/api/v1/environments/${dev}/versions`, { variables: { "bad key": "x" } })).status).toBe(400);
    expect((await client.post(`/api/v1/environments/${dev}/versions`, { variables: { A: 1 } })).status).toBe(400);
    expect((await client.post(`/api/v1/environments/${dev}/versions`, {})).status).toBe(400);
    expect((await client.get(`/api/v1/environments/not-a-uuid/versions`)).status).toBe(400);
    expect((await client.post(`/api/v1/orgs/${org.id}/projects`, { name: "P" })).status).toBe(409);
  });

  it("isolates users from each other's projects", async () => {
    const alice = await register(ctx.app, "Alice");
    const mallory = await register(ctx.app, "Mallory");
    const pid = (await alice.client.post(`/api/v1/orgs/${alice.org.id}/projects`, { name: "Secret" })).body.project.id;
    const env = (await alice.client.get(`/api/v1/projects/${pid}/environments`)).body.environments[0].id;
    await alice.client.post(`/api/v1/environments/${env}/versions`, { variables: { TOP: "secret" } });

    for (const url of [`/api/v1/projects/${pid}`, `/api/v1/projects/${pid}/environments`, `/api/v1/environments/${env}/versions/head`, `/api/v1/environments/${env}/versions`, `/api/v1/projects/${pid}/audit`]) {
      expect((await mallory.client.get(url)).status).toBe(404);
    }
    expect((await mallory.client.post(`/api/v1/environments/${env}/versions`, { variables: { X: "1" } })).status).toBe(404);
    expect((await mallory.client.del(`/api/v1/projects/${pid}`)).status).toBe(404);
    expect((await mallory.client.get(`/api/v1/orgs/${alice.org.id}`)).status).toBe(404);
    expect((await mallory.client.get(`/api/v1/orgs/${alice.org.id}/projects`)).status).toBe(404);
    expect((await mallory.client.post(`/api/v1/orgs/${alice.org.id}/projects`, { name: "Injected" })).status).toBe(404);
  });
});

describe("encryption at rest", () => {
  it("never stores plaintext values and binds ciphertext to its key", async () => {
    const { client, org } = await register(ctx.app);
    const pid = (await client.post(`/api/v1/orgs/${org.id}/projects`, { name: "Enc" })).body.project.id;
    const env = (await client.get(`/api/v1/projects/${pid}/environments`)).body.environments[0].id;
    await client.post(`/api/v1/environments/${env}/versions`, { variables: { A: "super-secret-value-A", B: "super-secret-value-B" } });

    const dump = await ctx.pool.query("SELECT key, encrypted_value FROM variables");
    const proj = await ctx.pool.query("SELECT wrapped_dek FROM projects WHERE id = $1", [pid]);
    const all = JSON.stringify(dump.rows) + proj.rows[0].wrapped_dek;
    expect(all).not.toContain("super-secret-value");

    // swapping two ciphertexts must make reads fail rather than return the wrong secret
    await ctx.pool.query(`UPDATE variables SET encrypted_value = (SELECT encrypted_value FROM variables WHERE key = 'B' LIMIT 1)
                           WHERE key = 'A' AND version_id IN (SELECT head_version_id FROM environments WHERE id = $1)`, [env]);
    expect((await client.get(`/api/v1/environments/${env}/versions/head`)).status).toBe(500);
  });
});

describe("audit log", () => {
  it("records actions without secret values", async () => {
    const { client, org } = await register(ctx.app);
    const pid = (await client.post(`/api/v1/orgs/${org.id}/projects`, { name: "Audited" })).body.project.id;
    const env = (await client.get(`/api/v1/projects/${pid}/environments`)).body.environments[0].id;
    await client.post(`/api/v1/environments/${env}/versions`, { variables: { K: "do-not-log-me" } });
    await client.get(`/api/v1/environments/${env}/versions/head`);
    const log = await client.get(`/api/v1/projects/${pid}/audit`);
    const actions = log.body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["project.create", "variables.write", "variables.read"]));
    expect(JSON.stringify(log.body)).not.toContain("do-not-log-me");
    const orgLog = await client.get(`/api/v1/orgs/${org.id}/audit`);
    expect(orgLog.status).toBe(200);
  });
});
