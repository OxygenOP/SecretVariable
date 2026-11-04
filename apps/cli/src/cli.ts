import * as c from "./commands.js";
import { parseArgs } from "./args.js";
import { CliError, type IO } from "./io.js";

export const VERSION = "0.1.0";

const HELP = `secretvariable ${VERSION}: store and sync .env files

Usage: secretvariable <command> [options]

Account
  login [--server URL] [--email E --password P | --token T]
  logout                        forget local credentials
  whoami

Project
  projects                      list projects you can access
  init [--org O] [--project P | --create] [--env NAME]
  env list | use <name> | create <name> [--from env[@version]]

Sync
  pull  [--env E] [--version N] [--file .env] [--force]
  push  [--env E] [--file .env] [-m "message"] [--yes]
  status [--env E]              compare local file with the server
  run   [--env E] -- <command>  run a command with variables injected (nothing written to disk)

History
  log [--env E]
  diff <from> <to> [--reveal]
  rollback <version>

Team
  invite <email> [--role viewer|editor|admin] [--envs a,b --access read|write]
  accept <invite-token>
  members
  token create [--name N --env E --access read|write --expires DAYS] | token list | token revoke <id>

Short name: "secvar" is the same command (secvar pull, secvar push, secvar run -- ...).

Environment variables: SECRETVARIABLE_URL, SECRETVARIABLE_TOKEN (for CI)
`;

const commands: Record<string, (p: ReturnType<typeof parseArgs>, io: IO) => Promise<void>> = {
  login: c.login, logout: c.logout, whoami: c.whoami, projects: c.projects, init: c.init, env: c.envCmd,
  pull: c.pull, push: c.push, status: c.status, run: c.run, log: c.log, diff: c.diff, rollback: c.rollback,
  invite: c.invite, accept: c.accept, members: c.members, token: c.tokenCmd,
};

/** Returns the process exit code. */
// Rewrites "secretvariable <word>" command references to the short name when started as `secvar`.
const short = (s: string) => s.replace(/(?<![@.\w/-])secretvariable (?=[a-z0-9<`-])/g, "secvar ");

export async function main(argv: string[], real: IO): Promise<number> {
  const io: IO = real.prog === "secvar" ? { ...real, out: (s) => real.out(short(s)), err: (s) => real.err(short(s)) } : real;
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") { io.out(HELP); return name ? 0 : 1; }
  if (name === "--version" || name === "-v" || name === "version") { io.out(VERSION); return 0; }
  const cmd = commands[name];
  if (!cmd) { io.err(`Unknown command "${name}". Run: secretvariable help`); return 1; }
  try {
    const parsed = parseArgs(rest);
    if (parsed.flags.help) { io.out(HELP); return 0; }
    await cmd(parsed, io);
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      if (e.message) io.err(`Error: ${e.message}`);
      if (e.hint) io.err(e.hint);
      return e.code;
    }
    io.err(`Unexpected error: ${(e as Error).message}`);
    return 1;
  }
}
