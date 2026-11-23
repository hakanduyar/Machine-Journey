import { clamp, easeInOut } from './geometry';
import { angularDistance, lerpAim, routeArcs, type GlobeAim } from './globe';
import { mulberry32 } from './layout';
import { anchorCityFor } from './globeOut';
import { CONTRACT_K, LEG_K, OUT_K, outboundLateBoost } from './scale';
import { feedOfVirtualTile, isCityFeed, virtualTileId } from './feeds';
import type { FeedSelector } from './feedDeck';

/**
 * Typed, DOM-free journey state machine. Every stage change is the result of an
 * explicit command (manual input today; a future autoplay layer would call the
 * very same `dispatch`). Nothing in here owns a timer: `update(dtMs)` is driven
 * by the renderer's frame loop and only integrates motion that a command started.
 *
 * One `intent` always starts exactly ONE complete leg and ends in a hold:
 *  - camera leg : contract the open pane into the mosaic, scan to another year, expand a different feed -> `selected`
 *  - globe leg  : contract the open pane into the mosaic, pull back to the globe                          -> `globe` (hold)
 *  - city leg   : rotate a different city to the front, fly through it and the media field, open its feed -> `selected`
 * Nothing advances without a fresh intent, and intents arriving mid-leg are refused.
 */
export type Stage =
  | 'mosaic' | 'expanding' | 'selected' | 'contracting'
  | 'scanning'
  // Globe branch: pullback (leg 1 of the branch), hold at the globe, then rotate + enter (leg 2).
  | 'globeOut' | 'globe' | 'turning' | 'entering'
  // Floating-field branch: shrink into the field (leg), hold at a stop, travel to the next stop (leg), expand the last pane (leg).
  | 'floatIn' | 'floating' | 'floatMove' | 'floatOut'
  // Neural branch: the fullscreen pane shrinks into its screen in the authored scene (leg), hold at an authored stop,
  // travel along the authored route (leg), and finally pull far back to the globe hold (leg).
  | 'neuralIn' | 'neural' | 'neuralMove' | 'neuralOut';

const GLOBE_STAGES: ReadonlySet<Stage> = new Set<Stage>(['globeOut', 'globe', 'turning', 'entering']);
export const isGlobeStage = (s: Stage) => GLOBE_STAGES.has(s);
const FLOAT_STAGES: ReadonlySet<Stage> = new Set<Stage>(['floatIn', 'floating', 'floatMove', 'floatOut']);
export const isFloatStage = (s: Stage) => FLOAT_STAGES.has(s);
/** Stages that wait for a fresh intent (everything else is a travelling leg). */
export const isHoldStage = (s: Stage) => s === 'mosaic' || s === 'selected' || s === 'globe' || s === 'floating' || s === 'neural';
const NEURAL_STAGES: ReadonlySet<Stage> = new Set<Stage>(['neuralIn', 'neural', 'neuralMove', 'neuralOut']);
export const isNeuralStage = (s: Stage) => NEURAL_STAGES.has(s);

/** Stops of one neural visit: feed, authored screen anchor and the authored clip time (seconds) of each hold. */
export interface NeuralPlan { feeds: string[]; anchors: number[]; times: number[] }

export type FloatFraming = 'medium' | 'full';
/** Stops of one floating-field visit. `feeds[0]` is the feed that was fullscreen (the shared pane). */
export interface FloatPlan { feeds: string[]; framing: FloatFraming[]; /** spatial slot of each stop (optional: absent = the feed's own slot) */ slots?: number[] }
/** A route branch, taken from a camera hold once `after` camera holds have been reached since the previous branch. */
/**
 * Where the route's next branch comes from. `current()` must stay the SAME branch until `advance()` is called
 * (a due branch that is still loading is retried with the same choice); `advance()` consumes or skips it.
 */
export interface BranchSource { current(): Branch; advance(): void }

/** Fixed, cycling source: only for deterministic fixtures, never the production default. */
class CycleSource implements BranchSource {
  private i = 0;
  private readonly list: readonly Branch[];
  constructor(list: readonly Branch[]) { this.list = list; }
  current() { return this.list[this.i % this.list.length]; }
  advance() { this.i++; }
}

export interface Branch { kind: 'globe' | 'float' | 'neural'; after: number; /** floating stops (2..4) */ stops?: number }

export interface GlobeCity {
  id: string; lon: number; lat: number;
  /** feed opened by entering this city (demo routing, or the verified feed of a verified place) */
  feedId?: string;
  /** Verified places only: every feed that really belongs to the place; entering picks one of them (never any other feed). */
  feedIds?: readonly string[];
}

export type JourneyCommand =
  | { type: 'select'; id: string }
  | { type: 'return' }
  | { type: 'advance' }
  | { type: 'retreat' }
  | { type: 'pan'; dx: number }
  | { type: 'panTo'; x: number }
  | { type: 'focus'; id: string }
  | { type: 'stopPan' }
  /** One deliberate forward intent: starts a COMPLETE leg from the current hold (a recorded one when history was stepped back). */
  | { type: 'intent' }
  /** One deliberate backward intent: replays the previous VISITED hold in reverse (no-op at the first hold). */
  | { type: 'back' };

/**
 * One visited hold, as semantic state only (never mutable elapsed progress). Entries are frozen copies: later state
 * changes cannot alter them, and replaying one never consults the route planner / any RNG.
 */
interface HoldBase {
  holds: number;
  /** The active city (semantic context) of this hold; restored exactly by back / redo. Absent only in city-less fixtures. */
  cityId?: string | null;
}
interface MosaicHold extends HoldBase { kind: 'mosaic'; x: number }
interface SelectedHold extends HoldBase {
  kind: 'selected'; id: string; feedId: string | null; x: number; ww: number; vw: number; city: string | null;
  /** Semantic archive year index of this stop; fixed when the stop is reached, independent of the physical tile. */
  year: number | null;
}
interface FloatingHold extends HoldBase {
  kind: 'floating'; feeds: readonly string[]; framing: readonly FloatFraming[]; slots: readonly number[]; idx: number;
}
interface NeuralHold extends HoldBase {
  kind: 'neural'; feeds: readonly string[]; anchors: readonly number[]; times: readonly number[]; idx: number;
}
interface GlobeHold extends HoldBase { kind: 'globe'; lon: number; lat: number; outFeedId: string | null; outCityId: string | null; routeKey: number }
type HoldEntry = MosaicHold | SelectedHold | FloatingHold | NeuralHold | GlobeHold;
const HISTORY_CAP = 400;

/** The history kind a hold stage belongs to. */
const holdKind = (s: Stage): HoldEntry['kind'] | null =>
  s === 'mosaic' ? 'mosaic' : s === 'selected' ? 'selected' : s === 'floating' ? 'floating' : s === 'neural' ? 'neural' : s === 'globe' ? 'globe' : null;

/** A leg that replays history (`dir` -1 = reverse of a recorded leg, 1 = redo of one) towards `hist[to]`. */
interface Replay { to: number; dir: 1 | -1; /** reverse: scan back to this mosaic offset */ mosaicX?: number; /** reverse of a city entry: rotate back to this aim */ aim?: GlobeAim }

export interface JourneyState {
  stage: Stage;
  /** Raw linear travel progress 0..1 (0 = mosaic, 1 = fullscreen dwell). */
  progress: number;
  /** Eased progress used for geometry. */
  eased: number;
  selectedId: string | null;
  /** Selection waiting for an in-flight return to finish. */
  pendingId: string | null;
  focusedId: string | null;
  worldX: number;
  targetX: number;
  /** Lateral scan progress 0..1 while stage is 'scanning'. */
  scanP: number;
  /** Mosaic -> globe pullback progress (0 mosaic, 1 globe) and its eased value. */
  globeP: number;
  globeEased: number;
  /** Globe -> camera travel progress (0 globe, 1 camera) and its eased value. */
  travelP: number;
  travelEased: number;
  /** City currently being rotated to / entered (highlighted on the globe). */
  destId: string | null;
  /** City whose demo scenario the open camera was reached through (null after a plain camera leg). */
  sceneCityId: string | null;
  /** Floating field: feeds of this visit's stops, their framings, the current (or departing) stop and leg progress. */
  floatFeeds: readonly string[];
  floatFraming: readonly FloatFraming[];
  /** Spatial slot of each floating stop (empty: derive from the feed). Separate from feed identity. */
  floatSlots: readonly number[];
  floatIdx: number;
  floatP: number;
  /** Feed opened by the city entry in progress (a verified city can offer several); null outside a city entry. */
  entryFeedId: string | null;
  /** Neural bridge: feeds / authored anchors / clip times of this visit's stops, current stop and leg progress. */
  neuralFeeds: readonly string[];
  neuralAnchors: readonly number[];
  neuralTimes: readonly number[];
  neuralIdx: number;
  neuralP: number;
  /** Current globe aim (the surface point at the centre of the view). */
  lon: number;
  lat: number;
  /** Outgoing leg (globeOut / neuralOut): feed leaving the screen and the authored demo city it shrinks toward. */
  outFeedId: string | null;
  outCityId: string | null;
  /** True from the intent that starts a globe leg until its contraction reaches the mosaic (slower, shared scale curve). */
  globeLeg: boolean;
  /** Tile the city entry will land on (the selected camera's place in the regional field), chosen when the entry begins. */
  entryTileId: string | null;
  /** True while a leg plays a RECORDED leg in reverse (history back). Stage/progress then run toward the earlier hold. */
  legRev: boolean;
  /** Visit key of the globe's route bundles (with `outCityId` it fixes the whole composition; stored in history, never rerolled). */
  routeKey: number;
  /**
   * ACTIVE CITY: the persistent semantic context. Every camera shown in every mode belongs to it. It changes only when the
   * globe actually ENTERS another city (committed at arrival) or when history restores a recorded hold; never on a display
   * mode change, a globe pull-back or a rotation. Null only for city-less fixtures.
   */
  cityId: string | null;
}

