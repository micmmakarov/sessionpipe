# Get started

> **Pre-release.** The packages publish to npm at v0.1.0; until then, the commands below describe the client as specified and built in the repository. Follow the [roadmap](https://github.com/micmmakarov/sessionpipe/blob/main/ROADMAP.md).

## 1. Install the hooks

```sh
npx sessionpipe install
```

Detects the harnesses on your machine (Claude Code, Codex, Gemini CLI, Antigravity, and more as adapters land), writes their hooks, installs itself globally if run through npx (a hook cannot start from an npx cache), and backfills the last 30 days of sessions into a local outbox. Nothing leaves the machine yet.

## 2. Watch, with no server

```sh
sessionpipe tail --tier 1
```

One event per line from the local outbox, filtered to a tier. This is exactly what a tier-1 sink would receive.

## 3. Add a sink

```sh
sessionpipe sink add https://your-receiver.example --tier 1 --token <t>
sessionpipe status
```

`sink add` reads the receiver's `/.well-known/sessionpipe`, caps the tier at its `max_tier`, stores the token with mode 0600 and sends one heartbeat as a test. `status` shows the last 2xx per sink, queue depth and hook timing.

## The reference receiver

```sh
npx sessionpipe-receiver --port 7357 --token <t> --max-tier 3
```

or in Docker: `docker run -p 7357:7357 -v sessionpipe:/data ghcr.io/micmmakarov/sessionpipe-receiver`. Open `http://localhost:7357/` for the page: sessions grouped needs-you / working / recent, live.

## Send to spacesheep

Make a **sessions-only** key at [spacesheep.dev/settings/api-keys](https://spacesheep.dev/settings/api-keys) (pick *Sessions only* beside the name), then:

```sh
npx -y sessionpipe install --sink https://spacesheep.dev --tier 2 --token <sessions-only ss_ key>
```

A sessions-only key can report sessions and turns and nothing else: no MCP, no deploys, no reads. It is the safe kind to leave in a sink config on every machine. A full `ss_` key still works here, but if it leaks from that file it opens the whole account.

`spacesheep sessions install` (CLI 2.0) will do the same in one step.

## Send to a Slack webhook

`examples/slack-webhook/` in the repository is a Cloudflare Worker that receives tier-0 events and posts `attention.needed` to a channel: "needs you: Bash on misha-air".

## Uninstall

```sh
sessionpipe uninstall
```

Removes only the entries it wrote; every config file is byte-identical otherwise.
