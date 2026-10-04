// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookHealthWarnings } from "../src/hook-health.js";

let dir: string;
let file: string;
const now = Date.parse("2026-10-04T23:00:00Z");
const beat = (event: string, at = now - 120_000, harness = "antigravity") =>
  JSON.stringify({ harness, event, at, ms: 1.3 });
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sp-health-"));
  file = path.join(dir, "timing.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("hook health over the last 24 hours", () => {
  it("flags the reported PreToolUse → PostInvocation pattern, even behind other harness traffic", async () => {
    writeFileSync(
      file,
      [
        beat("PostToolUse", now - 25 * 3600_000),
        ...Array.from({ length: 4 }, () => [beat("PreToolUse"), beat("PostInvocation")]).flat(),
        "bad json",
        "null",
        JSON.stringify({ harness: "antigravity", event: "PostToolUse" }),
        ...Array.from({ length: 150 }, () => beat("PostToolUse", now - 1000, "claude-code")),
        '{"partial":',
      ].join("\n"),
    );
    expect(await hookHealthWarnings(file, now)).toEqual([
      expect.stringMatching(
        /4 PreToolUse.*zero PostToolUse.*last 24 hours.*blocking tool calls.*sessionpipe install.*restart Antigravity/,
      ),
    ]);
  });

  it("a completion in the window clears the warning, including during the grace minute", async () => {
    writeFileSync(file, [beat("PreToolUse"), beat("PostToolUse", now - 1000)].join("\n"));
    expect(await hookHealthWarnings(file, now)).toEqual([]);
  });

  it("does not diagnose a recent in-flight call, old history, future records or another harness", async () => {
    writeFileSync(
      file,
      [
        beat("PreToolUse", now - 10_000),
        beat("PreToolUse", now - 25 * 3600_000),
        beat("PreToolUse", now + 1000),
        beat("PreToolUse", now - 120_000, "codex"),
      ].join("\n"),
    );
    expect(await hookHealthWarnings(file, now)).toEqual([]);
  });

  it("tolerates a missing or empty log", async () => {
    expect(await hookHealthWarnings(file, now)).toEqual([]);
    writeFileSync(file, "");
    expect(await hookHealthWarnings(file, now)).toEqual([]);
  });
});
