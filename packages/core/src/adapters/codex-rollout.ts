// SPDX-License-Identifier: Apache-2.0

/** A fork starts with its own metadata, then replays the parent's history. Only
 *  an event naming the new thread establishes where its own records begin. */
export function codexReplayBoundary(meta: Record<string, unknown> | null | undefined) {
  if (meta?.type !== "session_meta") return undefined;
  const p = meta.payload as { id?: unknown; forked_from_id?: unknown; source?: { subagent?: unknown } } | undefined;
  if (!p || (!p.forked_from_id && !p.source?.subagent)) return undefined;
  return (record: Record<string, unknown> | null) =>
    typeof p.id === "string" &&
    !!p.id &&
    record?.type === "event_msg" &&
    (record.payload as { thread_id?: unknown } | undefined)?.thread_id === p.id;
}
