# Reviewed event batches

The event-batch path is restricted to the authorized Butlerville exception. A new recording keeps its existing physical-camera identity and a separately reviewed event identity; other cities remain strict. It does not turn a different cut, crop or time offset into another event.

`node scripts/import-event-batch.mjs BUNDLE APPROVED_MANIFEST_SHA ACCEPTED_BASELINE_JSON [--apply]` defaults to dry-run. The exact accepted baseline must match the hash in the reviewed admission manifest. The importer verifies current registry identities, accepted media bytes, source-camera binding, original/event/derivative aliases, recording overlap, comparator coverage and all incoming assets. Unknown private metadata is excluded by an explicit public projection.

An exact repeat against the original baseline writes nothing. Presenting an accepted event as new against the updated baseline is rejected. Future batches need a reconciled accepted-event baseline and independent source/media review. Atomic catalog append and rollback do not constitute runtime or publication approval. The historical single-event importer is retained unchanged.

## Explicit reviewed same-original occurrences (schema5)

Schema5 is an additive policy path; schema3/4 still reject repeated originals. Only independently approved occurrences registered in `src/journey/reviewedOccurrences.json` qualify. The registry binds source URL/ID/SHA, city/camera, native frame interval, derivative hashes, accepted baseline, complete same-original comparators and separate semantic/policy review receipts. Its initial entry is the reviewed G419 ascent; it is not itself an imported recording. Future entries require audited independent review, not changes to the validation algorithm. A new interval/name/crop/encode or an arbitrary SHA-shaped review cannot grant approval.

The shared admission/runtime validator preserves original provenance and checks exact registry proof, source frame/trim agreement, every same-original comparator and a positive gap. Schema4's recomputed proof against **all** overlapping recordings is also mandatory. Only those proved original-evidence collisions are exempted; event/equivalence/derivative replay, source mismatch, incomplete comparisons and incoming overlap still fail. Runtime validates each collided member before allowing separate event tiles on the same physical view. Physical-view count does not increase.

The command uses Node 22.18+ native TypeScript loading for the shared pure validator. Code approval, media import, runtime review and publication remain separate gates. Relevant checks are `node --test scripts/import-event-batch.test.mjs`, the recording identity/event/manifest tests, and the normal build.
