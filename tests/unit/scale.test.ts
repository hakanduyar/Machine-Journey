import { describe, expect, it } from 'vitest';
import { heldRadius } from '../../src/journey/globeOut';
import {
  LEG_K, RETREAT_SEAM_RATIO, TIME_A, anchorAt, focusRect, holdScale, legEase, legTime, neuralOutRect, poseAt, radiusAt,
  retreatAmount, solveRetreatDolly,
} from '../../src/journey/scale';

const VW = 1920; const VH = 1080; const WORLD = VW * 3;
const R0 = heldRadius(VW, VH);
const MH = holdScale(R0, WORLD);

describe('neuralOut retreat -> field seam', () => {
  const hold = { x: 600, y: 300, w: 666, h: 375 };
  const focal = { x: VW / 2, y: VH * 0.45 };
  // A perspective pull-back: projected size ~ 1 / (1 + 12 dolly); the dolly itself follows retreatAmount.
  const sizeAt = (d: number) => 1 / (1 + 12 * d);
  const proj = (d: number) => ({ w: hold.w * sizeAt(d), h: hold.h * sizeAt(d) });
  const cx = hold.x + hold.w / 2; const cy = hold.y + hold.h / 2;
  const rectAt = (d: number) => { const { w, h } = proj(d); return { x: cx - w / 2, y: cy - h / 2, w, h }; };
  const dolly = solveRetreatDolly((d) => proj(d).w);
  const seam = rectAt(dolly);
  const rectOfP = (p: number) => neuralOutRect(p, MH, rectAt(dolly * retreatAmount(p)), seam, focal);

  it('calibrates the pull-back to a readable seam (never a collapse to ~0)', () => {
    expect(seam.w / hold.w).toBeCloseTo(RETREAT_SEAM_RATIO, 3);
    expect(seam.w).toBeGreaterThan(100);
    expect(retreatAmount(0)).toBe(0); expect(retreatAmount(TIME_A)).toBeCloseTo(1, 12);
  });

  it('is continuous in size, aspect and centre across the seam and never grows outward', () => {
    const eps = 1e-6;
    const before = rectOfP(TIME_A - eps); const after = rectOfP(TIME_A + eps);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(before[k] - after[k])).toBeLessThan(0.05);
    expect(after.w / after.h).toBeCloseTo(hold.w / hold.h, 6);
    let prev = Infinity; let prevAspect = hold.w / hold.h;
    for (let i = 0; i <= 1000; i++) {
      const r = rectOfP(i / 1000);
      expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0);
      expect(r.w * r.h).toBeLessThanOrEqual(prev + 1e-6);
      expect(r.w / r.h).toBeCloseTo(prevAspect, 6);
      prev = r.w * r.h; prevAspect = r.w / r.h;
    }
    expect(rectOfP(0)).toEqual(rectAt(0)); // starts exactly on the held screen
  });

  it('past the seam the pane is the seam tile on the shared zoom (a pure function of p, so a reversed leg retraces it)', () => {
    for (const p of [0.25, 0.3, 0.34, 0.5, 0.9]) expect(rectOfP(p).w).toBeCloseTo(seam.w * poseAt(p, MH).m, 6);
    expect(rectOfP(0.34).w).toBeCloseTo(seam.w * poseAt(0.34, MH).m, 6);
  });
});

