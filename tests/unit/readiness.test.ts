import { describe, expect, it } from 'vitest';
import { JourneyController, isHoldStage, yearAxis, type Branch, type FloatPlan } from '../../src/journey/controller';
import { FLOAT_STOPS, PANEL_TAG, panelContent, panelLayout, planFloatRoute, type PanelKind } from '../../src/journey/floatField';
import { needsDomOverlay, uploadAction, videoHasFrame, type TexState } from '../../src/journey/handoff';
import { CITIES } from '../../src/journey/globe';
import { planLeg, reanchorTile } from '../../src/journey/route';
import { generateMosaic } from '../../src/journey/layout';

describe('video texture hand-over policy', () => {
  const frame = (t: number) => ({ readyState: 4, videoWidth: 960, currentTime: t });
  const cold: TexState = { warmed: false, lastTime: -1 };

  it('does nothing until the video has a decoded frame (no black texture is ever created from an empty video)', () => {
    expect(videoHasFrame(null)).toBe(false);
    expect(videoHasFrame({ readyState: 1, videoWidth: 960, currentTime: 0 })).toBe(false);
    expect(videoHasFrame({ readyState: 4, videoWidth: 0, currentTime: 0 })).toBe(false);
    expect(uploadAction({ readyState: 1, videoWidth: 960, currentTime: 0 }, cold)).toBe('none');
    expect(uploadAction(null, cold)).toBe('none');
  });

  it('warms a texture explicitly as soon as the first frame exists, without waiting for a frame callback', () => {
    expect(uploadAction(frame(0), cold)).toBe('warm');
    expect(uploadAction(frame(37.2), cold)).toBe('warm'); // a late first frame (any currentTime) still warms
  });

  it('afterwards re-flags the upload only while currentTime advances (the video keeps playing through the hold)', () => {
    const warm: TexState = { warmed: true, lastTime: 5 };
    expect(uploadAction(frame(5), warm)).toBe('none');
    expect(uploadAction(frame(5.04), warm)).toBe('refresh');
    expect(uploadAction(frame(0.1), warm)).toBe('refresh'); // loop restart
  });

  it('keeps the shared DOM video over a hold until its texture is warm, and always during in/out bridge legs', () => {
    expect(needsDomOverlay('hold', false)).toBe(true);
    expect(needsDomOverlay('hold', true)).toBe(false);
    expect(needsDomOverlay('in', true)).toBe(true);
    expect(needsDomOverlay('out', true)).toBe(true);
    expect(needsDomOverlay('move', false)).toBe(false);
  });

  it('first settled stop sequence: overlay stays until the first upload, then hands over exactly once', () => {
    // simulate the hold frames of a stop whose video only decodes its first frame on frame 3
    const st: TexState = { warmed: false, lastTime: -1 };
    const overlays: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const v = i < 3 ? { readyState: 1, videoWidth: 0, currentTime: 0 } : frame(i * 0.033);
      const a = uploadAction(v, st);
      if (a !== 'none') { st.warmed = true; st.lastTime = v.currentTime; }
      overlays.push(needsDomOverlay('hold', st.warmed));
    }
    expect(overlays).toEqual([true, true, true, false, false, false]);
  });
});

describe('floating panel content', () => {
  const kinds: PanelKind[] = ['dossier', 'news', 'location', 'waveform'];
  const text = (k: PanelKind, slot: number) => {
    const c = panelContent(k, slot);
    return [c.title, c.subtitle, ...c.rows.flat(), ...c.lines].join(' | ');
  };

  it('every stop has authored, meaningful, distinct fictional records (no placeholder filler)', () => {
    for (const k of kinds) {
      const seen = new Set<string>();
      for (const s of FLOAT_STOPS) {
        const c = panelContent(k, s.slot);
        expect(c.title.length).toBeGreaterThan(3); expect(c.subtitle.length).toBeGreaterThan(3);
        expect(c.rows.length + c.lines.length).toBeGreaterThan(0);
        expect(text(k, s.slot)).not.toMatch(/placeholder|lorem|xxx|tbd/i);
        seen.add(text(k, s.slot));
      }
      expect(seen.size).toBeGreaterThanOrEqual(8);
    }
  });

  it('makes no claim about real people, real events or real surveillance', () => {
    for (const k of kinds) for (const s of FLOAT_STOPS) {
      expect(text(k, s.slot)).not.toMatch(/suspect|criminal|arrest|police|threat|passport|\bid number|subject/i);
    }
  });

  it('the signal panel says SIMULATED, and the single designation is short and discreet', () => {
    expect(panelContent('waveform', 3).title).toMatch(/SIMULATED/);
    expect(PANEL_TAG).toBe('DEMO');
  });

  it('every stop gets two sparse panels with different kinds', () => {
    for (const s of FLOAT_STOPS) for (const a of [0.46, 1.78]) {
      const p = panelLayout(s.slot, a);
      expect(p.length).toBe(2); expect(p[0].kind).not.toBe(p[1].kind);
    }
  });
});

