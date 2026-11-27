import { describe, expect, it } from 'vitest';
import { MAX_ACTIVE_FEEDS, desiredPlayback } from '../../src/journey/playback';
import { DESKTOP_LIVE_BUDGET, centerTile, NARROW_LIVE_BUDGET, liveBudget, selectViewportFeeds, type FeedRect } from '../../src/journey/viewportFeeds';

const POOL = 78;
const view = { x: 0, y: 0, w: 1000, h: 600 };
/** Synthetic city pool: feed k has a visible tile of area growing with k (k = 0..77 -> widths 10..87), laid out inside the view. */
const rects = (n = POOL): FeedRect[] => Array.from({ length: n }, (_, k) => ({ feedIndex: k, x: 0, y: 0, w: 10 + k, h: 10 + k }));
const count = (d: boolean[]) => d.filter(Boolean).length;

describe('viewport live budget', () => {
  it('is 8 on desktop and 4 on narrow / portrait / coarse-pointer viewports', () => {
    expect(liveBudget(1440, 900, false)).toBe(DESKTOP_LIVE_BUDGET);
    expect(liveBudget(390, 844, false)).toBe(NARROW_LIVE_BUDGET);
    expect(liveBudget(900, 1200, false)).toBe(NARROW_LIVE_BUDGET);
    expect(liveBudget(1440, 900, true)).toBe(NARROW_LIVE_BUDGET);
  });
});

describe('selectViewportFeeds', () => {
  it('never exceeds the budget and picks the largest visible tiles of a 78-feed pool', () => {
    const d = selectViewportFeeds({ rects: rects(), view, budget: 8 });
    expect(d).toEqual([77, 76, 75, 74, 73, 72, 71, 70]);
    expect(selectViewportFeeds({ rects: rects(), view, budget: 4 })).toEqual([77, 76, 75, 74]);
  });
  it('the incoming target counts inside the budget (never budget + 1)', () => {
    const d = selectViewportFeeds({ rects: rects(), view, budget: 8, incoming: [3] });
    expect(d.length).toBe(8);
    expect(d[0]).toBe(3);
    const n = selectViewportFeeds({ rects: rects(), view, budget: 4, incoming: [3, 5], focus: [60] });
    expect(n).toEqual([60, 3, 5, 77]);
  });
  it('off-screen feeds are excluded unless explicitly incoming; focus must be visible', () => {
    const rs: FeedRect[] = [...rects(10), { feedIndex: 40, x: 5000, y: 0, w: 900, h: 500 }];
    const d = selectViewportFeeds({ rects: rs, view, budget: 8 });
    expect(d).not.toContain(40);
    expect(selectViewportFeeds({ rects: rs, view, budget: 8, focus: [40] })).not.toContain(40);
    expect(selectViewportFeeds({ rects: rs, view, budget: 8, incoming: [40] })[0]).toBe(40);
    expect(selectViewportFeeds({ rects: rs, view, budget: 8 }).length).toBe(8);
  });
  it('dedupes by feed: a feed with several tiles counts once, by its largest visible tile', () => {
    const rs: FeedRect[] = [
      { feedIndex: 1, x: 0, y: 0, w: 100, h: 100 }, { feedIndex: 1, x: 200, y: 0, w: 100, h: 100 },
      { feedIndex: 2, x: 400, y: 0, w: 120, h: 100 }, { feedIndex: 3, x: 600, y: 0, w: 50, h: 50 },
    ];
    expect(selectViewportFeeds({ rects: rs, view, budget: 8, incoming: [1] })).toEqual([1, 2, 3]);
  });
  it('is stable: ties keep the previous live set, then the lower index; near-ties do not churn', () => {
    const same: FeedRect[] = Array.from({ length: 12 }, (_, k) => ({ feedIndex: k, x: k * 10, y: 0, w: 10, h: 10 }));
    const a = selectViewportFeeds({ rects: same, view, budget: 4 });
    expect(a).toEqual([0, 1, 2, 3]);
    expect(selectViewportFeeds({ rects: same, view, budget: 4, prev: [8, 9, 10, 11] })).toEqual([8, 9, 10, 11]);
    const near = same.map((r) => (r.feedIndex === 0 ? { ...r, w: 10.5 } : r));
    expect(selectViewportFeeds({ rects: near, view, budget: 4, prev: [8, 9, 10, 11] })).toEqual([8, 9, 10, 11]);
    expect(selectViewportFeeds({ rects: rects(8), view, budget: 4, prev: [0, 1, 2, 3] })).toEqual([7, 6, 5, 4]); // clearly larger wins
  });
  it('partly visible tiles count by their visible area only', () => {
    const rs: FeedRect[] = [{ feedIndex: 1, x: -90, y: 0, w: 100, h: 100 }, { feedIndex: 2, x: 0, y: 0, w: 40, h: 30 }];
    expect(selectViewportFeeds({ rects: rs, view, budget: 1 })).toEqual([2]);
  });
});