describe('one spatial scale', () => {
  it('leg time is continuous across the stages and reversible', () => {
    const p = { progress: 0, globeP: 0, travelP: 0 };
    expect(legTime('contracting', { ...p, progress: 1 }, true)).toBe(0);
    expect(legTime('contracting', { ...p, progress: 0 }, true)).toBeCloseTo(TIME_A, 12);
    expect(legTime('globeOut', { ...p, globeP: 0 }, false)).toBeCloseTo(TIME_A, 12);
    expect(legTime('globeOut', { ...p, globeP: 1 }, false)).toBeCloseTo(1, 12);
    expect(legTime('contracting', { ...p, progress: 0.5 }, false)).toBeNull(); // a camera leg is not a spatial leg
    expect(legTime('entering', { ...p, travelP: 0 }, false)).toBe(1); // starts at the globe hold ...
    expect(legTime('entering', { ...p, travelP: 1 }, false)).toBe(0); // ... ends at the fullscreen pane
    expect(legTime('neuralOut', { ...p, globeP: 0.4 }, false)).toBe(0.4);
    expect(legTime('globe', p, false)).toBeNull();
    expect(LEG_K).toBeGreaterThan(7); expect(LEG_K).toBeLessThan(10);
  });

  it('starts at the fullscreen pane, meets the tile at m = 1 and ends exactly at the held radius', () => {
    const a = poseAt(0, MH);
    expect(a.sector).toBe('tile'); expect(a.e).toBe(1);
    const b = poseAt(TIME_A, MH);
    expect(b.e).toBeCloseTo(0, 9); expect(b.m).toBe(1);
    const c = poseAt(TIME_A + 1e-6, MH);
    expect(c.sector).toBe('zoom'); expect(c.m).toBeCloseTo(1, 4);
    const z = poseAt(1, MH);
    expect(z.m).toBeCloseTo(MH, 12);
    expect(radiusAt(z.m, WORLD)).toBeCloseTo(R0, 6);
  });

  it('shrinks monotonically with no stall, on a log scale', () => {
    let prev = Infinity; let prevE = Infinity;
    for (let i = 0; i <= 400; i++) {
      const T = i / 400; const p = poseAt(T, MH);
      expect(p.m).toBeLessThanOrEqual(prev + 1e-12); expect(p.e).toBeLessThanOrEqual(prevE + 1e-12);
      prev = p.m; prevE = p.e;
    }
    // log-zoom rate through the middle stays within 2x of the mean (no rush, no freeze)
    const ln = (T: number) => Math.log(poseAt(T, MH).m);
    const mean = ln(1) - ln(TIME_A);
    for (const T of [0.3, 0.5, 0.7, 0.9]) {
      const rate = (ln(T + 0.01) - ln(T)) / 0.01 / (mean / (1 - TIME_A));
      expect(rate).toBeGreaterThan(0.5); expect(rate).toBeLessThan(2);
    }
  });

  it('keeps the earth far larger than the screen until the very end: the limb appears only in the last stretch', () => {
    expect(radiusAt(1, WORLD)).toBeGreaterThan(50 * VW); // adjacent feeds: a flat local patch
    const cy = VH * 0.45;
    const farCorner = Math.hypot(VW / 2, Math.max(cy, VH - cy));
    let limbZeta = -1;
    for (let i = 0; i <= 1000; i++) {
      const p = poseAt(i / 1000, MH);
      if (p.sector === 'zoom' && radiusAt(p.m, WORLD) < farCorner) { limbZeta = p.zeta; break; }
    }
    expect(limbZeta).toBeGreaterThan(0.8); // no premature sphere silhouette
    // continental scale (viewport spans ~60 degrees or more) happens before that, well past the neighbourhood
    const R = (zeta: number) => radiusAt(Math.exp(Math.log(MH) * zeta), WORLD);
    expect(R(0.5)).toBeGreaterThan(R(0.7)); expect(R(0.7)).toBeGreaterThan(R(0.85));
  });

  it('the camera location moves smoothly from its tile to the globe focal point', () => {
    const a1 = { x: 700, y: 300 }; const focal = { x: 960, y: 486 };
    expect(anchorAt(poseAt(TIME_A, MH), a1, focal)).toEqual(a1);
    const end = anchorAt(poseAt(1, MH), a1, focal);
    expect(end.x).toBeCloseTo(focal.x, 9); expect(end.y).toBeCloseTo(focal.y, 9);
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const a = anchorAt(poseAt(TIME_A + ((1 - TIME_A) * i) / 100, MH), a1, focal);
      expect(a.x).toBeGreaterThanOrEqual(prev - 1e-9); prev = a.x;
    }
  });

  it('the ease is monotonic with both ends fixed', () => {
    expect(legEase(0)).toBe(0); expect(legEase(1)).toBeCloseTo(1, 12);
    let prev = -1;
    for (let i = 0; i <= 100; i++) { const v = legEase(i / 100); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it('the focal bridge pane starts exactly fullscreen and recedes about the shared focal point: centred, in bounds, continuous', () => {
    const focal = { x: VW / 2, y: VH * 0.45 }; const start = { x: 0, y: 0, w: VW, h: VH };
    const tw = VW * 0.2; const th = (tw * 9) / 16;
    const r0 = focusRect(poseAt(0, MH), tw, th, focal, focal, start);
    // T = 0: exactly the viewport centre AND size
    expect(r0.x).toBeCloseTo(0, 9); expect(r0.y).toBeCloseTo(0, 9); expect(r0.w).toBeCloseTo(VW, 9); expect(r0.h).toBeCloseTo(VH, 9);
    let prev = r0;
    for (let i = 1; i <= 400; i++) {
      const T = i / 400; const p = poseAt(T, MH);
      const r = focusRect(p, tw, th, focal, focal, start);
      if (p.sector === 'tile') { // never offscreen / clipped / slipped low while it is still large
        expect(r.x).toBeGreaterThanOrEqual(-1e-6); expect(r.y).toBeGreaterThanOrEqual(-1e-6);
        expect(r.x + r.w).toBeLessThanOrEqual(VW + 1e-6); expect(r.y + r.h).toBeLessThanOrEqual(VH + 1e-6);
      }
      const cy = r.y + r.h / 2;
      expect(cy).toBeGreaterThanOrEqual(focal.y - 1e-6); expect(cy).toBeLessThanOrEqual(VH / 2 + 1e-6);
      expect(r.x + r.w / 2).toBeCloseTo(VW / 2, 6);
      expect(r.w).toBeLessThanOrEqual(prev.w + 1e-6); // recedes monotonically (the history reverse is this, played backwards)
      expect(prev.w - r.w).toBeLessThan(VW * 0.08); // no jump, including across the tile -> zoom boundary
      prev = r;
    }
  });
});