export interface JourneyOptions {
  worldWidth: number;
  viewportWidth: number;
  /** Duration of a full mosaic <-> fullscreen travel. */
  travelMs?: number;
  /** Destination cities for the globe branch. Empty/omitted: the route never leaves the mosaic. */
  cities?: readonly GlobeCity[];
  /** Chooses where the next camera leg goes (scroll offset that centres the target tile). */
  planner?: (leg: number) => { id: string; x: number } | null;
  /** Tile (of the given feed) the city leg lands on, plus the scroll that centres it. */
  anchorFeed?: (feedId: string, worldX: number, cityId?: string | null) => { id: string; x: number } | null;
  /** City whose catalog the journey opens in (the active city). Absent: a city-less fixture (legacy global behaviour). */
  initialCity?: string | null;
  /**
   * Readiness of a city-owned clip (R49 C), also the prewarm trigger (the host attaches its source on first call). `'wait'`:
   * still loading, so the ONE city intent is kept pending and the globe hold stays visible; `'failed'`: that clip can't be
   * shown, so that city is skipped (never replaced by another city's / a generic video). Absent: always ready.
   */
  cityStatus?: (feedId: string) => 'ready' | 'wait' | 'failed';
  /** Feed id of a tile, used so a city leg does not reopen the feed that was just on screen. */
  feedOfTile?: (tileId: string, cityId?: string | null) => string | null;
  /** Archive year index of a tile in the CURRENT layout; recorded once when a selected stop is reached. */
  yearOfTile?: (tileId: string) => number | null;
  /** Camera holds that must be reached before each globe branch (cycled). Authored 2..4. Ignored when `branches` is given. */
  globeGaps?: readonly number[];
  /** Fixture route of branches (cycled) for deterministic tests. Default: a globe branch after each of `globeGaps`. */
  branches?: readonly Branch[];
  /** Runtime route source (production uses the seeded varied planner). Takes precedence over `branches`. */
  branchSource?: BranchSource;
  /** Plans a floating-field visit starting at the feed on screen; null when the field is unavailable. */
  floatPlan?: (fromFeedId: string | null, stops: number, visit: number) => FloatPlan | 'wait' | null;
  /**
   * Plans a neural visit. `'wait'` means the scene is still loading: the intent is refused and the current hold stays
   * (the promised branch is not skipped); `null` means it can never run (load failed) and the branch is skipped.
   */
  neuralPlan?: (fromFeedId: string | null, stops: number, visit: number) => NeuralPlan | 'wait' | null;
  /**
   * Optional per-leg travel-duration multiplier (>= 1) for a neural move from authored time `fromT` to `toT`, given the
   * base duration in seconds. Must be stable for a given leg (it is asked every frame). Absent => 1.
   */
  neuralLegScale?: (fromT: number, toT: number, baseSeconds: number) => number;
  /** Initial globe aim before any destination was chosen. */
  initialAim?: GlobeAim;
  /** Session seed (production: the same one the route planner uses). Makes city choice and route composition reproducible. */
  seed?: number;
  /** Shared finite feed deck: fresh holds commit their feed; city choice prefers cities whose feed is still unseen. */
  deck?: FeedSelector;
}

export type JourneyListener = (state: Readonly<JourneyState>, cmd: JourneyCommand | null) => void;

export const DEFAULT_GLOBE_GAPS: readonly number[] = [3, 2, 4];
/** Upper bound of the per-leg neural duration extension (keeps elapsed time and the hold gate bounded). */
export const NEURAL_LEG_SCALE_MAX = 1.5;

export class JourneyController {
  private worldWidth: number;
  private viewportWidth: number;
  private travelMs: number;
  private dir: -1 | 0 | 1 = 0;
  private planner: JourneyOptions['planner'];
  private anchorFeed: JourneyOptions['anchorFeed'];
  private cityStatus: JourneyOptions['cityStatus'];
  /** City clips that failed to load this session: their cities are skipped by the picker. */
  private failedFeeds = new Set<string>();
  private peeked = -1;
  private feedOfTile: JourneyOptions['feedOfTile'];
  private yearOfTile: JourneyOptions['yearOfTile'];
  private semYear: number | null = null;
  /** Semantic archive year of the open selected stop (null when unknown); not changed by responsive rebase. */
  get selectedYear(): number | null { return this.semYear; }
  private source: BranchSource;
  private floatPlan: JourneyOptions['floatPlan'];
  private neuralPlan: JourneyOptions['neuralPlan'];
  private neuralLegScale: JourneyOptions['neuralLegScale'];
  private floatVisits = 0;
  private neuralVisits = 0;
  private pending = false;
  private legCount = 0;
  private legKind: 'camera' | 'globe' = 'camera';
  private legTarget: { id: string; x: number } | null = null;
  private holds = 0;
  private globeVisits = 0;
  private lastCityId: string | null = null;
  private fromFeedId: string | null = null;
  private scanFrom = 0;
  private scanTo = 0;
  private scanMs = 1;
  private gdir: -1 | 0 | 1 = 0;
  private tdir: -1 | 0 | 1 = 0;
  private cities: readonly GlobeCity[];
  private rot: { from: GlobeAim; to: GlobeAim; t: number; ms: number; back?: boolean } | null = null;
  private hist: HoldEntry[] = [];
  private cursor = 0;
  private rp: Replay | null = null;
  /** Reverse of a city entry: the globe leaves toward the city that was entered (not the feed's default anchor city). */
  private outCityOverride: string | null = null;
  private seed = 0;
  private deck: FeedSelector | undefined;
  /** Counts FRESH globe visits only (replays reuse the recorded key): a deterministic counter, not an RNG draw. */
  private routeSerial = 0;
  /** The most recent fresh city destinations (novelty window). */
  private recent: string[] = [];
  private listeners = new Set<JourneyListener>();
  private s: JourneyState = {
    stage: 'mosaic', progress: 0, eased: 0, selectedId: null, pendingId: null,
    focusedId: null, worldX: 0, targetX: 0,
    scanP: 0, globeP: 0, globeEased: 0, travelP: 0, travelEased: 0, destId: null, sceneCityId: null,
    floatFeeds: [], floatFraming: [], floatSlots: [], floatIdx: 0, floatP: 0, entryFeedId: null,
    neuralFeeds: [], neuralAnchors: [], neuralTimes: [], neuralIdx: 0, neuralP: 0, lon: -35, lat: 25,
    outFeedId: null, outCityId: null, globeLeg: false, entryTileId: null, legRev: false, routeKey: 0, cityId: null,
  };
  private entryAnchor: { id: string; x: number } | null = null;
  /** True when an active city was given: tiles are per-city and a city feed always has a real tile (no virtual stand-in). */
  private ctx = false;

  /** Commit the active city (and the per-city feed deck that goes with it). */
  private setCity(id: string | null) {
    if (this.s.cityId === id) { this.deck?.useCity?.(id); return; }
    this.s.cityId = id; this.deck?.useCity?.(id);
  }

