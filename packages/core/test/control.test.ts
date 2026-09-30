// SPDX-License-Identifier: Apache-2.0
// Every signed command under conformance/control-vectors/ through the one verifier:
// the verdict (ok + via, or the refusal code) must be the one the vector names.
// A receiver or a machine in another language passes the same files.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { derToRaw, fromB64url, pairChallenge, parseSessionRef, verifyCommand } from "../src/control/verify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = path.join(root, "conformance/control-vectors");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("control vectors", () => {
  it("has valid and broken cases", () => {
    const all = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    expect(all.filter((v) => v.expect.ok).length).toBeGreaterThanOrEqual(8);
    expect(all.filter((v) => !v.expect.ok).length).toBeGreaterThanOrEqual(30);
  });
  for (const f of files) {
    const v = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    it(`${f}: ${v.spec}`, async () => {
      const r = await verifyCommand(v.input, {
        machine: v.machine,
        keys: v.keys,
        now: v.now,
        ...(v.max_age_ms ? { maxAgeMs: v.max_age_ms } : {}),
        ...(v.live_grant ? { liveGrant: true } : {}),
      });
      if (v.expect.ok) {
        expect(r, r.ok ? "" : `${r.code}: ${r.why}`).toMatchObject({ ok: true, via: v.expect.via });
      } else {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code, r.why).toBe(v.expect.code);
      }
    });
  }
});

describe("control verifier edges", () => {
  it("never throws on junk", async () => {
    const o = { machine: "m_Qx7uR2bT9kLmN4pV8sWz", keys: [], now: 0 };
    for (const junk of [null, {}, { cmd: 1 }, { cmd: "[]" }, { cmd: "{" }, { cmd: "{}", grant: { str: 5 }, csig: "!" }])
      expect((await verifyCommand(junk as never, o)).ok).toBe(false);
  });
  it("reads base64url strictly and DER defensively", () => {
    expect(fromB64url("ab+/")).toBeNull();
    expect(fromB64url("a")).toBeNull();
    expect(derToRaw(new Uint8Array([0x30, 0x06, 0x02, 0x40]))).toBeNull();
  });
  it("session refs follow the adapter", () => {
    expect(parseSessionRef("claude-code:BEDC5A64-3F1E-4C7A-9B2D-5E8F0A1C6D42")).toMatchObject({
      harness: "claude-code",
    });
    expect(parseSessionRef("claude-code:../../etc")).toBeNull();
    expect(parseSessionRef("gemini-cli:a/b")).toBeNull();
    expect(parseSessionRef(":x")).toBeNull();
  });
  it("the pairing challenge binds the machine and the code", async () => {
    const a = await pairChallenge("m_a", "c1");
    const b = await pairChallenge("m_b", "c1");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
