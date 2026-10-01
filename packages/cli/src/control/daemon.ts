// SPDX-License-Identifier: Apache-2.0
// The control daemon (spec/CONTROL.md): one process per computer. It holds one
// long-poll per paired receiver, verifies every command itself against the keys
// enrolled at this terminal, and delivers each one the cheapest way the session
// allows — to a parked waiter, at the session's next Stop, to a session it holds
// through the Agent SDK, or by a headless resume or fork — then acks how.
//
// A receiver can queue a message; it can never make this process run one.
import { existsSync, mkdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { claudeControl, redactSecrets } from "@sessionpipe/core";
import { type ControlCommand, parseSessionRef, verifyCommand } from "@sessionpipe/core/control";
import type { LocalReply, LocalRequest } from "./local.js";
import { awaitAnswer, transcriptEnd } from "./reply.js";
import { type DeliveryMode, frame, IN_PLACE_ANSWER, kindPath, routePrompt } from "./route.js";
import {
  type Ack,
  AckOutbox,
  type ControlConfig,
  type DaemonState,
  NonceStore,
  type PairedReceiver,
  readState,
  writeControl,
  writeState,
} from "./store.js";
import { AnswerStream } from "./stream.js";

const {
  claudeEnv,
  findTranscript,
  isUuid,
  JOB_TIMEOUT_MS,
  liveProcess,
  modeFlags,
  parseResult,
  recentlyWritten,
  sessionFolder,
} = claudeControl;
type Caps = claudeControl.Caps;
type RunResult = claudeControl.RunResult;

declare const __SESSIONPIPE_VERSION__: string;
const VERSION = typeof __SESSIONPIPE_VERSION__ === "string" ? __SESSIONPIPE_VERSION__ : "0.0.0";

const MAX_REPLY = 20_000;
const HELLO_EVERY_MS = 10 * 60_000;
/** A message waiting for a Stop that never comes goes another way after this. */
const TURN_FALLBACK_MS = 30 * 60_000;
/** How long the daemon follows a session's turn for the answer to an in-place
 *  message before acking it delivered without one. */
const ANSWER_WAIT_MS = 30 * 60_000;
/** How long a Stop hook may take to be answered. */
const RECENT_ACKS_MS = 25 * 3600_000;
/** Events that prove a pending permission prompt was resolved some other way. */
const CLOSES_ATTENTION = new Set([
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "UserPromptSubmit",
  "SessionEnd",
]);

/** The message as the receiver carried it (control.json). */
export interface Carried {
  id: string;
  cmd: string;
  csig?: string | null;
  grant?: { str: string; cred: string; ad: string; cd: string; sig: string } | null;
  confirm?: { cred: string; ad: string; cd: string; sig: string } | null;
  at: string;
  expires_at: string;
}

/** A session the Agent SDK holds for the daemon (sdk.ts; a fake in tests). */
export interface SdkSession {
  /** Deliver one message; resolves with the agent's reply when the turn ends. */
  send(text: string): Promise<{ reply: string; error?: string }>;
  interrupt(): Promise<void>;
  close(): void;
  readonly busy: boolean;
  readonly lastUsed: number;
}
export interface SdkHost {
  start(o: {
    session: string;
    cwd: string;
    mode: "safe" | "auto";
    configDir?: string;
    allowedTools?: string[];
  }): SdkSession;
}

export interface DaemonDeps {
  now: () => number;
  fetch: typeof fetch;
  log: (line: string) => void;
  claudeDirs: () => string[];
  claude: () => { bin: string; caps: Caps } | null;
  run: (
    bin: string,
    args: string[],
    o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; onLine?: (line: string) => void },
  ) => Promise<RunResult>;
  sdk?: SdkHost | null;
  /** How long to follow a live session's turn for an in-place answer (tests shorten it). */
  answerWaitMs?: number;
  /** Close an SDK session idle this long (a held session costs ~300 MB). */
  sdkIdleMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface TurnPending {
  receiver: PairedReceiver;
  msgId: string;
  text: string;
  session: string;
  queuedAt: number;
}

interface Live {
  midTurn: boolean;
  /** The Stop hook just delivered a block: the next Stop event continues the turn. */
  continued: boolean;
  waiter: net.Socket | null;
  turnQueue: TurnPending[];
  attentions: Map<string, net.Socket>;
  cwd?: string;
  transcript?: string;
  lastEvent: number;
}

export interface Status {
  version: string;
  name: string;
  receivers: {
    url: string;
    machine: string;
    keys: number;
    polling: boolean;
    last_poll: number | null;
    last_error: string | null;
  }[];
  waiting: string[];
  mid_turn: string[];
  attentions: { session: string; id: string }[];
  sdk: string[];
  nonces: number;
  acks_pending: number;
  delivered: Record<string, number>;
}

/** The machine's own caps (CONTROL.md §6 `start`): every command is the owner's,
 *  signed, but a burst of them must not start a crowd of agents. A start beyond the
 *  caps is refused `start_limit`; a headless run beyond `headless` waits its turn. */
/** What a receiver may let its sessions use without asking (CONTROL.md §6): its own MCP
 *  servers, by name — never a built-in tool. The receiver is where the message came
 *  from, so answering it there (publishing a page, replying) is the job; anything else
 *  still needs the person's approval rule. */
export function sessionToolsFrom(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(v.filter((t): t is string => typeof t === "string" && /^mcp__[A-Za-z0-9_-]{1,64}$/.test(t))),
  ].slice(0, 8);
}

