import { describe, expect, it } from 'vitest';
import { admitCityLayout, createUniqueLayoutFactory } from '../../src/journey/uniqueCityLayout';
import type { RecordingCandidate } from '../../src/journey/recordingIdentity';
import { tileCountFor } from '../../src/journey/layout';

const N = 12;
const FEEDS = ['other0', ...Array.from({ length: N }, (_, i) => `f${i}`)];
const OWNED = FEEDS.slice(1);
const cand = (i: number, over: Partial<RecordingCandidate> = {}): RecordingCandidate => ({
  cityId: 'syn', feedId: `f${i}`, reviewedView: { viewId: `v${i}`, reviewRef: 'syn-review' },
  originalAssetKey: `k${i}`, provenance: { publisher: 'Syn', sourceUrl: `https://syn.example/${i}` }, ...over,
});
const all = Array.from({ length: N }, (_, i) => cand(i));
const run = (cands: RecordingCandidate[], slots = N, w = 1200, h = 600) =>
  admitCityLayout({ cityId: 'syn', requestedSlots: slots, candidates: cands, feedIds: FEEDS, ownedFeedIds: OWNED, width: w, height: h, seed: 11 });

describe('admitCityLayout', () => {
  it('ready: one canonical view per leaf, exact feed bindings, stable ids, full crop, no reuse', () => {
    const r = run(all);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    const t = r.mosaic.tiles;
    expect(t).toHaveLength(N);
    expect(new Set(t.map((x) => x.id)).size).toBe(N);
    expect(new Set(t.map((x) => x.feedIndex)).size).toBe(N);
    for (const x of t) {
      expect(x.id.startsWith('syn#view:')).toBe(true);
      expect(FEEDS[x.feedIndex]).toBe(`f${Number(x.id.split('view:v')[1])}`);
      expect(x.crop).toEqual({ z: 1, cx: 0.5, cy: 0.5 });
    }
  });

  it('identity is stable under input reorder and resize; only geometry moves', () => {
    const a = run(all);
    const b = run([...all].reverse());
    const c = run(all, N, 2400, 900);
    if (a.status !== 'ready' || b.status !== 'ready' || c.status !== 'ready') throw new Error('not ready');
    const map = (m: typeof a) => m.mosaic.tiles.map((x) => [x.id, x.feedIndex]);
    expect(map(b)).toEqual(map(a));
    expect(map(c)).toEqual(map(a));
    expect(c.mosaic.tiles[0].rect).not.toEqual(a.mosaic.tiles[0].rect);
  });

  it('shortage returns capacity and NO mosaic (never partial tiles)', () => {
    const r = run(all.slice(0, 5));
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect([r.required, r.available, r.deficit]).toEqual([N, 5, N - 5]);
    expect('mosaic' in r).toBe(false);
  });

  it('missing/foreign media binding is invalid', () => {
    expect(run([...all.slice(0, N - 1), cand(N - 1, { feedId: 'nope' })]).status).toBe('invalid');
    expect(run([...all.slice(0, N - 1), cand(N - 1, { feedId: 'other0' })]).status).toBe('invalid'); // known but not city-owned
    expect(run([...all.slice(0, N - 1), cand(N - 1, { feedId: undefined })]).status).toBe('invalid');
  });

  it('two views on one feed, or duplicate aliases across views, are invalid', () => {
    expect(run([...all.slice(0, N - 1), cand(N - 1, { feedId: 'f0' })]).status).toBe('invalid');
    const aliased = [...all.slice(0, N - 1), cand(N - 1, { originalAssetKey: 'k0' })];
    const r = run(aliased);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues[0].kind).toBe('conflict');
  });

  it('requested slots follow tileCountFor and are parameterized', () => {
    const n = tileCountFor(900, 600, 3);
    const r = admitCityLayout({
      cityId: 'syn', requestedSlots: n, candidates: all, feedIds: FEEDS, ownedFeedIds: OWNED, width: 2700, height: 600,
    });
    expect(r.status).toBe(n <= N ? 'ready' : 'insufficient');
  });

  it('factory yields a mosaic for a ready city and null otherwise', () => {
    const f = createUniqueLayoutFactory({
      requestedSlots: N, candidatesFor: (c) => all.filter((x) => x.cityId === c), feedIds: FEEDS, ownedFeedIdsOf: () => OWNED,
    });
    expect(f('syn', { width: 1200, height: 600, seed: 11 })?.tiles).toHaveLength(N);
    expect(f('elsewhere', { width: 1200, height: 600, seed: 11 })).toBeNull();
  });
});
