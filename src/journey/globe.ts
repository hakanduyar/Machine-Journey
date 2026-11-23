import { clamp, easeInOut } from './geometry';

/**
 * Globe excursion data + pure math (no DOM). Everything here is authored for this
 * prototype and is described honestly in the README:
 *  - `LAND` / `WATER` are hand-authored, heavily simplified outlines (lon, lat in degrees),
 *    not survey data and not taken from any licensed dataset.
 *  - `CITIES` are globe destinations. Each opens ONLY its own local clip: the entries carrying `verified`
 *    (Savannah, Butlerville, Palmdale) open the officially documented source feeds of that place; each of the other 21
 *    opens its own stock-archive clip (`city-<id>`, see cityFeeds.ts / public/media/city-sources.json) whose place is named
 *    by the stock publisher / contributor, visually screened and NOT an official or GPS-verified camera location.
 *    A globe marker is a locality overview point, never a camera position.
 *  - `ARCS` are decorative great-circle lines, not real network or traffic data.
 */
/**
 * Provenance of a VERIFIED place: the footage really originates there (official source, see README / CREDITS). The point is
 * a general city / locality overview position (see `coordSource`), never a camera or site GPS.
 */
export interface VerifiedPlace {
  /** Compact HUD label of the real source place. */
  label: string;
  /** Short source tag shown next to it. */
  source: string;
  url: string;
  coordSource: string;
  /** Honest limit of the claim, e.g. that the exact camera position is unverified. */
  note: string;
}

export interface City {
  id: string;
  name: string;
  country: string;
  lon: number;
  lat: number;
  /** The one local feed this city opens: its own stock-archive clip, or (verified places) a feed officially recorded there. */
  feedId: string;
  /** Verified places only: every feed that really belongs there (entering picks one; never any other feed). */
  feedIds?: readonly string[];
  /** Present only where the source place is officially documented; absent = stock-publisher-named place (not an official location). */
  verified?: VerifiedPlace;
}

