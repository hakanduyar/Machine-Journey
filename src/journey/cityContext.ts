import { FeedDeck, type FeedSelector } from './feedDeck';

/**
 * City context (pure, no DOM). `activeCity` is the persistent semantic place of the journey: every camera pane in every
 * mode (mosaic, selected, floating field, neural network, background panes) shows ONLY sources owned by it, until the
 * globe actually enters another city. A city's catalog is finite and honest: Butlerville owns 19 real feeds, the other
 * cities one clip each. Nothing here ever falls back to another city's feed.
 */
export interface CityLike { id: string; feedId?: string; feedIds?: readonly string[] }

/** The city the journey opens in: the nineteen real Butlerville (MEVA) feeds. */
export const DEFAULT_CITY_ID = 'butlerville';

/** Feed ids a city owns (verified places: all of their own feeds; stock cities: their one clip). Empty for an unknown city. */
export function cityFeedIds(city: CityLike | null | undefined): readonly string[] {
  if (!city) return [];
  return city.feedIds && city.feedIds.length ? city.feedIds : city.feedId ? [city.feedId] : [];
}

/** The city that owns `feedId` (a feed belongs to at most one city), or null. */
export function cityOfFeed(feedId: string | null | undefined, cities: readonly CityLike[]): CityLike | null {
  if (!feedId) return null;
  return cities.find((c) => cityFeedIds(c).includes(feedId)) ?? null;
}

/** Global indices (into `allIds`) of a city's feeds, in catalog order. A feed missing from `allIds` is dropped. */
export function catalogIndices(feedIds: readonly string[], allIds: readonly string[]): number[] {
  return feedIds.map((id) => allIds.indexOf(id)).filter((i) => i >= 0);
}

/**
 * Feeds for the LATER stops of one floating / neural visit (stop 0 is the camera already on screen). Distinct feeds of the
 * city come first (`distinct` = the city deck's frontier); when the finite catalog is exhausted the city's own feeds are
 * reused (never another city's), avoiding an immediate repeat when another source exists. With one source every stop is
 * that source: honest reuse, not fake variety.
 */
export function stopFeeds(pool: readonly string[], from: string | null, count: number, distinct: readonly string[] = []): string[] {
  const out: string[] = [];
  let prev = from;
  const take = (id: string) => { out.push(id); prev = id; };
  for (const d of distinct) { if (out.length >= count) break; if (pool.includes(d) && d !== prev) take(d); }
  let guard = 0;
  while (out.length < count && pool.length && guard++ < 64) {
    const next = pool.find((f) => f !== prev && !out.includes(f)) ?? pool.find((f) => f !== prev) ?? pool[0];
    take(next);
  }
  return out;
}

/** Number of stops worth planning for a visit: a one-source city needs no more than the minimum two. */
export function stopsFor(requested: number, poolSize: number): number {
  const n = Math.max(2, Math.min(6, Math.round(requested)));
  return poolSize <= 1 ? 2 : Math.min(n, Math.max(2, poolSize));
}

/**
 * One finite feed deck PER city (separate novelty / history), behind the single `FeedSelector` the controller already
 * uses. `useCity` switches which deck `commit` / `eligible` act on; `eligibleFor` / `hasUnseen` are pure reads of another
 * city's deck (used to pick the feed of a city about to be entered and to prefer cities with something new).
 */
export class CityDecks implements FeedSelector {
  private decks = new Map<string, FeedDeck>();
  private cur: string | null = null;
  constructor(private readonly cities: readonly CityLike[], private readonly seed = 0) {}

  /** The deck of one city (created on first use). Null for a city without feeds. */
  deckOf(cityId: string): FeedDeck | null {
    let d = this.decks.get(cityId);
    if (!d) {
      const ids = cityFeedIds(this.cities.find((c) => c.id === cityId));
      if (!ids.length) return null;
      d = new FeedDeck(ids, this.seed ^ [...cityId].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7));
      this.decks.set(cityId, d);
    }
    return d;
  }
  get city() { return this.cur; }
  /** Review handle: the active city and its deck's finite pool / cycle / seen / recent feeds. */
  diagnostics() {
    const d = this.cur ? this.deckOf(this.cur) : null;
    return { city: this.cur, ...(d ? d.diagnostics() : { size: 0, cycle: 0, seen: [], recent: [], commits: 0 }) };
  }
  get ids(): readonly string[] { return (this.cur ? this.deckOf(this.cur)?.ids : null) ?? []; }
  useCity(cityId: string | null) { this.cur = cityId; }
  commit(feedId: string): boolean { return (this.cur ? this.deckOf(this.cur)?.commit(feedId) : false) ?? false; }
  eligible(exclude: readonly (string | null | undefined)[] = []): string[] { return (this.cur ? this.deckOf(this.cur)?.eligible(exclude) : null) ?? []; }
  frontier(exclude: readonly (string | null | undefined)[], count: number): string[] {
    return (this.cur ? this.deckOf(this.cur)?.frontier(exclude, count) : null) ?? [];
  }
  eligibleFor(cityId: string, exclude: readonly (string | null | undefined)[] = []): string[] { return this.deckOf(cityId)?.eligible(exclude) ?? []; }
  /** True while the city still has a feed unseen in its current cycle (a never-visited city always has). */
  hasUnseen(cityId: string): boolean {
    const d = this.deckOf(cityId);
    return !!d && d.ids.some((id) => !d.isSeen(id));
  }
}
