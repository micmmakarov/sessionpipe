// SPDX-License-Identifier: Apache-2.0
// Gemini CLI (Google) — docs: https://geminicli.com/docs/hooks/reference
// Config: ~/.gemini/settings.json `hooks` key, same array-of-groups shape as Claude
// Code but timeouts in MILLISECONDS and a `name` per handler. stdout must be JSON or
// empty. Its own telemetry defaults logPrompts on; the installer says so once.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HOME } from "../paths.js";
import { ends, parseLines } from "../readers/files.js";
import { readGemini } from "../readers/transcripts.js";
import { installClaudeShaped, installedClaudeShaped, uninstallClaudeShaped } from "./claude-shaped.js";
import type { Adapter, HookInput, HookResult, SessionFacts } from "./types.js";

const NAME = "gemini-cli";
export const GEMINI_EVENTS = [
  "SessionStart",
  "BeforeAgent",
  "BeforeTool",
  "AfterTool",
  "Notification",
  "AfterAgent",
  "PreCompress",
  "SessionEnd",
] as const;
const OPTS = { matcherFor: (e: string) => (/Tool/.test(e) ? ".*" : undefined), timeout: 5000 };
const geminiDir = (env: NodeJS.ProcessEnv) => env.GEMINI_CLI_HOME || path.join(HOME, ".gemini");
const settings = (env: NodeJS.ProcessEnv) => path.join(geminiDir(env), "settings.json");
const validTool = (n: unknown): n is string => typeof n === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(n);

export const geminiCli: Adapter = {
  name: NAME,
  events: GEMINI_EVENTS,
  // ~/.gemini also belongs to Antigravity; Gemini CLI is here when its settings or its chat logs exist.
  detect: (env = process.env) => existsSync(settings(env)) || existsSync(path.join(geminiDir(env), "tmp")),
  configFiles: (env = process.env) => [settings(env)],
  install: (cmd, env = process.env) => [installClaudeShaped(settings(env), NAME, GEMINI_EVENTS, cmd, OPTS)],
  uninstall: (env = process.env) => [uninstallClaudeShaped(settings(env), GEMINI_EVENTS)],
  installed: (cmd, env = process.env) => [
    { file: settings(env), state: installedClaudeShaped(settings(env), NAME, GEMINI_EVENTS, cmd, OPTS) },
  ],

  fromHook(input: HookInput): HookResult | null {
    const event = input.argv[1] ?? "";
    let s: Record<string, unknown> = {};
    try {
      s = input.stdin ? (JSON.parse(input.stdin) as Record<string, unknown>) : {};
    } catch {}
    const id = s.session_id as string | undefined;
    if (!id) return null;
    const session: HookResult["session"] = { id: String(id), cwd: typeof s.cwd === "string" ? s.cwd : input.cwd };
    const tool = validTool(s.tool_name) ? s.tool_name : undefined;
    const ev = (type: string, data: Record<string, unknown>) => ({ type, data: prune(data), harnessEvent: event });
    const events: HookResult["events"] = [];
    switch (event) {
      case "SessionStart":
        events.push(
          ev("session.started", {
            source:
              typeof s.source === "string" && ["startup", "resume", "clear"].includes(s.source) ? s.source : "unknown",
          }),
        );
        break;
      case "BeforeAgent":
        events.push(
          ev("turn.started", { prompt_chars: typeof s.prompt === "string" ? [...s.prompt].length : undefined }),
        );
        break;
      case "BeforeTool":
        if (tool) events.push(ev("tool.started", { tool, input: s.tool_input }));
        break;
      case "AfterTool": {
        const resp = s.tool_response as { error?: unknown; llmContent?: unknown } | undefined;
        const err =
          resp && typeof resp === "object" && resp.error
            ? String(typeof resp.error === "string" ? resp.error : JSON.stringify(resp.error)).slice(0, 2000)
            : undefined;
        if (tool)
          events.push(
            ev("tool.ended", {
              tool,
              ok: !err,
              error: err,
              input: s.tool_input,
              output: resp?.llmContent ?? s.tool_response,
            }),
          );
        break;
      }
      case "Notification":
        events.push(
          ev("attention.needed", {
            attention_id: `notif-${Date.now()}`,
            kind: s.notification_type === "ToolPermission" ? "permission" : "question",
            message: typeof s.message === "string" ? s.message.slice(0, 200) : undefined,
          }),
        );
        break;
      case "AfterAgent":
        events.push(ev("turn.ended", { reason: "stop" }));
        break;
      case "PreCompress":
        events.push(ev("context.compacted", { trigger: s.trigger === "manual" ? "manual" : "auto" }));
        break;
      case "SessionEnd":
        events.push(
          ev("session.ended", {
            reason:
              s.reason === "clear" || s.reason === "logout" || s.reason === "exit"
                ? s.reason
                : s.reason === "prompt_input_exit"
                  ? "exit"
                  : "other",
          }),
        );
        break;
      default:
        return null;
    }
    const r: HookResult = { session, events, hints: {} };
    if (typeof s.transcript_path === "string") r.transcript = s.transcript_path;
    return r;
  },

  readTranscript(file, fromLine) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return { turns: [], line: fromLine };
    }
    return readGemini(text.split("\n"), fromLine);
  },

  facts(_session, transcript): SessionFacts {
    const out: SessionFacts = {};
    if (!transcript) return out;
    const { head, tail } = ends(transcript, 64 * 1024, 64 * 1024);
    const H = parseLines(head);
    const T = parseLines(tail);
    const first = H.find((j) => j.type === "user");
    const raw = first ? (first.content ?? first.message ?? first.text) : undefined;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text) {
      const line = text.split("\n").find((l) => l.trim()) ?? "";
      out.title = line.length > 80 ? `${line.slice(0, 80).replace(/\s+\S*$/, "")}…` : line;
      out.title_source = "first-ask";
    }
    const times = H.concat(T)
      .map((j) => Date.parse(String(j.timestamp ?? "")))
      .filter((n) => n > 0);
    if (times.length) {
      out.started_at = Math.min(...times);
      out.last_at = Math.max(...times);
    }
    return out;
  },

  backfill: () => [], // chat logs are keyed by a project hash, not a session id we can name; the first hook of a resumed session reports it
};

function prune<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
