// Real-browser guard check (NOT a black-frame reproduction: none was reproduced). Over several later route holds the
// focal <video> must be the same persistent element, advance in time AND decoded frames, and its pane must show
// non-black pixels; nothing may reload/seek/re-source it. Also: a tab-visibility return keeps the same policy.
// Usage: node tests/e2e/media-hold.mjs [url] [holds]   (local Edge or Chrome via playwright-core; no download)
import { chromium } from 'playwright-core';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3343/';
const HOLDS = Number(process.argv[3] ?? 6);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); } catch { /* next */ }
  }
  throw new Error('No local Edge or Chrome found');
}

/** Focal video of the current hold (selected tile's feed, or the visible floating/neural pane's feed via the HUD). */
const probe = async () => {
  const root = document.querySelector('.journey');
  const tile = root.dataset.selected ? document.querySelector(`[data-tile="${root.dataset.selected}"]`) : null;
  const v = tile ? document.querySelector(`video[data-feed="${tile.dataset.feed}"]`) : null;
  if (!v) return { stage: root.dataset.stage, video: false };
  if (!v.__uid) v.__uid = Math.random().toString(36).slice(2);
  const q = v.getVideoPlaybackQuality?.();
  // luminance of the decoded frame through a 16x9 canvas (reads only the shared element, never mutates it)
  const c = document.createElement('canvas'); c.width = 16; c.height = 9;
  const g = c.getContext('2d'); let lum = 0;
  try { g.drawImage(v, 0, 0, 16, 9); const d = g.getImageData(0, 0, 16, 9).data; for (let i = 0; i < d.length; i += 4) lum += (d[i] + d[i + 1] + d[i + 2]) / 3; lum /= 144; } catch { lum = -1; }
  return {
    stage: root.dataset.stage, video: true, uid: v.__uid, ct: v.currentTime, frames: q?.totalVideoFrames ?? null,
    paused: v.paused, ready: v.readyState, shown: v.style.visibility !== 'hidden', lum, ev: window.__ev ?? 0,
  };
};

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE_URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__ev = 0; document.querySelectorAll('video').forEach((v) => ['seeking', 'emptied', 'loadstart', 'abort'].forEach((n) => v.addEventListener(n, () => { window.__ev++; }))); });

const uids = new Map();
for (let i = 0; i < HOLDS; i++) {
  // Forward with a real wheel (down = forward), wait for any non-travelling hold that has a focal selected video.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => ['selected', 'mosaic', 'globe', 'floating', 'neural'].includes(document.querySelector('.journey').dataset.stage), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const a = await page.evaluate(probe);
  if (!a.video) { console.log(`hold ${i + 1}: ${a.stage} (no focal selected video)`); await page.waitForTimeout(400); continue; }
  await page.waitForTimeout(900);
  const b = await page.evaluate(probe);
  const tag = `hold ${i + 1} (${a.stage})`;
  check(`${tag}: same persistent element across the hold`, a.uid === b.uid);
  check(`${tag}: time advances (or loop-wraps)`, b.ct !== a.ct);
  check(`${tag}: decoded frames advance`, b.frames === null || b.frames > a.frames, `${a.frames} -> ${b.frames}`);
  check(`${tag}: promoted with a decoded frame, non-black`, b.shown && b.ready >= 2 && (b.lum < 0 || b.lum > 3), `lum ${b.lum?.toFixed?.(1)}`);
  check(`${tag}: no seek/emptied/loadstart/abort`, b.ev === 0);
  uids.set(b.uid, true);
  await page.waitForTimeout(500);
}

// Tab return: dispatch a visibilitychange (what a real return fires); the intended policy must still hold.
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(800);
const r = await page.evaluate(() => ({ stage: document.querySelector('.journey').dataset.stage, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length }));
check('after a visibility return: globe plays none, selected plays one, other stages may keep the pool', r.stage === 'globe' ? r.playing === 0 : r.stage === 'selected' ? r.playing === 1 : r.playing >= 1, `${r.stage}: ${r.playing} playing`);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
