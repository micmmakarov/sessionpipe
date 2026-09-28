#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// sessionpipe: install once, hook everything, choose per sink what leaves.
//   install · uninstall · sink add|list|remove|test · status · doctor · tail ·
//   backfill · forget · replay · update · hook · worker
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTERS,
  adapterByName,
  type Config,
  Cursors,
  configFile,
  type Event,
  filterEvent,
  type HookCommand,
  machineName,
  makeEvent,
  Outbox,
  readConfig,
  type SinkConfig,
  stateDir,
  type Tier,
  tilde,
  writeConfig,
} from "@sessionpipe/core";
import { buildSinks, factsState, flush, jobsDir, runJob, VERSION } from "./run.js";

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
});
const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(name);
const out = (s = ""): void => {
  process.stdout.write(`${s}\n`);
};
const state = stateDir();
const distDir = path.dirname(fileURLToPath(import.meta.url));

/** The command a hook entry runs: this node by a stable absolute path, hook.js by its real path. */
function hookCommand(): HookCommand {
  const node = stableNode(process.execPath);
  let script = path.join(distDir, "hook.js");
  try {
    script = realpathSync(script);
  } catch {}
  return (a) => ({
    argv: [node, script, ...a],
    command: `${JSON.stringify(node)} ${JSON.stringify(script)} ${a.join(" ")}`,
  });
}
/** Homebrew's versioned Cellar path dies on `brew upgrade node`; its stable links survive. */
function stableNode(exe: string): string {
  const m = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(exe);
  if (!m) return exe;
  let real: string;
  try {
    real = realpathSync(exe);
  } catch {
    return exe;
  }
  for (const c of [`${m[1]}/opt/${m[2]}/bin/node`, `${m[1]}/bin/node`]) {
    try {
      if (realpathSync(c) === real) return c;
    } catch {}
  }
  return exe;
}
const viaNpx = /[\\/]_npx[\\/]/.test(distDir) || /[\\/]\.npm[\\/]/.test(distDir);

function selectedAdapters(): typeof ADAPTERS {
  const named = ADAPTERS.filter((a) => has(`--${a.name}`));
  if (named.length) return named;
  return ADAPTERS.filter((a) => a.detect());
}

async function main(): Promise<void> {
  switch (cmd) {
    case "install":
      return install();
    case "uninstall":
      return uninstall();
    case "sink":
      return sink();
    case "status":
      return status();
    case "doctor":
      return doctor();
    case "tail":
      return tail();
    case "backfill":
      return backfill();
    case "forget":
      return forget();
    case "replay":
      return replay();
    case "update":
      return update();
    case "worker":
      return workerFromArgv();
    case "hook":
      out("sessionpipe hook is dist/hook.js; harnesses run it directly");
      return;
    case "--version":
    case "-v":
    case "version":
      out(VERSION);
      return;
    default:
      return help();
  }
}

function help(): void {
  out(`sessionpipe ${VERSION} — an open protocol for what your coding agents are doing

  sessionpipe install [--claude-code --codex --gemini-cli --antigravity] [--machine NAME] [--backfill DAYS] [--sink URL --tier N]
  sessionpipe uninstall [--keep-state]
  sessionpipe sink add <url|file:PATH|stdout> [--tier 0-3] [--token T] [--pii] [--control] [--name N]
  sessionpipe sink list | remove <name> | test <name>
  sessionpipe status | doctor [--json]
  sessionpipe tail [--session ID] [--tier N] [--harness NAME]
  sessionpipe backfill [--days 30] | forget <harness> <session> | replay --sink NAME
  sessionpipe update

Docs: https://sessionpipe.org · nothing leaves this machine until you add a sink.`);
}

