/// <reference types="node" />
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type Branch } from '../../src/journey/controller';
import { FEEDS, feedPosterUrl, feedVideoUrl } from '../../src/journey/feeds';
import { FeedDeck, RECENT_WINDOW } from '../../src/journey/feedDeck';
import { cityOfFeed } from '../../src/journey/cityContext';
import { planFloatRoute } from '../../src/journey/floatField';
import { CITIES, cityById } from '../../src/journey/globe';
import { generateMosaic } from '../../src/journey/layout';
import { ANCHOR_FEEDS, planNeuralRoute, type NeuralHold } from '../../src/journey/neuralRoute';
import { MAX_ACTIVE_FEEDS, desiredPlayback, routeActive } from '../../src/journey/playback';
import { planLeg, reanchorTile } from '../../src/journey/route';

const FEED_IDS = FEEDS.map((f) => f.id);
const N = FEED_IDS.length;

describe('catalog: the twelve CORE feeds (the 21 base city clips plus the approved additional city clips are a separate lazy set, see cityFeeds.test.ts)', () => {
  it('has twelve unique logical ids, each with its real media files (loop, poster, credits)', () => {
    expect(N).toBe(12);
    expect(new Set(FEED_IDS).size).toBe(12);
    expect(FEED_IDS).toEqual(expect.arrayContaining(['m05', 'palmdale-dc8']));
    for (const f of FEEDS) {
      for (const file of ['loop.mp4', 'poster.jpg', 'CREDITS.txt']) expect(existsSync(join(process.cwd(), 'public', 'media', f.id, file)), `${f.id}/${file}`).toBe(true);
      expect(feedVideoUrl(f)).toMatch(new RegExp(`media/${f.id}/loop\\.mp4$`));
      expect(feedPosterUrl(f)).toMatch(new RegExp(`media/${f.id}/poster\\.jpg$`));
    }
  });

  it('the decode budget is dynamic in the catalog length: still at most three active, never the whole pool', () => {
    const d = desiredPlayback({ stage: 'floatMove', selectedFeed: -1, targetFeed: -1, feedCount: N, active: routeActive({ stage: 'floatMove', floatFeeds: ['m05', 'palmdale-dc8', 'm01'], floatIdx: 0, neuralFeeds: [], neuralIdx: 0, feedIds: FEED_IDS }) });
    expect(d.length).toBe(N);
    expect(d.filter(Boolean).length).toBeLessThanOrEqual(MAX_ACTIVE_FEEDS);
    expect(d[FEED_IDS.indexOf('m05')]).toBe(true); expect(d[FEED_IDS.indexOf('palmdale-dc8')]).toBe(true);
  });
});

describe('verified source places (truth over novelty)', () => {
  it('Savannah is the actual parked-c130 place at the Natural Earth city point; its pool is that primary feed plus its one approved additional clip, nothing else', () => {
    const c = cityById('savannah')!;
    expect(c.lon).toBe(-81.109995); expect(c.lat).toBe(32.021106);
    expect(c.feedId).toBe('parked-c130'); expect(c.feedIds).toEqual(['parked-c130', 'city-savannah-additional']);
    expect(c.verified!.url).toContain('dvidshub.net/video/554984');
  });
  it('Butlerville (Muscatatuck, Indiana) opens only its nineteen MEVA Muscatatuck feeds, with the Census locality point; Palmdale the DC-8 plus its one approved additional clip', () => {
    const b = cityById('butlerville')!;
    expect(b.feedIds).toEqual(['m01', 'm02', 'm06', 'parking-walk', 'm03', 'm07', 'covered-road', 'm04', 'm05', 'city-butlerville-school-hall', 'city-butlerville-cafe', 'city-butlerville-stairwell', 'city-butlerville-classroom', 'city-butlerville-courtyard', 'city-butlerville-bus-interior',
      'city-butlerville-gym-reverse', 'city-butlerville-stair-corridor', 'city-butlerville-roadside', 'city-butlerville-upper-stairwell']);
    expect([b.lon, b.lat]).toEqual([-85.51, 39.03]);
    expect(b.verified!.note).toMatch(/not Indianapolis/);
    expect(b.verified!.note).toMatch(/camera position is not verified/);
    const p = cityById('palmdale')!;
    expect(p.feedId).toBe('palmdale-dc8'); expect(p.feedIds).toEqual(['palmdale-dc8', 'city-palmdale-additional']); expect([p.lon, p.lat]).toEqual([-118.11, 34.59]);
  });
  it('feeds with weaker or unknown location are never claimed by a verified place; every verified place carries its source', () => {
    const claimed = new Set(CITIES.filter((c) => c.verified).flatMap((c) => c.feedIds ?? [c.feedId]));
    // docked-cargo has no verified place. (m03/m07/covered-road/m04/m05 were admitted to Butlerville in R51.)
    expect(claimed.has('docked-cargo')).toBe(false);
    for (const id of ['m03', 'm07', 'covered-road', 'm04', 'm05']) expect(cityOfFeed(id, CITIES)?.id).toBe('butlerville');
    for (const c of CITIES.filter((x) => x.verified)) { expect(c.verified!.url).toMatch(/^https:/); expect(c.verified!.coordSource.length).toBeGreaterThan(10); }
  });
});

