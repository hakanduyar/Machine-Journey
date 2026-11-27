import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis } from '../../src/journey/controller';
import { ALL_FEEDS, FEEDS } from '../../src/journey/feeds';
import { EXTRA_SOURCES, EVENT_SOURCES } from '../../src/journey/cityFeeds';
import { ARCS, CITIES, ALL_CITIES, ACTIVE_CITY_IDS, HUBS, cityById, routeArcs, routeSig } from '../../src/journey/globe';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

describe('catalog: authored demo cities plus verified source places on the twelve feeds', () => {
  it('has unique, valid cities; every feed is reachable; demo cities are >8 degrees apart', () => {
    expect(CITIES.length).toBe(12);
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(12);
    expect(new Set(CITIES.map((c) => c.name)).size).toBe(12);
    expect(FEEDS.length).toBe(12); // the CORE pool is unchanged; the 21 city clips are the separate CITY_FEEDS set
    const feeds = new Set(ALL_FEEDS.map((f) => f.id));
    const reach = new Set<string>();
    for (const c of CITIES) {
      expect(Number.isFinite(c.lon) && c.lon >= -180 && c.lon <= 180).toBe(true);
      expect(Number.isFinite(c.lat) && c.lat >= -90 && c.lat <= 90).toBe(true);
      expect(feeds.has(c.feedId)).toBe(true);
      for (const f of c.feedIds ?? [c.feedId]) { expect(feeds.has(f)).toBe(true); reach.add(f); }
    }
    // every city opens its own source: 21 unique base city clips + the approved additional clips + the verified places' eleven core feeds
    // (Savannah parked-c130; Butlerville m01 m02 m06 parking-walk m03 m07 covered-road m04 m05; Palmdale palmdale-dc8). The earlier "+ 6" omitted
    // Butlerville's five R51-admitted core feeds (m03 m07 covered-road m04 m05), so it was already 5 short of the real reach before any later row.
    const verifiedCoreFeeds = ['parked-c130', 'm01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05', 'palmdale-dc8'];
    expect(reach.size).toBe(9 + EXTRA_SOURCES.filter(s => ACTIVE_CITY_IDS.includes(s.cityId)).length + EVENT_SOURCES.length + verifiedCoreFeeds.length);
    // exact membership, not just a count: the reach is precisely the base clips, the extras and those known core feeds
    expect([...reach].sort()).toEqual([
      ...CITIES.filter((c) => !c.verified).map((c) => `city-${c.id}`), ...EXTRA_SOURCES.filter(s => ACTIVE_CITY_IDS.includes(s.cityId)).map((s) => s.feedId), ...EVENT_SOURCES.map((s) => s.feedId), ...verifiedCoreFeeds,
    ].sort());
    // feeds no city owns stay unreachable (negative coverage)
    expect(reach.has('docked-cargo')).toBe(false);
    const demo = CITIES.filter((c) => !c.verified);
    expect(demo.length).toBe(9);
    for (let i = 0; i < demo.length; i++) for (let j = i + 1; j < demo.length; j++) {
      expect(Math.hypot(demo[i].lon - demo[j].lon, demo[i].lat - demo[j].lat)).toBeGreaterThan(8);
    }
    expect(CITIES.map(c => c.id).sort()).toEqual(['new-york', 'butlerville', 'paris', 'tokyo', 'sydney', 'mexico-city', 'moscow', 'dubai', 'istanbul', 'los-angeles', 'savannah', 'palmdale'].sort());
    expect(ALL_CITIES).toHaveLength(24);
    for (const c of ALL_CITIES.filter(c => !ACTIVE_CITY_IDS.includes(c.id))) {
      expect(cityById(c.id)).toBeNull();
      expect(routeArcs(c.id, 1)).toEqual([]);
      for (const f of c.feedIds ?? [c.feedId]) expect(reach.has(f)).toBe(false);
    }
    for (const [a, b] of ARCS) { expect(cityById(a)).not.toBeNull(); expect(cityById(b)).not.toBeNull(); }
    for (const h of HUBS) expect(cityById(h)).not.toBeNull();
  });
});

