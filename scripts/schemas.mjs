// SPDX-License-Identifier: Apache-2.0
// One source per fact: schemas/v1/*.json are GENERATED from the Zod definitions in
// packages/core/schema/v1.ts. `node scripts/schemas.mjs` rewrites them;
// `--check` exits 1 when the committed files differ from what the code says.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const src = path.join(root, "packages/core/schema/v1.ts");
const outDir = path.join(root, "schemas/v1");
const SCHEMA_BASE = "https://sessionpipe.org/schema/v1/";

const generated = {};
if (existsSync(src)) {
  const tmp = path.join(root, ".tmp/schema-v1.mjs");
  mkdirSync(path.dirname(tmp), { recursive: true });
  await build({
    entryPoints: [src],
    outfile: tmp,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
  const { z } = await import("zod");
  if (!mod.SCHEMAS || typeof mod.SCHEMAS !== "object")
    throw new Error("packages/core/schema/v1.ts must export SCHEMAS: Record<name, ZodType>");
  for (const [name, schema] of Object.entries(mod.SCHEMAS)) {
    const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" });
    generated[`${name}.json`] = `${JSON.stringify({ $id: `${SCHEMA_BASE}${name}.json`, ...json }, null, 2)}\n`;
  }
  rmSync(path.join(root, ".tmp"), { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });
const existing = Object.fromEntries(
  readdirSync(outDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, readFileSync(path.join(outDir, f), "utf8")]),
);
const names = new Set([...Object.keys(existing), ...Object.keys(generated)]);
let drift = 0;
for (const name of [...names].sort()) {
  const want = generated[name];
  const have = existing[name];
  if (want === have) continue;
  drift++;
  if (check)
    console.error(
      `schemas/v1/${name}: ${want === undefined ? "committed but no longer generated" : have === undefined ? "missing" : "out of date"}`,
    );
  else if (want === undefined) rmSync(path.join(outDir, name));
  else writeFileSync(path.join(outDir, name), want);
}
if (check && drift) {
  console.error(`\n${drift} schema file(s) differ from the Zod source. Run: npm run schemas`);
  process.exit(1);
}
console.log(
  check
    ? `schemas in sync (${Object.keys(generated).length} files)`
    : `wrote ${Object.keys(generated).length} schema file(s) to schemas/v1/`,
);
