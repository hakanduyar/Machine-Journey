// Real-browser lifecycle check of the REAL UniqueCatalogBoundary + Journey with a SYNTHETIC sufficient / deficient catalogue.
// Fixture only: a private Vite server (plugin in tests/e2e/uniqueFixture) aliases synthetic feeds to existing media files.
// It is NOT footage/catalogue evidence and is never part of vite.config.ts or the production build.
// Usage (repo root): node tests/e2e/uniqueResize.mjs      (local Edge or Chrome via playwright-core; no download, no artifacts)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { uniqueFixturePlugin } from './uniqueFixture/plugin.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); } catch { /* next */ }
  }
  throw new Error('No local Edge or Chrome found');
}

const SMALL = { width: 390, height: 844 };
const BIG = { width: 1440, height: 900 };

// Counts programmatic media operations per feed from page start (seek = currentTime write, load(), src write, emptied event).
const INSTRUMENT = () => {
  const ops = (window.__ops = {});
  const bump = (el, k) => { const f = el?.dataset?.feed; if (f) { (ops[f] ??= {})[k] = (ops[f][k] ?? 0) + 1; } };
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...d, set(v) { bump(this, 'seek'); d.set.call(this, v); } });
  const load = HTMLMediaElement.prototype.load;
  HTMLMediaElement.prototype.load = function () { bump(this, 'load'); return load.call(this); };
  const s = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...s, set(v) { bump(this, 'src'); s.set.call(this, v); } });
  document.addEventListener('emptied', (e) => bump(e.target, 'emptied'), true);
};

// Page-side helpers (evaluated in the page).
const SNAP = () => {
  const j = window.__journey; const s = j.state;
  const tiles = [...document.querySelectorAll('[data-tile]')];
  const tile = s.selectedId ? tiles.find((t) => t.dataset.tile === s.selectedId) : null;
  const feed = tile?.dataset.feed ?? null;
  const v = feed ? document.querySelector(`video[data-feed="${feed}"]`) : null;
  if (v && !v.__uid) v.__uid = Math.random().toString(36).slice(2);
  const w = document.querySelector('.world');
  let area = 0; let out = 0;
  const ww = parseFloat(w?.style.width ?? '0'); const wh = parseFloat(w?.style.height ?? '0');
  for (const t of tiles) {
    const l = parseFloat(t.style.left); const tp = parseFloat(t.style.top); const tw = parseFloat(t.style.width); const th = parseFloat(t.style.height);
    area += tw * th; if (l < -1 || tp < -1 || l + tw > ww + 1 || tp + th > wh + 1) out++;
  }
  return {
    stage: s.stage, id: s.selectedId, feed, year: j.selectedYear, city: s.cityId, hist: j.history,
    tiles: tiles.map((t) => t.dataset.tile), feeds: tiles.map((t) => t.dataset.feed),
    uid: v?.__uid ?? null, src: v ? v.currentSrc || v.getAttribute('src') : null, ct: v?.currentTime ?? null, paused: v?.paused ?? null,
    // Sampled together: wall-clock stamp, media duration and rate for the duration-aware continuity oracle.
    t: performance.now(), dur: v ? v.duration : null, rate: v ? v.playbackRate : null,
    ops: JSON.stringify(window.__ops?.[feed] ?? {}),
    same: window.__journey === window.__ids0.c && window.__routePlanner === window.__ids0.p && window.__feedDeck === window.__ids0.d,
    geo: { ww, wh, fill: ww && wh ? area / (ww * wh) : 0, out, vw: innerWidth },
    pendingCover: !!document.querySelector('[data-unique-pending]'), report: !!document.querySelector('[data-unique-report]'),
    inert: document.querySelector('.journey')?.hasAttribute('inert') ?? null,
    playing: [...document.querySelectorAll('video')].filter((x) => !x.paused).length,
    ctl: JSON.stringify([s.stage, s.progress, s.worldX, s.targetX, s.selectedId, s.cityId]),
    pendingIntent: !!j.pendingIntent,
  };
};

