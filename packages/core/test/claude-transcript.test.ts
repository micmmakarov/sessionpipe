// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readClaude } from "../src/readers/transcripts.js";

// A message the person sends while a turn is running is not a `user` record. Claude Code
// (measured on 2.1.293, 2026-10-07) writes it as a `queued_command` attachment that the
// running turn absorbs, so a reader of `user` records alone drops the person's words. The
// same record carries task notifications and other sessions' messages (`origin.kind`
// task-notification / peer); older versions wrote it with no origin.
const at = (s: number) => new Date(Date.UTC(2026, 9, 7, 22, 0, s)).toISOString();
const ask = (text: string, s: number) =>
  JSON.stringify({
    type: "user",
    timestamp: at(s),
    isSidechain: false,
    origin: { kind: "human" },
    message: { role: "user", content: text },
  });
const say = (text: string, s: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: at(s),
    isSidechain: false,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
const toolCall = (s: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: at(s),
    isSidechain: false,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
    },
  });
const toolResult = (s: number) =>
  JSON.stringify({
    type: "user",
    timestamp: at(s),
    isSidechain: false,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" }] },
  });
const queued = (
  prompt: unknown,
  s: number,
  fields: Record<string, unknown> = { origin: { kind: "human" }, humanTurn: true },
) =>
  JSON.stringify({
    parentUuid: "a5740983-e84f-440c-b3b7-95c611167045",
    isSidechain: false,
    attachment: {
      type: "queued_command",
      prompt,
      source_uuid: "8eace144-f419-4685-9c92-a0a114b9c3f4",
      commandMode: "prompt",
      timestamp: at(s),
      ...fields,
    },
    type: "attachment",
    uuid: "a03fb76a-84bb-4000-a810-28570b1400d5",
    timestamp: at(s),
  });
const exchanges = (lines: string[]) => readClaude(lines, 0).turns.map((t) => [t.user, t.assistant]);

describe("a Claude Code transcript", () => {
  it("keeps a message sent mid-turn, with what was said after it", () => {
    const lines = [
      ask("fix the build", 0),
      say("Looking at the build first.", 1),
      toolCall(2),
      queued("also run the tests", 3),
      toolResult(4),
      say("The build is fixed and the tests pass.", 5),
    ];
    expect(exchanges(lines)).toEqual([
      ["fix the build", "Looking at the build first."],
      ["also run the tests", "The build is fixed and the tests pass."],
    ]);
  });

  it("adds a mid-turn message to the ask when nothing has been said yet", () => {
    const lines = [
      ask("fix the build", 0),
      toolCall(1),
      queued("use npm, not yarn", 2),
      toolResult(3),
      say("Done.", 4),
    ];
    expect(exchanges(lines)).toEqual([["fix the build\n\nuse npm, not yarn", "Done."]]);
  });

  it("reads the text of a queued prompt that carries images", () => {
    const prompt = [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "text", text: "this screenshot shows the bug" },
    ];
    const lines = [
      ask("fix the build", 0),
      say("On it.", 1),
      queued(prompt, 2),
      say("Fixed the bug in the screenshot.", 3),
    ];
    expect(exchanges(lines)[1]).toEqual(["this screenshot shows the bug", "Fixed the bug in the screenshot."]);
  });

  it("reads a queued prompt written before Claude Code recorded an origin", () => {
    const lines = [ask("fix the build", 0), say("On it.", 1), queued("and the docs", 2, {}), say("Docs too.", 3)];
    expect(exchanges(lines)[1]).toEqual(["and the docs", "Docs too."]);
  });

  it("skips task notifications and messages from other sessions", () => {
    const note = "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>";
    const lines = [
      ask("fix the build", 0),
      queued(note, 1, { origin: { kind: "task-notification" }, commandMode: "task-notification" }),
      queued(note, 2, { commandMode: "task-notification" }),
      queued("status from another session", 3, { origin: { kind: "peer" } }),
      say("Done.", 4),
    ];
    expect(exchanges(lines)).toEqual([["fix the build", "Done."]]);
  });

  it("holds the cursor before a mid-turn message that has no reply yet", () => {
    const lines = [ask("fix the build", 0), say("Done.", 1), queued("one more thing", 2)];
    const read = readClaude(lines, 0);
    expect(read.turns.map((t) => t.user)).toEqual(["fix the build"]);
    expect(read.line).toBe(2);
    expect(readClaude([...lines, say("Also done.", 3)], read.line).turns.map((t) => [t.user, t.assistant])).toEqual([
      ["one more thing", "Also done."],
    ]);
  });
});