  constructor(o: JourneyOptions) {
    this.worldWidth = o.worldWidth;
    this.viewportWidth = o.viewportWidth;
    this.travelMs = o.travelMs ?? 950;
    this.cities = o.cities ?? [];
    this.seed = o.seed ?? 0;
    this.deck = o.deck;
    this.planner = o.planner;
    // City-owned clips (R49 C) have no tile in the core-only mosaic: they land on a stable VIRTUAL tile (`virtual:<feedId>`),
    // which resolves back to its feed here, so selection, history and re-entry never depend on the mosaic layout.
    this.ctx = o.initialCity != null;
    // City-less fixtures only (legacy): a city-owned clip with no tile lands on a virtual tile. With an active city every
    // feed of the city has a REAL tile of the city's own stable mosaic, so there is never a stand-in.
    this.anchorFeed = o.anchorFeed
      ? (feedId, worldX, cityId) => o.anchorFeed!(feedId, worldX, cityId) ?? (!this.ctx && isCityFeed(feedId) ? { id: virtualTileId(feedId), x: worldX } : null)
      : undefined;
    this.feedOfTile = o.feedOfTile ? (id, cityId) => (this.ctx ? null : feedOfVirtualTile(id)) ?? o.feedOfTile!(id, cityId) : undefined;
    this.cityStatus = o.cityStatus;
    this.yearOfTile = o.yearOfTile;
    this.floatPlan = o.floatPlan;
    this.neuralPlan = o.neuralPlan;
    this.neuralLegScale = o.neuralLegScale;
    const gaps = o.globeGaps && o.globeGaps.length ? o.globeGaps : DEFAULT_GLOBE_GAPS;
    this.source = o.branchSource ?? new CycleSource(o.branches && o.branches.length ? o.branches : gaps.map((after) => ({ kind: 'globe' as const, after })));
    if (o.initialAim) { this.s.lon = o.initialAim.lon; this.s.lat = o.initialAim.lat; }
    this.setCity(o.initialCity ?? null);
    this.hist.push({ kind: 'mosaic', x: this.s.worldX, holds: 0, cityId: this.s.cityId });
  }

  /** Read-only history view for review / tests: visited holds in order and the cursor. */
  get history(): { kinds: readonly string[]; cursor: number } { return { kinds: this.hist.map((h) => h.kind), cursor: this.cursor }; }

  get state(): Readonly<JourneyState> { return this.s; }

  /** Review handle: the persistent active city (semantic context of every mode), null only for city-less fixtures. */
  get activeCity(): string | null { return this.s.cityId; }

  subscribe(l: JourneyListener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }

  setBounds(worldWidth: number, viewportWidth: number) {
    this.worldWidth = worldWidth; this.viewportWidth = viewportWidth;
    this.s.targetX = this.clampX(this.s.targetX);
    if (this.s.stage === 'mosaic') this.s.worldX = this.clampX(this.s.worldX);
  }

  private maxX() { return Math.max(0, this.worldWidth - this.viewportWidth); }
  private clampX(x: number) { return clamp(x, 0, this.maxX()); }

  private emit(cmd: JourneyCommand | null) { for (const l of this.listeners) l(this.s, cmd); }

  private recompute() {
    const s = this.s;
    if (isGlobeStage(s.stage) || isFloatStage(s.stage) || isNeuralStage(s.stage) || s.stage === 'scanning') return false; // branches own their stages
    s.eased = easeInOut(s.progress);
    const prev = s.stage;
    if (s.progress <= 0 && this.dir <= 0) s.stage = 'mosaic';
    else if (s.progress >= 1 && this.dir >= 0) s.stage = 'selected';
    else s.stage = this.dir >= 0 ? 'expanding' : 'contracting';
    return prev !== s.stage;
  }

  /** Returns true when the command changed something or was already satisfied. */
  dispatch(cmd: JourneyCommand): boolean {
    const s = this.s;
    if (cmd.type === 'intent') { const ok = this.startLeg(); this.emit(cmd); return ok; }
    if (cmd.type === 'back') { const ok = this.startBack(); this.emit(cmd); return ok; }
    let ok = false;
    switch (cmd.type) {
      case 'focus':
        if (s.stage === 'mosaic' || s.focusedId === null) { s.focusedId = cmd.id; ok = true; }
        break;
      case 'advance':
        if (s.stage === 'mosaic' && s.focusedId) return this.dispatch({ type: 'select', id: s.focusedId });
        return false;
      case 'retreat':
        return this.dispatch({ type: 'return' });
      case 'select': {
        if (s.stage === 'mosaic') {
          s.selectedId = cmd.id; s.focusedId = cmd.id; s.pendingId = null;
          this.dir = 1; ok = true;
        } else if (s.selectedId === cmd.id) {
          s.pendingId = null;
          if (s.stage === 'contracting') { this.dir = 1; ok = true; } else ok = true;
        } else if (s.stage === 'contracting') {
          s.pendingId = cmd.id; ok = true;
        }
        break;
      }
      case 'return':
        s.pendingId = null;
        if (s.stage === 'expanding' || s.stage === 'selected') { this.dir = -1; ok = true; }
        else ok = s.stage === 'contracting' || s.stage === 'mosaic';
        break;
      case 'pan':
        if (s.stage === 'mosaic') { s.targetX = this.clampX(s.targetX + cmd.dx); ok = true; }
        break;
      case 'panTo':
        if (s.stage === 'mosaic') { s.targetX = this.clampX(cmd.x); ok = true; }
        break;
      case 'stopPan':
        s.targetX = s.worldX; ok = true;
        break;
    }
    this.recompute();
    this.emit(cmd);
    return ok;
  }

  // ---- Visited-hold history -------------------------------------------------------------------------------------

  /** Frozen semantic snapshot of the hold the controller is at right now (null when not at a hold). */
  private snap(): HoldEntry | null {
    const s = this.s; const holds = this.holds; const cityId = s.cityId;
    switch (s.stage) {
      case 'mosaic': return Object.freeze({ kind: 'mosaic', x: s.worldX, holds, cityId });
      case 'selected': {
        if (!s.selectedId) return null;
        return Object.freeze({
          kind: 'selected', id: s.selectedId, feedId: this.feedOfTile?.(s.selectedId, cityId) ?? null, x: s.worldX,
          ww: this.worldWidth, vw: this.viewportWidth, city: s.sceneCityId, year: this.semYear, holds, cityId,
        });
      }
      case 'floating':
        return Object.freeze({ kind: 'floating', feeds: Object.freeze([...s.floatFeeds]), framing: Object.freeze([...s.floatFraming]), slots: Object.freeze([...s.floatSlots]), idx: s.floatIdx, holds, cityId });
      case 'neural':
        return Object.freeze({
          kind: 'neural', feeds: Object.freeze([...s.neuralFeeds]), anchors: Object.freeze([...s.neuralAnchors]),
          times: Object.freeze([...s.neuralTimes]), idx: s.neuralIdx, holds, cityId,
        });
      case 'globe':
        return Object.freeze({ kind: 'globe', lon: s.lon, lat: s.lat, outFeedId: s.outFeedId, outCityId: s.outCityId, routeKey: s.routeKey, holds, cityId });
      default: return null;
    }
  }

  /** Re-record the CURRENT hold in place (resize re-anchor, a globe that stayed put): same place in history. */
  private syncCurrent() {
    const e = this.snap();
    if (e && this.hist[this.cursor]?.kind === e.kind) this.hist[this.cursor] = e;
  }

  /** The tile + scroll a recorded camera hold maps to in the CURRENT layout (exact when the layout is unchanged). */
  private resolve(e: SelectedHold): { id: string; x: number } | null {
    const feedNow = this.feedOfTile?.(e.id, e.cityId) ?? null;
    if (e.ww === this.worldWidth && e.vw === this.viewportWidth && feedNow === e.feedId) return { id: e.id, x: this.clampX(e.x) };
    if (e.feedId && this.anchorFeed) {
      const a = this.anchorFeed(e.feedId, e.x * (this.worldWidth / Math.max(1, e.ww)), e.cityId);
      if (a) return { id: a.id, x: this.clampX(a.x) };
    }
    return feedNow !== null || !this.feedOfTile ? { id: e.id, x: this.clampX(e.x) } : null;
  }

  /** A hold was reached. A replayed leg moves the cursor and restores the recorded hold; a fresh one is appended. */
  private land() {
    const s = this.s; const rp = this.rp;
    this.rp = null; s.legRev = false; this.outCityOverride = null;
    if (rp) { this.cursor = rp.to; this.restore(rp.to); return; }
    if (s.stage === 'selected' && s.selectedId) this.semYear = this.yearOfTile?.(s.selectedId) ?? null;
    const e = this.snap();
    if (!e) return;
    // Only a hold REACHED by a fresh leg consumes the shared deck (a replay returned above; planning never commits). The
    // camera already on screen (a pane shrinking into the field / scene, or the field's last pane expanding) is continuity.
    if (this.deck) {
      const f = e.kind === 'selected' ? e.feedId : e.kind === 'floating' || e.kind === 'neural' ? e.feeds[e.idx] : null;
      if (f) this.deck.commit(f);
    }
    this.hist.length = this.cursor + 1; // a fresh arrival drops any redo
    this.hist.push(e);
    if (this.hist.length > HISTORY_CAP) this.hist.shift();
    this.cursor = this.hist.length - 1;
  }