async function install(): Promise<void> {
  if (viaNpx) {
    out(`  Installing sessionpipe@${VERSION} globally, so the hooks start in milliseconds…`);
    try {
      execFileSync("npm", ["install", "-g", `sessionpipe@${VERSION}`], { stdio: ["ignore", "ignore", "inherit"] });
      const bin = process.platform === "win32" ? "sessionpipe.cmd" : "sessionpipe";
      execFileSync(bin, args, { stdio: "inherit", shell: process.platform === "win32" });
      return;
    } catch {
      out(
        "  ! couldn't install globally (`npm install -g sessionpipe` failed). Run it yourself, then `sessionpipe install`.",
      );
      process.exit(1);
    }
  }
  const cfg = readConfig();
  const machine = flag("--machine");
  if (machine) cfg.machine = machine.slice(0, 80);
  const adapters = selectedAdapters();
  if (!adapters.length) {
    out(
      "  No supported harness found on this machine (Claude Code, Codex, Gemini CLI, Antigravity). Pass --<harness> to force one.",
    );
    return;
  }
  out(`  Machine: ${machineName(cfg, os.hostname())}`);
  const hc = hookCommand();
  for (const a of adapters) {
    const reports = a.install(hc);
    cfg.harnesses[a.name] = { enabled: true };
    for (const r of reports)
      out(
        `  ${r.changed ? "✓" : "="} ${a.name}: ${tilde(r.file)}${r.note ? ` — ${r.note}` : r.changed ? " written" : " already current"}`,
      );
    if (a.name === "gemini-cli")
      out("    note: Gemini CLI's own telemetry defaults logPrompts on; that is Google's setting, not sessionpipe's.");
    if (a.name === "codex")
      out(
        "    note: Codex runs non-managed hooks only after you trust them: open Codex and run /hooks once. The notify fallback reports turn ends meanwhile.",
      );
  }
  writeConfig(cfg);
  const sinkUrl = flag("--sink");
  if (sinkUrl) await sinkAdd(sinkUrl, cfg);
  const days = Number(flag("--backfill") ?? 30);
  if (days > 0) backfillRows(adapters, days, cfg);
  out("");
  const live = cfg.sinks.filter((s) => !s.paused);
  if (live.length) out(`  Reporting to ${live.map((s) => `${s.name} (tier ${s.tier})`).join(", ")}.`);
  else
    out(
      "  Nothing leaves this machine yet: events go to the local outbox. `sessionpipe tail` shows them; `sessionpipe sink add <url> --tier N` sends them.",
    );
  out("  Sessions already running pick up hooks on their next start (Claude Code ≥ 2.1.280 picks them up live).");
}

function uninstall(): void {
  for (const a of ADAPTERS) {
    for (const r of a.uninstall()) if (r.changed) out(`  ✓ ${a.name}: hooks removed from ${tilde(r.file)}`);
  }
  if (!has("--keep-state"))
    out(
      `  Outbox and state kept under ${tilde(state)} (delete it yourself, or pass nothing: it prunes after ${readConfig().keep_days ?? 30} days).`,
    );
  out("  Done. Every config file is byte-identical except for the entries sessionpipe wrote.");
}

async function sink(): Promise<void> {
  const sub = args[1];
  const cfg = readConfig();
  if (sub === "add" && args[2]) return sinkAdd(args[2], cfg);
  if (sub === "list") {
    if (!cfg.sinks.length) out("  no sinks");
    for (const s of cfg.sinks)
      out(
        `  ${s.name.padEnd(16)} ${s.url.padEnd(44)} tier ${s.tier}${s.max_tier !== undefined && s.max_tier < s.tier ? ` (capped ${s.max_tier})` : ""}${s.pii ? " pii" : ""}${s.control ? " control" : ""}${s.paused ? ` PAUSED ${s.paused}` : ""}`,
      );
    return;
  }
  if (sub === "remove" && args[2]) {
    const n = cfg.sinks.length;
    cfg.sinks = cfg.sinks.filter((s) => s.name !== args[2]);
    writeConfig(cfg);
    out(cfg.sinks.length < n ? `  ✓ removed ${args[2]}` : `  no sink named ${args[2]}`);
    return;
  }
  if (sub === "test" && args[2]) {
    const s = cfg.sinks.find((x) => x.name === args[2]);
    if (!s) return out(`  no sink named ${args[2]}`);
    const [sk] = buildSinks([s]);
    if (!sk) return out("  sink type not supported yet");
    const e = makeEvent(
      { type: "session.heartbeat", harnessEvent: "test", data: {} },
      {
        harness: { name: "sessionpipe" },
        session: { id: `test-${Date.now()}`, seq: 0, machine: machineName(cfg, os.hostname()) },
      },
    );
    const r = await sk.send([filterEvent(e, sk.tier, sk.pii) as Event]);
    out(
      r.ok
        ? `  ✓ ${s.name}: ${r.status ?? "ok"} accepted ${r.accepted ?? 1}`
        : `  ✗ ${s.name}: ${r.status ?? ""} ${r.error ?? ""} (${r.action})`,
    );
    return;
  }
  out(
    "usage: sessionpipe sink add <url|file:PATH|stdout> [--tier N] [--token T] [--pii] [--control] [--name N] | list | remove <name> | test <name>",
  );
}

