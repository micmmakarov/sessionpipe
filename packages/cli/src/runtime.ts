// SPDX-License-Identifier: Apache-2.0
// Persistent paths shared by hook installation and control pairing.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION } from "./run.js";

/** Homebrew's versioned Cellar path dies on `brew upgrade node`; its stable links survive. */
export function stableNode(exe: string): string {
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

export function viaNpx(distDir: string): boolean {
  return /[\\/]_npx[\\/]/.test(distDir) || /[\\/]\.npm[\\/]/.test(distDir);
}

/** Install the running version persistently and hand off the original command before side effects. */
export function rerunGlobally(argv: string[], out: (s: string) => void): void {
  out(`  Installing sessionpipe@${VERSION} globally, so hooks and services use a persistent copy…`);
  let bin: string;
  try {
    // Homebrew's default prefix is the versioned Cellar folder that `brew upgrade
    // node` deletes, and its bin is not on PATH (issue #13): install into ~/.local
    // there, and run the copy from the prefix we installed into.
    let prefix = "";
    try {
      prefix = execFileSync("npm", ["prefix", "-g"], {
        encoding: "utf8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
    const target = /\/Cellar\/node(?:@\d+)?\/[^/]+/.test(prefix) ? path.join(os.homedir(), ".local") : prefix;
    execFileSync("npm", ["install", "-g", `sessionpipe@${VERSION}`, ...(target ? ["--prefix", target] : [])], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    bin =
      process.platform === "win32"
        ? path.join(target, "sessionpipe.cmd")
        : target
          ? path.join(target, "bin", "sessionpipe")
          : "sessionpipe";
    if (target && target !== prefix)
      out(`  Installed into ${target}; make sure ${path.join(target, "bin")} is on your PATH.`);
  } catch {
    out(
      "  ! couldn't install globally (`npm install -g sessionpipe` failed). Run it yourself, then retry this command.",
    );
    process.exit(1);
  }
  // The command's own failure (a pairing that expired) is its own to report, not an
  // install that failed: it has said why; pass its exit status on.
  try {
    execFileSync(bin, argv, { stdio: "inherit", shell: process.platform === "win32" });
  } catch (e) {
    process.exit(typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : 1);
  }
}
