import { clamp } from './geometry';

/**
 * ONE spatial scale for the whole globe leg, in both directions (pure, DOM-free).
 *
 * The earth has a fixed radius. The camera's altitude is a log zoom `m`: how many screen px one px of the camera-network
 * mosaic occupies. The mosaic (3 screens wide) is authored to stand for a ~NETWORK_KM wide local patch, so
 *      R(m) = m * (EARTH_KM / NETWORK_KM) * worldWidth        (px of the earth radius at that zoom)
 * and the SAME `m` places the feed tiles (DOM), the thumbnail field and the geography (canvas, orthographic about the
 * selected camera's location). At m = 1 the screen shows dozens of adjacent feeds; the earth is then ~100 screens wide, so
 * the limb / curvature only appears once R drops below the viewport's far corner, near the very end of the leg.
 *
 * Leg time T runs 0 (selected pane fullscreen) .. 1 (globe hold); the inbound entry is exactly the reverse (T = 1 - p).
 * Sector "tile" (T < TIME_A): the pane lerps between its start rect and its own mosaic tile (m = 1).
 * Sector "zoom": log zoom m = 1 .. mHold with the tile staying at its geographic point.
 * The network scale is a schematic: it does not claim the footage was recorded anywhere (see README / demo labels).
 */
export const EARTH_KM = 6371;
/** Authored span (km) that the 3-screen camera-network mosaic stands for: a schematic regional scale, not a survey. */
export const NETWORK_KM = 60;

/** Leg durations, in multiples of the base travel time. Outbound = CONTRACT_K + OUT_K; inbound entering = LEG_K. */
export const CONTRACT_K = 1.6;
export const OUT_K = 6.4;
export const LEG_K = CONTRACT_K + OUT_K;
/** Share of the leg's duration spent in the "tile" sector. */
export const TIME_A = CONTRACT_K / LEG_K;

/** Gentle ease: some deceleration at both ends but a near-constant log-zoom rate through the middle stages. */
export const legEase = (t: number) => {
  const c = clamp(t, 0, 1);
  return 0.35 * c + 0.65 * c * c * (3 - 2 * c);
};

/** Local half pacing: preserve global T>=.5 exactly; traverse local spatial ease faster towards the pane.
 * Clock is an analytic integral in spatial legEase units, so reversing dt retraces the exact same curve.
 * Desired local spatial velocity rises from midpoint1.325 to pane3.3125, cancelling the old terminal ease-out.
 */
const LOCAL_RATE = 1.325;
const LOCAL_GAIN = Math.sqrt(1.5);
export const LOCAL_CLOCK_END = Math.atan(LOCAL_GAIN) / (2 * LOCAL_GAIN * LOCAL_RATE);
export function globeLegClock(T: number): number {
  const t = clamp(T, 0, 1);
  if (t >= 0.5) return LOCAL_CLOCK_END + t - 0.5;
  return (Math.atan(LOCAL_GAIN) - Math.atan(LOCAL_GAIN * (1 - 2 * legEase(t)))) / (2 * LOCAL_GAIN * LOCAL_RATE);
}
export function globeLegTime(clock: number): number {
  const c = clamp(clock, 0, LOCAL_CLOCK_END + 0.5);
  if (c >= LOCAL_CLOCK_END) return 0.5 + c - LOCAL_CLOCK_END;
  const target = (1 - Math.tan(Math.atan(LOCAL_GAIN) - c * 2 * LOCAL_GAIN * LOCAL_RATE) / LOCAL_GAIN) / 2;
  let lo = 0; let hi = 0.5;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (legEase(mid) < target) lo = mid; else hi = mid; }
  return c === 0 ? 0 : (lo + hi) / 2;
}
export const advanceGlobeLeg = (T: number, delta: number) => globeLegTime(globeLegClock(T) + delta);

const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const smoothstep = (a: number, b: number, x: number) => smooth01((x - a) / (b - a));

/** Earth radius expressed in px of the (3-screen) mosaic world. */
export const earthWorldPx = (worldWidth: number) => (EARTH_KM / NETWORK_KM) * worldWidth;
/** The mosaic scale at which the earth radius equals the globe hold's radius. */
export const holdScale = (rHold: number, worldWidth: number) => rHold / earthWorldPx(worldWidth);
/** On-screen earth radius at mosaic scale m. */
export const radiusAt = (m: number, worldWidth: number) => m * earthWorldPx(worldWidth);

/**
 * Late-outbound pacing: from the regional network to the whole earth the outbound leg runs up to 14% faster. The speed
 * factor is a smoothstep of the leg's own progress `p` (1 until 0.55, 1.14 from 0.80), so progress and speed stay
 * continuous (no jump). Only the outbound legs (globeOut and neuralOut) use it: the inbound `entering` leg (whose history
 * reverse is the selected -> globe pullback's mirror) keeps its approved approach speed, and every other leg is untouched.
 * A reversed neuralOut replays the very same progress curve backwards.
 */