const open = async (browser, base, src, vp) => {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text() + m.location().url)) errors.push(m.text()); });
  await page.addInitScript(INSTRUMENT);
  await page.goto(`${base}tests/e2e/uniqueFixture/index.html?src=${src}`, { waitUntil: 'load' });
  await page.waitForSelector('.journey', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    // Camera legs only: this fixture exercises camera holds, not the globe / floating field / neural scene.
    for (const k of ['globe', 'float', 'neural']) window.__routePlanner.setUnavailable(k);
    window.__ids0 = { c: window.__journey, p: window.__routePlanner, d: window.__feedDeck };
  });
  return { ctx, page, errors };
};

const isHold = () => ['mosaic', 'selected'].includes(window.__journey.state.stage);
const leg = async (page, type) => {
  const before = await page.evaluate(() => window.__journey.history.cursor);
  await page.evaluate((t) => window.__journey.dispatch({ type: t }), type);
  await page.waitForFunction((b) => ['mosaic', 'selected'].includes(window.__journey.state.stage) && window.__journey.history.cursor !== b, before, { timeout: 15000 });
  await page.waitForTimeout(150);
  return page.evaluate(SNAP);
};
const settled = (page, n) => page.waitForFunction((count) => (
  document.querySelectorAll('[data-tile]').length === count && !document.querySelector('[data-unique-pending],[data-unique-report]')
  && ['mosaic', 'selected'].includes(window.__journey.state.stage)
), n, { timeout: 20000 });

// ---- Duration-aware media-time continuity oracle (pure; also exercised by negative controls before any browser launches) ----
const MIN_PLAY_INTERVAL_S = 0.3; // shorter intervals cannot show playing progress meaningfully: explicit failure, not a pass
const PAUSED_EPS_S = 0.001;      // a paused video must keep its exact position
const OVERRUN_TOL_S = 0.2;       // timer / sampling skew allowed on top of the wall-clock elapsed x rate
/**
 * a, b: samples { ct, t(ms, same clock), dur, rate, paused }. minRatio: smallest share of elapsed x rate that must have been
 * played when BOTH samples are playing (stall rejection). Returns { ok, reason }.
 */
export function mediaContinuity(a, b, { minRatio }) {
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  if (![a.ct, b.ct, a.t, b.t, a.dur, b.dur, a.rate, b.rate].every(fin)) return { ok: false, reason: 'nonfinite sample (ct/t/duration/rate)' };
  if (a.dur <= 0 || b.dur <= 0 || a.dur !== b.dur) return { ok: false, reason: `bad or changed duration ${a.dur}/${b.dur}` };
  if (a.rate <= 0 || a.rate !== b.rate) return { ok: false, reason: `bad or changed playbackRate ${a.rate}/${b.rate}` };
  if (a.ct < 0 || b.ct < 0 || a.ct > a.dur + 1e-6 || b.ct > b.dur + 1e-6) return { ok: false, reason: 'position outside [0, duration]' };
  const elapsed = (b.t - a.t) / 1000;
  if (!(elapsed > 0)) return { ok: false, reason: `non-positive elapsed ${elapsed}s` };
  if (a.paused && b.paused) {
    const d = Math.abs(b.ct - a.ct);
    return d <= PAUSED_EPS_S ? { ok: true, reason: 'paused position exact' } : { ok: false, reason: `paused drift ${d.toFixed(4)}s` };
  }
  const bothPlaying = !a.paused && !b.paused;
  if (bothPlaying && elapsed < MIN_PLAY_INTERVAL_S) return { ok: false, reason: `interval ${elapsed.toFixed(3)}s too short to judge playing progress` };
  const expected = a.rate * elapsed;
  const wrapped = b.ct < a.ct;
  const traveled = wrapped ? b.ct - a.ct + a.dur : b.ct - a.ct; // forward distance along the loop
  if (wrapped && a.ct + expected + OVERRUN_TOL_S < a.dur) return { ok: false, reason: `position went back ${a.ct.toFixed(2)}->${b.ct.toFixed(2)} but elapsed ${elapsed.toFixed(2)}s cannot reach the loop end (${a.dur.toFixed(2)}s): reset/seek` };
  if (traveled > expected + OVERRUN_TOL_S) return { ok: false, reason: `moved ${traveled.toFixed(2)}s in ${elapsed.toFixed(2)}s (max ${(expected + OVERRUN_TOL_S).toFixed(2)}s): impossible jump` };
  if (bothPlaying && traveled < minRatio * expected) return { ok: false, reason: `moved only ${traveled.toFixed(2)}s of ~${expected.toFixed(2)}s while playing: stall` };
  return { ok: true, reason: `advanced ${traveled.toFixed(2)}s of ~${expected.toFixed(2)}s${wrapped ? ' (natural wrap)' : ''}` };
}

