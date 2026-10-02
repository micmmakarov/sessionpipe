// SPDX-License-Identifier: Apache-2.0
// Attachments on a `start` (spec/CONTROL.md §3.1, §6): the signed command names each
// file by its SHA-256; the bytes wait on the receiver. The daemon fetches each one
// with the machine's token, stops reading past the signed size, checks length and
// hash, and only then writes it — under <cwd>/.sessionpipe/files/<session>/, never
// through a symlink, never over an existing path, mode 0600. Any problem: nothing is
// kept and the session doesn't start.
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import type { ControlFile } from "@sessionpipe/core/control";

/** One file's download may take this long (25 MiB on a slow link). */
const FETCH_TIMEOUT_MS = 5 * 60_000;

export class FileProblem extends Error {}

export interface Fetched {
  file: ControlFile;
  /** The name as written: NFC. */
  name: string;
  bytes: Uint8Array;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Fetch every file, in order, and check each against the signed size and hash. */
export async function fetchFiles(
  files: ControlFile[],
  o: { control: string; token: string; fetch: typeof fetch },
): Promise<Fetched[]> {
  const out: Fetched[] = [];
  for (const file of files) out.push({ file, name: file.name.normalize("NFC"), bytes: await fetchOne(file, o) });
  return out;
}

async function fetchOne(
  f: ControlFile,
  o: { control: string; token: string; fetch: typeof fetch },
): Promise<Uint8Array> {
  const label = JSON.stringify(f.name);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await o.fetch(`${o.control.replace(/\/$/, "")}/files/${f.sha256}`, {
        headers: { authorization: `Bearer ${o.token}` },
        signal: ctl.signal,
      });
    } catch (e) {
      throw new FileProblem(`couldn't download ${label}: ${String((e as Error)?.message || e).slice(0, 120)}`);
    }
    if (res.status === 404) {
      void res.body?.cancel().catch(() => {});
      throw new FileProblem(`${label} isn't on the receiver (never uploaded, or expired)`);
    }
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => {});
      throw new FileProblem(`couldn't download ${label}: HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > f.size) {
      ctl.abort();
      throw new FileProblem(`${label} is larger than its signed size (${f.size} bytes)`);
    }
    if (!res.body) throw new FileProblem(`${label} came back empty`);
    const buf = new Uint8Array(f.size);
    let got = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > f.size) {
          // Past the signed size: stop reading, whatever the receiver keeps sending.
          ctl.abort();
          throw new FileProblem(`${label} is larger than its signed size (${f.size} bytes)`);
        }
        buf.set(value, got);
        got += value.length;
      }
    } catch (e) {
      if (e instanceof FileProblem) throw e;
      throw new FileProblem(`couldn't download ${label}: ${String((e as Error)?.message || e).slice(0, 120)}`);
    } finally {
      reader.releaseLock();
    }
    if (got !== f.size) throw new FileProblem(`${label} is ${got} bytes, not its signed ${f.size}`);
    const hash = b64url(createHash("sha256").update(buf).digest());
    if (hash !== f.sha256) throw new FileProblem(`${label} doesn't match its signed hash: it was changed`);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

/** A directory that must be real (not a symlink) — made when absent. */
function realDir(p: string, why: string): void {
  try {
    mkdirSync(p, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const st = lstatSync(p);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new FileProblem(`${why} is a symlink or not a folder`);
}

/**
 * Write the checked files to <cwd>/.sessionpipe/files/<session>/ and answer their
 * paths relative to cwd. `cwd` is already resolved (realpath) and allowed.
 * On any problem everything written here is removed and FileProblem thrown.
 */
export function writeFiles(cwd: string, session: string, files: Fetched[]): string[] {
  const top = path.join(cwd, ".sessionpipe");
  const parent = path.join(top, "files");
  const dir = path.join(parent, session);
  let made = false;
  try {
    realDir(top, ".sessionpipe");
    // The folder ignores itself, so a repository never picks it up.
    try {
      const fd = openSync(path.join(top, ".gitignore"), "wx", 0o600);
      writeSync(fd, "*\n");
      closeSync(fd);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    realDir(parent, ".sessionpipe/files");
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new FileProblem(`.sessionpipe/files/${session} already exists`);
      throw e;
    }
    made = true;
    // Every parent between cwd and here is a real directory right now.
    if (realpathSync.native(dir) !== dir) throw new FileProblem(".sessionpipe leads outside the session's folder");
    const rel: string[] = [];
    for (const f of files) {
      // wx: exclusive create, which also refuses to open through a symlink.
      const fd = openSync(path.join(dir, f.name), "wx", 0o600);
      try {
        let off = 0;
        while (off < f.bytes.length) off += writeSync(fd, f.bytes, off, f.bytes.length - off);
      } finally {
        closeSync(fd);
      }
      rel.push(`.sessionpipe/files/${session}/${f.name}`);
    }
    return rel;
  } catch (e) {
    if (made) rmSync(dir, { recursive: true, force: true });
    if (e instanceof FileProblem) throw e;
    throw new FileProblem(`couldn't save the files: ${String((e as Error)?.message || e).slice(0, 160)}`);
  }
}

/** 183402 → "179 KB", 1258291 → "1.2 MB" (units of 1024). */
export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** The command's text followed by the list of files the session can read. */
export function withFiles(text: string, files: Fetched[], rel: string[]): string {
  const lines = files.map((f, i) => `- ${rel[i]} (${f.file.type}, ${humanSize(f.file.size)})`);
  return `${text}\n\nAttached files (saved in this folder):\n${lines.join("\n")}`;
}
