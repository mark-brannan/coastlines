# Security Policy

## Supported versions

This package is alpha and maintained as a single moving line. Only the latest
version published to npm gets fixes; there are no maintenance branches, and a
pre-1.0 release may change a published file in a patch.

| Version | Supported |
| ------- | --------- |
| latest `0.0.x-alpha` on [npm](https://www.npmjs.com/package/coastlines) | yes |
| anything older | no — upgrade first |

Two things make that less alarming than it reads:

- **This package ships data and no runtime code.** Nothing in it executes in
  your process. What an old version costs you is a coastline that is out of date
  relative to Natural Earth, not a vulnerability sitting in your dependency
  tree.
- **The format is versioned separately** from the package, by the `format`
  field inside each file, under the spec's
  [change policy](https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#8-changes).
  A decoder written against a `format` value keeps working.

If you ship these files to a browser, pin an exact version and read the release
notes before moving — a regeneration changes bytes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it
privately through GitHub:

1. Go to
   [Security → Report a vulnerability](https://github.com/mark-brannan/coastlines/security/advisories/new).
2. Describe what you found, which version you saw it in, and how to reproduce
   it.

You should get an acknowledgement within a week. This is a spare-time project
maintained by one person, so a fix may take longer than that — you will be told
where it stands rather than left waiting. If a report is valid and you want
credit, you will be named in the advisory.

If you get no response at all within two weeks, open a public issue saying only
that you are waiting on a private report — no details — and it will be picked
up.

## What is in scope

The interesting property of this package is that it is **derived data you are
asked to trust**, and the trust is meant to be checkable.

- **Provenance that does not reproduce the file.** Every file records the
  generator version, the source URL, a digest of the raw fetched bytes, and
  every knob value, so that this works:

  ```shell
  npx portolani -s ne_110m_coastline -t 0.25 -p 1 -m 1 | diff - node_modules/coastlines/data/coastline-110m.json
  ```

  If a published file does not reproduce from its own stated provenance,
  **report it privately** — that is the one failure here that could hide a
  deliberately altered file, and it is indistinguishable from an honest mistake
  until it is looked at.

- **A discrepancy between npm and this repository** at the corresponding tag,
  or anything shipped in `files` that should not be there.

- **JSON that harms a consumer.** These files are parsed by decoders in several
  languages, some on small hardware. A structure that crashes or hangs a
  reasonable parser is in scope.

## What is out of scope

- **How the geometry is produced.** Simplification, clipping, the antimeridian,
  what lands in `provenance` — all of that belongs to
  [portolani](https://github.com/mark-brannan/portolani/security), the
  generator. A crafted source document, or the fetching of one, is its surface,
  not this package's.
- **Drawing.** [coast-wright](https://github.com/mark-brannan/coast-wright)
  decodes and renders; injection into a page through a canvas or an SVG belongs
  there.
- **Natural Earth's own data and its accuracy.** This package records a digest
  of what they publish and does not vouch for the cartography.
- **Geometry that looks wrong** — a missing island, an over-simplified bay.
  That is a public issue, usually against portolani.
- **Navigational use.** This is coarse, deliberately lossy geometry for
  annotating a display. It is not a chart and must not be used for pilotage.

## Notes on how this package is built

- **No runtime dependencies.** The single devDependency is the generator.
- **The tests decode the shipped files independently**, against the published
  spec, without importing the code that wrote them — an encoder bug cannot
  round-trip its way past them.
- `npm test` runs with the network unavailable. `npm run build` does not: it
  fetches from Natural Earth, by design, and is a maintainer step rather than
  part of installing this package.
