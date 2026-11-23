import { clamp } from './geometry';
import { CITIES, LAND, WATER, cityById, project } from './globe';
import {
  buildCityLights, buildRoutes, collectFrontRuns, lodForRadius, rotate, viewBasis, type CoastGeo, type RouteBundle, type ViewBasis,
} from './globeGeo';
import { layoutLabels } from './globeLabels';
import { settlementCount, type InlandGeo } from './globeInland';
import { smoothstep } from './scale';

// 17 quantised light colours: no per-point string building.
const LIGHT_STYLES = Array.from({ length: 17 }, (_, i) => `rgba(214,232,255,${(i / 16).toFixed(3)})`);

export interface GlobeView {
  w: number; h: number;
  cx: number; cy: number;
  /**
   * On-screen radius of the sphere in CSS px. It may be far larger than the viewport (close zoom): then the sphere is
   * a flat ground (no limb, no clip arc) and glows / labels sized for a whole globe are suppressed.
   */
  radius: number;
  lon: number; lat: number;
  /** 0..1 overall opacity. */
  alpha: number;
  destId: string | null;
  /** This visit's route bundles (see `routeArcs`) and their signature (static-layer cache key). Absent: no routes. */
  routes?: readonly (readonly [string, string])[];
  routeSig?: string;
  /** ms clock for the target pulse. */
  time: number;
  /** Drawn over the geography and lights, under the markers: the regional camera-network field of the zoom legs. */
  under?: (ctx: CanvasRenderingContext2D) => void;
  /**
   * Accurate Natural Earth coastline, latched by the caller when the globe becomes visible (so the geography never
   * swaps mid-visit). Null/undefined: the simplified hand-authored outlines are drawn, so the globe is never blank.
   */
  coast?: CoastGeo | null;
  /** Inland detail (boundaries + settlement lights), latched the same way as `coast`. Null/undefined: not drawn. */
  inland?: InlandGeo | null;
  /** Px of the bottom band the DOM footer occupies; city labels stay out of it (the globe itself is not moved). */
  reserveBottom?: number;
}

export interface CityHit { id: string; x: number; y: number }

const ACCENT = '#ff4d4d';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// Authored, deterministic, decorative: settlement clusters and route bundles. Built once.
const LIGHTS = buildCityLights(CITIES);
/** Bundle geometry per city pair, built once on first use and identical in every visit's subset (stable, no per-frame work). */
const pairIndex = (a: string, b: string) => { let h = 5; for (const ch of `${a < b ? a : b}|${a < b ? b : a}`) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h % 4096; };
const BUNDLES = new Map<string, RouteBundle>();
function bundlesFor(arcs: readonly (readonly [string, string])[]): RouteBundle[] {
  const out: RouteBundle[] = [];
  for (const [a, b] of arcs) {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let bundle = BUNDLES.get(k);
    if (!bundle) { bundle = buildRoutes([[a, b]], cityById, (x, y) => pairIndex(x, y))[0]; if (bundle) BUNDLES.set(k, bundle); }
    if (bundle) out.push(bundle);
  }
  return out;
}