export const LIMITS = { startConcurrent: 2, startPerHour: 10, headless: 3 } as const;

export class ControlDaemon {
  private server: net.Server | null = null;
  private readonly live = new Map<string, Live>();
  private readonly sdkSessions = new Map<string, SdkSession>();
  private readonly nonces: NonceStore;
  private readonly acks: AckOutbox;
  private readonly recentAcks = new Map<string, { ack: Ack; at: number }>();
  private readonly inflight = new Set<string>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lastEnd = new Map<string, number>();
  private state: DaemonState;
  private running = false;
  private readonly polling = new Map<string, { last: number | null; error: string | null; on: boolean }>();
  private readonly delivered: Record<string, number> = {};
  private helloTimer: NodeJS.Timeout | null = null;
  private helloSoon: NodeJS.Timeout | null = null;
  private readonly aborts = new Set<AbortController>();
  /** Per receiver: the MCP servers its sessions may use unattended (its well-known). */
  private readonly sessionTools = new Map<string, string[]>();
  private startsRunning = 0;
  private startTimes: number[] = [];
  private procs = 0;
  private readonly procWaiters: (() => void)[] = [];

  constructor(
    private cfg: ControlConfig,
    private readonly dir: string,
    private readonly sock: string,
    private readonly deps: DaemonDeps,
  ) {
    this.nonces = new NonceStore(path.join(dir, "nonces.jsonl"), deps.now);
    this.acks = new AckOutbox(path.join(dir, "acks.jsonl"));
    this.state = readState(path.join(dir, "state.json"));
  }

  // --- lifecycle ------------------------------------------------------------------

