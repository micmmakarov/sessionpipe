// SPDX-License-Identifier: Apache-2.0
// Every vector under conformance/control-vectors/ through the one verifier. Another
// implementation (a receiver's early check, a daemon in another language) passes
// when it reaches the same verdict on every file.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyCommand, verifyEnrollment } from "../src/control/verify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = path.join(root, "conformance/control-vectors");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("control vectors", () => {
  it("there are vectors, valid and broken", () => {
    const all = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    expect(all.filter((v) => v.expect.ok).length).toBeGreaterThan(5);
    expect(all.filter((v) => !v.expect.ok).length).toBeGreaterThan(30);
  });
  for (const f of files) {
    const v = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    it(f, async () => {
      if (v.input.proof) {
        const r = await verifyEnrollment({
          machine: v.input.machine,
          code: v.input.code,
          key: v.input.key,
          proof: v.input.proof,
          rpId: v.input.rp_id,
        });
        expect(r.ok).toBe(v.expect.ok);
        return;
      }
      const seen = new Set<string>(v.input.seen_nonces ?? []);
      const r = await verifyCommand(v.input.signed, {
        machine: v.input.machine,
        rpId: v.input.rp_id,
        trusted: v.input.trusted,
        now: v.input.now,
        ...(v.input.max_age_ms ? { maxAgeMs: v.input.max_age_ms } : {}),
        seenNonce: (n) => {
          if (seen.has(n)) return true;
          seen.add(n);
          return false;
        },
      });
      if (v.expect.ok) {
        expect(r, JSON.stringify(r)).toMatchObject({ ok: true, via: v.expect.via });
        if (r.ok) expect(r.cmd.kind).toBe(v.expect.kind);
      } else {
        expect(r.ok, `${f} verified`).toBe(false);
        if (!r.ok) expect(r.code).toBe(v.expect.code);
      }
    });
  }
});
