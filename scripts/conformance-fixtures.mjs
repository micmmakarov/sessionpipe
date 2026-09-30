// SPDX-License-Identifier: Apache-2.0
// Conformance fixtures, two checks:
//  1. Shape: every expected event in conformance/harness/** validates against the
//     Zod source (wildcards "*" substituted), and every delivery scenario parses.
//     This runs from M1 on, so a fixture can never contradict the schema.
//  2. Behaviour: when @sessionpipe/conformance is built (M2+), every adapter fixture
//     is run through core's adapter and the events compared.
// Exits non-zero on any miss.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (d) =>
  existsSync(d)
    ? readdirSync(d).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      })
    : [];
const harness = walk(path.join(root, "conformance/harness")).filter((f) => f.endsWith(".json"));
const delivery = walk(path.join(root, "conformance/delivery")).filter((f) => f.endsWith(".json"));
// (control vectors are read below, once core is built)
if (!harness.length && !delivery.length) {
  console.log("conformance: no fixtures yet");
  process.exit(0);
}

const schemaMod = path.join(root, "packages/core/dist/schema.js");
if (!existsSync(schemaMod)) {
  console.error("conformance: build @sessionpipe/core first (npm run build)");
  process.exit(1);
}
const S = await import(pathToFileURL(schemaMod).href);

const WILD = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", time: "2026-09-28T00:00:00.000Z", tier: 0, seq: 0 };
let failed = 0;
const rows = [];
for (const f of harness) {
  const fx = JSON.parse(readFileSync(f, "utf8"));
  const rel = path.relative(root, f);
  const problems = [];
  if (!fx.input || typeof fx.input.stdin !== "string" || !Array.isArray(fx.input.argv))
    problems.push("input.{argv,stdin} missing");
  if (!Array.isArray(fx.expect) || !fx.expect.length) problems.push("expect empty");
  for (const [i, e] of (fx.expect ?? []).entries()) {
    const ev = {
      protocol: 1,
      ...e,
      id: e.id === "*" ? WILD.id : e.id,
      time: e.time === "*" ? WILD.time : e.time,
      tier: e.tier === "*" ? (S.TYPE_TIER[e.type] ?? 0) : e.tier,
      session: { ...e.session, seq: e.session?.seq === "*" ? WILD.seq : e.session?.seq },
      privacy: e.privacy ?? { rulesets: ["secrets@1"], pii: false },
    };
    const r = S.Event.safeParse(ev);
    if (!r.success)
      problems.push(
        `expect[${i}] envelope: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`,
      );
    const dataSchema = S.EventData.shape[e.type];
    if (dataSchema) {
      const d = dataSchema.safeParse(e.data);
      if (!d.success)
        problems.push(
          `expect[${i}] data for ${e.type}: ${d.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`,
        );
    }
  }
  if (problems.length) failed++;
  rows.push([rel, problems.length ? "FAIL" : "ok", problems.join(" | ")]);
}
for (const f of delivery) {
  const rel = path.relative(root, f);
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (!j.name || !Array.isArray(j.steps) || !j.steps.length) throw new Error("needs name and steps[]");
    rows.push([rel, "ok", ""]);
  } catch (e) {
    failed++;
    rows.push([rel, "FAIL", String(e.message)]);
  }
}

// Control vectors: every signed command through core's verifier, verdict and code.
const vectors = walk(path.join(root, "conformance/control-vectors")).filter((f) => f.endsWith(".json"));
const coreMod = path.join(root, "packages/core/dist/index.js");
if (vectors.length && existsSync(coreMod)) {
  const { verifyCommand } = await import(pathToFileURL(coreMod).href);
  for (const f of vectors.sort()) {
    const rel = path.relative(root, f);
    const v = JSON.parse(readFileSync(f, "utf8"));
    const r = await verifyCommand(v.input, {
      machine: v.machine,
      keys: v.keys,
      now: v.now,
      ...(v.max_age_ms ? { maxAgeMs: v.max_age_ms } : {}),
      ...(v.live_grant ? { liveGrant: true } : {}),
    });
    const want = v.expect.ok ? `ok via ${v.expect.via}` : `refused ${v.expect.code}`;
    const got = r.ok ? `ok via ${r.via}` : `refused ${r.code}`;
    if (want !== got) failed++;
    rows.push([
      rel,
      want === got ? "ok" : "FAIL",
      want === got ? "" : `expected ${want}, got ${got}${r.ok ? "" : ` (${r.why})`}`,
    ]);
  }
}

// Behaviour, once the runner exists.
const runner = path.join(root, "packages/conformance/dist/index.js");
let ran = false;
if (existsSync(runner)) {
  const mod = await import(pathToFileURL(runner).href);
  if (typeof mod.runAdapterFixtures === "function") {
    ran = true;
    const result = await mod.runAdapterFixtures(harness);
    console.log(result.table);
    if (result.failed) failed += result.failed;
  }
}

const w = Math.max(...rows.map((r) => r[0].length));
for (const [f, s, why] of rows) console.log(`${s.padEnd(4)} ${f.padEnd(w)} ${why}`);
console.log(
  `conformance: ${rows.length} fixture(s) checked against the schema${ran ? " and the adapters" : " (adapters land in M2)"}, ${failed} failed`,
);
process.exit(failed ? 1 : 0);
