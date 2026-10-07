# Governance

sessionpipe is a small open project with one maintainer today and a written path to
more.

## Maintainers

| Name | GitHub | Since |
|------|--------|-------|
| Michael Makarov | [@micmmakarov](https://github.com/micmmakarov) | 2026-09 |

Maintainers merge PRs, cut releases, and hold the npm packages, the domain and the
GitHub repository.

## How decisions are made

- **Lazy consensus in issues.** A proposal that stands for seven days without a
  maintainer objection is accepted. Objections say what would resolve them.
- **Spec changes** need a conformance fixture and one maintainer approval after the
  window (see [CONTRIBUTING.md](CONTRIBUTING.md)). Breaking changes bump the protocol
  integer and are announced in CHANGELOG.md twelve months before a deprecated field
  is removed (see `spec/VERSIONING.md`).
- **Everything else** (code, docs, site) merges on one maintainer approval with green CI.

## Becoming a maintainer

After three merged, non-trivial PRs (an adapter, a spec change with fixtures, a
receiver feature), an existing maintainer may nominate a contributor in a public
issue. Lazy consensus for seven days, then they are added to this file and given
merge rights.

The repository lives in the `spacesheep-dev` GitHub organisation. When a second
maintainer joins, the npm packages and the domain get a second owner. Until then,
the maintainer list above is the bus factor, stated plainly.

## Stepping down

A maintainer who is inactive for six months is asked whether they wish to continue;
no reply after a further month moves them to an emeritus list here.

## Scope

The project maintains the protocol (`spec/`), its schemas and conformance suite, the
`sessionpipe` client and its adapters, the reference receiver, and the website. It
does not operate a hosted receiver, and it does not receive anyone's data.
