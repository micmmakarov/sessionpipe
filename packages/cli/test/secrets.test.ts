// SPDX-License-Identifier: Apache-2.0
// The machine's keys in a keychain: stored through stdin (never argv), trusted only on a
// read-back, read when a sink sends, never written back into a file, moved both ways —
// and a keychain this process can't read leaves events waiting, never sent unsigned.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "@sessionpipe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveControlSecrets, readControl, writeControl } from "../src/control/store.js";
import {
  bestStore,
  defaultRunner,
  moveSinkSecrets,
  probe,
  type Runner,
  secretDel,
  secretGet,
  secretSet,
  sinkWithSecrets,
} from "../src/secrets.js";

/** A stand-in for macOS `security`: an item map, or a keychain that is locked. */
function keychain(o: { locked?: boolean } = {}) {
  const items = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  const run: Runner = (cmd, args, input) => {
    calls.push({ args, ...(input !== undefined ? { input } : {}) });
    if (cmd !== "security") return { status: 127, stdout: "" };
    if (o.locked) return { status: 36, stdout: "" };
    if (args[0] === "-i") {
      const m = /-s sessionpipe -a "([^"]*)" -l "[^"]*" -w "([^"]*)"/.exec(input ?? "");
      if (m) items.set(m[1] as string, m[2] as string);
      return { status: 0, stdout: "" };
    }
    const a = args[args.indexOf("-a") + 1] as string;
    if (args[0] === "find-generic-password")
      return items.has(a) ? { status: 0, stdout: `${items.get(a)}\n` } : { status: 44, stdout: "" };
    if (args[0] === "delete-generic-password") return { status: items.delete(a) ? 0 : 44, stdout: "" };
    return { status: 1, stdout: "" };
  };
  return { items, calls, run };
}

let tmp: string;
let file: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sp-secrets-"));
  file = path.join(tmp, "config.json");
  env = { ...process.env, SESSIONPIPE_CONFIG: file };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("the keychain store", () => {
  it("stores through stdin, never argv, and trusts only a read-back", () => {
    const k = keychain();
    expect(secretSet("keychain", "sink:a:token", "ss_abc123", k.run)).toBe(true);
    expect(k.calls.some((c) => c.args.includes("ss_abc123"))).toBe(false);
    expect(k.calls[0]?.input).toContain("ss_abc123");
    expect(secretGet("keychain", "sink:a:token", k.run)).toBe("ss_abc123");
    secretDel("keychain", "sink:a:token", k.run);
    expect(secretGet("keychain", "sink:a:token", k.run)).toBeNull();
  });

  it("refuses a value its stdin parser would split (a quote, a space, a backslash)", () => {
    const k = keychain();
    for (const v of ['a"b', "a b", "a\\b", ""]) expect(secretSet("keychain", "x", v, k.run)).toBe(false);
    expect(k.items.size).toBe(0);
  });

  it("a locked keychain: the probe fails, so the best store is the file", () => {
    const k = keychain({ locked: true });
    expect(probe("keychain", k.run)).toBe(false);
    expect(bestStore({}, "darwin", k.run)).toBe("file");
    expect(bestStore({}, "darwin", keychain().run)).toBe("keychain");
  });

  it("the Secret Service only in a desktop session, and SESSIONPIPE_SECRETS=file always wins", () => {
    const k = keychain();
    expect(bestStore({ DBUS_SESSION_BUS_ADDRESS: "unix:x" }, "linux", k.run)).toBe("file");
    expect(bestStore({ SESSIONPIPE_SECRETS: "file" }, "darwin", k.run)).toBe("file");
    expect(bestStore({}, "win32", k.run)).toBe("file");
  });
});

