// SPDX-License-Identifier: Apache-2.0
// Where sessionpipe keeps its files (spec: the client's Files section).
//   config  ~/.config/sessionpipe/config.json        SESSIONPIPE_CONFIG
//   state   ~/.local/state/sessionpipe/               SESSIONPIPE_STATE
//   Windows %APPDATA%\sessionpipe\ and %LOCALAPPDATA%\sessionpipe\
import { chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();

export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SESSIONPIPE_CONFIG) return path.resolve(env.SESSIONPIPE_CONFIG);
  if (process.platform === "win32")
    return path.join(env.APPDATA || path.join(HOME, "AppData", "Roaming"), "sessionpipe", "config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "sessionpipe", "config.json");
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SESSIONPIPE_STATE) return path.resolve(env.SESSIONPIPE_STATE);
  if (process.platform === "win32")
    return path.join(env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "sessionpipe");
  return path.join(env.XDG_STATE_HOME || path.join(HOME, ".local", "state"), "sessionpipe");
}

/** Make one of sessionpipe's own directories and keep it 0700. mkdir's mode only
 *  applies to a directory it creates, so a state root an older version (or a write
 *  that forgot the mode) left 0755 is tightened here, and with it everything inside. */
export function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
}

/** `~` for the home directory, as the session block writes paths. */
export function tilde(p: string, home: string = HOME): string {
  if (!p) return p;
  if (p === home) return "~";
  return p.startsWith(home + path.sep) || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

/** A file-name-safe id. */
export const safeId = (s: string): string =>
  String(s)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 160);