async function sinkAdd(url: string, cfg: Config): Promise<void> {
  const tier = Math.max(0, Math.min(3, Number(flag("--tier") ?? 0))) as Tier;
  const name = flag("--name") ?? (url === "stdout" ? "stdout" : url.startsWith("file:") ? "file" : new URL(url).host);
  const s: SinkConfig = { name, url, tier, pii: has("--pii"), control: has("--control") };
  const token = flag("--token");
  if (token) s.token = token;
  const secret = flag("--secret");
  if (secret) s.secret = secret;
  if (/^https?:\/\//.test(url)) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/.well-known/sessionpipe`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const wk = (await r.json()) as { max_tier?: number; endpoints?: { events?: string }; capabilities?: string[] };
      if (typeof wk.max_tier === "number") {
        s.max_tier = wk.max_tier as Tier;
        if (wk.max_tier < tier)
          out(`  receiver's max_tier is ${wk.max_tier}: sending tier ${wk.max_tier}, not ${tier}`);
      }
      if (wk.endpoints) (s as SinkConfig & { endpoints?: unknown }).endpoints = wk.endpoints;
      s.well_known_at = new Date().toISOString();
      if (s.control && !(wk.capabilities ?? []).includes("control")) {
        out("  receiver does not list `control`; --control ignored");
        s.control = false;
      }
    } catch (e) {
      out(
        `  ! ${url} has no readable /.well-known/sessionpipe (${(e as Error).message}); added anyway, at tier ${tier}`,
      );
    }
  }
  cfg.sinks = cfg.sinks.filter((x) => x.name !== name).concat([s]);
  writeConfig(cfg);
  out(
    `  ✓ sink ${name}: ${url} at tier ${Math.min(tier, s.max_tier ?? 3)}${s.pii ? ", pii" : ""}${s.control ? ", control" : ""}`,
  );
  out(`    tier ${tier} sends: ${TIER_TEXT[Math.min(tier, s.max_tier ?? 3) as Tier]}`);
}
const TIER_TEXT: Record<Tier, string> = {
  0: "session state and timing, machine, folder, repo, branch, model, title, link, the KIND of attention needed — no tool names, no words",
  1: "tier 0 + tool names, durations, ok/error, file paths, the attention message, subagents, compactions — no prompts",
  2: "tier 1 + your prompts and the assistant's text, secrets removed",
  3: "everything, including tool input and output",
};

function backfillRows(adapters: readonly (typeof ADAPTERS)[number][], days: number, cfg: Config): void {
  const since = Date.now() - days * 86_400_000;
  const outbox = new Outbox(state);
  let n = 0;
  const machine = machineName(cfg, os.hostname());
  for (const a of adapters) {
    for (const row of a.backfill(since)) {
      const ref = { harness: a.name, session: row.session.id };
      const facts = factsState(state).get(a.name, row.session.id);
      if (facts.backfilled) continue;
      const { id, ...rest } = row.session;
      const e = makeEvent(
        {
          type: "session.backfill",
          harnessEvent: "backfill",
          data: {
            started_at: new Date(row.started_at).toISOString(),
            last_at: new Date(row.last_at).toISOString(),
            ...(row.turns !== undefined ? { turns: row.turns } : {}),
          },
        },
        {
          harness: { name: a.name },
          session: { ...rest, id, seq: outbox.nextSeq(ref), machine, ...(rest.cwd ? { cwd: tilde(rest.cwd) } : {}) },
          now: row.last_at,
        },
      );
      outbox.append(ref, [e]);
      factsState(state).save(a.name, row.session.id, { backfilled: true });
      n++;
    }
  }
  out(`  ✓ Backfill: ${n} session${n === 1 ? "" : "s"} from the last ${days} days queued as session.backfill`);
  void flush(state, cfg.sinks, outbox);
}

