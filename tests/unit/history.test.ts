import { describe, expect, it } from 'vitest';
import {
  JourneyController, isHoldStage, yearAxis,
  type Branch, type BranchSource, type FloatPlan, type NeuralPlan,
} from '../../src/journey/controller';
import { IntentGate, keyDirection } from '../../src/journey/intent';
import { FEEDS } from '../../src/journey/feeds';
import { CITIES } from '../../src/journey/globe';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEEDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOfTile = (id: string) => { if (id.startsWith('virtual:')) return id.slice(8); const t = tiles.find((x) => x.id === id); return t ? FEEDS[t.feedIndex].id : null; };
const anchorFeed = (feedId: string, worldX: number) => {
  const fi = FEEDS.findIndex((f) => f.id === feedId);
  if (fi < 0) return null;
  return reanchorTile({ tiles, feedIndex: fi, vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) });
};

/** Branch source that counts how often the (seeded, in production) route planner is consulted. */
class Spy implements BranchSource {
  current_ = 0; advance_ = 0; private i = 0;
  constructor(private list: readonly Branch[]) {}
  current() { this.current_++; return this.list[this.i % this.list.length]; }
  advance() { this.advance_++; this.i++; }
}

function make(branches: readonly Branch[] = [], opts: { neuralWait?: () => boolean } = {}) {
  const spy = new Spy(branches.length ? branches : [{ kind: 'globe', after: 99 }]);
  const n = { planner: 0, float: 0, neural: 0 };
  const plans: { float?: FloatPlan; neural?: NeuralPlan } = {};
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branchSource: spy,
    feedOfTile, anchorFeed,
    yearOfTile: (id) => { const t = tiles.find((x) => x.id === id); return t ? Math.floor(ax.indexAt(t.x + t.w / 2 - VW / 2)) : null; },
    planner: (leg) => {
      n.planner++;
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg,
        prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null,
      });
      return p && { id: p.id, x: p.x };
    },
    floatPlan: (from) => {
      n.float++;
      return (plans.float = { feeds: [from ?? 'm01', 'm02', 'm03'], framing: ['medium', 'full', 'medium'] });
    },
    neuralPlan: (from) => {
      if (opts.neuralWait?.()) return 'wait';
      n.neural++;
      return (plans.neural = { feeds: [from ?? 'm01', 'm02', 'm03'], anchors: [3, 5, 8], times: [0, 10, 20] });
    },
  });
  return { c, spy, n, plans };
}

type C = JourneyController;
const toHold = (c: C) => { for (let i = 0; i < 4000; i++) { c.update(16); if (isHoldStage(c.state.stage)) return; } throw new Error(`no hold, stuck in ${c.state.stage}`); };
const fwd = (c: C) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const back = (c: C) => { expect(c.dispatch({ type: 'back' })).toBe(true); toHold(c); };
const pos = (c: C) => ({ stage: c.state.stage, id: c.state.selectedId, x: c.state.worldX, feed: c.state.selectedId ? feedOfTile(c.state.selectedId) : null, city: c.state.sceneCityId });
/** Distinct stages and the progress values seen while one leg runs. */
function trace(c: C, dir: 'intent' | 'back') {
  const stages: string[] = [];
  const un = c.subscribe((s) => { if (stages[stages.length - 1] !== s.stage) stages.push(s.stage); });
  expect(c.dispatch({ type: dir })).toBe(true);
  if (stages[stages.length - 1] !== c.state.stage) stages.push(c.state.stage);
  const p: { floatP: number[]; neuralP: number[]; globeP: number[]; legRev: boolean[] } = { floatP: [], neuralP: [], globeP: [], legRev: [] };
  for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) {
    c.update(16);
    p.floatP.push(c.state.floatP); p.neuralP.push(c.state.neuralP); p.globeP.push(c.state.globeP); p.legRev.push(c.state.legRev);
  }
  un();
  return { stages, ...p };
}
const nonIncreasing = (a: number[]) => a.every((v, i) => i === 0 || v <= a[i - 1] + 1e-9);

