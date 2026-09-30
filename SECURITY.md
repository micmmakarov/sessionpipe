# Security policy

## Reporting a vulnerability

Please report privately, never in a public issue:

- **GitHub private vulnerability reporting**: [open a draft advisory](https://github.com/micmmakarov/sessionpipe/security/advisories/new)
- or email **security@sessionpipe.org**

Until that address is live, the GitHub form reaches the maintainer directly.

We acknowledge within **5 working days**, keep you informed, and coordinate
disclosure within **90 days** of the report (sooner when a fix is ready; longer only
by agreement with the reporter). Credit is given in the advisory unless you prefer
otherwise.

## Supported versions

| Version | Supported |
|---------|-----------|
| latest minor (0.x while pre-1.0) | yes |
| older | no; upgrade |

## Threat model, in three lines

1. **Receivers are trusted by the person who added them.** A sink receives exactly
   what its tier allows and nothing more; the client cannot be made to send more than
   the configured tier by anything a receiver says.
2. **Transcripts are untrusted content.** Anything read from a harness's files or
   stdin is data: never executed, never interpolated into a shell, and redacted before
   it reaches the outbox.
3. **The hook path must never be able to block or alter the harness — except to
   deliver a signed control command.** The hook exits 0 in milliseconds, writes only
   what the harness requires to stdout (`{}` where a harness reads it), and does all
   work in a detached process. The one exception is a control command
   (`spec/CONTROL.md`) that passed every check on the machine: the person's passkey
   signed it and the machine verified it itself, so no receiver, sink token or
   server can produce one. It is delivered only through each harness's documented
   hook answers and input APIs; nothing is ever auto-allowed and no signal is ever
   sent to a process.
4. **A receiver can queue a control command but never forge one.** Keys are
   enrolled only at the machine's own terminal; the daemon polls with a key bound to
   one machine, which can read and ack that queue and nothing else.

## FAQ

**What if a sink token leaks?** Its holder can post events to that receiver as you;
the client never gives a sink token anything else. What else the token opens is the
receiver's choice, so use a receiver's scoped, sessions-only token when it offers one
(see *Sink tokens, for receivers* below) — spacesheep's is *Sessions only* in Settings →
API keys. Revoke it at the receiver and `sessionpipe sink remove` it.

**Sink tokens, for receivers.** A sink's token sits in a config file on every machine
that reports, next to the hooks: the most-copied, least-guarded place a credential
lives. A receiver that has accounts, APIs or data of its own should issue scoped
tokens that open only its sessionpipe endpoints and nothing else of the account, so a
leaked one lets its holder post session events and read nothing. Keep accepting your
broader credentials there if people already use them, so nothing configured breaks,
and say which kind to use. Refuse a scoped token anywhere else with 401 or 403. The
client stores the token with mode `0600` and shows a four-character prefix at most.

**Cryptography / export control.** sessionpipe uses TLS (via Node's `fetch`) and
HMAC-SHA256 for Standard-Webhooks signature verification. It contains no encryption
of its own and needs no export notice.

**Does sessionpipe phone home?** No. There is no telemetry. The optional daily
version check is a plain read of the npm registry and is off with
`SESSIONPIPE_NO_UPDATE_CHECK=1`.