export const CITIES: readonly City[] = [
  // R49 C: each of these 21 cities opens ONLY its own stock-archive clip `city-<id>` (never a shared / generic feed). The
  // place is named by the stock publisher; it is not an official camera location (see cityFeeds.ts).
  { id: 'paris', name: 'Paris', country: 'France', lon: 2.35, lat: 48.86, feedId: 'city-paris' },
  { id: 'new-york', name: 'New York', country: 'USA', lon: -74.0, lat: 40.71, feedId: 'city-new-york' },
  { id: 'los-angeles', name: 'Los Angeles', country: 'USA', lon: -118.24, lat: 34.05, feedId: 'city-los-angeles' },
  { id: 'reykjavik', name: 'Reykjavik', country: 'Iceland', lon: -21.9, lat: 64.15, feedId: 'city-reykjavik' },
  { id: 'cairo', name: 'Cairo', country: 'Egypt', lon: 31.24, lat: 30.04, feedId: 'city-cairo' },
  { id: 'nairobi', name: 'Nairobi', country: 'Kenya', lon: 36.82, lat: -1.29, feedId: 'city-nairobi' },
  { id: 'mumbai', name: 'Mumbai', country: 'India', lon: 72.88, lat: 19.08, feedId: 'city-mumbai' },
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', lon: 139.69, lat: 35.68, feedId: 'city-tokyo' },
  { id: 'sydney', name: 'Sydney', country: 'Australia', lon: 151.21, lat: -33.87, feedId: 'city-sydney' },
  { id: 'sao-paulo', name: 'Sao Paulo', country: 'Brazil', lon: -46.63, lat: -23.55, feedId: 'city-sao-paulo' },
  { id: 'mexico-city', name: 'Mexico City', country: 'Mexico', lon: -99.13, lat: 19.43, feedId: 'city-mexico-city' },
  { id: 'moscow', name: 'Moscow', country: 'Russia', lon: 37.62, lat: 55.75, feedId: 'city-moscow' },
  { id: 'singapore', name: 'Singapore', country: 'Singapore', lon: 103.82, lat: 1.35, feedId: 'city-singapore' },
  { id: 'johannesburg', name: 'Johannesburg', country: 'South Africa', lon: 28.05, lat: -26.2, feedId: 'city-johannesburg' },
  { id: 'buenos-aires', name: 'Buenos Aires', country: 'Argentina', lon: -58.38, lat: -34.6, feedId: 'city-buenos-aires' },
  { id: 'dubai', name: 'Dubai', country: 'UAE', lon: 55.27, lat: 25.2, feedId: 'city-dubai' },
  { id: 'vancouver', name: 'Vancouver', country: 'Canada', lon: -123.12, lat: 49.28, feedId: 'city-vancouver' },
  { id: 'lagos', name: 'Lagos', country: 'Nigeria', lon: 3.38, lat: 6.52, feedId: 'city-lagos' },
  { id: 'istanbul', name: 'Istanbul', country: 'Turkey', lon: 28.98, lat: 41.01, feedId: 'city-istanbul' },
  { id: 'auckland', name: 'Auckland', country: 'New Zealand', lon: 174.76, lat: -36.85, feedId: 'city-auckland' },
  { id: 'rome', name: 'Rome', country: 'Italy', lon: 12.5, lat: 41.9, feedId: 'city-rome' },
  // R47. VERIFIED source places (appended; the demo cities above keep their ids, order and feeds). Each opens ONLY feeds that
  // really belong to it. Coordinates are general locality overview points, NOT camera or site GPS.
  {
    id: 'savannah', name: 'Savannah', country: 'USA', lon: -81.109995, lat: 32.021106, feedId: 'parked-c130', feedIds: ['parked-c130'],
    verified: {
      label: 'SAVANNAH, GEORGIA', source: 'DVIDS 554984', url: 'https://www.dvidshub.net/video/554984/c-130-engine-check',
      coordSource: 'Natural Earth populated place (city overview point)', note: 'Clip filmed in Savannah, Georgia (official DVIDS record); exact spot not stated.',
    },
  },
  {
    id: 'butlerville', name: 'Butlerville', country: 'USA', lon: -85.51, lat: 39.03, feedId: 'm01', feedIds: ['m01', 'm02', 'm06', 'parking-walk'],
    verified: {
      label: 'MUSCATATUCK TRAINING CENTER · BUTLERVILLE, INDIANA', source: 'MEVA collection', url: 'https://www.in.gov/indiana-national-guard/muscatatuck-training-center/contact-mutc/',
      coordSource: 'US Census TIGERweb 2020 CDP centroid (Butlerville, Indiana; locality overview, not site GPS)',
      note: 'Source collection site (official MEVA); the exact camera position is not verified, and this is not Indianapolis.',
    },
  },
  {
    id: 'palmdale', name: 'Palmdale', country: 'USA', lon: -118.11, lat: 34.59, feedId: 'palmdale-dc8', feedIds: ['palmdale-dc8'],
    verified: {
      label: 'PALMDALE, CALIFORNIA', source: 'NASA SVS 12488', url: 'https://svs.gsfc.nasa.gov/12488/',
      coordSource: 'US Census TIGERweb 2020 place centroid (Palmdale, California; city overview, not camera GPS)',
      note: 'Footage of the Palmdale DC-8 apron (official NASA SVS record); exact camera position not stated.',
    },
  },
];

export const cityById = (id: string) => CITIES.find((c) => c.id === id) ?? null;

/** Regional hubs: the cities whose links form the trunk of every visit's route bundles. */
export const HUBS: readonly string[] = ['new-york', 'paris', 'dubai', 'singapore', 'tokyo', 'sao-paulo', 'johannesburg', 'los-angeles'];

export type Arc = readonly [string, string];

const mix = (...n: number[]) => { let h = 0x9e3779b9; for (const v of n) { h = Math.imul(h ^ (v | 0), 0x85ebca6b); h ^= h >>> 13; } return h >>> 0; };
const hashStr = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * The decorative route bundles of ONE globe visit: a pure, deterministic function of (anchor city, visit key, seed), so a
 * visit looks the same every frame and when history returns to it, and nothing about it consumes shared RNG state.
 * Composition: the nearest regional hubs (2-3 of the nearest 4), spokes from the anchor to 2-3 nearby non-hub cities,
 * a short trunk chain between the chosen hubs, and one long-haul hub link: roughly 6-9 grouped bundles, never all pairs.
 * Different keys give different compositions, even for the same anchor.
 */
