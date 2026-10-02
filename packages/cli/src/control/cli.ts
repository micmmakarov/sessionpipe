// SPDX-License-Identifier: Apache-2.0
// `sessionpipe control pair | keys | off | run | status` and `sessionpipe wait`.
import { existsSync, realpathSync, watchFile } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeControl, claudeDirs, privateDir, readConfig, stateDir, writeConfig } from "@sessionpipe/core";

const { detectCaps, findClaude, runClaude } = claudeControl;

import { ControlDaemon } from "./daemon.js";
import { ask, socketPath } from "./local.js";
import { installService, off, pair, removeKey, uninstallService } from "./pair.js";
import { loadSdk } from "./sdk.js";
import { controlFile, controlState, readControl, writeControl } from "./store.js";
import { waitForMessage, waitSession } from "./wait.js";

export const CONTROL_HELP = `  sessionpipe control pair <receiver> [--folder DIR]… [--mode safe|auto] [--token T] [--name N] [--no-service]
  sessionpipe control mode auto|safe                (how sessions run when you message them)
  sessionpipe control status | keys [remove <id>] | off [<receiver>] | run
  sessionpipe wait [--session <harness>:<id>]      (a session runs this in the background)`;

const MODE_TEXT = `  auto  Claude Code's auto mode: the session reads, edits and runs commands, and Claude Code's
        own safety check stops what looks dangerous. Pick this to get work done from your phone.
  safe  Only what each folder's Claude Code settings already allow: with no allow rules, a
        session can't even read a file. Pick this if this machine holds things no agent
        should touch unattended.`;

/** Ask the person at this machine, once: auto or safe. Not a terminal (an agent ran the
 *  pair command): safe, and say how to change it. */
async function askMode(out: (s?: string) => void): Promise<"safe" | "auto"> {
  if (!process.stdin.isTTY) {
    out("  Mode: safe for now. Run `sessionpipe control mode auto` to let sessions you message work unattended.");
    return "safe";
  }
  out("");
  out("  When you message a session on this machine from your phone, how may it run?");
  out(MODE_TEXT);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const a = (await rl.question("  auto or safe? [auto] ")).trim().toLowerCase();
      if (a === "" || a === "a" || a === "auto") return "auto";
      if (a === "s" || a === "safe") return "safe";
    }
  } finally {
    rl.close();
  }
}

