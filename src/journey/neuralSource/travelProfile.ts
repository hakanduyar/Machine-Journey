/**
 * Pose-aware time parameterization for one neural camera leg.
 *
 * The authored clip is never rewritten: a leg only chooses WHICH authored time is shown at wall progress `p`.
 * Instead of easing authored seconds (which concentrates fast camera motion wherever the clip is time-compressed),
 * the leg is sampled once into a table of real camera poses and progress is made uniform (then eased gently) in a
 * combined metric of position travelled + orientation change. Position and quaternion therefore advance together,
 * because both come from the same authored time. Pure and sampler-injected so it is unit-testable without WebGL.
 */
export interface CameraPose { p: readonly [number, number, number]; q: readonly [number, number, number, number] }

export type PoseSampler = (authoredSeconds: number) => CameraPose;

/** Metric weights: one unit of metric = PN scene units of travel, or AN radians of turn, or 1/TIME_W authored seconds. */
export const POS_NORM = 300;
export const ANG_NORM = 0.5;
/** Small time term so authored-static stretches are still traversed (never an instantaneous jump or a dead plateau). */
export const TIME_WEIGHT = 0.04;
/** Wall-clock limits the leg is allowed to reach; a leg that would exceed them gets a longer (bounded) duration. */
export const MAX_ANGULAR_SPEED = 0.45; // rad / wall second
export const MAX_LINEAR_SPEED = 200; // scene units / wall second
export const MAX_DURATION_SCALE = 1.5;

export const smoothstep01 = (p: number) => { const c = Math.min(1, Math.max(0, p)); return c * c * (3 - 2 * c); };

export function poseDistance(a: CameraPose, b: CameraPose): { pos: number; ang: number } {
  const pos = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const dot = Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]);
  return { pos, ang: 2 * Math.acos(Math.min(1, dot)) };
}

export interface TravelProfile {
  readonly from: number;
  readonly to: number;
  /** Endpoint authored time for scene state (`from` before the midpoint, `to` after; never an intermediate time). */
  timeAt(p: number): number;
  /** Direct camera pose at wall progress p in 0..1 (exact endpoint poses at 0 and 1). */
  poseAt(p: number): CameraPose;
  /** Peak linear / angular speed if the leg lasts `seconds` of wall time. */
  peaks(seconds: number, steps?: number): { linear: number; angular: number };
  /** Duration multiplier (>= 1, <= MAX_DURATION_SCALE) needed so the peaks stay within the limits for `baseSeconds`. */
  durationScale(baseSeconds: number): number;
}

/** How far behind each endpoint (along its own view axis) the approach control points sit, as a fraction of the chord. */
export const APPROACH_FRACTION = 0.4;

