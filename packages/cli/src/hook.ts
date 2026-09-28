#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The hook path. A harness runs `node hook.js <harness> <event>`; this reads stdin,
// writes one job file, spawns the worker detached, prints what the harness needs
// ({} for Antigravity) and exits 0 — in milliseconds, with nothing but node:
// builtins imported (the build checks that). No network, no schema library, no
// config parsing beyond one small file read for the throttle.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const t0 = process.hrtime.bigint();
const [harness = "", event = "", ...rest] = process.argv.slice(2);
const env = process.env;

function stateDir(): string {
  if (env.SESSIONPIPE_STATE) return path.resolve(env.SESSIONPIPE_STATE);
  const home = os.homedir();
  if (process.platform === "win32")
    return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "sessionpipe");
  return path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "sessionpipe");
}
function configFile(): string {
  if (env.SESSIONPIPE_CONFIG) return path.resolve(env.SESSIONPIPE_CONFIG);
  const home = os.homedir();
  if (process.platform === "win32")
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "sessionpipe", "config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "sessionpipe", "config.json");
}

// Antigravity parses stdout as the hook's answer; `{}` is "carry on" for every event.
if (harness === "antigravity") {
  try {
    writeFileSync(1, "{}\n");
  } catch {}
}

const state = stateDir();
try {
  if (!harness || !event) throw new Error("usage: hook <harness> <event>");
  let stdin = "";
  if (harness !== "codex" || event !== "notify") {
    try {
      const buf = readFileSync(0);
      stdin = buf.subarray(0, 1024 * 1024).toString("utf8");
    } catch {}
  }
  // Tool events are the bulk of what a harness fires. When no sink takes tier ≥ 1
  // they are only a "still working" signal: one heartbeat a minute per session.
  const TOOL = /^(PreToolUse|PostToolUse|PostToolUseFailure|BeforeTool|AfterTool|PostInvocation)$/;
  if (TOOL.test(event) && !anySinkAbove(0)) {
    const id = sessionIdOf(stdin);
    if (!id || !beatDue(id)) finish(false);
  }
  mkdirSync(path.join(state, "jobs"), { recursive: true });
  const job = {
    harness,
    event,
    argv: [harness, event, ...rest],
    stdin,
    cwd: process.cwd(),
    env: pick([
      "CLAUDE_CODE_HOST_SESSION_ID",
      "CLAUDE_CONFIG_DIR",
      "CLAUDE_PROJECT_DIR",
      "CODEX_HOME",
      "GEMINI_CLI_HOME",
    ]),
    ppid: process.ppid,
    at: Date.now(),
  };
  const jobFile = path.join(state, "jobs", `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(jobFile, JSON.stringify(job));
  if (!env.SESSIONPIPE_NO_WORKER) {
    const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");
    const p = spawn(process.execPath, [worker, jobFile], { detached: true, stdio: "ignore", windowsHide: true, env });
    p.unref();
  }
  finish(true);
} catch {
  finish(false); // the hook must be invisible to the harness
}

function finish(spawned: boolean): never {
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  try {
    mkdirSync(state, { recursive: true });
    appendFileSync(
      path.join(state, "timing.jsonl"),
      `${JSON.stringify({ at: Date.now(), harness, event, ms: Math.round(ms * 10) / 10, spawned })}\n`,
    );
  } catch {}
  process.exit(0);
}
function pick(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) if (env[n] !== undefined) out[n] = env[n] as string;
  return out;
}
function anySinkAbove(tier: number): boolean {
  try {
    const c = JSON.parse(readFileSync(configFile(), "utf8")) as { sinks?: { tier?: number; paused?: string }[] };
    return (c.sinks ?? []).some((s) => Number(s.tier) > tier && !s.paused);
  } catch {
    return false;
  }
}
function sessionIdOf(stdin: string): string {
  const m = /"(?:session_id|sessionId|conversationId)"\s*:\s*"([^"]{1,128})"/.exec(stdin);
  return m?.[1] ?? "";
}
/** One heartbeat per minute per session: the stamp file's mtime is the clock. */
function beatDue(id: string): boolean {
  const stamp = path.join(state, "beats", `${harness}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`);
  try {
    if (Date.now() - statSync(stamp).mtimeMs < 60_000) return false;
  } catch {}
  try {
    mkdirSync(path.dirname(stamp), { recursive: true });
    writeFileSync(stamp, "");
  } catch {}
  return true;
}