  private restore(i: number) {
    const s = this.s; const e = this.hist[i];
    this.holds = e.holds; this.dir = 0;
    if (e.cityId !== undefined) this.setCity(e.cityId); // the exact recorded city; its sources and tiles follow (no reroll)
    switch (e.kind) {
      case 'mosaic':
        s.worldX = s.targetX = this.clampX(e.x); s.selectedId = null; s.progress = 0; s.eased = 0; s.pendingId = null;
        break;
      case 'selected': {
        const r = this.resolve(e) ?? { id: e.id, x: e.x };
        this.semYear = e.year;
        s.selectedId = r.id; s.focusedId = r.id; s.pendingId = null; s.worldX = s.targetX = this.clampX(r.x);
        s.progress = 1; s.eased = 1; s.sceneCityId = e.city; s.destId = null;
        s.globeP = 0; s.globeEased = 0; s.travelP = 0; s.travelEased = 0; s.entryTileId = null;
        s.floatFeeds = []; s.floatFraming = []; s.floatSlots = []; s.floatIdx = 0; s.floatP = 0;
        s.neuralFeeds = []; s.neuralAnchors = []; s.neuralTimes = []; s.neuralIdx = 0; s.neuralP = 0;
        if (r.id !== e.id || e.ww !== this.worldWidth || e.vw !== this.viewportWidth) this.syncCurrent();
        break;
      }
      case 'floating':
        s.floatFeeds = [...e.feeds]; s.floatFraming = [...e.framing]; s.floatSlots = [...e.slots]; s.floatIdx = e.idx; s.floatP = 0; s.selectedId = null; s.progress = 0; s.eased = 0;
        break;
      case 'neural':
        s.neuralFeeds = [...e.feeds]; s.neuralAnchors = [...e.anchors]; s.neuralTimes = [...e.times]; s.neuralIdx = e.idx; s.neuralP = 0;
        s.globeP = 0; s.globeEased = 0; s.selectedId = null; s.progress = 0; s.eased = 0;
        break;
      case 'globe':
        s.lon = e.lon; s.lat = e.lat; s.outFeedId = e.outFeedId; s.outCityId = e.outCityId; s.routeKey = e.routeKey;
        s.globeP = 1; s.globeEased = 1; s.travelP = 0; s.travelEased = 0; s.destId = null; s.selectedId = null; s.progress = 0; s.eased = 0;
        s.neuralFeeds = []; s.neuralAnchors = []; s.neuralTimes = []; s.neuralIdx = 0; s.neuralP = 0;
        s.floatFeeds = []; s.floatFraming = []; s.floatSlots = []; s.floatIdx = 0; s.floatP = 0;
        break;
    }
  }

  private beginReplay(to: number, dir: 1 | -1, extra: Partial<Replay> = {}) {
    this.rp = { to, dir, ...extra };
    this.s.legRev = dir === -1;
  }

  /** Back: replay the previous VISITED hold by running its recorded leg in reverse (one complete leg, then hold). */
  private startBack(): boolean {
    const s = this.s;
    if (this.pending || this.rp || !isHoldStage(s.stage)) return false;
    const cur = this.hist[this.cursor];
    if (this.cursor <= 0 || !cur || holdKind(s.stage) !== cur.kind) return false;
    if (s.stage === 'mosaic') this.hist[this.cursor] = Object.freeze({ kind: 'mosaic', x: s.worldX, holds: this.holds, cityId: s.cityId });
    const to = this.cursor - 1;
    const prev = this.hist[to];
    switch (cur.kind) {
      case 'selected': {
        if (prev.kind === 'selected') {
          const t = this.resolve(prev); if (!t) return false;
          this.beginReplay(to, -1);
          this.legKind = 'camera'; s.sceneCityId = null; this.legTarget = t; s.pendingId = null; this.dir = -1; this.recompute();
          return true;
        }
        if (prev.kind === 'mosaic') {
          this.beginReplay(to, -1, { mosaicX: prev.x });
          this.legKind = 'camera'; s.sceneCityId = null; this.legTarget = null; s.pendingId = null; this.dir = -1; this.recompute();
          return true;
        }
        if (prev.kind === 'globe') { // reverse of a city entry: leave the entered city, then rotate back to where the globe was
          const city = s.selectedId && cur.city ? this.cities.find((c) => c.id === cur.city) : undefined;
          const tileId = s.selectedId;
          if (city && tileId) {
            // The entry's OWN path run backwards from fullscreen (travelP 1 -> 0): independent cameras, local geography, regions,
            // continent, globe. No tile contraction, no planner / deck consumption; the recorded aim is restored on landing.
            const feed = this.feedOfTile?.(tileId, cur.cityId) ?? cur.feedId;
            this.beginReplay(to, -1, { aim: { lon: prev.lon, lat: prev.lat } });
            this.legKind = 'camera'; this.legTarget = null; this.dir = 0; this.rot = null; this.gdir = 0; this.tdir = -1;
            this.fromFeedId = feed; this.entryAnchor = null;
            s.pendingId = null; s.sceneCityId = null; s.selectedId = null; s.progress = 0; s.eased = 0;
            s.destId = city.id; s.entryFeedId = feed; s.entryTileId = tileId; s.outFeedId = feed;
            s.outCityId = prev.outCityId; s.routeKey = prev.routeKey; s.lon = city.lon; s.lat = city.lat;
            s.globeP = 1; s.globeEased = 1; s.travelP = 1; s.travelEased = 1;
            s.stage = 'entering';
            return true;
          }
          this.beginReplay(to, -1, { aim: { lon: prev.lon, lat: prev.lat } });
          this.outCityOverride = s.sceneCityId;
          this.legKind = 'globe'; s.globeLeg = true; this.legTarget = null; s.pendingId = null; s.sceneCityId = null;
          this.fromFeedId = s.selectedId ? this.feedOfTile?.(s.selectedId) ?? null : null;
          this.dir = -1; this.recompute();
          return true;
        }
        if (prev.kind === 'floating') { // reverse of floatOut: the fullscreen pane returns to its place in the field
          this.beginReplay(to, -1);
          s.floatFeeds = [...prev.feeds]; s.floatFraming = [...prev.framing]; s.floatSlots = [...prev.slots]; s.floatIdx = prev.idx; s.floatP = 1;
          s.selectedId = null; s.pendingId = null; s.sceneCityId = null; this.dir = 0; s.progress = 0; s.eased = 0;
          s.stage = 'floatOut';
          return true;
        }
        return false;
      }
      case 'globe': {
        if (prev.kind === 'selected') { // reverse of the globe leg: the very pane re-enters its recorded tile
          const t = this.resolve(prev); if (!t) return false;
          this.beginReplay(to, -1);
          s.destId = cur.outCityId; s.outFeedId = prev.feedId ?? cur.outFeedId;
          this.entryAnchor = t; s.entryTileId = t.id; s.worldX = s.targetX = this.clampX(t.x);
          this.rot = null; s.travelP = 0; s.travelEased = 0; this.startEntry();
          return true;
        }
        if (prev.kind === 'neural') { // reverse of neuralOut: the globe falls back into the authored scene
          this.beginReplay(to, -1);
          s.neuralFeeds = [...prev.feeds]; s.neuralAnchors = [...prev.anchors]; s.neuralTimes = [...prev.times]; s.neuralIdx = prev.idx;
          s.outFeedId = cur.outFeedId; s.outCityId = cur.outCityId; s.routeKey = cur.routeKey;
          s.neuralP = 1; s.globeP = 1; s.globeEased = 1; s.travelP = 0; s.travelEased = 0; s.destId = null; s.selectedId = null;
          this.gdir = 0; this.tdir = 0; this.rot = null; s.stage = 'neuralOut';
          return true;
        }
        return false;
      }
      case 'floating': {
        if (prev.kind === 'floating') { // reverse of floatMove
          this.beginReplay(to, -1);
          s.floatIdx = prev.idx; s.floatP = 1; s.stage = 'floatMove';
          return true;
        }
        if (prev.kind === 'selected') { // reverse of floatIn
          this.beginReplay(to, -1);
          s.floatP = 1; s.stage = 'floatIn';
          return true;
        }
        return false;
      }
      case 'neural': {
        if (prev.kind === 'neural') { // reverse of neuralMove
          this.beginReplay(to, -1);
          s.neuralIdx = prev.idx; s.neuralP = 1; s.stage = 'neuralMove';
          return true;
        }
        if (prev.kind === 'selected') { // reverse of neuralIn
          this.beginReplay(to, -1);
          s.neuralP = 1; s.stage = 'neuralIn';
          return true;
        }
        return false;
      }
      default: return false;
    }
  }

