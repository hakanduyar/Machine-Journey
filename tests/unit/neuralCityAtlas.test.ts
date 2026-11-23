import { describe, expect, it } from 'vitest';
import { coverCrop, posterSlot, uniqueRects, uvIslands } from '../../src/journey/neuralSource/cityAtlas';

// Two photographs of an atlas as two indexed quads (each quad = its own 4 vertices / 2 triangles) + a welded-looking neighbour.
const uvs: [number, number][] = [
  [0.0, 0.0], [0.5, 0.0], [0.5, 0.25], [0.0, 0.25], // photo A
  [0.5, 0.0], [1.0, 0.0], [1.0, 0.25], [0.5, 0.25], // photo B touches A at u = 0.5 (same uv values, different vertices)
];
const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
const U = (i: number) => uvs[i][0]; const V = (i: number) => uvs[i][1];

describe('neural city atlas mapping (pure part)', () => {
  it('finds one UV island per photograph, never merging touching neighbours', () => {
    const r = uvIslands(index, 8, U, V);
    expect(r.length).toBe(2);
    expect(uniqueRects(r)).toEqual([{ u0: 0, v0: 0, u1: 0.5, v1: 0.25 }, { u0: 0.5, v0: 0, u1: 1, v1: 0.25 }]);
  });
  it('non-indexed quads (two triangles per photo) dedupe to the same photograph rect', () => {
    const tri = [0, 1, 2, 0, 2, 3];
    const u = (i: number) => uvs[tri[i]][0]; const v = (i: number) => uvs[tri[i]][1];
    expect(uniqueRects(uvIslands(null, 6, u, v))).toEqual([{ u0: 0, v0: 0, u1: 0.5, v1: 0.25 }]);
  });
  it('unreferenced vertices are not photographs', () => {
    expect(uvIslands([0, 1, 2], 8, U, V).length).toBe(1);
  });
  it('poster slots cycle over the city catalogue: a one-clip city repeats its own clip, a four-clip city uses all four', () => {
    expect([0, 1, 2].map((k) => posterSlot(k, 1))).toEqual([0, 0, 0]);
    expect([0, 1, 2, 3, 4].map((k) => posterSlot(k, 4))).toEqual([0, 1, 2, 3, 0]);
    expect(posterSlot(0, 0)).toBe(-1); // no poster: the island stays neutral
  });
  it('cover crop keeps the poster undistorted inside the photograph rect (no random giant crop)', () => {
    const c = coverCrop(1280, 720, 100, 100);
    expect(c.sh).toBeCloseTo(720); expect(c.sw).toBeCloseTo(720); expect(c.sx).toBeCloseTo(280); expect(c.sy).toBeCloseTo(0);
    const same = coverCrop(1280, 720, 160, 90);
    expect([same.sx, same.sy, same.sw, same.sh].map((x) => Math.round(x))).toEqual([0, 0, 1280, 720]);
  });
});
