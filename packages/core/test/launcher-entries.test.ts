// SPDX-License-Identifier: Apache-2.0
// The hook launcher (sessionpipe-hook) is ours on every file shape: a re-install that
// moves from `node …/hook.js` to the launcher replaces each entry, never adds a second,
// and uninstall still finds it. And the sign-in check reads Claude Code's own answer.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginCommand, loginHint, parseAuthStatus } from "../src/adapters/claude-code-control.js";
import { OURS as CLAUDE_OURS } from "../src/adapters/claude-shaped.js";
import { OURS as CODEX_OURS, readNotify } from "../src/adapters/codex-config.js";
import { claudeCode, codex } from "../src/adapters/index.js";
import type { HookCommand } from "../src/adapters/types.js";

let home: string;
let env: NodeJS.ProcessEnv;
const oldCmd: HookCommand = (a) => ({
  argv: [
    "/Users/me/.nvm/versions/node/v22.1.0/bin/node",
    "/Users/me/.nvm/v22/lib/node_modules/sessionpipe/dist/hook.js",
    ...a,
  ],
  command: `"/Users/me/.nvm/versions/node/v22.1.0/bin/node" "/Users/me/.nvm/v22/lib/node_modules/sessionpipe/dist/hook.js" ${a.join(" ")}`,
});
const launcher = "/Users/me/.local/share/sessionpipe/sessionpipe-hook";
const newCmd: HookCommand = (a) => ({ argv: [launcher, ...a], command: `${JSON.stringify(launcher)} ${a.join(" ")}` });

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "sp-launcher-"));
  env = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex") };
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  mkdirSync(path.join(home, ".codex"), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the launcher is ours", () => {
  it("matches the launcher command and still the old one, and nobody else's", () => {
    expect(CLAUDE_OURS.test(newCmd(["claude-code", "Stop"]).command)).toBe(true);
    expect(CLAUDE_OURS.test(oldCmd(["claude-code", "Stop"]).command)).toBe(true);
    expect(CLAUDE_OURS.test('"/usr/bin/other-hook" claude-code Stop')).toBe(false);
    expect(CODEX_OURS.test(JSON.stringify(newCmd(["codex", "notify"]).argv))).toBe(true);
    expect(CODEX_OURS.test(JSON.stringify(oldCmd(["codex", "notify"]).argv))).toBe(true);
  });

  it("Claude Code: moving to the launcher replaces every entry, one per event", () => {
    claudeCode.install(oldCmd, env);
    claudeCode.install(newCmd, env);
    const s = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    for (const [ev, list] of Object.entries(s.hooks)) {
      const ours = list.filter((h) => h.hooks.some((x) => CLAUDE_OURS.test(x.command)));
      expect(ours, ev).toHaveLength(1);
      expect(ours[0]?.hooks[0]?.command).toContain("sessionpipe-hook");
    }
    expect(claudeCode.installed(newCmd, env).every((r) => r.state === "current")).toBe(true);
    claudeCode.uninstall(env, {});
    const after = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8")) as { hooks?: object };
    expect(JSON.stringify(after)).not.toContain("sessionpipe");
  });

  it("Codex: the notify line moves to the launcher in place", () => {
    writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    codex.install(oldCmd, env);
    codex.install(newCmd, env);
    const text = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    expect(text.match(/^notify/gm)).toHaveLength(1);
    expect(readNotify(text)?.argv).toEqual([launcher, "codex", "notify"]);
  });
});

describe("Claude Code sign-in", () => {
  it("reads loggedIn from auth status, whatever its exit code printed around it", () => {
    expect(
      parseAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"x@y"}'),
    ).toEqual({ loggedIn: true, method: "claude.ai", subscription: "max" });
    expect(parseAuthStatus('{"loggedIn":false}')).toEqual({ loggedIn: false });
    // An older Claude Code: usage text, or nothing. Can't say — never a refusal.
    expect(parseAuthStatus("error: unknown command 'auth'")).toEqual({ loggedIn: null });
    expect(parseAuthStatus("")).toEqual({ loggedIn: null });
  });

  it.skipIf(process.platform === "win32")(
    "names the account's own login command, and on a Mac why a service can't read it",
    () => {
      expect(loginCommand(undefined)).toBe("`claude auth login`");
      expect(loginCommand(path.join(os.homedir(), ".claude"))).toBe("`claude auth login`");
      expect(loginCommand(path.join(os.homedir(), ".claude-work"))).toBe(
        "`CLAUDE_CONFIG_DIR=~/.claude-work claude auth login`",
      );
      expect(loginHint(undefined, "darwin")).toMatch(/keychain/);
      expect(loginHint(undefined, "linux")).not.toMatch(/keychain/);
    },
  );
});
