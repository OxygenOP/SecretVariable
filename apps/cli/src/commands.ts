import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { diffEnv, parseEnv, serializeEnv, type EnvMap } from "@secretvariable/shared";
import { Api, ApiError } from "./api.js";
import type { Parsed } from "./args.js";
import { str } from "./args.js";
import { clearCredentials, findLink, readCredentials, requireCredentials, requireLink, saveCredentials, writeLink, LINK_FILE, type ProjectLink } from "./config.js";
import { CliError, style, table, type IO } from "./io.js";
import { isUntouched, previousEnvironment, remember, setPrevious, STATE_FILE } from "./state.js";

type Cmd = (p: Parsed, io: IO) => Promise<void>;

const api = (io: IO) => Api.from(requireCredentials(io));

async function ask(io: IO, question: string, flag?: string, secret = false): Promise<string> {
  if (flag) return flag;
  const a = await io.ask(question, { secret });
  if (a === null || a.trim() === "") throw new CliError(`Missing value: ${question.replace(/[:?]\s*$/, "")}`, "Pass it as a flag, or run in an interactive terminal.");
  return a.trim();
}

async function choose<T>(io: IO, label: string, items: T[], name: (t: T) => string): Promise<T> {
  if (items.length === 1) return items[0]!;
  io.out(`${label}\n` + items.map((t, i) => `  ${i + 1}) ${name(t)}`).join("\n"));
  const a = await io.ask("Choose a number: ");
  const n = Number(a);
  if (!a || !Number.isInteger(n) || n < 1 || n > items.length) throw new CliError("No valid choice made.");
  return items[n - 1]!;
}

interface EnvInfo { id: string; name: string; headNumber: number | null; variableCount: number; access: string; updatedAt: string | null }

async function envs(a: Api, projectId: string): Promise<EnvInfo[]> {
  return (await a.get(`/projects/${projectId}/environments`)).environments;
}

/**
 * Find an environment by name. An exact name always wins; otherwise a prefix works when it is unambiguous
 * ("prod" for "production"), so `--env dev` and `env use staging` need fewer keystrokes without guessing.
 */
function matchEnv(list: EnvInfo[], input: string): EnvInfo {
  const exact = list.find((e) => e.name === input) ?? list.find((e) => e.name.toLowerCase() === input.toLowerCase());
  if (exact) return exact;
  const pre = list.filter((e) => e.name.toLowerCase().startsWith(input.toLowerCase()));
  if (pre.length === 1) return pre[0]!;
  if (pre.length > 1) throw new CliError(`"${input}" matches more than one environment: ${pre.map((e) => e.name).join(", ")}.`, "Type more of the name.");
  throw new CliError(`No environment named "${input}" (or you do not have access to it).`, list.length ? `Available: ${list.map((e) => e.name).join(", ")}` : undefined);
}

async function resolveEnv(io: IO, p: Parsed): Promise<{ api: Api; link: ReturnType<typeof requireLink>; env: EnvInfo; dir: string }> {
  const link = requireLink(io);
  const a = api(io);
  const list = await envs(a, link.link.projectId);
  const env = matchEnv(list, str(p.flags.env) ?? link.link.environment);
  return { api: a, link, env, dir: link.dir };
}

const fileOf = (io: IO, dir: string, p: Parsed, fallback = ".env") => {
  const f = str(p.flags.file) ?? str(p.flags.out);
  return f ? resolve(io.cwd, f) : join(dir, fallback);
};

