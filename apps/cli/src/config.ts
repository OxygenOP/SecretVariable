import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { IO } from "./io.js";
import { CliError } from "./io.js";

export interface Credentials { server: string; token: string }
export interface ProjectLink { server?: string; projectId: string; projectName: string; orgName?: string; environment: string }

export const LINK_FILE = ".secretvariable.json";

function configPath(io: IO): string {
  const dir = io.env.SECRETVARIABLE_CONFIG_DIR ?? join(io.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "secretvariable");
  return join(dir, "config.json");
}

export function readCredentials(io: IO): Partial<Credentials> {
  let saved: Partial<Credentials> = {};
  try { saved = JSON.parse(readFileSync(configPath(io), "utf8")); } catch { /* none yet */ }
  return {
    server: io.env.SECRETVARIABLE_URL ?? saved.server,
    token: io.env.SECRETVARIABLE_TOKEN ?? saved.token,
  };
}

export function saveCredentials(io: IO, c: Credentials): void {
  const p = configPath(io);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  chmodSync(p, 0o600);
}

export function clearCredentials(io: IO): void {
  const p = configPath(io);
  if (existsSync(p)) writeFileSync(p, "{}\n", { mode: 0o600 });
}

export function requireCredentials(io: IO): Credentials {
  const c = readCredentials(io);
  if (!c.server || !c.token) throw new CliError("You are not signed in.", "Run: secretvariable login");
  return { server: c.server.replace(/\/+$/, ""), token: c.token };
}

/** Find .secretvariable.json in cwd or any parent directory. */
export function findLink(io: IO): { link: ProjectLink; dir: string } | null {
  let dir = resolve(io.cwd);
  for (;;) {
    const f = join(dir, LINK_FILE);
    if (existsSync(f)) {
      try { return { link: JSON.parse(readFileSync(f, "utf8")), dir }; }
      catch { throw new CliError(`${f} is not valid JSON`); }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function requireLink(io: IO): { link: ProjectLink; dir: string } {
  const l = findLink(io);
  if (!l) throw new CliError("This folder is not linked to a project.", "Run: secretvariable init");
  return l;
}

export function writeLink(dir: string, link: ProjectLink): void {
  writeFileSync(join(dir, LINK_FILE), JSON.stringify(link, null, 2) + "\n");
}
