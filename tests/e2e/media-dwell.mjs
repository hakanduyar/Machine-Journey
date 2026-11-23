// One steady 2 s dwell at the current hold, NO screenshots while measuring. Prints, for the focused feed and for the pool:
// currentTime delta, presented frames (RVFC) and totalVideoFrames delta, readyState, paused, element identity, and how many
// of the ten videos are playing. Run it before and after a change and compare; it proves nothing about universal FPS.
// Usage: node tests/e2e/media-dwell.mjs [url] [forwardIntents]   (local Edge or Chrome via playwright-core; no download)
import { chromium } from 'playwright-core';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3343/';
const STEPS = Number(process.argv[3] ?? 12);

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); } catch { /* next */ }
  }
  throw new Error('No local Edge or Chrome found');
}

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(BASE_URL, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__rv = new Map();
  document.querySelectorAll('video').forEach((v) => {
    window.__rv.set(v, 0);
    if (v.requestVideoFrameCallback) { const t = () => { window.__rv.set(v, window.__rv.get(v) + 1); v.requestVideoFrameCallback(t); }; v.requestVideoFrameCallback(t); }
  });
});
await page.mouse.move(640, 400);
for (let i = 0; i < STEPS; i++) {
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => ['selected', 'globe', 'floating', 'neural', 'mosaic'].includes(document.querySelector('.journey').dataset.stage), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(700);
}
const sample = () => page.evaluate(() => {
  const root = document.querySelector('.journey');
  const vids = [...document.querySelectorAll('video')];
  // the focused feed is the one whose pane is currently visible and on top
  const focus = vids.find((v) => v.parentElement.style.opacity && Number(v.parentElement.style.opacity) > 0.5 && v.parentElement.style.zIndex === '5') ?? null;
  vids.forEach((v) => { if (!v.__uid) v.__uid = Math.random().toString(36).slice(2); });
  const info = (v) => v && ({ feed: v.dataset.feed, uid: v.__uid, ct: v.currentTime, rvfc: window.__rv.get(v), total: v.getVideoPlaybackQuality?.().totalVideoFrames ?? null, ready: v.readyState, paused: v.paused });
  return { stage: root.dataset.stage, playing: vids.filter((v) => !v.paused).length, focus: info(focus), pool: vids.map(info) };
});
const a = await sample();
await page.waitForTimeout(2000);
const b = await sample();
console.log(`stage ${a.stage} -> ${b.stage}; playing ${a.playing} -> ${b.playing} of ${a.pool.length}`);
if (a.focus && b.focus) {
  console.log(`focus ${b.focus.feed}: same element ${a.focus.uid === b.focus.uid}; ct +${(b.focus.ct - a.focus.ct).toFixed(3)} s; rvfc +${b.focus.rvfc - a.focus.rvfc}; totalVideoFrames +${b.focus.total === null ? 'n/a' : b.focus.total - a.focus.total}; ready ${b.focus.ready}; paused ${b.focus.paused}`);
} else console.log('no focused pane video at this hold (e.g. globe)');
const adv = b.pool.filter((p, i) => p.ct !== a.pool[i].ct).map((p) => p.feed);
console.log(`videos whose currentTime advanced during the 2 s dwell: ${adv.length} [${adv.join(', ')}]`);
await browser.close();