function gitignoreCovers(dir: string, name: string): boolean | null {
  if (!existsSync(join(dir, ".git"))) return null;
  try {
    const lines = readFileSync(join(dir, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    return lines.some((l) => l === name || l === `/${name}` || l === ".env*" || l === ".env.*" || l === "*.env");
  } catch { return false; }
}

// ---------------------------------------------------------------- auth
/** Two-step verification: authenticator code, recovery code, or an emailed code. Returns the session token. */
async function secondStep(base: Api, io: IO, p: Parsed, first: { challenge: string; methods: string[]; emailHint?: string | null }): Promise<string> {
  let method = str(p.flags.method) ?? "totp";
  let code = str(p.flags.code);
  if (!first.methods.includes(method)) throw new CliError(`The method "${method}" is not available for this account.`, `Available: ${first.methods.join(", ")}`);
  const sendEmail = async () => {
    const r = await base.post("/auth/2fa/email", { challenge: first.challenge });
    io.out(`A sign-in code was sent to ${r.to}. It expires in ${r.expiresInMinutes} minutes.`);
  };
  const interactive = io.isTTY;
  if (!code && !interactive && method !== "email") {
    throw new CliError("Two-step verification is on for this account.", "Pass --code <authenticator code>, or --method recovery --code <recovery code>.");
  }
  if (!code && !interactive) throw new CliError("Email codes need an interactive terminal.", "Use --code with an authenticator or recovery code instead.");
  if (method === "email") await sendEmail();
  const labels: Record<string, string> = { totp: "Authenticator code: ", email: "Code from your email: ", recovery: "Recovery code: " };
  if (!code) io.out(`Two-step verification is on.${first.methods.includes("email") ? ' Type "email" to get a code by email,' : " Type"} "recovery" to use a recovery code.`);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!code) {
      const answer = (await io.ask(labels[method]!, { secret: false }))?.trim();
      if (!answer) throw new CliError("No code entered.");
      if (answer === "email" && first.methods.includes("email")) { method = "email"; await sendEmail(); continue; }
      if (answer === "recovery") { method = "recovery"; continue; }
      code = answer;
    }
    try {
      const r = await base.post("/auth/2fa/verify", { challenge: first.challenge, method, code });
      if (typeof r.recoveryCodesRemaining === "number") io.out(`Recovery code used. ${r.recoveryCodesRemaining} left.`);
      return r.token as string;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || !interactive || e.apiCode !== "invalid_code" || /Too many/.test(e.message)) throw e;
      io.err(e.message);
      code = undefined;
    }
  }
  throw new CliError("Too many attempts.");
}

export const login: Cmd = async (p, io) => {
  const saved = readCredentials(io);
  const server = (str(p.flags.server) ?? (await io.ask(`Server URL [${saved.server ?? "http://localhost:8080"}]: `)) ?? "").trim() || saved.server || "http://localhost:8080";
  const base = new Api(server);
  let token = str(p.flags.token);
  if (!token) {
    const email = await ask(io, "Email: ", str(p.flags.email) ?? io.env.SECRETVARIABLE_EMAIL);
    const password = await ask(io, "Password: ", str(p.flags.password) ?? io.env.SECRETVARIABLE_PASSWORD, true);
    const first = await base.post("/auth/login", { email, password, name: `cli ${hostname()}`.slice(0, 60) });
    const sessionToken: string = first.mfaRequired ? await secondStep(base, io, p, first) : first.token;
    // exchange the short-lived session for a long-lived personal token
    const authed = new Api(server, sessionToken);
    const t = await authed.post("/tokens", { name: `cli on ${hostname()}`.slice(0, 80), kind: "personal", access: "write", expiresInDays: 90 });
    await authed.post("/auth/logout").catch(() => {});
    token = t.token as string;
  }
  const me = await new Api(server, token).get("/me");
  saveCredentials(io, { server: server.replace(/\/+$/, ""), token });
  io.out(`Signed in as ${me.user.name} <${me.user.email}> on ${server}`);
};

export const logout: Cmd = async (_p, io) => {
  clearCredentials(io);
  io.out("Signed out on this machine. The token stays valid on the server until it expires; revoke it with `secretvariable token revoke <id>` or in the web app.");
};

export const whoami: Cmd = async (_p, io) => {
  const c = requireCredentials(io);
  const me = await Api.from(c).get("/me");
  io.out(`${me.user.name} <${me.user.email}>\nServer: ${c.server}`);
  const l = findLink(io);
  if (l) io.out(`Project: ${l.link.projectName} (environment: ${l.link.environment})`);
};

