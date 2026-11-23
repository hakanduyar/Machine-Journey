import { clamp } from './geometry';
import { mulberry32 } from './layout';

/**
 * Pure geometry for the globe renderer (no DOM). Source of the coastline: Natural Earth 1:50m coastline (public domain,
 * see public/assets/globe/provenance.json). Coastline parts are POLYLINES and are never closed. Vertices are converted
 * to unit-sphere xyz ONCE; per frame only a 3x3 rotation is applied (no sin/cos per vertex).
 * City lights and route bundles below are authored, decorative and approximate: not population or network data.
 */
export type Vec3 = readonly [number, number, number];

const D2R = Math.PI / 180;

export const lonLatToXYZ = (lon: number, lat: number): [number, number, number] => {
  const p = lat * D2R; const l = lon * D2R; const c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
};

/** View of a globe whose centre looks at (lon0, lat0). Matches `project()` in globe.ts exactly. */
export interface ViewBasis { cl: number; sl: number; cp: number; sp: number }
export const viewBasis = (lon0: number, lat0: number): ViewBasis => ({
  cl: Math.cos(lon0 * D2R), sl: Math.sin(lon0 * D2R), cp: Math.cos(lat0 * D2R), sp: Math.sin(lat0 * D2R),
});
/** x right, y up, z toward the viewer (visible when z > 0), unit sphere. */
export function rotate(b: ViewBasis, X: number, Y: number, Z: number): [number, number, number] {
  const a = X * b.cl + Y * b.sl;
  return [Y * b.cl - X * b.sl, b.cp * Z - b.sp * a, b.sp * Z + b.cp * a];
}

// ---------------------------------------------------------------------------------------------------- coastline

/** One level of detail: concatenated xyz and the vertex index where each part starts (length parts + 1). */
export interface CoastLod { xyz: Float32Array; starts: Uint32Array; vertices: number }
export interface CoastGeo { lods: readonly CoastLod[]; /** per-LOD vertex decimation stride */ strides: readonly number[] }

const STRIDES = [1, 2, 4] as const;

/** parts -> parts -> [lon, lat]. Parts with fewer than 2 points are dropped; no part is ever closed. */
export function buildCoast(parts: readonly (readonly (readonly number[])[])[]): CoastGeo {
  const lods = STRIDES.map((stride): CoastLod => {
    const kept: number[][] = [];
    for (const part of parts) {
      if (part.length < 2) continue;
      if (stride === 1) { kept.push(part.flatMap((p) => lonLatToXYZ(p[0], p[1]))); continue; }
      if (part.length < stride * 3) continue; // tiny islets only appear at full detail
      const xyz: number[] = [];
      for (let i = 0; i < part.length; i += stride) xyz.push(...lonLatToXYZ(part[i][0], part[i][1]));
      const last = part[part.length - 1];
      if ((part.length - 1) % stride !== 0) xyz.push(...lonLatToXYZ(last[0], last[1]));
      kept.push(xyz);
    }
    const starts = new Uint32Array(kept.length + 1);
    let n = 0;
    kept.forEach((k, i) => { starts[i] = n; n += k.length / 3; });
    starts[kept.length] = n;
    const xyz = new Float32Array(n * 3);
    let o = 0;
    for (const k of kept) { xyz.set(k, o); o += k.length; }
    return { xyz, starts, vertices: n };
  });
  return { lods, strides: STRIDES };
}

/** Coarser levels for small globes; the held composition and entry use full detail when large enough. */
export function lodForRadius(R: number): 0 | 1 | 2 {
  return R < 110 ? 2 : R < 230 ? 1 : 0;
}

export interface FrontRuns {
  /** flat screen xy of every kept vertex */
  pts: Float32Array;
  /** run r covers pts pairs [runs[r], runs[r + 1]); length runCount + 1 */
  runs: Int32Array;
  runCount: number;
  /** debug/test: number of vertices visited with z <= 0 (must never appear in a run) */
  hidden: number;
}

let scratchPts = new Float32Array(0);
let scratchRuns = new Int32Array(0);

