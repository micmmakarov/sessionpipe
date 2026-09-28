// SPDX-License-Identifier: Apache-2.0
// Issue #9 (no event lost to the lock race) and advisory GHSA-8f6f-c3c9-j5p6
// (the outbox holds redacted strings at rest, 0600/0700).
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Outbox } from "@sessionpipe/core";
import { afterEach, describe, expect, it } from "vitest";
import { enqueueJob, runJob, sweepJobs } from "../src/run.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sp-run-"));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
process.env.SESSIONPIPE_CONFIG = path.join(tmp, "config.json");
writeFileSync(process.env.SESSIONPIPE_CONFIG, JSON.stringify({ sinks: [], harnesses: {} }));

const job = (event: string, extra: Record<string, unknown> = {}) => ({
  harness: "codex",
  event,
  argv: ["codex", event],
  stdin: JSON.stringify({ session_id: "race-1", cwd: tmp, hook_event_name: event, model: "m", ...extra }),
  cwd: tmp,
  env: {},
  at: Date.now(),
});

describe("runJob", () => {
  it("four concurrent hooks of one session all reach the outbox, in seq order", async () => {
    const jobs = [
      job("SessionStart", { source: "startup" }),
      job("UserPromptSubmit", { prompt: "hi" }),
      job("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "a" }),
      job("Stop"),
    ];
    await Promise.all(jobs.map((j) => runJob(j, { state: tmp })));
    const { events } = new Outbox(tmp).read({ harness: "codex", session: "race-1" }, 0, 100);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.session.seq)).toEqual([0, 1, 2, 3]);
  });
  it("stores tool input redacted at rest, in 0600 files under 0700 dirs", async () => {
    await runJob(
      job("PostToolUse", {
        tool_name: "Bash",
        tool_input: { command: "export DB_PASSWORD=hunter2" },
        tool_response: "ok",
        tool_use_id: "b",
      }),
      { state: tmp },
    );
    const f = new Outbox(tmp).file({ harness: "codex", session: "race-1" });
    const text = readFileSync(f, "utf8");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("[redacted]");
    if (process.platform !== "win32") {
      expect(statSync(f).mode & 0o777).toBe(0o600);
      expect(statSync(path.dirname(f)).mode & 0o777).toBe(0o700);
    }
  });
  it("sweepJobs runs a job another worker left behind", async () => {
    const f = enqueueJob(tmp, job("SessionEnd", { reason: "exit" }));
    const old = new Date(Date.now() - 10_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(f, old, old);
    expect(await sweepJobs(tmp, 3000)).toBe(1);
    const { events } = new Outbox(tmp).read({ harness: "codex", session: "race-1" }, 0, 100);
    expect(events.some((e) => e.type === "session.ended")).toBe(true);
  });
});