describe("sinks", () => {
  const write = (sinks: unknown[]) => writeFileSync(file, JSON.stringify({ sinks, harnesses: {} }));

  it("move to the keychain leaves token_in and no token in the file; back to the file restores it", () => {
    const k = keychain();
    write([{ name: "rx.dev", url: "https://rx.dev", tier: 2, token: "ss_key1", secret: "whsec_c2VjcmV0" }]);
    expect(moveSinkSecrets("keychain", { run: k.run, file })).toEqual({ moved: ["rx.dev"], kept: [] });
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("ss_key1");
    expect(raw).not.toContain("whsec_");
    const s = readConfig(file).sinks[0];
    expect(s?.token_in).toBe("keychain");
    expect(sinkWithSecrets(s as never, k.run)).toMatchObject({ token: "ss_key1", secret: "whsec_c2VjcmV0" });

    expect(moveSinkSecrets("file", { run: k.run, file }).moved).toEqual(["rx.dev"]);
    const back = readConfig(file).sinks[0];
    expect(back).toMatchObject({ token: "ss_key1", secret: "whsec_c2VjcmV0" });
    expect(back?.token_in).toBeUndefined();
    expect(k.items.size).toBe(0);
  });

  it("a token the keychain can't hand over (locked): no sink is built, so nothing is sent unsigned", () => {
    const s = { name: "rx.dev", url: "https://rx.dev", tier: 2 as const, token_in: "keychain" as const };
    expect(sinkWithSecrets(s, keychain({ locked: true }).run)).toBeNull();
  });

  it("a token the keychain refuses stays in the file", () => {
    write([{ name: "rx.dev", url: "https://rx.dev", tier: 2, token: "has space" }]);
    expect(moveSinkSecrets("keychain", { run: keychain().run, file })).toEqual({ moved: [], kept: ["rx.dev"] });
    expect(readConfig(file).sinks[0]?.token).toBe("has space");
  });
});

describe("control.json", () => {
  const receiver = {
    url: "https://rx.dev",
    control: "https://rx.dev/api/sessionpipe/v1/control",
    rpId: "rx.dev",
    machine: "m_abcdefghijklmnop",
    token: "mt_machine_token",
    keys: [],
    paired_at: "2026-10-02T00:00:00.000Z",
  };
  const base = { name: "box", folders: [], mode: "safe" as const, receivers: [receiver] };

  it("a token in the keychain is read on load and never written back", () => {
    const k = keychain();
    writeControl(base, env);
    expect(moveControlSecrets("keychain", { env, run: k.run }).moved).toEqual(["https://rx.dev"]);
    const ctl = path.join(tmp, "control.json");
    expect(readFileSync(ctl, "utf8")).not.toContain("mt_machine_token");
    const loaded = readControl(env, k.run);
    expect(loaded?.receivers[0]?.token).toBe("mt_machine_token");
    // A write of what was loaded (the daemon adding a key) keeps it out of the file.
    writeControl(loaded as never, env);
    expect(readFileSync(ctl, "utf8")).not.toContain("mt_machine_token");
    // Locked: the token reads as empty, the file is unchanged.
    expect(readControl(env, keychain({ locked: true }).run)?.receivers[0]?.token).toBe("");
  });

  it("keeps the machine's own caps across a write", () => {
    writeControl({ ...base, limits: { headless: 1 } }, env);
    expect(readControl(env, keychain().run)?.limits).toEqual({ headless: 1 });
  });
});

// The real macOS Keychain, opt-in (it writes and deletes one throwaway item).
describe.runIf(process.platform === "darwin" && process.env.SP_KEYCHAIN_TEST === "1")("the real Keychain", () => {
  it("round-trips through `security`", () => {
    const acct = `test:${Date.now()}`;
    expect(secretSet("keychain", acct, "ss_real_test_value", defaultRunner)).toBe(true);
    expect(secretGet("keychain", acct, defaultRunner)).toBe("ss_real_test_value");
    secretDel("keychain", acct, defaultRunner);
    expect(secretGet("keychain", acct, defaultRunner)).toBeNull();
  });
});
