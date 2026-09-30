// SPDX-License-Identifier: Apache-2.0
// Claude Code (Anthropic) — control delivery (spec/CONTROL.md §6). Claude Code on
// this machine, as the control daemon needs it: which `claude` to
// run and with which permission flags, where a session's transcript is and which
// folder it runs in, whether a live process holds it, and running one headless
// turn (`claude -p --resume`, `--fork-session`, `--session-id`). Ported from the
// spacesheep CLI's machine listener (lib/machine.js, 1.22), which ran it in
// production first.
import { execFileSync, spawn } from "node:child_process";
import { accessSync, closeSync, constants, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const JOB_TIMEOUT_MS = 30 * 60_000;
const OUT_CAP = 1024 * 1024;
/** A transcript someone else wrote this recently is in use. */
const LIVE_WRITE_MS = 90_000;

export type Mode = "safe" | "auto";

function isExe(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const cmpVersion = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** The `claude` to run: on PATH, else where the installers put it, else the newest
 *  copy the desktop app ships. Null when this machine has none. */
export function findClaude(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string | null {
  if (env.SESSIONPIPE_CLAUDE && isExe(env.SESSIONPIPE_CLAUDE)) return env.SESSIONPIPE_CLAUDE;
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  for (const d of String(env.PATH || "").split(path.delimiter)) {
    if (!d || !path.isAbsolute(d)) continue;
    for (const n of names) if (isExe(path.join(d, n))) return path.join(d, n);
  }
  for (const p of [
    path.join(home, ".claude", "local", "claude"),
    path.join(home, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ])
    if (isExe(p)) return p;
  const app = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  let versions: string[] = [];
  try {
    versions = readdirSync(app)
      .filter((n) => /^\d+(\.\d+)*$/.test(n))
      .sort(cmpVersion)
      .reverse();
  } catch {}
  for (const v of versions) {
    const p = path.join(app, v, "claude.app", "Contents", "MacOS", "claude");
    if (isExe(p)) return p;
  }
  return null;
}

/** One option's text in `claude --help`: its line and the deeper-indented lines under it. */
function optionBlock(help: string, flag: string): string | null {
  const lines = help.split("\n");
  const re = new RegExp(`^\\s{0,4}(?:-\\w, )?${flag.replace(/-/g, "\\-")}(?![\\w-])`);
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const out = [lines[start] as string];
  for (let i = start + 1; i < lines.length && lines[i]?.trim() && !/^\s{0,4}-/.test(lines[i] as string); i++)
    out.push(lines[i] as string);
  return out.join(" ");
}

export interface Caps {
  hasMode: boolean;
  modes: string[];
  promptsNone: boolean;
  fork: boolean;
}

export function parseCaps(help: string): Caps {
  const pm = optionBlock(help, "--permission-mode");
  const pp = optionBlock(help, "--permission-prompts");
  return {
    hasMode: !!pm,
    modes: pm ? [...pm.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1] as string) : [],
    promptsNone: !!pp && /"none"/.test(pp),
    fork: !!optionBlock(help, "--fork-session"),
  };
}

/** Permission flags for the machine's mode. Safe: `dontAsk` (nothing that needs
 *  approval runs). Auto: Claude Code's own auto mode, or a refusal. Never
 *  bypassPermissions — no path here writes it. */
export function modeFlags(mode: Mode, caps: Caps): { args: string[] } | { error: string } {
  if (mode === "auto") {
    if (!caps.modes.includes("auto"))
      return { error: "this machine is in auto mode, but its Claude Code has no auto permission mode" };
    return { args: ["--permission-mode", "auto"] };
  }
  if (caps.modes.includes("dontAsk")) return { args: ["--permission-mode", "dontAsk"] };
  const args: string[] = [];
  if (caps.hasMode)
    args.push(
      "--permission-mode",
      caps.modes.includes("manual") && !caps.modes.includes("default") ? "manual" : "default",
    );
  if (caps.promptsNone) args.push("--permission-prompts", "none");
  return { args };
}

/** The env a headless turn runs with: ours, minus the markers that make Claude Code
 *  think it runs inside another session, with CLAUDE_CONFIG_DIR naming the account. */
export function claudeEnv(configDir?: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e = { ...env };
  for (const k of [
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_HOST_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SSE_PORT",
  ])
    delete e[k];
  e.SESSIONPIPE_CONTROL_JOB = "1";
  if (configDir !== undefined) {
    if (path.resolve(configDir) === path.resolve(os.homedir(), ".claude")) delete e.CLAUDE_CONFIG_DIR;
    else e.CLAUDE_CONFIG_DIR = configDir;
  }
  return e;
}

export function detectCaps(bin: string): Caps {
  let help = "";
  try {
    help = execFileSync(bin, ["--help"], {
      encoding: "utf8",
      timeout: 30_000,
      env: claudeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    help = String((e as { stdout?: string })?.stdout || "");
  }
  return parseCaps(help);
}

export interface Transcript {
  file: string;
  configDir: string;
  project: string;
}

/** <config dir>/projects/<folder>/<session>.jsonl in any Claude Code config dir. */
export function findTranscript(session: string, dirs: string[]): Transcript | null {
  if (!UUID_RE.test(session)) return null;
  for (const dir of dirs) {
    let projects: import("node:fs").Dirent[] = [];
    try {
      projects = readdirSync(path.join(dir, "projects"), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const file = path.join(dir, "projects", p.name, `${session}.jsonl`);
      try {
        if (statSync(file).isFile()) return { file, configDir: dir, project: p.name };
      } catch {}
    }
  }
  return null;
}

const projectName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

/** The folder a session runs in, from its transcript's own records (never from a
 *  command): the `cwd` whose project name is the folder the transcript is filed
 *  under, else the first `cwd`. Streams; a line over 2 MB is skipped. */
export function sessionFolder(t: Transcript, cap = 8 * 1024 * 1024): string | null {
  let first: string | null = null;
  let count = 0;
  let fd: number | undefined;
  const look = (line: Buffer): string | null => {
    if (line.indexOf('"cwd"') < 0) return null;
    let j: { cwd?: unknown };
    try {
      j = JSON.parse(line.toString("utf8"));
    } catch {
      return null;
    }
    if (!j || typeof j.cwd !== "string" || !path.isAbsolute(j.cwd)) return null;
    if (projectName(j.cwd) === t.project) return j.cwd;
    first ??= j.cwd;
    count++;
    return null;
  };
  try {
    fd = openSync(t.file, "r");
    const buf = Buffer.alloc(256 * 1024);
    let pos = 0;
    let rest = Buffer.alloc(0);
    let skipping = false;
    while (pos < cap && count < 50) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (!n) {
        if (!skipping && rest.length) {
          const hit = look(rest);
          if (hit) return hit;
        }
        break;
      }
      pos += n;
      let chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      let nl = chunk.indexOf(10);
      while (nl >= 0) {
        const line = chunk.subarray(0, nl);
        chunk = chunk.subarray(nl + 1);
        if (skipping) skipping = false;
        else {
          const hit = look(line);
          if (hit) return hit;
        }
        nl = chunk.indexOf(10);
      }
      if (chunk.length > 2 * 1024 * 1024) {
        skipping = true;
        rest = Buffer.alloc(0);
      } else rest = skipping ? Buffer.alloc(0) : Buffer.from(chunk);
    }
  } catch {
  } finally {
    if (fd !== undefined)
      try {
        closeSync(fd);
      } catch {}
  }
  return first;
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

/** A Claude Code process holds this session right now: its registry file,
 *  <config>/sessions/<pid>.json, names it and the pid is alive (interactive and
 *  Agent SDK sessions both file one). */
export function liveProcess(session: string, configDir: string): boolean {
  let names: string[] = [];
  try {
    names = readdirSync(path.join(configDir, "sessions")).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return false;
  }
  for (const n of names) {
    try {
      const j = JSON.parse(readFileSync(path.join(configDir, "sessions", n), "utf8")) as {
        sessionId?: unknown;
        pid?: unknown;
      };
      if (String(j.sessionId) !== session) continue;
      if (pidAlive(Number(j.pid ?? n.slice(0, -5)))) return true;
    } catch {}
  }
  return false;
}

/** Written in the last 90 s, and not by a job of ours. */
export function recentlyWritten(file: string, ourLastEnd?: number, now = Date.now()): boolean {
  let m: number;
  try {
    m = statSync(file).mtimeMs;
  } catch {
    return false;
  }
  if (now - m > LIVE_WRITE_MS) return false;
  return !(ourLastEnd && m <= ourLastEnd + 2000);
}

export interface RunResult {
  error?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string | null;
  tooBig?: boolean;
  stderr?: string;
  timedOut?: boolean;
}

/** Run one headless turn in its own process group, holding at most 1 MB of stdout. */
export function runClaude(
  bin: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let out: Buffer[] = [];
    let outLen = 0;
    let tooBig = false;
    let errTail = "";
    let timedOut = false;
    let settled = false;
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(bin, args, {
        cwd: o.cwd,
        env: o.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (e) {
      resolve({ error: (e as Error).message });
      return;
    }
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {}
      }
    };
    child.stdout?.on("data", (b: Buffer) => {
      if (tooBig) return;
      if (outLen + b.length > OUT_CAP) {
        tooBig = true;
        out = [];
        return;
      }
      out.push(b);
      outLen += b.length;
    });
    child.stderr?.on("data", (b: Buffer) => {
      errTail = (errTail + b.toString("utf8")).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 10_000).unref();
    }, o.timeoutMs ?? JOB_TIMEOUT_MS);
    const result = (code: number | null, signal: NodeJS.Signals | null): RunResult => ({
      code,
      signal,
      stdout: tooBig ? null : Buffer.concat(out).toString("utf8"),
      tooBig,
      stderr: errTail,
      timedOut,
    });
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    child.on("error", (e) => finish({ error: e.message }));
    // A tool the agent left running can hold stdout open after Claude Code exits.
    child.on("exit", (code, signal) => setTimeout(() => finish(result(code, signal)), 2000).unref());
    child.on("close", (code, signal) => finish(result(code, signal)));
  });
}

export interface ClaudeResult {
  type?: string;
  result?: unknown;
  is_error?: boolean;
  subtype?: string;
  session_id?: unknown;
  permission_denials?: { tool_name?: unknown }[];
}

/** `--output-format json`: one result object, or an array whose last `result` entry it is. */
export function parseResult(stdout: string | null | undefined): ClaudeResult | null {
  const s = String(stdout || "").trim();
  if (!s) return null;
  const pick = (j: unknown): ClaudeResult | null => {
    if (Array.isArray(j)) {
      for (let i = j.length - 1; i >= 0; i--) if (j[i]?.type === "result") return j[i];
      return null;
    }
    return j && typeof j === "object" ? (j as ClaudeResult) : null;
  };
  try {
    return pick(JSON.parse(s));
  } catch {}
  const lines = s.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const j = pick(JSON.parse(lines[i] as string));
      if (j && (j.type === "result" || "result" in j)) return j;
    } catch {}
  }
  return null;
}

export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
