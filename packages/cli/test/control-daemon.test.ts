// SPDX-License-Identifier: Apache-2.0
// The control daemon end to end against an in-process receiver: pairing with a
// proof, every delivery mode, permission answers, refusals, acks — and the built
// hook answering a Stop and a PermissionRequest through the socket.
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Carried, ControlDaemon, type SdkHost } from "../src/control/daemon.js";
import { ask } from "../src/control/local.js";
import { pair } from "../src/control/pair.js";
import { routePrompt } from "../src/control/route.js";
import { type ControlConfig, readControl } from "../src/control/store.js";
import { waitForMessage } from "../src/control/wait.js";
import { FakeReceiver } from "./helpers/receiver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SID = "8c132906-8c3f-4814-870a-afc3d05e1d2e";
const SESSION = `claude-code:${SID}`;

let tmp: string;
let rx: FakeReceiver;
let d: ControlDaemon | null = null;
let env: NodeJS.ProcessEnv;
let sock: string;
let project: string;
let configDir: string;
let claudeLog: string;
let fakeClaude: string;

function transcript(sid: string, cwd: string): void {
  const dir = path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${sid}.jsonl`);
  writeFileSync(f, `${JSON.stringify({ type: "user", cwd, message: { content: "hi" } })}\n`);
  // Written ten minutes ago: a transcript written in the last 90 s counts as live.
  const past = new Date(Date.now() - 600_000);
  utimesSync(f, past, past);
}

function cfg(folders = [project]): ControlConfig {
  return {
    name: "testbox",
    folders,
    mode: "safe",
    receivers: [
      {
        url: rx.url,
        control: `${rx.url}/api/sessionpipe/v1/control`,
        rpId: "localhost",
        machine: rx.machine,
        token: rx.token,
        keys: [{ ...rx.passkey.key, added_at: new Date().toISOString() }],
        paired_at: new Date().toISOString(),
      },
    ],
  };
}

async function startDaemon(o: { folders?: string[]; sdk?: SdkHost; fork?: boolean } = {}) {
  d = new ControlDaemon(cfg(o.folders), path.join(tmp, "state", "control"), sock, {
    now: Date.now,
    fetch,
    log: () => {},
    claudeDirs: () => [configDir],
    claude: () => ({
      bin: fakeClaude,
      caps: { hasMode: true, modes: ["default", "dontAsk"], promptsNone: false, fork: o.fork ?? true },
    }),
    run: (bin, args, opts) =>
      new Promise((resolve) => {
        const c = spawn(bin, args, { cwd: opts.cwd, env: opts.env });
        let out = "";
        c.stdout.on("data", (b) => {
          out += b;
        });
        c.on("close", (code) =>
          resolve({ code, signal: null, stdout: out, tooBig: false, stderr: "", timedOut: false }),
        );
      }),
    sdk: o.sdk ?? null,
    env,
  });
  await d.start();
}

beforeAll(async () => {
  rx = new FakeReceiver();
  await rx.start();
});
afterAll(async () => {
  await rx.stop();
});

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "sp-control-"));
  project = path.join(tmp, "project");
  configDir = path.join(tmp, "claude-config");
  mkdirSync(project, { recursive: true });
  mkdirSync(path.join(configDir, "sessions"), { recursive: true });
  sock = path.join(tmp, "control.sock");
  claudeLog = path.join(tmp, "claude-calls.jsonl");
  fakeClaude = path.join(tmp, "claude");
  // A stand-in `claude -p`: records its argv and answers like --output-format json.
  writeFileSync(
    fakeClaude,
    `#!/usr/bin/env node
const a = process.argv.slice(2);
require("fs").appendFileSync(${JSON.stringify(claudeLog)}, JSON.stringify(a) + "\\n");
const i = a.indexOf("--resume"), j = a.indexOf("--session-id");
let sid = i >= 0 ? a[i + 1] : j >= 0 ? a[j + 1] : "x";
if (a.includes("--fork-session")) sid = "0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8b";
process.stdout.write(JSON.stringify({ type: "result", result: "did it: " + a[a.length - 1].split("\\n").pop(), session_id: sid, is_error: false }));
`,
  );
  chmodSync(fakeClaude, 0o755);
  env = {
    ...process.env,
    SESSIONPIPE_STATE: path.join(tmp, "state"),
    SESSIONPIPE_CONFIG: path.join(tmp, "config", "config.json"),
    SESSIONPIPE_SOCKET: sock,
  };
  transcript(SID, project);
  rx.queue.clear();
  rx.acks.length = 0;
});

afterEach(async () => {
  await d?.stop();
  d = null;
  rmSync(tmp, { recursive: true, force: true });
});

describe("routing (CONTROL.md §6)", () => {
  const base = {
    harness: "claude-code",
    sdk: false,
    waiter: false,
    midTurn: false,
    live: false,
    known: true,
    canFork: true,
    api: false,
  };
  it("takes the first mode that fits", () => {
    expect(routePrompt({ ...base, sdk: true, waiter: true })).toEqual({ mode: "sdk" });
    expect(routePrompt({ ...base, waiter: true, midTurn: true })).toEqual({ mode: "waiter" });
    expect(routePrompt({ ...base, midTurn: true, live: true })).toEqual({ mode: "turn" });
    expect(routePrompt({ ...base })).toEqual({ mode: "resume" });
    expect(routePrompt({ ...base, live: true })).toEqual({ mode: "fork" });
    expect(routePrompt({ ...base, live: true, canFork: false })).toHaveProperty("unsupported");
    expect(routePrompt({ ...base, known: false })).toEqual({ refused: "no_session" });
    expect(routePrompt({ ...base, harness: "codex" })).toHaveProperty("unsupported");
    expect(routePrompt({ ...base, harness: "codex", midTurn: true })).toEqual({ mode: "turn" });
  });
});

describe("pairing (CONTROL.md §2)", () => {
  it("trusts the key only after its proof verifies here", async () => {
    rx.paired = true;
    rx.handKey = "same";
    const out: string[] = [];
    const c = await pair({
      url: rx.url,
      token: rx.sinkToken,
      folders: [project],
      mode: "safe",
      name: "testbox",
      out: (s) => out.push(s),
      sleep: async () => {},
      env,
    });
    expect(c.receivers[0]?.keys.map((k) => k.id)).toEqual([rx.passkey.key.id]);
    expect(c.receivers[0]?.token).toBe(rx.token);
    expect(readControl(env)?.receivers[0]?.machine).toBe(rx.machine);
    expect(out.join("\n")).toContain("123456");
  });
  it("refuses a key swapped in by the receiver", async () => {
    rx.paired = true;
    rx.handKey = "other";
    await expect(
      pair({
        url: rx.url,
        token: rx.sinkToken,
        folders: [project],
        mode: "safe",
        name: "x",
        out: () => {},
        sleep: async () => {},
        env,
      }),
    ).rejects.toThrow(/didn't prove itself/);
    expect(readControl(env)).toBeNull();
    rx.handKey = "same";
  });
});

// The daemon itself is Unix-only for now (a Windows daemon is M7): Unix sockets and a
// shebang stand-in for claude.
const unix = process.platform !== "win32";

describe.runIf(unix)("delivery", () => {
  it("waiter: in place, in milliseconds, framed", async () => {
    await startDaemon();
    const got = waitForMessage(SESSION, { env });
    await new Promise((r) => setTimeout(r, 100));
    const q = await rx.send({ session: SESSION, text: "Add the Oct 8 row" });
    const text = await got;
    const ack = await rx.waitAck(q.id);
    expect(ack).toMatchObject({ outcome: "delivered", mode: "waiter" });
    expect(text).toContain("Add the Oct 8 row");
    expect(text).toContain("sessionpipe control");
    expect(text).toContain("start `sessionpipe wait` again");
    expect(Date.parse(ack.at as string) - Date.parse(q.at)).toBeLessThan(2000);
  });

  it("turn: a message for a session mid-turn is the Stop hook's block, once", async () => {
    await startDaemon();
    await ask(sock, { op: "event", session: SESSION, event: "UserPromptSubmit" }, 500);
    const q = await rx.send({ session: SESSION, text: "also write pong" });
    await new Promise((r) => setTimeout(r, 300));
    expect(rx.finalAck(q.id)).toBeUndefined();
    expect(rx.acks.find((a) => a.id === q.id)?.outcome).toBe("taken");
    // Taken, so the receiver stops handing it back: the long-poll doesn't spin.
    const polls = rx.polls.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(rx.polls.length - polls).toBeLessThanOrEqual(2);
    const r = await ask(sock, { op: "stop", session: SESSION, active: false }, 500);
    expect(r).toMatchObject({ op: "block" });
    expect((r as { reason: string }).reason).toContain("also write pong");
    await ask(sock, { op: "event", session: SESSION, event: "Stop" }, 500);
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered", mode: "turn" });
    expect(await ask(sock, { op: "stop", session: SESSION, active: true }, 500)).toEqual({ op: "none" });
  });

  it("turn: a Stop that didn't take it (it came after the hook asked) reroutes to a resume", async () => {
    await startDaemon();
    await ask(sock, { op: "event", session: SESSION, event: "UserPromptSubmit" }, 500);
    const q = await rx.send({ session: SESSION, text: "late" });
    await new Promise((r) => setTimeout(r, 300));
    await ask(sock, { op: "event", session: SESSION, event: "Stop" }, 500);
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered", mode: "resume" });
  });

  it("resume: no live process — a headless turn, acked taken then delivered with the reply", async () => {
    await startDaemon();
    const q = await rx.send({ session: SESSION, text: "summarize" });
    const ack = await rx.waitAck(q.id);
    expect(ack).toMatchObject({ outcome: "delivered", mode: "resume" });
    expect(ack.reply).toContain("did it: summarize");
    expect(rx.acks.find((a) => a.id === q.id)?.outcome).toBe("taken");
    const call = JSON.parse(readFileSync(claudeLog, "utf8").trim()) as string[];
    expect(call).toEqual(expect.arrayContaining(["-p", "--resume", SID, "--permission-mode", "dontAsk"]));
    expect(call).not.toContain("--fork-session");
  });

  it("fork: a live session is copied, never resumed twice, and later messages go to the copy", async () => {
    writeFileSync(
      path.join(configDir, "sessions", `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: SID }),
    );
    await startDaemon();
    const q = await rx.send({ session: SESSION, text: "one" });
    const ack = await rx.waitAck(q.id);
    expect(ack).toMatchObject({
      outcome: "delivered",
      mode: "fork",
      session: "claude-code:0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8b",
    });
    transcript("0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8b", project);
    const q2 = await rx.send({ session: SESSION, text: "two" });
    await rx.waitAck(q2.id);
    const calls = readFileSync(claudeLog, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string[]);
    expect(calls[1]).toEqual(expect.arrayContaining(["--resume", "0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8b"]));
  });

  it("sdk: start goes through the Agent SDK host, and the next prompt lands in the held session", async () => {
    const sent: string[] = [];
    const host: SdkHost = {
      start: () => ({
        send: async (t: string) => {
          sent.push(t);
          return { reply: `sdk: ${t.split("\n").pop()}` };
        },
        interrupt: async () => {
          sent.push("<interrupt>");
        },
        close: () => {},
        busy: false,
        lastUsed: Date.now(),
      }),
    };
    await startDaemon({ sdk: host });
    const NEW = "0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8c";
    const q = await rx.send({ kind: "start", session: `claude-code:${NEW}`, cwd: project, text: "fix the test" });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered", mode: "sdk", reply: "sdk: fix the test" });
    transcript(NEW, project);
    const q2 = await rx.send({ session: `claude-code:${NEW}`, text: "and push it" });
    expect(await rx.waitAck(q2.id)).toMatchObject({ outcome: "delivered", mode: "sdk" });
    const q3 = await rx.send({ kind: "cancel", session: `claude-code:${NEW}`, text: undefined });
    expect(await rx.waitAck(q3.id)).toMatchObject({ outcome: "delivered", mode: "sdk" });
    expect(sent.at(-1)).toBe("<interrupt>");
  });

  it("start without the SDK is a headless claude -p --session-id", async () => {
    await startDaemon();
    const NEW = "0b6f2c7e-3d4a-4f1b-9c8e-2a1d5e6f7a8d";
    const q = await rx.send({ kind: "start", session: `claude-code:${NEW}`, cwd: project, text: "hello" });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered", mode: "resume" });
    expect(readFileSync(claudeLog, "utf8")).toContain("--session-id");
    // The next message resumes it: the transcript the start just wrote is the daemon's own.
    const dir = path.join(configDir, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"));
    writeFileSync(path.join(dir, `${NEW}.jsonl`), `${JSON.stringify({ type: "user", cwd: project })}\n`);
    const q2 = await rx.send({ session: `claude-code:${NEW}`, text: "again" });
    expect(await rx.waitAck(q2.id)).toMatchObject({ outcome: "delivered", mode: "resume" });
  });

  it("a key added while it runs (control pair again) is trusted on the next poll", async () => {
    await startDaemon();
    const first = rx.passkey;
    rx.passkey = await (await import("../../core/test/helpers/authenticator.js")).Passkey.create({
      rpId: "localhost",
      origin: rx.url,
    });
    try {
      const c = cfg();
      c.receivers[0]!.keys.push({ ...rx.passkey.key, added_at: new Date().toISOString() });
      d!.reload(c);
      const q = await rx.send({ session: SESSION, text: "with the new key" });
      expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered" });
    } finally {
      rx.passkey = first;
    }
  });

  it("cancel with no held session is unsupported", async () => {
    await startDaemon();
    const q = await rx.send({ kind: "cancel", session: SESSION, text: undefined });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "unsupported" });
  });
});

