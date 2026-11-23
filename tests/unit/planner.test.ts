import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type Branch, type Stage } from '../../src/journey/controller';
import { planFloatRoute } from '../../src/journey/floatField';
import { CITIES } from '../../src/journey/globe';
import { generateMosaic } from '../../src/journey/layout';
import { ANCHOR_FEEDS, planNeuralRoute, type NeuralHold } from '../../src/journey/neuralRoute';
import { ALL_KINDS, MAX_STARVE, RoutePlanner, seedFromSearch, type BranchKind } from '../../src/journey/planner';
import { planLeg, reanchorTile } from '../../src/journey/route';

const take = (seed: number, n: number): Branch[] => {
  const p = new RoutePlanner(seed);
  for (let i = 0; i < n; i++) p.advance(), p.current();
  return [...p.chosen, p.current()];
};
const kindsOf = (list: readonly Branch[]) => list.map((b) => b.kind);
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 3);

describe('seeded route planner', () => {
  it('is reproducible for a seed and different across seeds', () => {
    expect(take(42, 40)).toEqual(take(42, 40));
    const seqs = new Set(SEEDS.map((s) => kindsOf(take(s, 10)).join(',')));
    expect(seqs.size).toBeGreaterThanOrEqual(12);
    const full = new Set(SEEDS.map((s) => JSON.stringify(take(s, 10))));
    expect(full.size).toBe(SEEDS.length);
  });

  it('keeps the current choice stable until it is consumed (retries while loading never re-roll)', () => {
    const p = new RoutePlanner(7);
    const first = p.current();
    for (let i = 0; i < 20; i++) expect(p.current()).toBe(first);
    expect(p.chosen.length).toBe(0);
    p.advance();
    expect(p.chosen).toEqual([first]);
    expect(p.current()).not.toBe(first);
  });

  it('reaches every mode within a bounded number of choices (any 4 consecutive choices contain all kinds)', () => {
    expect(MAX_STARVE).toBe(3);
    for (const s of SEEDS) {
      const kinds = kindsOf(take(s, 80));
      for (let i = 0; i + 4 <= kinds.length; i++) expect(new Set(kinds.slice(i, i + 4)).size).toBe(ALL_KINDS.length);
    }
  });

  it('never repeats a kind back to back and never falls into a short repeating cycle (A-B-A-B, A-B-C-A-B-C)', () => {
    for (const s of SEEDS) {
      const k = kindsOf(take(s, 80));
      for (let i = 1; i < k.length; i++) expect(k[i]).not.toBe(k[i - 1]);
      for (const p of [2, 3]) {
        for (let i = 2 * p; i <= k.length; i++) {
          const a = k.slice(i - 2 * p, i - p).join(); const b = k.slice(i - p, i).join();
          expect(a).not.toBe(b);
        }
      }
    }
  });

  it('varies camera holds before a branch (1 to 4) and floating/neural stops (2 to 4)', () => {
    const afters = new Set<number>(); const stops = new Set<number>();
    for (const s of SEEDS) {
      let lastAfter = -1;
      for (const b of take(s, 60)) {
        expect(b.after).toBeGreaterThanOrEqual(1); expect(b.after).toBeLessThanOrEqual(4);
        if (b.after === 1) expect(b.kind).toBe('neural'); // only straight after a floating field's fullscreen pane
        if (b.after !== 1 && lastAfter !== 1) expect(b.after).not.toBe(lastAfter); // gaps do not repeat
        lastAfter = b.after; afters.add(b.after);
        if (b.kind === 'globe') expect(b.stops).toBeUndefined();
        else { expect(b.stops).toBeGreaterThanOrEqual(2); expect(b.stops).toBeLessThanOrEqual(4); stops.add(b.stops!); }
      }
    }
    expect([...afters].sort()).toEqual([1, 2, 3, 4]); expect([...stops].sort()).toEqual([2, 3, 4]);
  });

  it('drops a mode that failed to load: the due choice is replaced and the mode is never chosen again', () => {
    const p = new RoutePlanner(11);
    const dueKind = p.current().kind;
    p.setUnavailable(dueKind);
    for (let i = 0; i < 30; i++) { expect(p.current().kind).not.toBe(dueKind); p.advance(); }
    expect(p.chosen.every((b) => b.kind !== dueKind)).toBe(true);
  });

  it('seed comes from ?seed= (number or text) and is random otherwise', () => {
    expect(seedFromSearch('?seed=42', () => 5)).toBe(42);
    expect(seedFromSearch('?x=1&seed=42', () => 5)).toBe(42);
    expect(seedFromSearch('?seed=review-a', () => 5)).toBe(seedFromSearch('?seed=review-a', () => 9));
    expect(seedFromSearch('?seed=review-a', () => 5)).not.toBe(seedFromSearch('?seed=review-b', () => 5));
    expect(seedFromSearch('', () => 1234)).toBe(1234);
    expect(seedFromSearch('?seed=', () => 1234)).toBe(1234);
  });
});

// ------------------------------------------------------------------ planner driving the controller

