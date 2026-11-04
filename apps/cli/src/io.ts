export interface IO {
  /** Name the program was started as ("sv" or "secretvariable"); used so hints show the command the user typed. */
  prog?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (s: string) => void;
  err: (s: string) => void;
  isTTY: boolean;
  /** Ask a question. Returns null when no terminal is available. */
  ask: (question: string, opts?: { secret?: boolean }) => Promise<string | null>;
}

export class CliError extends Error {
  constructor(message: string, public hint?: string, public code = 1) {
    super(message);
  }
}

const useColor = (io: IO) => io.isTTY && !io.env.NO_COLOR;
export const style = (io: IO) => {
  const c = (n: number) => (s: string) => (useColor(io) ? `\x1b[${n}m${s}\x1b[0m` : s);
  return { bold: c(1), dim: c(2), red: c(31), green: c(32), yellow: c(33), cyan: c(36) };
};

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0]!.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd();
  return all.map(line).join("\n");
}
