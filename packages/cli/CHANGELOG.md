# sessionpipe

## 0.6.0

### Minor Changes

- f62bad9: The control daemon updates itself. About a minute after it starts and then once a day (the last check is kept in `state/control/update.json`, so restarts and sleeping machines don't ask more often), it reads npm's `latest`; when that is newer it waits until nothing is in hand (no delivery, headless run, start, SDK turn, open permission prompt, session mid-turn or ack flush), pauses intake, installs with `npm install --global --ignore-scripts` into the prefix it runs from, re-arms the hooks of the harnesses already set up, and restarts onto the new code: exit 75 under launchd or systemd (every service file ever written restarts on a non-zero exit; new ones also carry `SESSIONPIPE_SERVICE` and `RestartForceExitStatus=75`), and otherwise the old process stays as the new daemon's parent. Off with `sessionpipe update off` (`update_check: false`, now actually read), `SESSIONPIPE_NO_UPDATE_CHECK`, or when the copy isn't a writable global npm install. `status` and `doctor` show whether it's on, the last check and the latest version.
  
  One daemon per machine: `control run` no longer takes the socket from a daemon that answers on it (it says so and exits 0), steps aside if another daemon replaces its socket file, and never deletes another daemon's socket. `sessionpipe update` installs through the same path (npm run by the daemon's own node, the copy on disk checked, only the configured harnesses re-armed) and asks a running daemon to restart onto it once idle.

### Patch Changes

- e474c81: A started session's first message puts the person's words first and the "sent via" line after, so Claude Code names the session from what they asked instead of "Message via spacesheep.dev (sessionpipe control, s…".

## 0.5.0

### Minor Changes

- 6a5cda8: `sessionpipe connect <receiver>`: one command and one approval set a machine up — hooks for every agent and every Claude Code account, a sink at tier 2 with the key the receiver hands over at pairing, signed messages, keys in the keychain, a daemon that outlives logout, 30 days backfilled. It asks nothing (safe mode unless `--mode auto`; folders from `--folder`, the folder it ran in, or where recent sessions ran — never the home folder) and a second run only fixes what's missing.
  
  - Hooks run a launcher, `~/.local/share/sessionpipe/sessionpipe-hook`, with its own copy of the hook: a Node upgrade, `nvm uninstall` or a moved npm prefix no longer silently stops reporting. Re-installs move old entries to it in place.
  - Keys (sink tokens and secrets, machine tokens) live in the macOS Keychain or a desktop session's Secret Service when one is writable, else in the 0600 files as before; `sessionpipe secrets [move keychain|secret-service|file]`. A token a locked keychain won't hand over leaves events waiting (never unsigned); the daemon drains them from your session.
  - The Linux daemon turns on systemd linger, so closing ssh no longer stops it; on a Mac with nobody at the screen it runs as a background launchd agent instead of failing.
  - Before a headless run the daemon asks Claude Code whether that account is signed in (`claude auth status`) and fails the message with what to do — on a Mac, that a keychain login can't be read with nobody logged in at the screen — instead of Claude Code's "please run /login". `connect` and `doctor` list each account's state.
  - `sink add` keeps a sink's existing key when only the tier changes (it used to drop it); pairing fills in a sink that has no key and takes `--tier`; `control pair` run from the home folder no longer allows all of it; `control.json` keeps the machine's own caps across a write.

### Patch Changes

- 10d19eb: Run control pairing from the global install when invoked through npx, and use a stable Homebrew Node path for the daemon service. Existing service files are repaired by pairing again with the fixed CLI; install and update alone do not rewrite them.

## 0.4.2

### Patch Changes

- 4b39a06: A message for a session the daemon's own run is still working on (a start, a resume) waits for that run and resumes the session, instead of forking a copy that would work the same task in parallel.

## 0.4.1

### Patch Changes

- 98374b0: `control pair` says the approval happens on any device where you're signed in to the receiver, not necessarily the machine being paired (which may have no screen), and that several machines are paired one by one, each with its own digits.

## 0.4.0

### Minor Changes

