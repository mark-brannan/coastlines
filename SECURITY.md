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

- **The data is Natural Earth's, unchanged, and provably so.** Every file's
  sha256 is in `manifest.json` and checked on every sync and every pack. What
  an old version costs you is a coastline that is out of date relative to
  Natural Earth, not a tampered file.
- **The code is small and has no runtime dependencies.** `lib/` reads the
  manifest and resolves paths; nothing fetches at runtime. The Signal K plugin
  face, when it lands, will serve files from disk and will be covered here.

If you ship these files to a browser, pin an exact version and read the release
notes before moving — moving the Natural Earth pin changes bytes.

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

The interesting property of this package is that it is **somebody else's data
you are asked to trust**, and the trust is meant to be checkable.

- **A file that does not match its manifest entry.** Every entry carries the
  pinned source URL, the byte count and the sha256 of the published file, so
  that this works:

  ```shell
  curl -sL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_coastline.geojson | sha256sum
  node -p "require('coastlines/manifest.json').files.find(f => f.id === 'ne-coastline-110m').sha256"
  ```

  If a file in a published tarball does not match, report it privately. It is
  almost certainly an honest mistake, but it is the one failure here that
  could hide an altered file, so it gets looked at before it is discussed.

- **A discrepancy between npm and this repository** at the corresponding tag,
  or anything shipped in `files` that should not be there.

- **The sync script fetching anything but the pinned URL**, or accepting a
  byte it should refuse.

## What is out of scope

- **Natural Earth's own data and its accuracy.** This package records a digest
  of what they publish and does not vouch for the cartography; a missing
  island is [their issue](https://github.com/nvkelso/natural-earth-vector/issues).
- **Drawing.** [coast-wright](https://github.com/mark-brannan/coast-wright)
  and MapLibre render; injection into a page through a canvas belongs there.
- **Navigational use.** Natural Earth is small-scale cartography for a world
  map. It is not a chart and must not be used for pilotage.

## Notes on how this package is built

- **No runtime dependencies.** The single devDependency draws the README's
  layer sheet and is not needed to install, test or sync.
- **`npm test` runs with the network unavailable.** `npm run sync` does not:
  it fetches from the pinned Natural Earth release, refuses any byte that
  disagrees with the manifest, and runs before every `npm pack`, so a tarball
  never carries a file the manifest did not promise.
