import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { diffEnv, parseEnv, serializeEnv, type EnvMap } from "@secretvariable/shared";
import { Api, ApiError } from "./api.js";
import type { Parsed } from "./args.js";
import { str } from "./args.js";
import { clearCredentials, findLink, readCredentials, requireCredentials, requireLink, saveCredentials, writeLink, LINK_FILE } from "./config.js";
import { CliError, style, table, type IO } from "./io.js";

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

async function resolveEnv(io: IO, p: Parsed): Promise<{ api: Api; link: ReturnType<typeof requireLink>; env: EnvInfo; dir: string }> {
  const link = requireLink(io);
  const a = api(io);
  const list = await envs(a, link.link.projectId);
  const name = str(p.flags.env) ?? link.link.environment;
  const env = list.find((e) => e.name === name);
  if (!env) {
    throw new CliError(`No environment named "${name}" (or you do not have access to it).`,
      list.length ? `Available: ${list.map((e) => e.name).join(", ")}` : undefined);
  }
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
export const login: Cmd = async (p, io) => {
  const saved = readCredentials(io);
  const server = (str(p.flags.server) ?? (await io.ask(`Server URL [${saved.server ?? "http://localhost:8080"}]: `)) ?? "").trim() || saved.server || "http://localhost:8080";
  const base = new Api(server);
  let token = str(p.flags.token);
  if (!token) {
    const email = await ask(io, "Email: ", str(p.flags.email) ?? io.env.SECRETVARIABLE_EMAIL);
    const password = await ask(io, "Password: ", str(p.flags.password) ?? io.env.SECRETVARIABLE_PASSWORD, true);
    const session = await base.post("/auth/login", { email, password, name: `cli ${hostname()}`.slice(0, 60) });
    // exchange the short-lived session for a long-lived personal token
    const authed = new Api(server, session.token);
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
export const envCmd: Cmd = async (p, io) => {
  const [sub, name] = p.positionals;
  const { link, dir } = requireLink(io);
  const a = api(io);
  const list = await envs(a, link.projectId);
  if (!sub || sub === "list") {
    io.out(table(list.map((e) => [e.name === link.environment ? "*" : " ", e.name, e.headNumber ? `v${e.headNumber}` : "-", String(e.variableCount), e.access]), ["", "ENVIRONMENT", "VERSION", "VARS", "ACCESS"]));
    return;
  }
  if (!name) throw new CliError(`Usage: secretvariable env ${sub} <name>`);
  if (sub === "use") {
    if (!list.some((e) => e.name === name)) throw new CliError(`No environment named "${name}".`, `Available: ${list.map((e) => e.name).join(", ")}`);
    writeLink(dir, { ...link, environment: name });
    io.out(`Now using environment "${name}".`);
  } else if (sub === "create") {
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
  } else throw new CliError(`Unknown subcommand "env ${sub}".`, "Use: env list | env use <name> | env create <name> [--from <env>[@version]]");
};

// ---------------------------------------------------------------- pull / push / run
export const pull: Cmd = async (p, io) => {
  const { api: a, env, dir } = await resolveEnv(io, p);
  const ver = str(p.flags.version);
  const r = await a.get(`/environments/${env.id}/versions/${ver ? ver.replace(/^v/, "") : "head"}`);
  const file = fileOf(io, dir, p);
  const vars: EnvMap = r.variables;
  const text = serializeEnv(vars);
  if (existsSync(file) && !p.flags.force) {
    const local = parseEnv(readFileSync(file, "utf8"));
    const d = diffEnv(vars, local);
    if (d.added.length || d.changed.length) {
      throw new CliError(`${file} has local changes that would be overwritten (${[...d.changed, ...d.added].length} differing keys).`,
        "Run `secretvariable status` to see them, `secretvariable push` to save them, or use --force to overwrite.");
    }
  }
  writeFileSync(file, text, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  io.out(`Wrote ${Object.keys(vars).length} variables from ${env.name} v${r.version.number} to ${file}`);
  if (gitignoreCovers(dir, ".env") === false) io.out(style(io).yellow("Warning: .env is not in .gitignore."));
};

async function remoteHead(a: Api, env: EnvInfo): Promise<EnvMap> {
  if (!env.headNumber) return {};
  return (await a.get(`/environments/${env.id}/versions/head`)).variables;
}

export const push: Cmd = async (p, io) => {
  const { api: a, env, dir } = await resolveEnv(io, p);
  const file = fileOf(io, dir, p);
  if (!existsSync(file)) throw new CliError(`${file} does not exist.`);
  const local = parseEnv(readFileSync(file, "utf8"));
  const remote = await remoteHead(a, env);
  const d = diffEnv(remote, local);
  if (!d.added.length && !d.changed.length && !d.removed.length) { io.out(`No changes. ${env.name} is already at v${env.headNumber}.`); return; }
  io.out(summary(io, d));
  if (d.removed.length && !p.flags.yes) {
    const ans = await io.ask(`This removes ${d.removed.length} variable(s) from ${env.name}. Continue? [y/N] `);
    if (ans === null) throw new CliError("Refusing to remove variables without confirmation.", "Re-run with --yes.");
    if (!/^y(es)?$/i.test(ans.trim())) throw new CliError("Cancelled.");
  }
  const r = await a.post(`/environments/${env.id}/versions`, { variables: local, message: str(p.flags.message) ?? "" });
  io.out(`Pushed to ${env.name} as v${r.version.number}.`);
};

function summary(io: IO, d: ReturnType<typeof diffEnv>): string {
  const s = style(io);
  return [...d.added.map((k) => s.green(`+ ${k}`)), ...d.changed.map((k) => s.yellow(`~ ${k}`)), ...d.removed.map((k) => s.red(`- ${k}`))].join("\n");
}

export const status: Cmd = async (p, io) => {
  const { api: a, env, dir } = await resolveEnv(io, p);
  const file = fileOf(io, dir, p);
  if (!existsSync(file)) { io.out(`${file} does not exist. Run: secretvariable pull`); return; }
  const d = diffEnv(await remoteHead(a, env), parseEnv(readFileSync(file, "utf8")));
  if (!d.added.length && !d.changed.length && !d.removed.length) { io.out(`${env.name}: ${file} matches v${env.headNumber ?? 0}.`); return; }
  io.out(`${env.name} (v${env.headNumber ?? 0}) vs ${file}:\n  + only local, ~ differs, - only on server`);
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
  if (!email) throw new CliError("Usage: secretvariable invite <email> [--role viewer|editor|admin] [--envs dev,staging --access read|write]");
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
  const r = await a.post(`/projects/${link.projectId}/invites`, body);
  const server = requireCredentials(io).server;
  io.out(`Invited ${email} as ${role}${names?.length ? ` (only: ${names.join(", ")})` : ""}.\nShare this link (expires ${r.invite.expiresAt.slice(0, 10)}):\n  ${server}/invite/${r.token}\nOr they can run: secretvariable accept ${r.token}`);
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
