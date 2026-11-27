/**
 * Bounded live-decoder selection for the mosaic and the other tile-showing stages (pure, DOM-free).
 *
 * Only a handful of <video> elements decode at once; every other tile keeps its (static) poster / last good frame. The set is
 * chosen from rectangles the caller already has (world tile rects + the current scroll / zoom transform), never measured.
 *
 *  - budget: 8 on desktop, 4 on a narrow / portrait / coarse-pointer viewport. The budget INCLUDES the incoming target.
 *  - order: focus (selected / focused tile's feed, must be visible), then incoming (transition endpoint / target, may be
 *    off screen), then the feeds of the largest actually visible tile areas, then nothing: off-screen feeds never play.
 *  - one entry per feed (a feed bound to several tiles counts once, by its largest visible tile).
 *  - stable: ties and near-ties favour feeds that were live last time, then the lower feed index, so the set does not churn.
 */
export interface FeedRect { feedIndex: number; x: number; y: number; w: number; h: number }
export interface ViewRect { x: number; y: number; w: number; h: number }

export const DESKTOP_LIVE_BUDGET = 8;
export const NARROW_LIVE_BUDGET = 4;
/** Matches the stylesheet's phone breakpoint (max-width: 520px). */
const NARROW_WIDTH = 520;
/** A previously live feed keeps its place unless a challenger is this much larger (visible area ratio): no churn on scroll. */
const HYSTERESIS = 1.15;

/** Live budget for a viewport: narrow (<= 520 px wide), portrait or coarse pointer -> 4, otherwise 8. */
export function liveBudget(vw: number, vh: number, coarsePointer: boolean): number {
  return coarsePointer || vw <= NARROW_WIDTH || vw < vh ? NARROW_LIVE_BUDGET : DESKTOP_LIVE_BUDGET;
}

const overlap = (r: FeedRect, v: ViewRect) => {
  const w = Math.min(r.x + r.w, v.x + v.w) - Math.max(r.x, v.x);
  const h = Math.min(r.y + r.h, v.y + v.h) - Math.max(r.y, v.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * The tile under the view centre (the automatic focus of the mosaic), or undefined. Resolved BEFORE the first budget selection
 * so the cold first frame already ranks the feed the next frame's automatic focus would promote (no 9th, soon unneeded, attach).
 */
export function centerTile<T extends { x: number; y: number; w: number; h: number }>(
  tiles: readonly T[], worldX: number, vw: number, vh: number,
): T | undefined {
  const cx = worldX + vw / 2; const cy = vh / 2;
  return tiles.find((t) => cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h);
}

export interface ViewportFeedInput {
  rects: readonly FeedRect[];
  view: ViewRect;
  budget: number;
  /** Selected / focused feed(s): kept first, but only when actually visible (never a reason to decode off screen). */
  focus?: readonly number[];
  /** Explicit incoming target / transition endpoint(s): kept next, even off screen, but always inside the budget. */
  incoming?: readonly number[];
  /** The previous result, for stable ranking. */
  prev?: readonly number[];
}

/** Feed indices that should decode, at most `budget`, deduplicated, highest priority first. */
export function selectViewportFeeds(i: ViewportFeedInput): number[] {
  const budget = Math.max(0, Math.floor(i.budget));
  if (budget === 0) return [];
  const area = new Map<number, number>();
  for (const r of i.rects) {
    if (r.feedIndex < 0) continue;
    const a = overlap(r, i.view);
    if (a > (area.get(r.feedIndex) ?? 0)) area.set(r.feedIndex, a);
  }
  const out: number[] = [];
  const add = (f: number) => { if (f >= 0 && out.length < budget && !out.includes(f)) out.push(f); };
  for (const f of i.focus ?? []) if (area.has(f)) add(f);
  for (const f of i.incoming ?? []) add(f);
  const prev = new Set(i.prev ?? []);
  const rest = [...area.entries()].filter(([f]) => !out.includes(f));
  // Previously live feeds are scored up so a marginal challenger does not displace them.
  const score = (f: number, a: number) => (prev.has(f) ? a * HYSTERESIS : a);
  rest.sort((p, q) => score(q[0], q[1]) - score(p[0], p[1]) || Number(prev.has(q[0])) - Number(prev.has(p[0])) || p[0] - q[0]);
  for (const [f] of rest) add(f);
  return out;
}
