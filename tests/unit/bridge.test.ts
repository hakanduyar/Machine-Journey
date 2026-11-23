import { describe, expect, it } from 'vitest';
import { freePanes } from '../../src/journey/localField';
import { OUTBOUND_LATE_SPEEDUP, outboundLateBoost } from '../../src/journey/scale';

const tiles = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * 100, y: Math.floor(i / 8) * 60, w: 100, h: 56 + (i % 3) * 8 }));
const geom = { worldW: 800, worldH: 300, tiles, canvases: [] };

describe('globe bridge field: independent free panes, no block', () => {
  const panes = freePanes(geom);

  it('is a large field of separate panes, none over the focal pane and none touching another', () => {
    expect(panes.length).toBeGreaterThan(200);
    for (const p of panes) expect(Math.abs(p.x) < 0.5 + p.w / 2 && Math.abs(p.y) < 0.75 + p.h / 2).toBe(false);
    for (let i = 0; i < panes.length; i++) for (let j = i + 1; j < panes.length; j++) {
      const a = panes[i]; const b = panes[j];
      const gapX = Math.abs(a.x - b.x) - (a.w + b.w) / 2; const gapY = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
      expect(Math.max(gapX, gapY)).toBeGreaterThan(0.05); // a visible gap between every pair: never a gapless rectangle
    }
  });

  it('has a size / depth hierarchy: large separated panes near the focus, small dim ones far out', () => {
    const near = panes.filter((p) => Math.hypot(p.x, p.y) < 3.6);
    const far = panes.filter((p) => Math.hypot(p.x, p.y) > 10);
    expect(near.length).toBeGreaterThanOrEqual(6);
    expect(far.length).toBeGreaterThan(40);
    const mean = (a: readonly { w: number }[]) => a.reduce((s, p) => s + p.w, 0) / a.length;
    expect(mean(near)).toBeGreaterThan(mean(far) * 1.5);
    expect(Math.max(...near.map((p) => p.z))).toBeGreaterThan(Math.max(...far.map((p) => p.z)));
    expect(new Set(panes.map((p) => p.src)).size).toBeGreaterThan(20); // many different cameras, not one repeated picture
  });
});

describe('outbound late pacing', () => {
  it('is 1 through the regional part, rises smoothly, and never exceeds the bounded speed-up', () => {
    expect(outboundLateBoost(0)).toBe(1);
    expect(outboundLateBoost(0.55)).toBe(1);
    expect(outboundLateBoost(1)).toBeCloseTo(1 + OUTBOUND_LATE_SPEEDUP, 12);
    expect(OUTBOUND_LATE_SPEEDUP).toBeLessThanOrEqual(0.15);
    let prev = 1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const b = outboundLateBoost(p);
      expect(b).toBeGreaterThanOrEqual(prev - 1e-12); expect(b - prev).toBeLessThan(0.02); // continuous: no step
      prev = b;
    }
  });
});