// ---------------------------------------------------------------- projects
export const projects: Cmd = async (_p, io) => {
  const a = api(io);
  const { orgs } = await a.get("/orgs");
  const rows: string[][] = [];
  for (const o of orgs) {
    const { projects } = await a.get(`/orgs/${o.id}/projects`);
    for (const pr of projects) rows.push([o.slug, pr.name, pr.role, String(pr.environmentCount)]);
  }
  io.out(rows.length ? table(rows, ["ORG", "PROJECT", "ROLE", "ENVS"]) : "No projects yet. Create one with: secretvariable init --create");
};

export const init: Cmd = async (p, io) => {
  const a = api(io);
  const existing = findLink({ ...io, cwd: io.cwd });
  if (existing && existing.dir === resolve(io.cwd) && !p.flags.force) {
    throw new CliError(`Already linked to "${existing.link.projectName}".`, "Use --force to relink.");
  }
  const { orgs } = await a.get("/orgs");
  if (!orgs.length) throw new CliError("You do not belong to any organisation.");
  const orgFlag = str(p.flags.org);
  const want = str(p.flags.project);
  const byFlag = (o: any) => o.slug === orgFlag || o.name === orgFlag || o.id === orgFlag;
  if (orgFlag && !orgs.some(byFlag)) throw new CliError(`Organisation "${orgFlag}" not found.`, `Yours: ${orgs.map((o: any) => o.slug).join(", ")}`);
  let org: any;
  let project: any;
  if (want && !orgFlag && !p.flags.create) {
    // find the project across all of the user's organisations
    const hits: { org: any; project: any }[] = [];
    for (const o of orgs) {
      const { projects } = await a.get(`/orgs/${o.id}/projects`);
      for (const x of projects) if (x.name === want || x.slug === want || x.id === want) hits.push({ org: o, project: x });
    }
    if (hits.length > 1) throw new CliError(`More than one project is named "${want}".`, "Pass --org to choose: " + hits.map((h) => h.org.slug).join(", "));
    if (!hits.length) throw new CliError(`Project "${want}" not found.`, "Create it with: secretvariable init --create --project <name>");
    ({ org, project } = hits[0]!);
  } else {
    org = orgFlag ? orgs.find(byFlag) : await choose(io, "Organisation:", orgs, (o: any) => `${o.name} (${o.slug})`);
    const { projects } = await a.get(`/orgs/${org.id}/projects`);
    if (p.flags.create) {
      const name = await ask(io, "New project name: ", want);
      project = (await a.post(`/orgs/${org.id}/projects`, { name })).project;
      io.out(`Created project "${project.name}" with environments development, staging, production.`);
    } else if (want) {
      project = projects.find((x: any) => x.name === want || x.slug === want || x.id === want);
      if (!project) throw new CliError(`Project "${want}" not found in ${org.name}.`, "Create it with: secretvariable init --create --project <name>");
    } else {
      if (!projects.length) throw new CliError(`${org.name} has no projects.`, "Create one with: secretvariable init --create --project <name>");
      project = await choose(io, "Project:", projects, (x: any) => x.name);
    }
  }
  const list = await envs(a, project.id);
  const envName = str(p.flags.env) ?? (list.find((e) => e.name === "development") ?? list[0])?.name;
  if (!envName) throw new CliError("This project has no environments you can access.");
  writeLink(resolve(io.cwd), { projectId: project.id, projectName: project.name, orgName: org.name, environment: envName });
  io.out(`Linked ${resolve(io.cwd)} to "${project.name}" (environment: ${envName}).`);
  if (gitignoreCovers(resolve(io.cwd), ".env") === false) io.out(style(io).yellow("Warning: .env is not in .gitignore. Add it so secrets are not committed."));
};