describe.runIf(unix)("permission answers (CONTROL.md §6, §7)", () => {
  const ATT = "perm-5f1c0e9a2b7d4c31";
  it("an open prompt takes the signed answer", async () => {
    await startDaemon();
    const hook = ask(sock, { op: "permission", session: SESSION, attention: ATT, tool: "Bash" }, 10_000);
    await new Promise((r) => setTimeout(r, 100));
    const q = await rx.send({
      kind: "permission.answer",
      session: SESSION,
      text: undefined,
      for: ATT,
      decision: "deny",
      note: "Not on main.",
    });
    expect(await hook).toMatchObject({ op: "decision", behavior: "deny", message: "Not on main." });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "delivered" });
  });
  it("nothing is auto-allowed: an allow with no open prompt is refused, a deny expires", async () => {
    await startDaemon();
    const a = await rx.send({
      kind: "permission.answer",
      session: SESSION,
      text: undefined,
      for: ATT,
      decision: "allow",
    });
    expect(await rx.waitAck(a.id)).toMatchObject({ outcome: "refused", code: "no_attention" });
    const b = await rx.send({
      kind: "permission.answer",
      session: SESSION,
      text: undefined,
      for: ATT,
      decision: "deny",
    });
    expect(await rx.waitAck(b.id)).toMatchObject({ outcome: "expired" });
  });
  it("the terminal answered first: the next event releases the hook and a later answer expires", async () => {
    await startDaemon();
    const hook = ask(sock, { op: "permission", session: SESSION, attention: ATT }, 10_000);
    await new Promise((r) => setTimeout(r, 100));
    await ask(sock, { op: "event", session: SESSION, event: "PostToolUse" }, 500);
    expect(await hook).toEqual({ op: "none" });
    const q = await rx.send({
      kind: "permission.answer",
      session: SESSION,
      text: undefined,
      for: ATT,
      decision: "deny",
    });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "expired" });
  });
});

