import { describe, expect, it } from 'vitest';
import {
  catalogModeFromSearch, evaluateUniqueCatalog, growRequest, lifecycleView, pinCapacity, recordAdmission, requiredSlotsFor, startLifecycle,
} from '../../src/journey/uniqueCatalogGate';
import { RECORDING_MANIFEST } from '../../src/journey/recordingManifest';
import { ALL_FEEDS } from '../../src/journey/feeds';
import { CITIES } from '../../src/journey/globe';
import { tileCountFor } from '../../src/journey/layout';
import type { RecordingCandidate } from '../../src/journey/recordingIdentity';

const IDS = ALL_FEEDS.map((f) => f.id);

describe('uniqueCatalogGate', () => {
  it('query parsing: only ?catalog=unique opts in; default is unchanged', () => {
    expect(catalogModeFromSearch('')).toBe('default');
    expect(catalogModeFromSearch('?seed=3')).toBe('default');
    expect(catalogModeFromSearch('?catalog=other')).toBe('default');
    expect(catalogModeFromSearch('?seed=3&catalog=unique')).toBe('unique');
  });

  it('required slots come from tileCountFor', () => {
    expect(requiredSlotsFor(1440, 900)).toBe(tileCountFor(1440, 900, 3));
  });

  it('real catalogue: all 24 cities are deficient at 78 and at 77; Journey is not admitted', () => {
    expect(CITIES).toHaveLength(24);
    for (const required of [requiredSlotsFor(1440, 900), 77]) {
      const g = evaluateUniqueCatalog({ requiredSlots: required, cities: CITIES, candidates: RECORDING_MANIFEST, feedIds: IDS });
      expect(g.ready).toBe(false);
      expect('layout' in g).toBe(false);
      expect(g.cities).toHaveLength(24);
      expect(g.cities.every((c) => c.status === 'insufficient' && c.deficit > 0 && c.required === required)).toBe(true);
      expect(g.cities.reduce((a, c) => a + c.available, 0)).toBe(RECORDING_MANIFEST.length);
      const but = g.cities.find((c) => c.cityId === 'butlerville')!;
      expect([but.available, but.deficit]).toEqual([30, required - 30]);
    }
    expect(requiredSlotsFor(1440, 900)).toBe(78);
  });

  it('resize capacity is pinned non-decreasing: phone 41 -> desktop 78 -> phone retains 78', () => {
    const seq = [41, 78, 41, 60].reduce((p, v) => pinCapacity(p, v), 0);
    expect(seq).toBe(78);
    expect(pinCapacity(pinCapacity(41, 78), 41)).toBe(78);
    expect(requiredSlotsFor(1440, 900)).toBeGreaterThan(requiredSlotsFor(390, 844));
    // the larger pinned capacity must be proven: all current cities stay blocked at it
    const g = evaluateUniqueCatalog({ requiredSlots: pinCapacity(pinCapacity(41, 78), 41), cities: CITIES, candidates: RECORDING_MANIFEST, feedIds: IDS });
    expect(g.ready).toBe(false);
    expect(g.required).toBe(78);
  });

  describe('capacity lifecycle (synthetic gate results, not catalogue evidence)', () => {
    const pass = (n: number) => ({ ready: true, required: n });
    const fail = (n: number) => ({ ready: false, required: n });

    it('initial insufficient admission never mounts; no revision exists', () => {
      const s = recordAdmission(startLifecycle(78), fail(78));
      expect(lifecycleView(s)).toEqual({ mounted: false, suspended: false });
      expect(s.admitted).toBeNull();
    });

    it('41 -> 78 pass -> shrink: one mounted session, revision bumps once, high-water never shrinks', () => {
      let s = recordAdmission(startLifecycle(41), pass(41));
      expect(lifecycleView(s)).toEqual({ mounted: true, suspended: false });
      expect(s.admitted).toEqual({ capacity: 41, revision: 1 });
      s = growRequest(s, 78);
      expect(lifecycleView(s)).toEqual({ mounted: true, suspended: true }); // pending until the 78 gate passes
      s = recordAdmission(s, pass(78));
      expect(s.admitted).toEqual({ capacity: 78, revision: 2 });
      expect(lifecycleView(s).suspended).toBe(false);
      const shrunk = growRequest(s, 41);
      expect(shrunk).toBe(s); // same object: nothing to re-admit, nothing re-opened at 41
      expect(recordAdmission(shrunk, pass(78))).toBe(shrunk); // re-passing the same capacity is not a new revision
    });

    it('deficient growth fails closed, shrinking does not reopen 41, a later valid 78 resumes the retained session', () => {
      let s = recordAdmission(startLifecycle(41), pass(41));
      s = growRequest(s, 78);
      s = recordAdmission(s, fail(78));
      expect(s.admitted).toEqual({ capacity: 41, revision: 1 }); // retained, unchanged
      expect(lifecycleView(s)).toEqual({ mounted: true, suspended: true });
      s = growRequest(s, 41);
      expect(s.requested).toBe(78);
      expect(lifecycleView(s).suspended).toBe(true);
      expect(recordAdmission(s, pass(41))).toBe(s); // a stale 41 pass cannot lift the suspension
      s = recordAdmission(s, pass(78));
      expect(lifecycleView(s)).toEqual({ mounted: true, suspended: false });
      expect(s.admitted).toEqual({ capacity: 78, revision: 2 });
    });
  });

  it('one unreviewed view in an otherwise ready catalogue keeps the gate closed', () => {
    const feeds = ['a0', 'a1', 'a2'];
    const cities = [{ id: 'c', name: 'C', feedId: 'a0', feedIds: feeds }];
    const mk = (i: number, bad = false): RecordingCandidate => ({
      cityId: 'c', feedId: feeds[i], reviewedView: bad ? undefined : { viewId: `v${i}`, reviewRef: 'r' },
      originalAssetKey: `k${i}`, provenance: { publisher: 'P', sourceUrl: 'https://p.example/' + i },
    });
    const ok = evaluateUniqueCatalog({ requiredSlots: 3, cities, candidates: [mk(0), mk(1), mk(2)], feedIds: feeds });
    expect(ok.ready).toBe(true);
    if (ok.ready) expect(ok.layout('c', { width: 900, height: 300, seed: 11 })?.tiles).toHaveLength(3);
    const bad = evaluateUniqueCatalog({ requiredSlots: 3, cities, candidates: [mk(0), mk(1), mk(2, true)], feedIds: feeds });
    expect(bad.ready).toBe(false);
    expect(bad.cities[0].status).toBe('invalid');
  });
});