export function routeArcs(anchorId: string, key: number, seed = 0): Arc[] {
  const anchor = cityById(anchorId);
  if (!anchor) return [];
  const rnd = prng(mix(seed, key, hashStr(anchorId)));
  const dist = (id: string) => { const c = cityById(id)!; return angularDistance(anchor.lon, anchor.lat, c.lon, c.lat); };
  const pick = <T,>(list: T[], n: number): T[] => { const l = [...list]; const out: T[] = []; while (out.length < n && l.length) out.push(l.splice(Math.floor(rnd() * l.length), 1)[0]); return out; };
  const hubs = HUBS.filter((h) => h !== anchorId).sort((a, b) => dist(a) - dist(b));
  const hubSet = pick(hubs.slice(0, 4), 2 + (rnd() < 0.5 ? 1 : 0));
  const spokePool = CITIES.filter((c) => c.id !== anchorId && !HUBS.includes(c.id)).map((c) => c.id).sort((a, b) => dist(a) - dist(b)).slice(0, 7);
  const spokes = pick(spokePool, 2 + (rnd() < 0.5 ? 1 : 0));
  const arcs: Arc[] = [];
  const add = (a: string, b: string) => { if (a !== b && !arcs.some((x) => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a))) arcs.push([a, b]); };
  for (const h of hubSet) add(anchorId, h);
  for (const s of spokes) add(anchorId, s);
  for (let i = 1; i < hubSet.length; i++) add(hubSet[i - 1], hubSet[i]); // trunk chain between the chosen hubs
  const far = pick(hubs.slice(4), 1)[0]; // one long-haul link from the nearest chosen hub to a distant one
  if (far && hubSet[0]) add(hubSet[0], far);
  return arcs;
}

/** Stable string key of a route composition (cache key for the renderer). */
export const routeSig = (arcs: readonly Arc[]) => arcs.map((a) => `${a[0]}>${a[1]}`).join('|');

/** Decorative great-circle links between city ids. */
export const ARCS: readonly (readonly [string, string])[] = [
  ['paris', 'new-york'], ['paris', 'cairo'], ['paris', 'reykjavik'], ['paris', 'mumbai'],
  ['new-york', 'los-angeles'], ['new-york', 'sao-paulo'], ['los-angeles', 'tokyo'],
  ['tokyo', 'sydney'], ['cairo', 'nairobi'], ['mumbai', 'tokyo'],
  ['reykjavik', 'new-york'], ['cairo', 'mumbai'], ['nairobi', 'sao-paulo'], ['los-angeles', 'sydney'],
];

type Poly = readonly (readonly [number, number])[];

const EURASIA: Poly = [
  [-9, 37], [-9, 43.5], [-1.5, 43.5], [-4.5, 48.5], [-1, 49.5], [2, 51], [4.5, 52.5], [8, 54], [8.5, 57.5], [10.5, 57],
  [11, 54], [14, 54.3], [19, 54.5], [21, 57], [24, 59], [30, 60], [25, 60.5], [22, 60.5], [21.5, 63], [25, 65.5], [22, 65.8],
  [17, 61], [19, 59.5], [16, 56.5], [12.5, 56], [11, 59], [8, 58], [5, 59], [5, 62], [10, 64], [14, 67.5], [19, 70], [25, 71],
  [31, 70], [40, 67], [33, 66.5], [41, 66], [44, 68], [54, 68.5], [60, 69], [68, 69], [73, 72], [80, 73], [90, 75.5],
  [105, 77.5], [113, 74], [130, 71.5], [140, 72.5], [160, 70], [170, 70], [180, 68.5], [180, 65], [172, 60.5], [170, 60],
  [163, 62], [160, 61], [163, 57], [156, 51], [156, 57], [150, 59.5], [143, 59], [137, 54], [141, 53], [140, 48], [135, 43],
  [130, 42.5], [129.5, 41], [129.5, 37], [129, 35], [126.5, 34.5], [126.5, 37.5], [125, 39.5], [121.5, 39], [121.5, 40.8],
  [118, 39], [119, 37], [122.5, 37], [120, 35], [121.5, 32], [122, 30], [120, 26], [116, 23], [110, 21], [108, 21.5], [106, 19],
  [109, 15], [109, 12], [107, 10.5], [105, 8.7], [102, 12], [100.5, 13.5], [99.5, 10], [101, 6.5], [103.5, 4], [104, 1.4],
  [101, 2.8], [98.5, 8], [98.5, 12], [97.5, 16.5], [94.5, 16], [94, 19], [92, 21.5], [90, 22], [87, 21.5], [86.5, 20],
  [82, 16.5], [80, 15], [80, 10], [78, 8.5], [76.5, 9], [73.5, 16], [72.8, 21], [70, 21], [68, 23.5], [66.5, 25.3], [61.5, 25],
  [57, 25.8], [56.5, 27], [51, 28], [48.5, 30], [50, 26], [51.5, 24.5], [54, 24.2], [56, 26], [56.5, 24], [59.5, 22.5],
  [57, 19], [52, 16], [45, 12.8], [43, 13], [42.5, 16], [39, 21.5], [35, 28], [34.8, 29.5], [34, 31.5], [35.8, 34.5],
  [36, 36.5], [32, 36.2], [28, 36.8], [26.5, 38.5], [26.5, 40], [24, 40], [23, 38], [22, 36.5], [21, 39], [19.5, 40],
  [19.5, 41.5], [19, 42.2], [13.5, 45.7], [12.3, 45.3], [12.5, 44], [16, 41.8], [18.5, 40.2], [16, 38], [15.7, 38],
  [16, 39.5], [15.5, 40], [12, 41.5], [10.5, 43], [8.8, 44.4], [6.5, 43], [3, 43.2], [3, 42], [0, 40], [-0.5, 38.5],
  [-2, 36.8], [-5.5, 36], [-6.3, 36.7],
];

