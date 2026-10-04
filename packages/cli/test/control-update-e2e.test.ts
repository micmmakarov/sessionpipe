// SPDX-License-Identifier: Apache-2.0
// The built daemon restarting onto a new copy, end to end and offline: a copy of
// dist/ laid out as a global npm install, `control run` in the foreground against an
// in-process receiver, and "a new version" written over the copy on disk the way npm
// would leave it. With no service manager the first daemon stays as the parent and runs
// the new one; that one restarts by exiting 75, and the parent starts the next.
import { type ChildProcess, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask } from "../src/control/local.js";
import { FakeReceiver } from "./helpers/receiver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const built = path.resolve(here, "../dist");
const version = (JSON.parse(readFileSync(path.resolve(here, "../package.json"), "utf8")) as { version: string })
  .version;
let rx: FakeReceiver;
let tmp: string;
let dist: string;
let sock: string;
let daemon: ChildProcess | null = null;
let log = "";
const pids = new Set<number>();

/** What npm leaves behind: the same files, another version baked in. */
function bakeVersion(v: string): void {
  const f = path.join(dist, "cli.js");
  const body = readFileSync(f, "utf8").replace(/(\? )"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?"( : "0\.0\.0")/g, `$1"${v}"$2`);
  writeFileSync(f, body);
}

async function statusIs(v: string, ms = 20_000): Promise<{ pid: number; version: string }> {
  const until = Date.now() + ms;
  for (;;) {
    const r = await ask(sock, { op: "status" }, 1000);
    const st = (r?.op === "status" ? r.status : null) as { pid: number; version: string } | null;
    if (st?.version === v) {
      pids.add(st.pid);
      return st;
    }
    if (Date.now() > until) throw new Error(`no daemon at ${v} (last: ${JSON.stringify(st)})\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  rx = new FakeReceiver();
  await rx.start();
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "sp-upd-")));
  const prefix = path.join(tmp, "prefix");
  dist = path.join(prefix, "lib", "node_modules", "sessionpipe", "dist");
  sock = path.join(tmp, "c.sock");
  if (!existsSync(path.join(built, "cli.js"))) return;
  cpSync(built, dist, { recursive: true });
  mkdirSync(path.join(prefix, "bin"), { recursive: true });
  symlinkSync(path.join(dist, "cli.js"), path.join(prefix, "bin", "sessionpipe"));
  const config = path.join(tmp, "config");
  mkdirSync(config, { recursive: true });
  // Off for the daily check (no test reaches npm); a restart asked for still happens.
  writeFileSync(path.join(config, "config.json"), JSON.stringify({ sinks: [], harnesses: {}, update_check: false }));
  writeFileSync(
    path.join(config, "control.json"),
    JSON.stringify({
      name: "updbox",
      folders: [tmp],
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
    }),
  );
});

afterAll(async () => {
  for (const pid of [...pids, daemon?.pid ?? 0])
    if (pid && alive(pid))
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
  await rx.stop();
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32" || !existsSync(path.join(built, "cli.js")))(
  "the daemon restarts onto a new copy (no service manager)",
  () => {
    it("stays as the parent, runs the new daemon, and the next one restarts by exiting 75", async () => {
      const env = {
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: tmp,
        SESSIONPIPE_CONFIG: path.join(tmp, "config", "config.json"),
        SESSIONPIPE_STATE: path.join(tmp, "state"),
        SESSIONPIPE_DATA: path.join(tmp, "data"),
        SESSIONPIPE_SOCKET: sock,
        SESSIONPIPE_SECRETS: "file",
        SESSIONPIPE_CLAUDE: path.join(tmp, "no-claude"),
      };
      const run = () =>
        spawn(process.execPath, [path.join(dist, "cli.js"), "control", "run"], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      daemon = run();
      daemon.stdout?.on("data", (b) => {
        log += b;
      });
      daemon.stderr?.on("data", (b) => {
        log += b;
      });
      const first = await statusIs(version);
      expect(first.pid).toBe(daemon.pid);

      // A second `control run` while this one serves: it says so and exits 0.
      const dup = run();
      let dupOut = "";
      dup.stdout?.on("data", (b) => {
        dupOut += b;
      });
      const dupCode = await new Promise<number | null>((resolve) => dup.on("exit", (c) => resolve(c)));
      expect(dupCode).toBe(0);
      expect(dupOut).toContain(`another control daemon already serves this machine (pid ${first.pid}`);
      expect((await statusIs(version)).pid).toBe(first.pid);

      bakeVersion("9.9.9");
      expect(await ask(sock, { op: "restart" }, 2000)).toEqual({ op: "ok" });
      const second = await statusIs("9.9.9");
      expect(second.pid).not.toBe(first.pid);
      expect(alive(first.pid)).toBe(true);
      expect(log).toContain("restart: ");
      expect(log).toContain("no service manager restarts this daemon");

      bakeVersion("9.9.10");
      expect(await ask(sock, { op: "restart" }, 2000)).toEqual({ op: "ok" });
      const third = await statusIs("9.9.10");
      expect(third.pid).not.toBe(second.pid);
      expect(alive(second.pid)).toBe(false);
      expect(log).toContain("exiting 75 so the supervising sessionpipe starts 9.9.10");
      expect(log).toContain("the daemon is restarting onto its new version");
      // The receiver heard from each version in turn.
      const said = rx.hellos.map((h) => (h as { version?: string }).version);
      expect(said).toEqual(expect.arrayContaining([version, "9.9.9", "9.9.10"]));

      // Stopping the parent stops the daemon it runs, and both exit 0.
      const code = await new Promise<number | null>((resolve) => {
        daemon?.on("exit", (c) => resolve(c));
        daemon?.kill("SIGTERM");
      });
      expect(code).toBe(0);
      for (let i = 0; i < 50 && alive(third.pid); i++) await new Promise((r) => setTimeout(r, 50));
      expect(alive(third.pid)).toBe(false);
      expect(await ask(sock, { op: "status" }, 500)).toBeNull();
      if (process.env.SP_DEBUG) console.error(log);
    }, 60_000);
  },
);
