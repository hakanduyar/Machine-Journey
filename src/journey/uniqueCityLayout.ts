/**
 * Pure unique-city layout admission (R51 B). NOT used by the default runtime.
 *
 * `admitCityLayout` runs the allocator (allocateCityRecordings) for a city and requested slot count. Only when every slot is
 * filled by a DISTINCT reviewed view bound to exactly one existing playable feed does it return a renderable mosaic: the
 * existing weighted geometry (generateMosaic) with each leaf mapped ONE-to-ONE to a canonical view -> its ALL_FEEDS index,
 * tile id = stable city+view id, full recorded image crop. No modulo/reuse, no crop variety, no placeholder tiles, and no
 * partial mosaic: insufficient / invalid never carry tiles.
 *
 * Identity is stable under input reorder and resize: slots follow canonical view order, so only the geometry (rects) moves.
 */
import type { CropParams } from './geometry';
import { generateMosaic, type Mosaic } from './layout';
import { allocateCityRecordings, type AllocationResult, type RecordingCandidate, type RecordingIssue } from './recordingIdentity';

export const FULL_CROP: CropParams = { z: 1, cx: 0.5, cy: 0.5 };

export interface AdmitOptions {
  cityId: string;
  requestedSlots: number;
  candidates: readonly RecordingCandidate[];
  /** Index space the tiles' `feedIndex` lives in (ALL_FEEDS ids, in order). */
  feedIds: readonly string[];
  /** Feeds the city owns; a view bound to anything else is invalid. */
  ownedFeedIds: readonly string[];
  width: number;
  height: number;
  seed?: number;
}

export type AdmitResult =
  | { status: 'ready'; cityId: string; required: number; available: number; deficit: 0; mosaic: Mosaic; allocation: AllocationResult }
  | { status: 'insufficient'; cityId: string; required: number; available: number; deficit: number; allocation: AllocationResult }
  | { status: 'invalid'; cityId: string; issues: RecordingIssue[] };

const bindingIssue = (reason: string): RecordingIssue => ({ kind: 'provenance', index: -1, reason });

export function admitCityLayout(o: AdmitOptions): AdmitResult {
  const { cityId, requestedSlots: n } = o;
  if (!Number.isInteger(n) || n < 1) return { status: 'invalid', cityId, issues: [{ kind: 'argument', index: -1, reason: 'requestedSlots must be a positive integer' }] };
  const alloc = allocateCityRecordings(cityId, n, o.candidates);
  if (alloc.status === 'invalid') return { status: 'invalid', cityId, issues: alloc.issues };
  if (alloc.status === 'insufficient') {
    return { status: 'insufficient', cityId, required: alloc.required, available: alloc.available, deficit: alloc.deficit, allocation: alloc };
  }

  // Each allocated view must bind to exactly ONE known, city-owned feed, and no feed may serve two views.
  const feedIndexOf: number[] = [];
  const issues: RecordingIssue[] = [];
  const used = new Map<number, string>();
  for (const a of alloc.allocations) {
    const feeds = a.recording.feedIds;
    if (feeds.length !== 1) { issues.push(bindingIssue(`view ${a.recording.viewId} binds ${feeds.length} feeds (exactly 1 required)`)); feedIndexOf.push(-1); continue; }
    const idx = o.feedIds.indexOf(feeds[0]);
    if (idx < 0 || !o.ownedFeedIds.includes(feeds[0])) { issues.push(bindingIssue(`view ${a.recording.viewId} feed ${feeds[0]} is not a known feed of ${cityId}`)); feedIndexOf.push(-1); continue; }
    const prev = used.get(idx);
    if (prev !== undefined) issues.push(bindingIssue(`feed ${feeds[0]} bound to both ${prev} and ${a.recording.viewId}`));
    used.set(idx, a.recording.viewId);
    feedIndexOf.push(idx);
  }
  if (issues.length) return { status: 'invalid', cityId, issues };

  const geometry = generateMosaic({ width: o.width, height: o.height, tileCount: n, feedCount: n, seed: o.seed });
  const tiles = geometry.tiles.map((t, i) => ({
    ...t,
    id: alloc.allocations[i].tileId,
    feedIndex: feedIndexOf[i],
    crop: { ...FULL_CROP },
  }));
  return { status: 'ready', cityId, required: n, available: alloc.available, deficit: 0, mosaic: { ...geometry, tiles }, allocation: alloc };
}

/**
 * Layout factory for Journey's opt-in unique mode: (city, geometry) -> mosaic or null. Slots are fixed at gate time so the
 * layout always matches the capacity that was admitted; a city that is not ready yields null (no tiles, never a fallback).
 */
export type UniqueLayoutFactory = (cityId: string, g: { width: number; height: number; seed: number }) => Mosaic | null;

export function createUniqueLayoutFactory(o: {
  requestedSlots: number;
  candidatesFor: (cityId: string) => readonly RecordingCandidate[];
  feedIds: readonly string[];
  ownedFeedIdsOf: (cityId: string) => readonly string[];
}): UniqueLayoutFactory {
  return (cityId, g) => {
    const r = admitCityLayout({
      cityId, requestedSlots: o.requestedSlots, candidates: o.candidatesFor(cityId), feedIds: o.feedIds,
      ownedFeedIds: o.ownedFeedIdsOf(cityId), width: g.width, height: g.height, seed: g.seed,
    });
    return r.status === 'ready' ? r.mosaic : null;
  };
}
