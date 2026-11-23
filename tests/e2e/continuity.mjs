// Small real-input check against a running server (default port 3343): focused hold survives
// resize/orientation change with the SAME feed + <video>, then ONE ArrowRight runs a complete next leg.
// Usage: node tests/e2e/continuity.mjs [url]   (local Edge or Chrome via playwright-core; no download)
import { chromium } from 'playwright-core';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:3343/';
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); } catch { /* next */ }
  }
  throw new Error('No local Edge or Chrome found');
}

const state = () => {
  const root = document.querySelector('.journey');
  const tile = root.dataset.selected ? document.querySelector(`[data-tile="${root.dataset.selected}"]`) : null;
  const feed = tile?.dataset.feed ?? null;
  const v = feed ? document.querySelector(`video[data-feed="${feed}"]`) : null;
  if (v && !v.__uid) v.__uid = Math.random().toString(36).slice(2);
  const pr = v?.parentElement.getBoundingClientRect();
  const tr = tile?.getBoundingClientRect();
  return {
    stage: root.dataset.stage, feed, uid: v?.__uid ?? null, ct: v?.currentTime ?? null, paused: v?.paused ?? null,
    pane: pr ? [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)] : null,
    tileCx: tr ? tr.x + tr.width / 2 : null, tileCy: tr ? tr.y + tr.height / 2 : null,
    vw: innerWidth, vh: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
  };
};

async function run(browser, label, startVp, resizes, touch) {
  const ctx = await browser.newContext({ viewport: startVp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon.ico/.test(m.location().url)) errors.push(m.text()); });
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__ev = 0; document.querySelectorAll('video').forEach((v) => ['seeking', 'emptied', 'loadstart', 'abort'].forEach((n) => v.addEventListener(n, () => { window.__ev++; }))); });

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.journey').dataset.stage === 'selected', null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const base = await page.evaluate(state);
  check(`${label}: one ArrowRight reaches a camera hold`, base.stage === 'selected' && !!base.feed, base.feed);

  let prev = base;
  for (const vp of resizes) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(700);
    const s = await page.evaluate(state);
    const tag = `${label} resize ${vp.width}x${vp.height}`;
    check(`${tag}: still the same hold`, s.stage === 'selected');
    check(`${tag}: same feed and same <video> element`, s.feed === base.feed && s.uid === base.uid, `${s.feed}`);
    check(`${tag}: video playing, not restarted`, s.paused === false && s.ct !== null && (s.ct > prev.ct || s.ct < prev.ct - 1 /* loop wrap */) && (await page.evaluate(() => window.__ev)) === 0);
    check(`${tag}: pane fills viewport`, s.pane && s.pane[0] === 0 && s.pane[1] === 0 && s.pane[2] === vp.width && s.pane[3] === vp.height, JSON.stringify(s.pane));
    check(`${tag}: selected tile anchored inside the responsive mosaic`, s.tileCx >= 0 && s.tileCx <= vp.width && s.tileCy >= 0 && s.tileCy <= vp.height, `centre ${Math.round(s.tileCx)},${Math.round(s.tileCy)}`);
    check(`${tag}: no horizontal overflow`, !s.overflow);
    prev = s;
  }

  // One intent: complete next leg; sample the contraction start so a jump/offscreen anchor would show.
  await page.evaluate(() => {
    window.__seq = [];
    const loop = () => {
      const root = document.querySelector('.journey');
      const st = root.dataset.stage;
      const last = window.__seq.at(-1);
      if (st === 'contracting' && (!last || last.stage !== 'contracting')) {
        const tile = document.querySelector(`[data-tile="${root.dataset.selected}"]`);
        const r = tile.getBoundingClientRect();
        window.__seq.push({ stage: st, tileCx: r.x + r.width / 2, tileCy: r.y + r.height / 2, vw: innerWidth, vh: innerHeight });
      } else if (!last || last.stage !== st) window.__seq.push({ stage: st });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => { const q = window.__seq; return q.length > 1 && q.at(-1).stage === 'selected'; }, null, { timeout: 12000 });
  const seq = await page.evaluate(() => window.__seq);
  const order = seq.map((x) => x.stage).filter((x, i, a) => a.indexOf(x) === i);
  const c = seq.find((x) => x.stage === 'contracting');
  check(`${label}: next leg is contract -> scan -> expand -> hold from one intent`, ['contracting', 'scanning', 'expanding', 'selected'].every((x) => order.includes(x)), order.join('>'));
  check(`${label}: contraction anchors on-screen at current responsive mosaic`, c && c.tileCx >= 0 && c.tileCx <= c.vw && c.tileCy >= 0 && c.tileCy <= c.vh, c ? `${Math.round(c.tileCx)},${Math.round(c.tileCy)} in ${c.vw}x${c.vh}` : 'no contracting');
  const fin = await page.evaluate(state);
  check(`${label}: next camera differs and plays`, fin.feed !== base.feed && fin.paused === false, fin.feed);
  check(`${label}: no overflow, no console/page errors`, !fin.overflow && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

const browser = await launch();
await run(browser, 'desktop', { width: 1280, height: 800 }, [{ width: 1000, height: 650 }, { width: 390, height: 844 }, { width: 1280, height: 800 }], false);
await run(browser, 'portrait', { width: 390, height: 844 }, [{ width: 360, height: 780 }, { width: 1180, height: 760 }, { width: 390, height: 844 }], true);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
