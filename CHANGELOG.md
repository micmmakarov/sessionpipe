# Changelog

Per-package changelogs are written by Changesets into each `packages/*/CHANGELOG.md`
and released in lockstep. This file records protocol-level changes.

## Unreleased

- **Control (Draft) rewritten** — spec/CONTROL.md, HTTP.md §3. No sender or receiver
  implemented the old draft, so this replaces it rather than deprecating it:
  - Every command is **signed** on the person's device (a passkey-vouched day key,
    or one passkey assertion per command) and **verified on the machine** against
    keys enrolled at its own terminal. The old draft trusted a bearer token.
  - **One poll per machine** (`GET {control}?machine=<id>`, a machine-bound poll
    key); the command names its `session` inside the signed bytes.
  - **Six delivery modes** (`sdk`, `waiter`, `turn`, `api`, `resume`, `fork`); an ack
    names the mode. A new kind, `start`; a new outcome, `refused` with a code.
  - Schemas: `control.json` is now the signed command; new `control-envelope`,
    `control-grant`, `control-key`; `control-poll` carries envelopes; `control-ack`
    gains `mode`, `code`, `ms`; the well-known `control` object gains `signing`.
  - Limits fixed at one value: nonce 22–64 base64url, text 12 000 characters,
    command 16 KiB, session id per adapter.
  - `sessionpipe-core` exports the one verifier (`verifyCommand`), and
    `conformance/control-vectors/` holds 48 signed vectors every verifier must pass.
- Fixed contradictions: the CLI no longer keeps `control: true` on a sink; attention
  ids fall back to a ULID; a retried batch reuses its `webhook-id`; Gemini CLI is in
  the Stop-block list; SECURITY.md and PROTOCOL.md §6 name the signed-command exception
  to "the hook never alters the harness", and the hook budget names the
  PermissionRequest wait.

- Protocol v1 (Draft): envelope, event vocabulary, tiers 0–3, HTTP binding,
  discovery, control channel. See `spec/`.