describe('shared finite feed deck', () => {
  const pickNew = (d: FeedDeck, prev: string | null): string | undefined => d.eligible([prev])[0];

  it('commits new cameras without repeating until the whole catalog has been seen, then advances the cycle and continues', () => {
    const d = new FeedDeck(FEED_IDS, 4);
    const seq: string[] = []; let prev: string | null = null;
    for (let i = 0; i < 12; i++) { const f: string = pickNew(d, prev)!; expect(seq.includes(f)).toBe(false); expect(d.commit(f)).toBe(true); seq.push(f); prev = f; }
    expect(new Set(seq).size).toBe(12);
    expect(d.cycle).toBe(0); // exhausted, not yet advanced
    for (let i = 0; i < 40; i++) { // never halts, never an immediate / recent repeat
      const f = pickNew(d, prev); expect(f).toBeTruthy();
      expect(seq.slice(-(RECENT_WINDOW - 1))).not.toContain(f);
      d.commit(f!); seq.push(f!); prev = f!;
    }
    expect(d.cycle).toBeGreaterThanOrEqual(3);
    expect(d.diagnostics().size).toBe(12);
  });

  it('planning (eligible / frontier) never consumes the deck', () => {
    const d = new FeedDeck(FEED_IDS, 2); d.commit('m01');
    const before = JSON.stringify(d.diagnostics());
    for (let i = 0; i < 5; i++) { d.eligible(['m01']); d.frontier(['m01'], 3); }
    expect(JSON.stringify(d.diagnostics())).toBe(before);
  });

  it('frontier gives distinct feeds excluding the incoming one; only a committed hold consumes them', () => {
    const d = new FeedDeck(FEED_IDS, 6); d.commit('m06');
    const route = d.frontier(['m06'], 3);
    expect(route.length).toBe(3); expect(new Set(route).size).toBe(3); expect(route).not.toContain('m06');
    route.forEach((f) => expect(d.isSeen(f)).toBe(false));
    d.commit('m06'); // continuity: the pane already on screen is not a new camera and consumes nothing
    expect(d.diagnostics().commits).toBe(1);
    route.forEach((f) => d.commit(f));
    expect(d.diagnostics().commits).toBe(4);
  });

  it('is deterministic per seed and varies between seeds and cycles', () => {
    const run = (seed: number) => { const d = new FeedDeck(FEED_IDS, seed); d.commit('m01'); return d.frontier(['m01'], 3).join(','); };
    expect(run(5)).toBe(run(5));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(run)).size).toBeGreaterThan(3);
  });

  it('a pool of any length works (not tied to ten or twelve)', () => {
    const d = new FeedDeck(['a', 'b', 'c'], 1); let prev: string | null = null;
    for (let i = 0; i < 20; i++) { const f: string = d.eligible([prev])[0]; expect(f).toBeTruthy(); expect(f).not.toBe(prev); d.commit(f); prev = f; }
  });
});

