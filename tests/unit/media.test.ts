import { describe, expect, it } from 'vitest';
import { invalidate, markUploaded, needsDomOverlay, uploadAction, type TexState } from '../../src/journey/handoff';
import { frameCount, frameStamp, isDecoded, trackFrames, type FrameVideo } from '../../src/journey/frames';
import { MAX_ACTIVE_FEEDS, PlaybackDriver, desiredPlayback, routeActive, type PlayableVideo } from '../../src/journey/playback';
import type { Stage } from '../../src/journey/controller';

const vid = (o: Partial<{ readyState: number; videoWidth: number; currentTime: number }> = {}) => ({ readyState: 4, videoWidth: 960, currentTime: 0, ...o });

describe('promotion: not ready -> decoded -> actually uploaded', () => {
  it('a hold stays under the DOM video until a decoded frame was really uploaded to the GPU', () => {
    const st: TexState = { warmed: false, lastTime: -1 };
    const log: boolean[] = [];
    const step = (v: ReturnType<typeof vid>, gpuOk: boolean) => {
      const a = uploadAction(v, st);
      markUploaded(st, a, v, undefined, gpuOk);
      log.push(needsDomOverlay('hold', st.warmed));
    };
    step(vid({ readyState: 1, videoWidth: 0 }), true); // not decoded yet
    step(vid({ currentTime: 0.04 }), false);           // decoded, but the upload produced no GPU texture (lost / failed)
    expect(st.warmed).toBe(false);
    expect(uploadAction(vid({ currentTime: 0.04 }), st)).toBe('warm'); // retried, not assumed
    step(vid({ currentTime: 0.08 }), true);            // valid upload
    step(vid({ currentTime: 0.12 }), true);
    expect(log).toEqual([true, true, false, false]);
  });

  it('context loss invalidates upload-ready; the restored context re-warms before the DOM pane is released', () => {
    const st: TexState = { warmed: true, lastTime: 5, lastFrame: 100 };
    expect(needsDomOverlay('hold', st.warmed)).toBe(false);
    invalidate(st);
    expect(st.warmed).toBe(false);
    expect(needsDomOverlay('hold', st.warmed)).toBe(true);
    const v = vid({ currentTime: 5 });
    expect(uploadAction(v, st)).toBe('warm'); // even with an unchanged clock
    markUploaded(st, 'warm', v, 100, true);
    expect(needsDomOverlay('hold', st.warmed)).toBe(false);
  });

  it('freshness follows frame evidence, not only currentTime', () => {
    const st: TexState = { warmed: true, lastTime: 7, lastFrame: 10 };
    expect(uploadAction(vid({ currentTime: 7 }), st, 10)).toBe('none');      // nothing moved
    expect(uploadAction(vid({ currentTime: 7 }), st, 11)).toBe('refresh');   // clock plateau, frame counter advanced
    expect(uploadAction(vid({ currentTime: 7.04 }), st, 10)).toBe('refresh'); // counter silent, clock moved
    expect(uploadAction(vid({ currentTime: 7 }), st)).toBe('none');          // no counter: clock-only behaviour as before
  });
});

