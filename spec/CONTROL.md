# Control: the channel back

> This document is part of the sessionpipe protocol and is licensed under [CC BY 4.0](LICENSE). The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. Status: **Draft** (see [VERSIONING.md](VERSIONING.md)).

Events flow from the machine to the receiver. Control flows the other way: a
receiver's page (on a phone, say) answers a permission prompt, queues a message for
the agent's next turn, or asks it to stop. Everything here is delivered through each
harness's **documented** hook answers and input APIs; nothing is ever done to a
process behind the harness's back.

## 1. Transport

A sender with a live session and a sink that has `control: true` long-polls
`GET {control}?session=<harness>:<id>&wait=<s>` ([HTTP.md §3](HTTP.md#3-control)) and
acks each message with `POST {control}/ack`. A message is retried by the receiver on
every poll until acked or expired. Each message is
[`control.json`](https://sessionpipe.org/schema/v1/control.json):

```json
{ "id": "01K6…", "kind": "permission.answer", "for": "toolu_01…", "decision": "deny",
  "note": "Not on main, please.", "at": "2026-09-28T02:10:00.000Z", "expires_at": "2026-09-28T02:12:00.000Z" }
```

| Field | Rule |
|-------|------|
| `id` | ULID; the ack key. |
| `kind` | `permission.answer` · `prompt` · `cancel`. |
| `for` | `permission.answer` only: the `attention_id` of the `attention.needed` event being answered. |
| `decision` | `permission.answer` only: `allow` or `deny`. |
| `text` | `prompt` only: the message for the model, ≤ 20 000 chars. |
| `note` | Optional; shown to the model beside a decision. |
| `at`, `expires_at` | The receiver's clock. After `expires_at` the sender MUST NOT act and MUST ack `expired`. |

## 2. Kinds

### `permission.answer`

Answers a pending `attention.needed` of kind `permission`. The sender delivers it
through the harness's permission hook answer (Claude Code `PermissionRequest` →
`hookSpecificOutput.decision`; Codex `PermissionRequest`; Gemini CLI
`Notification` of type `ToolPermission` has no answer channel, so it is acked
`unsupported` there). An answer that arrives after the hook's own timeout is acked
`expired`: the harness has already asked in the terminal. **Nothing is ever
auto-allowed**: a sender MUST NOT answer `allow` to a prompt for which no
`permission.answer` with that `for` was received.

### `prompt`

Text delivered to the agent as a new user message at the **next turn boundary**.
The cross-harness mechanism is the Stop hook's block-with-reason: when the sender's
Stop hook runs and a `prompt` is queued for that session, it answers
`{"decision":"block","reason":<text>}` (Claude Code, Codex, Cursor `followup_message`,
Copilot CLI, Kiro, Droid), and the harness continues the turn with the text as the
next instruction. Where the harness has an input API the message goes immediately
instead (OpenCode `POST /session/:id/message`, Codex app-server). A prompt delivered
this way is acked `delivered` with the turn it landed in; one that expires before a
turn boundary is acked `expired`.

### `cancel`

Asks the harness to stop the current turn. Delivered only where an API exists
(OpenCode `/session/:id/abort`, Codex app-server interrupt); everywhere else acked
`unsupported`. **Never a signal to a pid.**

## 3. Acks

`{"acks":[{"id","outcome","at","detail?"}]}` with outcome `delivered` (the harness
took it), `expired` (past `expires_at`, or the hook's window closed first),
`unsupported` (this harness has no path for this kind), `failed` (a path exists and
errored; `detail` says what). Every message is acked exactly once with a final
outcome; a receiver MUST tolerate a duplicate ack for the same `id`.

## 4. Attention lifecycle

`attention.needed` (kind `permission`) → optional `permission.answer` →
`attention.cleared` with `how`: `answered` when a control answer or the terminal
resolved it, `timeout` when the hook's window closed, `cancelled` when the turn
ended without a decision, `unknown` when the sender cannot tell. A receiver SHOULD
show the Allow / Deny pair only while the attention is open and hide it on
`attention.cleared`.

## 5. Fixtures

`conformance/delivery/control-*.json` cover: a permission answered in time; one
answered after timeout (`expired`); a prompt delivered at a Stop; a prompt that
expires first; a cancel on a harness without an API (`unsupported`); the same message
delivered twice (one action, two acks tolerated).

## 6. Status

Control is specified in v1 and implemented in milestone M6. Until a sender
implements it, it MUST NOT add `control: true` to a sink, and a receiver that lists
`control` MUST accept polls that return 204 forever.
