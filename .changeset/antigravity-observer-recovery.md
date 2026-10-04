---
"sessionpipe": patch
"sessionpipe-core": patch
---

Complete Antigravity recovery after removing PreToolUse: doctor now detects recent
starts without completions and identifies unsafe registrations with install/restart
instructions. Stale PreToolUse invocations receive no permission decision from the
adapter, hook, or node-missing launcher. Reinstall and restart Antigravity to remove
cached registrations; an empty response alone is not a repair.
