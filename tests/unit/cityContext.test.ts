import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis } from '../../src/journey/controller';
import { CityDecks, DEFAULT_CITY_ID, catalogIndices, cityFeedIds, cityOfFeed, stopFeeds, stopsFor } from '../../src/journey/cityContext';
import { ALL_FEEDS } from '../../src/journey/feeds';
import { CITIES, cityById } from '../../src/journey/globe';
import { generateMosaic } from '../../src/journey/layout';
import { MAX_ACTIVE_FEEDS, desiredPlayback } from '../../src/journey/playback';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { planFloatRoute } from '../../src/journey/floatField';
import { planNeuralRoute, type NeuralHold } from '../../src/journey/neuralRoute';

const IDS = ALL_FEEDS.map((f) => f.id);
const BUTLER = ['m01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05', 'city-butlerville-school-hall', 'city-butlerville-cafe', 'city-butlerville-stairwell', 'city-butlerville-classroom', 'city-butlerville-courtyard', 'city-butlerville-bus-interior',
  'city-butlerville-gym-reverse', 'city-butlerville-stair-corridor', 'city-butlerville-roadside', 'city-butlerville-upper-stairwell', 'city-butlerville-meva-e00f38fcfeed15f3', 'city-butlerville-meva-6ca7fe9c563418d9', 'city-butlerville-event-6be3a62539fcd5e7e29c', 'city-butlerville-event-5b53880db45458d170a8', 'city-butlerville-event-aa4fd544b8e12da53881', 'city-butlerville-event-42b9a7d07894762477da', 'city-butlerville-event-788995c15491e2f58728', 'city-butlerville-event-0cb69d3407458efbd9cb', 'city-butlerville-event-7d31316b3ce1c2c82ffc', 'city-butlerville-event-0be6b9181c39c2a7d918', 'city-butlerville-event-dfdbfd1a0a68b6f25919', 'city-butlerville-event-0e5edab9c311666c7614'];
const BUTLER_PRIMARY = BUTLER.slice(0, 4);
// Archived one-source fixture preserves generic finite-pool coverage without reactivating a destination.
const oneSourceFixture = { id: 'cairo', feedId: 'city-cairo' };
const testCity = (id: string) => id === 'cairo' ? oneSourceFixture : cityById(id);
const catalog = (city: string) => catalogIndices(cityFeedIds(testCity(city)), IDS);

// ---- city-scoped layouts, the way Journey builds them: one stable mosaic per city, tiles bound to the city's finite catalog ----
const VW = 1000; const WORLD = 3000; const YEARS = 8;
const ax = yearAxis(WORLD, VW, YEARS);
const layouts = new Map<string, { id: string; x: number; y: number; w: number; h: number; feedIndex: number }[]>();
function layoutOf(city: string | null) {
  const key = city ?? DEFAULT_CITY_ID;
  let l = layouts.get(key);
  if (!l) {
    const cat = catalog(key);
    const m = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: Math.max(1, cat.length), seed: 11 });
    l = m.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: cat[t.feedIndex] }));
    layouts.set(key, l);
  }
  return l;
}
const feedOfTileIn = (city: string | null, id: string | null) => { const t = id ? layoutOf(city).find((x) => x.id === id) : undefined; return t ? IDS[t.feedIndex] : null; };

function make(seed = 5) {
  const deck = new CityDecks(CITIES, seed);
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, initialCity: DEFAULT_CITY_ID,
    branches: [{ kind: 'globe', after: 1 }], seed, deck,
    planner: (leg) => {
      const tiles = layoutOf(c.state.cityId);
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)),
        currentFeed: cur?.feedIndex ?? null, currentTile: cur?.id ?? null,
      });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX, city) => reanchorTile({
      tiles: layoutOf(city ?? c.state.cityId), feedIndex: IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)),
    }),
    feedOfTile: (id, city) => feedOfTileIn(city ?? c.state.cityId, id),
  });
  return { c, deck };
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 6000 && !isHoldStage(c.state.stage); i++) c.update(16); };
const fwd = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const back = (c: JourneyController) => { expect(c.dispatch({ type: 'back' })).toBe(true); toHold(c); };