  /**
   * Forward from a hold that has a recorded successor (stepped back earlier): replay that recorded leg. The route
   * planner, branch source and every plan callback are NOT consulted, so no seed / counter advances.
   */
  private replayForward(): boolean {
    const s = this.s;
    const cur = this.hist[this.cursor]; const next = this.hist[this.cursor + 1];
    const to = this.cursor + 1;
    if (s.stage === 'mosaic') this.hist[this.cursor] = Object.freeze({ kind: 'mosaic', x: s.worldX, holds: this.holds, cityId: s.cityId });
    if (next.kind === 'selected' && (cur.kind === 'mosaic' || cur.kind === 'selected')) {
      const t = this.resolve(next); if (!t) return false;
      this.beginReplay(to, 1);
      this.legKind = 'camera'; s.sceneCityId = null;
      if (cur.kind === 'selected') { this.legTarget = t; s.pendingId = null; this.dir = -1; this.recompute(); } else this.beginScan(t);
      return true;
    }
    if (next.kind === 'globe' && cur.kind === 'selected') {
      this.beginReplay(to, 1);
      this.legKind = 'globe'; s.globeLeg = true; this.legTarget = null; s.pendingId = null; s.sceneCityId = null;
      this.fromFeedId = s.selectedId ? this.feedOfTile?.(s.selectedId) ?? null : null;
      this.dir = -1; this.recompute();
      return true;
    }
    if (next.kind === 'floating' && cur.kind === 'selected') {
      this.beginReplay(to, 1);
      s.floatFeeds = [...next.feeds]; s.floatFraming = [...next.framing]; s.floatSlots = [...next.slots]; s.floatIdx = 0; s.floatP = 0;
      s.selectedId = null; s.pendingId = null; s.sceneCityId = null; this.dir = 0; s.progress = 0; s.eased = 0;
      s.stage = 'floatIn';
      return true;
    }
    if (next.kind === 'neural' && cur.kind === 'selected') {
      this.beginReplay(to, 1);
      s.neuralFeeds = [...next.feeds]; s.neuralAnchors = [...next.anchors]; s.neuralTimes = [...next.times]; s.neuralIdx = 0; s.neuralP = 0;
      s.globeP = 0; s.globeEased = 0; s.travelP = 0; s.travelEased = 0;
      s.selectedId = null; s.pendingId = null; s.sceneCityId = null; this.dir = 0; s.progress = 0; s.eased = 0;
      s.stage = 'neuralIn';
      return true;
    }
    if (next.kind === 'selected' && cur.kind === 'globe') { // a recorded city entry: the SAME city and tile, no pickCity
      const t = this.resolve(next); if (!t) return false;
      const city = this.cities.find((c) => c.id === next.city);
      if (!city) return false;
      this.beginReplay(to, 1);
      s.entryFeedId = next.feedId ?? this.entryFeed(city); // the RECORDED feed: nothing is re-picked
      this.rotateToCity(city, t);
      return true;
    }
    // Within a floating / neural visit the recorded stops are already in state: the leg is the stage's own.
    if ((cur.kind === 'floating' && (next.kind === 'floating' || next.kind === 'selected')) ||
        (cur.kind === 'neural' && (next.kind === 'neural' || next.kind === 'globe'))) {
      this.beginReplay(to, 1);
      return this.stepVisit();
    }
    return false;
  }

  /** The branch the next leg out of a camera hold takes, if enough camera holds were reached. */
  private branchDue(): Branch | null {
    const b = this.source.current();
    return this.holds >= b.after ? b : null;
  }

  /** True while exactly one manual intent waits for its (still loading) mode; every further intent is refused. */
  get pendingIntent() { return this.pending; }

  /**
   * Completes the ONE manual leg that was requested while its mode was loading (not autoplay: no new intent is
   * invented). The due choice is unchanged until it actually starts, and starts at most once. A failed load clears the
   * pending intent and leaves the current hold intact, so the next fresh intent can take an alternative.
   */
  private retryPending() {
    const s = this.s;
    if (s.stage === 'globe') { // a pending city intent: start the leg once the city's own clip is ready (or skip it if it failed)
      const r = this.beginCityLeg();
      if (r === 'wait') return;
      this.pending = false;
      if (r === 'ok') this.emit(null);
      return;
    }
    if (s.stage !== 'selected') { this.pending = false; return; }
    const b = this.source.current();
    const r = b.kind === 'float' ? this.beginFloat(b) : b.kind === 'neural' ? this.beginNeural(b) : 'skip';
    if (r === 'wait') return;
    this.pending = false;
    if (r === 'ok') this.emit(null);
    else this.source.advance();
  }

  /** Every leg is complete once started; input while travelling is refused (no queueing). */
  private startLeg(): boolean {
    const s = this.s;
    if (this.pending || this.rp) return false; // one manual intent is already waiting for its mode: further input is discarded
    const cur = this.hist[this.cursor];
    if (this.cursor < this.hist.length - 1 && cur && holdKind(s.stage) === cur.kind) return this.replayForward(); // redo: recorded leg, no planner
    if (s.stage === 'mosaic') this.hist[this.cursor] = Object.freeze({ kind: 'mosaic', x: s.worldX, holds: this.holds, cityId: s.cityId }); // where a back leg returns to
    if (s.stage === 'globe') {
      const r = this.beginCityLeg();
      if (r === 'wait') { this.pending = true; return true; } // keep this ONE intent; the city leg runs when its own clip is ready
      return r === 'ok';
    }
    if (s.stage === 'floating' || s.stage === 'neural') return this.stepVisit();
    if (s.stage !== 'mosaic' && s.stage !== 'selected') return false;
    const due = s.stage === 'selected' ? this.branchDue() : null;
    if (due?.kind === 'neural') {
      const started = this.beginNeural(due);
      if (started === 'wait') { this.pending = true; return true; } // keep this ONE intent; it runs when the scene is ready
      if (started === 'ok') return true;
      this.source.advance(); // can never run: skip this branch, carry on with a camera leg
    } else if (due?.kind === 'float') {
      const started = this.beginFloat(due);
      if (started === 'wait') { this.pending = true; return true; } // keep this ONE intent; it runs when the field is ready
      if (started === 'ok') return true;
      this.source.advance(); // can never run: skip this branch, carry on with a camera leg
    } else if (due?.kind === 'globe') {
      if (this.cities.length === 0) this.source.advance(); // no globe: skip this branch
      else {
        this.source.advance();
        this.legKind = 'globe'; s.globeLeg = true; this.legTarget = null; s.pendingId = null; s.sceneCityId = null;
        this.fromFeedId = s.selectedId ? this.feedOfTile?.(s.selectedId) ?? null : null;
        this.dir = -1; this.recompute();
        return true;
      }
    }
    const plan = this.planner?.(this.legCount + 1) ?? null;
    if (!plan) return false;
    this.legCount++;
    this.legKind = 'camera'; s.sceneCityId = null;
    if (s.stage === 'selected') {
      this.legTarget = plan; s.pendingId = null; this.dir = -1; this.recompute();
    } else this.beginScan(plan);
    return true;
  }

  /** Next leg of a floating / neural visit from its current stop (the same for fresh and recorded legs). */
  private stepVisit(): boolean {
    const s = this.s;
    if (s.stage === 'floating') {
      s.floatP = 0;
      s.stage = s.floatIdx < s.floatFeeds.length - 1 ? 'floatMove' : 'floatOut';
      return true;
    }
    if (s.stage === 'neural') {
      s.neuralP = 0;
      if (s.neuralIdx < s.neuralFeeds.length - 1) s.stage = 'neuralMove';
      else {
        this.fromFeedId = s.neuralFeeds[s.neuralFeeds.length - 1] ?? null; // the globe's next city must differ
        this.beginOutgoing(this.fromFeedId);
        s.stage = 'neuralOut';
      }
      return true;
    }
    return false;
  }

