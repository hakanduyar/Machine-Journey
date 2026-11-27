/**
 * Opt-in `?catalog=unique` candidate gate (pure). Default (no query) is the accepted runtime and never reaches this code path.
 * Runs explicit capacity/admission for every reachable city at the whole-world slot count; Journey may mount ONLY when every
 * city is ready. This is a candidate diagnostic, not a finished immersive product.
 */
import { cityFeedIds, type CityLike } from './cityContext';
import { tileCountFor } from './layout';
import type { RecordingCandidate, RecordingIssue } from './recordingIdentity';
import { admitCityLayout, createUniqueLayoutFactory, type UniqueLayoutFactory } from './uniqueCityLayout';

/** Whole-world screens of the accepted runtime (Journey SCREENS). */
export const UNIQUE_SCREENS = 3;

export type CatalogMode = 'default' | 'unique';
export const catalogModeFromSearch = (search: string): CatalogMode =>
  new URLSearchParams(search).get('catalog') === 'unique' ? 'unique' : 'default';

/** Required whole-world tile count for a viewport, from the existing tileCountFor (never hard-coded). */
export const requiredSlotsFor = (vw: number, vh: number): number => tileCountFor(vw, vh, UNIQUE_SCREENS);

/**
 * Candidate-only session capacity: never shrinks. A phone admission (e.g. 41) that grows on a desktop resize (78) keeps 78 when
 * it shrinks again, so tile identities admitted for the larger layout are preserved and capacity must be (re)proven first.
 */
export const pinCapacity = (pinned: number, viewportRequired: number): number => Math.max(pinned, viewportRequired);

/**
 * Candidate-only session lifecycle (pure). `requested` is the non-decreasing high-water capacity; `admitted` is the last capacity a
 * gate actually PASSED, with a monotonically increasing `revision` (cache/memo namespace for Journey). Journey is mounted iff
 * `admitted` is non-null (never at an initial insufficient admission) and is suspended whenever the CURRENT request is not admitted.
 */
export interface CapacityLifecycle { requested: number; admitted: { capacity: number; revision: number } | null }

export const startLifecycle = (viewportRequired: number): CapacityLifecycle => ({ requested: viewportRequired, admitted: null });

/** A viewport change. Returns the SAME object when the high-water capacity does not grow (shrinking never reopens/relaxes). */
export const growRequest = (s: CapacityLifecycle, viewportRequired: number): CapacityLifecycle => {
  const requested = pinCapacity(s.requested, viewportRequired);
  return requested === s.requested ? s : { ...s, requested };
};

/** Record a gate result for the current request. A pass at a new capacity bumps the revision; a failure changes nothing. */
export const recordAdmission = (s: CapacityLifecycle, gate: { ready: boolean; required: number }): CapacityLifecycle => {
  if (!gate.ready || gate.required !== s.requested) return s;
  if (s.admitted && s.admitted.capacity === gate.required) return s;
  return { ...s, admitted: { capacity: gate.required, revision: (s.admitted?.revision ?? 0) + 1 } };
};

export const lifecycleView = (s: CapacityLifecycle) => ({
  mounted: s.admitted !== null,
  /** The current request is not (yet) proven: the retained session must be inert, opaque-covered and not advancing. */
  suspended: s.admitted !== null && s.admitted.capacity !== s.requested,
});

export interface CityCapacity {
  cityId: string;
  name: string;
  status: 'ready' | 'insufficient' | 'invalid';
  required: number;
  available: number;
  deficit: number;
  issues: RecordingIssue[];
}

export type CatalogGate =
  | { ready: true; required: number; cities: CityCapacity[]; layout: UniqueLayoutFactory }
  | { ready: false; required: number; cities: CityCapacity[] };

export interface GateInput {
  requiredSlots: number;
  cities: readonly (CityLike & { name?: string })[];
  candidates: readonly RecordingCandidate[];
  feedIds: readonly string[];
  /** Probe geometry for the admission check (ids/capacity do not depend on it). */
  probe?: { width: number; height: number };
}

export function evaluateUniqueCatalog(i: GateInput): CatalogGate {
  const probe = i.probe ?? { width: 3000, height: 1000 };
  const candidatesFor = (id: string) => i.candidates.filter((c) => c.cityId === id);
  const ownedOf = (id: string) => cityFeedIds(i.cities.find((c) => c.id === id));
  const cities: CityCapacity[] = i.cities.map((c) => {
    const r = admitCityLayout({
      cityId: c.id, requestedSlots: i.requiredSlots, candidates: candidatesFor(c.id), feedIds: i.feedIds,
      ownedFeedIds: ownedOf(c.id), width: probe.width, height: probe.height,
    });
    if (r.status === 'invalid') {
      return { cityId: c.id, name: c.name ?? c.id, status: 'invalid', required: i.requiredSlots, available: 0, deficit: i.requiredSlots, issues: r.issues };
    }
    return { cityId: c.id, name: c.name ?? c.id, status: r.status, required: r.required, available: r.available, deficit: r.deficit, issues: [] };
  });
  const required = i.requiredSlots;
  if (cities.every((c) => c.status === 'ready')) {
    return { ready: true, required, cities, layout: createUniqueLayoutFactory({ requestedSlots: required, candidatesFor, feedIds: i.feedIds, ownedFeedIdsOf: ownedOf }) };
  }
  return { ready: false, required, cities };
}