describe('initial ownership: Butlerville (its thirty real feeds)', () => {
  it('opens in Butlerville and its mosaic is bound only to its thirty feeds', () => {
    const { c } = make();
    expect(c.activeCity).toBe('butlerville');
    expect(cityFeedIds(cityById(DEFAULT_CITY_ID))).toEqual(BUTLER);
    const feeds = new Set(layoutOf('butlerville').map((t) => IDS[t.feedIndex]));
    for (const f of feeds) expect(BUTLER).toContain(f);
    expect(feeds.size).toBeGreaterThan(1);
  });
  it('startup sources: only Butlerville\'s thirty; no other city / unowned clip is part of the opening pool', () => {
    const startup = new Set(cityFeedIds(cityById(DEFAULT_CITY_ID)));
    expect([...startup]).toEqual(BUTLER);
    for (const id of IDS) if (!startup.has(id)) expect(cityOfFeed(id, CITIES)?.id).not.toBe('butlerville');
    const mosaicPlay = desiredPlayback({ stage: 'mosaic', selectedFeed: -1, targetFeed: -1, feedCount: IDS.length, pool: catalog('butlerville') });
    expect(IDS.filter((_, i) => mosaicPlay[i])).toEqual(IDS.filter((id) => BUTLER.includes(id))); // catalog index order
  });
  it('a stock city owns one clip: every tile of its mosaic is that source (honest reuse, no foreign feed)', () => {
    for (const t of layoutOf('cairo')) expect(IDS[t.feedIndex]).toBe('city-cairo'); // explicit one-source fixture
    expect(layoutOf('cairo').map((t) => t.id)).toEqual(layoutOf('butlerville').map((t) => t.id)); // stable tile ids across cities
  });
  it('a multi-clip city (Paris owns 9) binds its tiles only to its own nine and its deck cycles only them', () => {
    const own = cityFeedIds(cityById('paris'));
    expect(own.length).toBe(9); expect(own[0]).toBe('city-paris');
    const used = new Set(layoutOf('paris').map((t) => IDS[t.feedIndex]));
    for (const f of used) expect(own).toContain(f);
    expect(used.size).toBeGreaterThan(1);
    const d = new CityDecks(CITIES, 1); d.useCity('paris');
    expect([...d.eligible()].sort()).toEqual([...own].sort()); // all eight unseen: all eligible, none foreign
    expect(d.commit('city-paris')).toBe(true); expect(d.eligible().includes('city-paris')).toBe(false);
  });
});

describe('all modes select locally for a 4-source and a 1-source catalog', () => {
  const holds: NeuralHold[] = Array.from({ length: 8 }, (_, i) => ({ screen: `s${i}`, holdStart: i * 10, holdEnd: i * 10 + 4 }));
  it('Butlerville: 4 stops show 4 distinct own feeds in float and neural', () => {
    const n = stopsFor(4, BUTLER.length); expect(n).toBe(4);
    const later = stopFeeds(BUTLER, 'm01', n - 1, BUTLER_PRIMARY.slice(1));
    const f = planFloatRoute('m01', n, 0, later, true)!;
    expect(f.feeds.length).toBe(4); expect(new Set(f.feeds).size).toBe(4); for (const x of f.feeds) expect(BUTLER).toContain(x);
    const nr = planNeuralRoute('m01', n, 0, holds, later, true)!;
    expect(new Set(nr.feeds).size).toBe(4); for (const x of nr.feeds) expect(BUTLER).toContain(x);
  });
  it('one-source city: the minimum two stops, the same own source, every mode still plans', () => {
    const pool = cityFeedIds(oneSourceFixture);
    expect(pool).toEqual(['city-cairo']);
    const n = stopsFor(4, pool.length); expect(n).toBe(2);
    const later = stopFeeds(pool, 'city-cairo', n - 1, []);
    expect(later).toEqual(['city-cairo']);
    const f = planFloatRoute('city-cairo', n, 0, later, true)!;
    expect(f.feeds).toEqual(['city-cairo', 'city-cairo']);
    const nr = planNeuralRoute('city-cairo', n, 0, holds, later, true)!;
    expect(nr.feeds).toEqual(['city-cairo', 'city-cairo']);
    // without the finite-catalog allowance the old rule still refuses a repeated feed
    expect(planFloatRoute('city-cairo', 2, 0, later)).toBeNull();
  });
  it('a small pool never deadlocks and never leaves its city: distinct first, then own reuse', () => {
    expect(stopFeeds(['a', 'b'], 'a', 3, [])).toEqual(['b', 'a', 'b']);
    expect(stopFeeds(['a'], null, 3, [])).toEqual(['a', 'a', 'a']);
    expect(stopFeeds(['a', 'b'], 'a', 2, ['zzz-foreign', 'b'])).toEqual(['b', 'a']); // an out-of-pool suggestion is ignored
    expect(stopFeeds([], null, 2, [])).toEqual([]);
  });
  it('a camera leg in a one-source city reuses its source at another tile instead of refusing', () => {
    const tiles = layoutOf('cairo'); const cur = tiles[0];
    const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg: 1, prevYear: 0, currentFeed: cur.feedIndex, currentTile: cur.id });
    expect(p).not.toBeNull(); expect(p!.id).not.toBe(cur.id);
  });
  it('each city has its own deck (novelty / history); switching city never mixes them', () => {
    const d = new CityDecks([...CITIES, oneSourceFixture], 3);
    d.useCity('butlerville'); expect(d.commit('m01')).toBe(true);
    d.useCity('cairo'); expect(d.eligible()).toEqual(['city-cairo']); expect(d.commit('city-cairo')).toBe(true);
    expect(d.commit('m02')).toBe(false); // not a feed of the active city
    d.useCity('butlerville'); expect(d.eligible().includes('m01')).toBe(false);
    expect(d.hasUnseen('cairo')).toBe(false); expect(d.hasUnseen('paris')).toBe(true); expect(d.hasUnseen('tokyo')).toBe(true);
  });
});