const AFRICA: Poly = [
  [-5.5, 36], [-2, 35.2], [3, 36.8], [10, 37.2], [11, 35], [10, 33.5], [15, 32.3], [20, 32], [20, 30.5], [25, 31.7], [32, 31.2],
  [32.5, 29.9], [35, 24], [37.2, 20.5], [39, 15.5], [43, 12.5], [44, 10.5], [51, 11.8], [51, 10.3], [48, 5], [42, -1], [40, -3],
  [39, -6], [40.5, -11], [40.5, -15], [37, -18], [35, -22], [32.5, -26], [32.5, -28.5], [30, -31], [27, -33.5], [23, -34],
  [19, -34.5], [18, -32], [14.5, -27], [12, -18], [13.5, -12], [12, -6], [9.5, -1], [9.5, 3.5], [6, 4.3], [3, 6.3], [-2, 5],
  [-7.5, 4.4], [-11, 6.5], [-13.5, 9.5], [-15, 11.5], [-17, 14.7], [-16, 19], [-17, 21], [-13, 27.5], [-10, 30], [-9.5, 32.5],
  [-6.5, 34],
];

const NORTH_AMERICA: Poly = [
  [-168, 65.5], [-162, 70], [-156, 71.3], [-141, 69.7], [-128, 70], [-115, 68], [-108, 68.5], [-95, 71.5], [-94, 69], [-85, 69.5],
  [-82, 67], [-86, 66], [-93, 62], [-94, 59], [-90, 57], [-82, 55], [-79.5, 51.5], [-78.5, 56], [-77, 60], [-72, 61.5],
  [-65, 60.5], [-61, 56], [-57, 53], [-60, 50.2], [-66, 50], [-70, 47.5], [-64, 48.5], [-65, 45.5], [-67, 44.8], [-70, 43.7],
  [-70.5, 41.8], [-74, 40.5], [-76, 38], [-75.5, 35.3], [-78, 33.8], [-81, 31.5], [-80, 27], [-80.2, 25.2], [-81.8, 26.2],
  [-82.8, 28.5], [-84, 30], [-86.5, 30.3], [-89, 30.3], [-90, 29], [-93.5, 29.7], [-97, 27.8], [-97.5, 24.5], [-97.8, 22],
  [-96, 19], [-94.5, 18.2], [-91, 18.7], [-90.5, 21], [-87, 21.5], [-87.5, 18], [-88.2, 16], [-84, 15.8], [-83.3, 12],
  [-83.7, 10.5], [-81.5, 8.8], [-79.5, 9.5], [-77.5, 8.7], [-78, 7.2], [-80, 7.5], [-82.5, 8.2], [-85.7, 10], [-87.5, 13],
  [-91.5, 14], [-94.5, 16], [-97, 15.9], [-101, 17.5], [-105.5, 20], [-105.5, 22.5], [-109, 25.5], [-112.5, 29.5], [-114.7, 30],
  [-112, 25], [-110, 23], [-112, 24.5], [-115, 28], [-117.2, 32.6], [-120.5, 34.5], [-122.5, 37.5], [-124.2, 40.3], [-124, 46],
  [-124.5, 48], [-123, 48.5], [-125, 50], [-130, 54.5], [-134, 58], [-140, 59.8], [-146, 61], [-152, 59.5], [-158, 57],
  [-163, 54.8], [-158, 58.5], [-162, 60], [-165, 62], [-161, 64.5],
];

