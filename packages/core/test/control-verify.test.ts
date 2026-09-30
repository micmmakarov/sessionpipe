// SPDX-License-Identifier: Apache-2.0
// The verifier's own rules beyond the shared vectors, and the fuzz that backs the
// measure "unsigned commands executed: 0": thousands of mutations of a valid signed
// command, none of which may verify.
import { describe, expect, it } from "vitest";
import {
  type Assertion,
  fromB64url,
  parseSessionRef,
  type SignedCommand,
  verifyCommand,
} from "../src/control/verify.js";
import { commandStr, DayKey, MACHINE, Passkey, signed } from "./helpers/authenticator.js";

const RP = "receiver.example";
const T = 1_790_800_000_000;

describe("verifyCommand", () => {
  it("records the nonce only after every signature verified, and refuses what it couldn't record", async () => {
    const pk = await Passkey.create({ rpId: RP });
    const day = await DayKey.create();
    const c = commandStr({});
    const s = await signed(pk, day, c);
    const calls: string[] = [];
    const o = { machine: MACHINE, rpId: RP, trusted: [pk.key], now: T + 1000 };
    const forged = { ...s, csig: await (await DayKey.create()).sign(c) };
    expect(
      (
        await verifyCommand(forged, {
          ...o,
          seenNonce: (n) => {
            calls.push(n);
            return false;
          },
        })
      ).ok,
    ).toBe(false);
    expect(calls).toEqual([]); // a forged command can't burn the real one's nonce
    const r = await verifyCommand(s, {
      ...o,
      seenNonce: () => {
        throw new Error("disk full");
      },
    });
    expect(r).toMatchObject({ ok: false, code: "nonce_store" });
    const seen = new Set<string>();
    const once = (n: string) => {
      if (seen.has(n)) return true;
      seen.add(n);
      return false;
    };
    expect((await verifyCommand(s, { ...o, seenNonce: once })).ok).toBe(true);
    expect(await verifyCommand(s, { ...o, seenNonce: once })).toMatchObject({ ok: false, code: "replay" });
  });

  it("reads session references per harness", () => {
    expect(parseSessionRef("claude-code:8c132906-8c3f-4814-870a-afc3d05e1d2e")).toEqual({
      harness: "claude-code",
      id: "8c132906-8c3f-4814-870a-afc3d05e1d2e",
    });
    expect(parseSessionRef("claude-code:abc")).toBeNull();
    expect(parseSessionRef("codex:01999a7c-1f2e")).toEqual({ harness: "codex", id: "01999a7c-1f2e" });
    expect(parseSessionRef("Claude:x")).toBeNull();
    expect(parseSessionRef(":x")).toBeNull();
  });

  it("decodes base64url strictly", () => {
    expect(fromB64url("AQID")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fromB64url("AQI")).toEqual(new Uint8Array([1, 2]));
    expect(fromB64url("AQ+D")).toBeNull();
    expect(fromB64url("AQ==")).toBeNull();
    expect(fromB64url("A")).toBeNull();
  });
});

// A small deterministic PRNG, so a failure names a reproducible case.
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fuzz: no mutation of a signed command verifies", () => {
  it("3,000 mutations across every signed field", async () => {
    const pk = await Passkey.create({ rpId: RP });
    const day = await DayKey.create();
    const base = await signed(pk, day, commandStr({}));
    const conf = await signed(pk, day, commandStr({}), { confirm: true });
    const donor = await signed(pk, day, commandStr({ text: "something else entirely" }));
    const rnd = prng(20260930);
    const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)] as T;
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const mutateStr = (s: string, alphabet?: string) => {
      if (!s.length) return "x";
      const i = Math.floor(rnd() * s.length);
      const op = rnd();
      if (op < 0.5) {
        const ch = alphabet ? pick([...alphabet]) : String.fromCharCode(32 + Math.floor(rnd() * 95));
        return s.slice(0, i) + ch + s.slice(i + 1);
      }
      if (op < 0.75) return s.slice(0, i) + s.slice(i + 1);
      return s.slice(0, i) + (alphabet ? pick([...alphabet]) : " ") + s.slice(i);
    };
    const mutateAssertion = (a: Assertion): Assertion => {
      const k = pick(["cred", "ad", "cd", "sig"] as const);
      return { ...a, [k]: mutateStr(a[k], B64) };
    };
    let verified = 0;
    let tried = 0;
    for (let i = 0; i < 3000; i++) {
      const useConfirm = rnd() < 0.25;
      const src = useConfirm ? conf : base;
      let m: SignedCommand = JSON.parse(JSON.stringify(src));
      const target = pick(
        useConfirm
          ? (["cmd", "confirm", "drop-confirm", "swap-cmd"] as const)
          : (["cmd", "csig", "grant.str", "grant", "drop-grant", "drop-csig", "swap-cmd", "swap-grant"] as const),
      );
      switch (target) {
        case "cmd":
          m.cmd = mutateStr(m.cmd);
          break;
        case "csig":
          m.csig = mutateStr(m.csig ?? "", B64);
          break;
        case "grant.str":
          m.grant = { ...m.grant!, str: mutateStr(m.grant!.str) };
          break;
        case "grant":
          m.grant = { ...m.grant!, ...mutateAssertion(m.grant!) };
          break;
        case "confirm":
          m.confirm = mutateAssertion(m.confirm!);
          break;
        case "drop-grant":
          m.grant = null;
          break;
        case "drop-csig":
          m.csig = null;
          break;
        case "drop-confirm":
          m.confirm = null;
          break;
        case "swap-cmd":
          m.cmd = donor.cmd;
          break;
        case "swap-grant":
          m = { ...m, csig: donor.csig ?? null };
          break;
      }
      if (JSON.stringify(m) === JSON.stringify(src)) continue; // the mutation changed nothing
      tried++;
      const r = await verifyCommand(m, { machine: MACHINE, rpId: RP, trusted: [pk.key], now: T + 1000 });
      if (r.ok) {
        // Only a mutation that decodes to the very same bytes may verify (a base64
        // character whose change lands in unused trailing bits).
        const sameBytes = m.cmd === src.cmd && JSON.stringify(decodeAll(m)) === JSON.stringify(decodeAll(src));
        if (!sameBytes) verified++;
      }
    }
    expect(tried).toBeGreaterThan(2500);
    expect(verified).toBe(0);
  }, 60_000);
});

function decodeAll(s: SignedCommand) {
  const d = (x?: string | null) => (x ? Array.from(fromB64url(x) ?? []) : null);
  const a = (x?: Assertion | null) => (x ? { cred: x.cred, ad: d(x.ad), cd: d(x.cd), sig: d(x.sig) } : null);
  return { csig: d(s.csig), grant: s.grant ? { str: s.grant.str, ...a(s.grant) } : null, confirm: a(s.confirm) };
}