describe.runIf(unix)("refusals (CONTROL.md §5)", () => {
  it("a tampered command, a replay, a folder off the list, an expired message", { timeout: 20_000 }, async () => {
    await startDaemon({ folders: [path.join(tmp, "elsewhere")] });
    mkdirSync(path.join(tmp, "elsewhere"));
    const bad = await rx.send(
      { session: SESSION, text: "hi" },
      { tamper: (c) => c.replace('"text":"hi"', '"text":"rm"') },
    );
    expect(await rx.waitAck(bad.id)).toMatchObject({ outcome: "refused", code: "bad_csig" });
    const f = await rx.send({ session: SESSION, text: "hi" });
    expect(await rx.waitAck(f.id)).toMatchObject({ outcome: "refused", code: "folder" });
    // The same signed bytes under a new receiver id: the nonce is the dedup key.
    rx.enqueue({ ...f, id: `${f.id.slice(0, -1)}Z`, takenAt: undefined } as never);
    expect(await rx.waitAck(`${f.id.slice(0, -1)}Z`)).toMatchObject({ outcome: "refused", code: "replay" });
    // A receiver drops an expired message itself; one that still hands it over gets `expired`.
    const q = await rx.send({ session: SESSION, text: "hi" });
    rx.queue.clear();
    await d!.handle(cfg().receivers[0]!, {
      ...(q as unknown as Carried),
      id: `${q.id.slice(0, -1)}Y`,
      expires_at: new Date(Date.now() - 1).toISOString(),
    });
    expect(await rx.waitAck(`${q.id.slice(0, -1)}Y`)).toMatchObject({ outcome: "expired" });
  });
  it("a command for no session on this machine", async () => {
    await startDaemon();
    const q = await rx.send({ session: "claude-code:00000000-0000-4000-8000-000000000000", text: "hi" });
    expect(await rx.waitAck(q.id)).toMatchObject({ outcome: "refused", code: "no_session" });
  });
});