describe('decoded-frame evidence', () => {
  function fake(o: Partial<FrameVideo> & { rvfc?: boolean } = {}) {
    const cbs: (() => void)[] = [];
    const v: FrameVideo = { readyState: 0, videoWidth: 0, currentTime: 0, ...o };
    if (o.rvfc) v.requestVideoFrameCallback = (cb) => { cbs.push(cb); return cbs.length; };
    const present = () => { const run = cbs.splice(0); run.forEach((c) => c()); };
    return { v, present, pending: () => cbs.length };
  }

  it('is not decoded without a current frame and dimensions; then promoted, and sticky through buffering dips', () => {
    const { v } = fake();
    expect(isDecoded(v)).toBe(false);
    v.readyState = 2; expect(isDecoded(v)).toBe(false); // no dimensions
    v.videoWidth = 640; expect(isDecoded(v)).toBe(true);
    v.readyState = 1; expect(isDecoded(v)).toBe(true);  // keeps its last frame: no flicker back to the poster
  });

  it('with a frame counter, readiness needs a presented frame or a moved clock; the counter is event driven', () => {
    const { v, present, pending } = fake({ rvfc: true, readyState: 3, videoWidth: 640 });
    trackFrames(v); trackFrames(v); // idempotent
    expect(pending()).toBe(1);
    expect(frameCount(v)).toBe(0);
    expect(isDecoded(v)).toBe(false);
    present();
    expect(frameCount(v)).toBe(1);
    expect(pending()).toBe(1); // re-armed only by a delivered frame: no timer
    expect(isDecoded(v)).toBe(true);
    expect(frameStamp(v)).toBe(1);
  });

  it('falls back to playback-quality frames, then to the clock', () => {
    expect(frameCount({ readyState: 4, videoWidth: 1, currentTime: 2, getVideoPlaybackQuality: () => ({ totalVideoFrames: 42 }) })).toBe(42);
    const plain: FrameVideo = { readyState: 4, videoWidth: 1, currentTime: 2 };
    expect(frameCount(plain)).toBeUndefined();
    expect(frameStamp(plain)).toBe(2);
  });
});

describe('route media budget: focus + leg destination, max 3 decoders (A3)', () => {
  const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const route = { floatFeeds: ['c', 'f', 'h'], neuralFeeds: ['b', 'e', 'i'], feedIds: IDS };
  const wanted = (stage: Stage, floatIdx = 0, neuralIdx = 0, reverse = false, selectedFeed = -1) => {
    const active = routeActive({ stage, ...route, floatIdx, neuralIdx, reverse });
    const d = desiredPlayback({ stage, selectedFeed, targetFeed: -1, feedCount: 10, active });
    return d.flatMap((on, i) => (on ? [i] : []));
  };

  it('a settled hold decodes only its focused feed; the main video stays wanted', () => {
    expect(wanted('floating', 1)).toEqual([5]);   // f
    expect(wanted('neural', 0, 2)).toEqual([8]);  // i (neuralIdx 2)
  });

  it('a leg decodes its two ends, the same pair forwards and in a reversed history leg', () => {
    expect(wanted('floatMove', 0)).toEqual([2, 5]);
    expect(wanted('floatMove', 0, 0, true)).toEqual([2, 5]); // reverse: same two sources, roles swapped
    expect(routeActive({ stage: 'floatMove', ...route, floatIdx: 0, neuralIdx: 0, reverse: false })).toEqual([2, 5]); // focus (departing) first
    expect(routeActive({ stage: 'floatMove', ...route, floatIdx: 0, neuralIdx: 0, reverse: true })).toEqual([5, 2]);
    expect(wanted('neuralMove', 0, 1)).toEqual([4, 8]);
    expect(wanted('neuralMove', 0, 1, true)).toEqual([4, 8]);
  });

  it('in / out bridges keep the shared pane\'s feed playing, in either direction (incl. neuralOut and its reverse)', () => {
    expect(wanted('floatIn')).toEqual([2]);
    expect(wanted('floatOut')).toEqual([7]);
    expect(wanted('neuralIn')).toEqual([1]);
    expect(wanted('neuralOut')).toEqual([8]);
    expect(wanted('neuralOut', 0, 2, true)).toEqual([8]); // a reversed neuralOut starts from the same focused feed
  });

  it('never exceeds the budget and never pauses everything: an unknown route falls back to the whole pool', () => {
    const many = desiredPlayback({ stage: 'floatMove', selectedFeed: -1, targetFeed: -1, feedCount: 10, active: [0, 1, 2, 3, 4, 5] });
    expect(many.filter(Boolean).length).toBe(MAX_ACTIVE_FEEDS);
    expect(desiredPlayback({ stage: 'floating', selectedFeed: -1, targetFeed: -1, feedCount: 10, active: [] }).every(Boolean)).toBe(true);
    expect(desiredPlayback({ stage: 'neural', selectedFeed: -1, targetFeed: -1, feedCount: 10 }).every(Boolean)).toBe(true);
    expect(routeActive({ stage: 'floating', ...route, floatIdx: 9, neuralIdx: 0 })).toEqual([]);
  });

  it('other stages keep their policy: globe 0, selected 1, mosaic and globe bridges the whole pool', () => {
    const act = [3];
    const d = (stage: Stage, selectedFeed = 4) => desiredPlayback({ stage, selectedFeed, targetFeed: -1, feedCount: 10, active: act }).filter(Boolean).length;
    expect(d('globe')).toBe(0); expect(d('selected')).toBe(1);
    for (const s of ['mosaic', 'contracting', 'globeOut', 'entering'] as Stage[]) expect(d(s)).toBe(10);
  });

  it('applying the budget only pauses/plays on a real difference and never resets a video', () => {
    const calls: string[] = [];
    const mk = (i: number, paused: boolean): PlayableVideo => {
      const v = { paused, ended: false, readyState: 4, play() { calls.push(`play${i}`); v.paused = false; return Promise.resolve(); }, pause() { calls.push(`pause${i}`); v.paused = true; } };
      return v;
    };
    const pool = Array.from({ length: 10 }, (_, i) => mk(i, false)); // mosaic: everything playing
    const d = new PlaybackDriver();
    const input = (stage: Stage, active: number[]) => desiredPlayback({ stage, selectedFeed: -1, targetFeed: -1, feedCount: 10, active });
    d.apply(input('floating', [2]), pool, 0);
    expect(calls.filter((c) => c.startsWith('pause')).length).toBe(9); // everyone but the focus pauses (keeps currentTime)
    expect(pool[2].paused).toBe(false);
    calls.length = 0;
    d.apply(input('floating', [2]), pool, 16); d.apply(input('floating', [2]), pool, 32);
    expect(calls).toEqual([]); // steady hold: no per-frame play/pause traffic
    d.apply(input('floatMove', [2, 5]), pool, 48); // leg starts: the destination resumes, nothing else moves
    expect(calls).toEqual(['play5']);
  });
});

