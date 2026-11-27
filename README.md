# Machine Journey

[Open the demo](https://hakanduyar.github.io/Machine-Journey/)

A Person of Interest-inspired interactive archive of recorded city views, explored through a camera mosaic, globe, floating field and neural scene. Each gesture completes one transition and holds until the next gesture. Back navigation revisits recorded stops.

This is an unofficial, authored visual interface. Videos are licensed **recorded excerpts**, not live surveillance. Globe routes, lights and companion panels are decorative; they do not represent real monitoring, identities or network activity. Person and vehicle markers on a small subset of recordings follow reviewed, source-bound annotations.

## Run locally

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3342/. For a production build:

```sh
npm test
npm run build
npm run preview
```

The optional browser continuity check uses an installed Edge or Chrome:

```sh
npm run test:e2e -- http://127.0.0.1:3342/
```

## Explore

Wheel down/right, ArrowRight, Enter, Space, or swipe up/left moves forward. Wheel up/left, ArrowLeft, or swipe down/right revisits the previous stop. A gesture completes one leg; nothing advances automatically from a settled view.

The globe has 24 destinations. Twenty-one use separate city-labelled stock clips; Savannah, Butlerville and Palmdale use officially documented source recordings. Stock locations follow contributor/platform metadata and visual review, rather than independently verified camera coordinates. Globe points are city/locality overview positions, never camera GPS.

City videos load on demand. The active city now stays consistent across the mosaic, floating field and neural scene, including background cameras; Back and Redo restore the recorded city and feed choices. Animated companion panels show fictional dossiers, documents and audio-style graphics without claiming real analysis of the footage.

The city catalog contains **100 distinct views and 109 recordings**. Butlerville has 21 reviewed views and nine separately reviewed, genuinely different events, giving it 30 recordings. A distinct view is a reviewed camera composition, not necessarily a different physical device: two G505 recordings have independently reviewed different sightlines. The nine event recordings do not add views. Tokyo has seven recordings, including CC BY-SA 4.0 moat-and-road-bridge and river timelapses. Paris has nine recordings. New York has 23 recordings. Reykjavík, Cairo, Johannesburg and Lagos still have one each. Some archive views are timelapses or stationary pans, identified in their credits.

Fresh globe destinations use a seeded shuffle cycle across the 24 cities. Floating and neural visits vary in length, capped by the city's available distinct recordings. Back and Redo preserve their original choices. The local half of a globe-to-camera approach accelerates toward the pane; its reverse contracts quickly before returning to the normal global leg.

Fifteen feeds carry 39 anonymous person tracks over reviewed time ranges. Person markers default to off-white; selected authored roles use muted yellow without implying identity or threat. Seven further feeds carry one aircraft or vehicle target each: compact green aircraft triangles and white vehicle squares. Markers follow video time in mosaic/selected panes and floating/neural screens. Reviewed edge targets retain their source centre and clip at the viewport; fixed foreground masks hide vehicle markers behind pillars or buildings. Person-specific timed cutouts preserve separate visibility around railings, walls and doorways. Coverage remains limited to selected subjects and reviewed intervals, not live detection, identity recognition or complete scene tracking. See [tracking scope](scripts/HEAD_TRACKING.md).

The default dense mosaic still repeats recordings. The optional ?catalog=unique diagnostic refuses to mount a city journey until every city can fill its whole mosaic with distinct admitted recordings; the current catalog remains insufficient. [Catalog expansion and full-mosaic uniqueness](https://github.com/hakanduyar/Machine-Journey/issues/6) remain open.

## Limits

Short clips repeat and may have visible loop transitions. All playback is silent. Browser gesture and media policies can delay playback. Dense video/WebGL scenes can be demanding on weaker devices. Desktop and emulated mobile viewports were reviewed; physical-phone validation is not claimed. This project makes no factual claims about the people or vehicles shown.

## Licence and provenance

Original application code, tests and authored scene assets are MIT-licensed; see [LICENSE](LICENSE). **Recorded footage is not covered by MIT.** Each media directory includes source, licence and modification details in `CREDITS.txt`: Pexels, Mixkit Free, MEVA CC BY 4.0, Wikimedia Commons CC BY-SA 4.0, or public-domain NASA/DVIDS material. The Tokyo Commons excerpt and its modifications remain CC BY-SA 4.0; retain the author, original source link, licence link and change notice. Preserve those terms and credits when reusing assets. Natural Earth geography is public domain; its provenance records are in `public/assets/globe/`.

See [asset provenance](public/assets/machine/ASSETS.md) and [release provenance](docs/RELEASE_PROVENANCE.md). The application is not affiliated with any production, dataset provider or footage contributor.

`npm run build:pages` prepares a static build for the repository subpath. See [manual demo release](docs/DEMO_RELEASE.md) for deployment setup and verification.

Known loop-quality limitations remain in the Paris-path, Istanbul-street and NYC yellow-cab excerpts, including visible final ghosted dissolves. Additional existing Paris-street, Mumbai, Nairobi, New York base, Moscow-avenue and Lagos derivatives have independently confirmed seam defects. Tracking annotations do not repair these videos; edit-policy cutoffs suppress markers during uncertain transitions without claiming that a subject physically exited.
