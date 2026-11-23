import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { JourneyController, frameDelta, isFloatStage, isGlobeStage, isHoldStage, isNeuralStage, yearAxis, type Stage } from './journey/controller';
import { RoutePlanner, seedFromSearch } from './journey/planner';
import { FloatField3D } from './journey/FloatField3D';
import { NeuralWorld, loadNeuralAssets, type NeuralAssets } from './journey/NeuralWorld';
import type { CameraPose } from './journey/neuralSource/travelProfile';
import { planNeuralRoute } from './journey/neuralRoute';
import { paneScreenRect, planFloatRoute, slotOfFeed } from './journey/floatField';
import { CITIES, cityById, routeArcs, routeSig, type Arc } from './journey/globe';
import { drawGlobe } from './journey/globeRender';
import { coastState, preloadCoast, type CoastGeo } from './journey/globeGeo';
import { inlandState, preloadInland, type InlandGeo } from './journey/globeInland';
import { heldRadius } from './journey/globeOut';
import { TIME_A, anchorAt, focusRect, holdScale, legTime, neuralOutRect, poseAt, radiusAt, retreatAmount, retreatNetworkOpacity, solveRetreatDolly, type Pose } from './journey/scale';
import { drawLocalField } from './journey/localField';
import { ALL_FEEDS, CORE_FEED_COUNT, FEEDS, YEARS, feedOfVirtualTile, feedPosterUrl, feedVideoUrl, isCityFeed } from './journey/feeds';
import {
  computeCrop, easeInOut, lerpCrop, lerpRect, videoBoxForCrop, type CropParams, type Rect,
} from './journey/geometry';
import { generateMosaic, tileCountFor, type Tile } from './journey/layout';import { IntentGate, keyDirection, type Dir } from './journey/intent';
import { frameCount, isDecoded, trackFrames } from './journey/frames';
import { PlaybackDriver, desiredPlayback, routeActive } from './journey/playback';
import { planLeg, reanchorTile } from './journey/route';
import { FeedDeck } from './journey/feedDeck';
import { collageStatus, loadPosters, type PosterEntry } from './journey/posterGate';

const SCREENS = 3;
const FEED_IDS = FEEDS.map((f) => f.id);
const FULL_CROP: CropParams = { z: 1, cx: 0.5, cy: 0.5 };
/** Vertical focal point shared by the globe, the mosaic pullback and the entry travel. */
const FOCAL_Y = 0.45;
/** Session seed: `?seed=` reproduces a route for review; otherwise random per session. */
const sessionSeed = () => seedFromSearch(window.location.search, () => {
  const a = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) { crypto.getRandomValues(a); return a[0]; }
  return Math.floor(Math.random() * 0x100000000);
});
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface Placed extends Tile { x: number; y: number; w: number; h: number }

declare global {
  interface Window { __journey?: JourneyController; __routePlanner?: RoutePlanner; __feedDeck?: FeedDeck }
}

/** A city clip that has not produced a decodable frame this long after its source was attached counts as failed. */
const CITY_LOAD_TIMEOUT_MS = 15000;
/**
 * The selected tile of a city-owned clip (`virtual:<feedId>`): it has no place in the core-only mosaic layout, so it is a
 * small centred stand-in at the current view. Only its feed identity is semantic; geometry is a presentation default.
 */
function virtualTileFor(id: string, centerX: number, vw: number, vh: number): Placed | undefined {
  const feedId = feedOfVirtualTile(id);
  const feedIndex = feedId ? ALL_FEEDS.findIndex((f) => f.id === feedId) : -1;
  if (feedIndex < 0) return undefined;
  const w = vw * 0.18; const h = (w * 9) / 16;
  return { id, index: -1, rect: { x: 0, y: 0, w, h }, feedIndex, crop: FULL_CROP, x: centerX - w / 2, y: vh / 2 - h / 2, w, h };
}

const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, '0');
const clock = (t: number) => `${pad(t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)}.${pad((t % 1) * 100)}`;

