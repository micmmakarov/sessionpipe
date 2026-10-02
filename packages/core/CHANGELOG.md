# @sessionpipe/core

## 0.4.2

No changes in this release.

## 0.4.1

No changes in this release.

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
- 87d9a65: Control (M6): `sessionpipe-core/control`, the one verifier for signed control commands (WebCrypto only, safe in Workers and browsers), with 60 shared conformance vectors; the control schemas rewritten for signed, per-machine delivery. The CLI ignores `sink add --control` (control is per machine) and a retried batch reuses its `webhook-id`.

## 0.1.1

### Patch Changes

- 08b5d89: READMEs carry the published (unscoped) package names.
- a360ee8: Published under unscoped names (sessionpipe-core, sessionpipe-receiver, sessionpipe-conformance) until the @sessionpipe npm org exists.
- b8b8599: Fixes from the first outside install (Yaroslav Bulatov, issues #8–#14 and advisory GHSA-8f6f-c3c9-j5p6): a config file that is not plain JSON is never written back; installs keep a file's indent and final newline and uninstall deletes files sessionpipe created; jobs that lose the session-lock race are retried and swept, never lost; Claude Code `StopFailure` → `turn.ended` with `reason: error`; `status`/`doctor` say when Gemini CLI won't run hooks (`tools.enableHooks`) and word the Codex review honestly; `doctor` measures the wall clock a harness waits; with no sink above tier 0 only one tool event per harness is hooked; the npx bootstrap installs into `~/.local` when npm's prefix is Homebrew's versioned Cellar; a bare `pass:` is no longer a secret name; the outbox holds redacted strings at rest in 0600 files under 0700 directories.

## 0.1.0

### Minor Changes

- e918475: Protocol v1 draft: the Zod source of truth (`packages/core/schema/v1.ts`) and the generated `schemas/v1/*.json`; inferred runtime types.
- c75aaa0: Core: adapters for Claude Code, Codex, Gemini CLI and Antigravity; the secrets@1 and pii@1 rulesets and the tier filter; outbox, cursors, locks; file, stdout and HTTP sinks. CLI: install, uninstall, sink, status, doctor, tail, backfill, forget, replay, update; the hook entry imports only node: builtins. Conformance: adapter fixture runner.