describe('spatial slots are separate from feed identity', () => {
  const HOLDS: NeuralHold[] = ANCHOR_FEEDS.map((_, i) => ({ screen: `s${i}`, holdStart: 6 + 9.4 * i, holdEnd: 9 + 9.4 * i }));
  it('every catalog feed can start and occupy any neural / float stop; stops use the supplied distinct feeds', () => {
    const d = new FeedDeck(FEED_IDS, 3);
    for (const from of FEED_IDS) for (let visit = 0; visit < 6; visit++) for (const stops of [2, 3, 4]) {
      d.commit(from);
      const dest = d.frontier([from], stops - 1);
      const nr = planNeuralRoute(from, stops, visit, HOLDS, dest)!;
      expect(nr).not.toBeNull(); expect(nr.feeds).toEqual([from, ...dest]); expect(new Set(nr.feeds).size).toBe(stops);
      const fr = planFloatRoute(from, stops, visit, dest)!;
      expect(fr).not.toBeNull(); expect(fr.feeds).toEqual([from, ...dest]); expect(fr.slots.length).toBe(stops);
      expect(new Set(fr.slots).size).toBe(stops);
      for (let i = 1; i < stops; i++) expect(Math.abs(fr.slots[i] - fr.slots[i - 1])).toBeGreaterThanOrEqual(2);
    }
  });
});

// ------------------------------------------------------------------ controller, all modes

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: N, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const HOLDS: NeuralHold[] = ANCHOR_FEEDS.map((_, i) => ({ screen: `s${i}`, holdStart: 6.1 + 9.4 * i, holdEnd: 8.9 + 9.4 * i }));
const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);

class SpyDeck extends FeedDeck {
  log: { feed: string; fresh: boolean; cycle: number }[] = [];
  override commit(feedId: string) { const fresh = super.commit(feedId); this.log.push({ feed: feedId, fresh, cycle: this.cycle }); return fresh; }
}

function make(branches: readonly Branch[], deck: FeedDeck, cities = CITIES, seed = 3) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities, branches, seed, deck,
    floatPlan: (from, stops, visit) => planFloatRoute(from, stops, visit, deck.frontier([from], Math.max(2, Math.min(4, stops)) - 1)),
    neuralPlan: (from, stops, visit) => planNeuralRoute(from, stops, visit, HOLDS, deck.frontier([from], Math.max(2, Math.min(4, stops)) - 1)),
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const curId = cur ? FEED_IDS[cur.feedIndex] : null;
      const p = planLeg({
        tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null,
        wantFeeds: deck.eligible([curId]).map((id) => FEED_IDS.indexOf(id)),
      });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) => reanchorTile({ tiles, feedIndex: FEED_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    feedOfTile: feedOf,
  });
  return c;
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 6000; i++) { c.update(16); if (isHoldStage(c.state.stage)) return; } throw new Error('stuck ' + c.state.stage); };
const fwd = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const ROUTE: Branch[] = [
  { kind: 'float', after: 2, stops: 3 }, { kind: 'neural', after: 1, stops: 4 }, { kind: 'globe', after: 2 },
  { kind: 'neural', after: 2, stops: 2 }, { kind: 'float', after: 1, stops: 4 }, { kind: 'globe', after: 1 },
];

