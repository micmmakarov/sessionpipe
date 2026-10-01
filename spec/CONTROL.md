# Control: the channel back

> This document is part of the sessionpipe protocol and is licensed under [CC BY 4.0](LICENSE). The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. Status: **Draft** (see [VERSIONING.md](VERSIONING.md)); implemented in M6.

Events flow from the machine to the receiver. Control flows the other way: from a
page the person has open (on a phone, say) to a coding session on one of their
computers — a message for the agent, an answer to a permission prompt, a request to
stop, a new session. Everything here is delivered through each harness's
**documented** hook answers and input APIs; nothing is ever done to a process behind
the harness's back.

## 1. Who does what

| | Role | Holds |
|---|---|---|
| **Device** | Signs every command | A passkey, and a day key the passkey vouches for |
| **Receiver** | Carries commands, queues them per machine | A bearer token per machine; no key that can sign |
| **Machine daemon** | Verifies, then delivers | The keys enrolled at its own terminal |
| **Session** | Receives the message | — |

**A receiver decides whether to send. Only the machine decides whether to run.** A
receiver can queue a command, refuse one, or add checks of its own (a second look, a
rate limit); it can never forge one, because it never holds a key the machine trusts.
A bearer token authenticates the transport only. It never authorizes a command, and a
machine MUST NOT run anything on the strength of one.

One daemon runs per computer. It holds **one** long-poll to each receiver it is
paired with, whatever the number of sessions; each command names its session.

## 2. Keys and enrollment