describe.runIf(unix)("the built hook talks to the daemon", () => {
  const dist = path.resolve(here, "../dist/hook.js");
  const runHook = (event: string, stdin: object) =>
    new Promise<string>((resolve) => {
      const c = spawn(process.execPath, [dist, "claude-code", event], {
        env: { ...env, SESSIONPIPE_NO_WORKER: "1" },
        cwd: project,
      });
      let out = "";
      c.stdout.on("data", (b) => {
        out += b;
      });
      c.on("close", () => resolve(out));
      c.stdin.end(JSON.stringify(stdin));
    });

  it.runIf(existsSync(dist))(
    "Stop prints a block for a queued message; PermissionRequest prints the signed decision",
    async () => {
      await startDaemon();
      await ask(sock, { op: "event", session: SESSION, event: "UserPromptSubmit" }, 500);
      const q = await rx.send({ session: SESSION, text: "from the phone" });
      await new Promise((r) => setTimeout(r, 300));
      const out = await runHook("Stop", { session_id: SID, stop_hook_active: false, cwd: project });
      expect(JSON.parse(out)).toMatchObject({ decision: "block" });
      expect(JSON.parse(out).reason).toContain("from the phone");
      expect(await rx.waitAck(q.id)).toMatchObject({ mode: "turn" });

      const input = {
        session_id: SID,
        prompt_id: "p1",
        tool_name: "Bash",
        tool_input: { command: "rm -rf build" },
        cwd: project,
      };
      const hook = runHook("PermissionRequest", input);
      // The hook names the attention exactly as the adapter does on attention.needed.
      const att = `perm-${(await import("node:crypto"))
        .createHash("sha256")
        .update(`p1|Bash|${JSON.stringify(input.tool_input)}`)
        .digest("hex")
        .slice(0, 16)}`;
      await new Promise((r) => setTimeout(r, 400));
      const a = await rx.send({
        kind: "permission.answer",
        session: SESSION,
        text: undefined,
        for: att,
        decision: "allow",
      });
      expect(JSON.parse(await hook)).toEqual({
        hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
      });
      expect(await rx.waitAck(a.id)).toMatchObject({ outcome: "delivered" });
    },
  );

  it.runIf(existsSync(dist))("with no daemon the hook prints nothing and exits at once", async () => {
    const t = Date.now();
    const out = await runHook("PermissionRequest", { session_id: SID, tool_name: "Bash", tool_input: {} });
    expect(out).toBe("");
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
