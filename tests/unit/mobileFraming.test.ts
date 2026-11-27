import { describe, expect, it } from 'vitest';
import { computeCrop, fullViewRect, lerpCrop, lerpRect, videoBoxForCrop } from '../../src/journey/geometry';

const A = 16 / 9;
const FULL = { z: 1, cx: 0.5, cy: 0.5 };

describe('narrow-portrait camera framing', () => {
  it('keeps the whole viewport on desktop, landscape and wide screens (unchanged)', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [844, 390], [768, 1024]]) expect(fullViewRect(w, h, A)).toEqual({ x: 0, y: 0, w, h });
  });
  it('fits the entire source frame, full width and centred, on a 390x844 portrait', () => {
    const r = fullViewRect(390, 844, A);
    expect(r.w).toBe(390); expect(r.x).toBe(0);
    expect(r.w / r.h).toBeCloseTo(A);
    expect(r.y * 2 + r.h).toBeCloseTo(844);
    const crop = computeCrop(r.w, r.h, A, FULL);
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 }); // whole source, no cover crop
    const box = videoBoxForCrop(r.w, r.h, crop);
    expect(box.w / box.h).toBeCloseTo(A); // no stretch
  });
  it('is continuous from a tile to the fitted rect (no edge jump at either end)', () => {
    const r = fullViewRect(390, 844, A);
    const tile = { x: 40, y: 300, w: 120, h: 90 }; const tc = { z: 1.4, cx: 0.3, cy: 0.6 };
    const at = (e: number) => computeCrop(...(Object.values(lerpRect(tile, r, e)).slice(2) as [number, number]), A, lerpCrop(tc, FULL, e));
    expect(at(0)).toEqual(computeCrop(tile.w, tile.h, A, tc));
    expect(at(1)).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
    let prev = at(0);
    for (let i = 1; i <= 20; i++) { const c = at(i / 20); expect(Math.abs(c.sx - prev.sx) + Math.abs(c.sw - prev.sw)).toBeLessThan(0.2); prev = c; }
  });
});
