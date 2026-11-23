/**
 * Floating camera field: pure layout / pose math (no DOM, no three.js), so it can be unit-tested.
 *
 * Stop positions, the layered background shells, the clustered/asymmetric background planes and the
 * camera path profiles follow the geometry of an earlier camera-space prototype by the same author
 * (MIT, see README credits). Component lifecycle, input, timers and feed handling are NOT taken from
 * it: the journey controller and `Journey.tsx` own all of that.
 */
export const FOV = 48;
export const PANE_W = 18;
export const PANE_H = (PANE_W * 9) / 16;
export type FloatFraming = 'medium' | 'full';

export interface Vec3 { x: number; y: number; z: number }
export interface FloatStop { slot: number; feedId: string; x: number; y: number; z: number }

/**
 * One stop per local feed over roughly 1200 units of depth (slot order and depth are unchanged, so recorded routes and
 * history slots stay valid). Laterally the stops now sit on a wide, uneven elliptical orbit (about +-160 x, +-60 y):
 * every pair the route planner can choose (2..5 slots apart) is clearly displaced sideways AND vertically, the camera
 * visibly translates between groups, and consecutive stops along the traversal stay close enough for a gentle path.
 * Generated from `ORBIT` below (angle 15 deg + 60 deg per slot, per-slot radius factor) and rounded.
 */
const RAW: readonly (readonly [string, number, number, number])[] = [
  ['parking-walk', 145, 15, -70], ['covered-road', 35, 50, -190], ['docked-cargo', -117, 45, -310],
  ['m06', -138, -14, -440], ['m04', -41, -59, -570], ['m07', 95, -37, -700], ['parked-c130', 159, 17, -835],
  ['m01', 38, 54, -975], ['m02', -119, 46, -1110], ['m03', -130, -14, -1250],
];
/** Documentation of how RAW was derived (not used at run time). */
export const ORBIT = { rx: 150, ry: 58, startDeg: 15, stepDeg: 60, radius: [1, 0.9, 1.1, 0.95, 1.05, 0.9, 1.1, 0.97, 1.12, 0.9] } as const;
export const FLOAT_STOPS: readonly FloatStop[] = RAW.map(([feedId, x, y, z], slot) => ({ slot, feedId, x, y, z }));
export const LAST = FLOAT_STOPS.length - 1;
export const slotOfFeed = (id: string) => FLOAT_STOPS.findIndex((s) => s.feedId === id);

export const randomAt = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const tanV = Math.tan((FOV * Math.PI) / 360);

/** Distance at which a pane fits both width and height of the viewport (phones included). */
export const fitDistance = (aspect: number) =>
  Math.max(15, Math.max(PANE_W / (2 * tanV * aspect * 0.82), (PANE_H) / (2 * tanV * 0.72)));
/** Distance at which a pane just covers the whole viewport (the fullscreen video <-> field bridge). */
export const coverDistance = (aspect: number) => Math.min(PANE_W / (2 * tanV * aspect), PANE_H / (2 * tanV)) * 0.97;
export const holdDistance = (framing: FloatFraming, aspect: number) =>
  fitDistance(aspect) * (framing === 'medium' ? (aspect < 1 ? 1.45 : 2.0) : 1);
/** Camera offset (relative to the stop) of a hold: medium framing parks the pane off-centre to leave room for context panels. */
/** Which side of the screen a stop's medium pane (and so its companion panels) sits on: alternates with the slot. */
export const stopSide = (slot: number): 1 | -1 => (slot % 2 === 0 ? 1 : -1);
export function holdOffset(framing: FloatFraming, aspect: number, slot = 0): { x: number; y: number } {
  if (framing === 'full') return { x: 0, y: 0 };
  const d = holdDistance(framing, aspect); const side = stopSide(slot);
  return aspect >= 1 ? { x: side * 0.22 * d * tanV * aspect, y: 0 } : { x: 0, y: -side * 0.2 * d * tanV };
}

export interface FloatPose { eye: Vec3; aim: Vec3 }
const pose = (eye: Vec3): FloatPose => ({ eye, aim: { x: eye.x, y: eye.y, z: eye.z - 100 } });

export function holdPose(slot: number, framing: FloatFraming, aspect: number): FloatPose {
  const s = FLOAT_STOPS[slot]; const o = holdOffset(framing, aspect, slot);
  return pose({ x: s.x + o.x, y: s.y + o.y, z: s.z + holdDistance(framing, aspect) });
}

