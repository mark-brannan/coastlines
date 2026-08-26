## What and why

<!--
Motivation, not mechanics — the diff shows what changed. If this closes an
issue, say so here: closes #12
-->

## If a data file changed

<!--
REQUIRED for any change under data/ or fixtures/. Consumers import these
directly and some ship them to a browser.

1. The numbers, before and after: shapes, points, bytes.
2. The reproduce-and-diff command coming back clean:

     npx portolani -s <layer> -t <tol> -p <prec> -m <min> | diff - data/<file>.json

   If it cannot come back clean, say exactly why. Derived data whose provenance
   no longer reproduces it looks checkable and is not — that is worse than
   shipping no provenance at all.

Delete this section if no published file moved.
-->

## Version

- [ ] patch (no published file's bytes changed)
- [ ] minor (a file's bytes changed, or a new profile)
- [ ] major (a profile or export removed, or a new `format` value)

## Checks

- [ ] `npm test` passes, with the network unavailable
- [ ] The README's profile table matches the data — shapes, points, bytes
- [ ] The tests still decode independently, without importing the encoder
- [ ] Any new export is reachable by its `exports` path from a fresh install
- [ ] Branched from latest `main` (rebased, not merged)
- [ ] One logical change

## Anything the maintainer should look at

<!--
A profile whose byte cost you were unsure was worth it, a spec clause this
brushes against, or something coordinated with portolani. Delete if there is
nothing.
-->