describe('active-feed policy is re-asserted on return, never "all ten"', () => {
  const fake = (paused = true) => {
    const v = { paused, ended: false, readyState: 4, plays: 0, play() { v.plays++; v.paused = false; return Promise.resolve(); }, pause() { v.paused = true; } };
    return v as PlayableVideo & { plays: number };
  };
  const input = (stage: Parameters<typeof desiredPlayback>[0]['stage'], selectedFeed = 2) => desiredPlayback({ stage, selectedFeed, targetFeed: -1, feedCount: 10 });

  it('a tab return clears refusal back-off so the selected feed resumes, and nothing else starts', async () => {
    const pool = Array.from({ length: 10 }, () => fake(true));
    const d = new PlaybackDriver();
    const refuse = { ...pool[2], play() { pool[2].plays++; return Promise.reject(new Error('blocked')); } } as unknown as PlayableVideo;
    const refusing = pool.map((p, i) => (i === 2 ? refuse : p));
    d.apply(input('selected'), refusing, 0);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    d.apply(input('selected'), refusing, 10); // inside back-off: no retry storm
    expect(pool[2].plays).toBe(1);
    d.unlock(); // visibility / user-gesture return
    d.apply(input('selected'), pool, 20);
    expect(pool[2].plays).toBe(2); // the real element now plays
    expect(pool[2].paused).toBe(false);
    expect(pool.filter((p, i) => i !== 2 && !p.paused).length).toBe(0);
  });

  it('a settled globe plays nothing, before and after a return', () => {
    const pool = Array.from({ length: 10 }, () => fake(false));
    const d = new PlaybackDriver();
    d.apply(input('globe', -1), pool, 0);
    expect(pool.every((p) => p.paused)).toBe(true);
    d.unlock(); d.apply(input('globe', -1), pool, 1);
    expect(pool.every((p) => p.paused && p.plays === 0)).toBe(true);
  });

  it('the multi-feed pool stages still keep the whole pool wanted', () => {
    for (const s of ['floating', 'neural', 'mosaic', 'entering'] as const) expect(input(s).every(Boolean)).toBe(true);
  });
});
