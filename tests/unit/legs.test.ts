import { describe, expect, it } from 'vitest';
import { JourneyController, yearAxis, type JourneyCommand } from '../../src/journey/controller';
import { IntentGate } from '../../src/journey/intent';
import { nextYearIndex, planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: 10, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);

function make() {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg,
        prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null,
      });
      return p && { id: p.id, x: p.x };
    },
  });
  return c;
}
const run = (c: JourneyController, ms: number, step = 16) => { for (let t = 0; t < ms; t += step) c.update(step); };
const hold = (c: JourneyController) => { for (let i = 0; i < 600 && c.state.stage !== 'selected'; i++) c.update(16); };
const yearOf = (c: JourneyController) => Math.floor(ax.indexAt(c.state.worldX));

describe('one intent = one complete leg', () => {
  it('first intent scans laterally, then expands the tile it scanned to, then holds', () => {
    const c = make();
    const stages: string[] = [];
    c.subscribe((s) => { if (stages[stages.length - 1] !== s.stage) stages.push(s.stage); });
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    expect(c.state.stage).toBe('scanning');
    const target = c.state.selectedId;
    const x0 = c.state.worldX;
    hold(c);
    expect(c.state.stage).toBe('selected');
    expect(c.state.selectedId).toBe(target);
    expect(c.state.worldX).not.toBe(x0);
    expect(c.state.progress).toBe(1);
    expect(stages).toEqual(['scanning', 'expanding', 'selected']);
    run(c, 120_000); // indefinite hold with no input
    expect(c.state.stage).toBe('selected');
    expect(c.state.selectedId).toBe(target);
  });

  it('next intent contracts, scans and opens a different camera in a single leg', () => {
    const c = make();
    c.dispatch({ type: 'intent' }); hold(c);
    const first = c.state.selectedId;
    const firstFeed = tiles.find((t) => t.id === first)!.feedIndex;
    const seen: string[] = [];
    c.subscribe((s) => { if (seen[seen.length - 1] !== s.stage) seen.push(s.stage); });
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    expect(c.state.stage).toBe('contracting');
    hold(c);
    expect(seen).toEqual(['contracting', 'scanning', 'expanding', 'selected']);
    expect(c.state.selectedId).not.toBe(first);
    expect(tiles.find((t) => t.id === c.state.selectedId)!.feedIndex).not.toBe(firstFeed);
  });

  it('discards every intent while travelling: no queueing, no skipped stops', () => {
    const c = make();
    c.dispatch({ type: 'intent' });
    for (let i = 0; i < 400 && c.state.stage !== 'selected'; i++) {
      expect(c.dispatch({ type: 'intent' })).toBe(false);
      c.update(16);
    }
    const id = c.state.selectedId;
    expect(c.state.stage).toBe('selected');
    run(c, 5000);
    expect(c.state.selectedId).toBe(id);
    c.dispatch({ type: 'intent' });
    for (let i = 0; i < 400 && c.state.stage !== 'selected'; i++) { c.dispatch({ type: 'intent' }); c.update(16); }
    expect(c.state.selectedId).not.toBe(id);
    expect(c.state.stage).toBe('selected');
  });

  it('visits years non-monotonically, earlier and later, never repeating a leg', () => {
    const c = make();
    const years: number[] = [yearOf(c)]; const ids: string[] = [];
    for (let i = 0; i < 12; i++) { c.dispatch({ type: 'intent' }); hold(c); years.push(yearOf(c)); ids.push(c.state.selectedId!); }
    const deltas = years.slice(1).map((y, i) => y - years[i]);
    expect(deltas.some((d) => d > 0)).toBe(true);
    expect(deltas.some((d) => d < 0)).toBe(true);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    for (let i = 2; i < deltas.length; i++) {
      const same = Math.sign(deltas[i]) === Math.sign(deltas[i - 1]) && Math.sign(deltas[i - 1]) === Math.sign(deltas[i - 2]);
      expect(same).toBe(false);
    }
  });

  it('reaches the hold at a low frame rate', () => {
    const c = make();
    c.dispatch({ type: 'intent' });
    for (let i = 0; i < 80 && c.state.stage !== 'selected'; i++) c.update(250);
    expect(c.state.stage).toBe('selected');
  });

  it('legacy mosaic selection and return still work', () => {
    const c = make();
    c.dispatch({ type: 'select', id: 't1' } as JourneyCommand);
    run(c, 1200);
    expect(c.state.stage).toBe('selected');
    c.dispatch({ type: 'return' });
    run(c, 1200);
    expect(c.state.stage).toBe('mosaic');
  });
});

describe('route planning', () => {
  it('year choice is deterministic, in range, at least two years from the previous stop', () => {
    let prev = 0;
    const seen = new Set<number>();
    for (let leg = 1; leg <= 40; leg++) {
      const y = nextYearIndex(prev, leg, YEARS);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(YEARS);
      expect(Math.abs(y - prev)).toBeGreaterThanOrEqual(2);
      expect(nextYearIndex(prev, leg, YEARS)).toBe(y);
      seen.add(y); prev = y;
    }
    expect(seen.size).toBe(YEARS);
  });
});