const SOUTH_AMERICA: Poly = [
  [-77.5, 8.7], [-75, 11], [-72, 12], [-71.5, 10.5], [-68, 10.5], [-63, 10.7], [-61, 10.5], [-60, 8.5], [-57, 6], [-52, 5],
  [-50, 1.5], [-50, -0.5], [-44, -2.5], [-38, -3.7], [-35, -5.5], [-35, -9], [-39, -13.5], [-39, -18], [-41.5, -22.5],
  [-45, -23.5], [-48.5, -26], [-48.7, -28.5], [-52, -32], [-54, -34.5], [-57, -35], [-57.5, -38], [-62, -39], [-65, -41],
  [-63.5, -42.5], [-65.5, -45], [-67.5, -46.5], [-66, -48], [-69, -51], [-68.5, -52.5], [-71.5, -54], [-74.5, -52],
  [-75.5, -47], [-73.5, -42.5], [-73.5, -37], [-71.5, -30], [-70.5, -23], [-70.2, -18.3], [-75, -15], [-77, -12], [-79.5, -7.5],
  [-81, -5], [-80, -2.5], [-80.5, 0], [-78.8, 1.8], [-77.5, 4], [-77.3, 7],
];

const AUSTRALIA: Poly = [
  [114, -22], [122, -18], [126, -14], [131, -12], [136, -12], [136.8, -15.8], [141, -17], [141.5, -12.5], [143.5, -14.5],
  [145.5, -17], [146, -19], [149, -21], [153, -25], [153, -28.5], [152, -32], [150, -37], [147, -38.3], [143.5, -38.8],
  [140, -37.5], [138, -35.5], [136, -34.5], [132, -31.8], [125, -32.5], [118, -35], [115, -34], [115.5, -31.5], [113.5, -26],
];

const GREENLAND: Poly = [
  [-73, 78], [-60, 82], [-30, 83.5], [-18, 80], [-20, 75], [-22, 70], [-32, 68], [-41, 65], [-43.5, 60], [-48, 61], [-52, 65],
  [-54, 69], [-58, 75.5], [-68, 76.5],
];

const ISLANDS: readonly Poly[] = [
  [[-5, 50], [1.5, 51], [1.7, 52.8], [0, 54], [-2, 56], [-2, 57.6], [-4, 58.6], [-6, 58], [-5.5, 56], [-4.8, 54.7], [-3, 54],
    [-3, 53.4], [-4.5, 53.3], [-5, 51.7], [-3, 51.4]],
  [[-10, 52], [-6, 52.2], [-6, 54], [-8, 55.3], [-10, 54]],
  [[-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.5, 65], [-18, 63.4], [-22, 63.8]],
  [[130, 31], [131.5, 31.5], [131.7, 33.5], [134, 34], [135, 33.5], [137, 34.5], [140, 35], [141, 37], [142, 39.5], [141.5, 41.5],
    [140, 41], [139.8, 39.5], [137, 37], [136, 36], [133, 35.5], [131, 34.5]],
  [[140, 42], [141.5, 42.6], [145.3, 43.3], [144, 44.2], [141.5, 45.4], [141.7, 44]],
  [[49.3, -12], [50.5, -15.5], [49.5, -18], [47.5, -24.5], [45, -25.5], [43.5, -22], [44.3, -17], [46.3, -15.7]],
  [[109, 1.5], [111, 2], [115, 5], [117.5, 7], [119, 5], [117.8, 1], [116.5, -3.5], [114.5, -4], [110.5, -3], [109, -0.5]],
  [[95.3, 5.5], [98, 4], [104, -1], [106, -3.5], [105.8, -5.8], [102, -4], [98.5, 0.5]],
  [[105.5, -6.5], [108, -6.5], [114, -7.8], [114.5, -8.7], [106, -7.5]],
  [[131, -1], [135, -3.3], [138, -1.7], [144, -3.8], [147, -6], [150.5, -10.5], [147, -10.2], [143.5, -9], [141, -9], [138, -8],
    [133, -4]],
  [[172.7, -34.5], [175, -37], [178.5, -37.7], [176.5, -40], [175, -41.5], [174.5, -39.5], [173.8, -35.7]],
  [[172.7, -40.5], [174, -41.5], [173, -43.7], [171, -44.7], [169, -46.6], [166.5, -46], [168, -44], [171, -42.5]],
  [[-85, 22], [-82, 23], [-78, 22.5], [-74.2, 20.2], [-77, 19.9], [-81, 21.8]],
  [[120, 18.5], [122.3, 18.3], [122, 15], [124, 13], [121, 13.8], [120, 16]],
];

