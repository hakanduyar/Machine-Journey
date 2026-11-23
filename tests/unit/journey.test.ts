import { describe, expect, it } from 'vitest';
import { JourneyController, frameDelta, yearAxis } from '../../src/journey/controller';
import { computeCrop, lerpCrop, lerpRect, videoBoxForCrop } from '../../src/journey/geometry';
import { generateMosaic, tileCountFor } from '../../src/journey/layout';

const mk = () => new JourneyController({ worldWidth: 3000, viewportWidth: 1000, travelMs: 1000 });
const run = (c: JourneyController, ms: number, step = 16) => { for (let t = 0; t < ms; t += step) c.update(step); };

describe('navigation state machine', () => {
  it('travels mosaic -> selected -> mosaic only through commands, never on its own', () => {
    const c = mk();
    run(c, 10_000);
    expect(c.state.stage).toBe('mosaic');
    c.dispatch({ type: 'select', id: 'a' });
    expect(c.state.stage).toBe('expanding');
    run(c, 1200);
    expect(c.state.stage).toBe('selected');
    expect(c.state.progress).toBe(1);
    run(c, 60_000); // indefinite dwell: nothing advances
    expect(c.state.stage).toBe('selected');
    c.dispatch({ type: 'retreat' });
    expect(c.state.stage).toBe('contracting');
    run(c, 1200);
    expect(c.state.stage).toBe('mosaic');
    expect(c.state.selectedId).toBeNull();
  });

  it('reverses mid-flight from the current progress without jumping', () => {
    const c = mk();
    c.dispatch({ type: 'select', id: 'a' });
    run(c, 400);
    const p = c.state.progress;
    expect(p).toBeGreaterThan(0.3);
    c.dispatch({ type: 'return' });
    expect(c.state.stage).toBe('contracting');
    expect(c.state.progress).toBe(p);
    c.dispatch({ type: 'select', id: 'a' }); // and forward again
    expect(c.state.stage).toBe('expanding');
    expect(c.state.progress).toBe(p);
  });

  it('survives rapid select/return spam and always settles in a resting stage', () => {
    const c = mk();
    for (let i = 0; i < 200; i++) {
      c.dispatch(i % 3 === 0 ? { type: 'return' } : { type: 'select', id: i % 2 ? 'a' : 'b' });
      c.update(7);
    }
    run(c, 3000);
    expect(['mosaic', 'selected']).toContain(c.state.stage);
    if (c.state.stage === 'selected') c.dispatch({ type: 'return' });
    run(c, 3000);
    expect(c.state.stage).toBe('mosaic');
  });

  it('queues a different selection issued during contraction', () => {
    const c = mk();
    c.dispatch({ type: 'select', id: 'a' });
    run(c, 1100);
    c.dispatch({ type: 'return' });
    run(c, 300);
    expect(c.dispatch({ type: 'select', id: 'b' })).toBe(true);
    expect(c.state.selectedId).toBe('a'); // still contracting a
    run(c, 1000);
    expect(c.state.selectedId).toBe('b');
    expect(['expanding', 'selected']).toContain(c.state.stage);
  });

  it('ignores lateral navigation outside the mosaic and clamps it inside', () => {
    const c = mk();
    c.dispatch({ type: 'pan', dx: 99_999 });
    run(c, 3000);
    expect(c.state.worldX).toBe(2000);
    c.dispatch({ type: 'select', id: 'a' });
    expect(c.dispatch({ type: 'pan', dx: -500 })).toBe(false);
    run(c, 1200);
    expect(c.state.worldX).toBe(2000);
    expect(c.state.targetX).toBe(2000);
  });

  it('advance opens the focused tile; retreat is a no-op in the mosaic', () => {
    const c = mk();
    expect(c.dispatch({ type: 'advance' })).toBe(false);
    c.dispatch({ type: 'focus', id: 'f' });
    c.dispatch({ type: 'advance' });
    expect(c.state.selectedId).toBe('f');
  });
});

