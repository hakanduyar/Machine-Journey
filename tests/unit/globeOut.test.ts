import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type JourneyState } from '../../src/journey/controller';
import { CITIES } from '../../src/journey/globe';
import { anchorCityFor } from '../../src/journey/globeOut';
import { LEG_K, legTime, globeLegClock, TIME_A, OUTBOUND_LATE_SPEEDUP } from '../../src/journey/scale';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

const VW = 1000; const WORLD = 3000; const YEARS = 8; const TRAVEL = 1000;
const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEED_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);

function make(branches: { kind: 'globe' | 'neural'; after: number; stops?: number }[]) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: TRAVEL, cities: CITIES, branches,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg,
        prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null,
      });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) => reanchorTile({
      tiles, feedIndex: FEED_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)),
    }),
    feedOfTile: feedOf,
    neuralPlan: (from) => {
      const a = from ?? 'm01';
      return { feeds: [a, a === 'm02' ? 'm03' : 'm02'], anchors: [0, 1], times: [0, 5] };
    },
  });
  return c;
}

const toHold = (c: JourneyController, each?: (s: Readonly<JourneyState>) => void) => {
  for (let i = 0; i < 3000 && !isHoldStage(c.state.stage); i++) { c.update(16); each?.(c.state); }
};
const leg = (c: JourneyController, each?: (s: Readonly<JourneyState>) => void) => {
  expect(c.dispatch({ type: 'intent' })).toBe(true); each?.(c.state); toHold(c, each);
};
const timeOf = (s: Readonly<JourneyState>) => legTime(s.stage, s, s.globeLeg);

describe('anchor', () => {
  it('uses the verified source place of a feed when it has one, else the demo city routed to it, with a deterministic fallback', () => {
    expect(anchorCityFor('m02', CITIES)!.id).toBe('butlerville'); // MEVA collection site (verified), not the demo New York
    expect(anchorCityFor('parked-c130', CITIES)!.id).toBe('savannah');
    expect(anchorCityFor('palmdale-dc8', CITIES)!.id).toBe('palmdale');
    // R49 C: every non-verified city owns its OWN stock clip, so a core feed with no verified place has no demo city; it departs
    // from a deterministic fallback point (an aim for the pull-back only, not a claim about where it was filmed).
    expect(anchorCityFor('city-paris', CITIES)!.id).toBe('paris');
    expect(anchorCityFor('city-rome', CITIES)!.id).toBe('rome');
    expect(anchorCityFor('m03', CITIES)).toBe(anchorCityFor('m03', CITIES));
    expect(CITIES.some((c) => !c.verified && c.feedId === 'm03')).toBe(false);
    expect(anchorCityFor('unrouted-feed', CITIES)).toBe(anchorCityFor('unrouted-feed', CITIES));
    expect(CITIES).toContain(anchorCityFor('unrouted-feed', CITIES));
    expect(anchorCityFor('m01', [])).toBeNull();
  });
});

