# Versioning and change

> This document is part of the sessionpipe protocol and is licensed under [CC BY 4.0](LICENSE). The words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. Status: **Draft** (see [VERSIONING.md](VERSIONING.md)).

## The protocol integer

`protocol` in every event and in the well-known file is an integer, `1` today. It
changes **only for a breaking change**: a required field removed or retyped, a
semantic that a v1 receiver would misread. A receiver that sees a higher integer than
it supports answers `400 {"reason":"unsupported_protocol","supported":[1]}` and the
sender stops that sink and says so.

## Additions

Anything additive — a new event type, a new optional field, a new endpoint — ships
without a bump:

- **New event types** are free: a receiver MUST accept and store unknown types.
- **New optional fields** in `session` or `data` are free: extra keys are kept.
- **New endpoints and behaviours** are announced as a **capability string** in the
  well-known file, so a sender can tell whether a receiver has them.

## Deprecation

A field or type that is deprecated stays in the spec and in the schemas for
**12 months** after the CHANGELOG entry that deprecates it, marked `deprecated` in
its description. Senders SHOULD stop emitting it; receivers MUST keep accepting it.

## Schemas

`schemas/v1/*.json` are generated from the reference implementation's types and
committed; CI fails when they drift. They are also the `$id`s served at
`https://sessionpipe.org/schema/v1/`. The schema set for a protocol integer only
ever grows (see Additions); a bump starts a new directory (`schemas/v2/`).

## Status

The spec is **Draft** until two independent receivers pass the conformance suite,
then **Stable**. Sections marked *implemented in Mn* are specified but not yet
shipped in the reference client; they do not affect status.

## How a change happens

1. An issue with the **spec proposal** template: motivation, the exact field change
   with its requirement level, the fixture that proves it, compatibility.
2. Seven days of lazy consensus (a maintainer may object with what would resolve it).
3. One PR that carries the spec text, the regenerated schema and the fixture. A spec
   change without a fixture change fails CI.
4. A CHANGELOG entry under the protocol heading.

## Compatibility table

| Client | Receiver | Result |
|--------|----------|--------|
| v1 | v1 | works |
| v1 with new capability | v1 without it | works; the capability is not used |
| v2 | v1 | 400 `unsupported_protocol`; the sink is paused |
| v1 | v2 (supports [1,2]) | works |
