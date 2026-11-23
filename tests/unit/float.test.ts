import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type Branch, type Stage } from '../../src/journey/controller';
import { CITIES } from '../../src/journey/globe';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';
import {
  FLOAT_STOPS, PANE_H, PANE_W, PANEL_TAG, assignTextures, axisAt, buildBackground, companionKinds, coverDistance, panelContent, randomAt, sceneOfFeed, holdPose, inPose, movePose, outPose, paneScreenRect,
  holdOffset, panelLayout, planFloatRoute, projectNdc, slotOfFeed, stopSide, type FloatFraming,
} from '../../src/journey/floatField';

const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130'];
const ASPECTS = [390 / 844, 16 / 9, 1, 2.4];

describe('floating field: route planning', () => {
  it('every visit starts at the feed that was fullscreen, never repeats a stop, spaces stops apart', () => {
    for (const start of FEED_IDS) {
      for (let visit = 0; visit < 8; visit++) {
        for (const stops of [2, 3, 4]) {
          const plan = planFloatRoute(start, stops, visit)!;
          expect(plan).not.toBeNull();
          expect(plan.feeds.length).toBe(stops);
          expect(plan.feeds[0]).toBe(start);
          expect(new Set(plan.feeds).size).toBe(stops);
          const slots = plan.feeds.map(slotOfFeed);
          for (let i = 1; i < slots.length; i++) expect(Math.abs(slots[i] - slots[i - 1])).toBeGreaterThanOrEqual(2);
          expect(plan.framing[0]).toBe('medium'); // the shared pane arrives with room for context
          expect(plan.framing[stops - 1]).toBe('full'); // the last stop can expand to fullscreen
        }
      }
    }
  });

  it('routes go both deeper and back, and mix medium with full framing (not a fixed fly-through)', () => {
    const signs = new Set<number>(); const framings = new Set<FloatFraming>();
    for (let visit = 0; visit < 10; visit++) {
      const plan = planFloatRoute('m06', 4, visit)!;
      const slots = plan.feeds.map(slotOfFeed);
      for (let i = 1; i < slots.length; i++) signs.add(Math.sign(slots[i] - slots[i - 1]));
      plan.framing.forEach((f) => framings.add(f));
    }
    expect(signs.has(1)).toBe(true); expect(signs.has(-1)).toBe(true);
    expect(framings.size).toBe(2);
  });
});

