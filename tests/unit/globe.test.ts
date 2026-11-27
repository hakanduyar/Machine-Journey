import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type Stage } from '../../src/journey/controller';
import { CITIES } from '../../src/journey/globe';
import { feedOfVirtualTile, virtualTileId } from '../../src/journey/feeds';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEED_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? feedOfVirtualTile(id) ?? FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex] : null);

function make(gaps?: readonly number[], withCities = true) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000,
    cities: withCities ? CITIES : [],
    globeGaps: gaps,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg,
        prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null,
      });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) => {
      const feedIndex = FEED_IDS.indexOf(feedId);
      return reanchorTile({ tiles, feedIndex, vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) });
    },
    feedOfTile: feedOf,
  });
  return c;
}

/** Advance until the controller reaches a hold stage (never dispatching anything). */
const toHold = (c: JourneyController) => { for (let i = 0; i < 2000 && !isHoldStage(c.state.stage); i++) c.update(16); };
const leg = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const trace = (c: JourneyController) => {
  const seen: Stage[] = [];
  c.subscribe((s) => { if (seen[seen.length - 1] !== s.stage) seen.push(s.stage); });
  return seen;
};

describe('globe branch leg sequence', () => {
  it('fresh arrivals cover all active cities before repeat; Back/Redo does not spend the next destination', () => {
    const run = (replay: boolean) => {
      const c=make([1]),arrivals:string[]=[];
      leg(c);
      for(let i=0;i<CITIES.length*2;i++) {
        leg(c); expect(c.state.stage).toBe('globe');
        leg(c); expect(c.state.stage).toBe('selected');
        arrivals.push(c.state.sceneCityId!);
        if(replay && i===5) {
          expect(c.dispatch({type:'back'})).toBe(true);toHold(c);
          expect(c.state.stage).toBe('globe');
          leg(c);expect(c.state.sceneCityId).toBe(arrivals[i]);
        }
      }
      return arrivals;
    };
    const a=run(false);expect(run(true)).toEqual(a);
    for(const start of [0,CITIES.length])expect([...a.slice(start,start+CITIES.length)].sort()).toEqual(CITIES.map(c=>c.id).sort());
    expect(a[CITIES.length]).not.toBe(a[CITIES.length-1]);
  });

  it('camera holds, then one intent contracts into the mosaic and pulls back to a globe hold', () => {
    const c = make([2]);
    leg(c); leg(c); // two camera holds
    expect(c.state.stage).toBe('selected');
    const seen = trace(c);
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    toHold(c);
    expect(seen).toEqual(['contracting', 'globeOut', 'globe']);
    expect(c.state.stage).toBe('globe');
    expect(c.state.selectedId).toBeNull();
    expect(c.state.destId).toBeNull(); // arrival does not choose a city by itself
  });

  it('the globe is an indefinite hold: nothing advances without a fresh intent', () => {
    const c = make([2]);
    leg(c); leg(c); leg(c);
    expect(c.state.stage).toBe('globe');
    for (let i = 0; i < 7500; i++) c.update(16); // two minutes
    expect(c.state.stage).toBe('globe');
    expect(c.state.destId).toBeNull();
    expect(c.state.globeP).toBe(1);
  });

  it('the next fresh intent picks a city, rotates it to the front, enters it and opens its feed in ONE leg', () => {
    const c = make([2]);
    leg(c); leg(c); leg(c);
    const before = { lon: c.state.lon, lat: c.state.lat };
    const seen = trace(c);
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    expect(c.state.stage).toBe('turning');
    const id = c.state.destId!;
    const city = CITIES.find((x) => x.id === id)!;
    expect(city).toBeTruthy(); // highlighted red by the renderer through destId
    let atFront = false;
    for (let i = 0; i < 2000 && !isHoldStage(c.state.stage); i++) {
      c.update(16);
      if (c.state.stage === 'entering' && !atFront) {
        atFront = true;
        expect(c.state.lon).toBeCloseTo(city.lon, 6); // rotated to the front before the fly-through
        expect(c.state.lat).toBeCloseTo(city.lat, 6);
      }
    }
    expect(atFront).toBe(true);
    expect(seen).toEqual(['turning', 'entering', 'selected']);
    expect(`${before.lon},${before.lat}`).not.toBe(`${city.lon},${city.lat}`);
    // ends in an ordinary camera hold on a tile of the city's feed
    expect(c.state.stage).toBe('selected');
    expect(c.state.sceneCityId).toBe(city.id);
    expect(feedOf(c.state.selectedId)).toBe(city.feedId);
    expect(c.state.progress).toBe(1);
    expect(c.state.globeP).toBe(0); expect(c.state.travelP).toBe(0);
    for (let i = 0; i < 7500; i++) c.update(16);
    expect(c.state.stage).toBe('selected'); // indefinite hold, no automatic advance
  });

  it('the following leg leaves the city camera through the mosaic like any other camera leg', () => {
    const c = make([2]);
    leg(c); leg(c); leg(c); leg(c);
    const cityFeed = feedOf(c.state.selectedId);
    const seen = trace(c);
    leg(c);
    expect(seen).toEqual(['contracting', 'scanning', 'expanding', 'selected']);
    expect(feedOf(c.state.selectedId)).not.toBe(cityFeed);
    expect(c.state.sceneCityId).toBeNull();
  });

  it('visits a different city (and feed) every time, and the route is not a fixed A-B-C loop', () => {
    const c = make();
    const cityIds: string[] = []; const stops: string[] = [];
    let prevFeed: string | null = null;
    const seen = trace(c);
    for (let i = 0; i < 40; i++) {
      leg(c);
      stops.push(c.state.stage);
      if (c.state.stage === 'globe') {
        leg(c);
        cityIds.push(c.state.sceneCityId!);
        expect(feedOf(c.state.selectedId)).not.toBe(prevFeed);
      }
      prevFeed = feedOf(c.state.selectedId);
    }
    expect(cityIds.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < cityIds.length; i++) expect(cityIds[i]).not.toBe(cityIds[i - 1]);
    expect(new Set(cityIds).size).toBeGreaterThanOrEqual(4);
    expect(seen.includes('globe')).toBe(true);
    expect(stops.includes('selected')).toBe(true); // plain camera legs still occur between globe visits
  });

  it('2 to 4 camera holds separate globe visits with the default schedule', () => {
    const c = make();
    let holds = 0; const counts: number[] = [];
    c.subscribe((s) => {
      if (s.stage === 'selected') holds++;
      if (s.stage === 'globe') { counts.push(holds); holds = 0; }
    });
    for (let i = 0; i < 60; i++) leg(c);
    expect(counts.length).toBeGreaterThanOrEqual(4);
    for (const n of counts) { expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(4); }
  });

  it('without cities the route never leaves the mosaic/camera loop', () => {
    const c = make([1], false);
    const seen = trace(c);
    for (let i = 0; i < 8; i++) leg(c);
    expect(seen.some((s) => s === 'globe' || s === 'globeOut' || s === 'entering')).toBe(false);
  });
});

