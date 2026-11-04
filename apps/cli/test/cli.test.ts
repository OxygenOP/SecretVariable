import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey } from "@secretvariable/crypto";
import { buildApp } from "../../server/src/app.js";
import { createPool, migrate } from "../../server/src/db.js";
import { main } from "../src/cli.js";
import type { IO } from "../src/io.js";

const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/secretvariable_test";
let url = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const pool = createPool(DB);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  const app = await buildApp({ databaseUrl: DB, masterKey: generateKey(), host: "127.0.0.1", port: 0, webDir: null, allowRegistration: true, sessionTtlDays: 30, rateLimitMax: 1000, logger: false }, pool);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  close = async () => { await app.close(); await pool.end(); };
});
afterAll(async () => { await close(); });

class Machine {
  home = mkdtempSync(join(tmpdir(), "sv-home-"));
  cwd = mkdtempSync(join(tmpdir(), "sv-proj-"));
  extraEnv: Record<string, string> = {};
  answers: string[] = [];
  async sv(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const io: IO = {
      cwd: this.cwd, isTTY: false,
      env: { PATH: process.env.PATH, SECRETVARIABLE_CONFIG_DIR: this.home, ...this.extraEnv } as NodeJS.ProcessEnv,
      out: (s) => out.push(s), err: (s) => err.push(s),
      ask: async () => (this.answers.length ? this.answers.shift()! : null),
    };
    const code = await main(argv, io);
    return { code, out: out.join("\n"), err: err.join("\n") };
  }
  write(name: string, text: string) { writeFileSync(join(this.cwd, name), text); }
  read(name: string) { return readFileSync(join(this.cwd, name), "utf8"); }
}