function backfill(): void {
  backfillRows(selectedAdapters(), Number(flag("--days") ?? 30), readConfig());
}

async function forget(): Promise<void> {
  const [, harness, session] = args;
  if (!harness || !session) return out("usage: sessionpipe forget <harness> <session>");
  const cfg = readConfig();
  const outbox = new Outbox(state);
  const ref = { harness, session };
  const e = makeEvent(
    { type: "session.forgotten", harnessEvent: "forget", data: {} },
    {
      harness: { name: harness },
      session: { id: session, seq: outbox.nextSeq(ref), machine: machineName(cfg, os.hostname()) },
    },
  );
  const sinks = buildSinks(cfg.sinks);
  for (const s of sinks) {
    const r = await s.send([filterEvent(e, s.tier, s.pii) as Event]);
    out(r.ok ? `  ✓ ${s.name}: asked to delete ${harness}:${session}` : `  ✗ ${s.name}: ${r.error ?? r.status}`);
  }
  outbox.delete(ref);
  out("  local outbox for the session removed");
}

async function replay(): Promise<void> {
  const name = flag("--sink");
  const cfg = readConfig();
  const sinks = name ? cfg.sinks.filter((s) => s.name === name) : cfg.sinks;
  if (!sinks.length) return out("  no such sink");
  for (const s of sinks) {
    if (has("--from-start")) new Cursors(state, s.name).write({});
  }
  const d = await flush(state, sinks, new Outbox(state));
  for (const [k, v] of Object.entries(d)) out(`  ${k}: ${v} event${v === 1 ? "" : "s"} delivered`);
}

function status(): void {
  const cfg = readConfig();
  const hc = hookCommand();
  out(`  machine:  ${machineName(cfg, os.hostname())}   sessionpipe ${VERSION}   state ${tilde(state)}`);
  for (const a of ADAPTERS) {
    if (!a.detect() && !cfg.harnesses[a.name]) continue;
    for (const r of a.installed(hc)) out(`  ${a.name.padEnd(12)} ${tilde(r.file).padEnd(44)} ${r.state}`);
  }
  if (!cfg.sinks.length) out("  sinks:    none (events stay in the local outbox)");
  for (const s of cfg.sinks) {
    const c = new Cursors(state, s.name).read();
    const outbox = new Outbox(state);
    let pending = 0;
    for (const ref of outbox.sessions()) {
      const f = outbox.file(ref);
      try {
        pending += Math.max(0, statSync(f).size - (c[`${ref.harness}/${ref.session}`] ?? 0)) > 0 ? 1 : 0;
      } catch {}
    }
    out(
      `  sink      ${s.name.padEnd(16)} tier ${Math.min(s.tier, s.max_tier ?? 3)}  ${s.paused ? `PAUSED ${s.paused}` : pending ? `${pending} session file(s) with undelivered events` : "up to date"}`,
    );
  }
  const t = timing();
  if (t) out(`  hook:     p50 ${t.p50} ms · p95 ${t.p95} ms over ${t.n} runs`);
  const jobs = jobsDir(state);
  try {
    const n = readdirSync(jobs).length;
    if (n) out(`  jobs:     ${n} waiting`);
  } catch {}
}

