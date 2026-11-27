/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis } from '../../src/journey/controller';
import { CITY_SOURCES, EXTRA_SOURCES, EVENT_SOURCES } from '../../src/journey/cityFeeds';
import { catalogIndices, cityFeedIds, cityOfFeed } from '../../src/journey/cityContext';
import { ALL_FEEDS, CITY_FEEDS, CORE_FEED_COUNT, FEEDS, feedOfVirtualTile, virtualTileId } from '../../src/journey/feeds';
import { FeedDeck } from '../../src/journey/feedDeck';
import { CITIES } from '../../src/journey/globe';
import { generateMosaic } from '../../src/journey/layout';
import { MAX_ACTIVE_FEEDS, desiredPlayback } from '../../src/journey/playback';
import { planLeg, reanchorTile } from '../../src/journey/route';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'media', 'city-sources.json'), 'utf8')) as Record<string, unknown>[];
const CORE_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];

describe('city catalog: 24 globe cities own their sources', () => {
  it('keeps the twelve CORE feeds, ids and order unchanged', () => {
    expect(FEEDS.map((f) => f.id)).toEqual(CORE_IDS);
    expect(CORE_FEED_COUNT).toBe(12);
    expect(ALL_FEEDS.slice(0, 12).map((f) => f.id)).toEqual(CORE_IDS);
    // the 21 base city clips follow in their original order, then the approved additional clips (catalog intentionally expanded)
    expect(ALL_FEEDS.slice(12, 33).map((f) => f.id)).toEqual(CITY_SOURCES.map((s) => `city-${s.cityId}`));
    expect(ALL_FEEDS.length).toBe(39 + EXTRA_SOURCES.length);
    expect(ALL_FEEDS.slice(33).map((f) => f.id)).toEqual([...EXTRA_SOURCES, ...EVENT_SOURCES].map((s) => s.feedId));
  });

  it('the code table mirrors the curated manifest exactly (source, licence, label, feed id)', () => {
    expect(manifest.length).toBe(21);
    expect(CITY_SOURCES.map((s) => s.cityId)).toEqual(manifest.map((m) => m.cityId));
    for (const m of manifest) {
      const s = CITY_SOURCES.find((x) => x.cityId === m.cityId)!;
      expect(m.feedId).toBe(`city-${s.cityId}`);
      expect([s.source, s.credit, s.license, s.licenseUrl, s.archiveLabel]).toEqual([m.source, m.credit, m.license, m.licenseUrl, m.archiveLabel]);
      expect(m.provenanceLevel).toBe('STOCK_PUBLISHER_LOCATION');
      expect(m.exactCameraCoordinatesVerified).toBe(false); // a publisher-named place, never an official camera position
    }
  });

  it('all 24 cities map only their own feed: 21 unique city clips + the three verified places unchanged', () => {
    expect(CITIES.length).toBe(24);
    const own = CITIES.filter((c) => !c.verified);
    expect(own.length).toBe(21);
    expect(new Set(own.map((c) => c.feedId)).size).toBe(21);
    for (const c of own) {
      expect(c.feedId).toBe(`city-${c.id}`);
      // base clip first, then any approved additional clips of the SAME city (see the extra-catalog tests below)
      expect(c.feedIds ?? [c.feedId]).toEqual([c.feedId, ...EXTRA_SOURCES.filter((s) => s.cityId === c.id).map((s) => s.feedId)]);
      expect(CITY_FEEDS.some((f) => f.id === c.feedId)).toBe(true);
      expect(CORE_IDS).not.toContain(c.feedId); // never a generic / core clip under a city name
    }
    // verified places keep their official feeds first (primary unchanged); approved extra clips of the same place follow
    const ex = (id: string) => [...EXTRA_SOURCES, ...EVENT_SOURCES].filter((s) => s.cityId === id).map((s) => s.feedId);
    expect(CITIES.filter((c) => c.verified).map((c) => [c.id, c.feedId, c.feedIds])).toEqual([
      ['savannah', 'parked-c130', ['parked-c130', ...ex('savannah')]],
      ['butlerville', 'm01', ['m01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05', ...ex('butlerville')]],
      ['palmdale', 'palmdale-dc8', ['palmdale-dc8', ...ex('palmdale')]],
    ]);
  });

  it('every city clip has its loop, poster and credits on disk; HUD labels are archive labels, never live / CCTV', () => {
    for (const f of CITY_FEEDS) {
      for (const file of ['loop.mp4', 'poster.jpg', 'CREDITS.txt']) expect(existsSync(join(process.cwd(), 'public', 'media', f.id, file)), `${f.id}/${file}`).toBe(true);
      expect(f.label).toMatch(/^ARCHIVE/);
      expect(`${f.label} ${f.credit}`).not.toMatch(/LIVE|CCTV/i);
      expect(f.source).toMatch(/^https:\/\//);
    }
  });
});

describe('additional approved city clips (data-driven catalog expansion)', () => {
  const extra = JSON.parse(readFileSync(join(process.cwd(), 'public', 'media', 'city-sources-extra.json'), 'utf8')) as Record<string, unknown>[];
  it('the code table is exactly the extra manifest (union with the base manifest: no duplicate feed, source or city mismatch)', () => {
    expect(EXTRA_SOURCES.map((s) => [s.cityId, s.feedId, s.source, s.credit, s.license, s.licenseUrl, s.archiveLabel]))
      .toEqual(extra.map((m) => [m.cityId, m.feedId, m.source, m.credit, m.license, m.licenseUrl, m.archiveLabel]));
    const all = [...manifest, ...extra];
    expect(new Set(all.map((m) => m.feedId)).size).toBe(all.length);
    expect(new Set(all.map((m) => m.source)).size).toBe(all.length);
    for (const m of extra) {
      const city = CITIES.find((c) => c.id === m.cityId);
      expect(city, `${String(m.cityId)} is an existing city`).toBeTruthy();
      // an official place's extra clip carries official source locality; every stock city's is the publisher-named place
      expect(m.provenanceLevel).toBe(city!.verified ? 'OFFICIAL_SOURCE_LOCALITY' : 'STOCK_PUBLISHER_LOCATION');
      expect(m.exactCameraCoordinatesVerified).toBe(false);
      expect(String(m.feedId)).toMatch(/^city-[a-z0-9-]+$/);
      expect(CORE_IDS).not.toContain(m.feedId);
    }
  });
  it('every additional clip has its loop, poster and credits on disk and an archive (never live / CCTV) label', () => {
    for (const s of EXTRA_SOURCES) {
      for (const file of ['loop.mp4', 'poster.jpg', 'CREDITS.txt']) expect(existsSync(join(process.cwd(), 'public', 'media', s.feedId, file)), `${s.feedId}/${file}`).toBe(true);
      expect(s.archiveLabel).toMatch(/^ARCHIVE/); expect(s.archiveLabel).not.toMatch(/LIVE|CCTV/i);
    }
  });
  it('a city pool expands to its own clips only (base first, deterministic) and excludes every foreign feed', () => {
    const grown = new Set(EXTRA_SOURCES.map((s) => s.cityId));
    expect(grown.size).toBeGreaterThan(0);
    for (const id of grown) {
      const city = CITIES.find((c) => c.id === id)!;
      const own = cityFeedIds(city);
      // the primary pool first (a stock city's base clip, or a verified place's official feeds), then its approved extras in manifest order
      expect(own).toEqual([...(city.verified ? ({ savannah: ['parked-c130'], butlerville: ['m01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05'], palmdale: ['palmdale-dc8'] } as Record<string, string[]>)[id] : [`city-${id}`]), ...EXTRA_SOURCES.filter((s) => s.cityId === id).map((s) => s.feedId), ...(id === 'butlerville' ? ['city-butlerville-event-6be3a62539fcd5e7e29c', 'city-butlerville-event-5b53880db45458d170a8', 'city-butlerville-event-aa4fd544b8e12da53881', 'city-butlerville-event-42b9a7d07894762477da', 'city-butlerville-event-788995c15491e2f58728', 'city-butlerville-event-0cb69d3407458efbd9cb'] : [])]);
      expect(own.length).toBeGreaterThanOrEqual(2);
      for (const f of ALL_FEEDS.map((x) => x.id)) if (!own.includes(f)) expect(cityOfFeed(f, CITIES)?.id).not.toBe(id);
      const idx = catalogIndices(own, ALL_FEEDS.map((x) => x.id));
      expect(idx.length).toBe(own.length);
      const d = desiredPlayback({ stage: 'mosaic', selectedFeed: -1, targetFeed: -1, feedCount: ALL_FEEDS.length, pool: idx });
      // the playing pool is the city's own clips only (compared in catalog index order; the pool order is ownership order)
      expect(ALL_FEEDS.filter((_, i) => d[i]).map((f) => f.id)).toEqual(ALL_FEEDS.map((f) => f.id).filter((id) => own.includes(id)));
    }
    // every feed of the catalog belongs to at most one city
    const owner = new Map<string, string>();
    for (const c of CITIES) for (const f of cityFeedIds(c)) { expect(owner.has(f), f).toBe(false); owner.set(f, c.id); }
    // opening pool: Butlerville's nineteen MEVA feeds (the original four first, then G301 / G639 / G505 / G436 / G330, then the extra-manifest G423 / G421 / G419 / G508 / G638 / G331 / G299 / G329 / G340 / G420)
    expect(cityFeedIds(CITIES.find((c) => c.id === 'butlerville'))).toEqual([
      'm01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05', 'city-butlerville-school-hall', 'city-butlerville-cafe',
      'city-butlerville-stairwell', 'city-butlerville-classroom', 'city-butlerville-courtyard', 'city-butlerville-bus-interior',
      'city-butlerville-gym-reverse', 'city-butlerville-stair-corridor', 'city-butlerville-roadside', 'city-butlerville-upper-stairwell', 'city-butlerville-event-6be3a62539fcd5e7e29c', 'city-butlerville-event-5b53880db45458d170a8', 'city-butlerville-event-aa4fd544b8e12da53881', 'city-butlerville-event-42b9a7d07894762477da', 'city-butlerville-event-788995c15491e2f58728', 'city-butlerville-event-0cb69d3407458efbd9cb']);
  });
});

describe('lazy media policy (pure part)', () => {
  const n = ALL_FEEDS.length;
  const base = { selectedFeed: -1, targetFeed: -1, feedCount: n, coreCount: CORE_FEED_COUNT };
  const city = CORE_FEED_COUNT + 3;
  it('the background pool never includes a city clip unless it is in use; the globe hold plays nothing', () => {
    for (const stage of ['mosaic', 'scanning', 'contracting'] as const) {
      const d = desiredPlayback({ ...base, stage });
      expect(d.slice(0, CORE_FEED_COUNT).every(Boolean)).toBe(true);
      expect(d.slice(CORE_FEED_COUNT).some(Boolean)).toBe(false);
    }
    expect(desiredPlayback({ ...base, stage: 'globe', extra: [city] }).some(Boolean)).toBe(false);
  });
  it('an open / entering city clip is the only extra that plays; selected plays just that clip; route stages keep the cap of three', () => {
    const entering = desiredPlayback({ ...base, stage: 'entering', targetFeed: city, extra: [city] });
    expect(entering[city]).toBe(true);
    expect(entering.filter((v, i) => v && i >= CORE_FEED_COUNT).length).toBe(1);
    const sel = desiredPlayback({ ...base, stage: 'selected', selectedFeed: city, extra: [city] });
    expect(sel.filter(Boolean).length).toBe(1); expect(sel[city]).toBe(true);
    const route = desiredPlayback({ ...base, stage: 'neuralMove', active: [0, 1, 2, 3, 4], extra: [city] });
    expect(route.filter(Boolean).length).toBeLessThanOrEqual(MAX_ACTIVE_FEEDS);
    expect(route[city]).toBe(false);
  });
  it('the legacy call (no coreCount) is unchanged: the whole pool plays in a mosaic stage', () => {
    expect(desiredPlayback({ stage: 'mosaic', selectedFeed: -1, targetFeed: -1, feedCount: 12 }).every(Boolean)).toBe(true);
  });
});

// ---- controller: city entry through a virtual tile, readiness, history ----
const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: CORE_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? feedOfVirtualTile(id) ?? CORE_IDS[tiles.find((t) => t.id === id)!.feedIndex] : null);

