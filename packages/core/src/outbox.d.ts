import type { Event } from "./types.js";
export interface OutboxRef {
  harness: string;
  session: string;
}
export declare class Outbox {
  readonly root: string;
  constructor(root: string);
  dir(harness: string): string;
  file(ref: OutboxRef): string;
  private seqFile;
  /** The next seq for a session, persisted (survives a hibernating machine and a
   *  restart; an in-memory counter would restart at 0 and collide). */
  nextSeq(ref: OutboxRef): number;
  private lastSeqInFile;
  append(ref: OutboxRef, events: Event[]): void;
  /** Every session file, newest first. */
  sessions(): OutboxRef[];
  /** Read events after byte offset `from`; returns them and the new offset. Lines
   *  are read whole; a partial trailing line (a write in progress) is left. */
  read(
    ref: OutboxRef,
    from: number,
    maxEvents?: number,
  ): {
    events: Event[];
    offset: number;
  };
  /** Files older than `days` are pruned; the cursor files with them. */
  prune(days: number, now?: number): number;
  delete(ref: OutboxRef): void;
}
/** Per-sink cursor: byte offset per session file, moved only on a 2xx. */
export declare class Cursors {
  readonly root: string;
  readonly sink: string;
  constructor(root: string, sink: string);
  private file;
  read(): Record<string, number>;
  write(c: Record<string, number>): void;
  key(ref: OutboxRef): string;
}
/** A lock per session so two workers never interleave. Stale after 5 min. */
export declare function takeLock(root: string, ref: OutboxRef, staleMs?: number): (() => void) | null;
//# sourceMappingURL=outbox.d.ts.map
