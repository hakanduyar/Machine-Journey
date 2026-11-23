import { clamp } from './geometry';
import { yearAxis } from './controller';

/** Authored first legs: later, earlier, later, earlier ... deliberately not monotonic. */
const ROUTE = [4, 1, 6, 2, 7, 3, 0, 5];

/** Year index (0-based) of leg `leg` (1-based), at least 2 years away from `prev`, never equal. */
export function nextYearIndex(prev: number, leg: number, count: number): number {
  const n = Math.max(0, leg - 1);
  let idx = (ROUTE[n % ROUTE.length] + Math.floor(n / ROUTE.length) * 3) % count;
  for (let k = 0; k < count && Math.abs(idx - prev) < 2; k++) idx = (idx + 3) % count;
  return idx;
}

export interface PlanTile { id: string; x: number; y: number; w: number; h: number; feedIndex: number }
export interface PlannedLeg { id: string; /** scroll offset that centres the tile */ x: number; year: number }

/**
 * Picks the destination of a leg: a tile near the chosen year's position on the axis, whose
 * feed differs from the one currently shown. Deterministic for a given leg number and layout.
 */
export function planLeg(o: {
  tiles: readonly PlanTile[]; vw: number; worldW: number; yearCount: number;
  leg: number; prevYear: number; currentFeed: number | null;
  /**
   * Feed indices the shared deck still offers as NEW cameras (best tier). When given, the leg opens one of them: near the
   * chosen year if possible, otherwise the nearest tile of any of them (the year then follows the tile; never a seen feed).
   */
  wantFeeds?: readonly number[];
}): PlannedLeg | null {
  const { tiles, vw, worldW, yearCount, leg } = o;
  const axis = yearAxis(worldW, vw, yearCount);
  const year = nextYearIndex(o.prevYear, leg, yearCount);
  const centre = axis.centreOf(year);
  const maxX = Math.max(0, worldW - vw);
  const want = o.wantFeeds && o.wantFeeds.length ? new Set(o.wantFeeds) : null;
  for (const reach of want ? [0.3, 0.5, 0.9, Infinity] : [0.3, 0.5, 0.9]) {
    const pool = tiles
      .filter((t) => t.w >= vw * 0.1 && t.w <= vw && t.feedIndex !== o.currentFeed && (!want || want.has(t.feedIndex)) &&
        Math.abs(t.x + t.w / 2 - centre) <= vw * reach)
      .sort((a, b) => Math.abs(a.x + a.w / 2 - centre) - Math.abs(b.x + b.w / 2 - centre) || a.id.localeCompare(b.id));
    if (!pool.length) continue;
    const t = pool[(leg * 3) % Math.min(pool.length, 4)];
    const x = clamp(t.x + t.w / 2 - vw / 2, 0, maxX);
    return { id: t.id, x, year: Math.floor(axis.indexAt(x)) };
  }
  // No tile of an offered feed fits the viewport: never refuse the leg, fall back to the ordinary different-feed choice.
  return want ? planLeg({ ...o, wantFeeds: undefined }) : null;
}

/**
 * After a layout refit, the tile of the SAME feed nearest to where the current year sits on
 * the new axis, and the scroll that centres it. Returns null only if the feed has no tile.
 */
export function reanchorTile(o: {
  tiles: readonly PlanTile[]; feedIndex: number; vw: number; worldW: number; yearCount: number; year: number;
}): { id: string; x: number } | null {
  const axis = yearAxis(o.worldW, o.vw, o.yearCount);
  const centre = axis.centreOf(clamp(o.year, 0, o.yearCount - 1));
  const same = o.tiles.filter((t) => t.feedIndex === o.feedIndex);
  const fit = same.filter((t) => t.w <= o.vw);
  const pool = (fit.length ? fit : same).slice()
    .sort((a, b) => Math.abs(a.x + a.w / 2 - centre) - Math.abs(b.x + b.w / 2 - centre) || a.id.localeCompare(b.id));
  const t = pool[0];
  if (!t) return null;
  return { id: t.id, x: clamp(t.x + t.w / 2 - o.vw / 2, 0, Math.max(0, o.worldW - o.vw)) };
}