/** Camera moving from the cover distance (pane fills the screen) out to the hold framing. t in 0..1 (raw). */
export function inPose(slot: number, framing: FloatFraming, t: number, aspect: number): FloatPose {
  const s = FLOAT_STOPS[slot]; const e = smooth(clamp(t, 0, 1));
  const c = coverDistance(aspect); const h = holdDistance(framing, aspect); const o = holdOffset(framing, aspect, slot);
  return pose({ x: s.x + o.x * e, y: s.y + o.y * e, z: s.z + c + (h - c) * e });
}
/** Reverse of `inPose`: from the hold framing in to the cover distance. */
export const outPose = (slot: number, framing: FloatFraming, t: number, aspect: number) => inPose(slot, framing, 1 - t, aspect);

/** Position along the piecewise-linear path through every stop between slots a and b (inclusive). */
export function pathPoint(a: number, b: number, u: number): Vec3 {
  const step = b >= a ? 1 : -1;
  const pts: Vec3[] = [];
  for (let k = a; k !== b + step; k += step) pts.push(FLOAT_STOPS[k]);
  if (pts.length === 1) return { ...pts[0] };
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  const at = clamp(u, 0, 1) * lens[lens.length - 1];
  let i = 1;
  while (i < pts.length - 1 && lens[i] < at) i++;
  const k = clamp((at - lens[i - 1]) / Math.max(1e-9, lens[i] - lens[i - 1]), 0, 1);
  const p = pts[i - 1]; const q = pts[i];
  return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k };
}

/** Per-axis progress profiles per leg: traverse (S-bow), push-in, crane, settle. All 0 at t=0 and 1 at t=1. */
export function shape(i: number, f: number): readonly [number, number, number] {
  switch (((i % 4) + 4) % 4) {
    case 1: { const g = 1 - (1 - f) * (1 - f); return [g, g, g]; }
    case 2: return [smooth(clamp((f - 0.2) / 0.8, 0, 1)), smooth(clamp(f * 1.3, 0, 1)), f];
    case 3: { const g = smooth(smooth(f)); return [g, g, g]; }
    default: return [smooth(f), f, f];
  }
}

/** Camera travelling from the hold at slot a to the hold at slot b along the corridor through every stop in between. */
export function movePose(a: number, fa: FloatFraming, b: number, fb: FloatFraming, f: number, leg: number, aspect: number): FloatPose {
  const t = smooth(clamp(f, 0, 1));
  const [gx, gy, gz] = shape(leg, t);
  const oa = holdOffset(fa, aspect, a); const ob = holdOffset(fb, aspect, b);
  const da = holdDistance(fa, aspect); const db = holdDistance(fb, aspect);
  const bow = Math.sin(Math.PI * t);
  const m = ((leg % 4) + 4) % 4;
  return pose({
    x: pathPoint(a, b, gx).x + oa.x + (ob.x - oa.x) * gx + (m === 0 ? (leg % 8 === 0 ? 6 : -5) * bow : 0),
    y: pathPoint(a, b, gy).y + oa.y + (ob.y - oa.y) * gy + (m === 2 ? 4 * bow : 0),
    z: pathPoint(a, b, gz).z + da + (db - da) * gz,
  });
}

