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
3. **The hook path must never be able to block or alter the harness.** The hook
   exits 0 in milliseconds, writes only what the harness requires to stdout (`{}` where
   a harness reads it), and does all work in a detached process. Control messages
   (`spec/CONTROL.md`) are delivered only through each harness's documented hook
   answers; nothing is ever auto-allowed and no signal is ever sent to a process.

## FAQ

**Cryptography / export control.** sessionpipe uses TLS (via Node's `fetch`) and
HMAC-SHA256 for Standard-Webhooks signature verification. It contains no encryption
of its own and needs no export notice.

**Does sessionpipe phone home?** No. There is no telemetry. The optional daily
version check is a plain read of the npm registry and is off with
`SESSIONPIPE_NO_UPDATE_CHECK=1`.