export const LAND: readonly Poly[] = [EURASIA, AFRICA, NORTH_AMERICA, SOUTH_AMERICA, AUSTRALIA, GREENLAND, ...ISLANDS];

/** Inland seas drawn as water on top of land. */
export const WATER: readonly Poly[] = [
  [[28, 41.5], [28, 44], [30, 45.5], [33, 46], [35, 45], [38, 47], [41, 43], [41.5, 41.5], [36, 41.8], [31, 41.1]],
  [[47, 45], [50, 46.5], [53, 45], [54, 40], [53.5, 37], [50, 37], [49, 40], [47.5, 43]],
];

const D2R = Math.PI / 180;

export interface Projected { x: number; y: number; z: number }

/**
 * Orthographic projection of (lon, lat) for a globe whose centre looks at (lon0, lat0).
 * x right, y up, z towards the viewer (visible when z > 0). Unit sphere.
 */
export function project(lon: number, lat: number, lon0: number, lat0: number): Projected {
  const phi = lat * D2R; const phi0 = lat0 * D2R; const lam = (lon - lon0) * D2R;
  const cp = Math.cos(phi);
  return {
    x: cp * Math.sin(lam),
    y: Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cp * Math.cos(lam),
    z: Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cp * Math.cos(lam),
  };
}

/** Signed shortest longitude difference b - a, in (-180, 180]. */
export function shortestLonDelta(a: number, b: number) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Great-circle angle between two surface points, radians. */
export function angularDistance(lonA: number, latA: number, lonB: number, latB: number) {
  const a = project(lonB, latB, lonA, latA);
  return Math.acos(clamp(a.z, -1, 1));
}

export interface GlobeAim { lon: number; lat: number }

/** Point along a rotation from `a` to `b` (t in 0..1, eased), taking the short way round. */
export function lerpAim(a: GlobeAim, b: GlobeAim, t: number): GlobeAim {
  const e = easeInOut(clamp(t, 0, 1));
  return { lon: a.lon + shortestLonDelta(a.lon, b.lon) * e, lat: a.lat + (b.lat - a.lat) * e };
}

/** Sampled great circle between two surface points (inclusive of both endpoints). */
export function greatCircle(a: readonly [number, number], b: readonly [number, number], n = 32): [number, number][] {
  const v = (lon: number, lat: number): [number, number, number] => {
    const p = lat * D2R; const l = lon * D2R;
    return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  };
  const va = v(a[0], a[1]); const vb = v(b[0], b[1]);
  const dot = clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1);
  const om = Math.acos(dot);
  const so = Math.sin(om);
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ka = so < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / so;
    const kb = so < 1e-9 ? t : Math.sin(t * om) / so;
    const x = ka * va[0] + kb * vb[0]; const y = ka * va[1] + kb * vb[1]; const z = ka * va[2] + kb * vb[2];
    out.push([Math.atan2(y, x) / D2R, Math.asin(clamp(z / Math.hypot(x, y, z), -1, 1)) / D2R]);
  }
  out[0] = [a[0], a[1]]; out[n] = [b[0], b[1]];
  return out;
}