  private beginScan(plan: { id: string; x: number }) {
    const s = this.s;
    s.selectedId = plan.id; s.focusedId = plan.id; s.pendingId = null;
    this.scanFrom = s.worldX; this.scanTo = this.clampX(plan.x);
    const dist = Math.abs(this.scanTo - this.scanFrom);
    s.scanP = 0; this.dir = 0; s.progress = 0; s.eased = 0; s.targetX = s.worldX;
    if (dist < 1) { s.worldX = s.targetX = this.scanTo; this.dir = 1; s.stage = 'expanding'; return; }
    const k = this.travelMs / 950;
    this.scanMs = clamp(760 * k + dist * 0.35 * k, 900 * k, 1800 * k);
    s.stage = 'scanning';
  }

  /** Reverse of the first leg: scan the contracted mosaic back to where it was before that leg (no tile is opened). */
  private beginScanBack(x: number) {
    const s = this.s;
    this.scanFrom = s.worldX; this.scanTo = this.clampX(x);
    const dist = Math.abs(this.scanTo - this.scanFrom);
    s.scanP = 0; this.dir = 0; s.progress = 0; s.eased = 0; s.targetX = s.worldX; s.selectedId = null;
    const k = this.travelMs / 950;
    this.scanMs = clamp(760 * k + dist * 0.35 * k, 900 * k, 1800 * k);
    s.stage = 'scanning';
  }

  /** The fullscreen pane itself shrinks into the floating field (no mosaic detour). */
  private beginFloat(b: Branch): 'ok' | 'wait' | 'skip' {
    const s = this.s;
    const from = s.selectedId ? this.feedOfTile?.(s.selectedId) ?? null : null;
    const plan = this.floatPlan?.(from, b.stops ?? 3, this.floatVisits);
    if (plan === 'wait') return 'wait';
    if (!plan || plan.feeds.length < 2 || plan.framing.length !== plan.feeds.length) return 'skip';
    this.source.advance(); this.floatVisits++;
    s.floatFeeds = plan.feeds; s.floatFraming = plan.framing; s.floatSlots = plan.slots ?? []; s.floatIdx = 0; s.floatP = 0;
    s.selectedId = null; s.pendingId = null; s.sceneCityId = null;
    this.dir = 0; s.progress = 0; s.eased = 0;
    s.stage = 'floatIn';
    return 'ok';
  }

  /** The fullscreen pane shrinks into its own screen of the authored neural scene (no mosaic detour). */
  private beginNeural(b: Branch): 'ok' | 'wait' | 'skip' {
    const s = this.s;
    const from = s.selectedId ? this.feedOfTile?.(s.selectedId) ?? null : null;
    const plan = this.neuralPlan?.(from, b.stops ?? 3, this.neuralVisits);
    if (plan === 'wait') return 'wait';
    if (!plan || plan.feeds.length < 2 || plan.anchors.length !== plan.feeds.length || plan.times.length !== plan.feeds.length) return 'skip';
    this.source.advance(); this.neuralVisits++;
    s.neuralFeeds = plan.feeds; s.neuralAnchors = plan.anchors; s.neuralTimes = plan.times; s.neuralIdx = 0; s.neuralP = 0;
    s.globeP = 0; s.globeEased = 0; s.travelP = 0; s.travelEased = 0; // no stale inbound/outbound globe progress enters the scene
    s.selectedId = null; s.pendingId = null; s.sceneCityId = null;
    this.dir = 0; s.progress = 0; s.eased = 0;
    s.stage = 'neuralIn';
    return 'ok';
  }

  private updateNeural(dtMs: number): boolean {
    const s = this.s;
    if (s.stage === 'neural') return false;
    const t = s.neuralTimes;
    // Longer authored distances take longer, so the camera never rushes through the scene.
    let move = 0;
    if (s.stage === 'neuralMove') {
      const a = t[s.neuralIdx] ?? 0; const b = t[s.neuralIdx + 1] ?? 0;
      move = clamp(1.5 + Math.abs(b - a) / 6, 1.8, 4.5);
      // Scoped extension only where the actual camera path demands it (bounded by the provider; never < 1).
      const extra = this.neuralLegScale?.(a, b, (this.travelMs * move) / 1000);
      if (extra !== undefined && Number.isFinite(extra)) move *= clamp(extra, 1, NEURAL_LEG_SCALE_MAX);
    }
    const k = s.stage === 'neuralIn' ? 1.7 : s.stage === 'neuralOut' ? LEG_K : move; // neuralOut: the shared globe-leg scale curve
    if (s.legRev) { // a recorded leg played backwards: the very same pose / path, progress running 1 -> 0
      s.neuralP = Math.max(0, s.neuralP - (dtMs * (s.stage === 'neuralOut' ? outboundLateBoost(s.neuralP) : 1)) / (this.travelMs * k));
      if (s.stage === 'neuralOut') { s.globeP = s.neuralP; s.globeEased = easeInOut(s.neuralP); }
      if (s.neuralP > 0) return true;
      s.neuralP = 0;
      s.stage = s.stage === 'neuralIn' ? 'selected' : 'neural'; // neuralIn reversed = the pane returns to its camera hold
      this.land();
      this.emit(null);
      return true;
    }
    s.neuralP = Math.min(1, s.neuralP + (dtMs * (s.stage === 'neuralOut' ? outboundLateBoost(s.neuralP) : 1)) / (this.travelMs * k));
    if (s.stage === 'neuralOut') { s.globeP = s.neuralP; s.globeEased = easeInOut(s.neuralP); }
    if (s.neuralP < 1) return true;
    s.neuralP = 0;
    if (s.stage === 'neuralOut') this.finishNeural();
    else {
      if (s.stage === 'neuralMove') s.neuralIdx++;
      s.stage = 'neural';
      this.land();
      this.emit(null);
    }
    return true;
  }

  /** Pulled all the way back: the cyberglobe is now the hold; the next intent rotates a city and zooms into its feed. */
  private finishNeural() {
    const s = this.s;
    s.neuralFeeds = []; s.neuralAnchors = []; s.neuralTimes = []; s.neuralIdx = 0;
    s.globeP = 1; s.globeEased = 1; s.travelP = 0; s.travelEased = 0; s.destId = null;
    s.selectedId = null; s.progress = 0; s.eased = 0;
    this.rot = null; this.gdir = 0; this.tdir = 0; this.entryAnchor = null; s.entryTileId = null;
    s.stage = 'globe';
    this.land();
    this.emit(null);
  }

  private updateFloat(dtMs: number): boolean {
    const s = this.s;
    if (s.stage === 'floating') return false;
    const k = s.stage === 'floatIn' ? 1.7 : s.stage === 'floatMove' ? 1.9 : 1.4;
    if (s.legRev) { // a recorded leg played backwards (progress 1 -> 0): same field path, opposite direction
      s.floatP = Math.max(0, s.floatP - dtMs / (this.travelMs * k));
      if (s.floatP > 0) return true;
      s.floatP = 0;
      s.stage = s.stage === 'floatIn' ? 'selected' : 'floating'; // floatIn reversed = the pane returns to its camera hold
      this.land();
      this.emit(null);
      return true;
    }
    s.floatP = Math.min(1, s.floatP + dtMs / (this.travelMs * k));
    if (s.floatP < 1) return true;
    s.floatP = 0;
    if (s.stage === 'floatOut') this.finishFloat();
    else {
      if (s.stage === 'floatMove') s.floatIdx++;
      s.stage = 'floating';
      this.land();
      this.emit(null);
    }
    return true;
  }

  /** The last pane has expanded to fullscreen: it becomes an ordinary selected camera hold on a tile of that feed. */
  private finishFloat() {
    const s = this.s;
    const feed = s.floatFeeds[s.floatFeeds.length - 1];
    const rec = this.rp ? this.hist[this.rp.to] : null; // a redone leg lands on the RECORDED camera, not a fresh anchor
    const a = rec?.kind === 'selected' ? this.resolve(rec) : feed ? this.anchorFeed?.(feed, s.worldX, s.cityId) ?? null : null;
    if (!a) { s.stage = 'floating'; this.rp = null; s.legRev = false; this.emit(null); return; } // nothing to land on: stay in the field
    s.selectedId = a.id; s.focusedId = a.id; s.pendingId = null;
    s.worldX = s.targetX = this.clampX(a.x);
    s.progress = 1; s.eased = 1; this.dir = 0;
    s.sceneCityId = null;
    s.floatFeeds = []; s.floatFraming = []; s.floatSlots = []; s.floatIdx = 0; s.floatP = 0;
    this.holds = 1;
    s.stage = 'selected';
    this.land();
    this.emit(null);
  }