A machine trusts **WebAuthn passkeys** (COSE `-7` ES256 P-256, or `-257` RS256 with a
modulus of at least 2048 bits) made for the receiver's rp id, which the receiver
declares in its well-known file (`control.signing.rp_id`, [HTTP.md §1](HTTP.md#1-discovery-get-well-knownsessionpipe)).

A key enters a machine's trust store **only from that machine's own terminal**:

1. The person runs `sessionpipe control pair <receiver>`. The daemon sends
   `POST {control}/pair` ([`control-pair.json`](https://sessionpipe.org/schema/v1/control-pair.json))
   with the sink token the person configured, and gets a machine id, a pairing
   `code`, a `url` and six `check` digits ([`control-pair-started.json`](https://sessionpipe.org/schema/v1/control-pair-started.json)).
2. The terminal prints the url and the digits. The person opens the url, sees the same
   digits on the receiver's page, and confirms with a passkey: an assertion over
   `sha256("sessionpipe.pair:" + machine + ":" + code)`.
3. The daemon polls `GET {control}/pair?code=…` until it answers `paired` with the key
   and that assertion ([`control-paired.json`](https://sessionpipe.org/schema/v1/control-paired.json)).
   The daemon MUST verify the assertion against the key it was handed before it trusts
   the key. A receiver that swaps in another key cannot produce the proof.
4. The first pairing of a machine also hands over the machine's own bearer `token`,
   which the daemon uses for polls, acks and hellos and nothing else. A leaked hook or
   sink token then cannot read the machine's queue or ack a command away.

The pairing request and every hello MAY carry the machine's allowed `folders` and its
`mode` (`safe`: nothing that needs approval runs unattended; `auto`: the harness's auto
mode), so a receiver can offer a folder picker for a new session. They are
informational: the machine checks its own list again (§5 step 6).

Keys are listed and removed one at a time on the machine (`sessionpipe control keys`,
`sessionpipe control keys remove <id>`); `sessionpipe control off` removes the machine,
its keys and its token, and tells the receiver (`POST {control}/off`). Adding another
passkey is the same pairing, with the machine id in the request. A receiver MUST NOT
be able to add, replace or remove a key on its own.

## 3. The signed command

### 3.1 The command string

The device writes the command as a JSON string, `cmd`, and signs those exact bytes
([`control-command.json`](https://sessionpipe.org/schema/v1/control-command.json)):

```json
{"v":1,"t":"sessionpipe.control","machine":"m_3Jq8…","kind":"prompt",
 "session":"claude-code:8c132906-8c3f-4814-870a-afc3d05e1d2e",
 "text":"Add the Oct 8 row","nonce":"pelZkFy2vRgrxlPqTKR6tA","iat":1790800000000}
```

| Field | Rule |
|-------|------|
| `v`, `t` | `1`, `"sessionpipe.control"`. |
| `machine` | The machine's id: `m_` then 16–40 base64url characters. |
| `kind` | `prompt` · `permission.answer` · `cancel` · `start` (§5). |
| `session` | `<harness>:<id>`. The id follows its adapter's rule ([ADAPTERS.md](ADAPTERS.md)); for `claude-code` it is a UUID. |
| `text` | `prompt`, `start`: the message for the model, 1 – **4 000** characters, not all whitespace. |
| `for`, `decision` | `permission.answer` only: the `attention_id` being answered, and `allow` or `deny`. |
| `note` | Optional, ≤ 2 000 characters: shown to the model beside a decision or a cancel. |
| `cwd` | `start` only: the absolute folder the new session runs in. |
| `nonce` | 22 – **64** base64url characters (at least 16 random bytes). |
| `iat` | Epoch milliseconds on the signing device's clock, an integer. |

A field that does not belong to the kind makes the command malformed. The whole
string is at most **12 000** characters.

### 3.2 Signatures

Either path is enough:

- **The day grant** (the usual one). Once a day the person confirms with their passkey,
  and the device makes a non-extractable P-256 **day key**. The passkey signs a
  **grant**: an assertion over `sha256(str)` where `str` is
  ([`control-grant.json`](https://sessionpipe.org/schema/v1/control-grant.json))
  `{"v":1,"t":"sessionpipe.grant","pub":"<day key SPKI, base64url>","iat":…,"exp":…,"rp":"<rp id>"}`,
  with `exp − iat` at most 24 hours. Each command then carries `csig`, the day key's
  ECDSA P-256 / SHA-256 signature over the exact `cmd` bytes (raw `r‖s`, 64 bytes,
  base64url), and the grant (`str` plus the assertion).
- **A confirm.** One passkey assertion over `sha256(cmd)` itself, for a command that
  should need a fresh fingerprint (a receiver's second look may ask for one).

Every assertion MUST be a `webauthn.get` for the rp id, from an https origin on the rp
id or a subdomain of it (plain http only when the rp id is `localhost`), not
cross-origin, with the user-present **and** user-verified flags set. ES256 signatures
are strict DER.

### 3.3 The receiver's envelope

A receiver carries each command in [`control.json`](https://sessionpipe.org/schema/v1/control.json):

```json
{ "id": "01K6ZT…", "cmd": "{\"v\":1,…}", "csig": "b64c…", "grant": { "str": "{…}", "cred": "…", "ad": "…", "cd": "…", "sig": "…" },
  "at": "2026-10-08T09:14:02.110Z", "expires_at": "2026-10-09T09:14:02.110Z" }
```

`id` (a ULID) is the receiver's and is the ack key; it is not signed, so a machine
deduplicates on the signed `nonce`, never on `id`. `expires_at` is at most 24 hours
after `at`. The receiver MUST pass `cmd` through byte for byte.

## 4. Where the limits come from

The two implementations this was lifted from (spacesheep's server and CLI) disagreed;
this spec fixes one value each: nonce 22–64 base64url characters (they had 16–64 and
22–128), text ≤ 4 000 characters and command ≤ 12 000 (they agreed on the text and
capped the command at 12 000 and 16 KiB), session id per adapter (one accepted any id,
the other only UUIDs).

## 5. What the machine checks, in order, before anything runs

1. It parses the **exact bytes** it received and never re-serializes them.
2. `machine` is this machine.
3. The signature: a grant whose assertion verifies against a key **enrolled on this
   machine**, with the command's `iat` inside the grant's window (from `iat − 5 min`
   to `exp`), and `csig` verifying against the grant's day key; or a confirm that
   verifies over `sha256(cmd)`.
4. The command was signed at most **24 hours** ago and at most 5 minutes in the
   future. The machine judges by signing time, so a message sent while the lid was
   shut still runs when the machine wakes; `expires_at` bounds it too.
5. The `nonce` is unseen for **25 hours**. The machine records it **before** it runs
   the command, and a failure to record it refuses the command.
6. The session's folder, read from the session's own transcript and never from the
   command, is on the machine's allowlist (for `start`, the `cwd`).
7. `permission.answer` with `allow` needs `for` to name an attention that is open
   **right now** on that session (§7).

A refusal is acked `refused` with a `code`: the verifier's (`malformed`,
`not_a_command`, `wrong_machine`, `unknown_kind`, `bad_session`, `bad_fields`,
`bad_nonce`, `too_old`, `future`, `unsigned`, `untrusted_key`, `bad_assertion`,
`bad_grant`, `outside_grant`, `bad_csig`, `replay`, `nonce_store`) or the machine's
(`folder`, `no_attention`, `no_session`, `start_limit`).

The reference verifier is `sessionpipe-core/control` (WebCrypto only; the same file
runs in a Worker, a browser and Node). A receiver SHOULD run it on arrival as an early
word — against the account's keys, with a 10-minute age window — so a bad command is
refused where the person can see why. That check is a courtesy; step 1–7 on the
machine are the gate.

## 6. Delivery

The daemon takes the **first mode that fits**, top to bottom, and acks which one it
used:

| Mode | When | Harnesses | While waiting |
|------|------|-----------|---------------|
| `sdk` | The daemon started the session itself (Agent SDK streaming input) and still holds it | Claude Code | 0 turns |
| `waiter` | The session runs `sessionpipe wait` in the background (§8) | Claude Code | 0 turns, no network |
| `turn` | The session is mid-turn: the message lands at its next Stop | Claude Code, Codex, Gemini CLI (AfterAgent), Cursor, Copilot CLI, Droid, Kiro | 0 turns |
| `api` | The harness has an input API | OpenCode, Codex app-server | 0 turns |
| `resume` | No live process holds the session | Claude Code (`claude -p --resume`) | cold start |
| `fork` | Live and idle, with no waiter | Claude Code (`--fork-session`) | cold start |

Nothing fits: acked `unsupported`. **Never two writers on one transcript**: a session a
live process holds is never resumed; it gets a fork, and later messages to it go to
the same fork.

### `prompt`

In the in-place modes the text reaches the session as a new message, framed so the
model and the person can tell where it came from:
`Message from <person> via <receiver> (sessionpipe control):` then the text. In `turn`
mode the daemon's Stop hook answers `{"decision":"block","reason":<framed text>}`, and
the harness continues the turn with it. A harness sets `stop_hook_active` on the Stop
that follows; the hook blocks again only for another queued message, so a delivered
message never loops. In `resume` and `fork` the ack carries the agent's `reply`
(redacted by the secrets ruleset).

### `permission.answer`

Delivered through the harness's permission hook answer (Claude Code `PermissionRequest`
→ `hookSpecificOutput.decision.behavior`; Codex `PermissionRequest`). The hook waits on
the daemon's socket for a signed answer for up to its window (default 120 s) **while
the terminal shows its own prompt**: whichever answers first wins. When the terminal
answers first, the harness does not tell the hook; the daemon learns it from the next
hook event of that session (a tool result, a Stop, a new prompt), closes the attention,
releases the waiting hook without an answer, and acks a later answer `expired`. Gemini
CLI's `Notification` of type `ToolPermission` has no answer channel: acked
`unsupported`. **Nothing is ever auto-allowed**: a daemon MUST NOT answer `allow` for an
attention it did not receive a verified `permission.answer` for.

### `cancel`

Stops the current turn where an API exists (the Agent SDK's interrupt in `sdk` mode;
OpenCode `/session/:id/abort`; Codex app-server interrupt); everywhere else acked
`unsupported`. **Never a signal to a pid.**

### `start`

A new Claude Code session with the command's session id, in `cwd`: through the Agent
SDK when the daemon has it, else `claude -p --session-id`. Acked `delivered` with mode
`sdk` or `resume`, and the reply.

A start is a whole agent run on the person's computer, so the machine caps them
itself, whatever a receiver sends: at most a few running at once and a few an hour
(the reference daemon: 2 and 10, set in its control config), refused `start_limit`
beyond that. A daemon SHOULD also cap the headless processes it runs at once and make
the rest wait their turn rather than fail. A receiver SHOULD rate-limit starts before
it queues them; that limit is its policy, the machine's is the gate.

## 7. Attention lifecycle

`attention.needed` (kind `permission`) → optional verified `permission.answer` →
`attention.cleared` with `how`: `answered` when a control answer or the terminal
resolved it, `timeout` when the hook's window closed, `cancelled` when the turn ended
without a decision, `unknown` when the sender cannot tell. An attention is **open**
from its `attention.needed` until its `attention.cleared` or the session's next hook
event, whichever comes first. A receiver SHOULD show the Allow / Deny pair only while
the attention is open.

## 8. The waiter (`sessionpipe wait`)

A session that should be reachable in place runs, as a **background** command,
`sessionpipe wait --session <harness>:<id>`. It connects to the daemon's local socket
(a Unix socket in the state directory, mode `0600`; a named pipe on Windows) and blocks
there — no network, no polling, no output. When a verified message for that session
arrives, the daemon writes it to the waiter, the waiter prints the framed text and
exits 0, and the harness wakes the session with the command's output. The session
then starts a new waiter. A daemon restart does not end a waiter: it reconnects in
silence. The local framing is the daemon's business and not part of this protocol.

A harness may stop a background command at a deadline of its own (Claude Code 2.1.286:
30 minutes by default, 2 hours at most unless `BASH_MAX_TIMEOUT_MS` is raised). Every
such stop wakes the session once, so the waiter SHOULD be started with the longest
timeout the harness allows.

## 9. Hook output

The hook path writes nothing a harness acts on (PROTOCOL.md, SECURITY.md), with one
exception: a control message the machine verified (§5). Then, and only then, a Stop
hook may print a block with the framed message, and a PermissionRequest hook may wait
on the daemon's socket and print the decision. Where control is not paired, neither
hook waits or prints.

## 10. Acks

`POST {control}/ack` with [`control-ack.json`](https://sessionpipe.org/schema/v1/control-ack.json):
`{"acks":[{"id","outcome","at","mode?","session?","code?","detail?","reply?"}]}`.

| Outcome | Meaning |
|---------|---------|
| `taken` | Not final. The machine verified the message and is delivering it; a final ack follows. Sent at once when delivery may take a while (a headless resume, a start). |
| `delivered` | The harness took it; `mode` says how, `session` names a fork or a started session. |
| `expired` | Past `expires_at`, or the hook's window closed, or the terminal answered first. |
| `unsupported` | No path for this kind on this harness. |
| `failed` | A path exists and errored; `detail` says what. |
| `refused` | Verification or the machine's policy said no; `code` says which (§5). |

Every message is acked exactly once with a final outcome, optionally preceded by
`taken`; a receiver MUST tolerate a duplicate ack for the same `id`. A receiver MUST
NOT redeliver a `taken` message for 35 minutes (the longest headless turn plus
slack); after that it MAY redeliver it, and a machine that already acked it finally
repeats that ack, while one that lost it answers `refused` with `replay`. A receiver SHOULD log each ack's mode and its
send → delivered time.

## 11. Fixtures

- `conformance/control-vectors/` — signed commands, valid and broken, with the verdict
  every verifier must reach (§5), and enrollment proofs (§2). The reference verifier
  and every receiver that pre-checks MUST agree with all of them.
- `conformance/delivery/09`–`14` — receiver scenarios: a prompt polled and acked
  `delivered`; a message that expires unpolled; a double ack; a permission answer acked
  with its mode; a cancel acked `unsupported`; a message redelivered on every poll
  until acked.

## 12. Status

A sender MUST NOT act on control until it runs a daemon that verifies (§5). A receiver
lists `control` in its capabilities only when it serves this whole document —
pairing, the per-machine poll and acks — and declares `control.signing`. The draft this
replaces (a per-session poll trusting the bearer token) was never implemented by any
sender or receiver.
