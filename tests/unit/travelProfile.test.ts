import { describe, expect, it } from 'vitest';
import { JourneyController, NEURAL_LEG_SCALE_MAX, isHoldStage, yearAxis } from '../../src/journey/controller';
import { CITIES } from '../../src/journey/globe';
import { planFloatRoute } from '../../src/journey/floatField';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';
import {
  APPROACH_FRACTION, MAX_ANGULAR_SPEED, buildTravelProfile, poseDistance, smoothstep01, type CameraPose, type PoseSampler,
} from '../../src/journey/neuralSource/travelProfile';

// Synthetic authored track with an unrelated "corridor" in the middle (a big sideways excursion + sharp turn):
// the direct curve must never sample or follow it.
const A = 16.89426; const B = 26.38177;
const sharp = (t: number) => smoothstep01((t - 20.5) / 2.2);
let sampled: number[] = [];
const sampler: PoseSampler = (t): CameraPose => {
  sampled.push(t);
  const yaw = 2.2 * sharp(t) + 0.02 * (t - A);
  const x = 40 * (t - A) + 260 * sharp(t);
  const z = 900 * Math.sin(Math.PI * (t - A) / (B - A)); // authored detour through intermediate poses
  return { p: [x, 5, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
};
const legs: [number, number][] = [[A, B], [B, A], [3, 3.0000001]];

describe('neural travel profile (direct endpoint legs)', () => {
  it('samples only the two authored endpoints and hits their exact poses', () => {
    for (const [from, to] of legs) {
      sampled = [];
      const prof = buildTravelProfile(from, to, sampler);
      expect(new Set(sampled)).toEqual(new Set([from, to]));
      const ref = (t: number): CameraPose => { const s = sampler(t); return s; };
      expect(prof.poseAt(0)).toEqual(ref(from)); expect(prof.poseAt(1)).toEqual(ref(to));
      expect(prof.timeAt(0)).toBe(from); expect(prof.timeAt(1)).toBe(to);
      for (let i = 1; i < 40; i++) expect([from, to]).toContain(prof.timeAt(i / 40)); // scene state never an intermediate time
    }
  });

  it('the direct path ignores the authored detour and stays near the chord', () => {
    const prof = buildTravelProfile(A, B, sampler);
    const a = prof.poseAt(0).p; const b = prof.poseAt(1).p;
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let i = 1; i < 40; i++) {
      const p = prof.poseAt(i / 40).p;
      // distance from the chord line
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / (chord * chord);
      const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      expect(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).toBeLessThanOrEqual(0.75 * APPROACH_FRACTION * chord * 1.001);
    }
  });

  it('arrives along the destination view axis: target never closer than the final distance, stays in bounds, no overshoot', () => {
    // Realistic: destination camera 300 units in front of its screen (at T), looking down -Z; source is off to the side, farther out.
    const T = [0, 0, 0]; const D = 300;
    const bPose: CameraPose = { p: [T[0], T[1], T[2] + D], q: [0, 0, 0, 1] };
    const aPose: CameraPose = { p: [600, 100, 500], q: [0, 0, 0, 1] };
    const prof = buildTravelProfile(1, 2, (t) => (t === 1 ? aPose : bPose));
    const dist = (p: CameraPose) => Math.hypot(p.p[0] - T[0], p.p[1] - T[1], p.p[2] - T[2]);
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const pose = prof.poseAt(i / 100);
      expect(dist(pose)).toBeGreaterThanOrEqual(D * 0.999);        // never inside the viewing distance
      if (i >= 70) {
        expect(dist(pose)).toBeLessThanOrEqual(prev + 1e-9);          // monotonic late approach (no scale overshoot / retreat)
        const depth = pose.p[2] - T[2];
        const ang = Math.atan2(Math.hypot(pose.p[0] - T[0], pose.p[1] - T[1]), depth);
        expect(ang).toBeLessThan(0.35);                              // target stays well inside a ~50 deg view
      }
      prev = dist(pose);
    }
    // Exit is the mirror: backs away along the source axis (first frames move away from the source's target side).
    expect(prof.poseAt(0.05).p[2]).toBeGreaterThan(aPose.p[2] - 1e-9);
    // Exact reverse of the same recorded curve.
    const rev = buildTravelProfile(2, 1, (t) => (t === 1 ? aPose : bPose));
    for (const p of [0.2, 0.6, 0.9]) expect(poseDistance(prof.poseAt(p), rev.poseAt(1 - p)).pos).toBeLessThan(1e-9);
  });

  it('a reversed leg is exactly the same curve traversed backwards', () => {
    const f = buildTravelProfile(A, B, sampler); const r = buildTravelProfile(B, A, sampler);
    for (const p of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      const d = poseDistance(f.poseAt(p), r.poseAt(1 - p));
      expect(d.pos).toBeLessThan(1e-9); expect(d.ang).toBeLessThan(1e-6);
    }
  });

  it('is smooth: position and orientation advance together with no step or spike', () => {
    const prof = buildTravelProfile(B, A, sampler);
    const N = 300; const total = poseDistance(prof.poseAt(0), prof.poseAt(1));
    let maxPos = 0; let maxAng = 0; let prev = prof.poseAt(0);
    for (let i = 1; i <= N; i++) {
      const cur = prof.poseAt(i / N); const d = poseDistance(prev, cur);
      maxPos = Math.max(maxPos, d.pos); maxAng = Math.max(maxAng, d.ang); prev = cur;
    }
    // Derived bound: position advances by arc length with smoothstep easing, so the peak step is 1.5 x (path length / N)
    // (not tied to the chord); the path itself stays a modest detour of the chord.
    let arc = 0; let pp = prof.poseAt(0).p;
    for (let i = 1; i <= 4000; i++) { const c = prof.poseAt(i / 4000).p; arc += Math.hypot(c[0] - pp[0], c[1] - pp[1], c[2] - pp[2]); pp = c; }
    expect(arc).toBeLessThan(total.pos * 1.8);
    expect(maxPos).toBeLessThan((arc * 1.5) / N * 1.05);
    expect(maxAng).toBeLessThan((total.ang * 1.5) / N * 1.2);
    // coordinated: fraction of turn tracks fraction of travel
    for (const p of [0.25, 0.5, 0.75]) {
      const part = poseDistance(prof.poseAt(0), prof.poseAt(p));
      expect(Math.abs(part.ang / total.ang - smoothstep01(p))).toBeLessThan(0.05);
    }
  });

  it('extends only the leg that needs it, bounded', () => {
    const calm = buildTravelProfile(0, 9, (t) => ({ p: [t * 1, 0, 0], q: [0, 0, 0, 1] }));
    expect(calm.durationScale(3)).toBe(1);
    const far = buildTravelProfile(0, 9, (t) => ({ p: [t * 1000, 0, 0], q: [0, 0, 0, 1] }));
    expect(far.durationScale(3)).toBeGreaterThan(1);
    expect(far.durationScale(3)).toBeLessThanOrEqual(NEURAL_LEG_SCALE_MAX);
    const spin = buildTravelProfile(0, 1, (t) => ({ p: [0, 0, 0], q: [0, Math.sin(t * 1.5), 0, Math.cos(t * 1.5)] }));
    expect(spin.durationScale(0.5)).toBe(NEURAL_LEG_SCALE_MAX);
    expect(MAX_ANGULAR_SPEED).toBeGreaterThan(0);
  });

  it('keeps the move bounded and reaches the hold gate (controller)', () => {
    const times = [10, 19.4, 28.8];
    // Same supported sequence as neural.test.ts: two camera legs (after: 2), then the neural intent enters the scene.
    const feedIds = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130'];
    const W = 3000; const VW = 1000; const YEARS = 8;
    const mosaic = generateMosaic({ width: W, height: 700, tileCount: 60, feedCount: feedIds.length, seed: 11 });
    const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
    const ax = yearAxis(W, VW, YEARS);
    const run = (scale?: (a: number, b: number, base: number) => number) => {
      const c: JourneyController = new JourneyController({
        worldWidth: W, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches: [{ kind: 'neural', after: 2, stops: 3 }],
        floatPlan: planFloatRoute,
        neuralPlan: (from) => ({ feeds: [from ?? 'm01', 'm02', 'm03'], anchors: [0, 1, 2], times }),
        neuralLegScale: scale,
        planner: (leg) => {
          const cur = tiles.find((t) => t.id === c.state.selectedId);
          const p = planLeg({ tiles, vw: VW, worldW: W, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
          return p && { id: p.id, x: p.x };
        },
        anchorFeed: (feedId, worldX) =>
          reanchorTile({ tiles, feedIndex: feedIds.indexOf(feedId), vw: VW, worldW: W, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
        feedOfTile: (id) => (id ? feedIds[tiles.find((t) => t.id === id)!.feedIndex] : null),
      });
      const toHold = () => { let ms = 0; for (; ms < 64000 && !isHoldStage(c.state.stage); ms += 16) c.update(16); return ms; };
      for (let i = 0; i < 2; i++) { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(); }
      expect(c.dispatch({ type: 'intent' })).toBe(true); toHold();
      expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(0); // entry reached its hold
      expect(c.dispatch({ type: 'intent' })).toBe(true);
      expect(c.state.stage).toBe('neuralMove');
      const move = toHold();
      expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(1);
      return move;
    };
    const base = run();
    const wide = run(() => 99); // provider is clamped by the controller
    expect(wide).toBeLessThanOrEqual(base * NEURAL_LEG_SCALE_MAX + 40);
    expect(run(() => 1)).toBe(base);
    expect(isHoldStage('neural')).toBe(true);
  });
});
