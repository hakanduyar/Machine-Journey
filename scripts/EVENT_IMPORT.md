# Reviewed event batches

The event-batch path is restricted to the authorized Butlerville exception. A new recording keeps its existing physical-camera identity and a separately reviewed event identity; other cities remain strict. It does not turn a different cut, crop or time offset into another event.

`node scripts/import-event-batch.mjs BUNDLE APPROVED_MANIFEST_SHA ACCEPTED_BASELINE_JSON [--apply]` defaults to dry-run. The exact accepted baseline must match the hash in the reviewed admission manifest. The importer verifies current registry identities, accepted media bytes, source-camera binding, original/event/derivative aliases, recording overlap, comparator coverage and all incoming assets. Unknown private metadata is excluded by an explicit public projection.

An exact repeat against the original baseline writes nothing. Presenting an accepted event as new against the updated baseline is rejected. Future batches need a reconciled accepted-event baseline and independent source/media review. Atomic catalog append and rollback do not constitute runtime or publication approval. The historical single-event importer is retained unchanged.
