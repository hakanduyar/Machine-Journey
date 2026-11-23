/**
 * Shared finite feed deck (pure, no DOM). One instance serves every mode (mosaic-selected camera legs, floating field,
 * neural scene, globe entries), so a NEW focused camera does not repeat a feed already committed in the current cycle
 * until the whole catalog has been seen. It is a finite pool (today: the catalog length), NOT an endless supply of
 * unique video: when a cycle is exhausted the cycle counter advances explicitly and the journey continues, avoiding an
 * immediate or recent repeat.
 *
 * Rules:
 *  - `commit(feedId)` is called only when a hold was actually reached by a fresh (non-replayed) leg. Planning never
 *    consumes: `eligible` / `frontier` are pure reads (they simulate on a copy), so a route that is only planned, a
 *    pending intent or a history replay changes nothing.
 *  - Committing the camera that is already the most recent one is continuity (e.g. a selected pane shrinking into the
 *    floating field or neural scene, or the field's last pane expanding to fullscreen): not a new camera, no consumption.
 *  - Order among equally eligible feeds is a seeded hash of (seed, cycle, feed), so it varies per session and cycle.
 */
export const RECENT_WINDOW = 4;

interface Sim { seen: Set<string>; recent: string[]; cycle: number }

const hash = (seed: number, cycle: number, id: string) => {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(cycle + 1, 0x85ebca6b)) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return h >>> 0;
};

export interface DeckDiagnostics { size: number; cycle: number; seen: string[]; recent: string[]; commits: number }

/** What the controller needs from a deck. */
export interface FeedSelector {
  /** Catalog this selector draws from, when it can say (a feed outside it is not tracked). Optional for injected selectors. */
  readonly ids?: readonly string[];
  /** A fresh hold of this feed was reached (idempotent for the most recent feed). Returns true when it was new this cycle. */
  commit(feedId: string): boolean;
  /** Best-tier feeds for the next NEW camera, in seeded order, never including `exclude`. Pure. */
  eligible(exclude?: readonly (string | null | undefined)[]): string[];
}

export class FeedDeck implements FeedSelector {
  readonly ids: readonly string[];
  private seed: number;
  private sim: Sim = { seen: new Set(), recent: [], cycle: 0 };
  private commits = 0;

  constructor(ids: readonly string[], seed = 0) { this.ids = [...new Set(ids)]; this.seed = seed; }

  get size() { return this.ids.length; }
  get cycle() { return this.sim.cycle; }
  isSeen(id: string) { return this.sim.seen.has(id); }
  diagnostics(): DeckDiagnostics {
    return { size: this.ids.length, cycle: this.sim.cycle, seen: [...this.sim.seen], recent: [...this.sim.recent], commits: this.commits };
  }

  private step(s: Sim, id: string): boolean {
    const last = s.recent[s.recent.length - 1];
    if (last === id) return false; // continuity with the camera already on screen
    if (s.seen.size >= this.ids.length) { s.cycle++; s.seen = new Set(last ? [last] : []); } // explicit cycle advance
    const fresh = !s.seen.has(id);
    s.seen.add(id);
    s.recent.push(id); if (s.recent.length > RECENT_WINDOW) s.recent.shift();
    return fresh;
  }

  commit(feedId: string): boolean {
    if (!this.ids.includes(feedId)) return false;
    const fresh = this.step(this.sim, feedId);
    if (fresh) this.commits++;
    return fresh;
  }

  private order(s: Sim, exclude: ReadonlySet<string>): string[] {
    const full = s.seen.size >= this.ids.length;
    const last = s.recent[s.recent.length - 1];
    const seen = full ? new Set(last ? [last] : []) : s.seen;
    const cycle = full ? s.cycle + 1 : s.cycle;
    const recent = s.recent.slice(-RECENT_WINDOW);
    const tier = (id: string) => (seen.has(id) ? 2 : recent.includes(id) ? 1 : 0);
    const items = this.ids.filter((id) => !exclude.has(id)).map((id) => ({ id, t: tier(id), k: hash(this.seed, cycle, id) }));
    items.sort((a, b) => a.t - b.t || a.k - b.k || (a.id < b.id ? -1 : 1));
    return items.map((i) => i.id);
  }

  private bestTier(s: Sim, exclude: ReadonlySet<string>): string[] {
    const full = s.seen.size >= this.ids.length;
    const last = s.recent[s.recent.length - 1];
    const seen = full ? new Set(last ? [last] : []) : s.seen;
    const recent = s.recent.slice(-RECENT_WINDOW);
    const tier = (id: string) => (seen.has(id) ? 2 : recent.includes(id) ? 1 : 0);
    const ord = this.order(s, exclude);
    if (!ord.length) return [];
    const best = tier(ord[0]);
    return ord.filter((id) => tier(id) === best);
  }

  eligible(exclude: readonly (string | null | undefined)[] = []): string[] {
    return this.bestTier(this.sim, new Set(exclude.filter((x): x is string => !!x)));
  }

  /**
   * The next `count` NEW cameras for one route (e.g. later stops of a floating / neural visit), distinct from `exclude`
   * and from each other, simulating the deck on a copy. Pure: nothing is consumed until the holds are actually reached.
   */
  frontier(exclude: readonly (string | null | undefined)[], count: number): string[] {
    const sim: Sim = { seen: new Set(this.sim.seen), recent: [...this.sim.recent], cycle: this.sim.cycle };
    const ex = new Set(exclude.filter((x): x is string => !!x));
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const pick = this.bestTier(sim, ex)[0];
      if (!pick) break;
      out.push(pick); ex.add(pick);
      this.step(sim, pick);
    }
    return out;
  }
}
