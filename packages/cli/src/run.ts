// SPDX-License-Identifier: Apache-2.0
// What a worker run does, as a function so tests and `sessionpipe replay` share it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adapterByName,
  Cursors,
  type Event,
  type FactsState,
  FileSink,
  filterEvent,
  gitFacts,
  machineName,
  makeEvent,
  Outbox,
  readConfig,
  type Session,
  type Sink,
  type SinkConfig,
  StdoutSink,
  safeId,
  stateDir,
  takeLock,
  tilde,
  writeConfig,
} from "@sessionpipe/core";
import { HttpSink } from "./http-sink.js";

declare const __SESSIONPIPE_VERSION__: string;
const VERSION = typeof __SESSIONPIPE_VERSION__ === "string" ? __SESSIONPIPE_VERSION__ : "0.0.0";

export interface Job {
  harness: string;
  event: string;
  argv: string[];
  stdin: string;
  cwd: string;
  env: Record<string, string>;
  ppid?: number;
  at: number;
}

export function log(state: string, line: string): void {
  try {
    mkdirSync(state, { recursive: true });
    const f = path.join(state, "log");
    try {
      if (statSync(f).size > 1024 * 1024) renameSync(f, `${f}.1`);
    } catch {}
    appendFileSync(f, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

/** <state>/facts/<harness>/<session>.json — what the machine learned about a session. */
export function factsState(state: string): FactsState {
  const file = (h: string, s: string) => path.join(state, "facts", safeId(h), `${safeId(s)}.json`);
  return {
    get(h, s) {
      try {
        return JSON.parse(readFileSync(file(h, s), "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
    save(h, s, patch) {
      const cur = this.get(h, s);
      const next = { ...cur, ...patch };
      if (JSON.stringify(next) === JSON.stringify(cur)) return;
      mkdirSync(path.dirname(file(h, s)), { recursive: true });
      writeFileSync(file(h, s), JSON.stringify(next));
    },
  };
}

export function buildSinks(sinks: SinkConfig[]): Sink[] {
  const out: Sink[] = [];
  for (const s of sinks) {
    if (s.paused) continue;
    const tier = Math.min(s.tier, s.max_tier ?? 3) as 0 | 1 | 2 | 3;
    if (s.url === "stdout") out.push(new StdoutSink(s.name, tier, !!s.pii));
    else if (s.url.startsWith("file:"))
      out.push(new FileSink(s.name, s.url.slice(5).replace(/^~(?=\/|$)/, os.homedir()), tier, !!s.pii));
    else if (/^https?:\/\//.test(s.url)) out.push(new HttpSink(s, tier));
  }
  return out;
}

/** Run one hook job end to end: events → outbox → sinks. Returns what happened. */
export async function runJob(
  job: Job,
  opts: { state?: string; now?: number } = {},
): Promise<{ events: Event[]; delivered: Record<string, number> }> {
  const state = opts.state ?? stateDir();
  const cfg = readConfig();
  const adapter = adapterByName(job.harness);
  if (!adapter) return { events: [], delivered: {} };
  const r = adapter.fromHook({ argv: job.argv, stdin: job.stdin, env: { ...process.env, ...job.env }, cwd: job.cwd });
  if (!r || !r.session.id) return { events: [], delivered: {} };
  const outbox = new Outbox(state);
  const ref = { harness: job.harness, session: r.session.id };
  const release = takeLock(state, ref);
  if (!release) {
    // Another worker holds this session: leave the job for it by re-queueing.
    log(state, `${job.harness} ${job.event}: session ${r.session.id} locked, re-queued`);
    const jobs = path.join(state, "jobs");
    mkdirSync(jobs, { recursive: true });
    writeFileSync(path.join(jobs, `${Date.now().toString(36)}-requeue.json`), JSON.stringify(job));
    return { events: [], delivered: {} };
  }
  try {
    const facts = factsState(state);
    const mem = facts.get(job.harness, r.session.id);
    // Heartbeat-class events read no facts (they fire every tool call); the rest refresh them.
    const heavy = !/^(PreToolUse|PostToolUse|PostToolUseFailure|BeforeTool|AfterTool|PostInvocation)$/.test(job.event);
    let learned: Partial<Session> = {};
    if (heavy) {
      const f = adapter.facts(r.session, r.transcript, r.hints ?? {}, facts);
      const { started_at: _s, last_at: _l, first_ask: _fa, harness_version, ...rest } = f;
      learned = rest;
      if (harness_version) facts.save(job.harness, r.session.id, { harness_version });
      facts.save(job.harness, r.session.id, { session: { ...(mem.session as object), ...learned } });
    }
    const known = (mem.session as Partial<Session> | undefined) ?? {};
    const cwdRaw = learned.cwd ?? r.session.cwd ?? known.cwd;
    const git = heavy ? gitFacts(cwdRaw) : {};
    const session: Session = {
      ...known,
      ...learned,
      ...git,
      ...(learned.branch ? { branch: learned.branch } : {}),
      id: r.session.id,
      seq: 0,
      machine: machineName(cfg, os.hostname()),
      ...(cwdRaw ? { cwd: tilde(cwdRaw) } : {}),
      ...(r.session.model ? { model: r.session.model } : {}),
    };
    const version = (facts.get(job.harness, r.session.id).harness_version as string | undefined) ?? undefined;
    const events: Event[] = [];
    for (const a of r.events) {
      const e = makeEvent(a, {
        harness: { name: job.harness, ...(version ? { version } : {}) },
        session: { ...session, seq: outbox.nextSeq(ref) },
        now: opts.now ?? job.at,
      });
      events.push(e);
    }
    // Tier 2: after a turn ends, the transcript's new turns become turn.transcript events.
    const wantsTranscript = cfg.sinks.some((s) => !s.paused && Math.min(s.tier, s.max_tier ?? 3) >= 2);
    if (
      wantsTranscript &&
      r.transcript &&
      r.events.some((e) => e.type === "turn.ended" || e.type === "session.ended")
    ) {
      const cur = facts.get(job.harness, r.session.id);
      const fromLine = Number(cur.transcript_line) || 0;
      let turnNo = Number(cur.transcript_turns) || 0;
      const read = adapter.readTranscript(r.transcript, fromLine);
      for (const t of read.turns) {
        events.push(
          makeEvent(
            {
              type: "turn.transcript",
              harnessEvent: job.event,
              data: { turn: turnNo++, user: t.user, assistant: t.assistant, at: new Date(t.at).toISOString() },
            },
            {
              harness: { name: job.harness, ...(version ? { version } : {}) },
              session: { ...session, seq: outbox.nextSeq(ref) },
              now: opts.now ?? job.at,
            },
          ),
        );
      }
      if (read.turns.length)
        facts.save(job.harness, r.session.id, { transcript_line: read.line, transcript_turns: turnNo });
    }
    outbox.append(ref, events);
    log(
      state,
      `${job.harness} ${job.event}: ${events.map((e) => e.type).join(",") || "nothing"} (${r.session.id.slice(0, 8)})`,
    );
    const delivered = await flush(state, cfg.sinks, outbox, ref);
    if (Math.random() < 0.02) outbox.prune(cfg.keep_days ?? 30);
    return { events, delivered };
  } finally {
    release();
  }
}

const BATCH = 50;
const MAX_PER_RUN = 500;

/** Drain every sink from its cursor: this session first, then any backlog. */
export async function flush(
  state: string,
  sinkConfigs: SinkConfig[],
  outbox: Outbox,
  first?: { harness: string; session: string },
): Promise<Record<string, number>> {
  const delivered: Record<string, number> = {};
  const sinks = buildSinks(sinkConfigs);
  const refs = outbox.sessions();
  if (first) {
    const k = `${first.harness}/${safeId(first.session)}`;
    refs.sort((a, b) => (`${a.harness}/${a.session}` === k ? -1 : `${b.harness}/${b.session}` === k ? 1 : 0));
  }
  for (const sink of sinks) {
    const cursors = new Cursors(state, sink.name);
    const c = cursors.read();
    let sent = 0;
    for (const ref of refs) {
      if (sent >= MAX_PER_RUN) break;
      let offset = c[cursors.key(ref)] ?? 0;
      let stalled = false;
      while (sent < MAX_PER_RUN) {
        const { events, offset: next } = outbox.read(ref, offset, BATCH);
        if (!events.length) break;
        const filtered = events
          .map((e) => filterEvent(e, sink.tier, sink.pii, { home: os.homedir() }))
          .filter((e): e is Event => !!e);
        let ok = true;
        if (filtered.length) {
          const res = await sink.send(filtered);
          ok = res.ok;
          if (!ok) {
            log(state, `sink ${sink.name}: ${res.status ?? ""} ${res.error ?? ""} → ${res.action ?? "retry"}`);
            if (res.action === "pause" || res.action === "lower-tier") applySinkVerdict(sink.name, res);
            if (res.action === "drop") ok = true; // a batch the receiver will never take: skip it
          }
          if (ok) sent += filtered.length;
        }
        if (!ok) {
          stalled = true;
          break;
        }
        offset = next;
        c[cursors.key(ref)] = offset;
        cursors.write(c);
      }
      if (stalled) break;
    }
    delivered[sink.name] = sent;
  }
  return delivered;
}

function applySinkVerdict(name: string, res: { action?: string; max_tier?: number; error?: string }): void {
  try {
    const cfg = readConfig();
    const s = cfg.sinks.find((x) => x.name === name);
    if (!s) return;
    if (res.action === "pause") s.paused = `${new Date().toISOString()} ${res.error ?? "unauthorized"}`;
    if (res.action === "lower-tier" && typeof res.max_tier === "number") s.max_tier = res.max_tier as 0 | 1 | 2 | 3;
    writeConfig(cfg);
  } catch {}
}

export { VERSION };
export const versionLine = (): string => `sessionpipe ${VERSION}`;
export const jobsDir = (state: string): string => path.join(state, "jobs");
export const hasJobs = (state: string): boolean => existsSync(jobsDir(state));
