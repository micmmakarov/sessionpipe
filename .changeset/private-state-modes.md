---
"sessionpipe": patch
"sessionpipe-core": patch
---

Session data stays private to its user on a shared machine. The control socket is created `0600`, as CONTROL.md §8 says (it was `0755`, gated only by the umask). A `file:` sink writes `0600` in a `0700` directory, like the outbox it drains. `log` and `timing.jsonl` are `0600`. Every worker tightens the state root to `0700`, which closes off files an older version left `0644`. mkdir's mode never changed a directory that already existed.
