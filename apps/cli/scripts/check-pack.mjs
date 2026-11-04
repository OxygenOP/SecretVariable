// Fails `npm pack` / `npm publish` when the bundle would not work on a clean machine.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bundle = readFileSync(join(root, "dist/index.js"), "utf8");
const problems = [];
if (!bundle.startsWith("#!/usr/bin/env node")) problems.push("dist/index.js must start with a #! line");
if (/from\s+["']@secretvariable\//.test(bundle) || /import\(["']@secretvariable\//.test(bundle)) problems.push("a workspace package was left external; it is not published");
if (Object.keys(pkg.dependencies ?? {}).some((d) => d.startsWith("@secretvariable/"))) problems.push("workspace packages must be devDependencies (they are bundled)");
if ((statSync(join(root, "dist/index.js")).mode & 0o111) === 0) problems.push("dist/index.js is not executable");
if (!/__PKG_VERSION__/.test(readFileSync(join(root, "src/cli.ts"), "utf8"))) problems.push("src/cli.ts does not read the injected package version");
if (problems.length) { console.error("Pack check failed:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("pack check ok");