  async start(): Promise<void> {
    this.running = true;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    await this.listen();
    for (const r of this.cfg.receivers) void this.pollLoop(r);
    this.helloTimer = setInterval(() => void this.helloAll(), HELLO_EVERY_MS);
    this.helloTimer.unref();
    void this.helloAll();
    void this.flushAcks();
    const idle = setInterval(() => this.closeIdleSdk(), 60_000);
    idle.unref();
    this.deps.log(`control daemon ${VERSION} up · ${this.cfg.receivers.length} receiver(s) · socket ${this.sock}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const a of this.aborts) a.abort();
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.helloSoon) clearTimeout(this.helloSoon);
    for (const s of this.sdkSessions.values()) s.close();
    for (const l of this.live.values()) {
      l.waiter?.destroy();
      for (const a of l.attentions.values()) a.destroy();
    }
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    if (process.platform !== "win32")
      try {
        unlinkSync(this.sock);
      } catch {}
  }

  reload(cfg: ControlConfig): void {
    const known = new Set(this.cfg.receivers.map((r) => r.control + r.machine));
    this.cfg = cfg;
    for (const r of cfg.receivers) if (!known.has(r.control + r.machine)) void this.pollLoop(r);
  }

  status(): Status {
    return {
      version: VERSION,
      name: this.cfg.name,
      receivers: this.cfg.receivers.map((r) => {
        const p = this.polling.get(r.control + r.machine);
        return {
          url: r.url,
          machine: r.machine,
          keys: r.keys.length,
          polling: !!p?.on,
          last_poll: p?.last ?? null,
          last_error: p?.error ?? null,
        };
      }),
      waiting: [...this.live].filter(([, l]) => l.waiter).map(([k]) => k),
      mid_turn: [...this.live].filter(([, l]) => l.midTurn).map(([k]) => k),
      attentions: [...this.live].flatMap(([k, l]) => [...l.attentions.keys()].map((id) => ({ session: k, id }))),
      sdk: [...this.sdkSessions.keys()],
      nonces: this.nonces.size,
      acks_pending: this.acks.all().length,
      delivered: { ...this.delivered },
    };
  }

  // --- the local socket -----------------------------------------------------------

  private listen(): Promise<void> {
    if (process.platform !== "win32") {
      try {
        if (existsSync(this.sock)) unlinkSync(this.sock);
      } catch {}
    }
    this.server = net.createServer((s) => this.onConn(s));
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.sock, () => resolve());
    });
  }

  private onConn(s: net.Socket): void {
    let buf = "";
    let handled = false;
    s.on("error", () => {});
    s.on("data", (d) => {
      if (handled) return;
      buf += d.toString("utf8");
      if (buf.length > 64 * 1024) return s.destroy();
      const i = buf.indexOf("\n");
      if (i < 0) return;
      handled = true;
      let req: LocalRequest;
      try {
        req = JSON.parse(buf.slice(0, i)) as LocalRequest;
      } catch {
        return s.destroy();
      }
      this.onRequest(req, s);
    });
  }

  private reply(s: net.Socket, r: LocalReply): void {
    try {
      s.end(`${JSON.stringify(r)}\n`);
    } catch {}
  }

  private liveOf(session: string): Live {
    let l = this.live.get(session);
    if (!l) {
      l = {
        midTurn: false,
        continued: false,
        waiter: null,
        turnQueue: [],
        attentions: new Map(),
        lastEvent: this.deps.now(),
      };
      this.live.set(session, l);
    }
    return l;
  }

  private onRequest(req: LocalRequest, s: net.Socket): void {
    switch (req.op) {
      case "status":
        this.reply(s, { op: "status", status: this.status() });
        return;
      case "wait": {
        if (!parseSessionRef(req.session)) {
          this.reply(s, { op: "none" });
          return;
        }
        const l = this.liveOf(req.session);
        if (l.waiter && l.waiter !== s) this.reply(l.waiter, { op: "replaced" });
        l.waiter = s;
        s.on("close", () => {
          if (l.waiter === s) {
            l.waiter = null;
            this.scheduleHello();
          }
        });
        this.scheduleHello();
        return;
      }
      case "stop": {
        const l = this.liveOf(req.session);
        l.lastEvent = this.deps.now();
        const p = this.takeTurn(l);
        if (!p) {
          this.reply(s, { op: "none" });
          return;
        }
        l.continued = true;
        const from = this.answerFrom(req.session);
        this.reply(s, { op: "block", reason: `${frame(p.text, p.receiver.url)}\n\n${IN_PLACE_ANSWER}`, id: p.msgId });
        this.followAnswer(p.receiver, p.msgId, "turn", req.session, from, p.queuedAt);
        return;
      }
      case "permission": {
        const l = this.liveOf(req.session);
        const prev = l.attentions.get(req.attention);
        if (prev && prev !== s) this.reply(prev, { op: "none" });
        l.attentions.set(req.attention, s);
        s.on("close", () => {
          if (l.attentions.get(req.attention) === s) l.attentions.delete(req.attention);
        });
        return;
      }
      case "event":
        this.onEvent(req);
        this.reply(s, { op: "ok" });
        return;
    }
  }

  /** A queued turn message that hasn't expired. */
  private takeTurn(l: Live): TurnPending | null {
    while (l.turnQueue.length) {
      const p = l.turnQueue.shift()!;
      if (!this.inflight.has(p.msgId)) continue;
      return p;
    }
    return null;
  }

  private onEvent(e: Extract<LocalRequest, { op: "event" }>): void {
    const l = this.liveOf(e.session);
    l.lastEvent = this.deps.now();
    if (e.cwd) l.cwd = e.cwd;
    if (e.transcript) l.transcript = e.transcript;
    if (CLOSES_ATTENTION.has(e.event) && l.attentions.size) {
      for (const s of l.attentions.values()) this.reply(s, { op: "none" });
      l.attentions.clear();
    }
    if (e.event === "UserPromptSubmit" || e.event === "SessionStart") {
      if (e.event === "UserPromptSubmit") l.midTurn = true;
      return;
    }
    if (e.event === "Stop" && l.continued) {
      l.continued = false;
      return;
    }
    if (e.event === "Stop" || e.event === "StopFailure" || e.event === "SessionEnd") {
      l.midTurn = false;
      l.continued = false;
      // A message queued for a Stop that came and went without taking it (it
      // arrived after the hook asked, or the turn failed) goes another way.
      const left = l.turnQueue.splice(0);
      for (const p of left) if (this.inflight.has(p.msgId)) void this.reroute(p);
    }
  }

  // --- receivers ------------------------------------------------------------------

  private async pollLoop(first: PairedReceiver): Promise<void> {
    const key = first.control + first.machine;
    const st = { last: null as number | null, error: null as string | null, on: true };
    this.polling.set(key, st);
    let backoff = 0;
    let downSince = 0;
    // A deploy takes the receiver away for seconds, not minutes: retry soon, capped at
    // 15 s (one request per machine), with jitter so every machine a deploy dropped
    // doesn't come back in the same instant. The old 60 s / 5 min steps left a
    // machine blind for minutes after a 30-second outage.
    const steps = [1000, 2000, 5000, 10_000, 15_000];
    const pause = (n: number) => (steps[Math.min(n, steps.length - 1)] as number) * (0.75 + Math.random() * 0.5);
    for (;;) {
      // The current record every round: `control pair` may have added a key since.
      const r = this.cfg.receivers.find((x) => x.control + x.machine === key);
      if (!this.running || !r) break;
      const ctl = new AbortController();
      this.aborts.add(ctl);
      // A poll held past wait + 10 s is a dead connection (a laptop that slept, a
      // network that changed): give up on it and ask again.
      const t = setTimeout(() => ctl.abort(), 35_000);
      try {
        const u = new URL(r.control);
        u.searchParams.set("machine", r.machine);
        u.searchParams.set("wait", "25");
        const asked = this.deps.now();
        const res = await this.deps.fetch(u, { headers: { authorization: `Bearer ${r.token}` }, signal: ctl.signal });
        st.last = this.deps.now();
        if (downSince && res.status < 500) {
          // Timed to when this poll was sent: a long-poll that reconnected is then held
          // up to `wait` before it answers.
          this.deps.log(`${r.url}: back after ${Math.round((asked - downSince) / 1000)} s (${backoff} failed tries)`);
          downSince = 0;
        }
        if (res.status === 401) {
          st.error = "the receiver no longer knows this machine (401); run `sessionpipe control pair` again";
          this.deps.log(`${r.url}: ${st.error}`);
          break;
        }
        if (res.status === 200) {
          const body = (await res.json()) as { messages?: Carried[] };
          // Looked up again: a key may have been added while this poll was parked.
          const cur = this.cfg.receivers.find((x) => x.control + x.machine === key) ?? r;
          let fresh = 0;
          // Not awaited: a headless turn can run for half an hour, and the next
          // message (for another session, or a permission answer) must not wait
          // behind it. handle() orders what must be ordered (one session's prompts).
          for (const m of body.messages ?? []) {
            if (m && !this.inflight.has(m.id)) fresh++;
            void this.handle(cur, m).catch((e) =>
              this.deps.log(`handle ${String(m?.id).slice(-8)}: ${String((e as Error)?.message || e)}`),
            );
          }
          // Only messages already in hand (a receiver that ignores `taken`): don't
          // turn the long-poll into a spin.
          if (!fresh) await sleep(2000);
          st.error = null;
          backoff = 0;
        } else if (res.status === 204) {
          st.error = null;
          backoff = 0;
        } else {
          st.error = `HTTP ${res.status}`;
          downSince ||= this.deps.now();
          await sleep(pause(backoff++));
        }
      } catch (e) {
        if (!this.running) break;
        st.error = String((e as Error)?.message || e).slice(0, 120);
        downSince ||= this.deps.now();
        await sleep(pause(backoff++));
      } finally {
        clearTimeout(t);
        this.aborts.delete(ctl);
      }
    }
    st.on = false;
  }

  private scheduleHello(): void {
    if (this.helloSoon) return;
    this.helloSoon = setTimeout(() => {
      this.helloSoon = null;
      void this.helloAll();
    }, 1500);
    this.helloSoon.unref();
  }

  /** Read each receiver's well-known for its session tools (at start, then with every hello). */
  private async refreshSessionTools(): Promise<void> {
    for (const r of this.cfg.receivers) {
      try {
        const res = await this.deps.fetch(`${r.url.replace(/\/$/, "")}/.well-known/sessionpipe`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const wk = (await res.json()) as { control?: { session_tools?: unknown } };
        const tools = sessionToolsFrom(wk.control?.session_tools);
        const key = r.control + r.machine;
        if (JSON.stringify(tools) !== JSON.stringify(this.sessionTools.get(key) ?? []))
          this.deps.log(
            `${r.url}: sessions it messages may use ${tools.length ? tools.join(", ") : "nothing extra"} without asking`,
          );
        this.sessionTools.set(key, tools);
      } catch {}
    }
  }

  private allowedFor(r: PairedReceiver): string[] {
    return this.sessionTools.get(r.control + r.machine) ?? [];
  }

  private async helloAll(): Promise<void> {
    void this.refreshSessionTools();
    const waiting = [...this.live].filter(([, l]) => l.waiter).map(([k]) => k);
    const modes: DeliveryMode[] = ["waiter", "turn", "resume", "fork", ...(this.deps.sdk ? (["sdk"] as const) : [])];
    for (const r of this.cfg.receivers) {
      const body = {
        name: this.cfg.name,
        harnesses: ["claude-code"],
        modes,
        keys: r.keys.map((k) => k.id),
        version: VERSION,
        waiting,
        folders: this.cfg.folders,
        mode: this.cfg.mode,
      };
      await this.post(r, "/hello", body).catch(() => {});
    }
  }

  private async post(r: PairedReceiver, sub: string, body: unknown): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    try {
      return await this.deps.fetch(`${r.control.replace(/\/$/, "")}${sub}`, {
        method: "POST",
        headers: { authorization: `Bearer ${r.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  }

  // --- acks -----------------------------------------------------------------------

  private finish(r: PairedReceiver, id: string, a: Omit<Ack, "receiver" | "id" | "at">, since?: number): void {
    const ack: Ack = { receiver: r.control + r.machine, id, at: new Date(this.deps.now()).toISOString(), ...a };
    if (ack.reply) ack.reply = redactSecrets(ack.reply).slice(0, MAX_REPLY);
    if (ack.detail) ack.detail = redactSecrets(ack.detail).slice(0, 500);
    if (a.outcome !== "taken") {
      this.inflight.delete(id);
      this.recentAcks.set(id, { ack, at: this.deps.now() });
      this.delivered[a.mode ?? a.outcome] = (this.delivered[a.mode ?? a.outcome] ?? 0) + 1;
      this.deps.log(
        `ack ${id.slice(-8)} ${a.outcome}${a.mode ? ` via ${a.mode}` : ""}${a.code ? ` (${a.code})` : ""}${since ? ` send→${a.outcome} ${this.deps.now() - since} ms` : ""}`,
      );
    }
    this.acks.add(ack);
    void this.flushAcks();
  }

  private flushing = false;
  private async flushAcks(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let round = 0; round < 5; round++) {
        const all = this.acks.all();
        if (!all.length) return;
        const left: Ack[] = [];
        for (const r of this.cfg.receivers) {
          const mine = all.filter((a) => a.receiver === r.control + r.machine);
          if (!mine.length) continue;
          const acks = mine.map(({ receiver: _r, ...a }) => a);
          const ok = await this.post(r, "/ack", { acks })
            .then((res) => res.status >= 200 && res.status < 300)
            .catch(() => false);
          if (!ok) left.push(...mine);
        }
        // Acks for a receiver no longer paired are dropped.
        const now = this.acks.all();
        const added = now.slice(all.length);
        this.acks.keep([...left, ...added]);
        if (!left.length && !added.length) return;
        if (left.length) await sleep(2000 * (round + 1));
      }
    } finally {
      this.flushing = false;
    }
  }

