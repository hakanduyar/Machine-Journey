import { describe, expect, it } from 'vitest';
import { COLLAGE_MAX_WAIT_MS, collageReady, collageStatus, loadPosters, type PosterImage } from '../../src/journey/posterGate';

class FakeImg implements PosterImage {
  src = ''; complete = false; naturalWidth = 0; onload: unknown = null; onerror: unknown = null;
  resolve!: () => void; reject!: () => void;
  decode = () => new Promise<void>((res, rej) => { this.resolve = () => { this.complete = true; this.naturalWidth = 320; res(); }; this.reject = rej; });
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('cold collage poster readiness', () => {
  it('requests every poster at once and reveals on posters only (videos are not an input)', async () => {
    const made: FakeImg[] = [];
    const urls = Array.from({ length: 12 }, (_, i) => `/media/m${i}/poster.jpg`);
    const entries = loadPosters(urls, () => { const im = new FakeImg(); made.push(im); return im; });
    expect(made.map((m) => m.src)).toEqual(urls); // all 12 started immediately
    expect(collageReady(entries.map((e) => e.state), 0)).toBe(false);
    made.slice(0, 11).forEach((m) => m.resolve()); await flush();
    expect(collageReady(entries.map((e) => e.state), 100)).toBe(false); // one poster still pending
    made[11].resolve(); await flush();
    expect(entries.every((e) => e.state === 'ready')).toBe(true);
    expect(collageReady(entries.map((e) => e.state), 100)).toBe(true); // no video readiness needed or consulted
  });

  it('a failed poster is a deliberate dark tile once others are ready; a slow poster never reveals a blank grid', async () => {
    const made: FakeImg[] = [];
    const entries = loadPosters(['/a.jpg', '/b.jpg', '/c.jpg'], () => { const im = new FakeImg(); made.push(im); return im; });
    made[0].resolve(); made[1].reject(); await flush();
    const st = () => entries.map((e) => e.state);
    expect(st()).toEqual(['ready', 'failed', 'pending']);
    expect(collageReady(st(), 10, true)).toBe(false); // one still pending
    expect(collageReady(st(), COLLAGE_MAX_WAIT_MS * 4, true)).toBe(false); // the timeout does NOT lift the cover
    expect(collageStatus(st(), COLLAGE_MAX_WAIT_MS, false)).toBe('slow'); // it only switches to a readable status
    made[2].reject(); await flush();
    expect(collageReady(st(), 10, true)).toBe(true); // one ok, two failed: the failed ones are dark tiles
  });

  it('every poster slower than the timeout: the cover stays (status "slow") and completes once they arrive; all failed is an explicit status', async () => {
    const made: FakeImg[] = [];
    const entries = loadPosters(['/a.jpg', '/b.jpg'], () => { const im = new FakeImg(); made.push(im); return im; });
    const st = () => entries.map((e) => e.state);
    expect(collageStatus(st(), 100, false)).toBe('loading');
    expect(collageStatus(st(), COLLAGE_MAX_WAIT_MS + 1, false)).toBe('slow');
    expect(collageReady(st(), COLLAGE_MAX_WAIT_MS * 3, true)).toBe(false); // nothing decoded: never reveal an empty grid
    made.forEach((m) => m.resolve()); await flush();
    expect(collageReady(st(), COLLAGE_MAX_WAIT_MS * 3, false)).toBe(false); // decoded but tiles not painted yet
    expect(collageStatus(st(), COLLAGE_MAX_WAIT_MS * 3, true)).toBe('ready'); // late arrival completes it automatically

    const bad: FakeImg[] = [];
    const failed = loadPosters(['/a.jpg', '/b.jpg'], () => { const im = new FakeImg(); bad.push(im); return im; });
    bad.forEach((m) => m.reject()); await flush();
    expect(collageStatus(failed.map((e) => e.state), 10, true)).toBe('failed'); // retained message, not a dark grid
    expect(collageStatus(failed.map((e) => e.state), 10, true, true)).toBe('ready'); // unless a decoded video frame was drawn
  });

  it('settled posters alone do not lift the cover: the tiles must also be painted (bounded by the max wait)', () => {
    const ok = ['ready', 'ready', 'failed'] as const;
    expect(collageReady(ok, 100, false)).toBe(false); // posters done, canvases not yet painted: cover stays
    expect(collageReady(ok, 100, true)).toBe(true);
    expect(collageReady(['ready', 'pending'], 100, true)).toBe(false);
    expect(collageReady(['ready', 'pending'], COLLAGE_MAX_WAIT_MS, false)).toBe(false); // the timeout alone never lifts the cover
  });

  it('without decode() it falls back to load / error events', () => {
    class NoDecode implements PosterImage { src = ''; complete = false; naturalWidth = 0; onload: unknown = null; onerror: unknown = null; }
    const made: NoDecode[] = [];
    const entries = loadPosters(['/a.jpg', '/b.jpg'], () => { const im = new NoDecode(); made.push(im); return im; });
    (made[0].onload as () => void)(); (made[1].onerror as () => void)();
    expect(entries.map((e) => e.state)).toEqual(['ready', 'failed']);
  });
});
