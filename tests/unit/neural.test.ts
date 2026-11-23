import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, isNeuralStage, yearAxis, type Branch, type NeuralPlan, type Stage } from '../../src/journey/controller';
import { CITIES } from '../../src/journey/globe';
import { planFloatRoute } from '../../src/journey/floatField';
import { ANCHOR_FEEDS, holdMid, planNeuralRoute, type NeuralHold } from '../../src/journey/neuralRoute';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
// Hold windows shaped like the authored manifest (8 anchors, ~9.4 s apart, 2.8 s long).
const HOLDS: NeuralHold[] = ANCHOR_FEEDS.map((_, i) => ({ screen: `screen_0${i + 1}`, holdStart: 6.1 + 9.4 * i, holdEnd: 8.9 + 9.4 * i }));

describe('neural route planning', () => {
  it('starts on the screen of the feed that was fullscreen, never repeats an anchor or feed, 2..4 stops', () => {
    for (const from of [...FEED_IDS, null]) {
      for (let visit = 0; visit < 8; visit++) {
        for (const stops of [2, 3, 4]) {
          const plan = planNeuralRoute(from, stops, visit, HOLDS)!;
          expect(plan).not.toBeNull();
          expect(plan.feeds.length).toBe(stops); expect(plan.anchors.length).toBe(stops); expect(plan.times.length).toBe(stops);
          if (from) expect(plan.feeds[0]).toBe(from); // the same feed / video bridges into the scene
          if (from && ANCHOR_FEEDS.includes(from)) expect(plan.anchors[0]).toBe(ANCHOR_FEEDS.indexOf(from));
          expect(new Set(plan.anchors).size).toBe(stops);
          expect(new Set(plan.feeds).size).toBe(stops);
          plan.anchors.forEach((a, i) => {
            expect(plan.times[i]).toBeCloseTo(holdMid(HOLDS[a]), 9); // exact authored hold time of that stop
            if (i > 0) expect(plan.feeds[i]).toBe(ANCHOR_FEEDS[a]); // later stops show the feed that belongs to the screen
          });
        }
      }
    }
  });

  it('is monotonic per visit: never re-crosses an earlier focused anchor, for every first anchor, count and visit', () => {
    for (const from of [...ANCHOR_FEEDS, 'docked-cargo', null]) {
      for (let visit = 0; visit < 12; visit++) {
        for (const stops of [2, 3, 4]) {
          const plan = planNeuralRoute(from, stops, visit, HOLDS)!;
          expect(plan).not.toBeNull();
          const d = Math.sign(plan.anchors[1] - plan.anchors[0]);
          expect(d).not.toBe(0);
          for (let i = 1; i < plan.anchors.length; i++) {
            const step = (plan.anchors[i] - plan.anchors[i - 1]) * d;
            expect(step).toBeGreaterThanOrEqual(1); expect(step).toBeLessThanOrEqual(3);
            // the interval travelled contains no earlier focused anchor
            for (let j = 0; j < i - 1; j++) {
              const lo = Math.min(plan.anchors[i - 1], plan.anchors[i]); const hi = Math.max(plan.anchors[i - 1], plan.anchors[i]);
              expect(plan.anchors[j] >= lo && plan.anchors[j] <= hi).toBe(false);
            }
          }
          expect(plan.anchors.every((a) => a >= 0 && a < HOLDS.length)).toBe(true);
        }
      }
    }
  });

  it('varies deterministically across visits and uses both directions, not one fixed route', () => {
    const signs = new Set<number>(); const seqs = new Set<string>();
    for (const from of ['m04', 'm07']) for (let visit = 0; visit < 10; visit++) {
      const plan = planNeuralRoute(from, 3, visit, HOLDS)!;
      expect(planNeuralRoute(from, 3, visit, HOLDS)).toEqual(plan);
      seqs.add(plan.anchors.join(','));
      signs.add(Math.sign(plan.anchors[1] - plan.anchors[0]));
    }
    expect(signs.has(1)).toBe(true); expect(signs.has(-1)).toBe(true);
    expect(seqs.size).toBeGreaterThan(3);
  });

  it('refuses a scene with too few authored holds', () => {
    expect(planNeuralRoute('m01', 4, 0, HOLDS.slice(0, 3))).toBeNull();
  });
});

// ------------------------------------------------------------------ controller

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEED_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);

type NeuralPlanFn = (from: string | null, stops: number, visit: number) => NeuralPlan | 'wait' | null;
function make(branches: readonly Branch[], neuralPlan: NeuralPlanFn = (f, s, v) => planNeuralRoute(f, s, v, HOLDS)) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches, floatPlan: planFloatRoute, neuralPlan,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) =>
      reanchorTile({ tiles, feedIndex: FEED_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    feedOfTile: feedOf,
  });
  return c;
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) c.update(16); };
const leg = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const trace = (c: JourneyController) => {
  const seen: Stage[] = [];
  c.subscribe((s) => { if (seen[seen.length - 1] !== s.stage) seen.push(s.stage); });
  return seen;
};
const NEURAL3: Branch[] = [{ kind: 'neural', after: 2, stops: 3 }];

