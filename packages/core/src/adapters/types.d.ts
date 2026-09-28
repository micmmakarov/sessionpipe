import type { Session } from "../types.js";
export interface HookInput {
  /** [harness, event, ...] as the hook was invoked. */
  argv: string[];
  stdin: string;
  env: Record<string, string | undefined>;
  cwd: string;
}
/** An event as an adapter emits it: no id/time/seq/tier yet (core adds them). */
export interface AdapterEvent {
  type: string;
  data: Record<string, unknown>;
  /** The harness's own event name, for `harness.event`. */
  harnessEvent: string;
}
export interface HookResult {
  session: {
    id: string;
  } & Partial<Session>;
  events: AdapterEvent[];
  /** The transcript file, when the payload names it (tier-2 reads). */
  transcript?: string;
  /** What the harness must see on stdout, if anything. */
  stdout?: string;
  /** Hints for the facts pass (pids, workspaces, a desktop id). */
  hints?: Record<string, unknown>;
}
export interface Turn {
  user: string;
  assistant: string;
  at: number;
  endLine: number;
}
export interface TranscriptRead {
  turns: Turn[];
  /** The line the cursor may advance to once every turn is delivered. */
  line: number;
}
export interface SessionFacts extends Partial<Session> {
  first_ask?: string;
  started_at?: number;
  last_at?: number;
  harness_version?: string;
}
export interface BackfillRow {
  session: {
    id: string;
  } & Partial<Session>;
  started_at: number;
  last_at: number;
  turns?: number;
}
/** The command a hook entry runs: absolute node, absolute script, then args. */
export type HookCommand = (args: string[]) => {
  argv: string[];
  command: string;
};
export interface InstallReport {
  file: string;
  changed: boolean;
  note?: string;
}
export interface Adapter {
  readonly name: string;
  /** The harness's own event names this adapter hooks. */
  readonly events: readonly string[];
  /** Is the harness on this machine (a config dir exists)? */
  detect(env?: NodeJS.ProcessEnv): boolean;
  /** Config files the installer would write. */
  configFiles(env?: NodeJS.ProcessEnv): string[];
  install(cmd: HookCommand, env?: NodeJS.ProcessEnv): InstallReport[];
  uninstall(env?: NodeJS.ProcessEnv): InstallReport[];
  /** Is our hook present and current in the given file? */
  installed(
    cmd: HookCommand,
    env?: NodeJS.ProcessEnv,
  ): {
    file: string;
    state: "current" | "stale" | "missing" | "misplaced";
  }[];
  fromHook(input: HookInput): HookResult | null;
  readTranscript(file: string, fromLine: number): TranscriptRead;
  facts(
    session: {
      id: string;
    } & Partial<Session>,
    transcript: string | undefined,
    hints: Record<string, unknown>,
    state: FactsState,
  ): SessionFacts;
  backfill(sinceMs: number, env?: NodeJS.ProcessEnv): BackfillRow[];
}
/** Small per-session memory the facts pass keeps under <state>/facts/. */
export interface FactsState {
  get(harness: string, session: string): Record<string, unknown>;
  save(harness: string, session: string, patch: Record<string, unknown>): void;
}
//# sourceMappingURL=types.d.ts.map
