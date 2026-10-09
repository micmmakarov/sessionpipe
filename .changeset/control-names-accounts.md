---
"sessionpipe": minor
"sessionpipe-core": minor
---

Control's pairing request and every daemon hello name the Claude Code accounts signed in on the machine (`accounts`: `{harness, id, email}` per config dir, read again for each hello), so a receiver the person paired with can label `session.account_id` with the account's email instead of showing an id. Events are unchanged: `account_id` stays an id and no event carries an email. `sessionpipe control pair` and `connect` say which accounts they named.