function oracleNegativeControls() {
  console.log('--- 0. media-time oracle negative / positive controls (pure, no browser)');
  const P = (ct, t, extra = {}) => ({ ct, t, dur: 10, rate: 1, paused: false, ...extra });
  const cases = [
    ['accepts normal playing progress', P(3, 0), P(3.5, 500), true],
    ['accepts natural wrap when elapsed reaches the loop end', P(9.8, 0), P(0.3, 500), true],
    ['rejects reset away from the loop boundary (seek to start)', P(3, 0), P(0, 500), false],
    ['rejects backward jump without elapsed support', P(6, 0), P(2, 500), false],
    ['rejects impossible forward jump', P(3, 0), P(6, 500), false],
    ['rejects playing stall (no progress)', P(3, 0), P(3, 500), false],
    ['rejects playing stall (a tenth of the elapsed progress)', P(3, 0), P(3.05, 500), false],
    ['accepts paused exact position', P(3, 0, { paused: true }), P(3, 500, { paused: true }), true],
    ['rejects paused drift', P(3, 0, { paused: true }), P(3.05, 500, { paused: true }), false],
    ['rejects paused reset', P(3, 0, { paused: true }), P(0, 500, { paused: true }), false],
    ['rejects zero elapsed', P(3, 100), P(3.1, 100), false],
    ['rejects non-finite duration', P(3, 0, { dur: NaN }), P(3.5, 500, { dur: NaN }), false],
    ['rejects zero duration', P(0, 0, { dur: 0 }), P(0, 500, { dur: 0 }), false],
    ['rejects non-finite time', P(NaN, 0), P(3.5, 500), false],
    ['rejects too-short playing interval', P(3, 0), P(3.05, 50), false],
  ];
  for (const [name, a, b, expect] of cases) {
    const r = mediaContinuity(a, b, { minRatio: 0.8 });
    check(`oracle ${name}`, r.ok === expect, r.reason);
  }
}

// A sample taken at least `ms` after `a` (waits only as long as needed) so playing progress is measurable.
const snapAfter = async (page, a, ms = 450) => {
  const wait = a.t + ms - (await page.evaluate(() => performance.now()));
  if (wait > 0) await page.waitForTimeout(Math.ceil(wait));
  return page.evaluate(SNAP);
};

