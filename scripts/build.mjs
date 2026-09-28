// SPDX-License-Identifier: Apache-2.0
// Builds one package: esbuild bundles each entry to a single ESM file, tsc emits the
// declarations. `node scripts/build.mjs <dir>`. The CLI's hook entry is checked to
// import nothing but node: builtins — the hook path must start in milliseconds.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/build.mjs <package dir>");
const pkgDir = path.join(root, "packages", dir);
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));

/** Entries per package. `bundleWorkspace` folds @sessionpipe/* in (one file for the
 *  hook); `external` stays an import. */
const PLANS = {
  core: { entries: { index: "src/index.ts", schema: "schema/v1.ts" }, external: ["zod"] },
  cli: {
    entries: { index: "src/index.ts", cli: "src/cli.ts", hook: "src/hook.ts", worker: "src/worker.ts" },
    bundleWorkspace: true,
  },
  receiver: { entries: { index: "src/index.ts", cli: "src/cli.ts" }, bundleWorkspace: true, external: ["zod"] },
  conformance: { entries: { index: "src/index.ts", cli: "src/cli.ts" }, bundleWorkspace: true, external: ["zod"] },
};
const plan = PLANS[dir];
if (!plan) throw new Error(`no build plan for ${dir}`);

const out = path.join(pkgDir, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entryPoints = {};
for (const [name, file] of Object.entries(plan.entries)) {
  if (existsSync(path.join(pkgDir, file))) entryPoints[name] = path.join(pkgDir, file);
}
const external = [...(plan.external ?? []), ...(plan.bundleWorkspace ? [] : ["@sessionpipe/*"])];
const result = await build({
  entryPoints,
  outdir: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  metafile: true,
  external,
  banner: { js: `// ${pkg.name} ${pkg.version} · Apache-2.0 · https://sessionpipe.org` },
  define: { __SESSIONPIPE_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "none",
});

// The hook must depend on the platform and nothing else.
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (!file.endsWith("/hook.js")) continue;
  const bad = (meta.imports ?? []).filter((i) => i.external && !i.path.startsWith("node:"));
  if (bad.length) throw new Error(`dist/hook.js imports outside node: builtins: ${bad.map((b) => b.path).join(", ")}`);
}

// Declarations, from the package's own tsconfig.
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    path.join(pkgDir, "tsconfig.json"),
    "--emitDeclarationOnly",
    "--declaration",
    "--outDir",
    out,
  ],
  { stdio: "inherit" },
);
console.log(`built ${pkg.name}: ${Object.keys(entryPoints).join(", ")}`);
