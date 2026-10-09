---
"sessionpipe": patch
---

Handle `--help` and `-h` before dispatching every CLI command, including nested commands, so asking for usage cannot install hooks, queue work, or contact a receiver. Implement `status --json` with doctor's names for shared facts plus pending session counts and queued jobs, preserving the human status output.
