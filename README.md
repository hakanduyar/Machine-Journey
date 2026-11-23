# Machine Journey

[Open the demo](https://hakanduyar.github.io/Machine-Journey/)

A Person of Interest-inspired interactive archive of recorded city views, explored through a camera mosaic, globe, floating field and neural scene. Each gesture completes one transition and holds until the next gesture. Back navigation revisits recorded stops.

This is an unofficial, authored visual interface. Videos are licensed **recorded excerpts**, not live surveillance. Globe routes, lights and interface annotations are decorative; they do not represent real monitoring, identities or network activity.

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

Twenty-four additional licensed recordings expand the city pools. Reykjavík, Cairo, Johannesburg and Lagos still have one accepted recording each; additional clips for those four cities remain a follow-up. Some archive views are timelapses or stationary pans, identified in their credits.

## Limits

Short clips repeat and may have visible loop transitions. All playback is silent. Browser gesture and media policies can delay playback. Dense video/WebGL scenes can be demanding on weaker devices. Desktop and emulated mobile viewports were reviewed; physical-phone validation is not claimed. This project makes no factual claims about the people or vehicles shown.

## Licence and provenance

Original application code, tests and authored scene assets are MIT-licensed; see [LICENSE](LICENSE). **Recorded footage is not covered by MIT.** Each media directory includes source, licence and modification details in `CREDITS.txt`: Pexels, Mixkit Free, MEVA CC BY 4.0, or public-domain NASA/DVIDS material. Preserve those terms and credits when reusing assets. Natural Earth geography is public domain; its provenance records are in `public/assets/globe/`.

See [asset provenance](public/assets/machine/ASSETS.md) and [release provenance](docs/RELEASE_PROVENANCE.md). The application is not affiliated with any production, dataset provider or footage contributor.

`npm run build:pages` prepares a static build for the repository subpath. See [manual demo release](docs/DEMO_RELEASE.md) for deployment setup and verification.
