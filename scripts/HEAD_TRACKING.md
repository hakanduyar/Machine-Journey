# Source-bound tracking annotations

Eight feeds carry 18 anonymous person tracks over reviewed ranges: m01, m02, m03, m06, m07, parking-walk, school-hall and one G340 event. Five further feeds carry one object target each: parked C130, Palmdale DC8, covered-road SUV, G341 SUV and G328 bus. These are authored display annotations, not identity or behavioural classification. Coverage is not complete for every subject or recording.

The shared DOM/WebGL renderer samples video.currentTime, preserves normalized source coordinates through aspect crop, and hides during seeks until a decoded frame is available. It never extrapolates through wrap or invisible keys. Default head interpolation gap remains 1.05 seconds; explicitly reviewed sparse spans are bounded exceptions. New source-measured vehicle tracks use at most one second between keys. No detector, video upload, extra decoder or per-frame React state update is introduced.

A head or object target centre may lie outside the source viewport only while its square overlaps it. The renderer clips the original geometry rather than recentering onto the visible fragment. Invisible source nulls remain invisible. Foreground pillar/building polygons are manually measured masks shared by DOM and WebGL, not inferred depth or segmentation.

The G340 head passage uses native PTS and source-frame measurements from 14.917 to 24.5 seconds, including partially visible entry and exit. Partial anatomical estimates have approximately six-pixel uncertainty. The SUV/bus targets preserve one central cabin or front-window region; a remaining bumper or rear body does not move that target. Partial vehicle estimates have approximately ten-pixel uncertainty. Source JSON retains source hashes, frame hashes, timing, measurement basis and review hashes.

Aircraft markers are compact green dashed upright triangles. Vehicle and person markers are white dashed squares with corner ticks. Marker size and placement are authored interpretations reviewed against source footage; no actual flight identifier or threat classification is fabricated.

`node scripts/import-head-tracks.mjs INPUT_PACKET OUTPUT_JSON` verifies exact source and annotation SHA256 before offline conversion. Exact repeat writes nothing; conflicting output fails closed. Changed video bytes or timing require newly bound annotations and review. Video binding is checked offline, not by an extra full-video fetch at runtime.

Desktop and emulated viewport alignment, decoded seeks, clipping, nulls, wrap and normal navigation were sampled independently. Tiny projected GL marks limit fine alignment assessment. This is not per-frame accuracy certification, all-camera tracking or physical-phone certification. Unannotated recordings remain untracked.
