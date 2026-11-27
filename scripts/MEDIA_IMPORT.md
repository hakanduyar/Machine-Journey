# Reviewed media bundle import

Run `node scripts/import-media-bundle.mjs BUNDLE_DIRECTORY APPROVED_MANIFEST_BYTE_SHA256` to plan an import. Add `--apply` only after independent source/media approval of those exact manifest bytes. The canonical bundle fingerprint and the file-byte SHA can differ; this command requires the latter.

The adapter accepts schema 2 bundles marked `INDEPENDENT_MEDIA_APPROVED_NOT_RUNTIME_ADMITTED`. It validates publisher/item/media binding, supported free licenses, city membership, global physical-view/original collisions, contained relative files, and loop/poster/credits hashes before writing. It appends assets and metadata without replacing an existing feed. Exact repeat imports verify bytes and make zero changes. A mismatching existing feed fails closed. Run in a clean, single-writer checkout; commit the result separately and independently review actual playback before release.

New rows carry their reviewed view identity and review reference; the runtime uses those data fields while preserving the legacy identity table. Publisher location claims are retained; globe city markers are not surveyed camera coordinates. Prepared clips remain archive footage and disclose visible loop dissolves.

Verification: `node --test scripts/import-media-bundle.test.mjs`, the recording manifest/city ownership tests, and `npm run build`. Negative fixtures cover unapproved bytes, unreviewed bundles, unknown cities, traversal/junction escapes, altered media, source binding, global aliases, duplicate items, and existing-file tampering.

This adapter completes reviewed admission bundle to application import. Source discovery, downloading/preparation, independent admission decisions, runtime review, and publication remain separate. A collector-to-admission ingestion demonstration is not claimed here. Importing a few clips does not satisfy the full-mosaic distinct-recording target. Physical views and explicitly authorized same-camera events are counted separately; ordinary crop/time-offset variants never add identity.