const sameSession = async (tag, a, b, page) => {
  check(`${tag}: controller/planner/decks identities unchanged`, b.same);
  check(`${tag}: city unchanged`, a.city === b.city, `${a.city}->${b.city}`);
  check(`${tag}: canonical tile / feed / year unchanged`, a.id === b.id && a.feed === b.feed && a.year === b.year, `${a.id} ${a.feed} ${a.year} -> ${b.id} ${b.feed} ${b.year}`);
  check(`${tag}: history kinds + cursor unchanged (redo branch intact)`, JSON.stringify(a.hist) === JSON.stringify(b.hist), `${JSON.stringify(a.hist)} -> ${JSON.stringify(b.hist)}`);
  if (a.feed) {
    check(`${tag}: same <video> DOM object`, a.uid && a.uid === b.uid);
    check(`${tag}: same source`, a.src && a.src === b.src, `${a.src} -> ${b.src}`);
    check(`${tag}: no load/emptied/re-source/programmatic seek from resize`, a.ops === b.ops, `${a.ops} -> ${b.ops}`);
    // Across the resize (may include a short pending-commit pause): progress must be plausible, never a reset / seek / impossible jump.
    const r = mediaContinuity(a, b, { minRatio: 0.25 });
    check(`${tag}: media time continuous across resize (duration/elapsed aware)`, r.ok, `${r.reason} [${a.ct}->${b.ct} over ${((b.t - a.t) / 1000).toFixed(2)}s, dur ${a.dur}, paused ${a.paused}/${b.paused}]`);
    // Steady state after the commit: no resize involved, so a playing video must make (almost) full wall-clock progress.
    const c = await snapAfter(page, b);
    const r2 = mediaContinuity(b, c, { minRatio: 0.8 });
    check(`${tag}: steady-state playback after commit (no stall, no reset; paused stays exact)`, r2.ok, `${r2.reason} [${b.ct}->${c.ct} over ${((c.t - b.t) / 1000).toFixed(2)}s, paused ${b.paused}/${c.paused}]`);
  }
};

