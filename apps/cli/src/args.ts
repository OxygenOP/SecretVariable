export interface Parsed {
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Everything after a bare `--` */
  rest: string[];
}

const SHORT: Record<string, string> = { m: "message", e: "env", o: "out", f: "file", y: "yes", h: "help", s: "server", v: "version" };

export function parseArgs(argv: string[], booleans: string[] = []): Parsed {
  const p: Parsed = { positionals: [], flags: {}, rest: [] };
  const bools = new Set([...booleans, "yes", "force", "help", "reveal", "create", "json", "send-email"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") { p.rest = argv.slice(i + 1); break; }
    let name: string | null = null;
    let inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) inline = a.slice(eq + 1);
    } else if (/^-[a-zA-Z]$/.test(a)) name = SHORT[a[1]!] ?? a[1]!;
    if (name === null) { p.positionals.push(a); continue; }
    if (inline !== undefined) p.flags[name] = inline;
    else if (bools.has(name)) p.flags[name] = true;
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) p.flags[name] = true;
      else { p.flags[name] = next; i++; }
    }
  }
  return p;
}

export const str = (v: string | boolean | undefined): string | undefined => (typeof v === "string" ? v : undefined);
