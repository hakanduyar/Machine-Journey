// SYNTHETIC fixture entry (test server only). Renders the REAL UniqueCatalogBoundary + Journey with an injected, clearly synthetic
// source: only Butlerville (19 real feeds + synthetic aliases appended by plugin.mjs). Views are labelled SYNTHETIC-FIXTURE.
import { createRoot } from 'react-dom/client';
import { UniqueCatalogBoundary } from '../../../src/UniqueCatalogBoundary';
import { CITIES } from '../../../src/journey/globe';
import { ALL_FEEDS } from '../../../src/journey/feeds';
import type { RecordingCandidate } from '../../../src/journey/recordingIdentity';
import '../../../src/styles.css';

const butler = CITIES.find((c) => c.id === 'butlerville')!;
const owned = butler.feedIds ?? [];
// View ids are zero-padded by feed order so any prefix of one source is a prefix of the other (stable tile identities).
const make = (n: number) => ({
  cities: [butler],
  feedIds: ALL_FEEDS.map((f) => f.id),
  candidates: owned.slice(0, n).map((feedId, i): RecordingCandidate => ({
    cityId: 'butlerville',
    feedId,
    reviewedView: { viewId: `fixture-view-${String(i).padStart(3, '0')}-${feedId}`, reviewRef: 'SYNTHETIC-FIXTURE' },
    originalAssetKey: `synthetic:${feedId}`,
    provenance: { publisher: 'SYNTHETIC FIXTURE', sourceUrl: `https://fixture.invalid/${feedId}` },
  })),
});
const SOURCES = { sufficient: make(owned.length), deficient: make(60) };
type Name = keyof typeof SOURCES;

const root = createRoot(document.getElementById('root')!);
const render = (name: Name) => root.render(<UniqueCatalogBoundary source={SOURCES[name]} />);
(window as unknown as { __fixture: unknown }).__fixture = { setSource: render, owned: owned.length };
render((new URLSearchParams(location.search).get('src') as Name) in SOURCES ? (new URLSearchParams(location.search).get('src') as Name) : 'sufficient');