/** Screen rect (CSS px) of a stop pane seen by an axis-aligned camera (in / hold / out poses). */
export function paneScreenRect(eye: Vec3, slot: number, vw: number, vh: number) {
  const s = FLOAT_STOPS[slot];
  const dz = Math.max(1e-3, eye.z - s.z);
  const aspect = vw / vh;
  const ndc = (px: number, py: number) => ({ x: (px - eye.x) / (dz * tanV * aspect), y: (py - eye.y) / (dz * tanV) });
  const a = ndc(s.x - PANE_W / 2, s.y + PANE_H / 2); const b = ndc(s.x + PANE_W / 2, s.y - PANE_H / 2);
  const x0 = ((a.x + 1) / 2) * vw; const x1 = ((b.x + 1) / 2) * vw;
  const y0 = ((1 - a.y) / 2) * vh; const y1 = ((1 - b.y) / 2) * vh;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Normalised device coordinates of a world point for an axis-aligned camera. */
export function projectNdc(eye: Vec3, p: Vec3, aspect: number) {
  const dz = Math.max(1e-3, eye.z - p.z);
  return { x: (p.x - eye.x) / (dz * tanV * aspect), y: (p.y - eye.y) / (dz * tanV) };
}

// ---------------------------------------------------------------- route planning

/**
 * `slots` are the SPATIAL stops the visit uses (geometry); `feeds[i]` is the camera shown on `slots[i]`. A slot's own
 * `FLOAT_STOPS[slot].feedId` is only its default: the renderer rebinds the pane for the visit, so any catalog feed can
 * occupy any slot and the field geometry never changes.
 */
export interface FloatPlan { feeds: string[]; framing: FloatFraming[]; slots: number[] }

/**
 * Stops of one visit: starts at the feed that was fullscreen (the shared pane), then 1..3 other stops,
 * at least two slots apart, alternating direction so the route is not a monotone fly-through.
 * Every stop but the last is an offset `medium` hold (room for context panels); the last is `full` so it can expand
 * to fullscreen. Consecutive stops prefer an odd slot distance, so their medium panes sit on opposite sides.
 */
export function planFloatRoute(startFeedId: string | null, stops: number, visit: number, destFeeds?: readonly string[]): FloatPlan | null {
  const n = clamp(Math.round(stops), 2, 4);
  let start = startFeedId ? slotOfFeed(startFeedId) : -1;
  if (start < 0) start = (visit * 3 + 1) % FLOAT_STOPS.length;
  const slots = [start];
  for (let k = 1; k < n; k++) {
    const prev = slots[k - 1];
    const dirs = (visit + k) % 2 === 0 ? [1, -1] : [-1, 1];
    const odd = [3, 5].map((_, i, a) => a[(i + visit + k) % 2]);
    const even = [2, 4].map((_, i, a) => a[(i + visit + k) % 2]);
    let pick = -1;
    for (const steps of [odd, even]) {
      for (const d of dirs) {
        for (const st of steps) {
          const c = prev + d * st;
          if (c >= 0 && c <= LAST && !slots.includes(c)) { pick = c; break; }
        }
        if (pick >= 0) break;
      }
      if (pick >= 0) break;
    }
    if (pick < 0) for (let c = 0; c <= LAST && pick < 0; c++) if (!slots.includes(c) && Math.abs(c - prev) >= 2) pick = c;
    if (pick < 0) return null;
    slots.push(pick);
  }
  const framing: FloatFraming[] = slots.map((_, k) => (k === n - 1 ? 'full' : 'medium'));
  // The shared pane keeps the incoming feed (even one with no native slot); later stops show the deck's distinct feeds,
  // or, without a deck, each slot's own default feed.
  const feeds = slots.map((s, k) => (k === 0 ? startFeedId ?? FLOAT_STOPS[s].feedId : destFeeds ? destFeeds[k - 1] : FLOAT_STOPS[s].feedId));
  if (feeds.some((f) => !f) || new Set(feeds).size !== feeds.length) return null;
  return { feeds, framing, slots };
}

// ---------------------------------------------------------------- context panels

export type PanelKind = 'dossier' | 'news' | 'location' | 'waveform' | 'checklist' | 'floorplan' | 'siteplan' | 'ledger';

/** What kind of place a sample feed's footage shows (from its catalog label), used only to pick a fitting DEMO document. */
export type SceneGroup = 'aircraft' | 'gym' | 'road' | 'dock' | 'campus' | 'clinic' | 'office';
const SCENE_OF_FEED: Readonly<Record<string, SceneGroup>> = {
  m01: 'office', m02: 'clinic', m03: 'clinic', m04: 'clinic', m06: 'campus', m07: 'campus', 'covered-road': 'road', 'parking-walk': 'road',
  'docked-cargo': 'dock', 'parked-c130': 'aircraft', m05: 'gym', 'palmdale-dc8': 'aircraft',
};
export const sceneOfFeed = (feedId: string | null | undefined): SceneGroup | null => (feedId ? SCENE_OF_FEED[feedId] ?? null : null);

/**
 * The two companions of a stop showing `feedId`: first a scene-fitting authored sample document, second a quiet small record
 * (simulated signal / site record / location). Unknown feed: the original slot-based pair.
 */
export function companionKinds(slot: number, feedId?: string | null): [PanelKind, PanelKind] {
  const g = sceneOfFeed(feedId);
  switch (g) {
    case 'aircraft': return ['checklist', slot % 2 ? 'location' : 'waveform'];
    case 'gym': return ['floorplan', 'dossier'];
    case 'clinic': return ['floorplan', slot % 2 ? 'waveform' : 'location'];
    case 'road': return ['siteplan', slot % 2 ? 'dossier' : 'location'];
    case 'campus': return ['siteplan', 'waveform'];
    case 'dock': return ['ledger', slot % 2 ? 'location' : 'waveform'];
    case 'office': return ['ledger', 'dossier'];
    default: return [(['dossier', 'news', 'location'] as const)[slot % 3], (['waveform', 'location', 'waveform'] as const)[slot % 3]];
  }
}
export interface PanelSpec { kind: PanelKind; w: number; h: number; dx: number; dy: number; dz: number; ry: number }

/** The single discreet designation every panel carries (instead of repeated warnings). */
export const PANEL_TAG = 'DEMO';

export interface PanelContent { title: string; subtitle: string; rows: readonly (readonly [string, string])[]; lines: readonly string[] }

// Invented place names and mundane invented items. Nothing here refers to a real person, event, place or dataset.
const PLACES = ['Port Veldmark', 'Alder Reach', 'North Quay 7', 'Tessel Yard', 'Marrow Point', 'Corvane Basin', 'Ludwick Row', 'Sable Ferry', 'Orrin Heights', 'Halden Crossing'];
const HEADLINES: readonly (readonly [string, string])[] = [
  ['Ferry timetable revised for the', 'evening crossing'], ['Lamp-lighting festival moves', 'to the east quay'], ['New cycle lane opens along', 'the old rail cutting'],
  ['Market hall roof repairs', 'finish a week early'], ['Library extends opening hours', 'for exam season'], ['Harbour choir seeks', 'new tenors and altos'],
  ['Bridge painting schedule', 'announced for spring'], ['Bakers\' guild shares', 'its winter menu'], ['Tram stop renamed after', 'the clockmaker\'s lane'], ['Allotment waiting list', 'shortens for the first time'],
];
const NOTES = ['Fixed mount, east wall', 'Seasonal coverage only', 'Shared with depot office', 'Lens cleaned on rota', 'Covered walkway view', 'Night view limited', 'Wide field, low mount', 'Relay via north hub', 'Archive copy only', 'Spare unit on site'];
const two = (n: number) => String(n).padStart(2, '0');

/** Small fictional records for a stop: site record, local bulletin, grid location, simulated signal. Deterministic per slot. */
export function panelContent(kind: PanelKind, slot: number, scene?: SceneGroup | null): PanelContent {
  const place = PLACES[slot % PLACES.length];
  const form = `FORM DM-${11 + slot * 3}`;
  switch (kind) {
    // Authored SAMPLE documents tied to the scene type. Blank / schematic by design: no counts, readings, people or events.
    case 'checklist':
      return {
        title: 'ROLLOUT CHECKLIST', subtitle: `${form} · SAMPLE FORM`,
        rows: [['1', 'CHOCKS + GEAR PINS'], ['2', 'CONTROL SURFACES'], ['3', 'TIRES + BRAKES'], ['4', 'FLUID / LEAKS'], ['5', 'TOW PATH CLEAR']],
        lines: ['Blank template: not a live record'],
      };
    case 'floorplan': {
      const gym = scene === 'gym';
      return {
        title: gym ? 'OCCUPANCY STUDY' : 'ENTRY FLOW SKETCH', subtitle: `${form} · SCHEMATIC`,
        rows: gym ? [['A', 'FREE WEIGHTS'], ['B', 'CARDIO'], ['C', 'STRETCH'], ['D', 'DESK']] : [['A', 'ENTRY'], ['B', 'WAITING'], ['C', 'CORRIDOR'], ['D', 'DESK']],
        lines: ['Illustrative layout: no counts shown'],
      };
    }
    case 'siteplan': {
      const road = scene === 'road';
      return {
        title: road ? 'OBSERVATION LAYOUT' : 'SITE LAYOUT', subtitle: `${form} · ${road ? 'BLANK TALLY TEMPLATE' : 'WALKWAY SKETCH'}`,
        rows: [['PT A', road ? 'KERB SIDE' : 'MAIN GATE'], ['PT B', road ? 'CROSSING' : 'COURTYARD']],
        lines: ['Sketch only, not to scale'],
      };
    }
    case 'ledger': {
      const dock = scene === 'dock';
      return {
        title: dock ? 'BERTH SHEET' : 'VISIT LOG', subtitle: `${form} · SAMPLE FORM`,
        rows: dock ? [['VESSEL', '— — —'], ['BERTH', `Q-${2 + (slot % 5)}`], ['CARGO', '— — —'], ['WINDOW', '--:-- / --:--']]
          : [['DATE', '— — —'], ['AREA', place.toUpperCase()], ['ENTRY', '--:--'], ['EXIT', '--:--']],
        lines: ['Blank template: no entries recorded'],
      };
    }
    case 'dossier':
      return {
        title: 'SITE RECORD', subtitle: place.toUpperCase(),
        rows: [
          ['NODE', `ND-${100 + slot * 7}`], ['SECTOR', `${'ABCDEF'[slot % 6]}-${2 + (slot * 3) % 7}`],
          ['COVERAGE', `${42 + slot * 5}%`], ['LAST SYNC', `${two(slot % 24)}:${two((slot * 13) % 60)}:${two((slot * 29) % 60)}`],
          ['STATUS', slot % 4 === 3 ? 'ARCHIVED' : 'NOMINAL'],
        ],
        lines: [NOTES[slot % NOTES.length]],
      };
    case 'news': {
      const h = HEADLINES[slot % HEADLINES.length];
      return { title: 'LOCAL BULLETIN', subtitle: `${place.toUpperCase()} · ISSUE ${12 + slot * 3}`, rows: [], lines: [`${h[0]}`, `${h[1]}.`, `Filed by the ${place} desk.`] };
    }
    case 'location':
      return {
        title: 'LOCATION', subtitle: place.toUpperCase(),
        rows: [['GRID', `${10 + slot * 4}-${'KLMNPQRSTU'[slot % 10]} / ${20 + (slot * 7) % 30}`], ['ELEV', `${3 + slot * 6} M`], ['ZONE', `HARBOUR ${1 + (slot % 3)}`]],
        lines: [],
      };
    default:
      return {
        title: 'SIMULATED SIGNAL', subtitle: `CH ${slot + 1} · SYNTHETIC`,
        rows: [['FREQ', `${(1.2 + slot * 0.35).toFixed(2)} HZ`], ['AMP', `${(0.3 + (slot % 5) * 0.1).toFixed(2)} ARB.`]],
        lines: [],
      };
  }
}

type PanelBase = Omit<PanelSpec, 'kind'>;
// Right-hand (side = 1) landscape groupings and below-the-pane (side = 1) portrait stacks, three per orientation.
// Extents stay within ~22.5 world units of the stop (landscape) / ~27.5 below it (portrait) so every aspect keeps them in view.
const LAND: readonly (readonly [PanelBase, PanelBase])[] = [
  [{ w: 10, h: 6.5, dx: 16, dy: 2.5, dz: -3, ry: -0.12 }, { w: 11, h: 4.2, dx: 16.5, dy: -5, dz: 2, ry: -0.12 }],
  [{ w: 9, h: 5.8, dx: 15.5, dy: 4.8, dz: 1.5, ry: -0.1 }, { w: 8, h: 3.6, dx: 18.5, dy: -3.8, dz: -4, ry: -0.14 }],
  [{ w: 10.5, h: 6.6, dx: 16.5, dy: -1.5, dz: -1, ry: -0.08 }, { w: 8.5, h: 3.4, dx: 17, dy: 5.5, dz: 3, ry: -0.14 }],
];
const PORT: readonly (readonly [PanelBase, PanelBase])[] = [
  [{ w: 20, h: 12.5, dx: 0, dy: -12, dz: -2, ry: 0.06 }, { w: 14, h: 8.75, dx: 3, dy: -23.5, dz: 2, ry: -0.06 }],
  [{ w: 18, h: 11.25, dx: -3, dy: -11.5, dz: 1, ry: 0.05 }, { w: 14, h: 8.75, dx: 4, dy: -22, dz: -2, ry: -0.05 }],
  [{ w: 21, h: 13.1, dx: 1, dy: -12.5, dz: -3, ry: -0.04 }, { w: 12, h: 7.5, dx: -4.5, dy: -23.5, dz: 2, ry: 0.06 }],
];

/**
 * Two restrained companion panels attached to a stop: a site/document record plus a small second record or the
 * simulated waveform. Kinds, grouping and depth vary with the slot; they sit on the side opposite the pane's offset
 * (mirrored with `stopSide`) and never overlap the pane.
 */
export function panelLayout(slot: number, aspect: number, feedId?: string | null): PanelSpec[] {
  const [k1, k2] = companionKinds(slot, feedId);
  const side = stopSide(slot);
  const land = aspect >= 1;
  const [a, b] = (land ? LAND : PORT)[slot % 3];
  const place = (p: PanelBase, kind: PanelKind): PanelSpec =>
    land ? { kind, ...p, dx: p.dx * side, ry: p.ry * side } : { kind, ...p, dx: p.dx * side, dy: p.dy * side, ry: p.ry * side };
  return [place(a, k1), place(b, k2)];
}

// ---------------------------------------------------------------- background planes

export interface BgPlane { x: number; y: number; z: number; w: number; texture: number; ry: number; shade: number; micro?: true }

const LOC = FLOAT_STOPS;
/** Piecewise-linear traversal axis through the stops (clamped drift beyond both ends). */
export function axisAt(z: number): readonly [number, number] {
  let i = 0;
  while (i < LAST - 1 && z < LOC[i + 1].z) i++;
  const a = LOC[i]; const b = LOC[i + 1];
  const t = clamp((a.z - z) / (a.z - b.z), -0.4, 1.4);
  return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
}

/** Micro layer: one step every 3.2 units of depth, 4 planes per step (~2000 planes over the ~1740-unit field). */
export const MICRO_STEP = 3.2;
export const MICRO_PER_STEP = 4;
export const MICRO_CLEAR = 36;
/** Column around each stop kept free of micro planes: radius (xy) and depth in front of the stop (past the portrait hold standoff). */
export const MICRO_STOP_CLEAR = 34;
export const MICRO_STOP_DEPTH = 100;

let cache: BgPlane[] | null = null;
let cacheVariants = 0;
let cacheFamily = '';

/**
 * Farthest-first picture choice for planes `from..end` (deterministic): each plane takes the existing poster whose nearest
 * earlier use is the FARTHEST away in plane-size units, and pictures of the same motif family (e.g. the aircraft-ramp or the
 * building-and-lawn clips) count as a near repeat at a reduced weight. So no neighbour (in depth or sideways, at any
 * layer scale) repeats a picture or its motif while another is available; with only 12 posters, repeats exist but are far apart.
 */
export function assignTextures(
  planes: BgPlane[], from: number, variants: number, family: readonly number[] | undefined, hash: (a: number, b: number) => number,
) {
  const fam = (t: number) => family?.[t] ?? t; // no family info: every picture is its own motif
  for (let i = from; i < planes.length; i++) {
    const p = planes[i];
    const best = new Array<number>(variants).fill(Infinity);
    for (let q = 0; q < i; q++) {
      const o = planes[q];
      // Build-order neighbours (the last 8 of this batch) also count as near, wherever they sit, so consecutive planes
      // never repeat a picture (the sequential-repeat bound) on top of the spatial rule.
      const seq = q >= Math.max(from, i - 8) ? (i - q) * 0.9 : Infinity;
      let d = seq;
      if (Math.abs(o.z - p.z) <= 140) d = Math.min(d, Math.hypot(o.x - p.x, (o.y - p.y) * 1.4, (o.z - p.z) * 0.6) / ((p.w + o.w) / 2 + 3));
      if (d > 60) continue;
      for (let t = 0; t < variants; t++) {
        const dd = o.texture === t ? d : fam(o.texture) === fam(t) ? d * 1.7 : Infinity;
        if (dd < best[t]) best[t] = dd;
      }
    }
    let pick = 0; let top = -1;
    for (let t = 0; t < variants; t++) {
      const score = Math.min(best[t], 1000) + hash(i * 3.17 + t * 5.3, p.z + t) * 0.05;
      if (score > top) { top = score; pick = t; }
    }
    p.texture = pick;
  }
}
/**
 * About two thousand+ background planes: layered shells, asymmetric clusters around every stop (the last densest),
 * a loose tail, and a dim far backdrop. An elliptical corridor around the route is kept clear. Deterministic.
 */
export function buildBackground(variants: number, family?: readonly number[]): BgPlane[] {
  if (cache && cacheVariants === variants && cacheFamily === (family?.join(',') ?? '')) return cache;
  cacheFamily = family?.join(',') ?? '';
  const out: BgPlane[] = [];
  const add = (x: number, y: number, z: number, w: number, shade: number, minClear = 30) => {
    const [cx, cy] = axisAt(z);
    if (Math.hypot((x - cx) / 1.25, (y - cy) / 0.95) < minClear + w * 0.45) return;
    // The route axis slopes steeply between laterally displaced stops, so the corridor alone no longer surrounds the line
    // from a hold camera to its pane: keep a column around EVERY stop (behind it to past the camera standoff) free of
    // every background plane, so nothing sits between the camera and the focal pane or its companion cards.
    if (LOC.some((st) => z > st.z - 30 && z < st.z + MICRO_STOP_DEPTH && Math.hypot(x - st.x, y - st.y) < MICRO_STOP_CLEAR + w * 0.5)) return;
    const rr = randomAt(x * 3.1 + y * 1.7 + z * 0.37);
    out.push({ x, y, z, w, texture: 0, shade, ry: rr < 0.12 ? -0.1 : rr > 0.88 ? 0.1 : 0 });
  };
  const tiers = [
    { r0: 30, r1: 48, w0: 3.5, w1: 7, n: 3, shade: 0.7 },
    { r0: 46, r1: 86, w0: 6, w1: 12, n: 3, shade: 0.85 },
    { r0: 84, r1: 155, w0: 10, w1: 19, n: 3, shade: 1 },
    { r0: 150, r1: 270, w0: 15, w1: 28, n: 2, shade: 0.8 },
  ];
  const tailZ = LOC[LAST].z - 400;
  const shellSteps = Math.ceil((90 - tailZ) / 10.1);
  for (let s = 0; s < shellSteps; s++) {
    const z = 90 - s * 10.1 + (randomAt(s + 9) - 0.5) * 5;
    tiers.forEach((tier, t) => {
      const count = tier.n + (randomAt(s * 7 + t) < 0.5 ? 1 : 0);
      const base = s * 2.399 + t * 2.1 + (randomAt(s + t * 50) - 0.5) * 1.1;
      for (let j = 0; j < count; j++) {
        const k = s * 31 + t * 9 + j;
        if (randomAt(k + 5000) < 0.16 * (1 + Math.sin(z * 0.021 + t * 2)) + Math.max(0, (s / shellSteps - 0.82) / 0.18) * 0.55) continue;
        const a = base + (j * Math.PI * 2) / count + (randomAt(k + 11) - 0.5) * 0.5;
        const r = tier.r0 + (tier.r1 - tier.r0) * randomAt(k + 23);
        const [cx, cy] = axisAt(z);
        add(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 0.95, z + (randomAt(k + 37) - 0.5) * 6,
          tier.w0 + (tier.w1 - tier.w0) * randomAt(k + 53), tier.shade * (0.6 + 0.4 * randomAt(k + 71)));
      }
    });
  }
  LOC.forEach((p, k) => {
    const ba = k * 2.1 + 0.7;
    const ox = Math.cos(ba) * 34; const oy = Math.sin(ba) * 20;
    const count = 42 + (k % 3) * 8 + (k === LAST ? 56 : 0);
    for (let j = 0; j < count; j++) {
      const n = 4000 + k * 200 + j;
      add(p.x + ox + (randomAt(n) + randomAt(n + 7) - 1) * 40, p.y + oy + (randomAt(n + 31) + randomAt(n + 37) - 1) * 25,
        p.z + (randomAt(n + 63) + randomAt(n + 67) - 1) * 85, 3.5 + randomAt(n + 95) * 6.5, 0.55 + 0.45 * randomAt(n + 120), 27);
    }
  });
  for (let j = 0; j < 34; j++) {
    const n = 9000 + j; const p = LOC[LAST];
    add(p.x * 0.5 + (randomAt(n) + randomAt(n + 7) - 1) * 45, p.y * 0.5 + (randomAt(n + 31) + randomAt(n + 37) - 1) * 28,
      p.z - 170 + (randomAt(n + 63) + randomAt(n + 67) - 1) * 110, 3.5 + randomAt(n + 95) * 6.5, 0.5 + 0.35 * randomAt(n + 120), 27);
  }
  // Wide field. Three independent depth layers well off the route so travel produces obvious parallax, and the field
  // continues across (and far beyond) every viewport, portrait included:
  //  - displaced context groups ("wings"): small clusters of mid-size planes 105..190 units to either side of each stop;
  //  - a near layer of larger planes just outside the corridor, drifting past the camera during legs;
  //  - a far, dim, large layer 240..520 units out, giving a wide backdrop that parallaxes slowest.
  // All go through `add`, so the route corridor and every stop column stay clear.
  LOC.forEach((p, k) => {
    for (const sd of [-1, 1]) {
      const gz = p.z - 30 + (randomAt(k * 13 + sd * 5 + 700) - 0.5) * 180;
      const [cx, cy] = axisAt(gz);
      const gx = cx + sd * (105 + randomAt(k * 17 + sd + 710) * 85);
      const gy = cy + (randomAt(k * 19 + sd * 3 + 720) - 0.5) * 70;
      const count = 7 + Math.floor(randomAt(k * 23 + sd + 730) * 6);
      for (let j = 0; j < count; j++) {
        const n = 11000 + k * 97 + (sd > 0 ? 50 : 0) + j * 3;
        add(gx + (randomAt(n) + randomAt(n + 7) - 1) * 34, gy + (randomAt(n + 31) + randomAt(n + 37) - 1) * 20,
          gz + (randomAt(n + 63) + randomAt(n + 67) - 1) * 60, 6 + randomAt(n + 95) * 9, 0.6 + 0.4 * randomAt(n + 120), 27);
      }
    }
  });
  const wideSteps = Math.floor((90 - tailZ) / 15);
  for (let s = 0; s < wideSteps; s++) {
    const z = 90 - s * 15 - randomAt(s + 800) * 8;
    const [cx, cy] = axisAt(z);
    const sd = randomAt(s + 810) < 0.5 ? -1 : 1;
    add(cx + sd * (60 + randomAt(s + 820) * 55), cy + (randomAt(s + 830) - 0.5) * 110, z, 12 + randomAt(s + 840) * 11, 0.78 + 0.22 * randomAt(s + 850), 27); // near
    const sf = randomAt(s + 860) < 0.5 ? -1 : 1;
    add(cx + sf * (240 + randomAt(s + 870) * 280), cy + (randomAt(s + 880) - 0.5) * 300, z - randomAt(s + 890) * 30, 24 + randomAt(s + 900) * 20, 0.34 + 0.2 * randomAt(s + 910), 27); // far
  }
  const backCount = Math.ceil((60 - tailZ) / 10.4);
  for (let i = 0; i < backCount; i++) {
    const z = 60 - (i / backCount) * (60 - tailZ) + (randomAt(i + 300) - 0.5) * 10;
    const a = i * 2.399 + randomAt(i + 400) * 0.6;
    const r = 150 + randomAt(i + 500) * 130;
    const [cx, cy] = axisAt(z);
    add(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 0.9, z, 22 + randomAt(i + 600) * 18, 0.5 + 0.2 * randomAt(i + 700));
  }
  // Spatially hashed texture choice, re-rolled when a nearby plane shows the same picture.
  const hash = (a: number, b: number) => randomAt(a * 12.9898 + b * 78.233);
  assignTextures(out, 0, variants, family, hash);
  // Fine micro-camera texture: many small, dim planes well outside the corridor (so they never cover the focused pane
  // or its companion panels), in a near-micro and a farther, dimmer sub-layer. They reuse the existing poster textures
  // through the same instanced batches, so they add planes (CPU matrices, GPU fill) but no draw calls, decoders or media.
  const microStart = out.length;
  const microSteps = Math.floor((90 - tailZ) / MICRO_STEP);
  for (let s = 0; s < microSteps; s++) {
    const z0 = 90 - s * MICRO_STEP;
    for (let j = 0; j < MICRO_PER_STEP; j++) {
      const k = 20000 + s * 11 + j;
      const far = j >= MICRO_PER_STEP / 2;
      const z = z0 - randomAt(k + 3) * MICRO_STEP * 1.4;
      const a = s * 2.399 + j * 1.7 + randomAt(k + 9) * 1.9; // golden-angle sweep + jitter: no visible grid or ring
      // Wide in x (the field continues far past any viewport), shallower in y; the far sub-layer reaches ~850 units sideways.
      const r = far ? 120 + randomAt(k + 17) * 330 : 44 + randomAt(k + 17) * 120;
      const [cx, cy] = axisAt(z);
      const px = cx + Math.cos(a) * r * (far ? 1.9 : 1.4); const py = cy + Math.sin(a) * r * 0.95;
      const pw = far ? 2.6 + randomAt(k + 29) * 2.6 : 1.5 + randomAt(k + 29) * 1.8;
      // The corridor is measured from the local axis, which drifts away from a stop between stops; so also keep a
      // column around every stop (from behind it to past the camera standoff) clear: pane + companion footprint.
      if (LOC.some((st) => z > st.z - 30 && z < st.z + MICRO_STOP_DEPTH && Math.hypot(px - st.x, py - st.y) < MICRO_STOP_CLEAR + pw)) continue;
      add(px, py, z, pw, far ? 0.28 + 0.14 * randomAt(k + 41) : 0.45 + 0.2 * randomAt(k + 41), MICRO_CLEAR);
    }
  }
  for (let i = microStart; i < out.length; i++) out[i].micro = true;
  assignTextures(out, microStart, variants, family, hash);
  cache = out; cacheVariants = variants;
  return out;
}