  // --- one message ----------------------------------------------------------------

  async handle(r: PairedReceiver, m: Carried): Promise<void> {
    if (!m || typeof m.id !== "string") return;
    if (this.inflight.has(m.id)) return; // redelivered while we work on it
    const prior = this.recentAcks.get(m.id);
    if (prior && this.deps.now() - prior.at < RECENT_ACKS_MS) {
      this.acks.add(prior.ack);
      void this.flushAcks();
      return;
    }
    // In hand from here, before anything is awaited: a redelivery that arrives while
    // this one verifies must not verify too and come back `replay`. Every path below
    // ends in finish(), which lets go of it.
    this.inflight.add(m.id);
    const sent = Date.parse(m.at) || this.deps.now();
    if (Date.parse(m.expires_at) <= this.deps.now()) return this.finish(r, m.id, { outcome: "expired" });
    const v = await verifyCommand(
      { cmd: m.cmd, csig: m.csig ?? null, grant: m.grant ?? null, confirm: m.confirm ?? null },
      { machine: r.machine, rpId: r.rpId, trusted: r.keys, now: this.deps.now(), seenNonce: this.nonces.seen },
    );
    if (!v.ok) {
      this.deps.log(`refused ${m.id.slice(-8)}: ${v.code} — ${v.why}`);
      return this.finish(r, m.id, { outcome: "refused", code: v.code, detail: v.why });
    }
    const cmd = v.cmd;
    // A device this machine already trusts vouched for a new one (CONTROL.md §2): the
    // signature just verified against an enrolled key, so the new key joins the store.
    if (cmd.kind === "key.add") return this.addKey(r, m.id, cmd, sent);
    const ref = parseSessionRef(cmd.session)!;
    const kp = kindPath(cmd.kind, ref.harness);
    if (typeof kp === "object") return this.finish(r, m.id, { outcome: "unsupported", detail: kp.unsupported });
    try {
      if (kp === "start") return await this.startSession(r, m.id, cmd, sent);
      const place = this.place(cmd.session);
      if ("refused" in place)
        return this.finish(r, m.id, { outcome: "refused", code: place.refused, detail: place.why });
      if (kp === "permission") return this.permission(r, m.id, cmd, sent);
      if (kp === "cancel") return await this.cancel(r, m.id, cmd, sent);
      // One session's prompts in the order they came, each routed only once the one
      // before it has landed (a second message to a session the first one forked
      // goes to the copy). Other sessions don't wait.
      return await this.serial(`deliver:${cmd.session}`, async () => {
        // Read again: the message before this one may have moved the session (a fork).
        const now = this.place(cmd.session);
        if ("refused" in now) return this.finish(r, m.id, { outcome: "refused", code: now.refused, detail: now.why });
        return this.prompt(r, m.id, cmd, now, sent);
      });
    } catch (e) {
      this.finish(r, m.id, { outcome: "failed", detail: String((e as Error)?.message || e) });
    }
  }