  /** The mosaic has just been reached by the contraction: pull back from it to the globe. */
  private beginGlobe() {
    const s = this.s;
    s.selectedId = null; s.pendingId = null; s.destId = null;
    s.progress = 0; s.eased = 0;
    this.beginOutgoing(this.fromFeedId);
    this.dir = 0; this.tdir = 0; this.rot = null; this.gdir = 1;
    s.stage = 'globeOut';
  }

  /**
   * Common start of every outgoing (globeOut / neuralOut) leg: no inbound progress survives, the departing feed gets its
   * authored demo anchor city, and the globe is aimed at it so the shrinking pane lands on the visible front.
   */
  private beginOutgoing(feedId: string | null) {
    const s = this.s;
    s.globeP = 0; s.globeEased = 0; s.travelP = 0; s.travelEased = 0; s.destId = null;
    // The globe anchors the ACTIVE city (the actual overview of where the journey is), whatever feed is leaving. Only a
    // city-less fixture falls back to the departing feed's demo anchor city.
    const active = s.cityId ? this.cities.find((x) => x.id === s.cityId) : undefined;
    const c = (this.outCityOverride ? this.cities.find((x) => x.id === this.outCityOverride) : undefined) ?? active ?? anchorCityFor(feedId, this.cities);
    s.outFeedId = feedId; s.outCityId = c ? c.id : null;
    // This visit's route bundles: a fresh visit takes the next key; a replayed one (history back / redo) reuses the RECORDED
    // key (and, for the reversed city entry, the recorded anchor), so nothing is rerolled and no counter advances.
    const rec = this.rp ? this.hist[this.rp.to] : null;
    if (rec?.kind === 'globe') { s.routeKey = rec.routeKey; if (this.rp?.aim) s.outCityId = rec.outCityId; } else s.routeKey = ++this.routeSerial;
    if (c) { s.lon = c.lon; s.lat = c.lat; }
  }

  /** A different city every visit: not the previous city, preferably a different feed and a visible rotation. */
  private pickCity(): GlobeCity | null {
    const n = this.cities.length;
    if (!n) return null;
    const here = { lon: this.s.lon, lat: this.s.lat };
    const s = this.s;
    // The destinations this visit's route bundles lead to: the arcs on screen are the places the globe can fly to.
    const linked = new Set<string>();
    if (s.outCityId) for (const [a, b] of routeArcs(s.outCityId, s.routeKey, this.seed)) { linked.add(a); linked.add(b); }
    const fresh = (c: GlobeCity) => !this.recent.includes(c.id);
    const feedOk = (c: GlobeCity) => { const f = this.entryFeed(c); return !f || f !== this.fromFeedId; };
    // Novelty: the city's feed (verified places: one of their own feeds) is still unseen in the shared deck's cycle. A city
    // is never given a different, merely-fresh feed to look new.
    const pool = this.deck && !this.deck.hasUnseen ? new Set(this.deck.eligible([this.fromFeedId])) : null;
    // A city-owned clip is outside the (core-only) deck and unique to its city: it is novel whenever its city is `fresh`.
    const novel = (c: GlobeCity) => {
      if (this.deck?.hasUnseen) return this.deck.hasUnseen(c.id); // per-city decks: the city still has a source new to its own cycle
      if (!pool) return true;
      const f = this.entryFeed(c);
      return !!f && (pool.has(f) || !(this.deck?.ids?.includes(f) ?? true));
    };
    const far = (c: GlobeCity) => angularDistance(here.lon, here.lat, c.lon, c.lat) >= 0.5;
    const ok = [
      (c: GlobeCity) => novel(c) && fresh(c) && feedOk(c) && far(c) && linked.has(c.id),
      (c: GlobeCity) => novel(c) && fresh(c) && feedOk(c) && far(c),
      (c: GlobeCity) => novel(c) && c.id !== this.lastCityId && feedOk(c),
      (c: GlobeCity) => c.id !== this.lastCityId && feedOk(c) && far(c),
      (c: GlobeCity) => c.id !== this.lastCityId && feedOk(c),
      (c: GlobeCity) => c.id !== this.lastCityId,
      () => true,
    ];
    const rnd = mulberry32((Math.imul(this.seed | 0, 0x9e3779b1) + this.globeVisits * 7919 + 17) | 0); // reproducible per seed; fresh picks only
    let avail = this.cities.filter((c) => { const f = this.entryFeed(c); return !f || !this.failedFeeds.has(f); }); // never a city whose own clip failed
    // Entering "another city" means a different one than the active city (the context only changes by actually entering).
    if (s.cityId) { const others = avail.filter((c) => c.id !== s.cityId); if (others.length) avail = others; }
    for (const test of ok) {
      const cands = avail.filter(test);
      if (cands.length) return cands[Math.floor(rnd() * cands.length)];
    }
    return null;
  }

  /**
   * The feed entering `city` opens: its demo / verified feed, or for a place with several real feeds the best one the shared
   * deck still offers (never a feed that does not belong to the place).
   */
  private entryFeed(city: GlobeCity): string | null {
    const own = city.feedIds && city.feedIds.length ? city.feedIds : city.feedId ? [city.feedId] : [];
    if (!own.length) return null;
    if (own.length > 1 && this.deck) {
      // The entered city's OWN deck (its novelty / history), never the departing city's.
      const order = this.deck.eligibleFor ? this.deck.eligibleFor(city.id, []) : this.deck.eligible([this.fromFeedId]);
      const hit = order.find((f) => own.includes(f));
      if (hit) return hit;
      const alt = own.filter((f) => f !== this.fromFeedId);
      return alt[0] ?? own[0];
    }
    return own[0];
  }

  /** Globe hold -> fresh intent: choose a different city, rotate it to the front, then enter it. One leg. */
  private beginCityLeg(): 'ok' | 'wait' | 'none' {
    const s = this.s;
    let city = this.pickCity();
    // The city's own clip must be showable before the leg starts: otherwise the globe hold stays (one pending intent) or,
    // when that clip failed for good, the city is skipped. Never another video under this city's name.
    for (let guard = 0; city && this.cityStatus && guard < this.cities.length; guard++) {
      const f = this.entryFeed(city);
      const st = f && (this.ctx || isCityFeed(f)) ? this.cityStatus(f) : 'ready';
      if (st === 'ready') break;
      if (st === 'wait') return 'wait';
      this.failedFeeds.add(f!);
      city = this.pickCity();
    }
    if (!city) return 'none';
    this.globeVisits++;
    this.lastCityId = city.id;
    this.recent.push(city.id); if (this.recent.length > 6) this.recent.shift();
    // The camera that will open is fixed now, so the whole entry zooms toward ITS place in the regional field.
    const feed = this.entryFeed(city);
    s.entryFeedId = feed;
    const a = feed ? this.anchorFeed?.(feed, s.worldX, city.id) ?? null : null; // a tile of the DESTINATION city's own mosaic
    this.rotateToCity(city, a);
    return 'ok';
  }

  /** Globe hold: asks (once per visit) for the next city's clip so it is warm by the time the intent arrives. Pure peek. */
  private prewarmNextCity() {
    if (!this.cityStatus || this.peeked === this.globeVisits || this.cursor < this.hist.length - 1) return;
    this.peeked = this.globeVisits;
    const city = this.pickCity();
    const f = city ? this.entryFeed(city) : null;
    if (f && (this.ctx || isCityFeed(f))) this.cityStatus(f);
  }

  /** Rotate the globe to `city` and enter it, landing on `a` (chosen fresh, or the recorded tile of a redone entry). */
  private rotateToCity(city: GlobeCity, a: { id: string; x: number } | null) {
    const s = this.s;
    s.destId = city.id;
    this.entryAnchor = a; s.entryTileId = a ? a.id : null;
    if (a) s.worldX = s.targetX = this.clampX(a.x);
    const from = { lon: s.lon, lat: s.lat };
    const dist = angularDistance(from.lon, from.lat, city.lon, city.lat);
    if (dist < 1e-6) { s.lon = city.lon; s.lat = city.lat; this.rot = null; this.startEntry(); }
    else {
      this.rot = { from, to: { lon: city.lon, lat: city.lat }, t: 0, ms: this.travelMs * (0.9 + (1.1 * dist) / Math.PI) };
      s.stage = 'turning';
    }
  }

  private startEntry() { this.tdir = 1; this.s.stage = 'entering'; }