const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
const HOLDS: NeuralHold[] = ANCHOR_FEEDS.map((_, i) => ({ screen: `screen_0${i + 1}`, holdStart: 6.1 + 9.4 * i, holdEnd: 8.9 + 9.4 * i }));
const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEED_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);
const yearOf = (c: JourneyController) => Math.floor(ax.indexAt(c.state.worldX));

function make(planner: RoutePlanner, floatPlan: (f: string | null, s: number, v: number) => ReturnType<typeof planFloatRoute> | 'wait' = planFloatRoute) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branchSource: planner, floatPlan,
    neuralPlan: (f, s, v) => planNeuralRoute(f, s, v, HOLDS),
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: yearOf(c), currentFeed: cur?.feedIndex ?? null });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) =>
      reanchorTile({ tiles, feedIndex: FEED_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    feedOfTile: feedOf,
  });
  return c;
}

describe('varied route driving the journey', () => {
  it('reaches every mode, keeps 2-4 stops, holds indefinitely, refuses bursts without consuming choices, keeps years non-monotonic', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const planner = new RoutePlanner(seed);
      const c = make(planner);
      const starts: BranchKind[] = []; const stops: number[] = [];
      const years: number[] = []; const arrivals: { feed: string | null; globeBetween: boolean }[] = [];
      let globeSeen = false;
      let prevStage: Stage | null = null;
      c.subscribe((s) => {
        // The controller also notifies for every (refused) intent while the stage is unchanged, so only actual stage
        // transitions count as a branch entry or an arrival.
        const stage: Stage = s.stage;
        if (stage === prevStage) return;
        prevStage = stage;
        if (stage === 'globeOut') starts.push('globe');
        if (stage === 'floatIn') { starts.push('float'); stops.push(s.floatFeeds.length); }
        if (stage === 'neuralIn') { starts.push('neural'); stops.push(s.neuralFeeds.length); }
        if (stage === 'globe') globeSeen = true;
        if (stage === 'selected') { years.push(yearOf(c)); arrivals.push({ feed: feedOf(s.selectedId), globeBetween: globeSeen }); globeSeen = false; }
      });
      for (let i = 0; i < 160; i++) {
        expect(c.dispatch({ type: 'intent' })).toBe(true);
        for (let k = 0; k < 4000 && !isHoldStage(c.state.stage); k++) {
          expect(c.dispatch({ type: 'intent' })).toBe(false); // bursts during travel are discarded
          c.update(16);
        }
        const hold = c.state.stage; const before = planner.chosen.length;
        for (let k = 0; k < 300; k++) c.update(16);
        expect(c.state.stage).toBe(hold); expect(planner.chosen.length).toBe(before); // no autoplay between holds
      }
      expect(new Set(starts).size).toBe(3); // globe, float and neural all reached
      expect(planner.chosen.length).toBe(starts.length); // every started branch consumed exactly one choice, none extra
      expect(planner.chosen.map((b) => b.kind)).toEqual(starts);
      for (const n of stops) { expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(4); }
      const deltas = years.slice(1).map((y, i) => y - years[i]);
      expect(deltas.some((d) => d > 0)).toBe(true); expect(deltas.some((d) => d < 0)).toBe(true);
      for (let i = 1; i < arrivals.length; i++) {
        if (!arrivals[i].globeBetween) expect(arrivals[i].feed).not.toBe(arrivals[i - 1].feed); // no same-feed repeat on camera/field legs
      }
    }
  });

  it('a due branch that is still loading keeps the same choice, holds the context and is never consumed', () => {
    let seed = 0;
    for (; seed < 400; seed++) if (new RoutePlanner(seed).current().kind === 'float') break;
    const planner = new RoutePlanner(seed);
    let ready = false;
    const c = make(planner, (f, s, v) => (ready ? planFloatRoute(f, s, v) : 'wait'));
    let waited = false;
    for (let i = 0; i < 12 && !waited; i++) {
      expect(c.dispatch({ type: 'intent' })).toBe(true);
      if (c.pendingIntent) { waited = true; break; } // accepted, but its mode is still loading
      for (let k = 0; k < 4000 && !isHoldStage(c.state.stage); k++) c.update(16);
    }
    expect(waited).toBe(true);
    const due = planner.current();
    const id = c.state.selectedId;
    for (let i = 0; i < 8; i++) {
      c.update(16);
      expect(c.dispatch({ type: 'intent' })).toBe(false); // discarded while pending
      expect(c.state.stage).toBe('selected'); expect(c.state.selectedId).toBe(id);
      expect(planner.current()).toBe(due); expect(planner.chosen.length).toBe(0); // nothing consumed until it really starts
    }
    ready = true;
    c.update(16);
    expect(c.state.stage).toBe('floatIn'); // the SAME requested leg starts, no further intent needed
    expect(planner.chosen).toEqual([due]); // consumed exactly once
    for (let k = 0; k < 4000 && !isHoldStage(c.state.stage); k++) c.update(16);
    expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(0);
    expect(planner.chosen.length).toBe(1);
  });
});