function make(status?: (feedId: string) => 'ready' | 'wait' | 'failed', seed = 5) {
  const deck = new FeedDeck(CORE_IDS, seed);
  const calls: string[] = [];
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches: [{ kind: 'globe', after: 1 }], seed, deck,
    cityStatus: status ? (f) => { calls.push(f); return status(f); } : undefined,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) => reanchorTile({ tiles, feedIndex: CORE_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    feedOfTile: (id) => { const t = tiles.find((x) => x.id === id); return t ? CORE_IDS[t.feedIndex] : null; },
  });
  return { c, deck, calls };
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 6000 && !isHoldStage(c.state.stage); i++) c.update(16); };
const fwd = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const back = (c: JourneyController) => { expect(c.dispatch({ type: 'back' })).toBe(true); toHold(c); };
/** camera hold, globe hold, then the first city that is NOT a verified place. */
function toCity(c: JourneyController) {
  fwd(c); fwd(c); // camera, globe
  expect(c.state.stage).toBe('globe');
}

describe('city entry through the controller', () => {
  it('lands on the city\'s own clip via a stable virtual tile; selection resolves back to that feed', () => {
    const { c } = make(() => 'ready');
    toCity(c);
    for (let k = 0; k < 12; k++) {
      fwd(c);
      const city = CITIES.find((x) => x.id === c.state.sceneCityId)!;
      expect(c.state.stage).toBe('selected');
      if (!city.verified) {
        expect(c.state.selectedId).toBe(virtualTileId(city.feedId));
        expect(feedOf(c.state.selectedId)).toBe(`city-${city.id}`);
      } else expect(city.feedIds).toContain(feedOf(c.state.selectedId)!);
      fwd(c); // the city hold counts as the camera hold: the next due branch is the globe
      expect(c.state.stage).toBe('globe');
    }
  });

  it('holds the globe with ONE pending intent until the city clip is ready, then completes without another gesture', () => {
    let ready = false;
    const { c, calls } = make((f) => (ready || !f.startsWith('city-') ? 'ready' : 'wait'));
    toCity(c);
    // find a state where the next city is city-owned: keep trying fresh visits until the status was consulted
    let waited = false;
    for (let k = 0; k < 8 && !waited; k++) {
      ready = false; calls.length = 0;
      expect(c.dispatch({ type: 'intent' })).toBe(true);
      if (c.pendingIntent) {
        waited = true;
        expect(c.state.stage).toBe('globe'); // current context stays visible, no wrong / black handoff
        expect(c.dispatch({ type: 'intent' })).toBe(false); // exactly one intent is kept, extra input is discarded
        for (let i = 0; i < 200; i++) c.update(16);
        expect(c.state.stage).toBe('globe'); expect(c.pendingIntent).toBe(true);
        ready = true;
        // The globe is itself a hold stage, so `toHold` would return at once: first let the pending intent start its leg.
        for (let i = 0; i < 50 && c.pendingIntent; i++) c.update(16);
        expect(c.pendingIntent).toBe(false); expect(c.state.stage).not.toBe('globe');
        toHold(c);
        expect(c.pendingIntent).toBe(false);
        expect(c.state.stage).toBe('selected');
        expect(feedOf(c.state.selectedId)).toBe(calls[0]);
        fwd(c); // on to the next globe, so a later iteration (if any) starts at a globe hold
      } else { toHold(c); fwd(c); } // a verified place (no wait): continue to the next globe hold
    }
    expect(waited).toBe(true);
  });

  it('a failed clip is skipped: its city is never entered and no other video is opened under its name', () => {
    const failing = 'city-paris';
    const { c } = make((f) => (f === failing ? 'failed' : 'ready'), 3);
    toCity(c);
    for (let k = 0; k < 20; k++) {
      fwd(c);
      expect(c.state.sceneCityId).not.toBe('paris');
      if (c.state.stage === 'selected' && c.state.sceneCityId) {
        const city = CITIES.find((x) => x.id === c.state.sceneCityId)!;
        expect(feedOf(c.state.selectedId)).toBe(city.verified ? feedOf(c.state.selectedId) : city.feedId);
      }
      fwd(c); // back to a globe hold
    }
  });

  it('back / redo into a city restores the same virtual tile and feed and consumes no deck / RNG state', () => {
    const { c, deck } = make(() => 'ready', 9);
    toCity(c);
    fwd(c); // a city hold
    const id = c.state.selectedId; const city = c.state.sceneCityId; const feed = feedOf(id);
    fwd(c); // the next globe
    const diag = JSON.stringify(deck.diagnostics());
    const globeKey = c.state.routeKey;
    back(c); // globe -> the same city hold
    expect(c.state.selectedId).toBe(id); expect(c.state.sceneCityId).toBe(city); expect(feedOf(c.state.selectedId)).toBe(feed);
    fwd(c); // redo: the same globe, nothing rerolled
    expect(c.state.stage).toBe('globe'); expect(c.state.routeKey).toBe(globeKey);
    expect(JSON.stringify(deck.diagnostics())).toBe(diag);
  });

  it('city-owned holds stay outside the core deck: the deck never learns a city feed id', () => {
    const { c, deck } = make(() => 'ready', 4);
    toCity(c);
    for (let k = 0; k < 10; k++) { fwd(c); fwd(c); }
    const seen = deck.diagnostics().seen.concat(deck.diagnostics().recent);
    expect(seen.some((f) => f.startsWith('city-'))).toBe(false);
  });
});