async function mainScenario(browser, base) {
  console.log('--- A. 41 -> 78 -> shrink, synthetic sufficient catalogue, real Boundary + Journey');
  const { ctx, page, errors } = await open(browser, base, 'sufficient', SMALL);
  const trail = [];
  trail[0] = (await page.evaluate(SNAP)).id;
  trail[1] = (await leg(page, 'intent')).id;
  const h2 = await leg(page, 'intent'); trail[2] = h2.id;
  const small = h2.tiles.length;
  check('small viewport admitted (below 78, within the 60-view deficient fixture)', small > 0 && small <= 60, `tiles=${small}`);
  check('small-viewport tiles: all unique ids and unique feeds', new Set(h2.tiles).size === small && new Set(h2.feeds).size === small);
  const s0 = await leg(page, 'back'); // cursor 1 of 0..2: redo branch exists
  check('two visited holds + Back: cursor not at end', s0.hist.cursor === 1 && s0.hist.kinds.length === 3, JSON.stringify(s0.hist));
  check('Back landed on the recorded stop', s0.id === trail[1]);

  await page.setViewportSize(BIG);
  await settled(page, 78);
  const s1 = await snapAfter(page, s0, 700); // >= 0.7 s of wall clock since s0, so playing progress is measurable
  await sameSession('grow', s0, s1, page);
  check('grow: exactly 78 tiles, 78 unique ids, 78 unique feed bindings', s1.tiles.length === 78 && new Set(s1.tiles).size === 78 && new Set(s1.feeds).size === 78);
  check('grow: every small-viewport tile id still present', s0.tiles.every((t) => s1.tiles.includes(t)));
  check('grow: geometry refit (world = 3 x viewport, tiles fill it, none outside)', s1.geo.ww === s1.geo.vw * 3 && s1.geo.fill > 0.97 && s1.geo.fill < 1.03 && s1.geo.out === 0, JSON.stringify(s1.geo));

  const r2 = await leg(page, 'intent');
  check('redo after grow: exact recorded stop (not rerolled)', r2.id === trail[2] && r2.hist.cursor === 2, `${r2.id} vs ${trail[2]}`);
  const r1 = await leg(page, 'back');
  check('back after grow: exact earlier stop', r1.id === trail[1] && r1.hist.cursor === 1, `${r1.id} vs ${trail[1]}`);
  check('back/redo after grow: tile geometry resolves to real current tiles', r1.tiles.includes(r1.id) && r2.tiles.includes(r2.id));

  await page.setViewportSize(SMALL);
  await page.waitForTimeout(600);
  await settled(page, 78);
  const s2 = await snapAfter(page, r1, 700);
  await sameSession('shrink', r1, s2, page);
  check('shrink: high-water 78 retained (no 41 re-admission, no report)', s2.tiles.length === 78 && !s2.report);
  check('shrink: geometry refit to the smaller viewport', s2.geo.ww === s2.geo.vw * 3 && s2.geo.out === 0 && s2.geo.fill > 0.97 && s2.geo.fill < 1.03, JSON.stringify(s2.geo));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function midLegGrow(browser, base) {
  console.log('--- B. sufficient growth requested mid-leg: old geometry never shown uncovered; commit at the next safe hold');
  const { ctx, page, errors } = await open(browser, base, 'sufficient', SMALL);
  await leg(page, 'intent');
  const small = await page.evaluate(() => document.querySelectorAll('[data-tile]').length);
  await page.evaluate(() => {
    window.__trace = [];
    const loop = () => {
      window.__trace.push({
        stage: window.__journey.state.stage, n: document.querySelectorAll('[data-tile]').length, w: innerWidth,
        cover: !!document.querySelector('[data-unique-pending]'), report: !!document.querySelector('[data-unique-report]'),
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__journey.dispatch({ type: 'intent' });
  });
  await page.waitForTimeout(120);
  await page.setViewportSize(BIG);
  await settled(page, 78);
  const trace = await page.evaluate(() => window.__trace);
  const big = trace.filter((t) => t.w === BIG.width);
  check('resize really landed mid-leg', big.some((t) => !['mosaic', 'selected'].includes(t.stage)), `frames=${big.length}`);
  check('no frame at the new viewport shows the old (undersized) layout without the cover', big.every((t) => t.n !== small || t.cover), JSON.stringify(big.filter((t) => t.n === small && !t.cover).slice(0, 3)));
  const flip = trace.findIndex((t, i) => i > 0 && trace[i - 1].n === small && t.n === 78);
  check('geometry swap happened only at a hold', flip > 0 && ['mosaic', 'selected'].includes(trace[flip].stage), `stage=${trace[flip]?.stage}`);
  check('never an intermediate tile count', trace.every((t) => t.n === small || t.n === 78 || t.n === 0), [...new Set(trace.map((t) => t.n))].join(','));
  const end = await page.evaluate(SNAP);
  check('same session after mid-leg commit', end.same && end.tiles.length === 78 && new Set(end.feeds).size === 78 && end.geo.out === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function failedGrowth(browser, base) {
  console.log('--- C. insufficient growth (41 ok, 78 deficient) mid-leg: freeze, inert, no queue; valid 78 resumes without a time jump');
  const { ctx, page, errors } = await open(browser, base, 'deficient', SMALL);
  const a = await leg(page, 'intent');
  await page.evaluate(() => window.__journey.dispatch({ type: 'intent' }));
  await page.waitForTimeout(150);
  await page.setViewportSize(BIG);
  await page.waitForSelector('[data-unique-report]', { timeout: 5000 });
  const text = await page.evaluate(() => document.querySelector('[data-unique-report]').innerText);
  check('report names 78 required and the exact deficit (78-60=18)', /78/.test(text) && /\b18\b/.test(text), text.replace(/\s+/g, ' ').slice(0, 220));
  const f0 = await page.evaluate(SNAP);
  check('midleg: leg was in progress when frozen', !['mosaic', 'selected'].includes(f0.stage), f0.stage);
  await page.waitForTimeout(200);
  const f1 = await page.evaluate(SNAP);
  // Input attempts behind the report: nothing may queue or move.
  await page.keyboard.press('ArrowRight'); await page.mouse.wheel(0, 400); await page.waitForTimeout(1800);
  const f2 = await page.evaluate(SNAP);
  check('frozen: controller state byte-identical across 1.8 s (no hidden advance)', f1.ctl === f2.ctl, `${f1.ctl} vs ${f2.ctl}`);
  check('frozen: history unchanged, no queued intent', JSON.stringify(f1.hist) === JSON.stringify(f2.hist) && !f2.pendingIntent);
  check('frozen: no video decoding / playing', f2.playing === 0, `playing=${f2.playing}`);
  check('frozen: Journey root inert, session retained', f2.inert === true && f2.same && f2.tiles.length === a.tiles.length);
  await page.setViewportSize(SMALL);
  await page.waitForTimeout(700);
  const f3 = await page.evaluate(SNAP);
  check('shrinking does not reopen 41 admission', f3.report && f3.ctl === f2.ctl && f3.inert === true);

  // Valid 78 supplied: resume from the retained leg (old endpoint geometry), commit at the hold.
  await page.evaluate(() => {
    window.__first = null;
    const loop = () => {
      if (!document.querySelector('[data-unique-report]')) { const s = window.__journey.state; window.__first = { stage: s.stage, progress: s.progress, worldX: s.worldX }; return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__fixture.setSource('sufficient');
  });
  await page.waitForFunction(() => window.__first, null, { timeout: 5000 });
  const first = await page.evaluate(() => window.__first);
  const frozen = JSON.parse(f3.ctl);
  check('resume: continues the same leg (stage kept, no elapsed hidden-time jump)', first.stage === frozen[0] && Math.abs(first.progress - frozen[1]) < 0.15, JSON.stringify(first) + ' vs ' + f3.ctl);
  await settled(page, 78);
  const end = await page.evaluate(SNAP);
  check('resume: same session, 78 unique tiles / feeds, geometry fitted', end.same && end.tiles.length === 78 && new Set(end.feeds).size === 78 && end.geo.out === 0 && end.geo.fill > 0.97 && end.geo.fill < 1.03, JSON.stringify(end.geo));
  check('resume: history appended consistently (no reset)', end.hist.kinds.length >= f3.hist.kinds.length && end.hist.cursor >= f3.hist.cursor, JSON.stringify(f3.hist) + ' -> ' + JSON.stringify(end.hist));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function realDeficient(browser, base) {
  console.log('--- D. real production catalogue behind ?catalog=unique (no fixture plugin): still blocked, no MP4 requested');
  const ctx = await browser.newContext({ viewport: BIG });
  const page = await ctx.newPage();
  const mp4 = [];
  page.on('request', (r) => { if (/\.mp4(\?|$)/.test(r.url())) mp4.push(r.url()); });
  await page.goto(`${base}?catalog=unique`, { waitUntil: 'load' });
  await page.waitForSelector('[data-unique-report]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  check('real catalogue: capacity report shown, Journey not mounted', await page.evaluate(() => !document.querySelector('.journey') && !!document.querySelector('[data-unique-report]')));
  check('real catalogue: no MP4 requested', mp4.length === 0, mp4.join(','));
  await ctx.close();
}

oracleNegativeControls();
const fixtureServer = await createServer({
  root, configFile: false, logLevel: 'warn', plugins: [react(), uniqueFixturePlugin()],
  server: { host: '127.0.0.1', port: 3361, strictPort: false },
});
const realServer = await createServer({
  root, configFile: false, logLevel: 'warn', plugins: [react()],
  server: { host: '127.0.0.1', port: 3371, strictPort: false },
});
await fixtureServer.listen(); await realServer.listen();
const browser = await launch();
try {
  const fb = fixtureServer.resolvedUrls.local[0];
  await mainScenario(browser, fb);
  await midLegGrow(browser, fb);
  await failedGrowth(browser, fb);
  await realDeficient(browser, realServer.resolvedUrls.local[0]);
} catch (e) {
  failed++; console.log('FAIL  uncaught', e?.stack ?? e);
} finally {
  await browser.close(); await fixtureServer.close(); await realServer.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
