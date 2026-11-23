import { describe, expect, it } from 'vitest';
import { PlaybackDriver, desiredPlayback, type PlayableVideo } from '../../src/journey/playback';
import type { Stage } from '../../src/journey/controller';

const N = 10;
const want = (stage: Stage, selectedFeed = -1, targetFeed = -1, pending = false) =>
  desiredPlayback({ stage, selectedFeed, targetFeed, feedCount: N, pending });
const count = (a: boolean[]) => a.filter(Boolean).length;

/** A fake element that records every call and FAILS the test on any seek / reload / source change. */
class Fake implements PlayableVideo {
  paused = true; ended = false; readyState = 4; plays = 0; pauses = 0;
  refuse: number;
  constructor(refuse = 0) { this.refuse = refuse; }
  play() {
    this.plays++;
    if (this.refuse > 0) { this.refuse--; return Promise.reject(new Error('NotAllowed')); }
    this.paused = false; return Promise.resolve();
  }
  pause() { this.pauses++; this.paused = true; }
  set currentTime(_: number) { throw new Error('seek is forbidden'); }
  load() { throw new Error('reload is forbidden'); }
  set src(_: string) { throw new Error('src change is forbidden'); }
}
const fake = (opts: { refuse?: number } = {}) => new Fake(opts.refuse ?? 0);
const pool = (n = N) => Array.from({ length: n }, () => fake());
const flush = () => new Promise((r) => setTimeout(r, 0));
const playing = (p: Fake[]) => p.filter((v) => !v.paused).length;

describe('desired playback per stage', () => {
  it('settled globe plays nothing; a selected camera plays only its own feed', () => {
    expect(count(want('globe'))).toBe(0);
    const sel = want('selected', 4);
    expect(count(sel)).toBe(1); expect(sel[4]).toBe(true);
  });

  it('visible mosaic, floating field, neural scene and their legs keep the whole pool', () => {
    for (const s of ['mosaic', 'expanding', 'contracting', 'scanning', 'floatIn', 'floating', 'floatMove', 'floatOut',
      'neuralIn', 'neural', 'neuralMove', 'neuralOut'] as Stage[]) expect(count(want(s, 3))).toBe(N);
  });

  it('outgoing bridges keep every feed (the departing cue included) until arrival at the globe hold', () => {
    expect(count(want('globeOut', 2))).toBe(N);
    expect(count(want('neuralOut'))).toBe(N);
    expect(count(want('globe'))).toBe(0); // only on arrival
  });

  it('the requested city leg warms its target during turning, then the pool covers the entry', () => {
    const t = want('turning', -1, 7);
    expect(count(t)).toBe(1); expect(t[7]).toBe(true);
    expect(count(want('entering', -1, 7))).toBe(N);
  });

  it('a pending manual intent never pauses the visible camera; unknown cameras never pause anything', () => {
    const p = want('selected', 5, -1, true);
    expect(p[5]).toBe(true);
    expect(count(want('selected', -1))).toBe(N);
    expect(count(want('turning', -1, -1))).toBe(N);
  });
});

describe('playback driver', () => {
  it('settled selected: exactly one decoder plays, then the globe hold pauses it, with no seek/reload/src change', async () => {
    const p = pool(); const d = new PlaybackDriver();
    d.apply(want('mosaic'), p, 0); await flush();
    expect(playing(p)).toBe(N);
    d.apply(want('selected', 2), p, 16); await flush();
    expect(playing(p)).toBe(1); expect(p[2].paused).toBe(false);
    d.apply(want('globe'), p, 32); await flush();
    expect(playing(p)).toBe(0);
  });

  it('the next city continues: target prewarmed in turning keeps playing through entering and into selected, same element', async () => {
    const p = pool(); const d = new PlaybackDriver();
    d.apply(want('globe'), p, 0); await flush();
    expect(playing(p)).toBe(0);
    d.apply(want('turning', -1, 6), p, 16); await flush();
    expect(playing(p)).toBe(1); const target = p[6]; const playsAfterWarm = target.plays;
    d.apply(want('entering', -1, 6), p, 32); await flush();
    expect(playing(p)).toBe(N);
    d.apply(want('selected', 6), p, 48); await flush();
    expect(playing(p)).toBe(1);
    expect(target.plays).toBe(playsAfterWarm + 0); // continuous: never re-started (and never seeked: the fake would throw)
    expect(target.pauses).toBe(0);
  });

  it('applying the same desired set repeatedly makes no further play/pause calls', async () => {
    const p = pool(); const d = new PlaybackDriver();
    d.apply(want('selected', 1), p, 0); await flush();
    const calls = () => p.reduce((n, v) => n + v.plays + v.pauses, 0);
    const before = calls();
    for (let i = 1; i < 300; i++) d.apply(want('selected', 1), p, i * 16);
    expect(calls()).toBe(before);
    for (let i = 0; i < 300; i++) d.apply(want('globe'), p, 5000 + i * 16);
    expect(calls()).toBe(before + 1); // one pause for the single playing video
  });

  it('a refused play is retried with back-off, not every frame; a gesture clears the back-off; a hidden video is never started by it', async () => {
    const p = [fake({ refuse: 2 }), fake(), fake()]; const d = new PlaybackDriver();
    const w = [true, false, false];
    d.apply(w, p, 0); await flush();
    expect(p[0].plays).toBe(1);
    for (let t = 16; t < 400; t += 16) d.apply(w, p, t);
    expect(p[0].plays).toBe(1); // inside the 500 ms back-off: no spinning
    d.unlock();
    d.apply(w, p, 420); await flush();
    expect(p[0].plays).toBe(2); // gesture retry (refused once more)
    d.unlock();
    d.apply(w, p, 440); await flush();
    expect(p[0].paused).toBe(false);
    expect(p[1].plays).toBe(0); expect(p[2].plays).toBe(0);
  });

  it('does not touch videos that are not ready or have no element', () => {
    const notReady = fake(); notReady.readyState = 1;
    const p: (PlayableVideo | null)[] = [null, notReady];
    const d = new PlaybackDriver();
    expect(() => d.apply([true, true], p, 0)).not.toThrow();
    expect(notReady.plays).toBe(0);
  });
});