/** Unit vector pointing from a camera straight BACK away from what it looks at (+Z of the camera, world space). */
export function backAxis(q: readonly [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/**
 * Direct camera curve between two authored endpoint poses (no intermediate authored time is ever sampled):
 * eased axis-aligned Bezier position (see below), and a shortest-arc slerp of orientation on the same eased parameter.
 * Computed in canonical (from<to) order so a reversed leg is exactly the same curve traversed backwards.
 */
export function directPose(a: CameraPose, b: CameraPose, p: number): CameraPose {
  return directCurve(a, b)(p);
}

const ARC_STEPS = 64;

/**
 * Builds the curve once. Position advances by ARC LENGTH (eased with smoothstep), so linear speed is the gentle
 * smoothstep profile of the true path length (peak = 1.5 x mean) however the Bezier parameter is distributed, and the
 * orientation slerp rides the same eased fraction, keeping turn and travel coordinated.
 */
export function directCurve(a: CameraPose, b: CameraPose): (p: number) => CameraPose {
  const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
  const ha = backAxis(a.q); const hb = backAxis(b.q);
  const k = APPROACH_FRACTION * len;
  const c1 = [a.p[0] + ha[0] * k, a.p[1] + ha[1] * k, a.p[2] + ha[2] * k];
  const c2 = [b.p[0] + hb[0] * k, b.p[1] + hb[1] * k, b.p[2] + hb[2] * k];
  const bez = (s: number): [number, number, number] => {
    const u = 1 - s;
    const w0b = u * u * u; const w1b = 3 * u * u * s; const w2b = 3 * u * s * s; const w3b = s * s * s;
    return [
      w0b * a.p[0] + w1b * c1[0] + w2b * c2[0] + w3b * b.p[0],
      w0b * a.p[1] + w1b * c1[1] + w2b * c2[1] + w3b * b.p[1],
      w0b * a.p[2] + w1b * c1[2] + w2b * c2[2] + w3b * b.p[2],
    ];
  };
  const cum = [0]; let prevP = bez(0);
  for (let i = 1; i <= ARC_STEPS; i++) {
    const cur = bez(i / ARC_STEPS);
    cum.push(cum[i - 1] + Math.hypot(cur[0] - prevP[0], cur[1] - prevP[1], cur[2] - prevP[2]) + 1e-12);
    prevP = cur;
  }
  const total = cum[ARC_STEPS];
  const paramAt = (f: number): number => { // Bezier parameter at arc-length fraction f
    const m = f * total;
    let lo = 0; let hi = ARC_STEPS;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    return (lo + (m - cum[lo]) / (cum[hi] - cum[lo])) / ARC_STEPS;
  };
  return (p: number): CameraPose => {
    if (!(p > 0)) return a;
    if (p >= 1) return b;
    const s = smoothstep01(p); // eased fraction of the path (and of the turn)
    return poseAtFraction(s);
  };

  function poseAtFraction(s: number): CameraPose {
    const pos = bez(paramAt(s));
    return { p: pos, q: slerpQ(a.q, b.q, s) };
  }
}

function slerpQ(aq: readonly [number, number, number, number], bq: readonly [number, number, number, number], s: number): [number, number, number, number] {
  let dot = aq[0] * bq[0] + aq[1] * bq[1] + aq[2] * bq[2] + aq[3] * bq[3];
  const sg = dot < 0 ? -1 : 1; dot = Math.abs(dot);
  let w0: number; let w1: number;
  if (dot > 0.9995) { w0 = 1 - s; w1 = s; } else {
    const th = Math.acos(dot); const sn = Math.sin(th);
    w0 = Math.sin((1 - s) * th) / sn; w1 = Math.sin(s * th) / sn;
  }
  const q: [number, number, number, number] = [0, 0, 0, 0]; let n = 0;
  for (let i = 0; i < 4; i++) { q[i] = aq[i] * w0 + sg * bq[i] * w1; n += q[i] * q[i]; }
  n = Math.sqrt(n) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function buildTravelProfile(from: number, to: number, sample: PoseSampler): TravelProfile {
  const span = Math.abs(to - from);
  // Only the two authored endpoint poses are ever sampled.
  const pa = sample(from); const pb = sample(to);
  const forward = from <= to;
  // ONE canonical (lower authored time first) curve built once per leg; a reversed leg walks the very same curve backwards.
  const curve = forward ? directCurve(pa, pb) : directCurve(pb, pa);
  const poseAtP = (p: number): CameraPose => (forward ? curve(p) : curve(1 - p));

  /** Authored time for scene state (tonal treatment / video clock): the nearer endpoint, never an intermediate. */
  const timeAt = (p: number): number => (!(p > 0) ? from : p >= 1 ? to : p < 0.5 ? from : to);
  const poseAt = (p: number): CameraPose => poseAtP(p);

  const peaks = (seconds: number, steps = 96) => {
    let linear = 0; let angular = 0;
    const dt = seconds / steps;
    let prev = poseAtP(0);
    for (let i = 1; i <= steps; i++) {
      const cur = poseAtP(i / steps);
      const d = poseDistance(prev, cur);
      linear = Math.max(linear, d.pos / dt); angular = Math.max(angular, d.ang / dt);
      prev = cur;
    }
    return { linear, angular };
  };

  const durationScale = (baseSeconds: number): number => {
    if (!(baseSeconds > 0) || span <= 1e-6) return 1;
    const unit = peaks(1);
    const needed = Math.max(unit.linear / MAX_LINEAR_SPEED, unit.angular / MAX_ANGULAR_SPEED);
    return Math.min(MAX_DURATION_SCALE, Math.max(1, needed / baseSeconds));
  };

  return { from, to, timeAt, poseAt, peaks, durationScale };
}