/** Densify lon/lat polygon edges so projected outlines curve with the sphere (fallback outlines only). */
function densify(poly: readonly (readonly [number, number])[], step = 2.5) {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const LAND_D = LAND.map((p) => densify(p));
const WATER_D = WATER.map((p) => densify(p));

/** Whole-globe route lines are gone before any camera thumbnail is large enough to be crossed by one. */
const routeFade = (R: number) => 1 - smoothstep(2000, 6000, R);

/** Draws the (front-facing) bundles of routes. `only` restricts to bundles touching a city id. */
function strokeRoutes(ctx: CanvasRenderingContext2D, b: ViewBasis, cx: number, cy: number, R: number, only: string | null, bundles: readonly RouteBundle[]) {
  for (const bundle of bundles) {
    if (only !== null && bundle.a !== only && bundle.b !== only) continue;
    ctx.beginPath();
    for (const line of bundle.lines) {
      let pen = false;
      for (let i = 0; i < line.length; i += 3) {
        const [x, y, z] = rotate(b, line[i], line[i + 1], line[i + 2]);
        if (z <= 0.03) { pen = false; continue; }
        const sx = cx + x * R; const sy = cy - y * R;
        if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        pen = true;
      }
    }
    ctx.stroke();
  }
}

/** Everything that only changes when the aim / radius change: sphere, graticule, coast, routes, settlement lights, limb. */
function paintStatic(ctx: CanvasRenderingContext2D, v: GlobeView, cx: number, cy: number, R: number, bw: number, bh: number) {
  const b = viewBasis(v.lon, v.lat);
  // The sphere covers the whole canvas (close zoom): a flat ground, no limb. Otherwise the globe body is a disc.
  const flat = R > Math.hypot(Math.max(cx, bw - cx), Math.max(cy, bh - cy)) + 2;
  // Near-black navy body (same gradient either way, so the look is continuous as the limb leaves / enters the view).
  const g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, '#0b1626'); g.addColorStop(0.7, '#060d18'); g.addColorStop(1, '#02050b');
  ctx.fillStyle = g;
  ctx.beginPath();
  if (flat) ctx.rect(0, 0, bw, bh); else ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  if (flat) ctx.rect(0, 0, bw, bh); else ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Faint graticule (a whole-globe cue only: at regional scale it is a few straight, meaningless lines).
  if (R < 3000) {
    ctx.strokeStyle = 'rgba(110,150,210,0.08)'; ctx.lineWidth = 1;
    const line = (pts: [number, number][]) => {
      let pen = false;
      ctx.beginPath();
      for (const [lo, la] of pts) {
        const p = project(lo, la, v.lon, v.lat);
        if (p.z <= 0) { pen = false; continue; }
        const sx = cx + p.x * R; const sy = cy - p.y * R;
        if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        pen = true;
      }
      ctx.stroke();
    };
    for (let lo = -180; lo < 180; lo += 30) line(Array.from({ length: 46 }, (_, i) => [lo, -90 + i * 4] as [number, number]));
    for (let la = -60; la <= 60; la += 30) line(Array.from({ length: 91 }, (_, i) => [-180 + i * 4, la] as [number, number]));
  }
  // Vertices beyond the viewport break a run: keep a margin of about one source segment at zoom.
  const cullPad = Math.max(48, R * 0.004);

  if (v.inland) {
    // Thin, low-contrast internal boundaries (open polylines) beneath the coast and the lights.
    const runs = collectFrontRuns(v.inland.boundaries.lods[0], b, cx, cy, R, bw, bh, cullPad);
    ctx.strokeStyle = 'rgba(150,172,205,0.17)'; ctx.lineWidth = 0.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let r = 0; r < runs.runCount; r++) {
      const a = runs.runs[r]; const e = runs.runs[r + 1];
      ctx.moveTo(runs.pts[a * 2], runs.pts[a * 2 + 1]);
      for (let i = a + 1; i < e; i++) ctx.lineTo(runs.pts[i * 2], runs.pts[i * 2 + 1]);
    }
    ctx.stroke();
  }

  if (v.coast) {
    // Accurate coastline: open polylines, front-facing runs only, one path, one stroke.
    const lod = v.coast.lods[lodForRadius(R)];
    const runs = collectFrontRuns(lod, b, cx, cy, R, bw, bh, cullPad);
    ctx.strokeStyle = 'rgba(212,222,236,0.62)'; ctx.lineWidth = R > 200 ? 0.8 : 0.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let r = 0; r < runs.runCount; r++) {
      const a = runs.runs[r]; const e = runs.runs[r + 1];
      ctx.moveTo(runs.pts[a * 2], runs.pts[a * 2 + 1]);
      for (let i = a + 1; i < e; i++) ctx.lineTo(runs.pts[i * 2], runs.pts[i * 2 + 1]);
    }
    ctx.stroke();
  } else {
    // Fallback (data still loading / failed): the simplified authored outlines, as before.
    const trace = (poly: [number, number][], fill: string | null) => {
      const pts = poly.map(([lo, la]) => { const p = project(lo, la, v.lon, v.lat); return { x: cx + p.x * R, y: cy - p.y * R, z: p.z }; });
      if (fill) {
        ctx.beginPath();
        pts.forEach((p, i) => {
          let { x, y } = p;
          if (p.z < 0) { const dx = x - cx; const dy = y - cy; const d = Math.hypot(dx, dy) || 1; x = cx + (dx / d) * R; y = cy + (dy / d) * R; }
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      }
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= pts.length; i++) {
        const p = pts[i % pts.length];
        if (p.z <= 0) { pen = false; continue; }
        if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(190,205,225,0.6)'; ctx.lineWidth = 1;
    for (const p of LAND_D) trace(p, 'rgba(40,64,100,0.2)');
    for (const p of WATER_D) { ctx.strokeStyle = 'rgba(190,205,225,0.4)'; trace(p, '#060d18'); }
  }

  // Pale ice-blue route bundles hugging the surface (decorative arcs: they fade out before they could read as roads).
  const routeA = 0.3 * routeFade(R);
  if (routeA > 0.01) {
    ctx.strokeStyle = `rgba(150,205,255,${routeA.toFixed(3)})`; ctx.lineWidth = 0.8;
    strokeRoutes(ctx, b, cx, cy, R, null, bundlesFor(v.routes ?? []));
  }

  // Settlement lights: many tiny uneven points per cluster, plus a faint haze at the core.
  ctx.globalCompositeOperation = 'lighter';
  const px = Math.min(2.6, 0.55 + R / 420);
  if (v.inland) {
    // Settlements across land, importance-sorted so a prefix is the coarser level of detail for small globes.
    const st = v.inland.settlements; const n = settlementCount(st.count, R);
    const sp = Math.min(1.9, 0.5 + R / 520);
    let last = -1;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = rotate(b, st.xyz[i * 3], st.xyz[i * 3 + 1], st.xyz[i * 3 + 2]);
      if (z <= 0.02) continue;
      const q = Math.round(st.alpha[i] * Math.min(1, z * 1.6) * 16);
      if (q <= 0) continue;
      if (q !== last) { ctx.fillStyle = LIGHT_STYLES[q]; last = q; }
      const sz = Math.max(0.55, st.size[i] * sp);
      ctx.fillRect(cx + x * R - sz / 2, cy - y * R - sz / 2, sz, sz);
    }
  }
  LIGHTS.forEach((cl) => {
    const [hx, hy, hz] = rotate(b, ...(cityXYZ.get(cl.cityId) as [number, number, number]));
    if (hz <= 0) return;
    for (let i = 0; i < cl.alpha.length; i++) {
      const [x, y, z] = rotate(b, cl.xyz[i * 3], cl.xyz[i * 3 + 1], cl.xyz[i * 3 + 2]);
      if (z <= 0.02) continue;
      const sz = Math.max(0.6, cl.size[i] * px);
      const q = Math.round(cl.alpha[i] * Math.min(1, z * 1.6) * 16); // 20 clusters now: quantised styles, no per-point string building
      if (q <= 0) continue;
      ctx.fillStyle = LIGHT_STYLES[Math.min(16, q)];
      ctx.fillRect(cx + x * R - sz / 2, cy - y * R - sz / 2, sz, sz);
    }
    if (R < 2400) { // the soft core haze is a whole-globe cue; it must not become a giant glow at regional zoom
      const gr = Math.max(5, Math.min(34, R * 0.03));
      const glow = ctx.createRadialGradient(cx + hx * R, cy - hy * R, 0, cx + hx * R, cy - hy * R, gr);
      glow.addColorStop(0, `rgba(200,225,255,${(0.28 * (1 - smoothstep(1200, 2400, R))).toFixed(3)})`); glow.addColorStop(1, 'rgba(60,120,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx + hx * R, cy - hy * R, gr, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // Limb: only while the sphere's edge is actually inside the view.
  if (!flat) {
    ctx.strokeStyle = 'rgba(130,180,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }
}

const cityXYZ = new Map<string, [number, number, number]>(
  CITIES.map((c) => {
    const p = (c.lat * Math.PI) / 180; const l = (c.lon * Math.PI) / 180;
    return [c.id, [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)] as [number, number, number]];
  }),
);

// Static-layer cache: once the aim and radius have been identical for two frames (holds), the static layer is rendered
// once into an offscreen canvas and only blitted afterwards. While rotating / growing / entering it is drawn directly.
let cacheCanvas: HTMLCanvasElement | null = null;
let cacheKey = '';
let lastKey = '';
const CACHE_MAX_R = 1100;

function paintStaticCached(ctx: CanvasRenderingContext2D, v: GlobeView, dpr: number) {
  const R = v.radius;
  const key = `${v.coast ? 'c' : 'f'}${v.inland ? 'i' : 'n'}|${v.routeSig ?? ''}|${lodForRadius(R)}|${R.toFixed(2)}|${v.lon.toFixed(4)}|${v.lat.toFixed(4)}|${dpr}`;
  const stable = key === lastKey && R <= CACHE_MAX_R && typeof document !== 'undefined';
  lastKey = key;
  if (!stable) { paintStatic(ctx, v, v.cx, v.cy, R, v.w, v.h); return; }
  const pad = 4; const size = Math.ceil((R + pad) * 2);
  if (cacheKey !== key || !cacheCanvas) {
    cacheCanvas ??= document.createElement('canvas');
    cacheCanvas.width = Math.ceil(size * dpr); cacheCanvas.height = Math.ceil(size * dpr);
    const c2 = cacheCanvas.getContext('2d');
    if (!c2) { paintStatic(ctx, v, v.cx, v.cy, R, v.w, v.h); return; }
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, size, size);
    paintStatic(c2, v, R + pad, R + pad, R, size, size);
    cacheKey = key;
  }
  ctx.drawImage(cacheCanvas, v.cx - R - pad, v.cy - R - pad, size, size);
}

/** Paint the globe. Returns screen positions of front-facing cities for hit testing. */
export function drawGlobe(ctx: CanvasRenderingContext2D, v: GlobeView): CityHit[] {
  ctx.clearRect(0, 0, v.w, v.h);
  if (v.alpha <= 0.002) return [];
  const { cx, cy, radius: R } = v;
  const dpr = ctx.getTransform().a || 1;
  const b = viewBasis(v.lon, v.lat);
  ctx.save();
  ctx.globalAlpha = clamp(v.alpha, 0, 1);
  paintStaticCached(ctx, v, dpr);

  // Highlight the routes of the destination (dynamic: depends on destId).
  if (v.destId !== null && routeFade(R) > 0.01) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = `rgba(170,220,255,${(0.7 * routeFade(R)).toFixed(3)})`; ctx.lineWidth = 1.1;
    strokeRoutes(ctx, b, cx, cy, R, v.destId, bundlesFor(v.routes ?? []));
    ctx.restore();
  }

  v.under?.(ctx);

  // Active target marker + labels + hit targets (not clipped, front-facing only). Both are whole-globe cues: they fade out
  // as the camera closes in (no giant glow, no oversized label over the local field).
  const near = 1 - smoothstep(900, 2200, R);
  const projected = CITIES.map((c) => {
    const [x, y, z] = rotate(b, ...(cityXYZ.get(c.id) as [number, number, number]));
    return { id: c.id, name: c.name, x: cx + x * R, y: cy - y * R, z };
  });
  const hits: CityHit[] = projected.filter((p) => p.z > 0.05).map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const hot = projected.find((p) => p.id === v.destId && p.z > 0.05);
  if (hot && near > 0.01) {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * near;
    ctx.globalCompositeOperation = 'lighter';
    const gr = Math.max(8, Math.min(60, R * 0.045)) * 1.8;
    const glow = ctx.createRadialGradient(hot.x, hot.y, 0, hot.x, hot.y, gr);
    glow.addColorStop(0, 'rgba(255,110,110,0.95)'); glow.addColorStop(0.25, 'rgba(255,77,77,0.45)'); glow.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hot.x, hot.y, gr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const pulse = 0.5 + 0.5 * Math.sin(v.time / 260);
    ctx.strokeStyle = `rgba(255,77,77,${0.9 - 0.4 * pulse})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(hot.x, hot.y, Math.max(9, R * 0.03) + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = prevAlpha;
  }

  if (near > 0.01) {
    ctx.textBaseline = 'middle';
    const font = (px: number, isHot: boolean) => `${isHot ? 600 : 400} ${px}px ${MONO}`;
    const plans = layoutLabels(projected, {
      w: v.w, h: v.h, R, destId: v.destId, base: 10, hotBase: 13, swell: 0, reserveBottom: v.reserveBottom,
      measure: (text, px, isHot) => { ctx.font = font(px, isHot); return ctx.measureText(text).width; },
    });
    const zOf = new Map(projected.map((p) => [p.id, p.z]));
    for (const p of plans) {
      ctx.font = font(p.hot ? 13 : 10, p.hot);
      ctx.textAlign = p.align;
      ctx.fillStyle = p.hot ? ACCENT : `rgba(220,235,255,${clamp((zOf.get(p.id) ?? 0) * 1.6, 0.25, 0.85)})`;
      ctx.globalAlpha = clamp(v.alpha, 0, 1) * near;
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.restore();
  return hits;
}
