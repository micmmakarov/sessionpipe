---
"sessionpipe": minor
"sessionpipe-core": minor
---

`sessionpipe connect <receiver>`: one command and one approval set a machine up — hooks for every agent and every Claude Code account, a sink at tier 2 with the key the receiver hands over at pairing, signed messages, keys in the keychain, a daemon that outlives logout, 30 days backfilled. It asks nothing (safe mode unless `--mode auto`; folders from `--folder`, the folder it ran in, or where recent sessions ran — never the home folder) and a second run only fixes what's missing.

- Hooks run a launcher, `~/.local/share/sessionpipe/sessionpipe-hook`, with its own copy of the hook: a Node upgrade, `nvm uninstall` or a moved npm prefix no longer silently stops reporting. Re-installs move old entries to it in place.
- Keys (sink tokens and secrets, machine tokens) live in the macOS Keychain or a desktop session's Secret Service when one is writable, else in the 0600 files as before; `sessionpipe secrets [move keychain|secret-service|file]`. A token a locked keychain won't hand over leaves events waiting (never unsigned); the daemon drains them from your session.
- The Linux daemon turns on systemd linger, so closing ssh no longer stops it; on a Mac with nobody at the screen it runs as a background launchd agent instead of failing.
- Before a headless run the daemon asks Claude Code whether that account is signed in (`claude auth status`) and fails the message with what to do — on a Mac, that a keychain login can't be read with nobody logged in at the screen — instead of Claude Code's "please run /login". `connect` and `doctor` list each account's state.
- `sink add` keeps a sink's existing key when only the tier changes (it used to drop it); pairing fills in a sink that has no key and takes `--tier`; `control pair` run from the home folder no longer allows all of it; `control.json` keeps the machine's own caps across a write.