// ---------------------------------------------------------------- environments
const PROD = /^(prod|production)$/i;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const keyList = (keys: string[]) => (keys.length > 8 ? `${keys.slice(0, 8).join(", ")} and ${keys.length - 8} more` : keys.join(", "));

/** Write an env file with owner-only permissions and remember what was written, so a later switch or pull can tell it is untouched. */
function writeEnvFile(io: IO, dir: string, file: string, text: string, environment: string, version: number | null): void {
  writeFileSync(file, text, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  const created = remember(dir, file, text, environment, version);
  if (created && gitignoreCovers(dir, STATE_FILE) === false) io.out(style(io).dim(`Tip: add ${STATE_FILE} to .gitignore. It only holds a fingerprint of your env file, but it is local to your machine.`));
}

/** Keep a private copy of a file that is about to be replaced. */
function backUp(io: IO, file: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const path = `${file}.backup-${stamp}`;
  writeFileSync(path, readFileSync(file), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  io.out(`Saved your local copy to ${path} (owner-only; delete it when you no longer need it).`);
  return path;
}

export const envCmd: Cmd = async (p, io) => {
  const [sub, name] = p.positionals;
  const { link, dir } = requireLink(io);
  const a = api(io);
  const list = await envs(a, link.projectId);
  const s = style(io);
  if (!sub || sub === "list") {
    io.out(`Project: ${s.bold(link.projectName)}${link.orgName ? ` (${link.orgName})` : ""}\nUsing:   ${s.bold(link.environment)}\n`);
    io.out(table(list.map((e) => [e.name === link.environment ? "*" : " ", e.name, e.headNumber ? `v${e.headNumber}` : "-", String(e.variableCount), e.access]), ["", "ENVIRONMENT", "VERSION", "VARS", "ACCESS"]));
    return;
  }
  if (!name) throw new CliError(`Usage: secretvariable env ${sub} <name>`);
  if (sub === "use") return useEnv(p, io, { api: a, link, dir, list, input: name, s });
  if (sub === "create") {
    let copyFromVersionId: string | undefined;
    const from = str(p.flags.from);
    if (from) {
      const [srcName, num] = from.split("@");
      const src = list.find((e) => e.name === srcName);
      if (!src) throw new CliError(`No environment named "${srcName}".`);
      const vs = (await a.get(`/environments/${src.id}/versions`)).versions as any[];
      const v = num ? vs.find((x) => x.number === Number(num.replace(/^v/, ""))) : vs[0];
      if (!v) throw new CliError("Source version not found.");
      copyFromVersionId = v.id;
    }
    await a.post(`/projects/${link.projectId}/environments`, { name, copyFromVersionId });
    io.out(`Created environment "${name}"${from ? ` (copied from ${from})` : ""}.`);
    return;
  }
  throw new CliError(`Unknown subcommand "env ${sub}".`, "Use: env list | env use <name> | env create <name> [--from <env>[@version]]");
};

/**
 * Switch the folder to another environment and bring the env file along.
 * The file is only replaced when nothing is lost: it is untouched since the last pull or push, or it holds
 * nothing the current environment does not already have. Otherwise you choose: back it up, discard it, or cancel.
 */
async function useEnv(p: Parsed, io: IO, c: { api: Api; link: ProjectLink; dir: string; list: EnvInfo[]; input: string; s: ReturnType<typeof style> }): Promise<void> {
  const { api: a, link, dir, list, s } = c;
  let input = c.input;
  if (input === "-") {
    const prev = previousEnvironment(dir);
    if (!prev) throw new CliError("There is no previous environment to go back to.", "Use: env use <name>");
    input = prev;
  }
  const target = matchEnv(list, input);
  const where = `${link.projectName} / ${target.name}`;
  if (target.name === link.environment) { io.out(`Already using ${s.bold(target.name)} in ${link.projectName}.`); return; }

  const file = fileOf(io, dir, p);
  let pullInto: string | null = null;
  if (!p.flags["no-pull"] && existsSync(file)) {
    const text = readFileSync(file, "utf8");
    let lost: string[] = [];
    if (!isUntouched(dir, file, text)) {
      const current = list.find((e) => e.name === link.environment);
      const base = current ? await remoteHead(a, current) : {};
      const d = diffEnv(base, parseEnv(text));
      lost = [...d.changed, ...d.added];
    }
    if (lost.length) {
      if (p.flags.discard) io.out(s.yellow(`Discarding ${plural(lost.length, "local change")} in ${basename(file)}.`));
      else if (p.flags.backup) backUp(io, file);
      else if (io.isTTY) {
        io.out(`${basename(file)} has ${plural(lost.length, "change")} that ${link.environment} does not have: ${keyList(lost)}.`);
        const ans = ((await io.ask("Back them up and switch [b], discard and switch [d], or cancel [c]? ")) ?? "").trim().toLowerCase();
        if (ans.startsWith("b")) backUp(io, file);
        else if (ans.startsWith("d")) io.out(s.yellow("Discarding your local changes."));
        else throw new CliError("Cancelled. Nothing was changed.", "Use `push` to save your changes first.");
      } else {
        throw new CliError(`${basename(file)} has ${plural(lost.length, "change")} that would be lost: ${keyList(lost)}.`,
          "Run `push` to save them, or pass --backup (keep a copy) or --discard (drop them), or --no-pull to switch without touching the file.");
      }
    }
    pullInto = file;
  }

  let version: number | null = null;
  let count = 0;
  if (pullInto) {
    const vars: EnvMap = target.headNumber ? (await a.get(`/environments/${target.id}/versions/head`)).variables : {};
    version = target.headNumber;
    count = Object.keys(vars).length;
    writeEnvFile(io, dir, pullInto, serializeEnv(vars), target.name, version);
  }
  setPrevious(dir, link.environment);
  writeLink(dir, { ...link, environment: target.name });

  const rel = pullInto ? relative(io.cwd, pullInto) || basename(pullInto) : "";
  if (pullInto) io.out(`Now using ${s.bold(where)}${version ? ` (v${version})` : ""}. Wrote ${plural(count, "variable")} to ${rel}.`);
  else if (p.flags["no-pull"]) io.out(`Now using ${s.bold(where)}. Your env file was left as it was.`);
  else io.out(`Now using ${s.bold(where)}. There is no ${basename(file)} here yet; run \`secretvariable pull\` to create one.`);
  if (PROD.test(target.name)) io.out(s.yellow(`You are on ${target.name}. Check ${basename(file)} before you push.`));
  if (pullInto && gitignoreCovers(dir, ".env") === false) io.out(s.yellow("Warning: .env is not in .gitignore."));
}

// ---------------------------------------------------------------- pull / push / run
export const pull: Cmd = async (p, io) => {
  const { api: a, env, dir, link } = await resolveEnv(io, p);
  const ver = str(p.flags.version);
  const r = await a.get(`/environments/${env.id}/versions/${ver ? ver.replace(/^v/, "") : "head"}`);
  const file = fileOf(io, dir, p);
  const vars: EnvMap = r.variables;
  const text = serializeEnv(vars);
  if (existsSync(file) && !p.flags.force) {
    const local = readFileSync(file, "utf8");
    // Untouched since the last pull or push: replacing it loses nothing, even if the server has moved on.
    if (!isUntouched(dir, file, local)) {
      const d = diffEnv(vars, parseEnv(local));
      const differing = [...d.changed, ...d.added];
      if (differing.length) {
        if (p.flags.backup) backUp(io, file);
        else throw new CliError(`${file} has local changes that would be overwritten (${differing.length} differing keys: ${keyList(differing)}).`,
          "Run `secretvariable status` to see them, `secretvariable push` to save them, or use --backup (keep a copy) or --force (overwrite).");
      }
    }
  }
  writeEnvFile(io, dir, file, text, env.name, r.version.number);
  io.out(`Wrote ${Object.keys(vars).length} variables from ${env.name} v${r.version.number} to ${file} (project: ${link.link.projectName})`);
  if (gitignoreCovers(dir, ".env") === false) io.out(style(io).yellow("Warning: .env is not in .gitignore."));
};

async function remoteHead(a: Api, env: EnvInfo): Promise<EnvMap> {
  if (!env.headNumber) return {};
  return (await a.get(`/environments/${env.id}/versions/head`)).variables;
}

export const push: Cmd = async (p, io) => {
  const { api: a, env, dir, link } = await resolveEnv(io, p);
  const file = fileOf(io, dir, p);
  if (!existsSync(file)) throw new CliError(`${file} does not exist.`);
  const text = readFileSync(file, "utf8");
  const local = parseEnv(text);
  const remote = await remoteHead(a, env);
  const d = diffEnv(remote, local);
  if (!d.added.length && !d.changed.length && !d.removed.length) {
    remember(dir, file, text, env.name, env.headNumber);
    io.out(`No changes. ${env.name} is already at v${env.headNumber}.`);
    return;
  }
  io.out(`${style(io).dim(`${link.link.projectName} / ${env.name}`)}\n${summary(io, d)}`);
  if (d.removed.length && !p.flags.yes) {
    const ans = await io.ask(`This removes ${d.removed.length} variable(s) from ${env.name}. Continue? [y/N] `);
    if (ans === null) throw new CliError("Refusing to remove variables without confirmation.", "Re-run with --yes.");
    if (!/^y(es)?$/i.test(ans.trim())) throw new CliError("Cancelled.");
  }
  if (PROD.test(env.name) && io.isTTY && !p.flags.yes) {
    const ans = await io.ask(`Push these changes to ${style(io).bold(`${link.link.projectName} / ${env.name}`)}? [y/N] `);
    if (!/^y(es)?$/i.test((ans ?? "").trim())) throw new CliError("Cancelled. Nothing was pushed.");
  }
  const r = await a.post(`/environments/${env.id}/versions`, { variables: local, message: str(p.flags.message) ?? "" });
  remember(dir, file, text, env.name, r.version.number);
  io.out(`Pushed to ${env.name} as v${r.version.number} (project: ${link.link.projectName}).`);
};

function summary(io: IO, d: ReturnType<typeof diffEnv>): string {
  const s = style(io);
  return [...d.added.map((k) => s.green(`+ ${k}`)), ...d.changed.map((k) => s.yellow(`~ ${k}`)), ...d.removed.map((k) => s.red(`- ${k}`))].join("\n");
}

export const status: Cmd = async (p, io) => {
  const { api: a, env, dir, link } = await resolveEnv(io, p);
  const file = fileOf(io, dir, p);
  if (!existsSync(file)) { io.out(`${file} does not exist. Run: secretvariable pull`); return; }
  const d = diffEnv(await remoteHead(a, env), parseEnv(readFileSync(file, "utf8")));
  if (!d.added.length && !d.changed.length && !d.removed.length) { io.out(`${env.name}: ${file} matches v${env.headNumber ?? 0} (project: ${link.link.projectName}).`); return; }
  io.out(`${link.link.projectName} / ${env.name} (v${env.headNumber ?? 0}) vs ${file}:\n  + only local, ~ differs, - only on server`);
  io.out(summary(io, d));
};

export const run: Cmd = async (p, io) => {
  if (!p.rest.length) throw new CliError("Usage: secretvariable run [--env name] -- <command> [args]");
  const { api: a, env } = await resolveEnv(io, p);
  const r = await a.get(`/environments/${env.id}/versions/head`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) throw new CliError(`${env.name} has no variables yet.`);
    throw e;
  });
  const code = await new Promise<number>((res, rej) => {
    const child = spawn(p.rest[0]!, p.rest.slice(1), { stdio: "inherit", env: { ...io.env, ...r.variables }, cwd: io.cwd });
    child.on("error", (e) => rej(new CliError(`Cannot run "${p.rest[0]}": ${e.message}`)));
    child.on("exit", (c, sig) => res(c ?? (sig ? 128 : 1)));
  });
  if (code !== 0) throw new CliError("", undefined, code);
};

