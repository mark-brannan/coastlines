# Contributing

Thanks for looking. coastlines puts Natural Earth geography on a boat: the
marine catalogue at three scales, byte for byte as published, as plain
GeoJSON today and as a Signal K resource provider next.

## Which repository

- **This repository** decides *which* Natural Earth files ship, under which
  ids, grouped into which charts, drawn with which styles. The data itself is
  never edited here.
- **A shape that is wrong is a [Natural Earth](https://github.com/nvkelso/natural-earth-vector/issues)
  issue.** This package ships their file unchanged, and the manifest's sha256
  proves it.
- **[coast-wright](https://github.com/mark-brannan/coast-wright)** draws
  GeoJSON to a canvas. If the file is right and the picture is wrong, it
  belongs there.

When in doubt, file it here; it will be moved.

## Setting up

```shell
git clone https://github.com/mark-brannan/coastlines.git
cd coastlines
npm test          # passes offline: the manifest, charts and styles
npm run sync      # fetches the pinned release into data/ (45 MB, ~15 s)
npm test          # now also verifies every file
```

Node 20 or newer. No runtime dependencies. The one devDependency,
`@napi-rs/canvas`, is only for `npm run build:sheet`, which draws the README's
layer sheet; `npm install` is optional otherwise.

## The manifest is the product

`manifest.json` is the whole promise: id, source file, bytes, sha256. `data/`
is gitignored and regenerated from it. So:

- **Adding a file** is one manifest entry without `bytes` or `sha256`, then
  `npm run sync:refresh`, then a look at the diff. The id is
  `ne-<layer>-<scale>`, underscores to hyphens; the tests enforce it.
- **Moving the pin** to a newer Natural Earth release is `source.ref` and
  `source.base`, then `npm run sync:refresh`. Every sha256 changes; that is a
  minor version at least, because somebody's coastline moves.
- **This package's share** is every 50m and 110m file, and at 10m the
  coastline, the land and whatever fits a 5 MB response body, bathymetry
  excluded. The rest belongs to the companion packages. A test holds that
  line.

## Charts and styles

`charts.json` says which ids a plotter sees as one tickable layer and the
zoom range of each. `styles/<chart>.json` is the Mapbox style the plugin will
serve, hand-written. The tests cross-check them: a style draws only layers
the chart cuts, inside their zooms, and every cut layer is styled.

To see a change: `npm run build:pages`, then serve `_site/` with anything
(`python3 -m http.server --directory _site`). The page is what GitHub Pages
deploys.

## Before you open a pull request

```shell
npm test
npm run build:readme   # if the manifest changed: regenerates the README table
npm run build:sheet    # if the manifest changed: regenerates docs/layers.png
```

- **Tests assert values**, never printed layout.
- **Branch from latest `main`**, and rebase onto it rather than merging it in.
- **One logical change per pull request.**
- **Commits are conventional**: `<type>(<scope>): <subject>`, imperative,
  50 characters or fewer.

## Versions

Pre-1.0, so this can still move, but consumers import these files directly
and some ship them to a browser:

- **Any change to a published file's bytes is at least a minor**, including
  moving the Natural Earth pin.
- A new id is a minor. Removing one, or renaming it, is a major.
- A chart or style change is a minor: a plotter's picture changes.

## Code of Conduct

Participation is governed by the
[Code of Conduct](https://github.com/mark-brannan/.github/blob/main/CODE_OF_CONDUCT.md).

## Licence

Contributions are licensed under the [MIT licence](LICENSE) that covers this
project. The geometry is Natural Earth, public domain, credited in the README
and the manifest. Do not strip it.
