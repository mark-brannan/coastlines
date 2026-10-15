# Agent decisions

Append-only. Each entry is a call an agent made in pencil: a default it took
under the one-way-door test, with its undo. Written by `agent-decision`; the
heading is the UTC stamp, so `agent_decisions.md#<stamp>` links one entry.

### 20261011t034643z
- Styles: countries a faint outline, places dots, no text labels (no glyph server on a boat) Undo: add glyphs and symbol layers ([#21](https://github.com/mark-brannan/coastlines/pull/21))

### 20261011t034658z
- Demo: ne-50m on by default; MapLibre 5.6.0 from unpkg Undo: edit demo/ ([#21](https://github.com/mark-brannan/coastlines/pull/21))

### 20261011t034713z
- sync job in ci-gate needs: a GitHub raw outage reds the gate Undo: drop it from needs ([#21](https://github.com/mark-brannan/coastlines/pull/21))

### 20261011t034727z
- GitHub Pages enabled on the repo via API, build_type workflow Undo: disable in settings ([#21](https://github.com/mark-brannan/coastlines/pull/21))

### 20261011t034742z
- README images committed under docs/ Undo: host on Pages ([#21](https://github.com/mark-brannan/coastlines/pull/21))

### 20261014t074611z
- The package root exports shapefilePolygons only; the zip reader and signedArea are internal, imported by path. Undo: re-export zipMembers, zipMember, crc32 and signedArea from lib/index.js ([#25](https://github.com/mark-brannan/coastlines/pull/25))

### 20261014t074613z
- The design's 30 MB packed line (§2e, R4) is a CI guard: the sync job fails past it. Measured 28.1 MB packed on this branch. Undo: delete the npm pack step from the sync job in test.yml ([#25](https://github.com/mark-brannan/coastlines/pull/25))

### 20261014t074616z
- package.json license stays MIT while the tarball ships unmodified LGPL-3.0-or-later GSHHG data with its notices; the declaration is left for the owner, thread open. Undo: set package.json license to MIT AND LGPL-3.0-or-later and point LICENSE at data/gshhg-*.txt ([#25](https://github.com/mark-brannan/coastlines/pull/25))

### 20261015t054107z
- provider verbs named rings, held, cost (agent-notes proposal) Undo: rename the three methods in lib/provider.js ([#38](https://github.com/mark-brannan/coastlines/pull/38))

### 20261015t054110z
- view scale field is metresPerPixel at the centre, converted to web-mercator zoom at view.lat Undo: swap zoomOf for a zoom field in lib/provider.js ([#38](https://github.com/mark-brannan/coastlines/pull/38))

### 20261015t054114z
- view frame is the caller's lon/lat box (lonMin, lonMax, latMin, latMax); the projection stays with the caller Undo: change the view's frame fields in lib/provider.js ([#38](https://github.com/mark-brannan/coastlines/pull/38))

### 20261015t054117z
- factory provider({ read, kind }) at coastlines/provider, kind coast or land Undo: rename the export and the package.json subpath ([#38](https://github.com/mark-brannan/coastlines/pull/38))

### 20261015t054120z
- any cell read failure degrades the view, not only a 404 Undo: rethrow non-missing errors in draw() in lib/provider.js ([#38](https://github.com/mark-brannan/coastlines/pull/38))