  /** Where the session lives, and whether its folder is allowed — read from the
   *  session's own transcript (Claude Code) or the hooks' cwd, never the command. */
  private place(
    session: string,
  ): { refused: string; why: string } | { folder: string; transcript: ReturnType<typeof findTranscript> } {
    const ref = parseSessionRef(session)!;
    if (ref.harness === "claude-code") {
      const target = this.state.copies[ref.id] ?? ref.id;
      const t = findTranscript(target, this.deps.claudeDirs()) ?? findTranscript(ref.id, this.deps.claudeDirs());
      if (!t) return { refused: "no_session", why: `no Claude Code session ${ref.id.slice(0, 8)} on this machine` };
      const folder = sessionFolder(t);
      const ok = folder && this.allowed(folder);
      if (!ok) return { refused: "folder", why: "that session's folder isn't one this machine allows" };
      return { folder: ok, transcript: t };
    }
    const cwd = this.live.get(session)?.cwd;
    const ok = cwd && this.allowed(cwd);
    if (!ok) return { refused: cwd ? "folder" : "no_session", why: "no allowed folder known for that session" };
    return { folder: ok, transcript: null };
  }

  private allowed(dir: string): string | null {
    if (!path.isAbsolute(dir)) return null;
    let r: string;
    try {
      r = realpathSync.native(dir);
      if (!statSync(r).isDirectory()) return null;
    } catch {
      return null;
    }
    for (const f of this.cfg.folders) {
      let rf = f;
      try {
        rf = realpathSync.native(f);
      } catch {}
      if (r === rf || r.startsWith(rf.endsWith(path.sep) ? rf : rf + path.sep)) return r;
    }
    return null;
  }

  private permission(r: PairedReceiver, id: string, cmd: ControlCommand, sent: number) {
    const l = this.live.get(cmd.session);
    const hook = l?.attentions.get(cmd.for as string);
    if (!hook) {
      // Nothing is ever auto-allowed: an allow needs a prompt open right now.
      if (cmd.decision === "allow")
        return this.finish(r, id, {
          outcome: "refused",
          code: "no_attention",
          detail: "no permission prompt open for that id",
        });
      this.finish(r, id, { outcome: "expired", detail: "the prompt was already answered or closed" });
      return;
    }
    l!.attentions.delete(cmd.for as string);
    this.reply(hook, {
      op: "decision",
      behavior: cmd.decision as "allow" | "deny",
      ...(cmd.note ? { message: cmd.note } : {}),
      id,
    });
    this.finish(r, id, { outcome: "delivered", mode: "turn" }, sent);
  }

  private async cancel(r: PairedReceiver, id: string, cmd: ControlCommand, sent: number): Promise<void> {
    const ref = parseSessionRef(cmd.session)!;
    const held = this.sdkSessions.get(ref.id);
    if (!held)
      return this.finish(r, id, {
        outcome: "unsupported",
        detail: "no cancel path for a session the daemon doesn't hold",
      });
    await held.interrupt();
    this.finish(r, id, { outcome: "delivered", mode: "sdk" }, sent);
  }