// ---------------------------------------------------------------- history
export const log: Cmd = async (p, io) => {
  const { api: a, env } = await resolveEnv(io, p);
  const vs = (await a.get(`/environments/${env.id}/versions`)).versions as any[];
  if (!vs.length) { io.out(`${env.name} has no versions yet. Push one with: secretvariable push`); return; }
  io.out(table(vs.map((v, i) => [`v${v.number}${i === 0 ? " (head)" : ""}`, new Date(v.createdAt).toISOString().slice(0, 16).replace("T", " "), v.authorName ?? "-", String(v.variableCount), v.message || "-"]), ["VERSION", "WHEN (UTC)", "AUTHOR", "VARS", "MESSAGE"]));
};

export const diff: Cmd = async (p, io) => {
  const [from, to] = p.positionals.map((x) => Number(x.replace(/^v/, "")));
  if (!from || !to) throw new CliError("Usage: secretvariable diff <from> <to> [--reveal]");
  const { api: a, env } = await resolveEnv(io, p);
  const d = await a.get(`/environments/${env.id}/diff?from=${from}&to=${to}${p.flags.reveal ? "&reveal=1" : ""}`);
  const s = style(io);
  const lines: string[] = [];
  for (const x of d.added) lines.push(s.green(`+ ${x.key}${x.new !== undefined ? `=${x.new}` : ""}`));
  for (const x of d.changed) lines.push(s.yellow(`~ ${x.key}${x.new !== undefined ? `: ${x.old} -> ${x.new}` : ""}`));
  for (const x of d.removed) lines.push(s.red(`- ${x.key}${x.old !== undefined ? `=${x.old}` : ""}`));
  io.out(lines.length ? lines.join("\n") : "No differences.");
  io.out(s.dim(`${d.unchangedCount} unchanged`));
};