- b5cf64b: `key.add`: a device the machine already trusts vouches for a new one (a phone with a different keychain), signed and verified like any command; the daemon adds the key to its store. Five new conformance vectors.
- 37546aa: `sessionpipe control pair` asks once, at the machine, whether sessions you message run in auto or safe mode (no more silent safe default), and `sessionpipe control mode auto|safe` changes it; the running daemon picks it up within seconds. Message text may be 20 000 characters (command 48 000): a 4 000 cap silently cut real task briefs.
- 765b95a: A receiver's well-known `control.session_tools` names MCP servers its sessions may use without asking (spacesheep names its own), so a safe-mode run answering a message can publish the page it was asked for. MCP server names only; built-in tools stay behind the person's approval rules.
- 2cd4475: Answers stream: a non-final `progress` ack carries the answer so far (whole, with a rising `seq`). The daemon streams headless runs from Claude Code's `stream-json` output (token by token) and in-place deliveries from the session's transcript (message by message); the final ack still carries the whole answer.

## 0.3.0

### Minor Changes

- 79fc0a4: Open pairing: `sessionpipe control pair spacesheep.dev` needs no key where the receiver declares `control.open_pairing`. One link, one passkey approval; the daemon proves itself on the status poll with a `poll_key` only it holds, prints which account approved, and adds the sessions key the receiver hands over as its events sink (tier 0). A bare host means https, and a `--token` with a character no key has (a pasted `ss_…` placeholder) is refused in words.

## 0.2.0

### Minor Changes

- 54820be: The control daemon (M6): `sessionpipe control pair | status | keys | off | run` and `sessionpipe wait`. One daemon per computer verifies every command against keys enrolled at its terminal and delivers it in place when it can (a parked waiter, the session's next Stop, an Agent SDK session it started), else as a headless resume or fork; Stop and PermissionRequest hooks answer only for verified messages, and only where control is paired. Claude Code's PermissionRequest hook timeout is now 130 s (re-run `sessionpipe install`). A machine caps new sessions itself (2 at once, 10 an hour, `limits` in control.json) and runs at most 3 headless Claude Code processes at once; messages are handled concurrently, one session's in order; after a receiver outage the daemon is polling again within seconds and logs `back after N s`.

### Patch Changes

- 87d9a65: Control (M6): `sessionpipe-core/control`, the one verifier for signed control commands (WebCrypto only, safe in Workers and browsers), with 60 shared conformance vectors; the control schemas rewritten for signed, per-machine delivery. The CLI ignores `sink add --control` (control is per machine) and a retried batch reuses its `webhook-id`.

## 0.1.1

### Patch Changes

- 8ae0d49: The sink drain packs events from many sessions into one batch of up to 50 (a first install's backfill is a handful of POSTs, not one per session); cursors move only after the batch was acknowledged.
- be95792: `sink test` sends a heartbeat and then its `session.forgotten`, so a receiver keeps no phantom session from the test.
- b8b8599: Fixes from the first outside install (Yaroslav Bulatov, issues #8–#14 and advisory GHSA-8f6f-c3c9-j5p6): a config file that is not plain JSON is never written back; installs keep a file's indent and final newline and uninstall deletes files sessionpipe created; jobs that lose the session-lock race are retried and swept, never lost; Claude Code `StopFailure` → `turn.ended` with `reason: error`; `status`/`doctor` say when Gemini CLI won't run hooks (`tools.enableHooks`) and word the Codex review honestly; `doctor` measures the wall clock a harness waits; with no sink above tier 0 only one tool event per harness is hooked; the npx bootstrap installs into `~/.local` when npm's prefix is Homebrew's versioned Cellar; a bare `pass:` is no longer a secret name; the outbox holds redacted strings at rest in 0600 files under 0700 directories.

## 0.1.0

### Minor Changes

- c75aaa0: Core: adapters for Claude Code, Codex, Gemini CLI and Antigravity; the secrets@1 and pii@1 rulesets and the tier filter; outbox, cursors, locks; file, stdout and HTTP sinks. CLI: install, uninstall, sink, status, doctor, tail, backfill, forget, replay, update; the hook entry imports only node: builtins. Conformance: adapter fixture runner.

### Patch Changes

- Updated dependencies [e918475]
- Updated dependencies [c75aaa0]
  - @sessionpipe/core@0.1.0