describe('floating field: hold composition', () => {
  it('only the final stop is a centred close hold; earlier stops are offset medium holds on alternating sides when possible', () => {
    for (const start of FEED_IDS) for (let visit = 0; visit < 8; visit++) for (const stops of [2, 3, 4]) {
      const plan = planFloatRoute(start, stops, visit)!;
      expect(plan.framing.slice(0, -1).every((f) => f === 'medium')).toBe(true);
      expect(plan.framing.filter((f) => f === 'full').length).toBe(1);
      if (stops >= 3) {
        const slots = plan.feeds.map(slotOfFeed);
        for (let i = 1; i < stops - 1; i++) expect(stopSide(slots[i])).not.toBe(stopSide(slots[i - 1]));
      }
    }
  });

  it('medium holds are really offset, mirrored by side, and never overlap the pane or each other, on phone and desktop', () => {
    for (const aspect of [0.46, 0.56, 1.78, 1, 2.4]) {
      for (let slot = 0; slot <= 9; slot++) {
        const o = holdOffset('medium', aspect, slot);
        expect(Math.abs(aspect >= 1 ? o.x : o.y)).toBeGreaterThan(1);
        expect(Math.sign(aspect >= 1 ? o.x : -o.y)).toBe(stopSide(slot));
        const [a, b] = panelLayout(slot, aspect);
        const box = (p: typeof a) => ({ x0: p.dx - p.w / 2, x1: p.dx + p.w / 2, y0: p.dy - p.h / 2, y1: p.dy + p.h / 2 });
        const hit = (p: ReturnType<typeof box>, q: ReturnType<typeof box>) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
        const pane = { x0: -PANE_W / 2, x1: PANE_W / 2, y0: -PANE_H / 2, y1: PANE_H / 2 };
        expect(hit(box(a), pane)).toBe(false); expect(hit(box(b), pane)).toBe(false); expect(hit(box(a), box(b))).toBe(false);
        // companions lie on the side opposite the camera offset, i.e. beside the pane the way the camera leaves room
        const toward = aspect >= 1 ? stopSide(slot) * a.dx : -stopSide(slot) * a.dy; // positive: same side as the pane's room
        expect(toward).toBeGreaterThan(0);
      }
    }
  });

  it('adjacent stops of a visit are composed differently (side, grouping or depth)', () => {
    for (const aspect of [0.46, 1.78]) {
      const sig = (s: number) => JSON.stringify(panelLayout(s, aspect));
      for (let s = 0; s < 9; s++) expect(sig(s)).not.toBe(sig(s + 1));
      expect(new Set(Array.from({ length: 10 }, (_, s) => sig(s))).size).toBeGreaterThanOrEqual(6);
    }
  });

  it('panels stay fully inside the viewport at every medium hold, including 390x844 portrait', () => {
    for (const aspect of [390 / 844, 0.56, 1.78, 1, 2.4]) {
      for (let slot = 0; slot <= 9; slot++) {
        const { eye } = holdPose(slot, 'medium', aspect); const s = FLOAT_STOPS[slot];
        for (const sp of panelLayout(slot, aspect)) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const n = projectNdc(eye, { x: s.x + sp.dx + sx * sp.w / 2, y: s.y + sp.dy + sy * sp.h / 2, z: s.z + sp.dz }, aspect);
          expect(Math.abs(n.x)).toBeLessThanOrEqual(0.97); expect(Math.abs(n.y)).toBeLessThanOrEqual(0.97);
        }
        if (aspect < 1) { // readable: the primary companion spans at least half of a portrait screen's width
          const sp = panelLayout(slot, aspect)[0];
          const wide = projectNdc(eye, { x: s.x + sp.dx + sp.w / 2, y: s.y, z: s.z + sp.dz }, aspect).x - projectNdc(eye, { x: s.x + sp.dx - sp.w / 2, y: s.y, z: s.z + sp.dz }, aspect).x;
          expect(wide).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('floating field: geometry', () => {
  it('has a dense, asymmetric background that keeps the route corridor clear', () => {
    const bg = buildBackground(10);
    expect(bg.length).toBeGreaterThan(1200);
    for (const p of bg) {
      const [cx, cy] = axisAt(p.z);
      expect(Math.hypot((p.x - cx) / 1.25, (p.y - cy) / 0.95)).toBeGreaterThanOrEqual(27);
      expect(p.texture).toBeGreaterThanOrEqual(0); expect(p.texture).toBeLessThan(10);
    }
    expect(new Set(bg.map((p) => p.texture)).size).toBe(10);
    expect(FLOAT_STOPS.map((s) => s.z)).toEqual([...FLOAT_STOPS.map((s) => s.z)].sort((a, b) => b - a)); // stops run deeper
  });

  it('has a bounded, dense layer of small dim micro planes, clear of the focused pane and its companion panels', () => {
    const bg = buildBackground(10);
    expect(bg.length).toBeGreaterThan(2500); expect(bg.length).toBeLessThan(9000); // bounded instance count (draws stay one per texture)
    const micro = bg.filter((p) => p.micro);
    expect(micro.length).toBeGreaterThan(1500);
    expect(Math.max(...micro.map((p) => p.w))).toBeLessThan(5.3);
    expect(Math.max(...micro.map((p) => p.shade))).toBeLessThan(0.7);
    // micro layer only: nothing in the column from behind each stop to past the camera standoff overlaps pane + panels (~28 units)
    for (const s of FLOAT_STOPS) for (const p of micro) {
      if (p.z > s.z - 30 && p.z < s.z + 100) expect(Math.hypot(p.x - s.x, p.y - s.y) - p.w).toBeGreaterThan(28);
    }
    // neighbouring micro planes (consecutive in build order) rarely repeat the same picture
    let same = 0; const tail = micro;
    for (let i = 1; i < tail.length; i++) if (tail[i].texture === tail[i - 1].texture) same++;
    expect(same / tail.length).toBeLessThan(0.05);
  });

  it('companion documents follow the scene the stop actually shows: authored DEMO samples, no measured claims', () => {
    expect(companionKinds(0, 'parked-c130')[0]).toBe('checklist'); expect(companionKinds(0, 'palmdale-dc8')[0]).toBe('checklist');
    expect(companionKinds(0, 'm05')[0]).toBe('floorplan'); expect(companionKinds(0, 'docked-cargo')[0]).toBe('ledger');
    expect(companionKinds(0, 'covered-road')[0]).toBe('siteplan');
    expect(companionKinds(1, 'unknown-feed')).toEqual(companionKinds(1)); // old slot-based pair for an unknown feed
    const feeds = ['m01', 'm02', 'm05', 'm06', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'palmdale-dc8'];
    const firsts = new Set<string>();
    for (const f of feeds) for (let slot = 0; slot < 10; slot++) {
      const [k1, k2] = companionKinds(slot, f);
      expect(k1).not.toBe(k2); firsts.add(k1);
      const c = panelContent(k1, slot, sceneOfFeed(f));
      const text = [c.title, c.subtitle, ...c.rows.flat(), ...c.lines].join(' | ');
      expect(text).toMatch(/SAMPLE|TEMPLATE|SCHEMATIC|SKETCH/); // visibly a sample form, never a claimed record
      expect(text).not.toMatch(/live analysis|detected|measured|\bcount(ed)?\b: ?\d|suspect|passport/i);
    }
    expect(firsts).toEqual(new Set(['checklist', 'floorplan', 'siteplan', 'ledger']));
    expect(PANEL_TAG).toBe('DEMO');
    expect(panelContent('waveform', 2).title).toMatch(/SIMULATED/);
  });

  it('farfield pictures: neighbouring planes never repeat a picture or motif family; assignment is deterministic', () => {
    const family = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // two same-motif posters (e.g. both aircraft) + ten others
    const row = () => Array.from({ length: 60 }, (_, i) => ({ x: i * 12, y: (i % 3) * 4, z: -100 - (i % 5) * 6, w: 10, texture: 0, ry: 0, shade: 1 }));
    const hash = (a: number, b: number) => randomAt(a * 12.9898 + b * 78.233);
    const a = row(); assignTextures(a, 0, 12, family, hash);
    const b = row(); assignTextures(b, 0, 12, family, hash);
    expect(a.map((p) => p.texture)).toEqual(b.map((p) => p.texture));
    for (let i = 1; i < a.length; i++) {
      expect(a[i].texture).not.toBe(a[i - 1].texture);
      expect(family[a[i].texture]).not.toBe(family[a[i - 1].texture]);
      for (let k = 1; k <= 5 && i - k >= 0; k++) expect(a[i].texture).not.toBe(a[i - k].texture);
    }
    expect(new Set(a.map((p) => p.texture)).size).toBe(12);
  });

  it('every hold frames its pane (and, at medium, its context panels) inside the viewport on phone and desktop', () => {
    for (const aspect of ASPECTS) {
      for (const slot of [0, 3, 6, 9]) {
        for (const framing of ['full', 'medium'] as const) {
          const { eye } = holdPose(slot, framing, aspect);
          const s = FLOAT_STOPS[slot];
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const n = projectNdc(eye, { x: s.x + sx * PANE_W / 2, y: s.y + sy * PANE_H / 2, z: s.z }, aspect);
            expect(Math.abs(n.x)).toBeLessThanOrEqual(0.97); expect(Math.abs(n.y)).toBeLessThanOrEqual(0.97);
          }
          if (framing === 'medium') {
            for (const sp of panelLayout(slot, aspect)) {
              for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const n = projectNdc(eye, { x: s.x + sp.dx + sx * sp.w / 2, y: s.y + sp.dy + sy * sp.h / 2, z: s.z + sp.dz }, aspect);
                expect(Math.abs(n.x)).toBeLessThanOrEqual(0.97); expect(Math.abs(n.y)).toBeLessThanOrEqual(0.97);
              }
            }
          }
        }
      }
    }
  });

  it('the shrink starts exactly fullscreen: the pane covers the viewport at the cover distance', () => {
    for (const aspect of ASPECTS) {
      const vh = 800; const vw = vh * aspect;
      const start = inPose(4, 'medium', 0, aspect);
      expect(start.eye.z - FLOAT_STOPS[4].z).toBeCloseTo(coverDistance(aspect), 6);
      const r = paneScreenRect(start.eye, 4, vw, vh);
      expect(r.x).toBeLessThanOrEqual(0.5); expect(r.y).toBeLessThanOrEqual(0.5);
      expect(r.x + r.w).toBeGreaterThanOrEqual(vw - 0.5); expect(r.y + r.h).toBeGreaterThanOrEqual(vh - 0.5);
      expect(r.w / r.h).toBeCloseTo(16 / 9, 6); // the video's own aspect: crop in the DOM pane is the full frame
      const end = inPose(4, 'medium', 1, aspect); const hold = holdPose(4, 'medium', aspect);
      expect(end.eye.x).toBeCloseTo(hold.eye.x, 6); expect(end.eye.y).toBeCloseTo(hold.eye.y, 6); expect(end.eye.z).toBeCloseTo(hold.eye.z, 6);
      const out0 = outPose(4, 'medium', 0, aspect);
      expect(out0.eye.z).toBeCloseTo(hold.eye.z, 6);
      expect(outPose(4, 'medium', 1, aspect).eye.z).toBeCloseTo(start.eye.z, 6);
    }
  });

  it('a travel leg starts at one hold and ends exactly at the next, forwards and backwards, for every profile', () => {
    for (const aspect of ASPECTS) {
      for (const [a, b] of [[0, 3], [3, 6], [7, 4], [9, 5], [2, 4]]) {
        for (let leg = 0; leg < 8; leg++) {
          for (const [fa, fb] of [['medium', 'full'], ['full', 'medium'], ['medium', 'medium']] as const) {
            const p0 = movePose(a, fa, b, fb, 0, leg, aspect).eye; const h0 = holdPose(a, fa, aspect).eye;
            const p1 = movePose(a, fa, b, fb, 1, leg, aspect).eye; const h1 = holdPose(b, fb, aspect).eye;
            for (const k of ['x', 'y', 'z'] as const) { expect(p0[k]).toBeCloseTo(h0[k], 6); expect(p1[k]).toBeCloseTo(h1[k], 6); }
          }
        }
      }
    }
  });
});

describe('floating field: wide lateral volume (R45 B)', () => {
  const sep = (a: number, b: number) => Math.hypot(FLOAT_STOPS[a].x - FLOAT_STOPS[b].x, FLOAT_STOPS[a].y - FLOAT_STOPS[b].y);

  it('keeps slot order, feeds and depth (recorded history routes stay valid)', () => {
    expect(FLOAT_STOPS.map((s) => s.feedId)).toEqual(['parking-walk', 'covered-road', 'docked-cargo', 'm06', 'm04', 'm07', 'parked-c130', 'm01', 'm02', 'm03']);
    expect(FLOAT_STOPS.map((s) => s.z)).toEqual([-70, -190, -310, -440, -570, -700, -835, -975, -1110, -1250]);
  });

  it('every pair the planner can choose is displaced sideways by a lot (the old corridor spanned ~30-60 units)', () => {
    let sum = 0; let n = 0;
    for (let a = 0; a <= 9; a++) for (let d = 2; d <= 5; d++) {
      const b = a + d; if (b > 9) continue;
      expect(sep(a, b)).toBeGreaterThanOrEqual(55);
      sum += sep(a, b); n++;
    }
    expect(sum / n).toBeGreaterThan(150);
    const xs = FLOAT_STOPS.map((s) => s.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(260); // lateral extent of the stop groups themselves
  });

  it('the background continues far beyond the stops and any viewport, in several depth layers', () => {
    const bg = buildBackground(10);
    const xs = bg.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1400);
    const off = bg.filter((p) => { const [cx] = axisAt(p.z); return Math.abs(p.x - cx) > 100; });
    expect(off.length).toBeGreaterThan(900); // plenty of field well off the route, not just a thin corridor
    const big = bg.filter((p) => !p.micro && p.w >= 22); // dim far backdrop
    expect(big.length).toBeGreaterThan(100);
    expect(bg.length).toBeLessThan(9000); // instance budget stays bounded (one draw per poster texture)
  });

  it('no background plane at all sits in the column between a hold camera and its pane / companion cards', () => {
    for (const s of FLOAT_STOPS) for (const p of buildBackground(10)) {
      if (p.z > s.z - 30 && p.z < s.z + 100) expect(Math.hypot(p.x - s.x, p.y - s.y) - p.w * 0.5).toBeGreaterThanOrEqual(34 - 1e-9);
    }
  });

  it('a 390x844 portrait medium hold still sees field on its sides behind the focal group', () => {
    const aspect = 390 / 844;
    for (const slot of [0, 2, 4, 6, 8]) {
      const { eye } = holdPose(slot, 'medium', aspect); const s = FLOAT_STOPS[slot];
      const seen = buildBackground(10).filter((p) => {
        if (p.z >= s.z || p.z < s.z - 400) return false;
        const n = projectNdc(eye, p, aspect);
        return Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;
      });
      expect(seen.length).toBeGreaterThanOrEqual(8);
      const nx = seen.map((p) => projectNdc(eye, p, aspect).x);
      expect(Math.max(...nx) - Math.min(...nx)).toBeGreaterThan(0.8); // spread across the screen width, not one stripe
    }
  });

  it('travel between displaced groups is a smooth, bounded translation (no sharp turn, no extreme pace jump)', () => {
    for (const aspect of [390 / 844, 16 / 9]) {
      for (const [a, b] of [[0, 3], [1, 4], [2, 6], [9, 5], [7, 3], [0, 5]]) {
        for (let leg = 0; leg < 4; leg++) {
          const pts = Array.from({ length: 121 }, (_, i) => movePose(a, 'medium', b, 'full', i / 120, leg, aspect).eye);
          let len = 0; let maxStep = 0;
          for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); len += d; maxStep = Math.max(maxStep, d); }
          const direct = Math.hypot(pts[120].x - pts[0].x, pts[120].y - pts[0].y, pts[120].z - pts[0].z);
          expect(len / direct).toBeLessThan(2.2); // path through the intermediate groups stays close to direct
          expect(maxStep).toBeLessThan(len * 0.06); // no jump: no single frame carries more than a few percent of the leg
          const lateral = Math.abs(pts[120].x - pts[0].x) + Math.abs(pts[120].y - pts[0].y);
          expect(lateral).toBeGreaterThan(40); // and the leg really translates sideways
        }
      }
    }
  });
});

// ------------------------------------------------------------------ controller

const VW = 1000; const WORLD = 3000; const YEARS = 8;
const CATALOG_IDS = [...FEED_IDS, 'm05', 'palmdale-dc8']; // the controller section runs on the full twelve-feed catalog
const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: CATALOG_IDS.length, seed: 11 });
const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
const ax = yearAxis(WORLD, VW, YEARS);
const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : CATALOG_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);

