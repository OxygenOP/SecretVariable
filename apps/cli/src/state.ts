import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * What the CLI last wrote to each env file, so it can tell an untouched copy from one you edited.
 * Only a salted fingerprint of the file is kept, never its contents. The file is git-ignored by convention.
 */
export const STATE_FILE = ".secretvariable.state.json";

interface Entry { environment: string; version: number | null; salt: string; hash: string }
interface State { files: Record<string, Entry>; previousEnvironment?: string }

const fingerprint = (salt: string, text: string) => createHash("sha256").update(salt).update("\0").update(text).digest("hex");
const keyOf = (dir: string, file: string) => relative(dir, file) || file;

export function readState(dir: string): State {
  try {
    const s = JSON.parse(readFileSync(join(dir, STATE_FILE), "utf8")) as State;
    return { files: s.files ?? {}, previousEnvironment: s.previousEnvironment };
  } catch { return { files: {} }; }
}

/** Returns true when the state file did not exist before (so the caller can remind about .gitignore). */
function save(dir: string, s: State): boolean {
  const path = join(dir, STATE_FILE);
  const created = !existsSync(path);
  writeFileSync(path, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return created;
}

/** Record that `file` now holds exactly `text`, as pulled from or pushed to `environment`. */
export function remember(dir: string, file: string, text: string, environment: string, version: number | null): boolean {
  const s = readState(dir);
  const salt = randomBytes(12).toString("hex");
  s.files[keyOf(dir, file)] = { environment, version, salt, hash: fingerprint(salt, text) };
  return save(dir, s);
}

/** True when `text` is exactly what the CLI last wrote to `file`. */
export function isUntouched(dir: string, file: string, text: string): boolean {
  const e = readState(dir).files[keyOf(dir, file)];
  return !!e && e.hash === fingerprint(e.salt, text);
}

export function setPrevious(dir: string, environment: string): void {
  const s = readState(dir);
  s.previousEnvironment = environment;
  save(dir, s);
}
export const previousEnvironment = (dir: string): string | undefined => readState(dir).previousEnvironment;