describe('route subsets per visit', () => {
  it('are deterministic for (anchor, key, seed), grouped around the anchor and hubs, never all pairs', () => {
    for (const c of CITIES) {
      const a = routeArcs(c.id, 3, 11);
      expect(routeSig(a)).toBe(routeSig(routeArcs(c.id, 3, 11)));
      expect(a.length).toBeGreaterThanOrEqual(5); expect(a.length).toBeLessThanOrEqual(10);
      expect(new Set(a.map((x) => [...x].sort().join('|'))).size).toBe(a.length);
      expect(a.filter((x) => x[0] === c.id || x[1] === c.id).length).toBeGreaterThanOrEqual(4); // anchored on the selected city
      for (const [x, y] of a) { expect(cityById(x)).not.toBeNull(); expect(cityById(y)).not.toBeNull(); expect(x).not.toBe(y); }
    }
  });

  it('differ between visits (and seeds), even for the same anchor', () => {
    const sigs = new Set(Array.from({ length: 12 }, (_, k) => routeSig(routeArcs('paris', k, 5))));
    expect(sigs.size).toBeGreaterThanOrEqual(6);
    expect(routeSig(routeArcs('tokyo', 2, 1))).not.toBe(routeSig(routeArcs('tokyo', 2, 2)));
  });
});

// ------------------------------------------------------------------ controller: novelty, stable keys, history
const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEEDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);

function make(seed: number) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches: [{ kind: 'globe', after: 1 }], seed,
    feedOfTile: (id) => { const t = tiles.find((x) => x.id === id); return t ? FEEDS[t.feedIndex].id : null; },
    anchorFeed: (feedId, worldX) => reanchorTile({ tiles, feedIndex: FEEDS.findIndex((f) => f.id === feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
      return p && { id: p.id, x: p.x };
    },
  });
  return c;
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 4000; i++) { c.update(16); if (isHoldStage(c.state.stage)) return; } throw new Error('stuck ' + c.state.stage); };
const fwd = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const back = (c: JourneyController) => { expect(c.dispatch({ type: 'back' })).toBe(true); toHold(c); };

describe('city choice and route key through a journey', () => {
  it('never repeats a city immediately, avoids the recent window, and is not a fixed cycle across seeds', () => {
    const firsts = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = make(seed);
      fwd(c); // a camera hold
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) { fwd(c); fwd(c); seen.push(c.state.sceneCityId!); } // globe hold, then the city entered
      for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
      for (let i = 6; i < seen.length; i++) expect(seen.slice(i - 6, i)).not.toContain(seen[i]); // reasonable recent novelty
      expect(new Set(seen).size).toBeGreaterThanOrEqual(7);
      firsts.add(seen.slice(0, 3).join('>'));
    }
    expect(firsts.size).toBeGreaterThanOrEqual(3); // different destinations per seed, not one authored order
  });

  it('is reproducible for one seed', () => {
    const run = () => { const c = make(9); fwd(c); const out: string[] = []; for (let i = 0; i < 4; i++) { fwd(c); out.push(`${c.state.outCityId}#${c.state.routeKey}`); fwd(c); out.push(c.state.sceneCityId!); } return out; };
    expect(run()).toEqual(run());
  });

  it('back / redo restores the SAME city and route key and consumes nothing; the next fresh visit takes a new key', () => {
    const c = make(5);
    fwd(c); fwd(c); // camera, globe G1
    const g1 = { key: c.state.routeKey, sig: routeSig(routeArcs(c.state.outCityId!, c.state.routeKey, 5)) };
    fwd(c); const city1 = c.state.sceneCityId;
    fwd(c); // globe G2 (the next due branch)
    expect(c.state.stage).toBe('globe');
    const g2 = { key: c.state.routeKey, anchor: c.state.outCityId };
    expect(g2.key).not.toBe(g1.key);
    fwd(c); const city2 = c.state.sceneCityId;
    expect(city2).not.toBe(city1);

    back(c); // city2 -> G2
    expect(c.state.stage).toBe('globe');
    expect(c.state.routeKey).toBe(g2.key); expect(c.state.outCityId).toBe(g2.anchor);
    back(c); // G2 -> city1 camera
    expect(c.state.sceneCityId).toBe(city1);
    back(c); // city1 -> G1
    expect(c.state.stage).toBe('globe');
    expect(routeSig(routeArcs(c.state.outCityId!, c.state.routeKey, 5))).toBe(g1.sig); // identical composition, not rerolled

    fwd(c); expect(c.state.sceneCityId).toBe(city1); // redo: the same city, no new pick
    fwd(c); expect(c.state.routeKey).toBe(g2.key);
    fwd(c); expect(c.state.sceneCityId).toBe(city2);
    fwd(c); // frontier: a genuinely new globe visit continues the counter
    expect(c.state.stage).toBe('globe');
    expect([g1.key, g2.key]).not.toContain(c.state.routeKey);
    expect(c.state.routeKey).toBeGreaterThan(g2.key);
  });
});
