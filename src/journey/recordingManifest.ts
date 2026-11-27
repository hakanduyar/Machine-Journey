import eventRows from '../../public/media/city-event-sources.json';
/**
 * Canonical curated recording manifest: legacy city-owned core/base views plus reviewed additional media rows.
 *
 * Three DISTINCT concepts per entry (see recordingIdentity.ts):
 * - reviewedView.viewId   curated camera/view identity (table below), accepted visually in R47/R49/R50. NOT derived from hashes,
 *                         feed ids, source pages or crops. A later recording of the same camera keeps the same view id.
 * - originalAssetKey      source-backed key of the ORIGINAL file (publisher item + file / declared original hash).
 * - feedId                the existing ALL_FEEDS element that plays it (binding, diagnostics only).
 *
 * No hash or source evidence is invented: `originalSha256` is only the manifest's declared ORIGINAL hash (never a loop/poster
 * hash); core clips whose originals have no declared hash carry none. Held/unassigned MEVA cameras are deliberately absent.
 */
import baseRows from '../../public/media/city-sources.json';
import extraRows from '../../public/media/city-sources-extra.json';
import type { RecordingCandidate } from './recordingIdentity';

/** Concise public review-version identifier (no paths): visual acceptance rounds R47 (core), R49 (base), R50 (additional). */
export const REVIEW_REF = 'visual-accept-r47-r50';