  /** Entry finished: the same feed becomes an ordinary selected camera hold on its mosaic tile. */
  private finishEntry() {
    const s = this.s;
    const city = this.cities.find((c) => c.id === s.destId);
    const feed = s.entryFeedId ?? city?.feedId;
    const a = this.entryAnchor ?? (feed ? this.anchorFeed?.(feed, s.worldX, city?.id ?? s.cityId) ?? null : null);
    this.tdir = 0; this.entryAnchor = null; s.entryTileId = null; s.entryFeedId = null;
    if (!a) { // nothing to land on: stay at the globe rather than show an empty pane
      s.travelP = 0; s.travelEased = 0; s.destId = null; s.stage = 'globe'; this.rp = null; s.legRev = false;
      this.syncCurrent(); this.emit(null); return;
    }
    s.selectedId = a.id; s.focusedId = a.id; s.pendingId = null;
    s.worldX = s.targetX = this.clampX(a.x);
    s.progress = 1; s.eased = 1; this.dir = 0;
    s.sceneCityId = city ? city.id : null; s.destId = null;
    if (city && this.ctx) this.setCity(city.id); // the globe actually ENTERED this city: the context is committed at arrival
    s.globeP = 0; s.globeEased = 0; s.travelP = 0; s.travelEased = 0;
    this.holds = 1;
    s.stage = 'selected';
    this.land();
    this.emit(null);
  }

  /** The globe pullback reached its hold. A reversed city entry first rotates back to where the globe was. */
  private globeArrived() {
    const s = this.s; const aim = this.rp?.aim;
    if (aim && angularDistance(s.lon, s.lat, aim.lon, aim.lat) >= 1e-6) {
      const dist = angularDistance(s.lon, s.lat, aim.lon, aim.lat);
      this.rot = { from: { lon: s.lon, lat: s.lat }, to: { lon: aim.lon, lat: aim.lat }, t: 0, ms: this.travelMs * (0.9 + (1.1 * dist) / Math.PI), back: true };
      s.stage = 'turning';
      this.emit(null);
      return;
    }
    s.stage = 'globe';
    this.land();
    this.emit(null);
  }

  private updateGlobe(dtMs: number): boolean {
    const s = this.s;
    let changed = false;
    if (this.gdir === 1) {
      s.globeP = clamp(s.globeP + (dtMs * outboundLateBoost(s.globeP)) / (this.travelMs * OUT_K), 0, 1);
      s.globeEased = easeInOut(s.globeP);
      changed = true;
      if (s.globeP >= 1) { this.gdir = 0; this.globeArrived(); }
    }
    if (this.tdir === 1) {
      s.travelP = clamp(s.travelP + dtMs / (this.travelMs * LEG_K), 0, 1); // the outbound curve, reversed
      s.travelEased = easeInOut(s.travelP);
      changed = true;
      if (s.travelP >= 1) { this.finishEntry(); return true; }
    }
    if (this.tdir === -1) { // a recorded city entry played backwards: the same curve and speed, travelP 1 -> 0
      s.travelP = clamp(s.travelP - dtMs / (this.travelMs * LEG_K), 0, 1);
      s.travelEased = easeInOut(s.travelP);
      changed = true;
      if (s.travelP <= 0) {
        this.tdir = 0; s.entryFeedId = null; s.entryTileId = null; s.destId = null;
        s.globeP = 1; s.globeEased = 1; s.travelP = 0; s.travelEased = 0;
        const rec = this.rp ? this.hist[this.rp.to] : null;
        if (rec?.kind === 'globe') s.outFeedId = rec.outFeedId;
        this.globeArrived();
        return true;
      }
    }
    if (this.rot) {
      const r = this.rot;
      r.t = Math.min(1, r.t + dtMs / r.ms);
      const a = lerpAim(r.from, r.to, r.t);
      s.lon = a.lon; s.lat = a.lat;
      changed = true;
      if (r.t >= 1) {
        s.lon = r.to.lon; s.lat = r.to.lat; this.rot = null;
        if (r.back) { s.stage = 'globe'; this.land(); } else this.startEntry();
        this.emit(null);
      }
    }
    return changed;
  }

  /**
   * Re-anchor a focused hold after the layout was refitted (resize / orientation change):
   * keeps the hold, points it at the equivalent tile of the same feed and re-centres the world.
   */
  rebase(id: string, x: number): boolean {
    const s = this.s;
    if (s.stage !== 'selected') return false;
    s.selectedId = id; s.focusedId = id;
    s.worldX = s.targetX = this.clampX(x);
    this.syncCurrent(); // history keeps the hold as it is NOW (same feed/year, the refitted tile)
    this.emit(null);
    return true;
  }

  /** Move the world immediately (direct drag). Only honoured in the mosaic stage. */
  dragTo(x: number) {
    if (this.s.stage !== 'mosaic') return;
    this.s.worldX = this.s.targetX = this.clampX(x);
  }

  /** Advance motion by dtMs. Returns true when anything visible changed. */
  update(dtMs: number): boolean {
    const s = this.s;
    if (this.pending) this.retryPending();
    else if (s.stage === 'globe') this.prewarmNextCity();
    if (isGlobeStage(s.stage)) return this.updateGlobe(dtMs);
    if (isFloatStage(s.stage)) return this.updateFloat(dtMs);
    if (isNeuralStage(s.stage)) return this.updateNeural(dtMs);
    if (s.stage === 'scanning') {
      s.scanP = Math.min(1, s.scanP + dtMs / this.scanMs);
      s.worldX = s.targetX = this.scanFrom + (this.scanTo - this.scanFrom) * easeInOut(s.scanP);
      if (s.scanP >= 1) {
        s.worldX = s.targetX = this.scanTo;
        if (this.rp?.mosaicX !== undefined) { s.stage = 'mosaic'; this.land(); } // reverse of the first leg: back to the mosaic hold
        else { this.dir = 1; s.stage = 'expanding'; }
        this.emit(null);
      }
      return true;
    }
    let changed = false;
    if (this.dir !== 0) {
      const span = s.globeLeg ? this.travelMs * CONTRACT_K : this.travelMs; // a globe leg's first sector is paced by the shared curve
      s.progress = clamp(s.progress + (this.dir * dtMs) / span, 0, 1);
      const arrived = (this.dir === 1 && s.progress >= 1) || (this.dir === -1 && s.progress <= 0);
      if (arrived) this.dir = 0;
      const stageChanged = this.recompute();
      changed = true;
      if (stageChanged) {
        if (s.stage === 'mosaic') {
          s.selectedId = null;
          const pending = s.pendingId;
          s.pendingId = null;
          const kind = this.legKind; this.legKind = 'camera'; s.globeLeg = false;
          const next = pending ? null : this.legTarget;
          this.legTarget = null;
          if (pending) { this.rp = null; s.legRev = false; this.outCityOverride = null; }
          const backX = this.rp?.mosaicX;
          if (kind === 'globe' && !pending) this.beginGlobe();
          else if (next) this.beginScan(next);
          else if (!pending && backX !== undefined && Math.abs(s.worldX - backX) >= 1) this.beginScanBack(backX);
          else if (!pending) this.land(); // a real mosaic hold (return command / reverse of the first leg)
          this.emit(null);
          if (pending) this.dispatch({ type: 'select', id: pending });
          return true;
        }
        if (s.stage === 'selected') { this.holds++; this.land(); }
        this.emit(null);
      }
    } else if (s.stage === 'mosaic' && s.worldX !== s.targetX) {
      const k = 1 - Math.exp(-dtMs / 85);
      const next = s.worldX + (s.targetX - s.worldX) * k;
      s.worldX = Math.abs(s.targetX - next) < 0.25 ? s.targetX : next;
      changed = true;
    }
    return changed;
  }
}

/**
 * Real elapsed frame time for the integrator. Low frame rates must not slow a
 * requested transition down, so this is not clamped to a few frames; it is only
 * bounded by `maxMs` (default: longer than a full travel) so a hidden-tab resume
 * cannot produce an unbounded step.
 */
export function frameDelta(now: number, last: number, maxMs = 1000): number {
  const dt = now - last;
  return dt > 0 ? Math.min(dt, maxMs) : 0;
}

/** The lateral year axis bound to world position: the viewport centre selects the year. */
export function yearAxis(worldWidth: number, viewportWidth: number, yearCount: number) {
  const start = viewportWidth / 2;
  const span = Math.max(1, worldWidth - viewportWidth);
  const seg = span / yearCount;
  return {
    start, seg, span,
    /** World x of the centre of year i. */
    centreOf: (i: number) => start + seg * (i + 0.5),
    /** Fractional year index at a given scroll offset. */
    indexAt: (worldX: number) => clamp((worldX + viewportWidth / 2 - start) / seg, 0, yearCount - 1e-6),
    /** Scroll offset that centres year i. */
    scrollFor: (i: number) => start + seg * (i + 0.5) - viewportWidth / 2,
  };
}
