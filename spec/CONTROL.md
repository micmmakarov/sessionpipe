# Control: the channel back

> This document is part of the sessionpipe protocol and is licensed under [CC BY 4.0](LICENSE). The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. Status: **Draft** (see [VERSIONING.md](VERSIONING.md)).

Events flow from the machine to the receiver. Control flows the other way: a person
on a receiver's page (on a phone, say) sends a message to one of their sessions,
answers a permission prompt, stops a turn, or starts a new session on their computer.

The rule the whole channel is built on:

> **A receiver decides whether to send. Only the machine decides whether to run.**

A receiver can queue a command but can never forge one. Every command is signed on
the person's own device with a key that was enrolled at the machine's own terminal,
and the machine verifies it before anything reaches a session. Holding a receiver's
database, a sink token or the receiver itself is not enough to make a machine do
anything. Everything is delivered through each harness's **documented** hook answers,
input APIs and resume commands; nothing is ever done to a process behind the harness's
back.

## 1. Roles

| Role | What it does |
|------|--------------|
| **Signer** | The person's device (a browser page). Holds a day key it can't export, and the passkey that vouches for it. Signs each command. |
| **Receiver** | Queues commands per machine, pre-checks them (§3.2), carries them, records acks. MAY add its own policy on top (a second look, rate limits, who may message which machine). |
| **Machine daemon** | One process per computer (the sender's control half). Polls the receiver, verifies every command (§3.3), picks a delivery mode (§5), delivers, acks. |
| **Session** | One harness conversation on that computer. Receives the message by the cheapest mode its harness allows. |

## 2. Transport

**One poll per machine**, not per session: the daemon long-polls
`GET {control}?machine=<id>&wait=<s>` ([HTTP.md §3](HTTP.md#3-control)) with a key
bound to that machine (§4.3) and acks each command with `POST {control}/ack`. A
command names its session inside the signed bytes, so the daemon routes it.

A poll answers [`control-poll.json`](https://sessionpipe.org/schema/v1/control-poll.json):
up to 20 **envelopes** ([`control-envelope.json`](https://sessionpipe.org/schema/v1/control-envelope.json)).

```json
{ "id": "01K6…", "at": "2026-09-30T21:10:00.000Z", "expires_at": "2026-10-01T21:10:00.000Z",
  "cmd": "{\"v\":1,\"t\":\"sessionpipe.control\",\"machine\":\"m_…\",\"kind\":\"prompt\",\"session\":\"claude-code:bedc5a64-…\",\"text\":\"Add the Oct 8 row\",\"nonce\":\"…\",\"iat\":1790800000000}",
  "csig": "<ECDSA P-256 over the exact cmd bytes, raw r||s, base64url>",
  "grant": { "str": "{\"v\":1,\"t\":\"sessionpipe.grant\",…}", "cred": "…", "ad": "…", "cd": "…", "sig": "…" } }
```

Instead of `csig` + `grant`, an envelope MAY carry `confirm`: one passkey assertion
over `sha256(cmd)`, for a person who taps Touch ID per command. A receiver keeps
re-delivering an envelope on every poll until it is acked or its `expires_at` passes.
`expires_at` is the receiver's; it SHOULD be at most 24 hours after the command's
`iat`, since the machine refuses anything older (§3.3 check 5).

## 3. The signed command

### 3.1 Fields

`cmd` is a JSON string. It parses to
[`control.json`](https://sessionpipe.org/schema/v1/control.json):

| Field | Rule |
|-------|------|
| `v`, `t` | `1`, `"sessionpipe.control"`. |
| `machine` | The machine id (`m_` + 16–40 base64url) the command is for. |
| `kind` | `prompt` · `permission.answer` · `cancel` · `start` (§6). |
| `session` | `<harness>:<id>`. The id follows the adapter's shape ([ADAPTERS.md](ADAPTERS.md)): a UUID for `claude-code` and `codex`, `[A-Za-z0-9._-]{1,128}` for any other harness. For `start`, a fresh id the daemon creates the session under. |
| `text` | `prompt`, `start`: the person's words, ≤ 12 000 characters, not blank. |
| `for`, `decision` | `permission.answer` only: the `attention_id` answered (≤ 128 of `[A-Za-z0-9._:-]`) and `allow` or `deny`. |
| `note` | Optional, ≤ 2 000 characters; shown to the model beside a decision. |
| `cwd` | `start` only: the absolute folder the new session starts in. Any other kind MUST NOT carry it: the daemon finds a live session's folder itself (check 7). |
| `nonce` | 22–64 base64url characters (≥ 16 random bytes). |
| `iat` | Signing time, epoch milliseconds, on the signer's clock. |

The whole string is at most 16 KiB of UTF-8. `prompt` and `start` carry no `for`;
`permission.answer` carries no `text` or `cwd`; `cancel` carries only its session.

### 3.2 What a receiver checks before it queues

A receiver runs checks 1–5 below with a 10-minute age limit (`iat` within 10 minutes
of its clock) and also refuses an unlock that has already run out, so a person sees
a refusal on the page instead of a command dying quietly on the machine. Passing
here proves nothing to the machine; it only saves a round trip.

### 3.3 What the machine checks, in order, before anything runs

1. **Parses the exact bytes it received** and never re-serializes them. Every
   signature covers `cmd` and `grant.str` as transmitted.
2. `machine` is this machine.
3. Either the **grant** is valid — `grant.str` parses to
   [`control-grant.json`](https://sessionpipe.org/schema/v1/control-grant.json)
   (`v` 1, `t` `"sessionpipe.grant"`, the day key's SPKI as `pub`, `iat`, `exp` at
   most 24 h + 5 min after `iat`, `rp`), its assertion is a WebAuthn assertion over
   `sha256(grant.str)` by a passkey **enrolled on this machine** whose `rp` equals the
   grant's, and the command's `iat` lies in `[grant.iat − 5 min, grant.exp]` — or the
   **confirm** is such an assertion over `sha256(cmd)`. When both are present the
   confirm is checked and decides.
4. With a grant, `csig` verifies: ECDSA P-256 / SHA-256 over the `cmd` bytes, raw
   `r||s`, against the grant's `pub`.
5. `iat` is at most 5 minutes in the future and at most **24 hours** in the past. A
   command is judged by when it was signed, not when it arrives: one sent while the
   lid was shut still runs when the machine wakes. An unlock that has ended since is
   no reason to refuse (check 3 asks whether it covered the signing).
6. **The nonce is unseen** in the last 25 hours. It is written before the command
   runs, and a failed write refuses the command. Only a command that passed 1–5
   touches the nonce memory, so a forgery can't burn a real command's nonce.
7. The session's folder — read from the harness's own records for that session,
   **never from the command** — is inside a folder on the machine's allowlist, by
   whole path segments. For `start`, `cwd` is checked the same way.
8. `permission.answer` with `allow` needs `for` to name an attention that is **open
   right now** on that session (§6.2).

A command that fails any check is acked `refused` with the check's code and does
nothing. The codes for checks 1–5 are `malformed`, `machine`, `future`, `stale`,
`unsigned`, `untrusted`, `assertion`, `grant`, `window` and `csig`; checks 6–8 are
`replay`, `folder` and `attention`.

### 3.4 WebAuthn rules

An assertion (`cred`, `ad`, `cd`, `sig`, base64url) verifies when: `cred` is the
enrolled key's id; `cd` parses with `type` `"webauthn.get"`, `challenge` equal to
the base64url of the expected hash, an `origin` that is `https://` on the key's `rp`
or a subdomain of it (plain `http://` only when the `rp` is `localhost`), and
`crossOrigin` not `true`; `ad` starts with `sha256(rp)` and has both the
user-present (0x01) and user-verified (0x04) flags; and `sig` verifies over
`ad || sha256(cd)` — DER ECDSA for ES256 (COSE −7), PKCS#1 v1.5 for RS256 (COSE −257,
≥ 2048 bits).

### 3.5 One verifier and shared vectors

`sessionpipe-core` exports `verifyCommand` (checks 1–5, WebCrypto only, so the same
code runs in a Worker, Node and a browser). `conformance/control-vectors/` holds
valid and broken commands, each with the verdict and code a conforming verifier
reaches; both the reference client and every receiver SHOULD run them in CI. A
second implementation in another language MUST pass them.

## 4. Keys

### 4.1 Enrollment happens at the machine

A passkey is trusted by a machine only after the person enrolled it **at that
machine's own terminal**: `sessionpipe control pair <receiver>` asks the receiver
for a pairing code, prints a link and six check digits, and the person opens the
link, sees the same digits, and taps their passkey. The receiver hands the machine
the new key ([`control-key.json`](https://sessionpipe.org/schema/v1/control-key.json):
`id`, `alg`, `spki`, `rp`) and the tap's assertion over
`sha256("sessionpipe.pair:" + machine + ":" + code)`. The machine verifies that
proof itself (§3.4) before it writes the key to its trust store. The check digits are
the first four bytes of `sha256("sessionpipe.pair-check:" + code)`, big-endian, mod
10⁶, zero-padded to six.

A receiver MUST NOT offer a way to add a key to a machine from the web: a key that
did not come through the machine's own terminal is not a key.

### 4.2 Keys are listed and removed one at a time

`sessionpipe control keys` lists the machine's keys (name, receiver, when added,
last used); `sessionpipe control keys remove <id>` drops one; `sessionpipe control
off` drops them all and stops the daemon's polls. Removing a key takes effect at
the next command: nothing it signed runs after that.

### 4.3 The poll key

The daemon polls with a credential **bound to one machine**, minted at pairing. It
can read and ack that machine's queue and nothing else. It never signs anything, so
leaking it lets someone read queued commands and ack them away, never run one. A
receiver MUST NOT accept a general account key for a machine's poll.

### 4.4 What a receiver declares

A receiver that lists `control` in its well-known file declares how its people sign:

```json
"control": { "wait_max_s": 50, "signing": { "rp": "spacesheep.dev", "algs": [-7, -257] } }
```

## 5. Delivery modes

The daemon takes the **first mode that fits**, top to bottom, and names it in the
ack. Four of the six reach the running session in place.

| Mode | When | Harnesses (reference client) | While waiting |
|------|------|------------------------------|---------------|
| `sdk` | The daemon started the session itself and holds its streaming input. | Claude Code (Agent SDK) | no model turns |
| `waiter` | The session runs `sessionpipe wait` as a background command, parked on the daemon's local socket. | Claude Code | no model turns, no network |
| `turn` | The session is mid-turn and has no waiter: the message is handed to its next Stop hook as a block-with-reason. | Claude Code, Codex, Gemini CLI (AfterAgent), Cursor, Copilot CLI, Droid, Kiro | no model turns |
| `api` | The harness has an input API. | OpenCode (`POST /session/:id/message`), Codex app-server | — |
| `resume` | No live process holds the session: it is resumed headless with the message. | Claude Code (`claude -p --resume`) | cold start |
| `fork` | Live and idle, with no waiter: a copy of the session answers, so the live transcript never has two writers. | Claude Code (`--fork-session`) | cold start |

Nothing fits → acked `unsupported`. Two rules hold for every mode:

- **Never two writers on one transcript.** A mode that starts a process on a session
  MUST first know that no other live process holds it.
- **The waiter wakes the model only when there is something to say.** It exits when
  a message arrives (printing it) or shortly before its harness's own limit on a
  background command, asking to be run again; a daemon restart is a reconnect, never
  an exit. On Claude Code the limit is 2 hours, so a listening session costs at most
  one idle wake per ~2 hours.
- **A re-arm never waits on a prompt.** The waiter is one stable command,
  `sessionpipe wait <harness>:<id>`, and the installer adds it to the harness's
  allow rules (Claude Code: `Bash(sessionpipe wait:*)`); a re-arm that stops on a
  permission prompt while the person is away is a listener that silently stopped.

The local socket is `$XDG_RUNTIME_DIR/sessionpipe/control.sock`, else
`~/.sessionpipe/control.sock` (a Unix socket path is limited to ~104 bytes); on
Windows a named pipe `\\.\pipe\sessionpipe-control-<user>`. It is owner-only (0600
in an 0700 directory), and a waiter says which session it is for; the daemon hands
it only commands that passed §3.3 for that session.

## 6. Kinds

### 6.1 `prompt`

Text delivered to the session as a message from its owner. In `waiter` and `turn`
modes the harness shows it as tool output or hook feedback rather than a user turn,
so the daemon frames it: *"A message from the person who owns this session, sent
from <receiver>:"* followed by the text. Acked `delivered` with its mode once the
harness has it.

### 6.2 `permission.answer`

Answers an open `attention.needed` of kind `permission`. The daemon's
`PermissionRequest` hook (Claude Code; Codex `PermissionRequest`) holds the request
open on the local socket for up to 120 seconds while the terminal's own prompt is
shown: the first answer wins. A signed answer is written as the hook's
`hookSpecificOutput.decision`; an answer in the terminal ends the hook, and the daemon
emits `attention.cleared` with `how: "answered"`. An answer that arrives after the
hook's window closed is acked `expired`. Gemini CLI's `Notification` of type
`ToolPermission` has no answer channel: acked `unsupported`.

**Nothing is ever auto-allowed.** A sender MUST NOT answer `allow` to a prompt for
which no signed `permission.answer` with that `for` passed §3.3.

### 6.3 `cancel`

Asks the harness to stop the current turn. Delivered only where an API exists
(OpenCode `/session/:id/abort`, Codex app-server interrupt, a session the daemon
holds through the SDK); everywhere else acked `unsupported`. **Never a signal to a
pid.**

### 6.4 `start`

Starts a new session in `cwd` under the command's session id (Claude Code:
`--session-id`), with `text` as its first message. `cwd` passes check 7 first.
Acked with mode `sdk` or `resume` (headless).

## 7. Acks

[`control-ack.json`](https://sessionpipe.org/schema/v1/control-ack.json):
`{"acks":[{"id","outcome","mode?","code?","ms?","at","detail?"}]}` with outcome

| Outcome | Meaning |
|---------|---------|
| `delivered` | The harness took it; `mode` says how, `ms` is receive → delivered on the machine's clock. |
| `expired` | Past `expires_at`, or the hook's window closed first. |
| `unsupported` | This harness has no path for this kind in any mode. |
| `refused` | A §3.3 check failed; `code` names it. |
| `failed` | A path exists and errored; `detail` says what. |

Every envelope is acked exactly once with a final outcome; a receiver MUST tolerate
a duplicate ack for the same `id`.

## 8. Attention lifecycle

`attention.needed` (kind `permission`) → optional `permission.answer` →
`attention.cleared` with `how`: `answered` when a control answer or the terminal
resolved it, `timeout` when the hook's window closed, `cancelled` when the turn
ended without a decision, `unknown` when the sender cannot tell. A receiver SHOULD
show the Allow / Deny pair only while the attention is open and hide it on
`attention.cleared`. The `attention_id` is the harness's id when it gives one, else a
value derived from the request so that the same prompt yields the same id (Claude
Code: a hash of the turn, tool and input), else a ULID.

## 9. Fixtures

- `conformance/control-vectors/*.json` — signed commands and their verdicts (§3.5).
- `conformance/delivery/09-control.json` — a signed command queued, polled by its
  machine, acked `delivered`, then 204.
- `conformance/delivery/10-control-expired.json` — a command past `expires_at` is
  acked `expired` and never re-delivered.
- `conformance/delivery/11-control-double-ack.json` — the same ack twice: 202 both
  times, one outcome recorded.
- `conformance/delivery/12-control-refused.json` — a receiver refuses to queue an
  unsigned command (400 `unsigned`).

## 10. Status

Control is specified in v1 and implemented in milestone M6. Until a sender
implements it, it MUST NOT add `control: true` to a sink; a receiver that lists
`control` MUST accept polls that return 204 forever.
