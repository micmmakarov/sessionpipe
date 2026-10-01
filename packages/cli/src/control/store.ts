// SPDX-License-Identifier: Apache-2.0
// What the control daemon keeps on disk:
//   config/control.json   the receivers this machine is paired with: machine id,
//                         the machine's own token, the enrolled keys, folders, mode (0600)
//   state/control/nonces.jsonl  every verified nonce for 25 h, fsync'd before a
//                               command runs (a failed write refuses it)
//   state/control/acks.jsonl    acks not yet accepted by their receiver
//   state/control/state.json    forks: which copy a message to a session goes to
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { configFile, stateDir } from "@sessionpipe/core";
import { NONCE_TTL_MS, type TrustedKey } from "@sessionpipe/core/control";

export interface PairedReceiver {
  /** The receiver's origin, as the person typed it. */
  url: string;
  /** Absolute control endpoint (from the well-known file). */
  control: string;
  rpId: string;
  machine: string;
  /** The machine's own bearer (polls, acks, hello, off): opens nothing else. */
  token: string;
  keys: (TrustedKey & { name?: string; added_at: string })[];
  paired_at: string;
}

export interface ControlConfig {
  name: string;
  /** Folders sessions may run in; compared on whole path segments, real paths. */
  folders: string[];
  mode: "safe" | "auto";
  receivers: PairedReceiver[];
  /** Caps this machine keeps whatever a receiver sends (defaults in daemon.ts,
   *  LIMITS): new sessions running at once and per hour, headless Claude Code runs
   *  at once. */
  limits?: { start_concurrent?: number; start_per_hour?: number; headless?: number };
}

export const controlFile = (env: NodeJS.ProcessEnv = process.env) =>
  path.join(path.dirname(configFile(env)), "control.json");
export const controlState = (env: NodeJS.ProcessEnv = process.env) => path.join(stateDir(env), "control");

function writePrivate(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {}
}

export function readControl(env: NodeJS.ProcessEnv = process.env): ControlConfig | null {
  try {
    const j = JSON.parse(readFileSync(controlFile(env), "utf8")) as ControlConfig;
    if (!j || !Array.isArray(j.receivers)) return null;
    return {
      name: j.name || "machine",
      folders: j.folders ?? [],
      mode: j.mode === "auto" ? "auto" : "safe",
      receivers: j.receivers,
    };
  } catch {
    return null;
  }
}

export const writeControl = (c: ControlConfig, env: NodeJS.ProcessEnv = process.env) =>
  writePrivate(controlFile(env), c);

/** Nonces the machine has run, for NONCE_TTL_MS. `seen()` records a new nonce
 *  durably BEFORE it answers false; a write that fails throws, and the verifier
 *  refuses the command (`nonce_store`). */
export class NonceStore {
  private readonly seenAt = new Map<string, number>();
  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    let raw = "";
    try {
      raw = readFileSync(file, "utf8");
    } catch {}
    const cut = this.now() - NONCE_TTL_MS;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const { n, t } = JSON.parse(line) as { n: string; t: number };
        if (typeof n === "string" && t > cut) this.seenAt.set(n, t);
      } catch {}
    }
    this.compact();
  }

  seen = (nonce: string): boolean => {
    const t = this.seenAt.get(nonce);
    if (t !== undefined && t > this.now() - NONCE_TTL_MS) return true;
    const at = this.now();
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const fd = openSync(this.file, "a", 0o600);
    try {
      appendFileSync(fd, `${JSON.stringify({ n: nonce, t: at })}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.seenAt.set(nonce, at);
    return false;
  };

  /** Rewrite the file with only the live window (on start, and daily). */
  compact(): void {
    const cut = this.now() - NONCE_TTL_MS;
    for (const [n, t] of this.seenAt) if (t <= cut) this.seenAt.delete(n);
    if (!existsSync(this.file) && !this.seenAt.size) return;
    const body = [...this.seenAt].map(([n, t]) => JSON.stringify({ n, t })).join("\n");
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, body ? `${body}\n` : "", { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  get size(): number {
    return this.seenAt.size;
  }
}

export interface Ack {
  receiver: string;
  id: string;
  outcome: "taken" | "delivered" | "expired" | "unsupported" | "failed" | "refused";
  at: string;
  mode?: string;
  session?: string;
  code?: string;
  detail?: string;
  reply?: string;
}

/** Acks not yet accepted: appended before they are sent, rewritten when sent, so a
 *  daemon restart re-sends rather than forgets (every message is acked exactly once
 *  with a final outcome; a duplicate is tolerated by the receiver). */
export class AckOutbox {
  constructor(private readonly file: string) {}
  all(): Ack[] {
    try {
      return readFileSync(this.file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Ack);
    } catch {
      return [];
    }
  }
  add(a: Ack): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    appendFileSync(this.file, `${JSON.stringify(a)}\n`, { mode: 0o600 });
  }
  keep(left: Ack[]): void {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, left.map((a) => JSON.stringify(a)).join("\n") + (left.length ? "\n" : ""), {
      mode: 0o600,
    });
    renameSync(`${this.file}.tmp`, this.file);
  }
}

export interface DaemonState {
  /** Original session → the fork its messages go to. */
  copies: Record<string, string>;
}

export function readState(file: string): DaemonState {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as DaemonState;
    return { copies: j.copies && typeof j.copies === "object" ? j.copies : {} };
  } catch {
    return { copies: {} };
  }
}
export const writeState = (file: string, s: DaemonState) => writePrivate(file, s);
