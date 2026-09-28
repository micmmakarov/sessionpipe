// SPDX-License-Identifier: Apache-2.0
// The hooks file shape Claude Code introduced and Codex, Droid and (with
// `version: 1`) Cursor and Copilot reuse: {"hooks":{"<Event>":[{"matcher"?,
// "hooks":[{"type":"command","command","timeout"}]}]}}. Ours is one entry per
// event; a re-install replaces a stale entry of ours (an old node path) and never
// touches anyone else's. Uninstall leaves the file byte-identical otherwise.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HookCommand, InstallReport } from "./types.js";

export interface ClaudeShapedOptions {
  /** Which events take a `matcher` (tool and permission events). */
  matcherFor: (event: string) => string | undefined;
  /** Seconds. */
  timeout: number;
  /** Extra top-level keys the file must carry (Cursor/Copilot: version: 1). */
  top?: Record<string, unknown>;
}

/** A command of ours: a path that contains "sessionpipe" and ends in hook.js, then a harness and an event. */
export const OURS = /sessionpipe[^"\n]*[\\/]hook\.js"?\s+[a-z][a-z-]*\s+[A-Za-z]+\s*$/;
export const isOurs = (h: { hooks?: { command?: string }[] }): boolean =>
  Array.isArray(h?.hooks) && h.hooks.some((x) => typeof x.command === "string" && OURS.test(x.command));

export function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function entryFor(event: string, harness: string, cmd: HookCommand, o: ClaudeShapedOptions) {
  const matcher = o.matcherFor(event);
  return {
    ...(matcher !== undefined ? { matcher } : {}),
    hooks: [{ type: "command", command: cmd([harness, event]).command, timeout: o.timeout }],
  };
}

export function installClaudeShaped(
  file: string,
  harness: string,
  events: readonly string[],
  cmd: HookCommand,
  o: ClaudeShapedOptions,
): InstallReport {
  const settings = readJson(file);
  const hooks = (settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}) as Record<
    string,
    unknown[]
  >;
  let changed = false;
  for (const ev of events) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const entry = entryFor(ev, harness, cmd, o);
    const mine = list.filter((h) => isOurs(h as never));
    if (mine.length === 1 && JSON.stringify(mine[0]) === JSON.stringify(entry)) continue;
    hooks[ev] = list.filter((h) => !isOurs(h as never)).concat([entry]);
    changed = true;
  }
  if (o.top)
    for (const [k, v] of Object.entries(o.top))
      if (settings[k] !== v) {
        settings[k] = v;
        changed = true;
      }
  if (changed) {
    settings.hooks = hooks;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return { file, changed };
}

export function uninstallClaudeShaped(file: string, events: readonly string[]): InstallReport {
  if (!existsSync(file)) return { file, changed: false };
  const raw = readFileSync(file, "utf8");
  const settings = readJson(file);
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks || typeof hooks !== "object") return { file, changed: false };
  let changed = false;
  for (const ev of events) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const kept = list.filter((h) => !isOurs(h as never));
    if (kept.length !== list.length) {
      changed = true;
      if (kept.length) hooks[ev] = kept;
      else delete hooks[ev];
    }
  }
  if (!changed) return { file, changed: false };
  if (!Object.keys(hooks).length) delete settings.hooks;
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  if (next !== raw) writeFileSync(file, next);
  return { file, changed: true };
}

export function installedClaudeShaped(
  file: string,
  harness: string,
  events: readonly string[],
  cmd: HookCommand,
  o: ClaudeShapedOptions,
): "current" | "stale" | "missing" {
  const hooks = (readJson(file).hooks ?? {}) as Record<string, unknown[]>;
  let present = 0;
  let current = 0;
  for (const ev of events) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const mine = list.filter((h) => isOurs(h as never));
    if (mine.length) present++;
    if (mine.length === 1 && JSON.stringify(mine[0]) === JSON.stringify(entryFor(ev, harness, cmd, o))) current++;
  }
  if (!present) return "missing";
  return current === events.length ? "current" : "stale";
}