export async function controlMain(argv: string[], out: (s?: string) => void, distDir: string): Promise<void> {
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flags = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1] as string] : []));
  const sub = argv[1];
  switch (sub) {
    case "pair": {
      // `spacesheep.dev` is enough: a bare host means https.
      const raw = argv[2];
      if (!raw || raw.startsWith("-")) return out(`usage:\n${CONTROL_HELP}`);
      const url = (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/$/, "");
      const cfg = readConfig();
      const sink = cfg.sinks.find((s) => s.url.replace(/\/$/, "") === url);
      // No token is fine where the receiver offers open pairing: the person approves the
      // link signed in, and that is the whole setup.
      const token = flag("--token") ?? sink?.token ?? null;
      if (token !== null && !/^[\x21-\x7e]+$/.test(token))
        return out(
          "  That token has a character a key never has (a placeholder like ss_… pasted as is?). Leave --token out to pair with a link instead.",
        );
      const folders = flags("--folder");
      const existing = readControl();
      if (!folders.length && !existing?.folders.length) folders.push(process.cwd());
      // How sessions run when a message arrives is the person's call, asked once here at
      // the machine — never a default they find out about when a session can't read a file.
      const mode: "safe" | "auto" =
        flag("--mode") === "auto" || flag("--mode") === "safe"
          ? (flag("--mode") as "safe" | "auto")
          : existing?.mode && existing.receivers.length
            ? existing.mode
            : await askMode(out);
      await pair({
        url,
        token,
        // The key the receiver handed over at pairing becomes this machine's sink for it,
        // state only (tier 0), unless one is configured already.
        addSink: (t) => {
          const now = readConfig();
          if (now.sinks.some((x) => x.url.replace(/\/$/, "") === url)) return;
          now.sinks.push({ name: new URL(url).host, url, tier: 0, pii: false, control: false, token: t });
          writeConfig(now);
          out(
            `  ✓ Sink ${new URL(url).host} added (tier 0: session state, no conversation text). \`sessionpipe sink add ${url} --tier 2\` sends transcripts too.`,
          );
        },
        folders,
        mode,
        name: flag("--name") ?? existing?.name ?? cfg.machine ?? os.hostname(),
        out,
      });
      const c = readControl()!;
      out(`  Folders sessions may run in: ${c.folders.join(", ")}`);
      out(
        `  Mode: ${c.mode} (${c.mode === "safe" ? "nothing that needs approval runs unattended" : "Claude Code's auto mode"})`,
      );
      let cli = path.join(distDir, "cli.js");
      try {
        cli = realpathSync(cli);
      } catch {}
      if (argv.includes("--no-service"))
        out("  Daemon: not installed as a service (--no-service); run `sessionpipe control run` yourself");
      else out(`  Daemon: ${installService({ node: process.execPath, cli })}`);
      return;
    }
    case "mode": {
      const want = argv[2];
      if (want !== "auto" && want !== "safe") {
        const c = readControl();
        return out(`  mode: ${c?.mode ?? "not set up"}\n  usage: sessionpipe control mode auto|safe\n${MODE_TEXT}`);
      }
      const c = readControl();
      if (!c) return out("  control isn't set up on this machine: run `sessionpipe control pair <receiver>` first");
      c.mode = want;
      writeControl(c);
      // The running daemon reads control.json again within seconds; the next run uses it.
      return out(
        `  ✓ Sessions you message now run in ${want} mode${want === "auto" ? " (Claude Code's auto mode decides what's safe)" : " (only what each folder's settings already allow)"}.`,
      );
    }
    case "keys": {
      const c = readControl();
      if (argv[2] === "remove" && argv[3]) {
        const n = removeKey(argv[3]);
        return out(n ? `  removed ${n} key(s)` : "  no such key");
      }
      if (!c?.receivers.length)
        return out("  control isn't paired on this machine (`sessionpipe control pair <receiver>`)");
      for (const r of c.receivers) {
        out(`  ${r.url} · machine ${r.machine}`);
        for (const k of r.keys)
          out(`    ${k.id.slice(0, 16)}…  ${k.alg === -7 ? "ES256" : "RS256"}  added ${k.added_at.slice(0, 10)}`);
      }
      return;
    }
    case "off": {
      const c = await off({ out, ...(argv[2] ? { url: argv[2] } : {}) });
      if (c && !c.receivers.length) uninstallService();
      return;
    }
    case "status": {
      const r = await ask(socketPath(stateDir()), { op: "status" }, 2000);
      if (r?.op !== "status") return out("  the control daemon isn't running");
      return out(JSON.stringify(r.status, null, 2));
    }
    case "run":
      return runDaemon(out);
    default:
      return out(CONTROL_HELP);
  }
}

async function runDaemon(out: (s?: string) => void): Promise<void> {
  const cfg = readControl();
  if (!cfg?.receivers.length) {
    out("control isn't paired on this machine; nothing to do (`sessionpipe control pair <receiver>`)");
    return;
  }
  const log = (s: string) => out(`${new Date().toISOString()} ${s}`);
  let claude: { bin: string; caps: ReturnType<typeof detectCaps>; sig: string } | null = null;
  const claudeNow = () => {
    const bin = findClaude();
    if (!bin) return null;
    const sig = `${bin}:${existsSync(bin) ? realpathSync(bin) : ""}`;
    if (claude?.sig !== sig) claude = { bin, caps: detectCaps(bin), sig };
    return claude;
  };
  const sdk = await loadSdk({ claudeBin: findClaude(), env: process.env, log });
  // The socket lives in the state root: only this user may reach it.
  privateDir(stateDir());
  const d = new ControlDaemon(cfg, controlState(), socketPath(stateDir()), {
    now: Date.now,
    fetch,
    log,
    claudeDirs: () => claudeDirs(),
    claude: claudeNow,
    run: runClaude,
    sdk,
  });
  await d.start();
  watchFile(controlFile(), { interval: 5000 }, () => {
    const next = readControl();
    if (next) d.reload(next);
  });
  const bye = async () => {
    await d.stop();
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

export async function waitMain(argv: string[], out: (s?: string) => void): Promise<void> {
  const i = argv.indexOf("--session");
  const session = waitSession(i >= 0 ? argv[i + 1] : undefined);
  if (!session) {
    out("sessionpipe wait: which session? Pass --session <harness>:<id> (Claude Code sets CLAUDE_CODE_SESSION_ID).");
    process.exitCode = 2;
    return;
  }
  out(await waitForMessage(session));
}