describe('history: camera holds', () => {
  it('selected A -> B -> back A -> forward B restores the exact recorded holds; the planner is not consulted', () => {
    const { c, n } = make();
    fwd(c); const A = pos(c); fwd(c); const B = pos(c);
    expect(B.id).not.toBe(A.id);
    const planned = n.planner;
    const t = trace(c, 'back');
    expect(t.stages).toEqual(['contracting', 'scanning', 'expanding', 'selected']);
    expect(t.legRev.slice(0, -1).every(Boolean)).toBe(true);
    expect(pos(c)).toEqual(A); // same tile, same scroll => same feed and year
    expect(c.state.legRev).toBe(false);
    fwd(c);
    expect(pos(c)).toEqual(B);
    expect(n.planner).toBe(planned); // no new plan for either direction
    fwd(c); // the frontier: a genuinely new leg again
    expect(n.planner).toBe(planned + 1);
    expect(pos(c).id).not.toBe(B.id);
  });

  it('back from the first camera returns to the mosaic hold, then the first hold is a safe no-op', () => {
    const { c } = make();
    expect(c.dispatch({ type: 'back' })).toBe(false); // first hold: nothing before it
    expect(c.state.stage).toBe('mosaic');
    fwd(c); const A = pos(c);
    back(c);
    expect(c.state.stage).toBe('mosaic');
    expect(c.state.worldX).toBe(0);
    expect(c.dispatch({ type: 'back' })).toBe(false);
    expect(c.state.stage).toBe('mosaic');
    fwd(c); expect(pos(c)).toEqual(A); // redo, not a new plan
  });

  it('burst / repeat lock: nothing is accepted while a history leg runs, and no extra step is taken', () => {
    const { c } = make();
    fwd(c); fwd(c); fwd(c);
    const hist = c.history.cursor;
    expect(c.dispatch({ type: 'back' })).toBe(true);
    for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) {
      expect(c.dispatch({ type: 'back' })).toBe(false);
      expect(c.dispatch({ type: 'intent' })).toBe(false);
      c.update(16);
    }
    expect(c.history.cursor).toBe(hist - 1);
  });

  it('a layout re-anchor of the current hold is what history later restores', () => {
    const { c } = make();
    fwd(c); fwd(c);
    const B = pos(c);
    const alt = tiles.find((t) => t.id !== B.id && feedOfTile(t.id) === B.feed);
    if (!alt) return;
    c.rebase(alt.id, alt.x + alt.w / 2 - VW / 2);
    back(c); fwd(c);
    expect(c.state.selectedId).toBe(alt.id);
    expect(feedOfTile(c.state.selectedId!)).toBe(B.feed);
  });

  it('the semantic selected year survives a responsive rebase onto a different physical tile, and back / redo', () => {
    const { c } = make();
    // Deterministic seeded fixture: advance until the open stop has a same-feed tile at a different year.
    let B = pos(c); let alt: (typeof tiles)[number] | undefined;
    for (let i = 0; i < 6 && !alt; i++) {
      fwd(c);
      B = pos(c);
      const y = c.selectedYear;
      alt = tiles.find((t) => t.id !== B.id && feedOfTile(t.id) === B.feed && Math.floor(ax.indexAt(t.x + t.w / 2 - VW / 2)) !== y);
    }
    expect(alt).toBeDefined();
    if (!alt) return;
    const year = c.selectedYear;
    expect(year).not.toBeNull();
    c.rebase(alt.id, alt.x + alt.w / 2 - VW / 2);
    expect(c.selectedYear).toBe(year);
    back(c); fwd(c);
    expect(c.selectedYear).toBe(year);
    expect(feedOfTile(c.state.selectedId!)).toBe(B.feed);
  });
});

describe('history: floating field', () => {
  const branches: Branch[] = [{ kind: 'float', after: 1, stops: 3 }];
  it('adjacent back / redo replays the recorded stops with reversed progress and no re-plan', () => {
    const { c, spy, n } = make(branches);
    fwd(c); const A = pos(c);
    fwd(c); expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(0);
    fwd(c); expect(c.state.floatIdx).toBe(1);
    const feeds = [...c.state.floatFeeds];
    const adv = spy.advance_; const cur = spy.current_;
    const t = trace(c, 'back');
    expect(t.stages).toEqual(['floatMove', 'floating']);
    expect(nonIncreasing(t.floatP)).toBe(true); // the same field path, flown backwards
    expect(t.legRev.slice(0, -1).every(Boolean)).toBe(true);
    expect(c.state.floatIdx).toBe(0);
    fwd(c); expect(c.state.floatIdx).toBe(1); expect([...c.state.floatFeeds]).toEqual(feeds);
    expect(n.float).toBe(1);
    expect(spy.advance_).toBe(adv); expect(spy.current_).toBe(cur);
    // back out of the field: floatIn reversed lands on the very camera hold it came from
    back(c); back(c);
    expect(pos(c)).toEqual(A);
    expect(c.state.floatFeeds.length).toBe(0);
  });

  it('floatOut reversed returns into the last stop; holds, stored routes and the selected landing are exact', () => {
    const { c, plans } = make(branches);
    fwd(c); fwd(c); fwd(c); fwd(c); fwd(c); // A, floating 0..2, then floatOut -> F
    const F = pos(c);
    expect(F.stage).toBe('selected');
    const original = [...plans.float!.feeds];
    plans.float!.feeds[2] = 'm09'; // a later mutation of the planner's own array must not reach the recorded hold
    const t = trace(c, 'back');
    expect(t.stages).toEqual(['floatOut', 'floating']);
    expect(nonIncreasing(t.floatP)).toBe(true);
    expect(c.state.floatIdx).toBe(2);
    expect([...c.state.floatFeeds]).toEqual(original);
    fwd(c);
    expect(pos(c)).toEqual(F);
  });
});