describe('cold first frame: automatic centre focus is resolved before the first selection', () => {
  // Tile 12 sits under the view centre but is small; the focused feed (12) is not among the 8 largest visible.
  const tiles = Array.from({ length: 19 }, (_, k) => ({ id: `t${k}`, feedIndex: k, x: k * 50, y: 0, w: k === 12 ? 40 : 50 + (k === 3 ? 30 : 0), h: 600 }));
  it('centerTile finds the tile under the view centre', () => {
    expect(centerTile(tiles, 600 - 500, 1000, 600)?.id).toBe('t12'); // cx = 600 -> t12 (x 600..640)
    expect(centerTile(tiles, 5000, 1000, 600)).toBeUndefined();
  });
  it('ranking with the centre focus on frame 1 equals frame 2: no 9th cold attach', () => {
    const rs = tiles.map((t) => ({ feedIndex: t.feedIndex, x: t.x - 100, y: t.y, w: t.w, h: t.h }));
    const focusFeed = centerTile(tiles, 100, 1000, 600)!.feedIndex;
    const frame1 = selectViewportFeeds({ rects: rs, view, budget: 8, focus: [focusFeed], prev: [] });
    const frame2 = selectViewportFeeds({ rects: rs, view, budget: 8, focus: [focusFeed], prev: frame1 });
    expect(frame1).toContain(focusFeed);
    expect(frame1.length).toBe(8);
    expect(frame2).toEqual(frame1);
    // The old order (focus unknown on frame 1) would have attached a different set than frame 2: the union exceeded the budget.
    const stale = selectViewportFeeds({ rects: rs, view, budget: 8, focus: [-1], prev: [] });
    expect(new Set([...stale, ...frame2]).size).toBeGreaterThan(8);
  });
});

describe('desiredPlayback with a live viewport set', () => {
  const live = selectViewportFeeds({ rects: rects(), view, budget: 8, incoming: [3] });
  const base = { selectedFeed: -1, targetFeed: -1, feedCount: POOL, pool: Array.from({ length: POOL }, (_, k) => k) };
  it('every mosaic / navigation stage decodes only the live set, never the 78-feed pool', () => {
    for (const stage of ['mosaic', 'expanding', 'contracting', 'scanning', 'globeOut'] as const) {
      const d = desiredPlayback({ ...base, stage, live });
      expect(count(d)).toBe(8);
      expect(d.every((on, k) => on === live.includes(k))).toBe(true);
    }
    // an unknown camera / target never falls back to the whole pool either
    expect(count(desiredPlayback({ ...base, stage: 'selected', live }))).toBe(8);
    expect(count(desiredPlayback({ ...base, stage: 'turning', live }))).toBe(8);
  });
  it('keeps the existing holds: selected 1, globe 0, turning target only, spatial MAX 3', () => {
    expect(count(desiredPlayback({ ...base, stage: 'selected', selectedFeed: 9, live }))).toBe(1);
    expect(count(desiredPlayback({ ...base, stage: 'globe', live }))).toBe(0);
    const t = desiredPlayback({ ...base, stage: 'turning', targetFeed: 5, live });
    expect(count(t)).toBe(1); expect(t[5]).toBe(true);
    const sp = desiredPlayback({ ...base, stage: 'floatMove', active: [1, 2, 3, 4, 5], live });
    expect(count(sp)).toBe(MAX_ACTIVE_FEEDS);
    expect(count(desiredPlayback({ ...base, stage: 'entering', targetFeed: 2, extra: [2], live }))).toBeLessThanOrEqual(MAX_ACTIVE_FEEDS);
  });
  it('without a live set the legacy pool behaviour is unchanged', () => {
    expect(count(desiredPlayback({ ...base, stage: 'mosaic' }))).toBe(POOL);
  });
});
