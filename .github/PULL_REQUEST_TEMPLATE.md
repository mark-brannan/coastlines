## What and why

<!--
Motivation, not mechanics — the diff shows what changed. If this closes an
issue, say so here: closes #12
-->

## If the manifest changed

<!--
REQUIRED for any change to manifest.json. Consumers import these files
directly and some ship them to a browser.

1. Which ids were added, removed or re-pinned, and the raw bytes of each.
2. `npm run sync:refresh` was what wrote the bytes and sha256 — not a hand
   edit — and the diff is the one it produced.
3. `npm run build:readme` and `npm run build:sheet` were run, so the README
   table and docs/layers.png match.

Delete this section if the manifest did not move.
-->

## Version

- [ ] patch (no published file's bytes changed)
- [ ] minor (a file's bytes changed, a new id, a chart or style change)
- [ ] major (an id or export removed or renamed)

## Checks

- [ ] `npm test` passes with the network unavailable, and again after `npm run sync`
- [ ] Any new export is reachable by its `exports` path from a fresh install
- [ ] Branched from latest `main` (rebased, not merged)
- [ ] One logical change

## Anything the maintainer should look at

<!--
A file whose byte cost you were unsure was worth it, a chart whose tile size
you have not measured. Delete if there is nothing.
-->
