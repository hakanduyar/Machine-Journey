import { buildCoast, lonLatToXYZ, type CoastGeo } from './globeGeo';
import { mulberry32 } from './layout';

/**
 * Inland detail for the globe from official Natural Earth public-domain data (see public/assets/globe/inland-provenance.json):
 *  - populated places [lon, lat, scalerank, pop_max] -> tiny settlement-light clusters on land (decorative, scaled by the
 *    static population estimate; NOT live lights, traffic or network monitoring),
 *  - land boundary lines (OPEN polylines, never closed) -> thin low-contrast internal boundaries,
 *  - ne_110m_land rings -> a coarse land mask so scatter never lights the ocean.
 * Everything is converted to unit xyz once; nothing here runs per frame except the prefix choice of `settlementCount`.
 */
export type PlaceRow = readonly [lon: number, lat: number, scalerank: number, pop: number];

// ---------------------------------------------------------------------------------------------------- land mask

interface Ring { minLon: number; maxLon: number; minLat: number; maxLat: number; pts: Float32Array }
export interface LandMask { rings: Ring[] }

/** Rings are lon/lat polygons; holes are unclassified in the source, so membership is even-odd over all rings. */
export function buildLandMask(rings: readonly (readonly (readonly number[])[])[]): LandMask {
  const out: Ring[] = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    const pts = new Float32Array(r.length * 2);
    let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
    r.forEach((p, i) => {
      pts[i * 2] = p[0]; pts[i * 2 + 1] = p[1];
      minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]); minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    });
    out.push({ minLon, maxLon, minLat, maxLat, pts });
  }
  return { rings: out };
}

export function isLand(mask: LandMask, lon: number, lat: number): boolean {
  let inside = false;
  for (const r of mask.rings) {
    if (lon < r.minLon || lon > r.maxLon || lat < r.minLat || lat > r.maxLat) continue;
    const p = r.pts; const n = p.length / 2;
    let hit = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2]; const yi = p[i * 2 + 1]; const xj = p[j * 2]; const yj = p[j * 2 + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    if (hit) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------------- settlements

/** Points sorted by importance (largest places first), so any prefix is a coherent coarser level of detail. */
export interface Settlements { xyz: Float32Array; size: Float32Array; alpha: Float32Array; count: number }

/** Hard bound on generated points. */
export const MAX_SETTLEMENT_POINTS = 9000;

/** Cluster size from the static population estimate: 1 for hamlets, about 9 for 10M+ cities, bounded. */
export const clusterSize = (pop: number) => Math.min(13, 1 + Math.floor(2 * Math.log10(Math.max(pop, 1000) / 1000)));

export function buildSettlements(rows: readonly PlaceRow[], mask: LandMask | null): Settlements {
  const order = rows.map((_, i) => i).sort((a, b) => rows[b][3] - rows[a][3] || rows[a][2] - rows[b][2] || a - b);
  const xyz: number[] = []; const size: number[] = []; const alpha: number[] = [];
  let count = 0;
  for (const idx of order) {
    const [lon, lat, rank, pop] = rows[idx];
    const imp = 1 - Math.min(10, Math.max(0, rank)) / 10; // scalerank 0 is the most important
    const rnd = mulberry32(7000 + idx);
    const n = clusterSize(pop);
    // the place itself: the brightest point of its cluster, always kept
    if (count >= MAX_SETTLEMENT_POINTS) break;
    xyz.push(...lonLatToXYZ(lon, lat)); size.push(0.55 + imp * 0.75); alpha.push(0.45 + imp * 0.4); count++;
    // scatter only where the land mask says it is land; polar stations and unmasked islets keep just the place itself
    if (!mask || !isLand(mask, lon, lat) || lat < -60 || Math.abs(lat) > 80) continue;
    const rMax = Math.min(0.6, 0.12 + 0.12 * Math.log10(Math.max(pop, 1000) / 1000));
    const kx = 1 / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    for (let k = 1; k < n && count < MAX_SETTLEMENT_POINTS; k++) {
      const ang = rnd() * Math.PI * 2; const r = Math.pow(rnd(), 1.4) * rMax;
      const slon = lon + Math.cos(ang) * r * kx; const slat = lat + Math.sin(ang) * r;
      if (!isLand(mask, slon, slat)) continue; // never light the ocean; the cluster simply thins at the coast
      xyz.push(...lonLatToXYZ(slon, slat));
      size.push(0.35 + Math.pow(rnd(), 2) * 0.5);
      alpha.push((0.16 + rnd() * 0.34) * (0.55 + 0.45 * imp));
      count++;
    }
  }
  return { xyz: Float32Array.from(xyz), size: Float32Array.from(size), alpha: Float32Array.from(alpha), count };
}

/** How many of the importance-sorted points to draw for a globe of radius R (px): fewer, larger places when small. */
export function settlementCount(total: number, R: number): number {
  const f = R < 110 ? 0.2 : R < 230 ? 0.55 : 1;
  return Math.ceil(total * f);
}

// ---------------------------------------------------------------------------------------------------- bundle + loading

export interface InlandGeo { settlements: Settlements; boundaries: CoastGeo }

export function buildInland(
  places: readonly PlaceRow[], boundaryParts: readonly (readonly (readonly number[])[])[], landRings: readonly (readonly (readonly number[])[])[] | null,
): InlandGeo {
  const mask = landRings ? buildLandMask(landRings) : null;
  return { settlements: buildSettlements(places, mask), boundaries: buildCoast(boundaryParts) };
}

export interface InlandLoad { geo: InlandGeo | null; status: 'idle' | 'loading' | 'ready' | 'failed' }
const load: InlandLoad = { geo: null, status: 'idle' };
let loadPromise: Promise<InlandGeo | null> | null = null;
export const inlandState = (): Readonly<InlandLoad> => load;

/** Same policy as the coastline: async after idle, latched by the renderer per visit; failure just leaves the globe without it. */
export function preloadInland(baseUrl: string, fetcher: typeof fetch = fetch): Promise<InlandGeo | null> {
  if (loadPromise) return loadPromise;
  load.status = 'loading';
  const get = <T>(name: string) => fetcher(`${baseUrl}assets/globe/${name}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; });
  loadPromise = Promise.all([
    get<PlaceRow[]>('ne_50m_populated_places_simple.points.json'),
    get<number[][][]>('ne_110m_admin_0_boundary_lines_land.parts.json'),
    get<number[][][]>('ne_110m_land.parts.json').catch(() => null), // the mask is optional: without it only the places themselves are lit
  ])
    .then(([places, bounds, land]) => { load.geo = buildInland(places, bounds, land); load.status = 'ready'; return load.geo; })
    .catch(() => { load.status = 'failed'; return null; });
  return loadPromise;
}
