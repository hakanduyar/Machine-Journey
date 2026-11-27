import { describe, expect, it } from 'vitest';
import { allocateCityRecordings, type RecordingCandidate } from '../../src/journey/recordingIdentity';

const H = (c: string) => c.repeat(64);

/** Default view id is per-key so distinct keys are distinct reviewed views unless overridden. */
function cand(over: Partial<RecordingCandidate> & { key?: string; page?: string; view?: string } = {}): RecordingCandidate {
  const { key = 'a', page = 'p1', view = `view-${key}`, ...rest } = over;
  return {
    cityId: 'tokyo',
    reviewedView: { viewId: view, reviewRef: `review/${view}` },
    originalAssetKey: key,
    provenance: { publisher: 'NASA', sourceUrl: `https://nasa.example/${page}`, publisherItemKey: page },
    ...rest,
  };
}

const ok = <T extends { status: string }>(r: T) => {
  if (r.status === 'invalid') throw new Error('unexpected invalid: ' + JSON.stringify(r));
  return r as Extract<T, { status: 'ready' | 'insufficient' }>;
};

describe('recordingIdentity', () => {
  it('same original with different feed/crop/offset is ONE', () => {
    const a = { ...cand({ view: 'v', feedId: 'f1' }), crop: [0, 0, 1, 1], timeOffset: 0 };
    const b = { ...cand({ view: 'v', feedId: 'f2' }), crop: [0.2, 0, 0.5, 1], timeOffset: 30, loopHash: 'zz' };
    const r = ok(allocateCityRecordings('tokyo', 1, [a, b]));
    expect(r.status).toBe('ready');
    expect(r.available).toBe(1);
    expect(r.recordings[0].feedIds).toEqual(['f1', 'f2']);
    expect(r.diagnostics.duplicatesCollapsed).toBe(1);
  });

  it('identical original bytes under aliases are ONE (hash case-normalized)', () => {
    const r = ok(allocateCityRecordings('tokyo', 1, [
      cand({ key: 'a', view: 'v', originalSha256: H('a') }),
      cand({ key: 'b', view: 'v', page: 'p2', originalSha256: H('A') }),
    ]));
    expect(r.available).toBe(1);
    expect(r.recordings[0].sha256).toEqual([H('a')]);
    expect(r.recordings[0].originalAssets).toBe(1);
  });

  it('different assets/hashes/time windows of the SAME reviewed view allocate ONE tile', () => {
    const r = ok(allocateCityRecordings('tokyo', 2, [
      cand({ key: 'a', view: 'cam1', originalSha256: H('1') }),
      cand({ key: 'b', view: 'cam1', originalSha256: H('2'), originalAssetUrl: 'https://cdn.example/later.mp4' }),
    ]));
    expect(r.status).toBe('insufficient');
    expect(r.available).toBe(1);
    expect(r.deficit).toBe(1);
    expect(r.recordings[0].originalAssets).toBe(2);
  });

  it('same NASA page with distinct assets is TWO only with distinct reviewed view ids', () => {
    const two = ok(allocateCityRecordings('tokyo', 2, [
      cand({ key: 'a', view: 'cam1', originalSha256: H('1') }),
      cand({ key: 'b', view: 'cam2', originalSha256: H('2') }),
    ]));
    expect(two.status).toBe('ready');
    expect(two.diagnostics.sharedPublisherItems).toEqual([{ publisherItemKey: 'p1', views: 2 }]);
    const one = ok(allocateCityRecordings('tokyo', 2, [
      cand({ key: 'a', view: 'cam1', originalSha256: H('1') }),
      cand({ key: 'b', view: 'cam1', originalSha256: H('2') }),
    ]));
    expect(one.available).toBe(1);
  });

  it('missing view review is explicit invalid/unreviewed, never ready', () => {
    const none = { ...cand({ key: 'x' }), reviewedView: undefined };
    const noRef = { ...cand({ key: 'y' }), reviewedView: { viewId: 'v', reviewRef: ' ' } };
    const noId = { ...cand({ key: 'z' }), reviewedView: { viewId: '', reviewRef: 'r' } };
    for (const bad of [none, noRef, noId]) {
      const r = allocateCityRecordings('tokyo', 1, [cand({ key: 'ok' }), bad]);
      expect(r.status).toBe('invalid');
      if (r.status === 'invalid') expect(r.issues[0]).toMatchObject({ kind: 'unreviewed', index: 1 });
    }
  });

  it('missing/ambiguous original provenance is explicit invalid', () => {
    const noKey = { ...cand(), originalAssetKey: '' };
    const noProv = { ...cand(), provenance: undefined } as unknown as RecordingCandidate;
    const badHash = cand({ originalSha256: 'xyz' });
    for (const bad of [noKey, noProv, badHash]) {
      const r = allocateCityRecordings('tokyo', 1, [cand({ key: 'ok' }), bad]);
      expect(r.status).toBe('invalid');
      if (r.status === 'invalid') expect(r.issues[0]).toMatchObject({ kind: 'provenance', index: 1 });
    }
  });

  it('contradictory view ids connected by the same original evidence surface a conflict', () => {
    const r = allocateCityRecordings('tokyo', 2, [
      cand({ key: 'a', view: 'cam1', originalSha256: H('1') }),
      cand({ key: 'b', view: 'cam2', originalSha256: H('1') }),
    ]);
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ kind: 'conflict', viewIds: ['cam1', 'cam2'], indices: [0, 1] });
  });

  it('isolates cities, ignoring other-city candidates entirely', () => {
    const r = ok(allocateCityRecordings('tokyo', 1, [
      cand({ key: 'a' }),
      { ...cand({ key: 'a' }), cityId: 'paris' },
      { ...cand({ key: 'z' }), cityId: 'paris', originalAssetKey: '', reviewedView: undefined },
    ]));
    expect(r.available).toBe(1);
    expect(r.diagnostics.otherCity).toBe(2);
    expect(r.allocations[0].tileId.startsWith('tokyo#')).toBe(true);
  });

  it('insufficient 4/78 returns deficit 74 without repeated filling', () => {
    const four = ['a', 'b', 'c', 'd'].map((key) => cand({ key }));
    const r = allocateCityRecordings('tokyo', 78, [...four, ...four]);
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.required).toBe(78);
    expect(r.available).toBe(4);
    expect(r.deficit).toBe(74);
    expect(r.allocations).toHaveLength(4);
    expect(new Set(r.allocations.map((a) => a.tileId)).size).toBe(4);
  });

  it('is stable under reorder; tile ids depend only on city + view', () => {
    const list = ['a', 'b', 'c'].map((key) => cand({ key, originalSha256: H(key === 'a' ? '1' : key === 'b' ? '2' : '3') }));
    const r1 = ok(allocateCityRecordings('tokyo', 3, list));
    const r2 = ok(allocateCityRecordings('tokyo', 3, [...list].reverse().map((c) => ({ ...c, feedId: 'other' }))));
    expect(r2.allocations.map((a) => [a.slot, a.tileId])).toEqual(r1.allocations.map((a) => [a.slot, a.tileId]));
  });

  it('adding derivative aliases does not rename an existing tile', () => {
    const before = ok(allocateCityRecordings('tokyo', 1, [cand({ key: 'a', view: 'cam1' })]));
    const after = ok(allocateCityRecordings('tokyo', 1, [
      cand({ key: 'b', view: 'cam1', originalSha256: H('9') }),
      cand({ key: 'a', view: 'cam1', originalSha256: H('9'), originalAssetUrl: 'https://cdn.example/x.mp4' }),
    ]));
    expect(after.allocations[0].tileId).toBe(before.allocations[0].tileId);
  });

  it('dedupes transitive aliases (and keeps them in one view)', () => {
    const list = [
      cand({ key: 'a', view: 'v', originalSha256: H('1') }),
      cand({ key: 'b', view: 'v', originalSha256: H('1'), originalAssetUrl: 'https://cdn.example/x.mp4#t=5' }),
      cand({ key: 'c', view: 'v', originalAssetUrl: 'https://cdn.example/x.mp4' }),
    ];
    const r = ok(allocateCityRecordings('tokyo', 1, list));
    expect(r.available).toBe(1);
    expect(r.recordings[0].memberCount).toBe(3);
    expect(r.recordings[0].originalAssets).toBe(1);
    expect(ok(allocateCityRecordings('tokyo', 1, [...list].reverse())).recordings[0].tileId).toBe(r.recordings[0].tileId);
  });

  it('transitive alias chain across different view ids is a conflict', () => {
    const r = allocateCityRecordings('tokyo', 2, [
      cand({ key: 'a', view: 'cam1', originalSha256: H('1') }),
      cand({ key: 'b', view: 'cam1', originalSha256: H('1'), originalAssetUrl: 'https://cdn.example/x.mp4' }),
      cand({ key: 'c', view: 'cam2', originalAssetUrl: 'https://cdn.example/x.mp4' }),
    ]);
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.issues[0]).toMatchObject({ kind: 'conflict', viewIds: ['cam1', 'cam2'] });
  });
});