describe('city context through the controller', () => {
  it('globe-out anchors the active city; the context changes only when a city is actually entered', () => {
    const { c } = make(9);
    fwd(c); fwd(c); // a camera hold, then the globe
    expect(c.state.stage).toBe('globe');
    expect(c.activeCity).toBe('butlerville'); expect(c.state.outCityId).toBe('butlerville');
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    for (let i = 0; i < 6000 && !isHoldStage(c.state.stage); i++) {
      if (c.state.stage === 'turning' || c.state.stage === 'entering') expect(c.activeCity).toBe('butlerville'); // not yet entered
      c.update(16);
    }
    expect(c.state.stage).toBe('selected');
    expect(c.activeCity).toBe(c.state.sceneCityId); expect(c.activeCity).not.toBe('butlerville');
  });

  it('every entered city lands on a REAL tile of its own mosaic, owned by that city; the next input contracts that same tile', () => {
    const { c } = make(5);
    fwd(c); fwd(c);
    for (let k = 0; k < 10; k++) {
      fwd(c); // enter a city
      const city = c.activeCity!;
      const id = c.state.selectedId!;
      expect(c.state.stage).toBe('selected');
      expect(id.startsWith('virtual:')).toBe(false);
      expect(layoutOf(city).some((t) => t.id === id)).toBe(true);
      expect(cityFeedIds(cityById(city))).toContain(feedOfTileIn(city, id)!);
      expect(c.dispatch({ type: 'intent' })).toBe(true); // next manual input: the pane contracts into that very tile
      expect(c.state.selectedId).toBe(id);
      expect(['contracting', 'mosaic'].includes(c.state.stage)).toBe(true);
      toHold(c);
      expect(c.state.stage).toBe('globe');
      expect(c.state.outCityId).toBe(city); // the overview is the actual active city, whatever feed was open
    }
  });

  it('back / redo restore the exact recorded city, source and tile with no reroll', () => {
    const { c, deck } = make(9);
    fwd(c); const s0 = c.state.selectedId; const s0feed = feedOfTileIn('butlerville', s0);
    fwd(c); const g1 = c.state.routeKey;
    fwd(c); const city = c.activeCity!; const s1 = c.state.selectedId; const s1feed = feedOfTileIn(city, s1); const y1 = c.selectedYear;
    expect(city).not.toBe('butlerville');
    fwd(c); const g2 = c.state.routeKey;
    const diag = JSON.stringify(deck.diagnostics());
    back(c); // the entered city's pane again
    expect([c.activeCity, c.state.selectedId, feedOfTileIn(city, c.state.selectedId), c.selectedYear]).toEqual([city, s1, s1feed, y1]);
    back(c); // the previous globe: its recorded city is the one that was LEFT
    expect(c.state.stage).toBe('globe'); expect(c.activeCity).toBe('butlerville'); expect(c.state.routeKey).toBe(g1);
    back(c);
    expect([c.activeCity, c.state.selectedId, feedOfTileIn('butlerville', c.state.selectedId)]).toEqual(['butlerville', s0, s0feed]);
    fwd(c); expect(c.state.stage).toBe('globe'); expect(c.activeCity).toBe('butlerville');
    fwd(c); expect([c.activeCity, c.state.selectedId, c.state.sceneCityId]).toEqual([city, s1, city]);
    fwd(c); expect(c.state.stage).toBe('globe'); expect(c.state.routeKey).toBe(g2); expect(c.activeCity).toBe(city);
    expect(JSON.stringify(deck.diagnostics())).toBe(diag); // replays consume no deck / RNG state
  });

  it('display modes never change the city: a float / neural visit keeps the active city', () => {
    const deck = new CityDecks(CITIES, 2);
    const feedsFor = (city: string) => cityFeedIds(cityById(city));
    const c: JourneyController = new JourneyController({
      worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, initialCity: 'butlerville', seed: 2, deck,
      branches: [{ kind: 'float', after: 1, stops: 3 }],
      floatPlan: (from, stops) => {
        const pool = feedsFor(c.state.cityId!); const n = stopsFor(stops, pool.length);
        return planFloatRoute(from, n, 0, stopFeeds(pool, from, n - 1, deck.frontier([from], n - 1)), true);
      },
      planner: (leg) => {
        const tiles = layoutOf(c.state.cityId); const cur = tiles.find((t) => t.id === c.state.selectedId);
        const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: 0, currentFeed: cur?.feedIndex ?? null, currentTile: cur?.id ?? null });
        return p && { id: p.id, x: p.x };
      },
      anchorFeed: (feedId, worldX, city) => reanchorTile({ tiles: layoutOf(city ?? c.state.cityId), feedIndex: IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
      feedOfTile: (id, city) => feedOfTileIn(city ?? c.state.cityId, id),
    });
    fwd(c); // camera
    fwd(c); // float visit starts: floatIn -> floating
    expect(c.state.stage).toBe('floating');
    expect(c.activeCity).toBe('butlerville');
    for (const f of c.state.floatFeeds) expect(BUTLER).toContain(f);
    while (c.state.stage === 'floating') { fwd(c); expect(c.activeCity).toBe('butlerville'); }
  });
});

