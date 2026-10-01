---
"sessionpipe": minor
"sessionpipe-core": minor
---

Answers stream: a non-final `progress` ack carries the answer so far (whole, with a rising `seq`). The daemon streams headless runs from Claude Code's `stream-json` output (token by token) and in-place deliveries from the session's transcript (message by message); the final ack still carries the whole answer.