describe('no input skips a travel leg', () => {
  it('every intent during the pullback, rotation and entry is refused', () => {
    const c = make([2]);
    leg(c); leg(c);
    expect(c.dispatch({ type: 'intent' })).toBe(true); // contract + pullback
    for (let i = 0; i < 2000 && c.state.stage !== 'globe'; i++) {
      expect(c.dispatch({ type: 'intent' })).toBe(false);
      c.update(16);
    }
    expect(c.state.stage).toBe('globe');
    expect(c.state.destId).toBeNull(); // spam did not pick a city early
    expect(c.dispatch({ type: 'intent' })).toBe(true); // a fresh intent does
    for (let i = 0; i < 2000 && !isHoldStage(c.state.stage); i++) {
      expect(c.dispatch({ type: 'intent' })).toBe(false);
      c.update(16);
    }
    expect(c.state.stage).toBe('selected');
    expect(c.state.sceneCityId).not.toBeNull();
    const id = c.state.selectedId;
    for (let i = 0; i < 400; i++) c.update(16);
    expect(c.state.selectedId).toBe(id);
  });

  it('only hold stages accept a new intent (the UI gate locks everything else)', () => {
    const holds: Stage[] = ['mosaic', 'selected', 'globe'];
    const travel: Stage[] = ['expanding', 'contracting', 'scanning', 'globeOut', 'turning', 'entering'];
    for (const s of holds) expect(isHoldStage(s)).toBe(true);
    for (const s of travel) expect(isHoldStage(s)).toBe(false);
  });

  it('reaches every hold at a low frame rate', () => {
    const c = make([2]);
    for (let n = 0; n < 3; n++) {
      c.dispatch({ type: 'intent' });
      for (let i = 0; i < 200 && !isHoldStage(c.state.stage); i++) c.update(300);
      expect(isHoldStage(c.state.stage)).toBe(true);
    }
    expect(c.state.stage).toBe('globe');
  });
});

describe('same-video identity contract', () => {
  it('the feed on screen is always decided by feed id, never by a reset: city entry lands on that feed\'s tile', () => {
    const c = make([2]);
    leg(c); leg(c); leg(c); leg(c);
    const city = CITIES.find((x) => x.id === c.state.sceneCityId)!;
    // the renderer drives the persistent <video> of the selected feed; the entry pane used the same feed (city.feedId). A city-owned
    // clip has no mosaic tile: it is selected through its stable virtual tile, which resolves back to the very same feed id.
    expect(feedOf(c.state.selectedId)).toBe(city.feedId);
    if (!city.verified) expect(c.state.selectedId).toBe(virtualTileId(city.feedId));
    // the held pane is fullscreen exactly as the entry pane ended: no geometry jump at the hand-over
    expect(c.state.progress).toBe(1);
    expect(c.state.eased).toBe(1);
  });

  it('a resize re-anchor in the city hold keeps the same feed', () => {
    const c = make([2]);
    leg(c); leg(c); leg(c); leg(c);
    const feed = feedOf(c.state.selectedId);
    // core feed: its equivalent mosaic tile; city-owned clip: the virtual tile stays (layout-independent)
    const r = reanchorTile({ tiles, feedIndex: FEED_IDS.indexOf(feed!), vw: VW, worldW: WORLD, yearCount: YEARS, year: 3 }) ?? { id: c.state.selectedId!, x: c.state.worldX };
    expect(c.rebase(r.id, r.x)).toBe(true);
    expect(feedOf(c.state.selectedId)).toBe(feed);
    expect(c.state.sceneCityId).not.toBeNull();
  });
});