export const rollback: Cmd = async (p, io) => {
  const n = Number((p.positionals[0] ?? "").replace(/^v/, ""));
  if (!n) throw new CliError("Usage: secretvariable rollback <version>");
  const { api: a, env } = await resolveEnv(io, p);
  const r = await a.post(`/environments/${env.id}/rollback`, { number: n });
  io.out(r.unchanged ? `${env.name} already matches v${n}.` : `Rolled ${env.name} back to v${n} as new version v${r.version.number}.`);
};

// ---------------------------------------------------------------- team
export const invite: Cmd = async (p, io) => {
  const email = p.positionals[0];
  if (!email) throw new CliError("Usage: secretvariable invite <email> [--role viewer|editor|admin] [--envs dev,staging --access read|write] [--expires 1-30 days] [--send-email]");
  const link = requireLink(io).link;
  const a = api(io);
  const role = str(p.flags.role) ?? "viewer";
  const names = str(p.flags.envs)?.split(",").map((x) => x.trim()).filter(Boolean);
  let body: any = { email, role, scope: "all" };
  if (names?.length) {
    const list = await envs(a, link.projectId);
    const grants = names.map((n) => {
      const e = list.find((x) => x.name === n);
      if (!e) throw new CliError(`No environment named "${n}".`);
      return { environmentId: e.id, access: str(p.flags.access) ?? (role === "viewer" ? "read" : "write") };
    });
    body = { ...body, scope: "selected", grants };
  }
  const days = str(p.flags.expires) ? Number(str(p.flags.expires)) : undefined;
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 30)) throw new CliError("--expires must be a whole number of days from 1 to 30.");
  if (days) body = { ...body, expiresInDays: days };
  const sendEmail = p.flags["send-email"] === true;
  if (sendEmail) body = { ...body, sendEmail: true };
  const r = await a.post(`/projects/${link.projectId}/invites`, body);
  const server = requireCredentials(io).server;
  const who = `${email} as ${role}${names?.length ? ` (only: ${names.join(", ")})` : ""}`;
  const share = `Share this link (expires ${r.invite.expiresAt.slice(0, 10)}):\n  ${server}/invite/${r.token}\nOr they can run: secretvariable accept ${r.token}`;
  if (sendEmail && r.emailed) io.out(`Invited ${who}. The invitation was emailed to ${email}.\nThe link, in case you want it as well (expires ${r.invite.expiresAt.slice(0, 10)}):\n  ${server}/invite/${r.token}`);
  else if (sendEmail) io.out(`Invited ${who}, but the email could not be sent (${r.emailError ?? "unknown error"}).\n${share}`);
  else io.out(`Invited ${who}.\n${share}`);
};

