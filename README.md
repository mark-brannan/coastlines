# coastlines

> **Alpha.** The data is real and the tests pass; the format is still settling.
> See [the spec's change policy](https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#8-changes).

Ready-made coastline and land geometry, a few kilobytes each, for anything
that draws a map without a tile server.

```js
import coastline from 'coastlines/coastline-110m' with { type: 'json' }
// 128 lines, 2709 points, 8 KB -- the whole world
```

Zero dependencies. Plain JSON. The decoder is
[nine lines](https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#3-encoding)
in whatever language your display runs, including a microcontroller with no
JavaScript anywhere near it. Skeptical that 8 KB is enough?
[Move the slider and watch](https://mark-brannan.github.io/portolani/).

## Profiles

| Import | Kind | Shapes | Points | Bytes | For |
| --- | --- | --- | --- | --- | --- |
| `coastlines/coastline-110m` | lines | 128 | 2 709 | 8 151 | Annotating a coarse data grid. Finer than any global model's cell. |
| `coastlines/coastline-50m` | lines | 507 | 11 166 | 41 592 | A world map the reader looks at rather than through. |
| `coastlines/land-110m` | polygons | 121 | 2 764 | 8 445 | The same coarse world, fillable — outer rings and holes. |
| `coastlines/fixtures` | — | — | — | 5 295 | Self-check vectors for a decoder in another language. |

Each file is a **portolano**: geometry plus the provenance to regenerate it.
The format is [specified][spec] independently of this package.

## Reading one

In a browser or Node, [`coast-wright`][cw] decodes and draws — its
[projection gallery][cwdemo] is this package's 50m profile through fourteen
projections:

```js
import coastline from 'coastlines/coastline-110m' with { type: 'json' }
import { rings, limn } from 'coast-wright'

limn(ctx, rings(coastline), x, y, { color: '#8ab' })
```

Anywhere else, write the decoder from [§3 of the spec][enc] and prove it right
against `coastlines/fixtures` — which exists because the two mistakes everyone
makes are silent: reading `[lat, lon]` because that is what Google's polyline
format stores, and forgetting that the encoding alphabet contains a backslash
that JSON escapes. `test/data.test.mjs` in this repo is one such independent
decoder, deliberately not importing the code that wrote the files.

## Provenance

Every file records where it came from and exactly what was done to it:

```json
"provenance": {
  "generator": { "name": "portolani", "version": "0.1.0" },
  "source": {
    "id": "ne_110m_coastline",
    "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_coastline.geojson",
    "ref": "v5.1.2",
    "sha256": "sha256:851f581f…"
  },
  "options": { "kind": "lines", "tolerance": 0.25, "precision": 1, "minExtent": 1 }
}
```

Which means you can check this package rather than trust it:

```shell
npx portolani -s ne_110m_coastline -t 0.25 -p 1 -m 1 | diff - node_modules/coastlines/data/coastline-110m.json
```

Simplification is lossy and has knobs. Derived data without the knob values is
a file somebody made once; with them it is reproducible, which is the whole
reason the [generator][gen] is published separately.

## Regenerating

```shell
npm install && npm run build
```

Needs the network. While `portolani` is unpublished, link it first:
`npm install --no-save ../portolani`. `scripts/build.mjs` holds one entry per profile and no
generation logic of its own — if you want a fidelity that is not here, that is
a four-line addition, or just run [`portolani`][gen] yourself.

## Licence

The code is MIT. The geometry derives from [Natural Earth][ne], which is
public domain — no permission needed, no attribution required. Credited
anyway:

> Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com

[spec]: https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md
[enc]: https://github.com/mark-brannan/portolani/blob/main/docs/portolano-format.md#3-encoding
[gen]: https://github.com/mark-brannan/portolani
[cw]: https://github.com/mark-brannan/coast-wright
[cwdemo]: https://mark-brannan.github.io/coast-wright/
[ne]: https://www.naturalearthdata.com/