describe('controller endpoints on the shared scale curve', () => {
  it('outbound: one gesture runs the whole accelerated-local-half leg as ONE monotonic leg time 0 -> 1 and ends in the held composition', () => {
    const c = make([{ kind: 'globe', after: 1 }]);
    leg(c); // camera hold on some feed
    const feed = feedOf(c.state.selectedId)!;
    const city = anchorCityFor(feed, CITIES)!;
    const ts: number[] = []; let sawOut = false; let steps = 0;
    leg(c, (s) => {
      steps++;
      const t = timeOf(s);
      if (t !== null) ts.push(t);
      if (s.stage === 'globeOut' && !sawOut) {
        sawOut = true;
        expect(s.outFeedId).toBe(feed); expect(s.outCityId).toBe(city.id);
        expect(s.globeP).toBe(0); expect(s.travelP).toBe(0);
        expect(s.lon).toBe(city.lon); expect(s.lat).toBe(city.lat);
      }
    });
    expect(sawOut).toBe(true);
    expect(c.state.stage).toBe('globe');
    expect(ts[0]).toBe(0);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] - 1e-9);
    expect(ts[ts.length - 1]).toBeGreaterThan(0.99);
    // Accepted pacing: the local clock is shorter; only the existing late global boost can shorten it further.
    // Boost begins at globe progress .55 (T = TIME_A + .55*(1-TIME_A)) and never exceeds14%.
    // Bound its maximum possible saving without reimplementing the controller's integrator.
    const unboostedMs = LEG_K * TRAVEL * globeLegClock(1);
    const lateGlobalShare = (1 - TIME_A) * (1 - .55);
    const maxSavingMs = LEG_K * TRAVEL * lateGlobalShare * (1 - 1 / (1 + OUTBOUND_LATE_SPEEDUP));
    const tickToleranceMs = 3 * 16; // initial sample and the two phase handoffs
    expect(steps * 16).toBeGreaterThanOrEqual(unboostedMs - maxSavingMs - tickToleranceMs);
    expect(steps * 16).toBeLessThanOrEqual(unboostedMs + tickToleranceMs);
    expect(c.state.globeP).toBe(1); expect(c.state.travelEased).toBe(0); expect(c.state.globeLeg).toBe(false);
  });

  it('inbound: turning then entering runs the SAME curve in reverse (T 1 -> 0) toward the tile it lands on', () => {
    const c = make([{ kind: 'globe', after: 1 }]);
    leg(c); leg(c); // camera hold, then the globe hold
    expect(c.state.stage).toBe('globe');
    const ts: number[] = []; let enterMs = 0; const early: { id: string | null; x: number }[] = [];
    leg(c, (s) => {
      if (s.stage === 'entering') {
        enterMs += 16; ts.push(timeOf(s)!);
        if (!early.length) early.push({ id: s.entryTileId, x: s.worldX });
      }
    });
    expect(c.state.stage).toBe('selected');
    expect(early).toHaveLength(1);
    expect(early[0].id).toBe(c.state.selectedId); // the entry zoomed toward the very tile it opened
    expect(early[0].x).toBe(c.state.worldX);
    expect(ts[0]).toBeGreaterThan(0.98);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeLessThanOrEqual(ts[i - 1] + 1e-9);
    expect(enterMs).toBeGreaterThan(LEG_K * TRAVEL * globeLegClock(1) - 100); expect(enterMs).toBeLessThan(LEG_K * TRAVEL * globeLegClock(1) + 100);
    expect(c.state.entryTileId).toBeNull();
  });

  it('city entry -> neural -> globe: neuralOut shares the curve, is isolated from the earlier entry and ends in the same hold', () => {
    const c = make([{ kind: 'globe', after: 1 }, { kind: 'neural', after: 1, stops: 2 }]);
    leg(c); leg(c); // camera, then globe hold
    expect(c.state.stage).toBe('globe');
    leg(c); // city entry -> camera hold on the city feed
    expect(c.state.stage).toBe('selected');
    expect(c.state.sceneCityId).not.toBeNull();
    leg(c); // into the neural scene
    expect(c.state.stage).toBe('neural');
    expect(c.state.globeP).toBe(0); expect(c.state.travelEased).toBe(0);
    leg(c); // neural move
    expect(c.state.stage).toBe('neural');
    const lastFeed = c.state.neuralFeeds[c.state.neuralFeeds.length - 1];
    const ts: number[] = []; let sawOut = false;
    leg(c, (s) => {
      if (s.stage !== 'neuralOut') return;
      if (!sawOut) {
        sawOut = true;
        expect(s.outFeedId).toBe(lastFeed);
        expect(s.travelP).toBe(0); expect(s.travelEased).toBe(0);
      }
      ts.push(timeOf(s)!);
    });
    expect(sawOut).toBe(true);
    expect(c.state.stage).toBe('globe');
    expect(ts[0]).toBeLessThan(0.05);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] - 1e-9);
    expect(ts[ts.length - 1]).toBeGreaterThan(0.99);
    // the hold both outgoing paths end in: g = 1, no entry travel, indefinite
    expect(c.state.globeEased).toBe(1); expect(c.state.travelEased).toBe(0); expect(c.state.selectedId).toBeNull();
    for (let i = 0; i < 3000; i++) c.update(16);
    expect(c.state.stage).toBe('globe');
    // a following manual input still rotates, targets and enters, with the next city on a different feed
    const city = anchorCityFor(lastFeed, CITIES)!;
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    expect(c.state.stage).not.toBe('globe');
    expect(c.state.destId).not.toBe(city.id);
    toHold(c);
    expect(c.state.stage).toBe('selected');
    expect(feedOf(c.state.selectedId)).not.toBe(lastFeed);
  });
});