async function signup(name: string) {
  const email = `${name.toLowerCase()}@cli.test`;
  const r = await fetch(`${url}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name, password: "correct horse battery" }) });
  expect(r.status).toBe(201);
  return email;
}

describe("cli", () => {
  const m = new Machine();
  let email = "";

  it("shows help, rejects unknown commands, and requires login", async () => {
    expect((await m.sv("help")).out).toContain("pull  [--env E]");
    expect((await m.sv("nope")).code).toBe(1);
    const r = await m.sv("projects");
    expect(r.code).toBe(1);
    expect(r.err).toContain("secretvariable login");
  });

  it("logs in and stores credentials privately", async () => {
    email = await signup("Cora");
    const bad = await m.sv("login", "--server", url, "--email", email, "--password", "wrong password!");
    expect(bad.code).toBe(1);
    const ok = await m.sv("login", "--server", url, "--email", email, "--password", "correct horse battery");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("Signed in as Cora");
    const cfg = join(m.home, "config.json");
    expect(statSync(cfg).mode & 0o777).toBe(0o600);
    expect(readFileSync(cfg, "utf8")).toContain("svp_"); // a personal token, not a session
    expect((await m.sv("whoami")).out).toContain(email);
  });

  it("creates a project, links the folder, and lists environments", async () => {
    expect((await m.sv("init")).code).toBe(1); // no project exists yet
    const r = await m.sv("init", "--create", "--project", "Web App");
    expect(r.code).toBe(0);
    expect(existsSync(join(m.cwd, ".secretvariable.json"))).toBe(true);
    expect((await m.sv("init")).err).toContain("Already linked");
    const envs = await m.sv("env", "list");
    expect(envs.out).toMatch(/development/);
    expect(envs.out).toMatch(/production/);
    expect((await m.sv("projects")).out).toContain("Web App");
  });

  it("pushes, pulls, shows status, history, diff and rollback", async () => {
    m.write(".env", "API_KEY=abc\nDB_URL=postgres://localhost/app\nDEBUG=true\n");
    const push = await m.sv("push", "-m", "initial");
    expect(push.out).toContain("+ API_KEY");
    expect(push.out).toContain("Pushed to development as v1");
    expect((await m.sv("push")).out).toContain("No changes");

    m.write(".env", "API_KEY=abc\nDB_URL=postgres://prod/app\nNEW=1\n");
    const noConfirm = await m.sv("push");
    expect(noConfirm.code).toBe(1); // removes DEBUG, no terminal to confirm
    expect(noConfirm.err).toContain("--yes");
    const st = await m.sv("status");
    expect(st.out).toContain("~ DB_URL");
    expect(st.out).toContain("- DEBUG");
    expect((await m.sv("push", "--yes", "-m", "prod db")).out).toContain("v2");

    const log = await m.sv("log");
    expect(log.out).toContain("v2 (head)");
    expect(log.out).toContain("prod db");
    const d = await m.sv("diff", "1", "2");
    expect(d.out).toContain("+ NEW");
    expect(d.out).toContain("~ DB_URL");
    expect(d.out).not.toContain("postgres://prod");
    expect((await m.sv("diff", "1", "2", "--reveal")).out).toContain("postgres://localhost/app -> postgres://prod/app");

    const rb = await m.sv("rollback", "1");
    expect(rb.out).toContain("v3");
    // local file has differing keys, so pull refuses; --force overwrites
    m.write(".env", "LOCAL_ONLY=1\n");
    const refuse = await m.sv("pull");
    expect(refuse.code).toBe(1);
    expect(refuse.err).toContain("--force");
    expect((await m.sv("pull", "--force")).out).toContain("3 variables");
    expect(m.read(".env")).toBe("API_KEY=abc\nDB_URL=postgres://localhost/app\nDEBUG=true\n");
    expect(statSync(join(m.cwd, ".env")).mode & 0o777).toBe(0o600);
    expect((await m.sv("pull", "--version", "2", "--file", "old.env")).out).toContain("v2");
    expect(m.read("old.env")).toContain("NEW=1");
    expect((await m.sv("status")).out).toContain("matches v3");
  });

  it("runs a command with variables injected and passes the exit code through", async () => {
    const ok = await m.sv("run", "--", process.execPath, "-e", "process.exit(process.env.API_KEY === 'abc' ? 0 : 7)");
    expect(ok.code).toBe(0);
    const bad = await m.sv("run", "--", process.execPath, "-e", "process.exit(5)");
    expect(bad.code).toBe(5);
    expect((await m.sv("run")).code).toBe(1);
  });

  it("switches and creates environments", async () => {
    expect((await m.sv("env", "create", "preview", "--from", "development@1")).out).toContain("Created");
    expect((await m.sv("env", "use", "preview")).code).toBe(0);
    expect((await m.sv("pull", "--force", "--file", "preview.env")).out).toContain("3 variables from preview");
    expect((await m.sv("env", "use", "missing")).code).toBe(1);
    await m.sv("env", "use", "development");
  });

  it("invites a teammate limited to one environment", async () => {
    const dana = await signup("Dana");
    const inv = await m.sv("invite", dana, "--role", "viewer", "--envs", "staging");
    expect(inv.code).toBe(0);
    const token = /accept (svi_\S+)/.exec(inv.out)![1]!;

    const d = new Machine();
    expect((await d.sv("login", "--server", url, "--email", dana, "--password", "correct horse battery")).code).toBe(0);
    expect((await d.sv("accept", token)).out).toContain("Web App");
    expect((await d.sv("init", "--project", "Web App")).code).toBe(0);
    // only staging is visible, and it was the first accessible environment
    const list = await d.sv("env", "list");
    expect(list.out).toContain("staging");
    expect(list.out).not.toContain("production");
    expect((await m.sv("members")).out).toContain("staging:read");
  });

  it("uses a scoped service token from the environment for CI", async () => {
    const t = await m.sv("token", "create", "--name", "ci", "--env", "development", "--access", "read");
    const token = /(svt_\S+)/.exec(t.out)![1]!;
    const ci = new Machine();
    ci.cwd = m.cwd; // checkout containing .secretvariable.json
    ci.extraEnv = { SECRETVARIABLE_URL: url, SECRETVARIABLE_TOKEN: token };
    expect((await ci.sv("pull", "--force", "--file", "ci.env")).out).toContain("3 variables");
    ci.write(".env", "CHANGED=1\n");
    const push = await ci.sv("push", "--yes");
    expect(push.code).toBe(1); // read-only token
    expect(push.err).toMatch(/read-only/);
    expect((await ci.sv("env", "list")).out).toContain("development");
    expect((await m.sv("token", "list")).out).toContain("ci");
    const id = /\n(\w{8})\s+service/.exec((await m.sv("token", "list")).out)![1]!;
    const rv = await m.sv("token", "revoke", id); expect(rv.err).toBe(""); expect(rv.code).toBe(0);
    expect((await ci.sv("pull", "--force", "--file", "ci.env")).code).toBe(1);
  });

  it("logs out locally", async () => {
    expect((await m.sv("logout")).code).toBe(0);
    expect((await m.sv("whoami")).code).toBe(1);
    mkdirSync(join(m.cwd, "sub"), { recursive: true });
  });
});
