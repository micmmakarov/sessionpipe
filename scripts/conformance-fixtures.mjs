// SPDX-License-Identifier: Apache-2.0
// Runs every adapter fixture under conformance/harness/ through the built core
// (M1 adds the fixtures, M2 the adapters). Exits non-zero on any miss; passes with a
// note while there is nothing to run.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "conformance/harness");
const walk = (d) =>
  existsSync(d)
    ? readdirSync(d).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
const fixtures = walk(dir).filter((f) => f.endsWith(".json"));
if (!fixtures.length) {
  console.log("conformance: no adapter fixtures yet");
  process.exit(0);
}
const runner = path.join(root, "packages/conformance/dist/index.js");
if (!existsSync(runner)) {
  console.error("conformance: fixtures exist but @sessionpipe/conformance is not built");
  process.exit(1);
}
const mod = await import(pathToFileURL(runner).href);
const result = await mod.runAdapterFixtures(fixtures);
console.log(result.table);
process.exit(result.failed ? 1 : 0);
