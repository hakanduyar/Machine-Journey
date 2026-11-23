/**
 * Globe-leg helpers shared by the controller and the renderer. The zoom itself lives in scale.ts (one scale for both
 * directions). The anchor mapping is demo navigation only: the footage was NOT recorded at that place.
 */
export interface AnchorCity { id: string; lon: number; lat: number; feedId?: string; feedIds?: readonly string[]; verified?: unknown }

/** Held-composition radius. */
export const heldRadius = (vw: number, vh: number) => Math.min(vw * 0.44, vh * 0.36);

/**
 * Authored geographic anchor of a departing feed: the demo city that routes to that feed. A feed no city routes to
 * (stable, deterministic fallback) takes a city chosen by a hash of its id. Null only when there are no cities.
 */
export function anchorCityFor<C extends AnchorCity>(feedId: string | null, cities: readonly C[]): C | null {
  if (!cities.length) return null;
  if (feedId) {
    // A feed whose real source place is verified departs from that place; otherwise from its demo anchor city.
    const real = cities.find((c) => c.verified && (c.feedIds ? c.feedIds.includes(feedId) : c.feedId === feedId));
    if (real) return real;
    const hit = cities.find((c) => !c.verified && (c.feedIds ? c.feedIds.includes(feedId) : c.feedId === feedId));
    if (hit) return hit;
    let h = 7;
    for (let i = 0; i < feedId.length; i++) h = (h * 31 + feedId.charCodeAt(i)) >>> 0;
    return cities[h % cities.length];
  }
  return cities[0];
}