describe('history: neural scene and globe, across modes', () => {
  const branches: Branch[] = [{ kind: 'neural', after: 1, stops: 3 }, { kind: 'globe', after: 1 }];
  it('neural stops, neuralOut and the globe hold all reverse and redo without consulting the planner', () => {
    const { c, spy, n } = make(branches);
    fwd(c); const A = pos(c);
    fwd(c); fwd(c); fwd(c); // neural 0, 1, 2
    expect(c.state.neuralIdx).toBe(2);
    fwd(c); // neuralOut -> globe
    expect(c.state.stage).toBe('globe');
    const G = { lon: c.state.lon, lat: c.state.lat };
    const adv = spy.advance_; const cur = spy.current_;

    const out = trace(c, 'back'); // globe -> neural stop 2: neuralOut reversed
    expect(out.stages).toEqual(['neuralOut', 'neural']);
    expect(nonIncreasing(out.neuralP)).toBe(true); expect(nonIncreasing(out.globeP)).toBe(true);
    expect(c.state.neuralIdx).toBe(2);
    const mv = trace(c, 'back');
    expect(mv.stages).toEqual(['neuralMove', 'neural']);
    expect(nonIncreasing(mv.neuralP)).toBe(true);
    expect(c.state.neuralIdx).toBe(1);
    back(c); expect(c.state.neuralIdx).toBe(0);
    back(c); expect(pos(c)).toEqual(A); // neuralIn reversed: the same camera hold
    back(c); expect(c.state.stage).toBe('mosaic');
    expect(c.dispatch({ type: 'back' })).toBe(false);

    for (let i = 0; i < 5; i++) fwd(c); // A, neural 0, 1, 2, globe: all recorded, none planned
    expect(c.state.stage).toBe('globe');
    expect({ lon: c.state.lon, lat: c.state.lat }).toEqual(G);
    expect(n.neural).toBe(1);
    expect(spy.advance_).toBe(adv); expect(spy.current_).toBe(cur);
    // at the frontier a fresh city leg runs normally
    fwd(c); expect(c.state.stage).toBe('selected'); expect(c.state.sceneCityId).not.toBeNull();
  });

  it('globe entry: back leaves the city and rotates to the previous aim, then re-enters the camera it came from', () => {
    const { c, spy } = make([{ kind: 'globe', after: 1 }]);
    fwd(c); const A = pos(c);
    fwd(c); expect(c.state.stage).toBe('globe');
    const G = { lon: c.state.lon, lat: c.state.lat };
    fwd(c); const C = pos(c);
    expect(C.stage).toBe('selected'); expect(C.city).not.toBeNull();
    const adv = spy.advance_; const cur = spy.current_;

    const t1 = trace(c, 'back');
    // R48 A2: the reverse of a city entry is that entry's own scale path backwards, not a generic tile contraction + globeOut.
    expect(t1.stages[0]).toBe('entering'); expect(t1.stages).not.toContain('contracting'); expect(t1.stages).not.toContain('globeOut');
    expect(t1.stages[t1.stages.length - 1]).toBe('globe');
    expect({ lon: c.state.lon, lat: c.state.lat }).toEqual(G);
    const t2 = trace(c, 'back');
    expect(t2.stages).toEqual(['entering', 'selected']); // the pane grows back out of the globe
    expect(pos(c)).toEqual(A);

    fwd(c); expect({ lon: c.state.lon, lat: c.state.lat }).toEqual(G); expect(c.state.stage).toBe('globe');
    fwd(c); expect(pos(c)).toEqual(C); // same city, same tile: not a newly picked one
    expect(spy.advance_).toBe(adv); expect(spy.current_).toBe(cur);
  });

  it('globe entry back: starts at the fullscreen pose of the entry curve and reverses it exactly (no tile contraction, no planning)', () => {
    const { c, spy, n } = make([{ kind: 'globe', after: 1 }]);
    fwd(c); fwd(c);
    const G = { lon: c.state.lon, lat: c.state.lat };
    // Forward entry: record the leg-time path (T runs 0 -> 1 backwards as travelP rises, i.e. T = 1 - travelP).
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    const fwdP: number[] = [];
    while (!isHoldStage(c.state.stage)) { c.update(16); if (c.state.stage === 'entering') fwdP.push(c.state.travelP); }
    const C = pos(c); const cityId = c.state.sceneCityId; const feedC = C.feed;
    const adv = spy.advance_; const cur = spy.current_; const planned = n.planner;

    expect(c.dispatch({ type: 'back' })).toBe(true);
    // Immediately on the entry's fullscreen end: same city, same tile, same feed; the reversed leg is flagged.
    const s0 = c.state;
    expect(s0.stage).toBe('entering'); expect(s0.legRev).toBe(true); expect(s0.travelP).toBe(1);
    expect(s0.destId).toBe(cityId); expect(s0.entryTileId).toBe(C.id); expect(s0.entryFeedId).toBe(feedC);
    expect(s0.progress).toBe(0); // never a tile-contraction progress
    const revP: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) {
      c.update(16); seen.add(c.state.stage);
      if (c.state.stage === 'entering') { revP.push(c.state.travelP); expect(c.state.destId).toBe(cityId); expect(c.state.entryTileId).toBe(C.id); }
    }
    expect(seen.has('contracting')).toBe(false); expect(seen.has('globeOut')).toBe(false);
    expect(nonIncreasing(revP)).toBe(true);
    // Same curve, same speed: the reversed samples cover the forward ones (same step count within a frame).
    expect(Math.abs(revP.length - fwdP.length)).toBeLessThanOrEqual(2);
    expect(c.state.stage).toBe('globe');
    expect({ lon: c.state.lon, lat: c.state.lat }).toEqual(G); // exact previous aim
    expect(c.state.legRev).toBe(false);
    expect(spy.advance_).toBe(adv); expect(spy.current_).toBe(cur); expect(n.planner).toBe(planned);
    fwd(c); expect(pos(c)).toEqual(C); // exact redo: same city, same tile
  });

  it('a pending (still loading) intent refuses history input; ready then runs exactly that one leg', () => {
    let ready = false;
    const { c } = make([{ kind: 'neural', after: 1, stops: 3 }], { neuralWait: () => !ready });
    fwd(c); // camera A
    expect(c.dispatch({ type: 'intent' })).toBe(true); // the due neural branch is still loading: this ONE intent waits
    c.update(16);
    expect(c.pendingIntent).toBe(true);
    expect(c.dispatch({ type: 'back' })).toBe(false);
    expect(c.dispatch({ type: 'intent' })).toBe(false);
    ready = true;
    toHold(c);
    expect(c.state.stage).toBe('neural');
    expect(c.pendingIntent).toBe(false);
  });
});