  private view(session: string, transcript: ReturnType<typeof findTranscript>) {
    const ref = parseSessionRef(session)!;
    const l = this.live.get(session);
    const claude = ref.harness === "claude-code" ? this.deps.claude() : null;
    const target = this.state.copies[ref.id] ?? ref.id;
    const t = transcript;
    const live =
      !!t && (liveProcess(target, t.configDir) || recentlyWritten(t.file, this.lastEnd.get(target), this.deps.now()));
    return {
      harness: ref.harness,
      sdk: this.sdkSessions.has(ref.id),
      waiter: !!l?.waiter && !l.waiter.destroyed,
      midTurn: !!l?.midTurn,
      live,
      known: !!t,
      canFork: !!claude?.caps.fork,
      api: false,
    };
  }

  private async prompt(
    r: PairedReceiver,
    id: string,
    cmd: ControlCommand,
    place: { folder: string; transcript: ReturnType<typeof findTranscript> },
    sent: number,
  ): Promise<void> {
    const route = routePrompt(this.view(cmd.session, place.transcript));
    if ("unsupported" in route) return this.finish(r, id, { outcome: "unsupported", detail: route.unsupported });
    if ("refused" in route) return this.finish(r, id, { outcome: "refused", code: route.refused });
    const ref = parseSessionRef(cmd.session)!;
    const text = cmd.text as string;
    switch (route.mode) {
      case "waiter": {
        const l = this.live.get(cmd.session)!;
        const w = l.waiter!;
        l.waiter = null;
        const from = this.answerFrom(cmd.session);
        this.reply(w, { op: "message", text: frame(text, r.url), id });
        this.scheduleHello();
        return this.followAnswer(r, id, "waiter", cmd.session, from, sent);
      }
      case "turn": {
        const l = this.liveOf(cmd.session);
        const p: TurnPending = { receiver: r, msgId: id, text, session: cmd.session, queuedAt: sent };
        l.turnQueue.push(p);
        // It waits for the session's Stop: the receiver must not keep handing it back.
        this.finish(r, id, { outcome: "taken" });
        const t = setTimeout(() => {
          if (this.inflight.has(id) && l.turnQueue.includes(p)) {
            l.turnQueue.splice(l.turnQueue.indexOf(p), 1);
            void this.reroute(p);
          }
        }, TURN_FALLBACK_MS);
        t.unref();
        return;
      }
      case "sdk": {
        const s = this.sdkSessions.get(ref.id)!;
        this.finish(r, id, { outcome: "taken" });
        const out = await s.send(frame(text, r.url));
        return this.finish(
          r,
          id,
          out.error
            ? { outcome: "failed", detail: out.error }
            : { outcome: "delivered", mode: "sdk", reply: out.reply },
          sent,
        );
      }
      case "resume":
      case "fork":
        return this.headless(r, id, cmd, place, route.mode, sent);
      case "api":
        return this.finish(r, id, { outcome: "unsupported", detail: "no input API wired for this harness" });
    }
  }

  /** A turn message whose Stop never took it: route again, now that it isn't mid-turn. */
  private async reroute(p: TurnPending): Promise<void> {
    const l = this.liveOf(p.session);
    l.midTurn = false;
    const place = this.place(p.session);
    if ("refused" in place) return this.finish(p.receiver, p.msgId, { outcome: "refused", code: place.refused });
    const cmd = { kind: "prompt", session: p.session, text: p.text } as ControlCommand;
    this.inflight.delete(p.msgId);
    this.inflight.add(p.msgId);
    await this.prompt(p.receiver, p.msgId, cmd, place, p.queuedAt).catch((e) =>
      this.finish(p.receiver, p.msgId, { outcome: "failed", detail: String((e as Error)?.message || e) }),
    );
  }

  /** Jobs for one session (and its copy) run one at a time, in order. */
  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.queues.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  private async headless(
    r: PairedReceiver,
    id: string,
    cmd: ControlCommand,
    place: { folder: string; transcript: ReturnType<typeof findTranscript> },
    mode: "resume" | "fork",
    sent: number,
  ): Promise<void> {
    const claude = this.deps.claude();
    if (!claude)
      return this.finish(r, id, { outcome: "failed", detail: "Claude Code isn't installed on this machine" });
    const mf = modeFlags(this.cfg.mode, claude.caps);
    if ("error" in mf) return this.finish(r, id, { outcome: "refused", code: "mode", detail: mf.error });
    const ref = parseSessionRef(cmd.session)!;
    this.finish(r, id, { outcome: "taken" });
    await this.serial(ref.id, async () => {
      const target = this.state.copies[ref.id] ?? ref.id;
      const resume = mode === "fork" ? ["--resume", target, "--fork-session"] : ["--resume", target];
      const allow = this.allowedFor(r);
      const args = [
        "-p",
        ...this.outputArgs(claude.caps),
        ...mf.args,
        ...(allow.length ? [`--allowedTools=${allow.join(",")}`] : []),
        ...resume,
        frame(cmd.text as string, r.url),
      ];
      this.deps.log(`${id.slice(-8)}: claude -p ${[...mf.args, ...resume].join(" ")} in ${place.folder}`);
      const stream = this.answerStream(r, id);
      const res = await this.slot(() =>
        this.deps.run(claude.bin, args, {
          cwd: place.folder,
          env: claudeEnv(place.transcript?.configDir, this.deps.env),
          timeoutMs: JOB_TIMEOUT_MS,
          ...(claude.caps.stream ? { onLine: (l: string) => stream.feed(l) } : {}),
        }),
      );
      stream.close();
      this.lastEnd.set(target, this.deps.now());
      const out = this.outcome(res);
      if ("failed" in out) return this.finish(r, id, { outcome: "failed", detail: out.failed });
      const ran = isUuid(out.session) ? out.session : target;
      if (mode === "fork" && ran !== target) {
        this.state.copies[ref.id] = ran;
        writeState(path.join(this.dir, "state.json"), this.state);
        this.lastEnd.set(ran, this.deps.now());
      }
      this.finish(
        r,
        id,
        { outcome: "delivered", mode, reply: out.reply, ...(ran !== ref.id ? { session: `claude-code:${ran}` } : {}) },
        sent,
      );
    });
  }