/** Curated view id per playable feed (explicit table; the single place a view's identity is decided). */
const LEGACY_VIEW_OF_FEED: Readonly<Record<string, string>> = {
  // core, city-owned
  m01: 'butlerville-meva-g326', m02: 'butlerville-meva-g341', m06: 'butlerville-meva-g328', 'parking-walk': 'butlerville-meva-g424',
  m03: 'butlerville-meva-g301-dock', m07: 'butlerville-meva-g639-passage', 'covered-road': 'butlerville-meva-g505-canopy-roadside',
  'parked-c130': 'savannah-c130-engine-check', 'palmdale-dc8': 'palmdale-dc8-rollout-apron',
  // base stock clips
  'city-paris': 'paris-calm-street', 'city-new-york': 'new-york-busy-street', 'city-los-angeles': 'los-angeles-streets',
  'city-reykjavik': 'reykjavik-dusk-street', 'city-cairo': 'cairo-skyline-pan', 'city-nairobi': 'nairobi-town',
  'city-mumbai': 'mumbai-urban-traffic', 'city-tokyo': 'tokyo-shibuya-aerial', 'city-sydney': 'sydney-harbour-night',
  'city-sao-paulo': 'sao-paulo-traffic-aerial', 'city-mexico-city': 'mexico-city-rooftop', 'city-moscow': 'moscow-road-traffic',
  'city-singapore': 'singapore-skyline-night', 'city-johannesburg': 'johannesburg-aerial', 'city-buenos-aires': 'buenos-aires-obelisco',
  'city-dubai': 'dubai-highway-timelapse', 'city-vancouver': 'vancouver-clouds-haze', 'city-lagos': 'lagos-yaba-aerial',
  'city-istanbul': 'istanbul-ferry-port', 'city-auckland': 'auckland-downtown-traffic', 'city-rome': 'rome-colosseum',
  // approved additional clips
  'city-auckland-additional': 'auckland-tower-construction', 'city-dubai-additional': 'dubai-modern-city-timelapse',
  'city-istanbul-canal': 'istanbul-canal-ferry', 'city-istanbul-street': 'istanbul-informal-street',
  'city-paris-street': 'paris-european-buildings', 'city-paris-river': 'paris-notre-dame-surroundings',
  'city-paris-path': 'paris-pedestrian-path', 'city-paris-eiffel': 'paris-eiffel-tower',
  'city-moscow-night': 'moscow-night-traffic', 'city-moscow-avenue': 'moscow-night-avenue',
  'city-los-angeles-additional': 'los-angeles-night-deck', 'city-mexico-city-additional': 'mexico-city-cathedral',
  'city-tokyo-additional': 'tokyo-night-street', 'city-new-york-additional': 'new-york-times-square',
  'city-mumbai-additional': 'mumbai-highway', 'city-sydney-additional': 'sydney-bridge-clouds',
  'city-buenos-aires-additional': 'buenos-aires-obelisk-life', 'city-vancouver-additional': 'vancouver-buildings',
  'city-rome-additional': 'rome-square', 'city-singapore-additional': 'singapore-landmarks',
  'city-nairobi-additional': 'nairobi-street-timelapse', 'city-savannah-additional': 'savannah-hurricane-evac',
  'city-palmdale-additional': 'palmdale-preflight-instrument-cabin', 'city-sao-paulo-additional': 'sao-paulo-timelapse',
  'city-paris-arc-4025': 'paris-arc-rooftop-wide-day', 'city-paris-arc-4179': 'paris-arc-ground-oblique-night',
  'city-new-york-4086': 'new-york-brooklyn-bridge-traffic', 'city-new-york-4272': 'new-york-intersection-traffic-light',
  'city-new-york-4338': 'new-york-manhattan-junction-night',
  'city-butlerville-stairwell': 'meva-mutc-g419', 'city-butlerville-classroom': 'meva-mutc-g508', 'city-butlerville-courtyard': 'meva-mutc-g638',
  'city-butlerville-bus-interior': 'meva-mutc-g331', 'city-new-york-pexels-13418064': 'new-york-flatiron-traffic-pedestrians',
  'city-new-york-pexels-14306101': 'new-york-brooklyn-waterfront', 'city-new-york-pexels-34118767': 'new-york-lincoln-tunnel-approach',
  'city-paris-night-intersection': 'pexels-12329724', 'city-new-york-pexels-5688094': 'new-york-elevated-waterfront-park-night',
  'city-sydney-highway-night': 'sydney-elevated-highway-night',
  'city-mexico-city-pexels-28710088': 'mexico-city-reforma-avenue-traffic',
  'city-butlerville-gym-reverse': 'meva-mutc-g299', 'city-butlerville-stair-corridor': 'meva-mutc-g329',
  'city-butlerville-roadside': 'meva-mutc-g340', 'city-butlerville-upper-stairwell': 'meva-mutc-g420',
  'city-tokyo-mixkit-4383': 'tokyo-rainbow-bridge-night-overlook',
  'city-tokyo-mixkit-4309': 'tokyo-tower-skyline-day-overlook',
  'city-tokyo-mixkit-4445': 'tokyo-industrial-container-yard-overlook',
  'city-new-york-pexels-5636797': 'new-york-brooklyn-bridge-park-promenade-bridge-night',
  'city-new-york-pexels-4970648': 'new-york-lower-manhattan-skyline-waterfront-promenade-day',
  'city-new-york-pexels-4793612': 'new-york-manhattan-bridge-east-river-rocks-day',
  'city-new-york-pexels-9994126': 'new-york-lower-manhattan-high-rise-hudson-sunset',
  'city-new-york-pexels-5123483': 'new-york-east-river-water-level-manhattan-brooklyn-bridges',
  // R51 Butlerville batch (G507, G336 and G506 are on HOLD and deliberately absent)
  m04: 'butlerville-meva-g436-road-junction', m05: 'butlerville-meva-g330-gymnasium',
  'city-butlerville-school-hall': 'butlerville-meva-g423-school-hall', 'city-butlerville-cafe': 'butlerville-meva-g421-cafe',
};

/** New reviewed bundles carry their view identity in data; legacy identities stay immutable. */
export function mergeReviewedViews(legacy: Readonly<Record<string,string>>, rows: readonly {feedId:string; reviewedViewId?:string; reviewRef?:string}[]): Readonly<Record<string,string>> {
  const out: Record<string,string> = {...legacy};
  for(const row of rows) {
    if(row.reviewedViewId) {
      if(!row.reviewRef || (out[row.feedId] && out[row.feedId] !== row.reviewedViewId)) throw new Error('Conflicting or unreviewed view: '+row.feedId);
      out[row.feedId] = row.reviewedViewId;
    } else if(!out[row.feedId]) throw new Error('Missing reviewed view: '+row.feedId);
  }
  if(new Set(Object.values(out)).size !== Object.keys(out).length) throw new Error('Duplicate physical view identity');
  return Object.freeze(out);
}
export const VIEW_OF_FEED = mergeReviewedViews(LEGACY_VIEW_OF_FEED, extraRows);