describe('input direction mapping', () => {
  it('keys: ArrowRight / Enter / Space forward, ArrowLeft back, others ignored; repeat and lock suppress', () => {
    expect(['ArrowRight', 'Enter', ' '].map(keyDirection)).toEqual([1, 1, 1]);
    expect(keyDirection('ArrowLeft')).toBe(-1);
    expect(keyDirection('a')).toBe(0);
    const g = new IntentGate();
    expect(g.keyDir(1000, 'ArrowLeft', false, false)).toBe(-1);
    expect(g.keyDir(1500, 'ArrowLeft', true, false)).toBe(0);
    expect(g.keyDir(1500, 'ArrowRight', false, true)).toBe(0);
    expect(g.keyDir(1500, 'ArrowRight', false, false)).toBe(1);
    expect(g.keyDir(3000, 'x', false, false)).toBe(0);
  });

  it('wheel: down/right forward, up/left back; momentum and opposite-sign tails never fire a second intent', () => {
    expect(new IntentGate().wheelDir(1000, 0, 40, false)).toBe(1);
    expect(new IntentGate().wheelDir(1000, 0, -40, false)).toBe(-1);
    expect(new IntentGate().wheelDir(1000, 40, 5, false)).toBe(1);
    expect(new IntentGate().wheelDir(1000, -40, 5, false)).toBe(-1);
    const g = new IntentGate();
    expect(g.wheelDir(1000, 0, -50, false)).toBe(-1);
    let fired = 0;
    for (let t = 1016; t < 1900; t += 16) if (g.wheelDir(t, 0, t % 32 ? 30 : -30, false) !== 0) fired++;
    expect(fired).toBe(0);
    expect(new IntentGate().wheelDir(1000, 0, -40, true)).toBe(0); // locked while travelling / pending
  });

  it('touch: swipe up / left forward, down / right back; a short or locked swipe does nothing', () => {
    const dir = (dx: number, dy: number, locked = false) => { const g = new IntentGate(); g.pointerDown(100, locked); return g.swipeDir(400, dx, dy, locked); };
    expect(dir(0, -90)).toBe(1);
    expect(dir(0, 90)).toBe(-1);
    expect(dir(-90, 0)).toBe(1);
    expect(dir(90, 0)).toBe(-1);
    expect(dir(5, 8)).toBe(0);
    expect(dir(0, 90, true)).toBe(0);
  });
});
