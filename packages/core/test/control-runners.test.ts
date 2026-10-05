// SPDX-License-Identifier: Apache-2.0
// Codex and Antigravity as the control daemon drives them (CONTROL.md §6): the command
// lines per mode, and their output read line by line. The lines follow the shapes
// measured from codex-cli 0.160.0 and agy 1.2.16 on 2026-10-04 (Codex's two warning
// items verbatim from a run in a box); the texts in them are made up.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agyArgs, agyError, agyLine, reading as agyReading, findAgy } from "../src/adapters/antigravity-control.js";
import {
  codexArgs,
  codexLine,
  codexLogin,
  reading as codexReading,
  findCodex,
  findRollout,
} from "../src/adapters/codex-control.js";
import { drivableHarnesses, runHeadless } from "../src/adapters/index.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sp-runners-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const j = (o: unknown) => JSON.stringify(o);
const THREAD = "0199b6f2-7c1d-7e3a-9b4c-5d6e7f8a9b0c";
const CONV = "5d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";

/** A codex exec --json run, in codex-cli 0.160.0's shapes. */
const CODEX_RUN = [
  j({ type: "thread.started", thread_id: THREAD }),
  j({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "error",
      message:
        "`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.",
    },
  }),
  j({
    type: "item.completed",
    item: { id: "item_2", type: "error", message: "clamping SessionEnd hook timeout to 3s in /root/.codex/hooks.json" },
  }),
  j({ type: "turn.started" }),
  j({ type: "item.completed", item: { id: "item_3", type: "reasoning", text: "**Listing files**" } }),
  j({ type: "item.completed", item: { id: "item_4", type: "agent_message", text: "I'll look at the folder." } }),
  j({
    type: "item.started",
    item: { id: "item_5", type: "command_execution", command: "ls", aggregated_output: "", status: "in_progress" },
  }),
  j({
    type: "item.completed",
    item: {
      id: "item_5",
      type: "command_execution",
      command: "ls",
      aggregated_output: "a.txt\n",
      exit_code: 0,
      status: "completed",
    },
  }),
  j({ type: "item.completed", item: { id: "item_6", type: "agent_message", text: "There is one file, a.txt." } }),
  j({ type: "turn.completed", usage: { input_tokens: 9120, cached_input_tokens: 0, output_tokens: 41 } }),
];

