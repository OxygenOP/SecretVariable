// Bundles the CLI into one dependency-free file so `npm install -g @secretvariable/cli` needs nothing else.
// The workspace packages (@secretvariable/shared) are inlined; Node built-ins stay external.
import { build } from "esbuild";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
rmSync(join(root, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // Resolve the workspace package from its source so a fresh clone can publish without building every package first.
  alias: { "@secretvariable/shared": join(root, "../../packages/shared/src/index.ts") },
  // the entry file already starts with a #! line, which esbuild preserves
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
});
chmodSync(join(root, "dist/index.js"), 0o755);
console.log(`bundled dist/index.js (${pkg.name}@${pkg.version})`);
