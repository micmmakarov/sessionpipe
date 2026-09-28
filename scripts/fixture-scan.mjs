// SPDX-License-Identifier: Apache-2.0
// No string that the secrets ruleset would redact may sit unredacted anywhere under
// conformance/. Fixtures are recorded from real sessions; this is the gate that says
// they were scrubbed. Until core's ruleset exists (M1) it scans with a minimal built-in
// set of vendor token shapes so the gate is never absent.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "conformance");

let redact = null;
const core = path.join(root, "packages/core/dist/index.js");
if (existsSync(core)) {
  const mod = await import(pathToFileURL(core).href);
  if (typeof mod.redactSecrets === "function") redact = mod.redactSecrets;
}
const FALLBACK = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abposre]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  /\bss_[a-f0-9]{32,}\b/,
];

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = existsSync(dir) ? walk(dir).filter((f) => /\.(json|jsonl|md|txt)$/.test(f)) : [];
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  // The redaction fixtures hold inputs that MUST look like secrets; only their `out` side is checked.
  const isVector = f.includes(`${path.sep}redaction${path.sep}`);
  const vec = isVector ? JSON.parse(text) : null;
  // Each `out` on its own: joining them would manufacture patterns no file holds.
  const subjects = vec ? (Array.isArray(vec) ? vec : (vec.cases ?? [])).map((c) => String(c.out ?? "")) : [text];
  const hit = subjects.some((subject) =>
    redact ? redact(subject) !== subject : FALLBACK.some((re) => re.test(subject)),
  );
  if (hit) {
    bad++;
    console.error(`unredacted secret-shaped string in ${path.relative(root, f)}`);
  }
}
if (bad) process.exit(1);
console.log(
  `fixture scan: ${files.length} file(s) clean${redact ? "" : " (fallback patterns; build core for the full ruleset)"}`,
);
