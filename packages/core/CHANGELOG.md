# @sessionpipe/core

## 0.1.0

### Minor Changes

- e918475: Protocol v1 draft: the Zod source of truth (`packages/core/schema/v1.ts`) and the generated `schemas/v1/*.json`; inferred runtime types.
- c75aaa0: Core: adapters for Claude Code, Codex, Gemini CLI and Antigravity; the secrets@1 and pii@1 rulesets and the tier filter; outbox, cursors, locks; file, stdout and HTTP sinks. CLI: install, uninstall, sink, status, doctor, tail, backfill, forget, replay, update; the hook entry imports only node: builtins. Conformance: adapter fixture runner.
