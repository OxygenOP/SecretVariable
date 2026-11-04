export type EnvMap = Record<string, string>;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key) && key.length <= 256;
}

/** Parse the contents of a .env file. Later duplicates win. Comments and blank lines are ignored. */
export function parseEnv(text: string): EnvMap {
  const out: EnvMap = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let rest = m[2]!;
    const q = rest[0];
    if (q === '"' || q === "'") {
      // quoted value, possibly spanning lines
      const startLine = i;
      let body = rest.slice(1);
      let closed = findClosing(body, q);
      while (closed < 0 && i + 1 < lines.length) {
        body += "\n" + lines[++i]!;
        closed = findClosing(body, q);
      }
      if (closed < 0) {
        // The quote never closes. Do not let one stray quote swallow every variable below it:
        // keep the line as a plain value (quote included) and carry on from the next line.
        i = startLine;
        out[key] = rest.trim();
        continue;
      }
      const inner = body.slice(0, closed);
      out[key] = q === '"' ? unescapeDouble(inner) : inner;
    } else {
      // unquoted: strip inline comment preceded by whitespace
      const hash = rest.search(/\s#/);
      if (hash >= 0) rest = rest.slice(0, hash);
      out[key] = rest.trim();
    }
  }
  return out;
}

function findClosing(body: string, q: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && q === '"') { i++; continue; }
    if (body[i] === q) return i;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(n|r|t|"|\\)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
  );
}

/** Serialize to .env text, quoting only when needed. Keys are sorted for stable output. */
export function serializeEnv(vars: EnvMap): string {
  const keys = Object.keys(vars).sort();
  return keys.map((k) => `${k}=${formatValue(vars[k]!)}`).join("\n") + (keys.length ? "\n" : "");
}

function formatValue(v: string): string {
  if (v === "") return "";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(v)) return v;
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return `"${esc}"`;
}

export interface EnvDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export function diffEnv(from: EnvMap, to: EnvMap): EnvDiff {
  const d: EnvDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const k of Object.keys(to).sort()) {
    if (!(k in from)) d.added.push(k);
    else if (from[k] !== to[k]) d.changed.push(k);
    else d.unchanged.push(k);
  }
  for (const k of Object.keys(from).sort()) if (!(k in to)) d.removed.push(k);
  return d;
}

export function envEqual(a: EnvMap, b: EnvMap): boolean {
  const d = diffEnv(a, b);
  return !d.added.length && !d.removed.length && !d.changed.length;
}
