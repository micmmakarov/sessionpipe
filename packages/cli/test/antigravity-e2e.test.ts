// SPDX-License-Identifier: Apache-2.0
// Exercise the built CLI and the real update re-arm path, with only npm replaced.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Exec, execCapture, installVersion } from "../src/update.js";

const built = fileURLToPath(new URL("../dist/", import.meta.url));
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;
let home: string;
let env: NodeJS.ProcessEnv;
let file: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "sp-ag-"));
  env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SESSIONPIPE_CONFIG: path.join(home, "config.json"),
    SESSIONPIPE_STATE: path.join(home, "state"),
    SESSIONPIPE_DATA: path.join(home, "data"),
    SESSIONPIPE_NO_WORKER: "1",
    SESSIONPIPE_CLAUDE: path.join(home, "no-claude"),
    SESSIONPIPE_SECRETS: "file",
    GEMINI_CLI_HOME: path.join(home, ".gemini"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CODEX_HOME: path.join(home, ".codex"),
  };
  file = path.join(env.GEMINI_CLI_HOME!, "config", "hooks.json");
  mkdirSync(path.dirname(file), { recursive: true });
  mkdirSync(env.SESSIONPIPE_STATE!);
  // A full install: the old version otherwise skipped PreToolUse for tier 0.
  writeFileSync(
    env.SESSIONPIPE_CONFIG!,
    JSON.stringify({
      harnesses: { antigravity: { enabled: true } },
      sinks: [{ name: "local", url: "stdout", tier: 1 }],
    }),
  );
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(built, "cli.js"), ...args], {
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}
function seedOld() {
  const reported = JSON.parse(
    readFileSync(new URL("../../../conformance/install/antigravity/pre-tool-use-0.5.0.json", import.meta.url), "utf8"),
  );
  writeFileSync(
    file,
    JSON.stringify({
      ...reported.config,
      other: { PreToolUse: [{ command: "my-safety-gate" }] },
    }),
  );
}
function expectRepaired() {
  const hooks = JSON.parse(readFileSync(file, "utf8"));
  expect(hooks.sessionpipe.PreToolUse).toBeUndefined();
  expect(hooks.sessionpipe.PostToolUse[0].matcher).toBe("*");
  expect(hooks.other.PreToolUse).toEqual([{ command: "my-safety-gate" }]);
}

describe.skipIf(!existsSync(path.join(built, "cli.js")))("Antigravity recovery", () => {
  it("install repairs existing hooks and is idempotent", () => {
    seedOld();
    expect(cli("install", "--antigravity", "--backfill", "0")).toContain("restart Antigravity");
    expectRepaired();
    const before = readFileSync(file);
    cli("install", "--antigravity", "--backfill", "0");
    expect(readFileSync(file)).toEqual(before);
  });

  it.skipIf(process.platform === "win32")(
    "update executes the new install command and removes the old hook",
    async () => {
      seedOld();
      const prefix = path.join(home, "prefix");
      const dist = path.join(prefix, "lib", "node_modules", "sessionpipe", "dist");
      cpSync(built, dist, { recursive: true });
      mkdirSync(path.join(prefix, "bin"), { recursive: true });
      writeFileSync(path.join(prefix, "bin", "sessionpipe"), "");
      const calls: string[][] = [];
      const exec: Exec = async (argv, opts) => {
        calls.push(argv);
        if (argv.includes("--global")) return { code: 0, stdout: "", stderr: "" };
        return execCapture(argv, opts);
      };
      const r = await installVersion(version, {
        node: process.execPath,
        distDir: dist,
        harnesses: ["antigravity"],
        env,
        exec,
      });
      expect(r).toMatchObject({ ok: true, hooks: "hooks re-armed for antigravity" });
      expect(calls.at(-1)).toEqual([
        process.execPath,
        path.join(dist, "cli.js"),
        "install",
        "--backfill",
        "0",
        "--antigravity",
      ]);
      expectRepaired();
    },
  );

  it("doctor exposes the blocking pattern in JSON and text, and explains the stale entry", () => {
    seedOld();
    writeFileSync(
      path.join(env.SESSIONPIPE_STATE!, "timing.jsonl"),
      ["PreToolUse", "PostInvocation", "PreToolUse", "PostInvocation"]
        .map((event) => JSON.stringify({ at: Date.now() - 120_000, harness: "antigravity", event, ms: 1.3 }))
        .join("\n"),
    );
    const report = JSON.parse(cli("doctor", "--json"));
    expect(report.warnings).toContainEqual(
      expect.stringMatching(/2 PreToolUse.*zero PostToolUse.*blocking tool calls/),
    );
    expect(report.harnesses.antigravity[0]).toMatchObject({
      state: "stale",
      note: expect.stringContaining("PreToolUse can block"),
    });
    expect(cli("doctor")).toMatch(/2 PreToolUse.*zero PostToolUse.*blocking tool calls/);
  });

  it.each(["PreToolUse", "PreInvocation", "PostInvocation", "PostToolUse", "Stop"])(
    "the built hook answers only observer events (%s)",
    (event) => {
      const r = spawnSync(process.execPath, [path.join(built, "hook.js"), "antigravity", event], {
        env,
        input: JSON.stringify({ conversationId: "test", stepIdx: 2 }),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(event === "PreToolUse" ? "" : "{}\n");
    },
  );
});
