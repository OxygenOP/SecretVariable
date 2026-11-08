import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, generateKey, totpCode } from "@secretvariable/crypto";
import { buildApp } from "../../server/src/app.js";
import { createPool, migrate } from "../../server/src/db.js";
import { main, VERSION } from "../src/cli.js";
import type { IO } from "../src/io.js";

const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/secretvariable_test";
let url = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const pool = createPool(DB);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  const app = await buildApp({ databaseUrl: DB, masterKey: generateKey(), host: "127.0.0.1", port: 0, webDir: null, allowRegistration: true, sessionTtlDays: 30, rateLimitMax: 1000, logger: false, smtpUrl: null, mailFrom: "test@example.com", publicUrl: null }, pool);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  close = async () => { await app.close(); await pool.end(); };
});
afterAll(async () => { await close(); });

it("reports the version in package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  expect(VERSION).toBe(pkg.version);
});

class Machine {
  home = mkdtempSync(join(tmpdir(), "sv-home-"));
  cwd = mkdtempSync(join(tmpdir(), "sv-proj-"));
  extraEnv: Record<string, string> = {};
  answers: string[] = [];
  tty = false;
  async sv(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const io: IO = {
      cwd: this.cwd, isTTY: this.tty,
      env: { PATH: process.env.PATH, SECRETVARIABLE_CONFIG_DIR: this.home, ...(this.tty ? { NO_COLOR: "1" } : {}), ...this.extraEnv } as NodeJS.ProcessEnv,
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

  it("works under the short name `svar` and shows it in hints", async () => {
    const fresh = new Machine();
    const out: string[] = [];
    const err: string[] = [];
    const io: IO = { prog: "svar", cwd: fresh.cwd, isTTY: false, env: { PATH: process.env.PATH, SECRETVARIABLE_CONFIG_DIR: fresh.home } as NodeJS.ProcessEnv, out: (s) => out.push(s), err: (s) => err.push(s), ask: async () => null };
    expect(await main(["projects"], io)).toBe(1);
    expect(err.join("\n")).toContain("Run: svar login");
    expect(err.join("\n")).not.toContain("secretvariable login");
    expect(await main(["help"], io)).toBe(0);
    expect(out.join("\n")).toContain(`svar ${VERSION}`);
    expect(out.join("\n")).toContain("pull  [--env E]");
    expect(out.join("\n")).not.toMatch(/secretvariable (pull|push|login)/);
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

  describe("switching environments", () => {
    const DEV = "API_KEY=abc\nDB_URL=postgres://localhost/app\nDEBUG=true\n";
    const PROD = "API_KEY=prod\nDB_URL=postgres://prod/app\n";

    it("shows the project you are on in env list", async () => {
      const r = await m.sv("env", "list");
      expect(r.out).toContain("Project: Web App");
      expect(r.out).toContain("Using:   development");
      expect(r.out).toContain("production");
    });

    it("swaps the env file when you switch, with no --force", async () => {
      expect(m.read(".env")).toBe(DEV);
      m.write(".env", PROD);
      expect((await m.sv("push", "--env", "production", "--yes")).out).toContain("Pushed to production as v1 (project: Web App)");
      const toProd = await m.sv("env", "use", "production");
      expect(toProd.code).toBe(0);
      expect(toProd.out).toContain("Now using Web App / production (v1). Wrote 2 variables");
      expect(toProd.out).toContain("You are on production");
      expect(m.read(".env")).toBe(PROD);
      const toDev = await m.sv("env", "use", "development");
      expect(toDev.code).toBe(0);
      expect(m.read(".env")).toBe(DEV);
      expect(statSync(join(m.cwd, ".env")).mode & 0o777).toBe(0o600);
      expect(existsSync(join(m.cwd, ".secretvariable.state.json"))).toBe(true);
      expect(readFileSync(join(m.cwd, ".secretvariable.state.json"), "utf8")).not.toContain("abc"); // a fingerprint, never contents
    });

    it("never overwrites edits silently: refuses, then backs up or discards on request", async () => {
      m.write(".env", DEV + "MINE=1\n");
      const refuse = await m.sv("env", "use", "production");
      expect(refuse.code).toBe(1);
      expect(refuse.err).toContain("MINE");
      expect(refuse.err).toContain("--backup");
      expect(m.read(".env")).toBe(DEV + "MINE=1\n"); // untouched
      expect((await m.sv("env", "list")).out).toContain("Using:   development");

      const kept = await m.sv("env", "use", "production", "--backup");
      expect(kept.code).toBe(0);
      expect(kept.out).toContain("Saved your local copy");
      const backup = readdirSync(m.cwd).find((f) => f.startsWith(".env.backup-"))!;
      expect(readFileSync(join(m.cwd, backup), "utf8")).toContain("MINE=1");
      expect(statSync(join(m.cwd, backup)).mode & 0o777).toBe(0o600);
      expect(m.read(".env")).toBe(PROD);

      // "-" returns to where you were; the file is untouched since the switch, so it just swaps
      expect((await m.sv("env", "use", "-")).out).toContain("Web App / development");
      expect(m.read(".env")).toBe(DEV);

      m.write(".env", DEV + "SCRATCH=2\n");
      const dropped = await m.sv("env", "use", "production", "--discard");
      expect(dropped.code).toBe(0);
      expect(m.read(".env")).toBe(PROD);
    });

    it("asks in a terminal and cancels safely", async () => {
      const t = new Machine();
      t.home = m.home; t.cwd = m.cwd; t.tty = true;
      t.write(".env", PROD + "EDITED=1\n");
      t.answers = ["c"];
      const cancelled = await t.sv("env", "use", "development");
      expect(cancelled.code).toBe(1);
      expect(cancelled.err).toContain("Cancelled");
      expect(m.read(".env")).toBe(PROD + "EDITED=1\n");
      t.answers = ["b"];
      expect((await t.sv("env", "use", "development")).code).toBe(0);
      expect(m.read(".env")).toBe(DEV);
    });

    it("accepts unambiguous prefixes and explains ambiguous ones", async () => {
      expect((await m.sv("env", "use", "prod")).out).toContain("Web App / production");
      expect((await m.sv("env", "use", "dev")).out).toContain("Web App / development");
      expect((await m.sv("env", "create", "demo")).code).toBe(0);
      const amb = await m.sv("env", "use", "de");
      expect(amb.code).toBe(1);
      expect(amb.err).toContain("more than one");
      expect(amb.err).toContain("development");
      expect((await m.sv("env", "use", "zzz")).err).toContain("Available:");
      expect((await m.sv("pull", "--env", "prod", "--file", "p.env")).out).toContain("from production");
      expect((await m.sv("env", "use", "development")).out).toContain("Already using");
    });

    it("switches without touching the file with --no-pull, and does not create a file you never had", async () => {
      const before = m.read(".env");
      expect((await m.sv("env", "use", "production", "--no-pull")).out).toContain("left as it was");
      expect(m.read(".env")).toBe(before);
      expect((await m.sv("env", "use", "development")).code).toBe(0); // .env held development; production has other values
      const fresh = join(m.cwd, ".env");
      writeFileSync(fresh, ""); // empty is replaceable
      await m.sv("env", "use", "production");
      rmSync(fresh);
      const none = await m.sv("env", "use", "development");
      expect(none.code).toBe(0);
      expect(existsSync(fresh)).toBe(false);
      expect(none.out).toContain("no .env here yet");
    });

    it("recognises a file from an older CLI when nothing would be lost", async () => {
      await m.sv("pull", "--force");
      rmSync(join(m.cwd, ".secretvariable.state.json"));
      const r = await m.sv("env", "use", "production");
      expect(r.code).toBe(0);
      expect(m.read(".env")).toBe(PROD);
      await m.sv("env", "use", "development");
    });

    it("lets pull replace an untouched file with a newer version, but not an edited one", async () => {
      await m.sv("pull", "--force");
      const head = (await m.sv("log")).out.match(/v(\d+) \(head\)/)![1]!;
      expect((await m.sv("rollback", "1")).code).toBe(0); // the server moves on
      const up = await m.sv("pull"); // no --force needed
      expect(up.code).toBe(0);
      expect(up.out).toContain(`(project: Web App)`);
      expect(Number(head)).toBeGreaterThan(0);
      m.write(".env", m.read(".env") + "EDITED=1\n");
      expect((await m.sv("rollback", "2")).code).toBe(0);
      const refused = await m.sv("pull");
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("EDITED");
      expect((await m.sv("pull", "--backup")).code).toBe(0);
      expect(m.read(".env")).not.toContain("EDITED");
    });

    it("asks before pushing to production in a terminal", async () => {
      const t = new Machine();
      t.home = m.home; t.cwd = m.cwd; t.tty = true;
      await m.sv("env", "use", "production");
      t.write(".env", m.read(".env") + "EXTRA=1\n");
      t.answers = ["n"];
      const no = await t.sv("push");
      expect(no.code).toBe(1);
      expect(no.err).toContain("Nothing was pushed");
      t.answers = ["y"];
      const yes = await t.sv("push");
      expect(yes.code).toBe(0);
      expect(yes.out).toContain("Pushed to production");
      // scripts are not blocked: without a terminal there is no prompt
      m.write(".env", m.read(".env") + "MORE=1\n");
      expect((await m.sv("push")).code).toBe(0);
      await m.sv("env", "use", "development");
    });
  });

  it("explains that --send-email needs SMTP on the server, and creates nothing", async () => {
    const who = await signup("Mailless");
    const r = await m.sv("invite", who, "--role", "viewer", "--send-email");
    expect(r.code).toBe(1);
    expect(r.err).toContain("no email configured");
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

  it("signs in with two-step verification (authenticator code, recovery code, interactive prompt)", async () => {
    const email = await signup("Tess");
    const pw = "correct horse battery";
    const sess = (await (await fetch(`${url}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json()) as { token: string };
    const api = (path: string, body: unknown) => fetch(`${url}/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sess.token}` }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);
    const setupRes = await api("/me/2fa/setup", { password: pw });
    const secret = base32Decode(setupRes.secret);
    const at = (steps: number) => totpCode(secret, Date.now() + steps * 30_000);
    const { recoveryCodes } = await api("/me/2fa/enable", { code: at(0) });

    const t = new Machine();
    const base = ["login", "--server", url, "--email", email, "--password", pw];
    const noCode = await t.sv(...base);
    expect(noCode.code).toBe(1);
    expect(noCode.err).toContain("--code");
    expect((await t.sv(...base, "--code", "000000")).code).toBe(1);
    expect(existsSync(join(t.home, "config.json"))).toBe(false); // nothing saved without the second step
    const bad = await t.sv(...base, "--method", "email", "--code", "123456");
    expect(bad.err).toContain("not available");

    const ok = await t.sv(...base, "--code", at(1));
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("Signed in as Tess");
    expect((await t.sv("whoami")).out).toContain(email);

    // interactive: switch to a recovery code at the prompt
    const t2 = new Machine();
    const interactive: IO = { cwd: t2.cwd, isTTY: true, env: { PATH: process.env.PATH, SECRETVARIABLE_CONFIG_DIR: t2.home } as NodeJS.ProcessEnv, out: () => {}, err: () => {}, ask: async () => { const a = ["recovery", recoveryCodes[0]][asked++]; return a ?? null; } };
    let asked = 0;
    expect(await main(["login", "--server", url, "--email", email, "--password", pw], interactive)).toBe(0);
    expect(existsSync(join(t2.home, "config.json"))).toBe(true);
    // the used recovery code does not work again
    const reuse = await t.sv(...base, "--method", "recovery", "--code", recoveryCodes[0]);
    expect(reuse.code).toBe(1);
  });

  it("sets an invitation expiry and validates it", async () => {
    const dana = await signup("Dora");
    expect((await m.sv("invite", dana, "--expires", "0")).code).toBe(1);
    expect((await m.sv("invite", dana, "--expires", "99")).code).toBe(1);
    const ok = await m.sv("invite", dana, "--role", "viewer", "--expires", "2");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("expires");
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
