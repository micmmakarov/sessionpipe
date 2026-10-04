// SPDX-License-Identifier: Apache-2.0
// Synthetic unit inputs based on the documented contract, not recorded fixtures.
import { describe, expect, it } from "vitest";
import { antigravity } from "../src/adapters/antigravity.js";

const hook = (event: string, payload: Record<string, unknown>) =>
  antigravity.fromHook({ argv: ["antigravity", event], stdin: JSON.stringify(payload), env: {}, cwd: "/project" });

describe("Antigravity observes tools without a permission hook", () => {
  it("ignores old PreToolUse jobs, without an empty JSON answer or fabricated start", () => {
    expect(hook("PreToolUse", { conversationId: "c1", toolCall: { name: "run_command" } })).toBeNull();
    expect(hook("PreToolUse", {})).toBeNull();
  });

  it.each([undefined, "tool failed"])("a documented PostToolUse payload preserves activity (error=%s)", (error) => {
    const r = hook("PostToolUse", {
      conversationId: "c1",
      workspacePaths: ["/project"],
      transcriptPath: "/missing/transcript.jsonl",
      stepIdx: 4,
      error,
    });
    expect(r).toMatchObject({
      session: { id: "c1" },
      stdout: "{}\n",
      transcript: "/missing/transcript.jsonl",
      events: [{ type: "session.heartbeat", data: {}, harnessEvent: "PostToolUse" }],
    });
    expect(r?.events).toHaveLength(1);
  });

  it.each([{ toolCall: { name: "run_command", args: { command: "pwd" } } }, { toolName: "run_command" }])(
    "keeps a supplied tool name without requiring an earlier start",
    (fields) => {
      const r = hook("PostToolUse", { conversationId: "c1", error: "failed", ...fields });
      expect(r?.events).toHaveLength(1);
      expect(r?.events[0]).toMatchObject({
        type: "tool.ended",
        data: { tool: "run_command", ok: false, error: "failed" },
      });
      expect(r?.stdout).toBe("{}\n");
    },
  );
});