  private outcome(res: RunResult): { failed: string } | { reply: string; session?: string } {
    if (res.error) return { failed: `couldn't start Claude Code: ${res.error}` };
    if (res.timedOut) return { failed: "Claude Code was still working after 30 minutes, so it was stopped" };
    if (res.tooBig) return { failed: "Claude Code's answer was too large to read" };
    const j = parseResult(res.stdout);
    if (!j) {
      const why = String(res.stderr || "")
        .trim()
        .split("\n")
        .slice(-3)
        .join(" ");
      return {
        failed: `Claude Code exited (${res.signal || `code ${res.code}`}) without an answer${why ? `: ${why}` : ""}`,
      };
    }
    if (j.is_error) return { failed: String(j.result || j.subtype || "Claude Code reported an error") };
    const denials = Array.isArray(j.permission_denials) ? j.permission_denials : [];
    const names = [...new Set(denials.map((d) => d?.tool_name).filter((n): n is string => typeof n === "string"))];
    const tail = denials.length
      ? `\n\n(Not allowed on this machine, since nobody was there to approve: ${names.join(", ") || `${denials.length} action(s)`}.)`
      : "";
    const text =
      typeof j.result === "string" && j.result.trim() ? j.result : "(Claude Code finished without a written reply.)";
    return { reply: text + tail, ...(typeof j.session_id === "string" ? { session: j.session_id } : {}) };
  }

  private addKey(r: PairedReceiver, id: string, cmd: ControlCommand, sent: number) {
    const k = cmd.key!;
    const name = typeof cmd.name === "string" ? cmd.name.trim().slice(0, 80) : undefined;
    const rec = this.cfg.receivers.find((x) => x.control === r.control && x.machine === r.machine) ?? r;
    if (rec.keys.some((x) => x.id === k.id))
      return this.finish(r, id, { outcome: "delivered", detail: "that device was already trusted" }, sent);
    rec.keys.push({
      id: k.id,
      alg: k.alg,
      spki: k.spki,
      ...(name ? { name } : {}),
      added_at: new Date(this.deps.now()).toISOString(),
    });
    try {
      writeControl(this.cfg, this.deps.env);
    } catch (e) {
      rec.keys = rec.keys.filter((x) => x.id !== k.id);
      return this.finish(r, id, {
        outcome: "failed",
        detail: `couldn't save the key: ${String((e as Error)?.message || e)}`,
      });
    }
    this.deps.log(
      `trusted a new device${name ? ` (${name})` : ""} on ${r.url}: ${k.id.slice(0, 12)}…, vouched for by a key it already trusted`,
    );
    this.finish(r, id, { outcome: "delivered", detail: `trusted ${name || "a new device"}` }, sent);
  }

  /** Where the session's transcript ends right now: its answer starts after this. */
  private answerFrom(session: string): { file: string; offset: number } | null {
    const ref = parseSessionRef(session);
    if (!ref || ref.harness !== "claude-code") return null;
    const t = findTranscript(this.state.copies[ref.id] ?? ref.id, this.deps.claudeDirs());
    return t ? { file: t.file, offset: transcriptEnd(t.file) } : null;
  }

  /** A message handed to a live session (a waiter, a Stop block) is `taken` now; the
   *  session answers in its own turn, which the daemon reads from the transcript and
   *  sends back as the final ack's `reply` — so the person sees the answer where they
   *  asked. A turn that doesn't end within ANSWER_WAIT_MS is acked delivered without. */
  private followAnswer(
    r: PairedReceiver,
    id: string,
    mode: "waiter" | "turn",
    session: string,
    from: { file: string; offset: number } | null,
    sent: number,
  ): void {
    this.deps.log(`${id.slice(-8)}: in ${session.slice(0, 24)} via ${mode} ${this.deps.now() - sent} ms after send`);
    this.finish(r, id, { outcome: "taken" });
    const stream = this.answerStream(r, id);
    void (async () => {
      const answer = from
        ? await awaitAnswer(from.file, from.offset, {
            timeoutMs: this.deps.answerWaitMs ?? ANSWER_WAIT_MS,
            now: this.deps.now,
            onText: (t) => stream.set(t),
          })
        : null;
      stream.close();
      this.finish(r, id, { outcome: "delivered", mode, ...(answer ? { reply: answer } : {}) }, sent);
    })().catch((e) => this.finish(r, id, { outcome: "delivered", mode, detail: String((e as Error)?.message || e) }));
  }