/** An agy -p --output-format stream-json run, in agy 1.2.16's shapes. */
const AGY_RUN = [
  j({ event: "init", conversation_id: CONV, init: { cwd: "/work/app", permission_mode: "default" } }),
  j({
    event: "step_update",
    step_update: { conversation_id: CONV, step_index: 0, state: "DONE", step_type: "user_input" },
  }),
  j({
    event: "step_update",
    step_update: {
      conversation_id: CONV,
      step_index: 1,
      state: "ACTIVE",
      step_type: "agent_response",
      text_delta: "Checking ",
    },
  }),
  j({
    event: "step_update",
    step_update: {
      conversation_id: CONV,
      step_index: 1,
      state: "DONE",
      step_type: "agent_response",
      text_delta: "the folder.",
    },
  }),
  j({ event: "step_update", step_update: { conversation_id: CONV, step_index: 2, state: "DONE", step_type: "tool" } }),
  j({
    event: "step_update",
    step_update: {
      conversation_id: CONV,
      step_index: 3,
      state: "DONE",
      step_type: "agent_response",
      text_delta: "One file.",
    },
  }),
  j({
    event: "result",
    result: {
      conversation_id: CONV,
      status: "SUCCESS",
      response: "Checking the folder.\n\nOne file.",
      error: "",
      denied_actions: [{ tool_name: "run_command" }],
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  }),
];

describe("codex exec --json", () => {
  it("command lines: a new session in its folder, a resume by id, the text after --", () => {
    expect(codexArgs({ mode: "safe", prompt: "-v fix it", cwd: "/w" })).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      "/w",
      "-s",
      "workspace-write",
      "--",
      "-v fix it",
    ]);
    // `codex exec resume` takes neither -s nor --approve-for-me (0.160 refuses them as
    // unexpected arguments): a resume says the same in config overrides.
    expect(codexArgs({ mode: "auto", prompt: "go on", resume: THREAD })).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      'approval_policy="on-request"',
      "-c",
      'approvals_reviewer="auto_review"',
      "--",
      THREAD,
      "go on",
    ]);
    expect(codexArgs({ mode: "safe", prompt: "go on", resume: THREAD }).join(" ")).toContain(
      '-c sandbox_mode="workspace-write" --',
    );
    expect(codexArgs({ mode: "auto", prompt: "x", cwd: "/w" })).toContain("--approve-for-me");
    // Never a bypass flag, in either mode.
    for (const mode of ["safe", "auto"] as const)
      expect(codexArgs({ mode, prompt: "x", cwd: "/w" }).join(" ")).not.toMatch(/dangerously|full-auto/);
  });

  it("reads the id, the messages, and error items as warnings", () => {
    expect(codexLine(CODEX_RUN[0] as string)).toEqual({ session: THREAD });
    expect(codexLine(CODEX_RUN[1] as string)).toHaveProperty("warning");
    expect(codexLine(CODEX_RUN[4] as string)).toBeNull(); // reasoning
    expect(codexLine(CODEX_RUN[5] as string)).toEqual({ message: "I'll look at the folder." });
    expect(codexLine(j({ type: "turn.failed", error: { message: "usage limit" } }))).toEqual({
      done: true,
      failed: "usage limit",
    });
    expect(codexLine(j({ type: "error", message: "Reconnecting... 2/5 (stream disconnected)" }))).toEqual({
      note: "Reconnecting... 2/5 (stream disconnected)",
    });
    expect(codexLine("Reading additional input from stdin...")).toBeNull();
    const r = codexReading();
    const changed = CODEX_RUN.map((l) => r.feed(l));
    expect(changed.filter(Boolean)).toHaveLength(2);
    expect(r.session).toBe(THREAD);
    expect(r.warnings).toHaveLength(2);
    expect(r.outcome({ code: 0, signal: null, stderr: "" })).toEqual({
      reply: "I'll look at the folder.\n\nThere is one file, a.txt.",
    });
  });

  it("fails on turn.failed, or on a non-zero exit that said nothing — never on a warning", () => {
    const failed = codexReading();
    for (const l of [CODEX_RUN[0], j({ type: "turn.failed", error: { message: "You've hit your usage limit." } })])
      failed.feed(l as string);
    expect(failed.outcome({ code: 1 })).toEqual({ failed: "You've hit your usage limit." });

    const silent = codexReading();
    for (const l of [CODEX_RUN[0], CODEX_RUN[1], j({ type: "error", message: "Reconnecting... 5/5" })])
      silent.feed(l as string);
    expect(silent.outcome({ code: 1, signal: null, stderr: "Reading additional input from stdin...\n" })).toEqual({
      failed: "Codex exited (code 1) without an answer: Reconnecting... 5/5",
    });
    const quiet = codexReading();
    quiet.feed(CODEX_RUN[0] as string);
    expect(
      quiet.outcome({ code: 2, stderr: "Reading additional input from stdin...\nerror: no such session\n" }),
    ).toEqual({ failed: "Codex exited (code 2) without an answer: error: no such session" });
    // A message, then a non-zero exit: the answer stands.
    const said = codexReading();
    said.feed(CODEX_RUN[5] as string);
    expect(said.outcome({ code: 1 })).toEqual({ reply: "I'll look at the folder." });
    expect(codexReading().outcome({ error: "spawn ENOENT" })).toEqual({ failed: "couldn't start Codex: spawn ENOENT" });
    expect(codexReading().outcome({ timedOut: true, code: null, signal: "SIGTERM" })).toHaveProperty("failed");
  });

  // Runs a fake executable (a shell script), as the spawn test below does: POSIX only.
  it.runIf(process.platform !== "win32")(
    "login: CODEX_API_KEY is enough; else `codex login status` decides by exit code",
    async () => {
      const bin = path.join(tmp, "codex-login");
      const say = (code: number) =>
        writeFileSync(bin, `#!/bin/sh\n[ "$1 $2" = "login status" ] || exit 9\necho "Not logged in"\nexit ${code}\n`);
      say(1);
      chmodSync(bin, 0o755);
      expect(await codexLogin(bin, { PATH: process.env.PATH })).toEqual({ loggedIn: false });
      expect(await codexLogin(bin, { PATH: process.env.PATH, CODEX_API_KEY: "sk-test" })).toMatchObject({
        loggedIn: true,
      });
      say(0);
      expect(await codexLogin(bin, { PATH: process.env.PATH })).toEqual({ loggedIn: true });
      expect(await codexLogin(path.join(tmp, "nope"), {})).toEqual({ loggedIn: null });
    },
  );

  it("finds a thread's rollout by its exact id, never by a fragment", () => {
    const home = path.join(tmp, "codex-home");
    const day = path.join(home, "sessions", "2026", "10", "04");
    mkdirSync(day, { recursive: true });
    const f = path.join(day, `rollout-2026-10-04T10-00-00-${THREAD}.jsonl`);
    writeFileSync(f, "");
    expect(findRollout(THREAD, { CODEX_HOME: home })).toBe(f);
    expect(findRollout("0199b6f2", { CODEX_HOME: home })).toBeNull();
    expect(findRollout("-", { CODEX_HOME: home })).toBeNull();
  });
});

