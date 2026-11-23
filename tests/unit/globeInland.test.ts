import { describe, expect, it } from 'vitest';
import {
  MAX_SETTLEMENT_POINTS, buildInland, buildLandMask, buildSettlements, clusterSize, isLand, settlementCount, type PlaceRow,
} from '../../src/journey/globeInland';
import { collectFrontRuns, viewBasis } from '../../src/journey/globeGeo';

// a 10x10 degree "continent" with a 2x2 hole (even-odd)
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const HOLE = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
const mask = buildLandMask([SQUARE, HOLE]);

describe('land mask', () => {
  it('is even-odd: land inside the ring, ocean outside, ocean in a hole', () => {
    expect(isLand(mask, 2, 2)).toBe(true);
    expect(isLand(mask, 20, 5)).toBe(false);
    expect(isLand(mask, 5, 5)).toBe(false);
  });
});

describe('settlement lights', () => {
  const places: PlaceRow[] = [[8, 8, 0, 20_000_000], [1, 1, 4, 300_000], [30, 30, 7, 5000] /* off the mask: island/ocean */];
  const s = buildSettlements(places, mask);

  it('never lights the ocean: scatter is land-only, an off-mask place keeps just itself', () => {
    for (let i = 0; i < s.count; i++) {
      const X = s.xyz[i * 3]; const Y = s.xyz[i * 3 + 1]; const Z = s.xyz[i * 3 + 2];
      const lon = (Math.atan2(Y, X) * 180) / Math.PI; const lat = (Math.asin(Z) * 180) / Math.PI;
      // every point is either a place itself (exact) or on land
      const isPlace = places.some(([lo, la]) => Math.abs(lo - lon) < 1e-3 && Math.abs(la - lat) < 1e-3);
      expect(isPlace || isLand(mask, lon, lat)).toBe(true);
    }
    const offMask = places.findIndex((p) => p[0] === 30);
    expect(offMask).toBe(2);
    expect(s.count).toBeLessThanOrEqual(clusterSize(20_000_000) + clusterSize(300_000) + 1);
  });

  it('without a land mask only the places themselves are lit (no scatter on unknown ground)', () => {
    expect(buildSettlements(places, null).count).toBe(3);
  });

  it('clusters scale with population and hierarchy is sorted largest first, bounded overall', () => {
    expect(clusterSize(1000)).toBe(1);
    expect(clusterSize(20_000_000)).toBeGreaterThan(clusterSize(300_000));
    expect(clusterSize(1e12)).toBeLessThanOrEqual(13);
    expect(s.alpha[0]).toBeGreaterThan(s.alpha[s.count - 1] - 1e-9); // the biggest place's core is the brightest start
    const many: PlaceRow[] = Array.from({ length: 5000 }, (_, i) => [1 + (i % 9), 1 + ((i * 7) % 9), 2, 9_000_000]);
    expect(buildSettlements(many, mask).count).toBeLessThanOrEqual(MAX_SETTLEMENT_POINTS);
  });

  it('is deterministic and small globes draw a bounded prefix', () => {
    expect(Array.from(buildSettlements(places, mask).xyz)).toEqual(Array.from(s.xyz));
    expect(settlementCount(1000, 80)).toBeLessThan(settlementCount(1000, 300));
    expect(settlementCount(1000, 300)).toBe(1000);
  });
});

describe('internal boundaries', () => {
  it('stay open polylines and break at the limb / between parts', () => {
    const inland = buildInland([[1, 1, 4, 1000]], [[[0, 0], [5, 0], [5, 5]], [[180, 0], [175, 0], [175, 5]]], null);
    const lod = inland.boundaries.lods[0];
    expect(lod.vertices).toBe(6); // nothing appended to close either part
    const r = collectFrontRuns(lod, viewBasis(2, 2), 500, 400, 300, 1000, 800);
    expect(r.runCount).toBe(1);
    expect(r.hidden).toBe(3);
  });
});