  /** The answer so far, sent as a `progress` ack: whole, with a rising seq, at most
   *  one in flight. Fire-and-forget — the final ack carries everything. */
  private answerStream(r: PairedReceiver, id: string): AnswerStream {
    return new AnswerStream(async (text, seq) => {
      await this.post(r, "/ack", {
        acks: [
          {
            id,
            outcome: "progress",
            at: new Date(this.deps.now()).toISOString(),
            seq,
            reply: redactSecrets(text).slice(0, MAX_REPLY),
          },
        ],
      });
    });
  }

  /** How a headless run prints: streamed where this Claude Code can, else one JSON at the end. */
  private outputArgs(caps: { stream?: boolean }): string[] {
    return caps.stream
      ? ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]
      : ["--output-format", "json"];
  }

  private limits() {
    const l = this.cfg.limits ?? {};
    const n = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : d);
    return {
      startConcurrent: n(l.start_concurrent, LIMITS.startConcurrent),
      startPerHour: n(l.start_per_hour, LIMITS.startPerHour),
      headless: Math.max(1, n(l.headless, LIMITS.headless)),
    };
  }

  /** One headless Claude Code process at a time per slot; the rest wait in order. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.procs >= this.limits().headless) await new Promise<void>((r) => this.procWaiters.push(r));
    this.procs++;
    try {
      return await fn();
    } finally {
      this.procs--;
      this.procWaiters.shift()?.();
    }
  }

  private async startSession(r: PairedReceiver, id: string, cmd: ControlCommand, sent: number): Promise<void> {
    const lim = this.limits();
    const now = this.deps.now();
    this.startTimes = this.startTimes.filter((t) => now - t < 3_600_000);
    if (this.startsRunning >= lim.startConcurrent || this.startTimes.length >= lim.startPerHour) {
      const detail =
        this.startsRunning >= lim.startConcurrent
          ? `this machine is already starting ${this.startsRunning} new session(s); it starts at most ${lim.startConcurrent} at once`
          : `this machine started ${this.startTimes.length} new sessions in the last hour, its limit`;
      this.deps.log(`refused ${id.slice(-8)}: start_limit — ${detail}`);
      return this.finish(r, id, { outcome: "refused", code: "start_limit", detail });
    }
    this.startsRunning++;
    this.startTimes.push(now);
    try {
      await this.startOne(r, id, cmd, sent);
    } finally {
      this.startsRunning--;
    }
  }

  private async startOne(r: PairedReceiver, id: string, cmd: ControlCommand, sent: number): Promise<void> {
    const ref = parseSessionRef(cmd.session)!;
    const cwd = this.allowed(cmd.cwd as string);
    if (!cwd)
      return this.finish(r, id, {
        outcome: "refused",
        code: "folder",
        detail: "that folder isn't one this machine allows",
      });
    if (findTranscript(ref.id, this.deps.claudeDirs()) || this.sdkSessions.has(ref.id))
      return this.finish(r, id, {
        outcome: "refused",
        code: "bad_session",
        detail: "that new session's id is already taken",
      });
    this.finish(r, id, { outcome: "taken" });
    if (this.deps.sdk) {
      const sdk = this.deps.sdk;
      const out = await this.slot(async () => {
        const s = sdk.start({ session: ref.id, cwd, mode: this.cfg.mode, allowedTools: this.allowedFor(r) });
        this.sdkSessions.set(ref.id, s);
        return s.send(frame(cmd.text as string, r.url));
      });
      return this.finish(
        r,
        id,
        out.error ? { outcome: "failed", detail: out.error } : { outcome: "delivered", mode: "sdk", reply: out.reply },
        sent,
      );
    }
    const claude = this.deps.claude();
    if (!claude)
      return this.finish(r, id, { outcome: "failed", detail: "Claude Code isn't installed on this machine" });
    const mf = modeFlags(this.cfg.mode, claude.caps);
    if ("error" in mf) return this.finish(r, id, { outcome: "refused", code: "mode", detail: mf.error });
    const stream = this.answerStream(r, id);
    const res = await this.slot(() =>
      this.deps.run(
        claude.bin,
        [
          "-p",
          ...this.outputArgs(claude.caps),
          ...mf.args,
          ...(this.allowedFor(r).length ? [`--allowedTools=${this.allowedFor(r).join(",")}`] : []),
          "--session-id",
          ref.id,
          frame(cmd.text as string, r.url),
        ],
        {
          cwd,
          env: claudeEnv(undefined, this.deps.env),
          timeoutMs: JOB_TIMEOUT_MS,
          ...(claude.caps.stream ? { onLine: (l: string) => stream.feed(l) } : {}),
        },
      ),
    );
    stream.close();
    // The transcript this run just wrote is ours: the next message must not read it as a
    // live session (a fork instead of a resume).
    this.lastEnd.set(ref.id, this.deps.now());
    const out = this.outcome(res);
    if ("failed" in out) return this.finish(r, id, { outcome: "failed", detail: out.failed });
    this.finish(r, id, { outcome: "delivered", mode: "resume", reply: out.reply }, sent);
  }

  private closeIdleSdk(): void {
    const idle = this.deps.sdkIdleMs ?? 10 * 60_000;
    for (const [id, s] of this.sdkSessions)
      if (!s.busy && this.deps.now() - s.lastUsed > idle) {
        s.close();
        this.sdkSessions.delete(id);
        this.deps.log(
          `sdk session ${id.slice(0, 8)} closed after ${Math.round(idle / 60_000)} min idle (it resumes on the next message)`,
        );
      }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref?.());