/**
 * Screen-space front-facing runs of a polyline set. A run breaks at every part boundary, at every back-facing vertex
 * (z <= 0) and at vertices far outside the viewport, so no chord ever crosses the back of the sphere and no part is
 * joined to the next. Results live in reusable scratch buffers (valid until the next call).
 */
export function collectFrontRuns(
  lod: CoastLod, b: ViewBasis, cx: number, cy: number, R: number, w: number, h: number, pad = 48,
): FrontRuns {
  const need = lod.vertices * 2;
  if (scratchPts.length < need) scratchPts = new Float32Array(need);
  if (scratchRuns.length < lod.vertices + 2) scratchRuns = new Int32Array(lod.vertices + 2);
  const pts = scratchPts; const runs = scratchRuns;
  let np = 0; let nr = 0; let hidden = 0;
  const { xyz, starts } = lod;
  for (let part = 0; part < starts.length - 1; part++) {
    let open = false;
    for (let v = starts[part]; v < starts[part + 1]; v++) {
      const X = xyz[v * 3]; const Y = xyz[v * 3 + 1]; const Z = xyz[v * 3 + 2];
      const a = X * b.cl + Y * b.sl;
      const z = b.sp * Z + b.cp * a;
      if (z <= 0) { hidden++; open = false; continue; }
      const sx = cx + (Y * b.cl - X * b.sl) * R;
      const sy = cy - (b.cp * Z - b.sp * a) * R;
      if (sx < -pad || sx > w + pad || sy < -pad || sy > h + pad) { open = false; continue; }
      if (!open) { runs[nr++] = np / 2; open = true; }
      pts[np++] = sx; pts[np++] = sy;
    }
  }
  runs[nr] = np / 2;
  return { pts, runs, runCount: nr, hidden };
}

// ---------------------------------------------------------------------------------------------------- city lights

/** Authored settlement clusters around a city: many tiny points, a few brighter, never equal glowing dots. */
export interface CityLights { cityId: string; xyz: Float32Array; size: Float32Array; alpha: Float32Array }

export function buildCityLights(cities: readonly { id: string; lon: number; lat: number }[]): CityLights[] {
  return cities.map((c, ci) => {
    const rnd = mulberry32(5000 + ci * 31);
    const pts: { lon: number; lat: number; s: number; a: number }[] = [];
    const kx = 1 / Math.max(0.3, Math.cos(c.lat * D2R));
    const cluster = (lon: number, lat: number, n: number, spread: number, bright: number) => {
      for (let i = 0; i < n; i++) {
        const ang = rnd() * Math.PI * 2; const r = Math.pow(rnd(), 1.5) * spread;
        const s = 0.35 + Math.pow(rnd(), 3) * 1.15;
        pts.push({ lon: lon + Math.cos(ang) * r * kx, lat: lat + Math.sin(ang) * r, s, a: (0.28 + rnd() * 0.5) * bright });
      }
    };
    cluster(c.lon, c.lat, 150, 1.5, 1); // dense core
    const nSat = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < nSat; k++) { // satellite towns
      const ang = rnd() * Math.PI * 2; const d = 1.6 + rnd() * 3.2;
      cluster(c.lon + Math.cos(ang) * d * kx, c.lat + Math.sin(ang) * d, 18 + Math.floor(rnd() * 26), 0.5 + rnd() * 0.5, 0.75);
    }
    const xyz = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => xyz.set(lonLatToXYZ(p.lon, p.lat), i * 3));
    return { cityId: c.id, xyz, size: Float32Array.from(pts, (p) => p.s), alpha: Float32Array.from(pts, (p) => p.a) };
  });
}

// ---------------------------------------------------------------------------------------------------- route bundles

/** A bundle of near-parallel decorative lines between two cities with a few angular waypoint bends, close to the surface. */
export interface RouteBundle { a: string; b: string; lines: Float32Array[] }

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Points along the great circle a -> b (unit vectors), n + 1 samples. */
export function slerp(a: Vec3, b: Vec3, n: number): [number, number, number][] {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const om = Math.acos(dot); const so = Math.sin(om);
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ka = so < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / so;
    const kb = so < 1e-9 ? t : Math.sin(t * om) / so;
    out.push(norm([ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]]));
  }
  return out;
}

