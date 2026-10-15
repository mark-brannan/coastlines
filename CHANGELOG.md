# Changelog

## [0.0.9-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.8-alpha.0...v0.0.9-alpha.0) (2026-10-15)


### Added

* acquire(), pinned-source bytes from a cache, with retry and verify ([#47](https://github.com/mark-brannan/coastlines/issues/47)) ([f44271a](https://github.com/mark-brannan/coastlines/commit/f44271a0a4febb83770c01a9eb736f0941903c61))
* measured sizes for the cut bands and a generated README table ([#44](https://github.com/mark-brannan/coastlines/issues/44)) ([5425450](https://github.com/mark-brannan/coastlines/commit/54254508e030db4070819f57385fd33238785117))


### Fixed

* **publish:** sync in its own cached step; prepack only verifies ([#43](https://github.com/mark-brannan/coastlines/issues/43)) ([23f2eb0](https://github.com/mark-brannan/coastlines/commit/23f2eb05fcdded6419446821b6fc35be5a5d40c7))

## [0.0.8-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.7-alpha.0...v0.0.8-alpha.0) (2026-10-15)


### Added

* build the catalogue's cells here, with the cutter and build date in each record ([#39](https://github.com/mark-brannan/coastlines/issues/39)) ([cb372d1](https://github.com/mark-brannan/coastlines/commit/cb372d1344520251842d20696f893bc4c2fb8600))

## [0.0.7-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.6-alpha.0...v0.0.7-alpha.0) (2026-10-15)


### Added

* **provider:** rings for a view, the band and its cells chosen here ([#38](https://github.com/mark-brannan/coastlines/issues/38)) ([77c983e](https://github.com/mark-brannan/coastlines/commit/77c983e7a7db9f8b823a318354a7033cae956226))


### Fixed

* **sync:** retry the GSHHG download on network errors and 5xx ([#35](https://github.com/mark-brannan/coastlines/issues/35)) ([94f5026](https://github.com/mark-brannan/coastlines/commit/94f502694cda57eaabd2b5bb15769a91bd60dd09))

## [0.0.6-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.5-alpha.0...v0.0.6-alpha.0) (2026-10-15)


### Added

* catalogue.json, the geometry bands as data ([#33](https://github.com/mark-brannan/coastlines/issues/33)) ([d48baf4](https://github.com/mark-brannan/coastlines/commit/d48baf4234a3300a7e6323de497fd0bb03cb2e3b))

## [0.0.5-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.4-alpha.0...v0.0.5-alpha.0) (2026-10-14)


### Added

* urban-area polygons at 50m ([#28](https://github.com/mark-brannan/coastlines/issues/28)) ([949b276](https://github.com/mark-brannan/coastlines/commit/949b276229c409c884237124954365643cf20cd7))

## [0.0.4-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.3-alpha.0...v0.0.4-alpha.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* vend GSHHG 2.3.7 "h" land, byte for byte, with zip and shapefile readers ([#25](https://github.com/mark-brannan/coastlines/issues/25))

### Added

* vend GSHHG 2.3.7 "h" land, byte for byte, with zip and shapefile readers ([#25](https://github.com/mark-brannan/coastlines/issues/25)) ([efb0801](https://github.com/mark-brannan/coastlines/commit/efb080127faef5a4fa9bcdc796709fc8dae378fc))

## [0.0.3-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.2-alpha.0...v0.0.3-alpha.0) (2026-10-11)


### Fixed

* **ci:** publish prereleases under their own dist-tag ([#22](https://github.com/mark-brannan/coastlines/issues/22)) ([c91e0ac](https://github.com/mark-brannan/coastlines/commit/c91e0acb81d7ce07f4b9a4bd227063a513890eaa))

## [0.0.2-alpha.0](https://github.com/mark-brannan/coastlines/compare/v0.0.1-alpha.0...v0.0.2-alpha.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* reset to Natural Earth GeoJSON, pinned and synced, with charts, styles and a Pages demo ([#21](https://github.com/mark-brannan/coastlines/issues/21))

### Added

* reset to Natural Earth GeoJSON, pinned and synced, with charts, styles and a Pages demo ([#21](https://github.com/mark-brannan/coastlines/issues/21)) ([531631d](https://github.com/mark-brannan/coastlines/commit/531631d2ee183b6271f337890804aceee4001b51))


### Fixed

* **ci:** hold publish on npm 11, not latest ([#19](https://github.com/mark-brannan/coastlines/issues/19)) ([d87f26e](https://github.com/mark-brannan/coastlines/commit/d87f26e81f80ee6de06517e484cbd9d3d7a991f2))