export const accept: Cmd = async (p, io) => {
  const token = p.positionals[0];
  if (!token) throw new CliError("Usage: secretvariable accept <invite-token>");
  const r = await api(io).post("/invites/accept", { token });
  io.out(`You joined "${r.project.name}". Run \`secretvariable init\` in your project folder to link it.`);
};

export const members: Cmd = async (_p, io) => {
  const link = requireLink(io).link;
  const a = api(io);
  const list = await envs(a, link.projectId);
  const names = new Map(list.map((e) => [e.id, e.name]));
  const m = (await a.get(`/projects/${link.projectId}/members`)).members as any[];
  io.out(table(m.map((x) => [x.name, x.email, x.role + (x.viaOrg ? " (org)" : ""), x.scope === "all" ? "all" : x.grants.map((g: any) => `${names.get(g.environmentId) ?? "?"}:${g.access}`).join(",") || "none"]), ["NAME", "EMAIL", "ROLE", "ENVIRONMENTS"]));
};

export const tokenCmd: Cmd = async (p, io) => {
  const [sub, arg] = p.positionals;
  const a = api(io);
  if (sub === "create") {
    const link = findLink(io)?.link;
    const projectId = str(p.flags.project) ?? link?.projectId;
    let environmentId: string | undefined;
    const en = str(p.flags.env);
    if (en) {
      if (!projectId) throw new CliError("--env needs a linked project.");
      environmentId = (await envs(a, projectId)).find((e) => e.name === en)?.id;
      if (!environmentId) throw new CliError(`No environment named "${en}".`);
    }
    const kind = projectId ? "service" : "personal";
    const r = await a.post("/tokens", { name: str(p.flags.name) ?? "cli-created", kind, projectId, environmentId, access: str(p.flags.access) ?? "read", expiresInDays: p.flags.expires ? Number(str(p.flags.expires)) : undefined });
    io.out(`${kind} token (shown once, store it securely):\n${r.token}\n\nUse it in CI as SECRETVARIABLE_TOKEN with SECRETVARIABLE_URL=${requireCredentials(io).server}`);
  } else if (sub === "list" || !sub) {
    const t = (await a.get("/tokens")).tokens as any[];
    io.out(t.length ? table(t.map((x) => [x.id.slice(0, 8), x.kind, x.name, x.access, x.projectName ?? "-", x.environmentName ?? "-", x.expiresAt ? x.expiresAt.slice(0, 10) : "never"]), ["ID", "KIND", "NAME", "ACCESS", "PROJECT", "ENV", "EXPIRES"]) : "No tokens.");
  } else if (sub === "revoke") {
    if (!arg) throw new CliError("Usage: secretvariable token revoke <id>");
    const t = (await a.get("/tokens")).tokens as any[];
    const m = t.find((x) => x.id === arg || x.id.startsWith(arg));
    if (!m) throw new CliError("Token not found.");
    await a.del(`/tokens/${m.id}`);
    io.out(`Revoked token "${m.name}".`);
  } else throw new CliError(`Unknown subcommand "token ${sub}".`, "Use: token create | token list | token revoke <id>");
};

export { LINK_FILE };