describe("agy --output-format stream-json", () => {
  it("command lines: a conversation in the folder it runs in, --conversation to go on", () => {
    expect(agyArgs({ mode: "safe", prompt: "hi" })).toEqual(["-p", "hi", "--output-format", "stream-json"]);
    expect(agyArgs({ mode: "auto", prompt: "go on", resume: CONV })).toEqual([
      "--conversation",
      CONV,
      "-p",
      "go on",
      "--output-format",
      "stream-json",
      "--mode",
      "accept-edits",
    ]);
    // A message that starts with a dash is still the prompt.
    expect(agyArgs({ mode: "safe", prompt: "--help me" })[1]).toBe(" --help me");
    for (const mode of ["safe", "auto"] as const)
      expect(agyArgs({ mode, prompt: "x" }).join(" ")).not.toMatch(/dangerously|skip-permissions/);
  });

  it("reads the id, the text as it streams (a paragraph per response step), the result", () => {
    expect(agyLine(AGY_RUN[0] as string)).toEqual({ session: CONV });
    expect(agyLine(AGY_RUN[2] as string)).toEqual({ session: CONV, delta: { step: 1, text: "Checking " } });
    const r = agyReading();
    const texts: string[] = [];
    for (const l of AGY_RUN) if (r.feed(l)) texts.push(r.text);
    expect(texts).toEqual(["Checking ", "Checking the folder.", "Checking the folder.\n\nOne file."]);
    expect(r.session).toBe(CONV);
    expect(r.outcome({ code: 0 })).toEqual({
      reply:
        "Checking the folder.\n\nOne file.\n\n(Not allowed on this machine, since nobody was there to approve: run_command.)",
    });
  });

  it("an ERROR result reports its error; no result reports AGY_ERROR from stderr", () => {
    const r = agyReading();
    r.feed(AGY_RUN[0] as string);
    r.feed(
      j({
        event: "result",
        result: { conversation_id: CONV, status: "ERROR", response: "", error: "quota exceeded", denied_actions: [] },
      }),
    );
    expect(r.outcome({ code: 3 })).toEqual({ failed: "quota exceeded" });
    const none = agyReading();
    none.feed(AGY_RUN[0] as string);
    const stderr =
      'warning: something\nAGY_ERROR: {"code":"UNAUTHENTICATED","message":"Sign in to Antigravity first"}\n';
    expect(agyError(stderr)).toBe("Sign in to Antigravity first");
    expect(none.outcome({ code: 3, signal: null, stderr })).toEqual({
      failed: "Antigravity exited (code 3) without an answer: Sign in to Antigravity first",
    });
  });
});

describe("finding the binaries, and running one", () => {
  // Runs a fake executable (a shell script), as the spawn test below does: POSIX only.
  it.runIf(process.platform !== "win32")(
    "SESSIONPIPE_CODEX / SESSIONPIPE_AGY first, then PATH, then the installers' folders",
    () => {
      const bin = path.join(tmp, "bin");
      mkdirSync(bin, { recursive: true });
      for (const n of ["codex", "agy", "my-codex"]) {
        writeFileSync(path.join(bin, n), "#!/bin/sh\n");
        chmodSync(path.join(bin, n), 0o755);
      }
      const empty = path.join(tmp, "empty");
      mkdirSync(empty, { recursive: true });
      expect(findCodex({ PATH: bin }, empty, empty)).toBe(path.join(bin, "codex"));
      expect(findCodex({ PATH: empty, SESSIONPIPE_CODEX: path.join(bin, "my-codex") }, empty, empty)).toBe(
        path.join(bin, "my-codex"),
      );
      // Beside the node that runs the daemon (an npm install -g there).
      expect(findCodex({ PATH: empty }, empty, bin)).toBe(path.join(bin, "codex"));
      expect(findAgy({ PATH: bin }, empty)).toBe(path.join(bin, "agy"));
      const home = path.join(tmp, "home");
      mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
      writeFileSync(path.join(home, ".local", "bin", "agy"), "#!/bin/sh\n");
      chmodSync(path.join(home, ".local", "bin", "agy"), 0o755);
      expect(findAgy({ PATH: empty }, home)).toBe(path.join(home, ".local", "bin", "agy"));
      expect(drivableHarnesses({ PATH: bin, SESSIONPIPE_CLAUDE: path.join(bin, "codex") })).toEqual(
        expect.arrayContaining(["claude-code", "codex", "antigravity"]),
      );
    },
  );

  it.runIf(process.platform !== "win32")(
    "runHeadless streams every line, keeps only what it is told, and closes stdin",
    async () => {
      const bin = path.join(tmp, "talk");
      writeFileSync(
        bin,
        `#!/bin/sh\nread x && echo "stdin open: $x" >&2\nprintf '{"a":1}\\n{"type":"result"}\\n{"b":2}'\nexit 0\n`,
      );
      chmodSync(bin, 0o755);
      const lines: string[] = [];
      const res = await runHeadless(bin, [], { cwd: tmp, env: process.env, onLine: (l) => lines.push(l) });
      expect(lines).toEqual(['{"a":1}', '{"type":"result"}', '{"b":2}']);
      expect(res.stdout).toBe("");
      expect(res.stderr).not.toContain("stdin open");
      const kept = await runHeadless(bin, [], {
        cwd: tmp,
        env: process.env,
        onLine: () => {},
        keep: (l) => l.includes("result"),
      });
      expect(kept.stdout).toBe('{"type":"result"}');
    },
  );
});