interface Row { cityId: string; feedId: string; source: string; originalSha256?: string; originalAssetUrl?: string; originalAssetKey?: string; reviewRef?: string }

const PUBLISHERS: Readonly<Record<string, string>> = {
  'mevadata-public-01.s3.amazonaws.com': 'MEVA', 'mixkit.co': 'Mixkit', 'pexels.com': 'Pexels', 'dvidshub.net': 'DVIDS', 'svs.gsfc.nasa.gov': 'NASA SVS',
};
const publisherOf = (url: string): string => {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return PUBLISHERS[host] ?? host;
};

/**
 * Original-asset keys that are NOT simply "one file per publisher page". NASA SVS 12488 is ONE public page holding different
 * original files: the core Palmdale DC-8 clip comes from RollOut_Taxi_7.webm (named in its CREDITS), the additional clip from
 * PreFlight_cont_8.webm (file name supplied by the curator; the repo declares only its original SHA-256). The page alone never
 * identifies an original.
 */
const NASA_PAGE = 'https://svs.gsfc.nasa.gov/12488/';
const ASSET_KEY_OVERRIDE: Readonly<Record<string, string>> = {
  'city-palmdale-additional': 'nasa-svs-12488/PreFlight_cont_8.webm',
};

const stock = (r: Row): RecordingCandidate => ({
  cityId: r.cityId,
  feedId: r.feedId,
  // Rows that carry their own review ref / downloaded original-rendition URL (R51 Paris) keep them; older rows use the shared ref and page URL.
  reviewedView: { viewId: VIEW_OF_FEED[r.feedId], reviewRef: r.reviewRef ?? REVIEW_REF },
  originalAssetKey: ASSET_KEY_OVERRIDE[r.feedId] ?? r.originalAssetKey ?? r.originalAssetUrl ?? r.source,
  ...(r.originalAssetUrl ? { originalAssetUrl: r.originalAssetUrl } : {}),
  ...(r.originalSha256 ? { originalSha256: r.originalSha256 } : {}),
  provenance: { publisher: publisherOf(r.source), sourceUrl: r.source, publisherItemKey: r.source },
});

const MEVA_BASE = 'https://mevadata-public-01.s3.amazonaws.com/';
/** `path` is relative to the bucket root (its first segment is the MEVA drop). Original keys/URLs name the full source .avi, never a loop. */
const meva = (feedId: string, path: string, extra: { reviewRef?: string; originalSha256?: string } = {}): RecordingCandidate => ({
  cityId: 'butlerville',
  feedId,
  reviewedView: { viewId: VIEW_OF_FEED[feedId], reviewRef: extra.reviewRef ?? REVIEW_REF },
  originalAssetKey: `meva/${path.split('/').pop()}`,
  originalAssetUrl: MEVA_BASE + path,
  ...(extra.originalSha256 ? { originalSha256: extra.originalSha256 } : {}),
  provenance: { publisher: 'MEVA', sourceUrl: 'https://mevadata.org/', publisherItemKey: `meva-${path.split('/')[0]}` },
});

