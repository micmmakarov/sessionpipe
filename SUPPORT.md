# Support

- **Questions and ideas**: [GitHub Discussions](https://github.com/spacesheep-dev/sessionpipe/discussions).
- **Bugs**: an [issue](https://github.com/spacesheep-dev/sessionpipe/issues/new?template=bug.yml)
  with the output of `sessionpipe doctor --json`.
- **A harness we do not support yet**: an [adapter request](https://github.com/spacesheep-dev/sessionpipe/issues/new?template=adapter.yml).
- **Security**: see [SECURITY.md](SECURITY.md); never a public issue.

## What is not supported

- Harnesses with no hook or plugin API (Aider, Zed, Codebuff, Warp at the time of
  writing). The "Adapters wanted" Discussion tracks those with an API we have not
  wired yet.
- Node < 20.
- Reading a harness's data through anything but its documented hooks and the files it
  writes on your own machine. sessionpipe never scrapes a vendor API or reads a
  credential.

A maintainer replies to issues within five working days.