describe('neural bridge: one intent = one complete leg, then an indefinite hold', () => {
  it('shrinks the fullscreen pane into the scene, visits each authored stop, then pulls back to the globe hold', () => {
    const c = make(NEURAL3);
    leg(c); leg(c);
    const shared = feedOf(c.state.selectedId);
    const seen = trace(c);
    leg(c);
    expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(0);
    expect(c.state.neuralFeeds[0]).toBe(shared); // same feed and video through the entry bridge
    expect(c.state.neuralFeeds.length).toBe(3);
    leg(c); expect(c.state.neuralIdx).toBe(1);
    leg(c); expect(c.state.neuralIdx).toBe(2);
    const lastFeed = c.state.neuralFeeds[2];
    leg(c); // pull far back
    expect(seen).toEqual(['neuralIn', 'neural', 'neuralMove', 'neural', 'neuralMove', 'neural', 'neuralOut', 'globe']);
    expect(c.state.stage).toBe('globe');
    expect(c.state.destId).toBeNull(); // arrival at the globe does not pick a city
    expect(c.state.globeEased).toBe(1); expect(c.state.neuralFeeds.length).toBe(0);
    // the next fresh intent rotates a city, highlights it and zooms into its feed; it must differ from the last neural feed
    const seen2 = trace(c);
    leg(c);
    expect(seen2.slice(-3)).toEqual(['turning', 'entering', 'selected']);
    expect(c.state.sceneCityId).not.toBeNull();
    expect(feedOf(c.state.selectedId)).not.toBe(lastFeed);
  });

  it('every neural stop and the globe arrival are indefinite holds', () => {
    const c = make(NEURAL3);
    leg(c); leg(c); leg(c);
    for (let stop = 0; stop < 3; stop++) {
      const idx = c.state.neuralIdx;
      for (let i = 0; i < 7500; i++) c.update(16);
      expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(idx);
      leg(c);
    }
    expect(c.state.stage).toBe('globe');
    for (let i = 0; i < 7500; i++) c.update(16);
    expect(c.state.stage).toBe('globe');
  });

  it('refuses every intent during entry, travel and pull-back (no queued or skipped stop)', () => {
    const c = make(NEURAL3);
    leg(c); leg(c);
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    const seq: Stage[] = [c.state.stage];
    const run = () => {
      for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) {
        expect(c.dispatch({ type: 'intent' })).toBe(false);
        c.update(16);
        if (seq[seq.length - 1] !== c.state.stage) seq.push(c.state.stage);
      }
    };
    run();
    for (let n = 0; n < 2; n++) { expect(c.dispatch({ type: 'intent' })).toBe(true); run(); expect(c.state.neuralIdx).toBe(n + 1); }
    expect(c.dispatch({ type: 'intent' })).toBe(true); run();
    expect(seq).toEqual(['neuralIn', 'neural', 'neuralMove', 'neural', 'neuralMove', 'neural', 'neuralOut', 'globe']);
  });

  it('while pulling back, the globe fades up monotonically and ends fully formed', () => {
    const c = make([{ kind: 'neural', after: 2, stops: 2 }]);
    leg(c); leg(c); leg(c); leg(c);
    expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(1);
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    let prev = -1;
    for (let i = 0; i < 4000 && c.state.stage === 'neuralOut'; i++) {
      expect(c.state.globeEased).toBeGreaterThanOrEqual(prev); prev = c.state.globeEased;
      c.update(16);
    }
    expect(c.state.stage).toBe('globe'); expect(c.state.globeEased).toBe(1);
  });

  it('a manual intent made while the scene is loading is kept once and completes its whole leg when ready (never skipped)', () => {
    let ready = false; let asked = 0;
    const c = make(NEURAL3, (f, s, v) => { if (!ready) return 'wait'; asked++; return planNeuralRoute(f, s, v, HOLDS); });
    leg(c); leg(c);
    const id = c.state.selectedId;
    expect(c.dispatch({ type: 'intent' })).toBe(true); // accepted: ONE pending manual intent
    expect(c.pendingIntent).toBe(true);
    for (let i = 0; i < 300; i++) {
      c.update(16); // the visible camera hold stays while loading
      expect(c.state.stage).toBe('selected'); expect(c.state.selectedId).toBe(id);
      expect(c.dispatch({ type: 'intent' })).toBe(false); // momentum / repeats while pending are discarded, never queued
    }
    ready = true;
    c.update(16);
    expect(c.pendingIntent).toBe(false);
    expect(c.state.stage).toBe('neuralIn'); expect(c.state.neuralFeeds.length).toBe(3);
    const seen = trace(c);
    expect(c.dispatch({ type: 'intent' })).toBe(false); // the leg is travelling now
    toHold(c);
    expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(0); // it stops at the first hold: no extra stops
    for (let i = 0; i < 3000; i++) c.update(16);
    expect(c.state.stage).toBe('neural'); expect(c.state.neuralIdx).toBe(0);
    expect(asked).toBe(1); // the pending leg was started exactly once
    expect(seen).toEqual(['neuralIn', 'neural']); // 'neuralIn' is the refused burst's notification; one arrival only
  });

  it('a failed load clears the pending intent: the current hold stays and the next fresh intent works', () => {
    let failed = false;
    const c = make([{ kind: 'neural', after: 2, stops: 3 }, { kind: 'globe', after: 2 }], () => (failed ? null : 'wait'));
    leg(c); leg(c);
    const id = c.state.selectedId;
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    expect(c.pendingIntent).toBe(true);
    failed = true;
    c.update(16);
    expect(c.pendingIntent).toBe(false); // no hang
    expect(c.state.stage).toBe('selected'); expect(c.state.selectedId).toBe(id); // visible context intact, nothing invented
    for (let i = 0; i < 500; i++) c.update(16);
    expect(c.state.stage).toBe('selected');
    expect(c.dispatch({ type: 'intent' })).toBe(true); // a fresh intent runs the next (alternative) choice
    expect(c.state.stage).not.toBe('selected');
  });

  it('skips the branch only when the scene can never load', () => {
    const c = make([{ kind: 'neural', after: 2, stops: 3 }, { kind: 'globe', after: 2 }], () => null);
    const seen = trace(c);
    for (let i = 0; i < 12; i++) leg(c);
    expect(seen.some((s) => isNeuralStage(s))).toBe(false);
    expect(seen).toContain('globe');
  });

  it('longer authored distances take longer to travel', () => {
    const times = [10, 12, 70];
    const plan: NeuralPlan = { feeds: ['m01', 'm02', 'm03'], anchors: [0, 1, 2], times };
    const c = make(NEURAL3, () => plan);
    leg(c); leg(c); leg(c);
    const duration = () => { c.dispatch({ type: 'intent' }); let n = 0; while (!isHoldStage(c.state.stage) && n < 4000) { c.update(16); n++; } return n; };
    const near = duration(); const far = duration();
    expect(far).toBeGreaterThan(near * 1.5);
  });

  it('reaches every hold at a low frame rate', () => {
    const c = make(NEURAL3);
    for (let n = 0; n < 7; n++) {
      c.dispatch({ type: 'intent' });
      for (let i = 0; i < 200 && !isHoldStage(c.state.stage); i++) c.update(300);
      expect(isHoldStage(c.state.stage)).toBe(true);
    }
  });
});