describe('cross-mode novelty through the controller', () => {
  it('fresh cameras are unique within a cycle across camera, float, neural and globe legs; the cycle then advances and the journey continues', () => {
    const deck = new SpyDeck(FEED_IDS, 3);
    const c = make(ROUTE, deck);
    const stages = new Set<string>();
    c.subscribe((s) => stages.add(s.stage));
    for (let i = 0; i < 140; i++) fwd(c);
    for (const m of ['floating', 'neural', 'globe', 'selected']) expect(stages.has(m)).toBe(true);
    const byCycle = new Map<number, string[]>();
    for (const e of deck.log) if (e.fresh) byCycle.set(e.cycle, [...(byCycle.get(e.cycle) ?? []), e.feed]);
    for (const [, feeds] of byCycle) expect(new Set(feeds).size).toBe(feeds.length); // no repeat until the cycle is exhausted
    expect(byCycle.get(0)!.length).toBe(12); // the whole catalog was visited in the first cycle
    expect(deck.cycle).toBeGreaterThanOrEqual(1); // explicit advance, then forward still works
    const distinct = deck.log.filter((e, i) => i === 0 || e.feed !== deck.log[i - 1].feed).map((e) => e.feed);
    for (let i = 1; i < distinct.length; i++) expect(distinct[i]).not.toBe(distinct[i - 1]); // no immediate repeat
    expect(FEED_IDS.every((f) => deck.log.some((e) => e.feed === f))).toBe(true); // both new clips appear
  });

  it('stages in a visit do not consume early: the deck holds only the feeds actually reached', () => {
    const deck = new SpyDeck(FEED_IDS, 8);
    const c = make([{ kind: 'neural', after: 1, stops: 4 }], deck);
    fwd(c); // camera hold (commits 1)
    expect(deck.diagnostics().commits).toBe(1);
    fwd(c); // neuralIn -> stop 0: the SAME pane (continuity)
    expect(c.state.stage).toBe('neural'); expect(deck.diagnostics().commits).toBe(1);
    const planned = [...c.state.neuralFeeds];
    for (let k = 1; k < 4; k++) { expect(deck.diagnostics().commits).toBe(k); fwd(c); expect(c.state.neuralFeeds[c.state.neuralIdx]).toBe(planned[k]); }
    expect(deck.diagnostics().commits).toBe(4);
    expect(new Set(planned).size).toBe(4);
  });

  it('back / redo replays the same feeds, cities and deck: nothing is consumed and the next fresh leg is unchanged', () => {
    const run = (backAndRedo: boolean) => {
      const deck = new SpyDeck(FEED_IDS, 5);
      const c = make(ROUTE, deck);
      for (let i = 0; i < 22; i++) fwd(c);
      const seqNow = JSON.stringify(deck.diagnostics());
      if (backAndRedo) {
        let k = 0;
        while (k < 6 && c.dispatch({ type: 'back' })) { toHold(c); k++; }
        expect(k).toBe(6);
        expect(JSON.stringify(deck.diagnostics())).toBe(seqNow);
        for (let i = 0; i < k; i++) fwd(c);
        expect(JSON.stringify(deck.diagnostics())).toBe(seqNow);
      }
      for (let i = 0; i < 4; i++) fwd(c);
      return JSON.stringify([deck.diagnostics(), c.state.stage, c.state.sceneCityId, c.state.selectedId, c.state.neuralFeeds, c.state.floatFeeds]);
    };
    expect(run(true)).toBe(run(false));
  });

  it('a verified city always opens its own real feed, never another one for novelty', () => {
    const verified = CITIES.filter((x) => x.verified);
    const deck = new SpyDeck(FEED_IDS, 2);
    const c = make([{ kind: 'globe', after: 1 }], deck, verified, 7);
    let entered = 0;
    for (let i = 0; i < 60; i++) {
      fwd(c);
      const city = c.state.sceneCityId ? cityById(c.state.sceneCityId) : null;
      if (c.state.stage === 'selected' && city) {
        entered++;
        expect(city.verified).toBeTruthy();
        expect(city.feedIds).toContain(feedOf(c.state.selectedId)!);
        if (city.id === 'savannah') expect(feedOf(c.state.selectedId)).toBe('parked-c130');
        if (city.id === 'palmdale') expect(feedOf(c.state.selectedId)).toBe('palmdale-dc8');
      }
    }
    expect(entered).toBeGreaterThan(10);
  });

  it('city novelty uses the city\'s own feed: a demo city never shows a different fresh feed under its name', () => {
    const deck = new SpyDeck(FEED_IDS, 9);
    const c = make([{ kind: 'globe', after: 1 }], deck);
    for (let i = 0; i < 70; i++) {
      fwd(c);
      const city = c.state.stage === 'selected' && c.state.sceneCityId ? cityById(c.state.sceneCityId) : null;
      if (city) expect(city.feedIds ?? [city.feedId]).toContain(feedOf(c.state.selectedId)!);
    }
  });
});
