# Contributing

Thanks for looking. coastlines publishes **ready-made** coastline and land
geometry — a few kilobytes each — for anything that draws a map without a tile
server.

It ships data and a build script. No runtime code: the decoder is
[nine lines][enc] in whatever language your display runs, and
[coast-wright](https://github.com/mark-brannan/coast-wright) is one
implementation of it, not a required one.

> **This package is alpha.** The data is real and the tests pass; the format is
> still settling. See [the spec's change policy][changes].

## Which repository

Three packages, and the boundary between them decides where an issue goes:

- **[portolani](https://github.com/mark-brannan/portolani)** is the generator.
  How simplification works, what the knobs do, what lands in `provenance` — all
  of that is decided there. **A shape that comes out wrong is almost always a
  portolani issue**, because this package is only the output of running it.
- **This repository** decides *which* files to publish and at what settings —
  the profile table in the README — and holds an independent decoder in its
  tests.
- **[coast-wright](https://github.com/mark-brannan/coast-wright)** draws them.
  If the JSON is right and the picture is wrong, it belongs there.

When in doubt, file it here; it will be moved.

## You can check this package rather than trust it

Every file records the generator version, the source URL, a digest of the raw
fetched bytes, and every knob value. So the claim is falsifiable in one line:

```shell
npx portolani -s ne_110m_coastline -t 0.25 -p 1 -m 1 | diff - data/coastline-110m.json
```

**A pull request that changes a data file must show that diff coming back
clean**, or explain precisely why it cannot. Derived data whose provenance no
longer reproduces it is worse than no provenance at all — it looks checkable
and is not.

## Proposing a new profile

This is the most likely reason to open an issue here, and the bar is real:
every profile is bytes in every install of this package, forever, for everyone
who wanted a different one.

So say **what it is for** — the display, roughly how large on screen, and the
byte budget — and what you use today instead. Say the source layer and the knob
values if you have them, but the use is what decides it; the knobs follow.

If you need one file for one project rather than a profile for everyone, you do
not need this package at all: run the generator, commit the output, and the
provenance stamp keeps it honest.

## Setting up

```shell
git clone https://github.com/mark-brannan/coastlines.git
cd coastlines
npm install
npm test
```

Node 20 or newer. The one devDependency is `portolani`, the generator; there
are no runtime dependencies, and `npm test` runs with the network unavailable.

To regenerate the data files:

```shell
npm run build
```

That one **does** reach the network — it fetches from Natural Earth. It should
produce no diff unless you changed a profile's settings or the generator moved.

## The tests decode independently, on purpose

`test/data.test.mjs` is a decoder written against [the spec][enc], and it
deliberately does not import the code that wrote the files. If it imported the
encoder, an encoder bug would round-trip cleanly and prove nothing.

Keep that. The two mistakes every decoder makes are silent — reading
`[lat, lon]` because that is what Google's polyline format stores, and
forgetting that the encoding alphabet contains a backslash that JSON escapes —
and `fixtures/` exists so an implementation in any language can catch both
before it ships.

## Before you open a pull request

```shell
npm test
```

Then:

- **A changed data file shows its numbers**: shapes, points, bytes, before and
  after. The README's profile table quotes all three and has to be updated in
  the same pull request.
- **A changed data file shows the reproduce-and-diff command coming back
  clean.**
- **Tests assert values** — counts, coordinates, digests — never printed
  layout, and never by importing the encoder.
- **Branch from latest `main`**, and rebase onto it rather than merging it in.
- **One logical change per pull request.**
- **Commits are conventional**: `<type>(<scope>): <subject>`, imperative,
  50 characters or fewer.

## Versions

Pre-1.0 and alpha, so this can still move — but consumers import these files
directly and some ship them to a browser, so:

- **Any change to a published file's bytes is at least a minor**, including a
  regeneration against a newer Natural Earth ref. Somebody's page gets larger
  or their coastline moves.
- A new profile is a minor. Removing one, or changing an export path, is a
  major.
- A change that takes a new `format` value under the [spec's change
  policy][changes] is a major, and coordinates with portolani.

## Code of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are licensed under the [MIT licence](LICENSE) that covers this
project. The geometry derives from Natural Earth, which is public domain and
carries its own attribution — recorded inside each file's `provenance`. Do not
strip it.

[enc]: https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#3-encoding
[changes]: https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#8-changes