describe('route variation across mosaic / floating / neural / globe', () => {
  const ROUTE: Branch[] = [
    { kind: 'globe', after: 3 }, { kind: 'float', after: 2, stops: 3 }, { kind: 'neural', after: 1, stops: 3 },
    { kind: 'float', after: 4, stops: 2 }, { kind: 'neural', after: 2, stops: 2 }, { kind: 'globe', after: 3 },
    { kind: 'float', after: 2, stops: 4 }, { kind: 'neural', after: 3, stops: 4 },
  ];

  it('branches follow the authored route after different numbers of holds, not a fixed A-B-C loop', () => {
    const c = make(ROUTE);
    const kinds: string[] = []; const holdsBefore: number[] = []; let holds = 0;
    const floatStops: number[] = []; const neuralStops: number[] = []; let stops = 0;
    c.subscribe((s) => {
      if (s.stage === 'selected') holds++;
      const start = s.stage === 'globeOut' ? 'globe' : s.stage === 'floatIn' ? 'float' : s.stage === 'neuralIn' ? 'neural' : null;
      if (start) { kinds.push(start); holdsBefore.push(holds); holds = 0; stops = 0; }
      if (s.stage === 'floating' || s.stage === 'neural') stops++;
      if (s.stage === 'selected' && stops > 0) { floatStops.push(stops); stops = 0; }
      if (s.stage === 'globe' && stops > 0) { neuralStops.push(stops); stops = 0; }
    });
    for (let i = 0; i < 120; i++) leg(c);
    expect(kinds.slice(0, 8)).toEqual(['globe', 'float', 'neural', 'float', 'neural', 'globe', 'float', 'neural']);
    expect(holdsBefore.slice(0, 8)).toEqual([3, 2, 1, 4, 2, 3, 2, 3]);
    expect(floatStops.slice(0, 3)).toEqual([3, 2, 4]);
    expect(neuralStops.slice(0, 3)).toEqual([3, 2, 4]);
    for (const n of [...floatStops, ...neuralStops]) { expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(4); }
  });

  it('a floating field\'s fullscreen last pane leads straight into the neural scene on that branch', () => {
    const c = make([{ kind: 'float', after: 2, stops: 2 }, { kind: 'neural', after: 1, stops: 2 }]);
    leg(c); leg(c); leg(c); leg(c); leg(c); // camera, camera, float in, float move, float exit (fullscreen, shared pane)
    expect(c.state.stage).toBe('selected');
    const lastFloatFeed = feedOf(c.state.selectedId);
    leg(c); // that same fullscreen pane shrinks into the neural scene
    expect(c.state.stage).toBe('neural');
    expect(c.state.neuralFeeds[0]).toBe(lastFloatFeed);
  });
});