export const OUTBOUND_LATE_SPEEDUP = 0.14;
export const outboundLateBoost = (p: number) => 1 + OUTBOUND_LATE_SPEEDUP * smoothstep(0.55, 0.8, p);

export interface LegProgress { progress: number; globeP: number; travelP: number }

/** Leg time T (0 = fullscreen / start pane, 1 = globe hold) of a spatial stage, or null when the stage is not one. */
export function legTime(stage: string, s: LegProgress, globeLeg: boolean): number | null {
  switch (stage) {
    case 'contracting': return globeLeg ? TIME_A * (1 - clamp(s.progress, 0, 1)) : null;
    case 'globeOut': return TIME_A + (1 - TIME_A) * clamp(s.globeP, 0, 1);
    case 'neuralOut': return clamp(s.globeP, 0, 1);
    case 'entering': return 1 - clamp(s.travelP, 0, 1);
    default: return null;
  }
}

export interface Pose {
  sector: 'tile' | 'zoom';
  /** Tile sector: 1 = start rect (fullscreen), 0 = the tile at network scale 1. */
  e: number;
  /** Mosaic scale (px per mosaic px). 1 in the tile sector. */
  m: number;
  /** 0 at m = 1, 1 at the globe hold. */
  zeta: number;
}

export function poseAt(T: number, mHold: number): Pose {
  const zz = legEase(T);
  const zA = legEase(TIME_A);
  if (zz <= zA) return { sector: 'tile', e: 1 - zz / zA, m: 1, zeta: 0 };
  const zeta = clamp((zz - zA) / (1 - zA), 0, 1);
  return { sector: 'zoom', e: 0, m: Math.exp(Math.log(mHold) * zeta), zeta };
}

export interface Pt { x: number; y: number }

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Screen rect of the ONE focal pane of a globe bridge, both directions. Centre AND size run continuously from the start
 * rect (fullscreen: exactly the viewport centre / size at e = 1) to the camera's own tile size standing at `a1`, then
 * follow the shared zoom. `a1` is the bridge's final-focus point (the shared focal point for camera bridges), never the
 * tile's arbitrary mosaic position, so a bridge's first / last frames cannot slip off-centre or clip.
 */
export function focusRect(p: Pose, tileW: number, tileH: number, a1: Pt, focal: Pt, start: Box): Box {
  if (p.sector === 'tile') {
    const e = clamp(p.e, 0, 1);
    const w = tileW + (start.w - tileW) * e; const h = tileH + (start.h - tileH) * e;
    const cx = a1.x + (start.x + start.w / 2 - a1.x) * e; const cy = a1.y + (start.y + start.h / 2 - a1.y) * e;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  const c = anchorAt(p, a1, focal);
  const w = tileW * p.m; const h = tileH * p.m;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/**
 * neuralOut retreat -> field seam (pure). The network pulls back for exactly the leg's tile sector (T <= TIME_A); the DOM
 * pane IS the departing screen's projection drawn by that camera. At T = TIME_A the pull-back stops at a calibrated,
 * still-readable size (`seam`), and the pane continues as a synthetic field tile of exactly the seam's width/height
 * standing at the seam's centre: the shared zoom `m` (1 at the seam) then only ever shrinks it, so size, aspect and
 * position are continuous across the seam and monotonic outward. Forward and reversed legs use the same function of T.
 */
export const RETREAT_SEAM_RATIO = 0.3; // seam width as a share of the held screen's width (never a collapse to ~0)
/** Network pull-back amount (0..1 of the full dolly) at leg progress p: complete exactly at the seam. */
export const retreatAmount = (p: number) => smoothstep(0, TIME_A, p);
/** Opacity of the network: it gives way to the field around the pane across the seam, not before it. */
export const retreatNetworkOpacity = (p: number) => 1 - smoothstep(0.6 * TIME_A, 1.6 * TIME_A, p);

/** Smallest dolly in 0..1 whose projected width is <= ratio x the width at dolly 0 (width must not grow with dolly). */
export function solveRetreatDolly(widthAt: (dolly: number) => number, ratio = RETREAT_SEAM_RATIO): number {
  const target = widthAt(0) * ratio;
  if (!(widthAt(1) < target)) return 1;
  let lo = 0; let hi = 1;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (widthAt(mid) > target) lo = mid; else hi = mid; }
  return hi;
}

export function neuralOutRect(T: number, mHold: number, drawn: Box | null, seam: Box, focal: Pt): Box {
  if (T <= TIME_A && drawn) return drawn;
  const c = { x: seam.x + seam.w / 2, y: seam.y + seam.h / 2 };
  return focusRect(poseAt(Math.max(T, TIME_A), mHold), seam.w, seam.h, c, focal, seam);
}

/** Screen position of the selected camera's location: its tile centre at m = 1, settling on the globe's focal point. */
export function anchorAt(p: Pose, tileAtOne: Pt, focal: Pt): Pt {
  const w = smooth01(p.zeta / 0.55);
  return { x: tileAtOne.x + (focal.x - tileAtOne.x) * w, y: tileAtOne.y + (focal.y - tileAtOne.y) * w };
}