function timing(): { n: number; p50: number; p95: number } | null {
  try {
    const lines = readFileSync(path.join(state, "timing.jsonl"), "utf8").trim().split("\n").slice(-100);
    const ms = lines
      .map((l) => (JSON.parse(l) as { ms: number }).ms)
      .filter((x) => x >= 0)
      .sort((a, b) => a - b);
    if (!ms.length) return null;
    const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0);
    return { n: ms.length, p50: q(0.5), p95: q(0.95) };
  } catch {
    return null;
  }
}

function doctor(): void {
  const cfg = readConfig();
  const hc = hookCommand();
  const report: Record<string, unknown> = {
    version: VERSION,
    node: process.version,
    node_path: stableNode(process.execPath),
    machine: machineName(cfg, os.hostname()),
    state: state,
    config: configFile(),
    harnesses: {},
    sinks: [],
    timing: timing(),
    warnings: [] as string[],
  };
  const warnings = report.warnings as string[];
  if (/\/Cellar\/node(?:@\d+)?\/[^/]+\//.test(distDir))
    warnings.push(
      "sessionpipe is installed inside Homebrew's versioned node folder; `brew upgrade node` will delete it. Install with `npm install -g --prefix ~/.local sessionpipe`.",
    );
  for (const a of ADAPTERS) {
    if (!a.detect()) continue;
    const st = a.installed(hc);
    (report.harnesses as Record<string, unknown>)[a.name] = st.map((r) => ({ file: tilde(r.file), state: r.state }));
    for (const r of st)
      if (r.state === "stale")
        warnings.push(
          `${a.name}: the hook in ${tilde(r.file)} points at an old node or script path; run \`sessionpipe install\` again.`,
        );
    for (const r of st)
      if (r.state === "misplaced")
        warnings.push(
          `${a.name}: the notify line in ${tilde(r.file)} sits inside a [table], where Codex never reads it; run \`sessionpipe install\` again.`,
        );
  }
  for (const s of cfg.sinks)
    (report.sinks as unknown[]).push({
      name: s.name,
      url: s.url,
      tier: s.tier,
      max_tier: s.max_tier ?? null,
      pii: !!s.pii,
      control: !!s.control,
      paused: s.paused ?? null,
      token: s.token ? `${s.token.slice(0, 4)}…` : null,
    });
  const t = timing();
  if (t && t.p50 > 150)
    warnings.push(`hook p50 is ${t.p50} ms (target < 150). Is node on a slow disk or a network share?`);
  if (has("--json")) {
    out(JSON.stringify(report, null, 2));
    return;
  }
  out(`  sessionpipe ${VERSION} · node ${process.version} at ${report.node_path}`);
  out(`  config ${tilde(configFile())} · state ${tilde(state)}`);
  for (const [h, st] of Object.entries(report.harnesses as Record<string, { file: string; state: string }[]>))
    for (const r of st) out(`  ${h.padEnd(12)} ${r.file.padEnd(44)} ${r.state}`);
  for (const s of report.sinks as { name: string; tier: number; max_tier: number | null; paused: string | null }[])
    out(
      `  sink ${s.name.padEnd(16)} tier ${s.tier}${s.max_tier !== null ? ` (receiver max ${s.max_tier})` : ""}${s.paused ? ` PAUSED ${s.paused}` : ""}`,
    );
  out(t ? `  hook p50 ${t.p50} ms · p95 ${t.p95} ms over ${t.n} runs` : "  hook timing: no runs yet");
  for (const w of warnings) out(`  ! ${w}`);
  if (!warnings.length) out("  no warnings");
}

/** Follow the local outbox: one event per line, filtered to a tier. The zero-server demo. */
async function tail(): Promise<void> {
  const tier = Math.max(0, Math.min(3, Number(flag("--tier") ?? 1))) as Tier;
  const onlySession = flag("--session");
  const onlyHarness = flag("--harness");
  const outbox = new Outbox(state);
  const offsets = new Map<string, number>();
  const fmt = (e: Event): string => {
    const t = e.time.slice(11, 19);
    const d = e.data as Record<string, unknown>;
    let detail = "";
    switch (e.type) {
      case "session.started":
        detail = `source=${d.source}  ${e.session.cwd ?? ""} ${e.session.branch ?? ""}`;
        break;
      case "turn.started":
        detail = d.prompt_chars !== undefined ? `prompt_chars=${d.prompt_chars}` : "";
        break;
      case "tool.started":
        detail = String(d.tool ?? "");
        break;
      case "tool.ended":
        detail = `${d.tool} ${d.ok ? "ok" : "error"}${d.ms !== undefined ? ` ${d.ms}ms` : ""}`;
        break;
      case "attention.needed":
        detail = `${d.kind}${d.tool ? ` ${d.tool}` : ""}${d.message ? ` "${String(d.message).slice(0, 60)}"` : ""}`;
        break;
      case "turn.ended":
        detail = String(d.reason ?? "");
        break;
      case "session.ended":
        detail = `reason=${d.reason}`;
        break;
      case "turn.transcript":
        detail = `#${d.turn} "${String(d.user).slice(0, 50).replace(/\s+/g, " ")}"`;
        break;
      case "session.backfill":
        detail = `${e.session.title ?? ""}`;
        break;
      default:
        detail = JSON.stringify(d).slice(0, 80);
    }
    return `${t} ${e.harness.name.padEnd(11)} ${e.session.id.slice(0, 4)}…  ${e.type.padEnd(17)} ${detail}`;
  };
  out(`sessionpipe tail · tier ${tier} · ${tilde(state)}/outbox (Ctrl-C to stop)`);
  // Start at the end of each file unless --all.
  for (const ref of outbox.sessions()) {
    try {
      offsets.set(`${ref.harness}/${ref.session}`, has("--all") ? 0 : statSync(outbox.file(ref)).size);
    } catch {}
  }
  for (;;) {
    for (const ref of outbox.sessions()) {
      if (onlyHarness && ref.harness !== onlyHarness) continue;
      if (onlySession && !ref.session.startsWith(onlySession)) continue;
      const k = `${ref.harness}/${ref.session}`;
      const from = offsets.get(k) ?? 0;
      const { events, offset } = outbox.read(ref, from, 200);
      offsets.set(k, offset);
      for (const e of events) {
        const f = filterEvent(e, tier, false);
        if (f) out(has("--json") ? JSON.stringify(f) : fmt(f));
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function workerFromArgv(): Promise<void> {
  const f = args[1];
  if (!f) return;
  const job = JSON.parse(readFileSync(f, "utf8"));
  try {
    unlinkSync(f);
  } catch {}
  await runJob(job);
}

async function update(): Promise<void> {
  if (process.env.SESSIONPIPE_NO_UPDATE_CHECK) return out("  update check is off (SESSIONPIPE_NO_UPDATE_CHECK)");
  try {
    const r = await fetch("https://registry.npmjs.org/sessionpipe/latest", { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { version?: string };
    if (!j.version) throw new Error("no version");
    if (j.version === VERSION) return out(`  sessionpipe ${VERSION} is current`);
    out(`  ${j.version} is available (you run ${VERSION}); installing into this copy's prefix…`);
    const prefix = prefixOf(distDir);
    execFileSync("npm", ["install", "-g", `sessionpipe@${j.version}`, ...(prefix ? ["--prefix", prefix] : [])], {
      stdio: "inherit",
    });
    out("  re-arming hooks…");
    const bin = prefix ? path.join(prefix, "bin", "sessionpipe") : "sessionpipe";
    const p = spawn(bin, ["install", "--backfill", "0"], { stdio: "inherit" });
    await new Promise((r) => p.on("exit", r));
  } catch (e) {
    out(`  couldn't check npm: ${(e as Error).message}`);
  }
}
function prefixOf(p: string): string | null {
  const re =
    process.platform === "win32"
      ? /^(.*?)[\\/]node_modules[\\/]sessionpipe[\\/]/
      : /^(.*)\/lib\/node_modules\/sessionpipe\//;
  const m = re.exec(p);
  return m?.[1] ?? null;
}

main().catch((e) => {
  process.stderr.write(`sessionpipe: ${(e as Error).message}\n`);
  process.exit(1);
});
