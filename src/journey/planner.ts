import type { Branch, BranchSource } from './controller';
import { mulberry32 } from './layout';

/**
 * Seedable, runtime-varied route planner (pure, DOM-free). Between plain camera holds (the mosaic leg) the route
 * branches into the globe, the floating field or the neural scene. Each choice is made from the recent history:
 *  - the same kind never twice in a row, and short repeating patterns (A-B-A-B, A-B-C-A-B-C) are refused;
 *  - a kind absent from the last `MAX_STARVE` choices is forced next, so every mode is reached within a bounded
 *    number of choices (any 4 consecutive choices contain all available kinds);
 *  - otherwise kinds are drawn with weights that favour the ones not seen for longest;
 *  - the number of camera holds before a branch (2..4, sometimes 1 so a floating visit's fullscreen pane leads straight
 *    into the neural scene) and the number of stops of a visit (2..4) vary and avoid repeating the previous value.
 * `current()` is stable until `advance()`: a due branch that is still loading is retried with the same choice.
 * The production seed is random per session; `?seed=` (see `seedFromSearch`) makes a session reproducible for review.
 */
export type BranchKind = Branch['kind'];
export const ALL_KINDS: readonly BranchKind[] = ['globe', 'float', 'neural'];
/** A kind absent from this many consecutive choices is forced next. */
export const MAX_STARVE = 3;

const hashString = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

/** `?seed=` from a location search string (number or any text); `random()` otherwise. */
export function seedFromSearch(search: string, random: () => number): number {
  const v = new URLSearchParams(search).get('seed');
  if (v !== null && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n >>> 0 : hashString(v);
  }
  return random() >>> 0;
}

export class RoutePlanner implements BranchSource {
  readonly seed: number;
  private rng: () => number;
  private history: Branch[] = [];
  private cur: Branch | null = null;
  private off = new Set<BranchKind>();
  private lastAfter = 0;
  private lastStops = new Map<BranchKind, number>();

  private readonly kinds: readonly BranchKind[];

  constructor(seed: number, kinds: readonly BranchKind[] = ALL_KINDS) {
    this.kinds = kinds;
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
  }

  /** Every branch consumed or skipped so far, in order (for review and tests). */
  get chosen(): readonly Branch[] { return this.history; }

  /** A mode that failed to load: it is no longer chosen, and a due choice of that kind is replaced. */
  setUnavailable(kind: BranchKind) {
    this.off.add(kind);
    if (this.cur?.kind === kind) this.cur = null;
  }

  current(): Branch {
    if (!this.cur) this.cur = this.choose();
    return this.cur;
  }

  advance() {
    if (!this.cur) return; // an unavailable choice was already dropped; the next current() picks an alternative
    this.history.push(this.cur);
    this.cur = null;
  }

  private sinceLast(kind: BranchKind) {
    let n = 0;
    for (let i = this.history.length - 1; i >= 0 && this.history[i].kind !== kind; i--) n++;
    return n;
  }

  private allowed(kind: BranchKind) {
    const seq = [...this.history.map((b) => b.kind), kind];
    if (seq.length >= 2 && seq[seq.length - 1] === seq[seq.length - 2]) return false;
    for (const p of [2, 3]) {
      if (seq.length >= 2 * p && seq.slice(-p).every((k, i) => k === seq[seq.length - 2 * p + i])) return false;
    }
    return true;
  }

  private pickFrom(values: readonly number[], avoid: number) {
    const options = values.filter((v) => v !== avoid);
    const list = options.length ? options : values;
    return list[Math.floor(this.rng() * list.length) % list.length];
  }

  private choose(): Branch {
    const avail = this.kinds.filter((k) => !this.off.has(k));
    if (!avail.length) return { kind: 'globe', after: 3 }; // nothing can run: the controller skips it
    const last = this.history[this.history.length - 1]?.kind;
    let ok = avail.filter((k) => this.allowed(k));
    if (!ok.length) ok = avail.filter((k) => k !== last);
    if (!ok.length) ok = avail;

    let kind: BranchKind;
    const starved = ok.filter((k) => this.sinceLast(k) >= MAX_STARVE);
    if (starved.length) {
      const worst = Math.max(...starved.map((k) => this.sinceLast(k)));
      const tied = starved.filter((k) => this.sinceLast(k) === worst);
      kind = tied[Math.floor(this.rng() * tied.length) % tied.length];
    } else {
      const weights = ok.map((k) => 1 + 0.6 * Math.min(this.sinceLast(k), 6));
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      kind = ok[ok.length - 1];
      for (let i = 0; i < ok.length; i++) { r -= weights[i]; if (r < 0) { kind = ok[i]; break; } }
    }

    // A neural visit right after a floating one may follow the floating field's fullscreen last pane immediately.
    const straight = kind === 'neural' && last === 'float' && this.rng() < 0.5;
    const after = straight ? 1 : this.pickFrom([2, 3, 4], this.lastAfter);
    this.lastAfter = after;
    if (kind === 'globe') return { kind, after };
    const stops = this.pickFrom([2, 3, 4], this.lastStops.get(kind) ?? 0);
    this.lastStops.set(kind, stops);
    return { kind, after, stops };
  }
}