/** The original city-owned core clips (provenance per their CREDITS; loop hashes are derivatives and deliberately unused). Two more MEVA views, G423 and G421, come from the extra manifest; G507 is on hold. */
const CORE: readonly RecordingCandidate[] = [
  meva('m01', 'drops-123-r13/2018-03-09/10/2018-03-09.10-10-01.10-15-01.admin.G326.r13.avi'),
  meva('m02', 'drops-123-r13/2018-03-15/16/2018-03-15.15-55-06.16-00-06.hospital.G341.r13.avi'),
  meva('m06', 'drops-123-r13/2018-03-13/17/2018-03-13.17-35-00.17-40-00.school.G328.r13.avi'),
  meva('parking-walk', 'drops-123-r13/2018-03-09/10/2018-03-09.10-10-00.10-15-00.school.G424.r13.avi'),
  meva('m03', 'drop-5-mevid/2018-05-16.18-20-00.18-25-00.hospital.G301.r13.avi'),
  meva('m07', 'drop-5-mevid/2018-05-16.14-25-01.14-30-01.school.G639.r13.avi'),
  meva('covered-road', 'drop-5-mevid/2018-05-18.14-25-00.14-30-00.bus.G505.r13.avi'),
  // Repaired loops (R51): the view is admitted ONCE; the repaired bytes are a derivative, never a second view. originalSha256 = source .avi.
  meva('m04', 'drop-5-mevid/2018-05-18.15-15-07.15-20-07.hospital.G436.r13.avi', { reviewRef: 'visual-r51-butlerville-g436', originalSha256: '73642DDB31E22A4D903E021A0A30F145FD1874C0D1D4B0F9D6A2F8CF0C2579CE' }),
  meva('m05', 'drop-5-mevid/2018-05-18.12-15-00.12-20-00.school.G330.r13.avi', { reviewRef: 'visual-r51-butlerville-g330', originalSha256: 'BA6CED055FE46655972C3E771DE09712C41E1E1BD3128FF23F6D94F6697ED9C4' }),
  {
    cityId: 'savannah', feedId: 'parked-c130',
    reviewedView: { viewId: VIEW_OF_FEED['parked-c130'], reviewRef: REVIEW_REF },
    originalAssetKey: 'dvids-554984/DOD_104910980-1024x576-1769k.mp4',
    originalAssetUrl: 'https://d34w7g4gy10iej.cloudfront.net/video/1709/DOD_104910980/DOD_104910980-1024x576-1769k.mp4',
    provenance: { publisher: 'DVIDS', sourceUrl: 'https://www.dvidshub.net/video/554984/c-130-engine-check', publisherItemKey: 'https://www.dvidshub.net/video/554984/c-130-engine-check' },
  },
  {
    cityId: 'palmdale', feedId: 'palmdale-dc8',
    reviewedView: { viewId: VIEW_OF_FEED['palmdale-dc8'], reviewRef: REVIEW_REF },
    originalAssetKey: 'nasa-svs-12488/RollOut_Taxi_7.webm',
    originalAssetUrl: 'https://svs.gsfc.nasa.gov/vis/a010000/a012400/a012488/RollOut_Taxi_7.webm',
    provenance: { publisher: 'NASA SVS', sourceUrl: NASA_PAGE, publisherItemKey: NASA_PAGE },
  },
];

/** All candidates: core first, then base and additional stock rows in manifest order. */
export const PHYSICAL_RECORDING_MANIFEST: readonly RecordingCandidate[] = [
  ...CORE,
  ...(baseRows as readonly Row[]).map(stock),
  ...(extraRows as readonly Row[]).map(stock),
];

/** Source-backed candidates owned by one city (explicit ownership filter; never another city's). */
export const manifestCandidatesFor = (cityId: string): RecordingCandidate[] => RECORDING_MANIFEST.filter((c) => c.cityId === cityId);

interface EventRow extends Row { physicalCameraId: string; eventId: string; eventEquivalenceKey: string; authorization: { decisionSha256: string }; reviewRef: string }
const eventCandidate = (r: EventRow): RecordingCandidate => ({
 cityId: r.cityId, feedId: r.feedId,
 reviewedView: { viewId: r.physicalCameraId, reviewRef: r.reviewRef },
 reviewedEvent: { eventId: r.eventId, equivalenceKey: r.eventEquivalenceKey, decisionSha256: r.authorization.decisionSha256, reviewRef: r.reviewRef },
 originalAssetKey: r.originalAssetKey!, originalAssetUrl: r.originalAssetUrl, originalSha256: r.originalSha256,
 provenance: { publisher: 'MEVA', sourceUrl: r.source },
});
export const RECORDING_MANIFEST: readonly RecordingCandidate[] = [...PHYSICAL_RECORDING_MANIFEST, ...(eventRows as EventRow[]).map(eventCandidate)];
export const RECORDING_COUNTS = { physicalViews: new Set(PHYSICAL_RECORDING_MANIFEST.map(c => c.cityId + '/' + c.reviewedView!.viewId)).size, recordings: RECORDING_MANIFEST.length, eventRecordings: eventRows.length };