/** Maximum height above the surface (unit sphere) of any route: routes hug the globe, they are not airline arches. */
export const ROUTE_LIFT = 0.012;

export function buildRoutes(
  arcs: readonly (readonly [string, string])[],
  cityOf: (id: string) => { lon: number; lat: number } | null,
  /** Seed index of an arc (default: its position). Pass a pair-derived index for bundles that must look the same in any subset. */
  indexOf: (a: string, b: string, position: number) => number = (_a, _b, i) => i,
): RouteBundle[] {
  const out: RouteBundle[] = [];
  arcs.forEach(([a, b], position) => {
    const ai = indexOf(a, b, position);
    const ca = cityOf(a); const cb = cityOf(b);
    if (!ca || !cb) return;
    const rnd = mulberry32(9000 + ai * 13);
    const va = lonLatToXYZ(ca.lon, ca.lat); const vb = lonLatToXYZ(cb.lon, cb.lat);
    const om = Math.acos(clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1));
    // 2..3 interior waypoints nudged sideways: the path bends at angles instead of one smooth arch.
    const base = slerp(va, vb, 4);
    const nWay = 2 + (rnd() > 0.5 ? 1 : 0);
    const way: [number, number, number][] = [va];
    for (let k = 1; k <= nWay; k++) {
      const p = base[Math.round((k * 4) / (nWay + 1))];
      const t = norm([vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]]);
      const lat = cross(p, t);
      const off = (rnd() - 0.5) * 0.16 * om;
      way.push(norm([p[0] + lat[0] * off, p[1] + lat[1] * off, p[2] + lat[2] * off]));
    }
    way.push(vb);
    // densified surface path through the waypoints (straight great-circle legs: angular bends)
    const path: [number, number, number][] = [];
    for (let i = 0; i < way.length - 1; i++) {
      const seg = slerp(way[i], way[i + 1], Math.max(4, Math.ceil((om / (way.length - 1)) * 14)));
      path.push(...(i === 0 ? seg : seg.slice(1)));
    }
    const k = 3 + (ai % 3); // 3..5 lines per bundle
    const lines: Float32Array[] = [];
    for (let li = 0; li < k; li++) {
      const rel = li - (k - 1) / 2;
      const buf = new Float32Array(path.length * 3);
      path.forEach((p, i) => {
        const t = i / (path.length - 1);
        const nxt = path[Math.min(path.length - 1, i + 1)]; const prv = path[Math.max(0, i - 1)];
        const tan = norm([nxt[0] - prv[0], nxt[1] - prv[1], nxt[2] - prv[2]]);
        const lat = cross(p, tan);
        const fan = Math.pow(Math.sin(Math.PI * t), 0.7); // converge on the cities, fan out between them
        const off = rel * 0.018 * fan * (0.6 + om / Math.PI);
        const lift = 1 + ROUTE_LIFT * Math.sin(Math.PI * t);
        const q = norm([p[0] + lat[0] * off, p[1] + lat[1] * off, p[2] + lat[2] * off]);
        buf.set([q[0] * lift, q[1] * lift, q[2] * lift], i * 3);
      });
      lines.push(buf);
    }
    out.push({ a, b, lines });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------- loading

export interface CoastLoad { geo: CoastGeo | null; status: 'idle' | 'loading' | 'ready' | 'failed' }
const load: CoastLoad = { geo: null, status: 'idle' };
let loadPromise: Promise<CoastGeo | null> | null = null;

export const coastState = (): Readonly<CoastLoad> => load;

/** Starts (once) the async coastline load. Resolves null on failure; the hand-authored outlines remain the fallback. */
export function preloadCoast(baseUrl: string, fetcher: typeof fetch = fetch): Promise<CoastGeo | null> {
  if (loadPromise) return loadPromise;
  load.status = 'loading';
  loadPromise = fetcher(`${baseUrl}assets/globe/ne_50m_coastline.parts.json`)
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<number[][][]>; })
    .then((parts) => { load.geo = buildCoast(parts); load.status = 'ready'; return load.geo; })
    .catch(() => { load.status = 'failed'; return null; });
  return loadPromise;
}
