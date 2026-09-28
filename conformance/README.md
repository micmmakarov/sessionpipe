# Conformance

- `harness/<name>/*.json` — `{ input: { argv, stdin, env, files }, expect: [events] }`,
  recorded from **real** hook payloads (secrets scrubbed; `npm run fixture-scan` gates it).
  `"*"` in an expected event is a wildcard for `id` and `time`.
- `redaction/secrets.json`, `redaction/pii.json` — `[{ in, out }]` vectors for the rulesets.
- `delivery/*.json` — receiver scenarios: dedup, 413 split, 403 tier, retry, forget, control.

Filled in M1. Run with `npm run conformance`, or against a live receiver with
`npx @sessionpipe/conformance https://host`.