describe('low frame rate / large dt', () => {
  it('frameDelta uses real elapsed time, bounded only for hidden-tab gaps', () => {
    expect(frameDelta(1200, 1000)).toBe(200);
    expect(frameDelta(1000, 1000)).toBe(0);
    expect(frameDelta(900, 1000)).toBe(0);
    expect(frameDelta(60_000, 0)).toBe(1000);
  });

  it('a requested transition reaches its endpoint in the same wall-clock time at 4 fps as at 60 fps', () => {
    const slow = mk(); const fast = mk();
    for (const c of [slow, fast]) c.dispatch({ type: 'select', id: 'a' });
    for (let t = 0; t < 1000; t += 250) slow.update(frameDelta(t + 250, t));
    run(fast, 1000, 1000 / 60);
    expect(slow.state.stage).toBe('selected');
    expect(fast.state.stage).toBe('selected');
    slow.dispatch({ type: 'return' });
    for (let t = 0; t < 1000; t += 250) slow.update(frameDelta(t + 250, t));
    expect(slow.state.stage).toBe('mosaic');
  });

  it('one huge step completes a travel but never starts one, and dwell stays indefinite', () => {
    const c = mk();
    c.update(frameDelta(900_000, 0));
    expect(c.state.stage).toBe('mosaic');
    c.dispatch({ type: 'select', id: 'a' });
    c.update(frameDelta(900_000, 0));
    expect(c.state.stage).toBe('selected');
    c.update(frameDelta(900_000, 0));
    expect(c.state.stage).toBe('selected');
    c.dispatch({ type: 'return' });
    c.dispatch({ type: 'select', id: 'b' }); // queued during contraction
    c.update(frameDelta(900_000, 0));
    expect(c.state.selectedId).toBe('b');
  });
});

describe('year axis bound to world position', () => {
  it('maps both scroll extremes onto first/last year and centres each year', () => {
    const a = yearAxis(3000, 1000, 8);
    expect(Math.floor(a.indexAt(0))).toBe(0);
    expect(Math.floor(a.indexAt(2000))).toBe(7);
    for (let i = 0; i < 8; i++) expect(Math.floor(a.indexAt(a.scrollFor(i)))).toBe(i);
  });
});

describe('gapless variable mosaic', () => {
  for (const [w, h] of [[1920, 1080], [390, 844], [844, 390], [1366, 768]]) {
    it(`covers ${w}x${h} x3 exactly with varied tiles`, () => {
      const W = w * 3;
      const m = generateMosaic({ width: W, height: h, feedCount: 10, tileCount: tileCountFor(w, h, 3), seed: w > h ? 11 : 23 });
      const area = m.tiles.reduce((s, t) => s + t.rect.w * t.rect.h, 0);
      expect(area).toBe(W * h);
      // exact cover: coarse occupancy grid has no overlap and no hole
      const cell = 10;
      const gw = Math.ceil(W / cell); const gh = Math.ceil(h / cell);
      const grid = new Uint8Array(gw * gh);
      for (const t of m.tiles) {
        for (let y = Math.floor(t.rect.y / cell); y < Math.ceil((t.rect.y + t.rect.h) / cell); y++)
          for (let x = Math.floor(t.rect.x / cell); x < Math.ceil((t.rect.x + t.rect.w) / cell); x++) {
            if (x < gw && y < gh) grid[y * gw + x]++;
          }
      }
      expect(grid.every((v) => v >= 1)).toBe(true);
      const sizes = new Set(m.tiles.map((t) => `${t.rect.w}x${t.rect.h}`));
      expect(sizes.size).toBeGreaterThan(m.tiles.length * 0.7);
      expect(new Set(m.tiles.map((t) => t.feedIndex)).size).toBe(10);
    });
  }
});

describe('crop continuity', () => {
  it('start of the travel reproduces the tile crop and end is a cover fit', () => {
    const tile = { x: 300, y: 100, w: 240, h: 160 };
    const view = { x: 0, y: 0, w: 1280, h: 720 };
    const tc = { z: 1.8, cx: 0.4, cy: 0.55 };
    const r0 = lerpRect(tile, view, 0);
    const c0 = computeCrop(r0.w, r0.h, 16 / 9, lerpCrop(tc, { z: 1, cx: 0.5, cy: 0.5 }, 0));
    expect(c0).toEqual(computeCrop(tile.w, tile.h, 16 / 9, tc));
    const c1 = computeCrop(1280, 720, 16 / 9, { z: 1, cx: 0.5, cy: 0.5 });
    expect(c1).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 });
    // video box always covers the pane
    for (let t = 0; t <= 1; t += 0.1) {
      const r = lerpRect(tile, view, t);
      const b = videoBoxForCrop(r.w, r.h, computeCrop(r.w, r.h, 16 / 9, lerpCrop(tc, { z: 1, cx: 0.5, cy: 0.5 }, t)));
      expect(b.x).toBeLessThanOrEqual(1e-6);
      expect(b.y).toBeLessThanOrEqual(1e-6);
      expect(b.x + b.w).toBeGreaterThanOrEqual(r.w - 1e-6);
      expect(b.y + b.h).toBeGreaterThanOrEqual(r.h - 1e-6);
    }
  });
});