function make(branches: readonly Branch[], withField = true) {
  const c: JourneyController = new JourneyController({
    worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches,
    floatPlan: withField ? planFloatRoute : undefined,
    planner: (leg) => {
      const cur = tiles.find((t) => t.id === c.state.selectedId);
      const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
      return p && { id: p.id, x: p.x };
    },
    anchorFeed: (feedId, worldX) =>
      reanchorTile({ tiles, feedIndex: CATALOG_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
    feedOfTile: feedOf,
  });
  return c;
}
const toHold = (c: JourneyController) => { for (let i = 0; i < 3000 && !isHoldStage(c.state.stage); i++) c.update(16); };
const leg = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
const trace = (c: JourneyController) => {
  const seen: Stage[] = [];
  c.subscribe((s) => { if (seen[seen.length - 1] !== s.stage) seen.push(s.stage); });
  return seen;
};
const FLOAT3: Branch[] = [{ kind: 'float', after: 2, stops: 3 }];

describe('floating field: one intent = one complete leg, then an indefinite hold', () => {
  it('shrinks the fullscreen pane into the field, visits each stop with its own intent, then expands the last pane', () => {
    const c = make(FLOAT3);
    leg(c); leg(c);
    const shared = feedOf(c.state.selectedId);
    const seen = trace(c);
    leg(c); // floatIn -> stop 0
    expect(c.state.stage).toBe('floating');
    expect(c.state.floatIdx).toBe(0);
    expect(c.state.floatFeeds[0]).toBe(shared); // the same feed/video that was fullscreen
    expect(c.state.floatFeeds.length).toBe(3);
    leg(c); expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(1);
    leg(c); expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(2);
    const lastFeed = c.state.floatFeeds[2];
    leg(c); // expand the last pane
    expect(seen).toEqual(['floatIn', 'floating', 'floatMove', 'floating', 'floatMove', 'floating', 'floatOut', 'selected']);
    expect(c.state.stage).toBe('selected');
    expect(feedOf(c.state.selectedId)).toBe(lastFeed);
    expect(c.state.progress).toBe(1); expect(c.state.eased).toBe(1);
    expect(c.state.floatFeeds.length).toBe(0);
    expect(c.state.sceneCityId).toBeNull();
  });

  it('every stop is an indefinite hold: nothing advances without a fresh intent', () => {
    const c = make(FLOAT3);
    leg(c); leg(c); leg(c);
    for (let stop = 0; stop < 3; stop++) {
      const idx = c.state.floatIdx;
      for (let i = 0; i < 7500; i++) c.update(16); // two minutes
      expect(c.state.stage).toBe('floating');
      expect(c.state.floatIdx).toBe(idx);
      if (stop < 2) leg(c);
    }
  });

  it('refuses every intent while a leg is travelling (no queueing, no skipped stop)', () => {
    const c = make(FLOAT3);
    leg(c); leg(c);
    expect(c.dispatch({ type: 'intent' })).toBe(true);
    const sequence: Stage[] = [c.state.stage]; // 'floatIn'
    const run = () => {
      for (let i = 0; i < 3000 && !isHoldStage(c.state.stage); i++) {
        expect(c.dispatch({ type: 'intent' })).toBe(false);
        c.update(16);
        if (sequence[sequence.length - 1] !== c.state.stage) sequence.push(c.state.stage);
      }
    };
    run(); // floatIn
    expect(c.state.floatIdx).toBe(0);
    for (let n = 0; n < 2; n++) { expect(c.dispatch({ type: 'intent' })).toBe(true); run(); expect(c.state.floatIdx).toBe(n + 1); }
    expect(c.dispatch({ type: 'intent' })).toBe(true); run(); // floatOut
    expect(c.state.stage).toBe('selected');
    expect(sequence).toEqual(['floatIn', 'floating', 'floatMove', 'floating', 'floatMove', 'floating', 'floatOut', 'selected']);
  });

  it('after the field the route continues like any camera hold: next leg contracts into the mosaic', () => {
    const c = make(FLOAT3);
    leg(c); leg(c); leg(c); leg(c); leg(c); leg(c); // ... exit to a camera hold
    const before = feedOf(c.state.selectedId);
    const seen = trace(c);
    leg(c);
    expect(seen[0]).toBe('contracting');
    expect(feedOf(c.state.selectedId)).not.toBe(before);
  });

  it('visits 2 to 4 stops, with a different number of holds before each branch, mixing globe and floating branches', () => {
    const route: Branch[] = [
      { kind: 'globe', after: 3 }, { kind: 'float', after: 2, stops: 2 }, { kind: 'globe', after: 4 },
      { kind: 'float', after: 3, stops: 3 }, { kind: 'float', after: 2, stops: 4 },
    ];
    const c = make(route);
    const holdsBefore: number[] = []; const kinds: string[] = []; const stopCounts: number[] = [];
    let holds = 0; let stops = 0;
    c.subscribe((s) => {
      if (s.stage === 'selected') holds++;
      if (s.stage === 'globe') { holdsBefore.push(holds); holds = 0; kinds.push('globe'); }
      if (s.stage === 'floatIn') { holdsBefore.push(holds); holds = 0; kinds.push('float'); stops = 0; }
      if (s.stage === 'floating') stops++;
      if (s.stage === 'selected' && stops > 0) { stopCounts.push(stops); stops = 0; }
    });
    for (let i = 0; i < 70; i++) leg(c);
    expect(holdsBefore.slice(0, 5)).toEqual([3, 2, 4, 3, 2]);
    expect(kinds.slice(0, 5)).toEqual(['globe', 'float', 'globe', 'float', 'float']);
    expect(new Set(holdsBefore.slice(0, 5)).size).toBeGreaterThanOrEqual(3);
    expect(stopCounts.slice(0, 3)).toEqual([2, 3, 4]);
    for (const n of stopCounts) { expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(4); }
  });

  it('keeps the globe arrival hold separate from the next intent\'s city rotation', () => {
    const c = make([{ kind: 'globe', after: 2 }, { kind: 'float', after: 2, stops: 2 }]);
    leg(c); leg(c); leg(c);
    expect(c.state.stage).toBe('globe');
    expect(c.state.destId).toBeNull();
    for (let i = 0; i < 3000; i++) c.update(16);
    expect(c.state.stage).toBe('globe');
    const seen = trace(c);
    leg(c);
    expect(seen).toEqual(['turning', 'entering', 'selected']);
    expect(c.state.sceneCityId).not.toBeNull();
  });

  it('skips a floating branch when the field is unavailable instead of stalling the route', () => {
    const c = make([{ kind: 'float', after: 2, stops: 3 }, { kind: 'globe', after: 2 }], false);
    const seen = trace(c);
    for (let i = 0; i < 12; i++) leg(c);
    expect(seen.some((s) => s === 'floatIn' || s === 'floating')).toBe(false);
    expect(seen).toContain('globe'); // the next branch still runs
  });

  it('works at a low frame rate and never leaves a hold on its own', () => {
    const c = make(FLOAT3);
    for (let n = 0; n < 6; n++) {
      c.dispatch({ type: 'intent' });
      for (let i = 0; i < 200 && !isHoldStage(c.state.stage); i++) c.update(300);
      expect(isHoldStage(c.state.stage)).toBe(true);
    }
  });
});
