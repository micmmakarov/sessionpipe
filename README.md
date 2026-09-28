# sessionpipe

**An open protocol, and a client, for what your coding agents are doing.** One
install hooks Claude Code, Codex, Gemini CLI, Antigravity and more; every event is
filtered to a privacy tier you choose per destination, secrets are removed on your
machine before anything leaves it, and it goes to your server, to a file, or nowhere
at all.

[![CI](https://github.com/micmmakarov/sessionpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/micmmakarov/sessionpipe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/sessionpipe)](https://www.npmjs.com/package/sessionpipe)
[![License: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue)](LICENSE)
[![Spec: CC BY 4.0](https://img.shields.io/badge/spec-CC%20BY%204.0-blue)](spec/LICENSE)
[![DCO](https://img.shields.io/badge/contributions-DCO-informational)](DCO)

> Status: **pre-release**. The repository is being built milestone by milestone in
> the open; see [ROADMAP.md](ROADMAP.md) for what exists today. Nothing is published
> to npm until v0.1.0.

## Install

```sh
npx sessionpipe install
```

That detects the harnesses on your machine, writes their hooks, and backfills the
last 30 days of sessions into a local outbox. Nothing is sent anywhere until you add
a sink:

```sh
sessionpipe sink add https://your-receiver.example --tier 1
sessionpipe tail            # watch events locally, no server needed
```

## What a session looks like

```
$ sessionpipe tail --tier 1
00:41:02 claude-code 8c13…  session.started   source=startup  ~/spacesheep main
00:41:09 claude-code 8c13…  turn.started      prompt_chars=61
00:41:11 claude-code 8c13…  tool.started      Read
00:41:11 claude-code 8c13…  tool.ended        Read ok 38ms
00:41:14 claude-code 8c13…  tool.started      Bash
00:41:16 claude-code 8c13…  tool.ended        Bash ok 1830ms
00:41:31 claude-code 8c13…  attention.needed  permission Bash "git push origin …"
```

## Privacy tiers

Each sink is configured at a tier; the receiver declares its maximum; the lower wins.

| Tier | What leaves | Who it is for |
|-----:|-------------|---------------|
| 0 | Session ids, state, timing, machine, repo, branch, model, title; attention *kind* | A presence board: "working / needs you / done" |
| 1 | + tool names, durations, ok/error, file paths, attention message, subagents, compactions | An activity feed |
| 2 | + your prompts and the assistant's text (`turn.transcript`) | Memory, search, recaps |
| 3 | + tool input and output, thinking, raw hook lines | Full replay, your own server only |

The secrets ruleset runs on every string above tier 0 and cannot be turned off; PII
reduction is a second, opt-in pass. `sessionpipe tail` shows exactly what a tier
sends. **Provided as-is; check what a sink receives with `sessionpipe tail` before
you point it anywhere.**

## Three promises

- **No telemetry.** sessionpipe reports to the sinks you configured and to nobody else.
  The website has no analytics.
- **Secrets never leave.** Redaction runs on your machine, before the outbox.
- **Your server or none.** A file sink, `stdout`, the reference receiver on your
  laptop, or any HTTPS endpoint that speaks the protocol.

## Pieces

| | |
|---|---|
| [`spec/`](spec/) | The protocol: envelope, events, tiers, HTTP binding, control channel, adapters (CC BY 4.0) |
| [`schemas/v1/`](schemas/v1/) | JSON Schemas, generated from the code; also served at `https://sessionpipe.org/schema/v1/` |
| [`conformance/`](conformance/) | Real hook payloads per harness, redaction vectors, delivery scenarios |
| [`packages/core`](packages/core) | `@sessionpipe/core`: types, adapters, privacy filter, outbox, sinks (zero dependencies) |
| [`packages/cli`](packages/cli) | `sessionpipe`: install, sink, status, doctor, tail |
| [`packages/receiver`](packages/receiver) | `@sessionpipe/receiver`: one process, JSONL files, a page you can answer from a phone |
| [`packages/conformance`](packages/conformance) | `@sessionpipe/conformance`: scores a receiver or an adapter |
| [`website/`](website/) | [sessionpipe.org](https://sessionpipe.org), rendered from `spec/` |

Who receives: [sessionpipe.org/receivers](https://sessionpipe.org/receivers/).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Every commit is signed off under the
[DCO](DCO); there is no CLA. A new harness is one adapter file plus its fixtures. A
protocol change starts as a [spec proposal](https://github.com/micmmakarov/sessionpipe/issues/new?template=spec-proposal.yml)
with a fixture. Security reports go through [SECURITY.md](SECURITY.md).

Code is Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)); the spec is CC BY 4.0
([spec/LICENSE](spec/LICENSE)). "sessionpipe" is a mark of Michael Makarov; see
[TRADEMARKS.md](TRADEMARKS.md). Governance: [GOVERNANCE.md](GOVERNANCE.md).
