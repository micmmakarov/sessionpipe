// SPDX-License-Identifier: Apache-2.0
// Install writes only our entries; uninstall leaves every config file byte-identical
// to before — with someone else's hooks in place, on every harness's file shape.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { antigravity, claudeCode, codex, geminiCli } from "../src/adapters/index.js";
import type { HookCommand } from "../src/adapters/types.js";

let home: string;
let env: NodeJS.ProcessEnv;
const cmd: HookCommand = (a) => ({
  argv: ["/usr/local/bin/node", "/opt/sessionpipe/dist/hook.js", ...a],
  command: `"/usr/local/bin/node" "/opt/sessionpipe/dist/hook.js" ${a.join(" ")}`,
});
const cmd2: HookCommand = (a) => ({
  argv: ["/new/node", "/new/sessionpipe/dist/hook.js", ...a],
  command: `"/new/node" "/new/sessionpipe/dist/hook.js" ${a.join(" ")}`,
});

// The real Claude Code settings, before and after the whole file: a run must leave them alone.
const realSettings = path.join(os.homedir(), ".claude", "settings.json");
const realBefore = existsSync(realSettings) ? readFileSync(realSettings, "utf8") : null;
afterAll(() => {
  expect(existsSync(realSettings) ? readFileSync(realSettings, "utf8") : null).toBe(realBefore);
});

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "sp-install-"));
  env = {
    // Its own HOME: nothing here may touch the real ~/.claude (this test once rewrote
    // the real settings.json with the fake hook paths below on every run).
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CODEX_HOME: path.join(home, ".codex"),
    GEMINI_CLI_HOME: path.join(home, ".gemini"),
  };
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  mkdirSync(path.join(home, ".gemini", "config"), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("install / uninstall", () => {
  it("claude-code: adds one entry per event beside a foreign hook, re-install is a no-op, uninstall restores bytes", () => {
    const file = path.join(home, ".claude", "settings.json");
    const before = `${JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "/other/tool stop", timeout: 10 }] }] } }, null, 2)}\n`;
    writeFileSync(file, before);
    // claudeDirs() reads ~/.claude from the real home too; restrict to the env dir by checking the reports for our file.
    const r1 = claudeCode.install(cmd, env).filter((r) => r.file === file);
    expect(r1[0]?.changed).toBe(true);
    const after = JSON.parse(readFileSync(file, "utf8"));
    expect(after.model).toBe("opus");
    expect(after.hooks.Stop).toHaveLength(2);
    expect(after.hooks.Stop[0].hooks[0].command).toBe("/other/tool stop");
    expect(after.hooks.PreToolUse[0].matcher).toBe("");
    expect(after.hooks.SessionStart[0].matcher).toBeUndefined();
    expect(claudeCode.install(cmd, env).filter((r) => r.file === file)[0]?.changed).toBe(false);
    expect(claudeCode.installed(cmd, env).find((r) => r.file === file)?.state).toBe("current");
    // A moved node path is "stale" and a re-install replaces ours only.
    expect(claudeCode.installed(cmd2, env).find((r) => r.file === file)?.state).toBe("stale");
    claudeCode.install(cmd2, env);
    expect(JSON.parse(readFileSync(file, "utf8")).hooks.Stop).toHaveLength(2);
    claudeCode.uninstall(env);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("codex: hooks.json plus a top-level notify before the first [table]; uninstall restores both", () => {
    const toml = path.join(home, ".codex", "config.toml");
    const before = 'model = "gpt-6"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
    writeFileSync(toml, before);
    codex.install(cmd, env);
    const text = readFileSync(toml, "utf8");
    expect(text.indexOf("notify = ")).toBeLessThan(text.indexOf("[projects"));
    expect(text).toContain('"codex","notify"]');
    expect(codex.installed(cmd, env).map((r) => r.state)).toEqual(["current", "current"]);
    // A misplaced line (inside the table) is detected and moved.
    writeFileSync(toml, `${before}notify = ${JSON.stringify(cmd(["codex", "notify"]).argv)}\n`);
    expect(codex.installed(cmd, env)[1]?.state).toBe("misplaced");
    codex.install(cmd, env);
    expect(codex.installed(cmd, env)[1]?.state).toBe("current");
    codex.uninstall(env);
    expect(readFileSync(toml, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(path.join(home, ".codex", "hooks.json"), "utf8"))).toEqual({});
  });
  it("codex: another tool's notify is chained through --previous-notify only for Computer Use, else left alone", () => {
    const toml = path.join(home, ".codex", "config.toml");
    writeFileSync(toml, 'notify = ["/Applications/X/SkyComputerUseClient", "turn-ended"]\n');
    const r = codex.install(cmd, env)[1];
    expect(r?.note).toContain("chained");
    expect(readFileSync(toml, "utf8")).toContain("--previous-notify");
    codex.uninstall(env);
    expect(readFileSync(toml, "utf8")).toBe('notify = ["/Applications/X/SkyComputerUseClient", "turn-ended"]\n');
    writeFileSync(toml, 'notify = ["/usr/bin/say", "done"]\n');
    expect(codex.install(cmd, env)[1]?.note).toContain("left alone");
    expect(readFileSync(toml, "utf8")).toBe('notify = ["/usr/bin/say", "done"]\n');
  });
  it("gemini-cli: settings.json hooks with millisecond timeouts", () => {
    const file = path.join(home, ".gemini", "settings.json");
    writeFileSync(file, '{\n  "theme": "dark"\n}\n');
    geminiCli.install(cmd, env);
    const s = JSON.parse(readFileSync(file, "utf8"));
    expect(s.theme).toBe("dark");
    expect(s.hooks.BeforeTool[0].hooks[0].timeout).toBe(5000);
    expect(s.hooks.BeforeTool[0].matcher).toBe(".*");
    geminiCli.uninstall(env);
    expect(readFileSync(file, "utf8")).toBe('{\n  "theme": "dark"\n}\n');
  });
  it("antigravity: one named group, {} on stdout, uninstall removes only it", () => {
    const file = path.join(home, ".gemini", "config", "hooks.json");
    const before = `${JSON.stringify({ "other-hook": { enabled: true, Stop: [{ type: "command", command: "x", timeout: 5 }] } }, null, 2)}\n`;
    writeFileSync(file, before);
    antigravity.install(cmd, env);
    const j = JSON.parse(readFileSync(file, "utf8"));
    expect(j["other-hook"]).toBeDefined();
    expect(j.sessionpipe.PreToolUse).toBeUndefined();
    expect(j.sessionpipe.PostToolUse[0].matcher).toBe("*");
    expect(j.sessionpipe.Stop[0].timeout).toBe(5);
    expect(antigravity.fromHook({ argv: ["antigravity", "Stop"], stdin: "not json", env: {}, cwd: "/" })?.stdout).toBe(
      "{}\n",
    );
    antigravity.uninstall(env);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("issue #8: files that are not plain JSON, and byte-identical round trips", () => {
  it("leaves a settings.json with a comment untouched and says why", () => {
    const file = path.join(home, ".gemini", "settings.json");
    const before =
      '{\n  // Gemini CLI accepts comments in this file\n  "security": { "auth": { "selectedType": "oauth-personal" } }\n}\n';
    writeFileSync(file, before);
    const r = geminiCli.install(cmd, env)[0]!;
    expect(r.skipped).toBe(true);
    expect(r.note).toContain("comments");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(geminiCli.uninstall(env)[0]?.skipped).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("keeps a file's indent and missing final newline", () => {
    const file = path.join(home, ".gemini", "settings.json");
    const before = '{\n    "theme": "dark"\n}';
    writeFileSync(file, before);
    geminiCli.install(cmd, env);
    const after = readFileSync(file, "utf8");
    expect(after.startsWith('{\n    "theme": "dark",\n    "hooks"')).toBe(true);
    expect(after.endsWith("\n")).toBe(false);
    geminiCli.uninstall(env);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("deletes a file sessionpipe created once uninstall empties it", () => {
    const file = path.join(home, ".codex", "hooks.json");
    const r = codex.install(cmd, env)[0]!;
    expect(r.created).toBe(true);
    codex.uninstall(env, { created: [file] });
    expect(existsSync(file)).toBe(false);
  });
});

describe("issue #12: a lean install hooks one tool event", () => {
  it("claude-code: no PreToolUse or PostToolUseFailure without a tier-1 sink; a later full install adds them", () => {
    const file = path.join(home, ".claude", "settings.json");
    claudeCode.install(cmd, env, { lean: true });
    const lean = JSON.parse(readFileSync(file, "utf8")).hooks;
    expect(lean.PostToolUse).toBeDefined();
    expect(lean.PreToolUse).toBeUndefined();
    expect(lean.PostToolUseFailure).toBeUndefined();
    expect(lean.StopFailure).toBeDefined();
    expect(claudeCode.installed(cmd, env, { lean: true }).find((r) => r.file === file)?.state).toBe("current");
    expect(claudeCode.installed(cmd, env, { lean: false }).find((r) => r.file === file)?.state).toBe("stale");
    claudeCode.install(cmd, env, { lean: false });
    expect(JSON.parse(readFileSync(file, "utf8")).hooks.PreToolUse).toBeDefined();
    expect(claudeCode.installed(cmd, env, { lean: true }).find((r) => r.file === file)?.state).toBe("stale");
  });
});

describe("Antigravity permission hooks are never installed", () => {
  it.each([true, false])("removes an old PreToolUse entry, including on re-arm (lean=%s)", (lean) => {
    const file = path.join(home, ".gemini", "config", "hooks.json");
    antigravity.install(cmd, env, { lean });
    const old = JSON.parse(readFileSync(file, "utf8"));
    const reported = JSON.parse(
      readFileSync(
        new URL("../../../conformance/install/antigravity/pre-tool-use-0.5.0.json", import.meta.url),
        "utf8",
      ),
    );
    old.sessionpipe.PreToolUse = reported.config.sessionpipe.PreToolUse;
    old.other = { PreToolUse: [{ command: "my-safety-gate" }] };
    writeFileSync(file, JSON.stringify(old));
    expect(antigravity.installed(cmd, env, { lean })[0]?.state).toBe("stale");
    expect(antigravity.install(cmd, env, { lean })[0]?.changed).toBe(true);
    const repaired = JSON.parse(readFileSync(file, "utf8"));
    expect(repaired.sessionpipe.PreToolUse).toBeUndefined();
    expect(repaired.other).toEqual(old.other);
    expect(Object.keys(repaired.sessionpipe)).toEqual([
      "enabled",
      "PreInvocation",
      "PostInvocation",
      "PostToolUse",
      "Stop",
    ]);
    expect(antigravity.install(cmd, env, { lean })[0]?.changed).toBe(false);
    expect(antigravity.installed(cmd, env, { lean })[0]?.state).toBe("current");
  });
});

// Hash the exact bytes written by the pre-fix adapters, including whitespace and
// command arguments. Antigravity changes must not alter another harness's hooks.
describe("other harnesses keep their installed bytes", () => {
  it.each([true, false])("matches the baseline hook files (lean=%s)", (lean) => {
    const hashes: Record<string, string[]> = {};
    for (const a of [claudeCode, codex, geminiCli]) {
      const reports = a.install(cmd, env, { lean });
      hashes[a.name] = reports.map((r) => createHash("sha256").update(readFileSync(r.file)).digest("hex"));
    }
    expect(hashes).toMatchSnapshot();
  });
});
