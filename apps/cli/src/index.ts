#!/usr/bin/env node
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { main } from "./cli.js";
import type { IO } from "./io.js";

async function ask(q: string, opts?: { secret?: boolean }): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  let muted = false;
  const out = new Writable({ write(chunk, _e, cb) { if (!muted) process.stderr.write(chunk); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(q, (a) => { rl.close(); if (opts?.secret) process.stderr.write("\n"); resolve(a); });
    muted = !!opts?.secret;
  });
}

const io: IO = {
  cwd: process.cwd(),
  env: process.env,
  out: (s) => console.log(s),
  err: (s) => console.error(s),
  isTTY: !!process.stdout.isTTY,
  ask,
};

process.exitCode = await main(process.argv.slice(2), io);