describe('floating branch readiness', () => {
  const FEED_IDS = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
  const VW = 1000; const WORLD = 3000; const YEARS = 8;
  const mosaic = generateMosaic({ width: WORLD, height: 700, tileCount: 60, feedCount: FEED_IDS.length, seed: 11 });
  const tiles = mosaic.tiles.map((t) => ({ id: t.id, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, feedIndex: t.feedIndex }));
  const ax = yearAxis(WORLD, VW, YEARS);
  const feedOf = (id: string | null) => (id ? (id.startsWith('virtual:') ? id.slice(8) : FEED_IDS[tiles.find((t) => t.id === id)!.feedIndex]) : null);
  function make(branches: readonly Branch[], floatPlan: (f: string | null, s: number, v: number) => FloatPlan | 'wait' | null) {
    const c: JourneyController = new JourneyController({
      // `cities` is required for a globe branch: without them the controller (correctly) skips every globe choice.
      worldWidth: WORLD, viewportWidth: VW, travelMs: 1000, cities: CITIES, branches, floatPlan,
      planner: (leg) => {
        const cur = tiles.find((t) => t.id === c.state.selectedId);
        const p = planLeg({ tiles, vw: VW, worldW: WORLD, yearCount: YEARS, leg, prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur?.feedIndex ?? null });
        return p && { id: p.id, x: p.x };
      },
      anchorFeed: (feedId, worldX) =>
        reanchorTile({ tiles, feedIndex: FEED_IDS.indexOf(feedId), vw: VW, worldW: WORLD, yearCount: YEARS, year: Math.floor(ax.indexAt(worldX)) }),
      feedOfTile: feedOf,
    });
    return c;
  }
  const toHold = (c: JourneyController) => { for (let i = 0; i < 4000 && !isHoldStage(c.state.stage); i++) c.update(16); };
  const leg = (c: JourneyController) => { expect(c.dispatch({ type: 'intent' })).toBe(true); toHold(c); };
  const ROUTE: Branch[] = [{ kind: 'float', after: 2, stops: 3 }, { kind: 'globe', after: 2 }];

  it('an intent made while the field is still being built is kept once and runs its whole floating leg when ready', () => {
    let ready = false;
    const c = make(ROUTE, (f, s, v) => (ready ? planFloatRoute(f, s, v) : 'wait'));
    leg(c); leg(c);
    const id = c.state.selectedId;
    expect(c.dispatch({ type: 'intent' })).toBe(true); // accepted as the single pending manual intent
    expect(c.pendingIntent).toBe(true);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 100; k++) c.update(16);
      expect(c.state.stage).toBe('selected'); expect(c.state.selectedId).toBe(id); // current hold keeps showing
      expect(c.dispatch({ type: 'intent' })).toBe(false); // extra input is discarded, not queued
    }
    ready = true;
    c.update(16); // the same pending leg starts by itself, once: this is completion of the manual leg, not autoplay
    expect(c.pendingIntent).toBe(false);
    expect(c.state.stage).toBe('floatIn');
    expect(c.state.floatFeeds[0]).toBe(feedOf(id)); // same shared feed
    toHold(c);
    expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(0); // stops at the first hold
    for (let i = 0; i < 3000; i++) c.update(16);
    expect(c.state.stage).toBe('floating'); expect(c.state.floatIdx).toBe(0);
  });

  it('a failed build skips only that branch; the route continues with the next one', () => {
    const c = make(ROUTE, () => null);
    const seen: string[] = [];
    c.subscribe((s) => { if (seen[seen.length - 1] !== s.stage) seen.push(s.stage); });
    for (let i = 0; i < 10; i++) leg(c);
    expect(seen.some((s) => s === 'floatIn' || s === 'floating')).toBe(false);
    expect(seen).toContain('globe');
  });
});
