# Explicit event import

Physical-view additions use `scripts/import-media-bundle.mjs` schema2. The separate `scripts/import-event-bundle.mjs BUNDLE_DIRECTORY APPROVED_MANIFEST_BYTE_SHA [--apply]` is deliberately pinned to the first independently reviewed Butlerville event bundle. It is not a general event-approval tool. Dry-run is the default; exact repeat imports verify metadata and media bytes when the pinned baseline still matches.

The admitted event is a different occurrence from physical camera `meva-mutc-g340`. Its physical identity remains unchanged; event and original-recording evidence distinguish its recording tile. Crop, offset, encode and feed names do not create new cameras. Original/event aliases and unauthorized cities are rejected.

That first import produced 94 physical views and 95 recordings. A later separately reviewed New York physical-view addition brings this release to **95 physical views and 96 recordings**. Butlerville retains 19 physical views and 20 recordings. The changed baseline intentionally closes the old event importer until a newly reconciled baseline and independent overlap/alias review authorize a future event bundle. The original root decision's zero-event count describes its historical state, not the current catalog.

No second-event import or general event automation is claimed. Full-mosaic uniqueness at the required density remains incomplete; the default experience still repeats recordings and the strict capacity diagnostic remains blocked. Source discovery, preparation, independent visual review, runtime acceptance and publication remain separate steps.

Verification: `npm run test:importers`, the recording/city-ownership unit tests, and `npm run build:pages`.