export function Journey() {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const gate = useRef(new IntentGate());
  const playback = useRef(new PlaybackDriver());
  const layoutRef = useRef({ w: 0, h: 0 });
  const tileEls = useRef(new Map<string, HTMLButtonElement>());
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const videoEls = useRef<(HTMLVideoElement | null)[]>([]);
  const paneEls = useRef<(HTMLDivElement | null)[]>([]);
  const manualFocus = useRef(false);
  const globeCanvas = useRef<HTMLCanvasElement>(null);
  const floatHost = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<FloatField3D | null>(null);
  const fieldFailed = useRef(false);
  const neuralHost = useRef<HTMLDivElement>(null);
  const neuralGen = useRef(0);
  const neuralRef = useRef<NeuralWorld | null>(null);
  const neuralAssets = useRef<NeuralAssets | null>(null);
  const neuralStatus = useRef<'idle' | 'loading' | 'parsed' | 'ready' | 'failed'>('idle');
  const postersRef = useRef<HTMLImageElement[] | null>(null);
  const posterEntriesRef = useRef<PosterEntry[] | null>(null);
  const collageShown = useRef(false);
  const footRef = useRef<HTMLDivElement>(null);

  /**
   * Lazy city media: the 21 city <video> elements are rendered inert (no src, preload none, no autoplay, no poster). A source
   * is attached ONCE, only when its city is the upcoming target (prewarm), entering or selected; afterwards the element keeps
   * its identity, source and playback time (never re-sourced, so no duplicate decoder). Returns the clip's readiness.
   */
  const cityAttached = useRef(new Map<number, number>());
  const attachCity = (feedId: string): 'ready' | 'wait' | 'failed' => {
    const i = ALL_FEEDS.findIndex((f) => f.id === feedId);
    if (i < 0) return 'failed';
    if (i < CORE_FEED_COUNT) return 'ready';
    const v = videoEls.current[i]; const pane = paneEls.current[i];
    if (!v) return 'wait';
    let t0 = cityAttached.current.get(i);
    if (t0 === undefined) {
      t0 = performance.now(); cityAttached.current.set(i, t0);
      const f = ALL_FEEDS[i];
      if (pane) { pane.style.backgroundImage = `url(${feedPosterUrl(f)})`; pane.style.backgroundSize = 'cover'; pane.style.backgroundPosition = 'center'; }
      v.poster = feedPosterUrl(f);
      v.preload = 'auto';
      v.src = feedVideoUrl(f);
      v.load();
    }
    if (v.error) return 'failed';
    if (v.readyState >= 2 && v.videoWidth > 0) return 'ready';
    return performance.now() - t0 > CITY_LOAD_TIMEOUT_MS ? 'failed' : 'wait';
  };
  const attachCityRef = useRef(attachCity);
  attachCityRef.current = attachCity;

  const [dims, setDims] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [layoutDims, setLayoutDims] = useState(dims);
  const [stage, setStage] = useState<Stage>('mosaic');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [entryFeedId, setEntryFeedId] = useState<string | null>(null);
  const [floatInfo, setFloatInfo] = useState<{ feeds: readonly string[]; idx: number }>({ feeds: [], idx: 0 });
  const [neuralInfo, setNeuralInfo] = useState<{ feeds: readonly string[]; idx: number }>({ feeds: [], idx: 0 });
  const [yearIdx, setYearIdx] = useState(0);
  const [announce, setAnnounce] = useState('');

  const landscape = layoutDims.w >= layoutDims.h;
  const mosaic = useMemo(
    () => generateMosaic({
      width: layoutDims.w * SCREENS, height: layoutDims.h, feedCount: FEEDS.length,
      tileCount: tileCountFor(layoutDims.w, layoutDims.h, SCREENS), seed: landscape ? 11 : 23,
    }),
    // Regenerate only when the orientation class flips; other resizes just rescale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landscape],
  );
  const placed = useMemo<Placed[]>(() => {
    const sx = (layoutDims.w * SCREENS) / mosaic.width;
    const sy = layoutDims.h / mosaic.height;
    return mosaic.tiles.map((t) => {
      const x0 = Math.round(t.rect.x * sx);
      const x1 = Math.round((t.rect.x + t.rect.w) * sx);
      const y0 = Math.round(t.rect.y * sy);
      const y1 = Math.round((t.rect.y + t.rect.h) * sy);
      return { ...t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    });
  }, [mosaic, layoutDims]);
  const placedRef = useRef(placed);
  placedRef.current = placed;

  layoutRef.current = layoutDims;
  // Varied, seeded route: which mode comes next and after how many camera holds is chosen at run time from recent history.
  const seed = useMemo(() => sessionSeed(), []);
  const planner = useMemo(() => new RoutePlanner(seed), [seed]);
  // One finite deck shared by every mode: a NEW focused camera is unseen in the current cycle (see feedDeck.ts).
  const deck = useMemo(() => new FeedDeck(FEED_IDS, seed), [seed]);
  const ctrl = useMemo(
    () => {
      const c: JourneyController = new JourneyController({
        worldWidth: layoutDims.w * SCREENS, viewportWidth: layoutDims.w,
        cities: CITIES,
        seed,
        deck,
        branchSource: planner,
        // Still being built: refuse the intent and keep the hold (the same choice stays due). Only a failed build
        // drops the mode: the planner then chooses an available alternative.
        floatPlan: (from, stops, visit) => {
          if (fieldFailed.current) { planner.setUnavailable('float'); return null; }
          // Later stops are the deck's next NEW cameras (pure preview: nothing is consumed until each hold is reached).
          const n = Math.max(2, Math.min(4, Math.round(stops)));
          return fieldRef.current ? planFloatRoute(from, stops, visit, deck.frontier([from], n - 1)) : 'wait';
        },
        // The authored neural scene is preloaded while idle. Until it is built the intent is refused (the current
        // hold stays visible); only a failed load drops the mode.
        neuralPlan: (from, stops, visit) => {
          if (neuralStatus.current === 'failed') { planner.setUnavailable('neural'); return null; }
          const w = neuralRef.current;
          const n = Math.max(2, Math.min(4, Math.round(stops)));
          return w ? planNeuralRoute(from, stops, visit, w.holds, deck.frontier([from], n - 1)) : 'wait';
        },
        neuralLegScale: (a, b, base) => neuralRef.current?.legProfile(a, b).durationScale(base) ?? 1,
        cityStatus: (feedId) => attachCityRef.current(feedId),
        travelMs: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 950,
        // City leg lands on a tile of the destination's feed (same persistent <video>), near the current year.
        anchorFeed: (feedId, worldX) => {
          const L = layoutRef.current;
          const feedIndex = FEEDS.findIndex((f) => f.id === feedId);
          if (feedIndex < 0) return null;
          const year = Math.floor(yearAxis(L.w * SCREENS, L.w, YEARS.length).indexAt(worldX));
          return reanchorTile({ tiles: placedRef.current, feedIndex, vw: L.w, worldW: L.w * SCREENS, yearCount: YEARS.length, year });
        },
        yearOfTile: (id) => {
          const L = layoutRef.current;
          const t = placedRef.current.find((x) => x.id === id);
          if (!t) return null;
          return Math.floor(yearAxis(L.w * SCREENS, L.w, YEARS.length).indexAt(t.x + t.w / 2 - L.w / 2));
        },
        feedOfTile: (id) => {
          const t = placedRef.current.find((x) => x.id === id);
          return t ? FEEDS[t.feedIndex].id : null;
        },
        // Every leg: nonmonotonic year, different feed than the one on screen.
        planner: (leg) => {
          const L = layoutRef.current;
          const tiles = placedRef.current;
          const cur = c.state.selectedId ? tiles.find((t) => t.id === c.state.selectedId) : undefined;
          const ax = yearAxis(L.w * SCREENS, L.w, YEARS.length);
          const plan = planLeg({
            tiles, vw: L.w, worldW: L.w * SCREENS, yearCount: YEARS.length, leg,
            prevYear: Math.floor(ax.indexAt(c.state.worldX)), currentFeed: cur ? cur.feedIndex : null,
            wantFeeds: deck.eligible([cur ? FEEDS[cur.feedIndex].id : null]).map((id) => FEED_IDS.indexOf(id)),
          });
          return plan ? { id: plan.id, x: plan.x } : null;
        },
      });
      return c;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // Viewport tracking. Layout is only re-fitted while in the mosaic so a selected pane never shifts.
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (stage === 'mosaic') setLayoutDims((d) => (d.w === dims.w && d.h === dims.h ? d : dims));
    else if (stage === 'selected') setLayoutDims((d) => (d.w === dims.w && d.h === dims.h ? d : dims));
  }, [dims, stage]);
  useEffect(() => { worldRef.current?.setAttribute('inert', ''); }, []);
  useEffect(() => { ctrl.setBounds(layoutDims.w * SCREENS, layoutDims.w); }, [ctrl, layoutDims]);

  // Resize / orientation change during a focused hold: the layout is refitted, so the selected
  // camera (same feed, same <video>) is re-anchored to its equivalent tile and the world is
  // re-centred on it. The next leg then contracts into the current responsive mosaic.
  const anchor = useRef({ placed, w: layoutDims.w });
  useLayoutEffect(() => {
    const prev = anchor.current;
    if (prev.placed === placed) return;
    anchor.current = { placed, w: layoutDims.w };
    const s = ctrl.state;
    if (s.stage !== 'selected' || !s.selectedId) return;
    const old = prev.placed.find((t) => t.id === s.selectedId);
    if (!old) return;
    const year = ctrl.selectedYear ?? Math.floor(yearAxis(prev.w * SCREENS, prev.w, YEARS.length).indexAt(s.worldX));
    ctrl.setBounds(layoutDims.w * SCREENS, layoutDims.w);
    const a = reanchorTile({
      tiles: placed, feedIndex: old.feedIndex, vw: layoutDims.w, worldW: layoutDims.w * SCREENS, yearCount: YEARS.length, year,
    });
    if (a) ctrl.rebase(a.id, a.x);
  }, [placed, ctrl, layoutDims]);

  // Controller -> React chrome.
  useEffect(() => {
    window.__journey = ctrl;
    window.__routePlanner = planner; // read-only review handle (seed, chosen branches); no UI
    window.__feedDeck = deck; // private diagnostics: deck.diagnostics() = finite pool size, cycle, seen / recent feeds; no UI
    let prevStage: Stage = ctrl.state.stage;
    setFocusedId(ctrl.state.focusedId);
    return ctrl.subscribe((s) => {
      setStage(s.stage);
      setSelectedId(s.selectedId);
      setFocusedId(s.focusedId);
      setDestId(s.destId);
      setSceneId(s.sceneCityId);
      setEntryFeedId(s.entryFeedId);
      setFloatInfo((p) => (p.feeds === s.floatFeeds && p.idx === s.floatIdx ? p : { feeds: s.floatFeeds, idx: s.floatIdx }));
      setNeuralInfo((p) => (p.feeds === s.neuralFeeds && p.idx === s.neuralIdx ? p : { feeds: s.neuralFeeds, idx: s.neuralIdx }));
      if (s.stage !== prevStage || s.stage === 'floating' || s.stage === 'neural') {
        if (s.stage === 'neural') {
          const n = s.neuralFeeds.length;
          const f = FEEDS.find((x) => x.id === s.neuralFeeds[s.neuralIdx]);
          gate.current.settle(performance.now());
          setAnnounce(`Neural network, stop ${s.neuralIdx + 1} of ${n}: camera ${f?.label ?? ''}. Decorative demo visualisation, not real data. Next ${s.neuralIdx < n - 1 ? 'travels on' : 'pulls back to the globe'}; back returns to the previous view.`);
          prevStage = s.stage;
          return;
        }
        if (s.stage === 'floating') {
          const n = s.floatFeeds.length;
          const f = FEEDS.find((x) => x.id === s.floatFeeds[s.floatIdx]);
          gate.current.settle(performance.now());
          setAnnounce(`Floating camera field, stop ${s.floatIdx + 1} of ${n}: camera ${f?.label ?? ''}. Panels show fictional demo content. Next ${s.floatIdx < n - 1 ? 'flies to the next camera' : 'expands this camera to fullscreen'}; back returns to the previous view.`);
          prevStage = s.stage;
          return;
        }
        const tile = placedRef.current.find((t) => t.id === s.selectedId);
        const vFeed = s.selectedId ? feedOfVirtualTile(s.selectedId) : null;
        const name = tile ? FEEDS[tile.feedIndex].label : vFeed ? ALL_FEEDS.find((f) => f.id === vFeed)?.label ?? 'camera' : 'camera';
        if (s.stage === 'selected') {
          gate.current.settle(performance.now());
          const sc = s.sceneCityId ? cityById(s.sceneCityId) : null;
          setAnnounce(`Camera ${name} open${sc ? (sc.verified ? `, source place ${sc.verified.label}` : `, archive clip named ${sc.name} by its stock publisher; not an official camera location`) : ''}. Next continues; back returns to the previous view.`);
        }
        if (s.stage === 'globe') {
          gate.current.settle(performance.now());
          setAnnounce('Globe. Next flies to another city; back returns to where you came from. Each city opens its own local archive clip; Savannah, Butlerville and Palmdale are officially documented source places, the other places are named by their stock publishers.');
        }
        if (s.stage === 'mosaic') gate.current.settle(performance.now());
        if (s.stage === 'turning') setAnnounce(s.legRev ? 'Going back: rotating the globe to where it was' : 'Rotating the globe to the next city');
        if (s.stage === 'floatIn') setAnnounce('The camera shrinks into a floating field of cameras');
        if (s.stage === 'floatMove') setAnnounce('Flying to the next camera in the field');
        if (s.stage === 'floatOut') setAnnounce('Expanding this camera to fullscreen');
        if (s.stage === 'neuralIn') setAnnounce('The camera shrinks into its screen in the neural network');
        if (s.stage === 'neuralMove') setAnnounce('Travelling through the neural network');
        if (s.stage === 'neuralOut') setAnnounce('Pulling far back to the globe');
        if (s.stage === 'scanning') setAnnounce('Travelling along the timeline');
        prevStage = s.stage;
      }
    });
  }, [ctrl]);

  const axis = useMemo(() => yearAxis(layoutDims.w * SCREENS, layoutDims.w, YEARS.length), [layoutDims]);
  /** Display-only neighbour labels each side so the ribbon fills the viewport at both ends of the world. */
  const extraYears = Math.ceil(layoutDims.w / 2 / axis.seg) + 1;

  // Render / decode loop.
  useEffect(() => {
    const root = rootRef.current!;
    const world = worldRef.current!;
    const ruler = rulerRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const snap = (x: number) => Math.round(x * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1);
    const tiles = placedRef.current;

    // Poster images persist across effect re-runs: the floating field's textures wrap these same elements.
    // They are loaded + decoded right away (see posterGate); the collage is revealed on POSTER readiness, never on video's.
    const posterEntries = (posterEntriesRef.current ??= loadPosters(FEEDS.map(feedPosterUrl), () => new Image()));
    const posters = (postersRef.current ??= posterEntries.map((p) => p.img));
    const collageStart = performance.now();
    let videoDrawn = false; // decoded-video evidence that a tile was painted (independent evidence besides posters)
    if (!collageShown.current) root.dataset.collage = 'pending';
    let idleFrames = 0;
    let holdFrames = 0;
    let boundKey = '';
    const ctxs = tiles.map((t, i) => {
      const cv = canvases.current[i];
      if (!cv) return null;
      const bw = Math.max(2, Math.min(760, Math.round(t.w * dpr)));
      const bh = Math.max(2, Math.round((t.h / t.w) * bw));
      cv.width = bw; cv.height = bh;
      return cv.getContext('2d', { alpha: false });
    });
    const lastT = tiles.map(() => -1);
    const lastF = tiles.map((): number | undefined => undefined);
    const dirty = tiles.map(() => true);
    const idIndex = new Map(tiles.map((t, i) => [t.id, i]));

    let activePane = -1;
    // Last frame of the departing pane before an outgoing globe leg: its actual tile (rect/crop) and neural screen rect.
    let lastSel: Placed | undefined;    let neuralOutStart: Rect | null = null;
    let neuralDrawn: Rect | null = null; // the departing screen's rect as drawn this frame (neuralOut)
    let neuralOutDolly: { amount: number; seam: Rect | null } | null = null;
    let coastLatch: CoastGeo | null = null;
    let inlandLatch: InlandGeo | null = null;
    let globeShown = false;
    let lastYear = -1;
    // This visit's route bundles: computed once per (anchor city, visit key), never per frame, and never rerolled.
    interface RouteMemo { k: string; arcs: readonly Arc[]; sig: string }
    let routeMemo: RouteMemo | null = null;
    const visitRoutes = (anchor: string | null, key: number) => {
      const k = `${anchor ?? ''}#${key}`;
      let memo = routeMemo;
      if (!memo || memo.k !== k) {
        const arcs = anchor ? routeArcs(anchor, key, seed) : [];
        memo = { k, arcs, sig: routeSig(arcs) };
        routeMemo = memo;
      }
      return { routes: memo.arcs, routeSig: memo.sig };
    };
    // The DOM footer's occupied band (px from the bottom), measured at a low rate: peripheral globe labels stay out of it.
    let footBand = 0; let footAt = -999;
    const footReserve = () => {
      if (frameNo - footAt >= 20 || footAt > frameNo) {
        footAt = frameNo;
        const f = footRef.current;
        if (f) footBand = Math.max(0, root.clientHeight - f.getBoundingClientRect().top + 6);
      }
      return footBand;
    };
    let lastClock = '';
    let lastWx = NaN;
    let frameNo = 0;
    let neuralTile: Placed | undefined;
    let raf = 0;
    let last = performance.now();

    const hidePane = (i: number) => {
      const p = paneEls.current[i];
      if (!p) return;
      p.style.opacity = '0'; p.style.width = '2px'; p.style.height = '2px';
      p.style.transform = 'translate3d(0,0,0)'; p.style.zIndex = '0';
    };

    const draw = (i: number) => {
      const t = tiles[i];
      const ctx = ctxs[i];
      const cv = canvases.current[i];
      if (!ctx || !cv) return;
      const v = videoEls.current[t.feedIndex];
      let src: CanvasImageSource | null = null;
      let sw = 0; let sh = 0;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        // Fresh when EITHER decoded-frame evidence or the clock moved: a plateaued currentTime must not freeze the tile.
        const fc = frameCount(v);
        if (lastT[i] === v.currentTime && lastF[i] === fc && !dirty[i]) return;
        lastT[i] = v.currentTime; lastF[i] = fc; src = v; sw = v.videoWidth; sh = v.videoHeight; videoDrawn = true;
      } else {
        const im = posters[t.feedIndex];
        if (!dirty[i]) return;
        if (posterEntries[t.feedIndex]?.state === 'failed') { // asset error: a calm dark tile, not an uninitialised canvas
          ctx.fillStyle = '#0a0d10'; ctx.fillRect(0, 0, cv.width, cv.height); dirty[i] = false; return;
        }
        if (!im.complete || !im.naturalWidth) return;
        src = im; sw = im.naturalWidth; sh = im.naturalHeight;
      }
      const c = computeCrop(t.w, t.h, sw / sh, t.crop);
      ctx.drawImage(src, c.sx * sw, c.sy * sh, c.sw * sw, c.sh * sh, 0, 0, cv.width, cv.height);
      dirty[i] = false;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = frameDelta(now, last); last = now;
      ctrl.update(dt);
      const s = ctrl.state;
      const vw = root.clientWidth; const vh = root.clientHeight;

      // Bounded desired-playback policy (see journey/playback.ts): same ten elements, never reloaded or seeked.
      const selTileNow = s.selectedId ? tiles[idIndex.get(s.selectedId) ?? -1] : undefined;
      const destFeedId = s.destId ? s.entryFeedId ?? cityById(s.destId)?.feedId : undefined;
      // City clips in use right now (open, entering, or leaving to the globe): their source is attached on first use and only
      // they may join the playing pool; every other city element stays inert.
      const selVirtual = s.selectedId ? feedOfVirtualTile(s.selectedId) : null;
      const usedCity = [selVirtual, destFeedId, s.stage === 'globeOut' || s.stage === 'contracting' ? s.outFeedId : null]
        .filter((f): f is string => isCityFeed(f));
      for (const f of usedCity) attachCityRef.current(f);
      const extra = usedCity.map((f) => ALL_FEEDS.findIndex((x) => x.id === f));
      const selFeedIdx = selTileNow ? selTileNow.feedIndex : selVirtual ? ALL_FEEDS.findIndex((x) => x.id === selVirtual) : -1;
      playback.current.apply(
        desiredPlayback({
          stage: s.stage, selectedFeed: selFeedIdx,
          targetFeed: destFeedId ? ALL_FEEDS.findIndex((f) => f.id === destFeedId) : -1,
          feedCount: ALL_FEEDS.length, coreCount: CORE_FEED_COUNT, extra, pending: ctrl.pendingIntent,
          active: routeActive({
            stage: s.stage, floatFeeds: s.floatFeeds, floatIdx: s.floatIdx, neuralFeeds: s.neuralFeeds, neuralIdx: s.neuralIdx,
            feedIds: FEED_IDS, reverse: s.legRev,
          }),
        }),
        videoEls.current, now,
      );

      const e = s.eased;
      const globeStage = isGlobeStage(s.stage);
      const floatStage = isFloatStage(s.stage);
      const neuralStage = isNeuralStage(s.stage);
      const globeHold = s.stage === 'globe' || s.stage === 'turning';
      const focalY = vh * FOCAL_Y;
      const wx = snap(s.worldX);
      const sel = s.selectedId ? tiles[idIndex.get(s.selectedId) ?? -1] ?? virtualTileFor(s.selectedId, wx + vw / 2, vw, vh) : undefined;
      // ONE spatial scale for every globe leg, both directions: leg time T (0 = fullscreen / start pane, 1 = globe hold)
      // gives the log zoom m of the camera-network world; the geography uses the very same m (see journey/scale.ts).
      const worldW = layoutDims.w * SCREENS; const worldH = layoutDims.h;
      const r0 = heldRadius(vw, vh);
      const mHold = holdScale(r0, worldW);
      const T = legTime(s.stage, s, s.globeLeg);
      const pose: Pose | null = T === null ? null : poseAt(T, mHold);
      const inZoom = pose !== null && pose.sector === 'zoom';
      const focal = { x: vw / 2, y: focalY };
      const hudH = pose ? (s.stage === 'neuralOut' ? 1 - smooth(0, 0.25, T ?? 0) : pose.e) : floatStage ? 1 : neuralStage ? 1 : e;
      root.style.setProperty('--p', (pose ? Math.max(hudH, smooth(0.75, 1, pose.zeta)) : floatStage || neuralStage ? 1 : globeHold ? 1 : e).toFixed(4));
      root.style.setProperty('--h', hudH.toFixed(4));
      frameNo++;

      // Preload the authored neural scene while idle in holds: parse (async), then build once in a hold, never mid-leg.
      if (isHoldStage(s.stage)) {
        holdFrames++;
        if (holdFrames === 30) void preloadCoast(import.meta.env.BASE_URL); // accurate coastline, well before the first globe
        if (holdFrames === 90) void preloadInland(import.meta.env.BASE_URL); // inland detail follows, same latch policy
        if (neuralStatus.current === 'idle' && holdFrames > 40) {
          neuralStatus.current = 'loading';
          const gen = neuralGen.current;
          loadNeuralAssets(import.meta.env.BASE_URL).then(
            (a) => { if (gen === neuralGen.current) { neuralAssets.current = a; neuralStatus.current = 'parsed'; } },
            () => { if (gen === neuralGen.current) neuralStatus.current = 'failed'; },
          );
        } else if (neuralStatus.current === 'parsed' && neuralAssets.current && neuralHost.current) {
          try {
            neuralRef.current = new NeuralWorld(neuralAssets.current, {
              host: neuralHost.current, feedIds: FEEDS.map((f) => f.id), videos: () => videoEls.current,
            });
            neuralStatus.current = 'ready';
          } catch { neuralStatus.current = 'failed'; }
        }
      }

      // Build the floating-field renderer once, while idle in a hold (never mid-leg), so the branch has no first-use hitch.
      if (!fieldRef.current && !fieldFailed.current && floatHost.current && isHoldStage(s.stage) && ++idleFrames > 20) {
        try {
          fieldRef.current = new FloatField3D({
            host: floatHost.current,
            feedIds: FEEDS.map((f) => f.id),
            videos: () => videoEls.current,
            posters,
            labels: FEEDS.map((f) => f.label),
          });
        } catch { fieldFailed.current = true; }
      }
      root.dataset.p = s.progress.toFixed(3);
      // Every spatial globe bridge pose (both directions, history reverse included) shows an independent camera field,
      // not the archive: the year ribbon is hidden there (ordinary mosaic / scan keep it; the selected-year HUD is separate).
      const bridge = pose !== null ? '1' : '0';
      if (root.dataset.bridge !== bridge) root.dataset.bridge = bridge;

      ruler.style.transform = `translate3d(${-wx}px,0,0)`;

      // Camera pane: the one persistent <video> of a feed, either following tile -> fullscreen
      // (mosaic selection) or growing out of the destination city (globe entry).
      let paneFeed = -1;
      let paneRect: Rect | null = null;
      let paneCrop: CropParams = FULL_CROP;
      let paneOpacity = 1;

      // Floating field (three.js). In / out legs: the SAME fullscreen <video> pane is the DOM overlay and is
      // placed exactly over the projected field pane, so it visibly shrinks to / grows from its place in the field.
      const field = fieldRef.current;
      let floatFeed = -1;
      let floatRect: Rect | null = null;
      let floatHold = false;
      if (field && floatStage && s.floatFeeds.length) {
        const feeds = s.floatFeeds; const fr = s.floatFraming; const idx = s.floatIdx;
        // Spatial slot is separate from feed identity: the visit's planned slot, else the feed's own (older recorded plans).
        const slotAt = (i: number) => s.floatSlots[i] ?? slotOfFeed(feeds[i]);
        const bindings = feeds.map((fd, i) => ({ slot: slotAt(i), feedIndex: FEED_IDS.indexOf(fd) }));
        const last = feeds.length - 1;
        const mode = s.stage === 'floatIn' ? 'in' : s.stage === 'floatMove' ? 'move' : s.stage === 'floatOut' ? 'out' : 'hold';
        const a = mode === 'in' ? 0 : mode === 'out' ? last : idx;
        const b = mode === 'move' ? idx + 1 : a;
        const overlay = mode === 'in' || mode === 'out' ? slotAt(a) : -1;
        // At a hold the shared DOM video stays over the pane until the field's texture of that very video has a decoded
        // frame uploaded (`res.overlay`); only then is the DOM pane hidden.
        const res = field.render({
          mode, slotA: slotAt(a), framingA: fr[a], slotB: slotAt(b), framingB: fr[b], f: s.floatP, leg: idx, overlaySlot: overlay,
          panelSlots: fr.flatMap((f, i) => (f === 'medium' ? [slotAt(i)] : [])), bindings, vw, vh,
        });
        field.setVisible(true);
        floatHold = res.overlay < 0;
        if (res.overlay >= 0) {
          floatRect = paneScreenRect(res.eye, res.overlay, vw, vh);
          floatFeed = FEEDS.findIndex((f) => f.id === feeds[a]);
        } else {
          floatFeed = FEEDS.findIndex((f) => f.id === feeds[idx]);
        }
      } else field?.setVisible(false);

      // Neural scene: the authored camera is evaluated at exactly the time the controller asks for. In: the SAME
      // fullscreen <video> pane shrinks onto its own authored screen; the screen then shows that video as a texture.
      const nw = neuralRef.current;
      let neuralRect: Rect | null = null;
      let neuralFeed = -1;
      neuralDrawn = null;
      let neuralClockFeed = -1;
      if (nw && neuralStage && s.neuralFeeds.length) {
        const feeds = s.neuralFeeds; const anchors = s.neuralAnchors; const times = s.neuralTimes; const idx = s.neuralIdx;
        const key = `${feeds.join('|')}#${anchors.join(',')}`;
        if (boundKey !== key) {
          nw.bind(feeds.map((f, i) => ({ anchor: anchors[i], feedIndex: FEEDS.findIndex((x) => x.id === f) })));
          boundKey = key;
        }
        const last = feeds.length - 1;
        let time = times[idx] ?? 0; let dolly = 0; let pose: CameraPose | undefined;
        if (s.stage === 'neuralIn') {
          time = times[0];
          // Prep of the first leg's pose table mid-entry (once, cached), so the first move frame does not pay for it.
          if (times.length > 1 && s.neuralP > 0.3) nw.legProfile(times[0], times[1]);
        } else if (s.stage === 'neuralMove') {
          const prof = nw.legProfile(times[idx], times[idx + 1]);
          time = prof.timeAt(s.neuralP); pose = prof.poseAt(s.neuralP); // direct endpoint-to-endpoint camera, no intermediate authored visit
        }
        else if (s.stage === 'neuralOut') {
          time = times[last];
          // Calibrated once per leg (a function of the authored geometry only, so forward and reversed agree): the pull-back
          // that leaves the departing screen at RETREAT_SEAM_RATIO of its held width, and that rect (the seam).
          if (!neuralOutDolly) {
            const widthAt = (d: number) => nw.projectFrame({ time, dolly: d, vw, vh }, anchors[last])?.w ?? 0;
            const amount = solveRetreatDolly(widthAt);
            neuralOutDolly = { amount, seam: nw.projectFrame({ time, dolly: amount, vw, vh }, anchors[last]) };
          }
          neuralOutStart = neuralOutDolly.seam;
          dolly = neuralOutDolly.amount * retreatAmount(s.neuralP); // complete exactly at the tile-sector end (TIME_A)
        }
        if (s.stage === 'neural' && idx < last) nw.legProfile(times[idx], times[idx + 1]); // next leg's table, built during the hold
        // neuralOut: the departing screen is projected INSIDE the very transform the network is drawn with, so the DOM pane follows it.
        // Past the seam (TIME_A) the DOM pane alone owns the focal screen's pixels; before it, the drawn mesh IS the pane's rect.
        nw.render({
          time, dolly, vw, vh, pose, project: s.stage === 'neuralOut' ? [anchors[last]] : undefined,
          hideAnchor: s.stage === 'neuralOut' && s.neuralP > TIME_A ? anchors[last] : undefined,
        });
        neuralDrawn = s.stage === 'neuralOut' ? nw.drawnRect(anchors[last]) : null;
        nw.setVisible(true, s.stage === 'neuralOut' ? retreatNetworkOpacity(s.neuralP) : 1); // gives way to the regional field around the same pane
        if (s.stage === 'neuralIn') {
          const target = nw.screenRect(anchors[0], vw, vh) ?? { x: vw * 0.3, y: vh * 0.3, w: vw * 0.4, h: vh * 0.4 };
          neuralRect = lerpRect({ x: 0, y: 0, w: vw, h: vh }, target, easeInOut(s.neuralP));
          neuralFeed = FEEDS.findIndex((f) => f.id === feeds[0]);
        } else if (s.stage === 'neural' && !nw.isWarm(FEEDS.findIndex((f) => f.id === feeds[idx]))) {
          // Hold reached but the screen's video texture has no uploaded frame yet: keep the shared DOM video over it.
          const target = nw.screenRect(anchors[idx], vw, vh);
          if (target) { neuralRect = target; neuralFeed = FEEDS.findIndex((f) => f.id === feeds[idx]); }
        } else {
          neuralClockFeed = FEEDS.findIndex((f) => f.id === feeds[s.stage === 'neuralOut' ? last : idx]);
        }
      } else if (nw) {
        nw.setVisible(false);
        nw.release(); boundKey = '';
      }

      if (sel) lastSel = sel;
      // The seam rect / pull-back calibration belong to one neuralOut leg (see the neuralOut branch above).
      if (s.stage !== 'neuralOut') { neuralOutStart = null; neuralOutDolly = null; }

      if (s.stage !== 'neuralOut') neuralTile = undefined;
      else if (!neuralTile) {
        // The mosaic tile of the departing feed nearest the view: the neural pane's place in the regional field.
        const fi = FEEDS.findIndex((f) => f.id === s.outFeedId);
        let best = Infinity;
        for (const t of tiles) {
          const d = Math.abs(t.x + t.w / 2 - (s.worldX + vw / 2));
          if (t.feedIndex === fi && d < best) { best = d; neuralTile = t; }
        }
      }

      // Globe legs, both directions: the SAME fullscreen pane is the selected camera's tile of the regional network at
      // one geographic place. Its start rect (fullscreen / neural screen) lerps to the tile, then the whole world zooms
      // on ONE log scale m: the DOM tiles, the repeated thumbnail field and the geography (canvas, same m) agree.
      let tile: Placed | undefined;
      let a1 = { x: 0, y: 0 };
      let startRect: Rect = { x: 0, y: 0, w: vw, h: vh };
      let anchor = focal;
      if (pose) {
        const feedIdx = s.stage === 'entering'
          ? ALL_FEEDS.findIndex((f) => f.id === (s.destId ? s.entryFeedId ?? cityById(s.destId)?.feedId : undefined))
          : ALL_FEEDS.findIndex((f) => f.id === s.outFeedId);
        tile = s.stage === 'entering' ? (s.entryTileId ? tiles[idIndex.get(s.entryTileId) ?? -1] : undefined)
          : s.stage === 'neuralOut' ? neuralTile : sel ?? lastSel;
        if (s.stage === 'neuralOut' && feedIdx >= 0) { // the pane's field tile IS the seam rect (never an arbitrary mosaic tile)
          const sr = neuralOutStart ?? { x: vw * 0.3, y: vh * 0.3, w: vw * 0.4, h: vh * 0.4 };
          tile = { id: '', index: -1, rect: { x: 0, y: 0, w: sr.w, h: sr.h }, feedIndex: feedIdx, crop: FULL_CROP, x: sr.x, y: sr.y, w: sr.w, h: sr.h };
        } else if (!tile && feedIdx >= 0) { // no mosaic tile to stand for the camera (layout changed mid-leg): a stand-in at the view
          const tw = vw * 0.18; const th = (tw * 9) / 16;
          tile = { id: '', index: -1, rect: { x: 0, y: 0, w: tw, h: th }, feedIndex: feedIdx, crop: FULL_CROP, x: wx + vw / 2 - tw / 2, y: vh / 2 - th / 2, w: tw, h: th };
        }
        if (s.stage === 'neuralOut') {
          startRect = neuralOutStart ?? { x: vw * 0.3, y: vh * 0.3, w: vw * 0.4, h: vh * 0.4 };
          a1 = { x: startRect.x + startRect.w / 2, y: startRect.y + startRect.h / 2 };
        } else a1 = focal; // final focus of a camera bridge: the shared focal point, not the tile's arbitrary mosaic position
        anchor = anchorAt(pose, a1, focal);
      }
      const spatialTile = pose && tile ? tile : undefined;

      // World (mosaic DOM tiles): lateral scroll, the neighbours' push/blur while a pane travels, and the shared zoom.
      world.style.zIndex = pose ? '3' : ''; // over the globe canvas while zooming: the canvas is the ground beneath it
      if (floatStage || (neuralStage && !pose)) {
        world.style.visibility = 'hidden';
      } else if (pose || globeHold) {
        // Globe bridges (both directions): the contiguous mosaic world is NEVER shown. The independent free camera field
        // (drawn on the globe canvas, see drawLocalField) surrounds the one real focal pane instead.
        world.style.visibility = 'hidden';
      } else if (sel && s.progress > 0) {
        const scale = 1 + 0.2 * e * e;
        world.style.transformOrigin = `${sel.x + sel.w / 2}px ${sel.y + sel.h / 2}px`;
        world.style.transform = `translate3d(${-wx}px,0,0) scale(${scale.toFixed(4)})`;
        world.style.filter = `blur(${(e * 3.5).toFixed(2)}px) brightness(${(1 - 0.55 * e).toFixed(3)})`;
        world.style.visibility = s.stage === 'selected' ? 'hidden' : 'visible';
        world.style.opacity = '1';
      } else {
        world.style.transform = `translate3d(${-wx}px,0,0)`;
        world.style.filter = s.stage === 'scanning' ? `blur(${(3.2 * Math.sin(Math.PI * s.scanP)).toFixed(2)}px)` : 'none';
        world.style.visibility = 'visible';
        world.style.opacity = '1';
      }

      if (spatialTile && pose) {
        paneFeed = spatialTile.feedIndex;
        // neuralOut: through the tile sector the pane IS the network's drawn projection; from the seam (T = TIME_A) it is a
        // synthetic field tile of exactly the seam's size/centre/crop riding the shared zoom (see neuralOutRect).
        const outPane = s.stage === 'neuralOut';
        paneRect = outPane
          ? neuralOutRect(T ?? 0, mHold, neuralDrawn, startRect, focal)
          : focusRect(pose, spatialTile.w, spatialTile.h, a1, focal, startRect);
        if (outPane) {
          paneCrop = FULL_CROP;
          if (pose.sector !== 'tile') paneOpacity = smooth(1.2, 4, Math.min(paneRect.w, paneRect.h));
        } else if (pose.sector === 'tile') {
          paneCrop = lerpCrop(spatialTile.crop, FULL_CROP, pose.e);
        } else {
          paneCrop = spatialTile.crop;
          paneOpacity = smooth(1.2, 4, Math.min(paneRect.w, paneRect.h)); // the one real video; it dissolves only once it is a speck
        }
      } else if (floatRect && floatFeed >= 0) {
        paneFeed = floatFeed; paneRect = floatRect; paneCrop = FULL_CROP;
      } else if (neuralRect && neuralFeed >= 0) {
        paneFeed = neuralFeed; paneRect = neuralRect; paneCrop = FULL_CROP;
      } else if (sel && s.progress > 0) {
        paneFeed = sel.feedIndex;
        const from: Rect = { x: sel.x - wx, y: sel.y, w: sel.w, h: sel.h };
        paneRect = lerpRect(from, { x: 0, y: 0, w: vw, h: vh }, e);
        paneCrop = lerpCrop(sel.crop, FULL_CROP, e);
      }
      if (paneFeed >= 0 && paneRect) {
        if (activePane !== paneFeed) { if (activePane >= 0) hidePane(activePane); activePane = paneFeed; }
        const pane = paneEls.current[activePane];
        const video = videoEls.current[activePane];
        if (pane && video) {
          const r = paneRect;
          const aspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
          const crop = computeCrop(r.w, r.h, aspect, paneCrop);
          const box = videoBoxForCrop(r.w, r.h, crop);
          pane.style.opacity = paneOpacity.toFixed(3); pane.style.zIndex = '5';
          pane.style.transform = `translate3d(${r.x}px,${r.y}px,0)`;
          pane.style.width = `${r.w}px`; pane.style.height = `${r.h}px`;
          // Promote the incoming focal feed only with decoded-frame evidence; until then the pane's own poster shows
          // (never a black plane). The same persistent element is revealed in place: no reload, seek or remount.
          const shown = isDecoded(video) ? 'visible' : 'hidden';
          if (video.style.visibility !== shown) video.style.visibility = shown;
          video.style.width = `${box.w}px`; video.style.height = `${box.h}px`;
          video.style.transform = `translate3d(${box.x}px,${box.y}px,0)`;
          const txt = clock(video.currentTime);
          if (txt !== lastClock && clockRef.current) { clockRef.current.textContent = txt; lastClock = txt; }
        }
      } else if (activePane >= 0) {
        hidePane(activePane); activePane = -1;
      }
      const clockFeed = floatHold && floatFeed >= 0 ? floatFeed : neuralClockFeed;
      if (clockFeed >= 0) {
        const fv = videoEls.current[clockFeed];
        const txt = fv ? clock(fv.currentTime) : '';
        if (fv && txt !== lastClock && clockRef.current) { clockRef.current.textContent = txt; lastClock = txt; }
      }

      // Globe: geography, luminous city points, restrained arcs; during a leg it is the ground under the zooming world,
      // at the SAME scale (radius = m * earth radius in mosaic px), centred where the selected camera's tile sits.
      const gc = globeCanvas.current;
      if (gc) {
        // The field's ONE shared projector: its unit is the focal pane's current screen width, so the independent panes
        // scale, translate and stay anchored exactly with the real video pane from fullscreen to the globe hold.
        const fieldPose = pose && spatialTile && paneRect
          ? { cx: paneRect.x + paneRect.w / 2, cy: paneRect.y + paneRect.h / 2, unit: paneRect.w, aspect: paneRect.h / Math.max(1, paneRect.w) }
          : null;
        const tileField = pose !== null && pose.sector === 'tile' && fieldPose !== null;
        if (inZoom || globeHold || tileField) {
          const W = Math.round(vw * dpr); const H = Math.round(vh * dpr);
          if (gc.width !== W || gc.height !== H) { gc.width = W; gc.height = H; }
          const gctx = gc.getContext('2d');
          if (gctx && tileField && fieldPose && pose) {
            // Fullscreen / neural screen -> near cluster: no geography yet (the earth is far larger than the view); the
            // free panes emerge around the shrinking real pane.
            gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gctx.clearRect(0, 0, vw, vh);
            drawLocalField(gctx, vw, vh, { worldW, worldH, tiles, canvases: canvases.current }, { ...fieldPose, alpha: smooth(0, 0.25, 1 - pose.e) });
            gc.style.visibility = 'visible';
          } else if (gctx) {
            gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // Geography is chosen once per visit (when the globe appears): it never swaps mid-hold.
            if (!globeShown) { coastLatch = coastState().geo; inlandLatch = inlandState().geo; globeShown = true; }
            const regional = inZoom && fieldPose
              ? (c: CanvasRenderingContext2D) => drawLocalField(c, vw, vh, { worldW, worldH, tiles, canvases: canvases.current }, fieldPose)
              : undefined;
            drawGlobe(gctx, {
              coast: coastLatch, inland: inlandLatch,
              w: vw, h: vh, cx: inZoom ? anchor.x : focal.x, cy: inZoom ? anchor.y : focal.y,
              radius: inZoom && pose ? radiusAt(pose.m, worldW) : r0,
              lon: s.lon, lat: s.lat, alpha: 1,
              destId: s.destId, time: now, under: regional, reserveBottom: footReserve(),
              ...visitRoutes(s.outCityId, s.routeKey),
            });
            gc.style.visibility = 'visible';
          }
        } else if (gc.style.visibility !== 'hidden') {
          gc.getContext('2d')?.clearRect(0, 0, gc.width, gc.height);
          gc.style.visibility = 'hidden';
          globeShown = false;
        }
      }

      // Mosaic tiles: shared decoders painted into small canvases (only visible ones). While the world is zoomed out the
      // whole field is wanted (it is repeated around), but tiny tiles refresh at a lower rate and only if still legible.
      const zoomPaint = inZoom && pose !== null && pose.m * worldW >= 12;
      const tilesWanted = pose ? pose.sector === 'tile' || zoomPaint : s.stage !== 'selected' && !floatStage && !neuralStage && !globeStage;
      if (tilesWanted) {
        const wide = zoomPaint || s.stage === 'neuralOut' || pose !== null; // every bridge pane samples any tile, so keep them all painted
        const lo = wide ? -Infinity : wx - vw * 0.3; const hi = wide ? Infinity : wx + vw * 1.3;
        const stride = zoomPaint && pose ? (pose.m < 0.12 ? 4 : pose.m < 0.3 ? 2 : 1) : pose ? 2 : 1;
        const zt = zoomPaint && spatialTile ? spatialTile : null;
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i];
          if (t.x + t.w < lo || t.x > hi) continue;
          if (stride > 1 && (frameNo + i) % stride !== 0) continue;
          if (zt && pose) { // off-screen in the zoomed frame (the block repeats around it, from the same canvases): skip
            const sx = anchor.x + pose.m * (t.x - zt.x - zt.w / 2); const sy = anchor.y + pose.m * (t.y - zt.y - zt.h / 2);
            // Off-screen tiles still feed the scattered thumbnails, so they keep refreshing, just less often.
            if (sx > vw + 4 || sy > vh + 4 || sx + t.w * pose.m < -4 || sy + t.h * pose.m < -4) { if ((frameNo + i) % 3 === 0) draw(i); continue; }
          }
          draw(i);
        }
      }

      // Collage reveal: once every poster has settled (or the bounded wait elapsed) and the tiles above were painted from them.
      // "Painted": every tile of the first view has its poster (or video frame / failure fill) on its canvas.
      const painted = tiles.every((t, i) => !dirty[i] || t.x + t.w < wx - vw * 0.3 || t.x > wx + vw * 1.3);
      if (!collageShown.current && (tilesWanted || s.stage !== 'mosaic')) {
        // Never reveals a blank grid: a timeout only changes the cover's message; late posters / frames still complete it.
        const st = collageStatus(posterEntries.map((p) => p.state), now - collageStart, painted, videoDrawn);
        if (st === 'ready') { collageShown.current = true; root.dataset.collage = 'ready'; }
        else if (root.dataset.cstatus !== st) root.dataset.cstatus = st;
      }

      // Axis state bound to lateral world position.
      if (wx !== lastWx) {
        lastWx = wx;
        const yi = Math.floor(axis.indexAt(s.worldX));
        if (yi !== lastYear) { lastYear = yi; setYearIdx(yi); }
        if (!manualFocus.current && s.stage === 'mosaic') {
          const cx = s.worldX + vw / 2; const cy = vh / 2;
          const hit = tiles.find((t) => cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h);
          if (hit && hit.id !== s.focusedId) ctrl.dispatch({ type: 'focus', id: hit.id });
        }
      }
    };
    // A hidden tab suspends rAF; resume from "now" instead of integrating the hidden gap.
    // On return, re-assert the INTENDED play policy (the frame loop applies it next frame; this only clears refusal
    // back-off) and re-warm GL textures so promotion is re-confirmed. One shot per return: no timer, no polling.
    const onVis = () => {
      last = performance.now();
      if (document.visibilityState === 'hidden') return;
      playback.current.unlock();
      fieldRef.current?.rewarm();
      neuralRef.current?.rewarm();
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis); };
  }, [ctrl, axis, placed, seed]);

  // Free the floating field's GL resources on unmount only. This never touches the shared <video> elements.
  useEffect(() => () => {
    fieldRef.current?.dispose(); fieldRef.current = null;
    neuralGen.current++; // a load still in flight from this mount is ignored
    neuralRef.current?.dispose(); neuralRef.current = null;
    neuralAssets.current = null; neuralStatus.current = 'idle';
  }, []);

  // A user gesture only clears the play back-off: the frame loop then plays what the policy WANTS. It never starts
  // hidden videos (a settled globe or a selected camera stays at one / zero playing decoders).
  useEffect(() => {
    const unlock = () => playback.current.unlock();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Manual input: wheel, ArrowRight/Enter/Space, or a swipe each request ONE complete leg.
  // Anything arriving mid-leg is discarded and momentum cannot skip a hold (see IntentGate).
  useEffect(() => {
    const root = rootRef.current!;
    // While one intent waits for its mode, input is locked so wheel momentum / repeats cannot fire a second one.
    const locked = () => !isHoldStage(ctrl.state.stage) || ctrl.pendingIntent;
    const go = (dir: Dir) => { if (dir !== 0) ctrl.dispatch({ type: dir > 0 ? 'intent' : 'back' }); };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      go(gate.current.wheelDir(ev.timeStamp, ev.deltaX, ev.deltaY, locked()));
    };
    root.addEventListener('wheel', onWheel, { passive: false });

    let start: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      start = { x: ev.clientX, y: ev.clientY };
      gate.current.pointerDown(ev.timeStamp, locked());
    };
    const onUp = (ev: PointerEvent) => {
      const d = start; start = null;
      if (!d) return;
      go(gate.current.swipeDir(ev.timeStamp, ev.clientX - d.x, ev.clientY - d.y, locked()));
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', () => { start = null; });

    const onKey = (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (keyDirection(ev.key) === 0) return;
      ev.preventDefault();
      go(gate.current.keyDir(ev.timeStamp, ev.key, ev.repeat, locked()));
    };
    window.addEventListener('keydown', onKey);
    // Focus must never scroll the clipped stage.
    const onScroll = () => { root.scrollLeft = 0; root.scrollTop = 0; };
    root.addEventListener('scroll', onScroll);
    root.focus({ preventScroll: true });
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('scroll', onScroll);
    };
  }, [ctrl]);

  const selTile = placed.find((t) => t.id === selectedId);
  const focusTileData = placed.find((t) => t.id === focusedId);
  const selVirtualFeed = selectedId ? feedOfVirtualTile(selectedId) : null; // a city-owned clip open on its virtual tile
  const selFeed = selTile ? FEEDS[selTile.feedIndex] : selVirtualFeed ? ALL_FEEDS.find((f) => f.id === selVirtualFeed) ?? null : null;
  const selYear = selTile
    ? YEARS[ctrl.selectedYear ?? Math.floor(axis.indexAt(selTile.x + selTile.w / 2 - layoutDims.w / 2))]
    : null;
  const destCity = destId ? cityById(destId) : null;
  const destFeed = destCity ? ALL_FEEDS.find((f) => f.id === (entryFeedId ?? destCity.feedId)) ?? null : null;
  const entering = stage === 'entering';
  // The scenario city is the destination while flying in, then the one the open camera was reached through.
  const scenario = entering ? destCity : stage === 'selected' && sceneId ? cityById(sceneId) : null;
  const floating = isFloatStage(stage);
  const floatFeed = floating ? FEEDS.find((f) => f.id === floatInfo.feeds[floatInfo.idx]) ?? null : null;
  const neural = isNeuralStage(stage);
  const neuralFeed = neural ? FEEDS.find((f) => f.id === neuralInfo.feeds[neuralInfo.idx]) ?? null : null;
  // A reversed globe leg re-enters the camera it left (its recorded feed), not necessarily the demo city's own feed.
  const enterFeed = entering && ctrl.state.legRev ? ALL_FEEDS.find((f) => f.id === ctrl.state.outFeedId) ?? destFeed : destFeed;
  const hudFeed = entering ? enterFeed : floating ? floatFeed : neural ? neuralFeed : selFeed;
  const globeNoteOpen = stage === 'globe' || stage === 'turning';

  return (
    <div className="journey" ref={rootRef} data-collage="pending" data-cstatus="loading" data-stage={stage} data-selected={selectedId ?? ''} data-hud={hudFeed ? '1' : '0'} tabIndex={0} role="application"
      aria-label="Machine Journey camera archive. Next: scroll down, press Right Arrow or Enter, or swipe up or left. Back: scroll up, press Left Arrow, or swipe down or right.">
      {/* Opaque loading cover present from the very first commit: no empty labelled grid is ever visible. It lifts once every
          poster has settled AND the tiles are painted from them (or after a bounded wait; see posterGate). */}
      <div className="collage-cover" aria-hidden="true">
        <span className="cv-loading">LOADING CAMERA PREVIEWS</span>
        <span className="cv-slow">CAMERA PREVIEWS ARE TAKING LONGER THAN EXPECTED…</span>
        <span className="cv-failed">CAMERA PREVIEWS COULD NOT BE LOADED. CHECK THE CONNECTION AND RELOAD.</span>
      </div>
      <div className="world" ref={worldRef} style={{ width: layoutDims.w * SCREENS, height: layoutDims.h }}>
        {placed.map((t, i) => {
          const f = FEEDS[t.feedIndex];
          return (
            <button
              key={t.id}
              ref={(el) => { if (el) tileEls.current.set(t.id, el); else tileEls.current.delete(t.id); }}
              className="tile"
              data-tile={t.id}
              data-feed={f.id}
              tabIndex={-1}
              aria-hidden="true"
              style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
            >
              <canvas ref={(el) => { canvases.current[i] = el; }} />
              {t.w >= 96 && t.h >= 40 && <span className="lbl">{f.label}</span>}
            </button>
          );
        })}
        {focusTileData && (
          <div
            className="reticle"
            aria-hidden="true"
            style={{ left: focusTileData.x + 5, top: focusTileData.y + 5, width: focusTileData.w - 10, height: focusTileData.h - 10 }}
          />
        )}
      </div>

      <div ref={floatHost} className="float-host" aria-hidden="true" />
      <div ref={neuralHost} className="float-host neural-host" aria-hidden="true" />

      <canvas ref={globeCanvas} className="globe" aria-hidden="true" style={{ visibility: 'hidden' }} />

      {/* One persistent decoder + clip pane per feed; the selected pane is moved, never recreated. */}
      {ALL_FEEDS.map((f, i) => {
        const core = i < CORE_FEED_COUNT;
        // The 12 core feeds load exactly as before. The 21 city clips are inert (no src / poster / autoplay, preload none)
        // until `attachCity` gives their element its source when that city is the upcoming target or open.
        return (
          <div className="pane" key={f.id} ref={(el) => { paneEls.current[i] = el; }}
            style={core ? { backgroundImage: `url(${feedPosterUrl(f)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            <video
              ref={(el) => { videoEls.current[i] = el; trackFrames(el); }}
              data-feed={f.id}
              {...(core ? { src: feedVideoUrl(f), poster: feedPosterUrl(f), autoPlay: true } : {})}
              muted loop playsInline preload={core ? 'auto' : 'none'}
              disablePictureInPicture
              aria-hidden="true"
            />
          </div>
        );
      })}

      <div className="vignette" aria-hidden="true" />

      <div className="hud" aria-hidden={!hudFeed}>
        <div className="hud-tl">
          <span className="cam">{hudFeed?.label}</span>
          {!scenario && !floating && !neural && <span className="yr">{selYear}</span>}
          {neural && <span className="demo-tag">DEMO VISUALISATION</span>}
          {floating && <span className="demo-tag">DEMO · FICTIONAL SAMPLE CONTENT</span>}
          {scenario && (scenario.verified ? (
            <span className="sc" title={`${scenario.verified.note} Source: ${scenario.verified.source} (${scenario.verified.url}). Position: ${scenario.verified.coordSource}.`}>
              SOURCE · {scenario.verified.label}<em> · {scenario.verified.source}</em>
            </span>
          ) : (
            <span className="sc" title={`Archive clip for ${scenario.name}: the place is named by its stock publisher / contributor and was visually screened. It is not an official or GPS-verified camera location. Source: ${hudFeed?.source ?? ''}. Licence: ${hudFeed?.credit ?? ''}.`}>
              ARCHIVE PLACE · {scenario.name.toUpperCase()}
            </span>
          ))}
        </div>
        <span className="hud-tr" ref={clockRef} />
        <span className="hud-br">{hudFeed?.credit}</span>
      </div>

      {/* One footer stack (in flow, safe-area padded): the hint sits above the optional globe disclosure, so they never overlap. */}
      <div className="foot" ref={footRef}>
        <p className="hint" aria-hidden="true">
          <span className="hint-fine">SCROLL ↓ NEXT ↑ BACK · KEYS → NEXT ← BACK</span>
          <span className="hint-touch">SWIPE ↑ ← NEXT · ↓ → BACK</span>
          <span className="hint-sub">{stage === 'globe' ? 'BETWEEN CITIES' : 'BETWEEN CAMERAS'}</span>
        </p>
        {globeNoteOpen && (
          <p className="globe-note" aria-hidden="true">
            {destCity && destFeed
              ? destCity.verified
                ? `Source place: ${destCity.verified.label}. Opens camera ${destFeed.label} (${destCity.verified.source}). The map point is a locality overview, not a camera position.`
                : `${destCity.name}: opens its own local archive clip (${destFeed.label}, ${destFeed.credit}). The place is named by the stock publisher, not an official camera location; the map point is a locality overview.`
              : 'Every city opens its own local clip. Savannah, Butlerville and Palmdale are officially documented source places; the other places are named by their stock publishers (archive footage, not live cameras). Outlines, lights and arcs are simplified and decorative.'}
          </p>
        )}
      </div>

      <nav className="timeline" aria-label="Year axis (display only)">
        {/* Display only. The ruler extends one viewport past each end of the world; labels outside the recorded years are extrapolated axis ticks (same spacing), not archive claims. */}
        <div
          className="ruler" ref={rulerRef}
          style={{ left: -layoutDims.w, width: layoutDims.w * (SCREENS + 2), '--seg': `${axis.seg}px`, '--start': `${axis.start + layoutDims.w}px` } as CSSProperties}
        >
          {Array.from({ length: YEARS.length + 2 * extraYears }, (_, k) => {
            const i = k - extraYears; const real = i >= 0 && i < YEARS.length;
            const label = YEARS[0] + i;
            return (
              <span
                key={label}
                className={i === yearIdx ? 'year on' : real ? 'year' : 'year ext'}
                style={{ left: axis.centreOf(i) + layoutDims.w }}
                aria-current={i === yearIdx ? 'true' : undefined}
                aria-hidden={real ? undefined : 'true'}
              >
                {label}
              </span>
            );
          })}
        </div>
        <span className="caret" aria-hidden="true" />
      </nav>

      <div className="sr" role="status" aria-live="polite">{announce}</div>
    </div>
  );
}
