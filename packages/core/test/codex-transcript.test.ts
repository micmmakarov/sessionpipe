// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexFacts } from "../src/adapters/codex.js";
import { codexInjected, readCodex } from "../src/readers/transcripts.js";

// Codex writes the AGENTS.md it read into the session as a "user" message (measured on
// codex-cli 0.160.0, 2026-10-04): a turn and a title built from it named the
// instructions instead of what the person asked.
const user = (text: string) =>
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-10-04T12:00:00Z",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
const assistant = (text: string) =>
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-10-04T12:00:05Z",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  });
const ROLLOUT = [
  JSON.stringify({ type: "session_meta", payload: { cwd: "/workspace", cli_version: "0.160.0" } }),
  user("# AGENTS.md instructions for /workspace\n\n<INSTRUCTIONS>\n# This machine\n…\n</INSTRUCTIONS>"),
  user("<environment_context>\n  <cwd>/workspace</cwd>\n</environment_context>"),
  user("what folder are you in?"),
  assistant("/workspace"),
];

describe("a Codex rollout", () => {
  it("knows Codex's own injections from the person's words", () => {
    expect(codexInjected("# AGENTS.md instructions for /workspace\n\n<INSTRUCTIONS>")).toBe(true);
    expect(codexInjected("<environment_context>")).toBe(true);
    expect(codexInjected("fix the AGENTS.md instructions please")).toBe(false);
  });

  it("pairs the person's ask with the answer, not the instructions", () => {
    const read = readCodex(ROLLOUT, 0);
    expect(read.turns.map((t) => [t.user, t.assistant])).toEqual([["what folder are you in?", "/workspace"]]);
  });

  it("titles the session after the first real ask", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sp-codex-"));
    const file = path.join(dir, "rollout-2026-10-04T12-00-00-01a10928-77cd-7080-b626-70eff7eff680.jsonl");
    writeFileSync(file, `${ROLLOUT.join("\n")}\n`);
    expect(codexFacts(file)).toMatchObject({
      cwd: "/workspace",
      title: "what folder are you in?",
      title_source: "first-ask",
    });
  });
});