describe('IntentGate', () => {
  it('one wheel gesture fires once; its inertia tail does not', () => {
    const g = new IntentGate();
    let fired = 0;
    for (let t = 1000; t < 1900; t += 16) if (g.wheel(t, 40, false)) fired++;
    expect(fired).toBe(1);
  });

  it('inertia that outlives a locked leg cannot start another leg', () => {
    const g = new IntentGate();
    expect(g.wheel(1000, 50, false)).toBe(true);
    let fired = 0;
    for (let t = 1016; t < 6000; t += 16) if (g.wheel(t, 3, t < 4000)) fired++;
    expect(fired).toBe(0);
    g.settle(4000);
    expect(g.wheel(6500, 30, false)).toBe(true);
  });

  it('input right after a hold is ignored; later deliberate input fires', () => {
    const g = new IntentGate();
    g.settle(5000);
    expect(g.wheel(5100, 100, false)).toBe(false);
    expect(g.key(5200, false, false)).toBe(false);
    expect(g.key(5400, false, false)).toBe(true);
  });

  it('held keys and locked keys never fire', () => {
    const g = new IntentGate();
    expect(g.key(0, true, false)).toBe(false);
    expect(g.key(10, false, true)).toBe(false);
    expect(g.key(20, false, false)).toBe(true);
  });

  it('a swipe needs distance and must begin while unlocked', () => {
    const g = new IntentGate();
    g.pointerDown(100, false);
    expect(g.swipe(200, 10, 5, false)).toBe(false);
    g.pointerDown(300, false);
    expect(g.swipe(400, -90, 0, false)).toBe(true);
    g.pointerDown(500, true);
    expect(g.swipe(600, -90, 0, false)).toBe(false);
  });
});

describe('resize during a focused hold', () => {
  const layout = (vw: number, vh: number, seed: number) => {
    const m = generateMosaic({ width: vw * 3, height: vh, tileCount: Math.round((3 * vw * vh) / 40000), feedCount: 10, seed });
    return m.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
  };
  const cases: [string, [number, number, number], [number, number, number]][] = [
    ['same orientation (shrink)', [1280, 800, 11], [900, 600, 11]],
    ['landscape -> portrait', [1280, 800, 11], [390, 844, 23]],
    ['portrait -> landscape', [390, 844, 23], [1280, 800, 11]],
  ];
  for (const [name, a, b] of cases) {
    it(name + ': same feed, tile in view, next leg contracts from the current mosaic', () => {
      let L = layout(a[0], a[1], a[2]);
      let vw = a[0];
      const c: JourneyController = new JourneyController({
        worldWidth: vw * 3, viewportWidth: vw, travelMs: 1000,
        planner: (leg) => {
          const cur = L.find((t) => t.id === c.state.selectedId);
          const axis = yearAxis(vw * 3, vw, YEARS);
          const p = planLeg({ tiles: L, vw, worldW: vw * 3, yearCount: YEARS, leg, prevYear: Math.floor(axis.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
          return p && { id: p.id, x: p.x };
        },
      });
      c.dispatch({ type: 'intent' }); hold(c);
      const oldTile = L.find((t) => t.id === c.state.selectedId)!;
      const oldAxis = yearAxis(vw * 3, vw, YEARS);
      const year = Math.floor(oldAxis.indexAt(c.state.worldX));
      // layout refit, exactly as the component does it
      L = layout(b[0], b[1], b[2]); vw = b[0];
      c.setBounds(vw * 3, vw);
      const r = reanchorTile({ tiles: L, feedIndex: oldTile.feedIndex, vw, worldW: vw * 3, yearCount: YEARS, year })!;
      expect(r).not.toBeNull();
      expect(c.rebase(r.id, r.x)).toBe(true);
      expect(c.state.stage).toBe('selected');
      const sel = L.find((t) => t.id === c.state.selectedId)!;
      expect(sel.feedIndex).toBe(oldTile.feedIndex); // same video keeps playing
      const sx = sel.x - c.state.worldX; // on-screen x of the tile the contraction will start from
      expect(sx + sel.w / 2).toBeGreaterThanOrEqual(0);
      expect(sx + sel.w / 2).toBeLessThanOrEqual(vw);
      expect(Math.abs(Math.floor(yearAxis(vw * 3, vw, YEARS).indexAt(c.state.worldX)) - year)).toBeLessThanOrEqual(3); // bounded by where this feed has tiles
      // next leg still one intent, still a different feed
      expect(c.dispatch({ type: 'intent' })).toBe(true);
      expect(c.state.stage).toBe('contracting');
      hold(c);
      expect(c.state.stage).toBe('selected');
      expect(L.find((t) => t.id === c.state.selectedId)!.feedIndex).not.toBe(oldTile.feedIndex);
    });
  }
  it('rebase is refused outside a hold', () => {
    const c = make();
    expect(c.rebase('t0', 0)).toBe(false);
  });
});