describe('capped playback for the active city', () => {
  const n = IDS.length;
  it('route stages keep the cap of three even with a thirty-feed pool; the globe hold plays nothing', () => {
    const pool = catalog('butlerville');
    for (const stage of ['floating', 'floatMove', 'neural', 'neuralMove'] as const) {
      const d = desiredPlayback({ stage, selectedFeed: -1, targetFeed: -1, feedCount: n, pool, active: pool });
      expect(d.filter(Boolean).length).toBeLessThanOrEqual(MAX_ACTIVE_FEEDS);
    }
    expect(desiredPlayback({ stage: 'globe', selectedFeed: -1, targetFeed: -1, feedCount: n, pool }).some(Boolean)).toBe(false);
  });
  it('a selected camera plays alone; entering a one-source city plays only that city\'s clip', () => {
    const cairo = IDS.indexOf('city-cairo');
    const sel = desiredPlayback({ stage: 'selected', selectedFeed: cairo, targetFeed: -1, feedCount: n, pool: catalog('cairo') });
    expect(sel.filter(Boolean).length).toBe(1); expect(sel[cairo]).toBe(true);
    const ent = desiredPlayback({ stage: 'entering', selectedFeed: -1, targetFeed: cairo, feedCount: n, pool: catalog('cairo'), extra: [cairo] });
    expect(IDS.filter((_, i) => ent[i])).toEqual(['city-cairo']);
  });
  it('entering an nine-clip city decodes the ready target plus a small near set of its OWN feeds, never more than three; a mosaic hold plays the city pool', () => {
    const pool = catalog('paris'); expect(pool.length).toBe(9);
    const target = pool[2];
    const ent = desiredPlayback({ stage: 'entering', selectedFeed: -1, targetFeed: target, feedCount: n, pool, extra: [target] });
    const on = IDS.filter((_, i) => ent[i]);
    expect(on.length).toBeLessThanOrEqual(MAX_ACTIVE_FEEDS); expect(ent[target]).toBe(true);
    for (const f of on) expect(cityFeedIds(cityById('paris'))).toContain(f); // no foreign source
    const hold = desiredPlayback({ stage: 'mosaic', selectedFeed: -1, targetFeed: -1, feedCount: n, pool });
    expect(IDS.filter((_, i) => hold[i])).toEqual(cityFeedIds(cityById('paris')));
  });
});
