# HTTP binding

> This document is part of the sessionpipe protocol and is licensed under [CC BY 4.0](LICENSE). The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. Status: **Draft** (see [VERSIONING.md](VERSIONING.md)).

The protocol's events ([PROTOCOL.md](PROTOCOL.md)) travel to a receiver over HTTPS.
This document is the binding: discovery, the batch request, responses and errors,
retry, idempotency, the control long-poll and the native lane. The header names and
signature scheme are those of [Standard Webhooks](https://www.standardwebhooks.com/),
verbatim.

## 1. Discovery: `GET /.well-known/sessionpipe`

At the receiver's origin root. A sender reads it when a sink is added and re-reads
it at most daily (24 h cache); a receiver MAY set `Cache-Control`.

```json
{
  "protocol": [1],
  "max_tier": 2,
  "capabilities": ["events", "backfill", "forget", "control", "native"],
  "auth": ["bearer"],
  "endpoints": {
    "events":  "/api/sessionpipe/v1/events",
    "control": "/api/sessionpipe/v1/control",
    "native":  "/api/sessionpipe/v1/native"
  },
  "batch":   { "max_events": 50, "max_bytes": 262144 },
  "control": { "wait_max_s": 25 }
}
```

| Field | Rule |
|-------|------|
| `protocol` | The protocol integers the receiver accepts. |
| `max_tier` | The highest tier it will store. A sender MUST cap its sink's tier at this value. |
| `capabilities` | `events` is required. `backfill`: accepts `session.backfill`. `forget`: honours `session.forgotten`. `control`: serves the control endpoint. `native`: serves the native lane. Additions to the protocol are announced here ([VERSIONING.md](VERSIONING.md)). |
| `auth` | `bearer` only in v1. |
| `endpoints` | Paths relative to the origin, or absolute URLs. |
| `batch` | The largest request the receiver takes. A sender MUST NOT exceed either bound. Defaults when absent: 50 / 262 144. |
| `control` | `wait_max_s`: the longest long-poll it will hold. |

Schema: [`well-known.json`](https://sessionpipe.org/schema/v1/well-known.json).

## 2. Events: `POST {events}`

Body `{"events":[…]}` — 1 to `batch.max_events` events, at most `batch.max_bytes`
bytes ([`batch.json`](https://sessionpipe.org/schema/v1/batch.json)).

Request headers:

| Header | Rule |
|--------|------|
| `content-type` | `application/json` |
| `authorization` | `Bearer <token>` — the token the person configured for the sink. |
| `sessionpipe-protocol` | `1` — the batch's protocol integer, so a receiver can answer 400 without parsing. |
| `webhook-id` | OPTIONAL. A unique id for this delivery attempt's message (retries reuse it). |
| `webhook-timestamp` | OPTIONAL. Unix seconds. |
| `webhook-signature` | OPTIONAL. `v1,<base64>` — HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<body>` with the secret behind the `whsec_` prefix (base64-decoded). Several space-separated signatures MAY be present; one match is enough. A receiver that verifies MUST reject a timestamp more than 5 minutes off its clock. |

Response `202` with [`batch-response.json`](https://sessionpipe.org/schema/v1/batch-response.json):

```json
{ "accepted": 47, "duplicates": 3, "rejected": [{ "id": "01K6…", "reason": "tier_type" }], "max_tier": 2 }
```

`accepted + duplicates + rejected.length` MUST equal the number of events sent. A
rejected event is one the receiver will never store (its reason says why); the batch
as a whole still succeeded and the sender's cursor moves past it. `max_tier` repeats
the well-known value so a sender learns a lowered cap without a discovery round trip.

### Errors

| Status | Meaning | Sender behaviour |
|-------:|---------|------------------|
| 400 | Malformed body, or `{"reason":"unsupported_protocol","supported":[1]}` | Drop the whole batch; log it. |
| 401 | Bad or missing token | Pause the sink; `doctor` says so. Never retry in a loop. |
| 403 | `{"reason":"tier_above_max","max_tier":N}`: an event's `tier` exceeds the receiver's maximum | Lower the sink's tier to `max_tier`, re-filter, retry. |
| 413 | Batch too large | Halve the batch and retry; a single event over the limit is dropped and logged. |
| 429 | Too many requests, with `retry-after` | Wait as told, then retry. |
| 5xx, network error, timeout | Receiver unavailable | Retry with backoff 2 s · 10 s · 60 s · 5 min · 30 min, then every 30 min, forever. |

Bodies of 4xx/5xx responses SHOULD be [`error.json`](https://sessionpipe.org/schema/v1/error.json).
**The sender's cursor moves only on 202.**

### Idempotency

A receiver MUST deduplicate on `(harness.name, session.id, session.seq)` and count a
repeat in `duplicates`. Order of arrival is not guaranteed; `seq` is the order. A
receiver SHOULD keep at least the highest `seq` per session plus a window of recent
values, so a replay after an outage costs nothing.

### Time

A receiver MUST record its own arrival time beside `time`. The difference is the
delivery latency the project measures (target: p50 under 2 s on a laptop).

## 3. Control: `GET {control}?session=<harness>:<id>&wait=<s>`

Only when the well-known file lists `control`, the sink was added with `--control`,
and a session is live. Bearer auth. The receiver holds the request up to `wait`
seconds (≤ `wait_max_s`) and answers `200` with
[`control-poll.json`](https://sessionpipe.org/schema/v1/control-poll.json) when a
message is waiting, or `204` when none is. Messages are defined in
[CONTROL.md](CONTROL.md).

### `POST {control}/ack`

[`control-ack.json`](https://sessionpipe.org/schema/v1/control-ack.json):
`{"acks":[{"id","outcome":"delivered"|"expired"|"unsupported"|"failed","at","detail?"}]}`.
A receiver MUST keep re-delivering a message on every poll until it is acked or
its `expires_at` passes. `202` on success.

## 4. Native lane: `POST {native}/<harness>`

Raw hook JSON exactly as a harness's own HTTP hook handler sends it (Claude Code
`type: "http"`, Copilot CLI). The receiver normalises it with core's adapter, stores
it at the tier it declared for the lane (≤ 1), and records `privacy.rulesets: []` —
**no redaction ran at source**. This lane exists for a receiver you own on a machine
you own; a public receiver SHOULD NOT advertise `native`.

## 5. Forget

A `session.forgotten` event (any tier) asks the receiver to delete everything it
holds for that session: events, transcripts, derived data. A receiver that lists
`forget` MUST do so before answering 202 (or within a stated retention window,
documented on its `/.well-known` origin), and MUST answer later reads of the session
as though it never existed.

## 6. Transport requirements

- HTTPS on any host that is not `localhost` / `127.0.0.1` / `[::1]`.
- A sender's request timeout is 15 s; a worker that cannot reach a sink leaves the
  backlog for the next worker.
- A sender MUST send `session.*` and `turn.*` events of one session in `seq` order
  within a batch; across batches order is best effort.

## 7. Delivery scenarios (conformance)

The runner sends and expects, in this order; each is a fixture under
`conformance/delivery/`:

| Scenario | Send | Expect |
|----------|------|--------|
| accept | a valid tier-0 batch | 202, `accepted` = n |
| dedup | the same batch again | 202, `duplicates` = n |
| oversize | a batch over `max_events` or `max_bytes` | 413 |
| tier | an event with `tier` > `max_tier` | 403 with `max_tier` |
| protocol | `sessionpipe-protocol: 99` | 400 `unsupported_protocol` |
| auth | a wrong token | 401 |
| unknown-type | `type: "x.y"` | 202, stored, retrievable |
| forget | `session.forgotten`, then a read | 202, then nothing |
| control | a queued message, a poll, an ack | 200 with the message; 204 after the ack |
