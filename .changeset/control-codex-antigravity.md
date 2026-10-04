---
"sessionpipe": minor
"sessionpipe-core": minor
---

Control: messages reach Codex and Antigravity sessions too. The daemon starts a new
session with `codex exec --json` or `agy -p … --output-format stream-json`, and resumes
one with `codex exec resume` or `agy --conversation`, the way it drives `claude -p`:
acked taken, the answer streamed as progress, then delivered with the reply. Both
harnesses pick their own session ids, so the daemon records the one a start got
(`state/control/aliases.json`) and keeps the start's id everywhere it reports the
session: acks, later messages, and the hook events. A message sent right behind its
start, even in the same poll, waits for it and resumes what it named. Safe mode runs
Codex in its `workspace-write` sandbox and agy with no permission flag; auto mode passes
`--approve-for-me` / `--mode accept-edits`; the bypass flags are never used. Hello and
pairing advertise the harnesses installed on the machine. Core gains the runners
(`codexControl`, `antigravityControl`), a shared headless spawner (`runHeadless`) and
`drivableHarnesses`; the verifier accepts a `start` for any harness.
