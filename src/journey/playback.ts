import type { Stage } from './controller';

/**
 * Desired-playback policy for the ten shared <video> elements (pure, DOM-free). The elements are never created, reloaded,
 * re-sourced or seeked here: a paused feed simply resumes from its stored currentTime when it is wanted again.
 *
 *  - settled globe hold ........................ nothing plays
 *  - ordinary selected fullscreen camera hold .. only the selected feed plays (also while a manual intent is still pending)
 *  - globe turning (requested city leg) ......... only the target city's feed plays: it is warmed before it is shown
 *  - floating field / neural scene and their in / move / out legs: only the focused feed and the leg's other end decode
 *    (max 3, see `routeActive`); every other feed stays paused on its last good frame, which the distant planes keep showing
 *  - everything else (visible mosaic, the globe bridges) decodes only the `live` viewport budget when given (the rest show their
 *    static poster / last frame); without `live` (legacy callers) it keeps the full pool playing.
 */
export interface PlaybackInput {
  stage: Stage;
  /** Feed index of the open (selected) camera, or -1. */
  selectedFeed: number;
  /** Feed index of the city being rotated to / entered, or -1. */
  targetFeed: number;
  feedCount: number;
  /** Elements below this index are the original (core) pool; the rest are lazily attached city clips. Default: all core. */
  coreCount?: number;
  /** City-clip element indices (>= coreCount) in use right now (entering / open / leaving); only these may join "the pool". */
  extra?: readonly number[];
  /** One manual intent is waiting for its mode to load: the visible camera must keep playing. */
  pending?: boolean;
  /**
   * Element indices of the ACTIVE CITY's feeds. When given, "the whole pool" is exactly these (plus `extra`): a foreign
   * city's / unowned clip never decodes. Absent: the legacy core-prefix pool.
   */
  pool?: readonly number[];
  /** Floating / neural stages only: feed indices wanted (see `routeActive`), capped at MAX_ACTIVE_FEEDS. Absent: whole pool. */
  active?: readonly number[];
  /**
   * Mosaic / navigation stages: the feeds the viewport budget allows to decode (8 desktop / 4 narrow, incoming target included,
   * see `selectViewportFeeds`). When given it replaces "the whole pool" for every stage that would otherwise play it.
   */
  live?: readonly number[];
}

/** Most feeds the floating field / neural scene (and their bridges) may keep decoding at once. */
export const MAX_ACTIVE_FEEDS = 3;
const ROUTE_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  'floatIn', 'floating', 'floatMove', 'floatOut', 'neuralIn', 'neural', 'neuralMove', 'neuralOut',
]);

/**
 * Feeds that must decode during a floating / neural stage: the focused feed, plus (while a leg travels between two stops)
 * the leg's other end. Direction-agnostic on purpose: a reversed history leg runs between the very same two stops, so the
 * pair is identical, only the roles swap. A settled hold keeps just its focus; the next destination is resumed (from its
 * retained current time, paused-with-last-frame until then) the moment its leg starts. Returns [] outside route stages.
 */
export function routeActive(o: {
  stage: Stage; floatFeeds: readonly string[]; floatIdx: number; neuralFeeds: readonly string[]; neuralIdx: number;
  feedIds: readonly string[]; reverse?: boolean;
}): number[] {
  const idxOf = (id: string | undefined) => (id === undefined ? -1 : o.feedIds.indexOf(id));
  let ids: (string | undefined)[] = [];
  const f = o.floatFeeds; const n = o.neuralFeeds;
  switch (o.stage) {
    case 'floating': ids = [f[o.floatIdx]]; break;
    case 'floatIn': ids = [f[0]]; break;
    case 'floatOut': ids = [f[f.length - 1]]; break;
    case 'floatMove': ids = o.reverse ? [f[o.floatIdx + 1], f[o.floatIdx]] : [f[o.floatIdx], f[o.floatIdx + 1]]; break;
    case 'neural': ids = [n[o.neuralIdx]]; break;
    case 'neuralIn': ids = [n[0]]; break;
    case 'neuralOut': ids = [n[n.length - 1]]; break;
    case 'neuralMove': ids = o.reverse ? [n[o.neuralIdx + 1], n[o.neuralIdx]] : [n[o.neuralIdx], n[o.neuralIdx + 1]]; break;
    default: return [];
  }
  return [...new Set(ids.map(idxOf).filter((x) => x >= 0))].slice(0, MAX_ACTIVE_FEEDS);
}

export function desiredPlayback(i: PlaybackInput): boolean[] {
  const core = i.coreCount ?? i.feedCount;
  const only = (idx: number) => Array.from({ length: i.feedCount }, (_, k) => k === idx);
  // "The whole pool" is the CORE pool plus only the city clips currently in use: the other city clips never decode.
  // With `live` (the viewport budget, see viewportFeeds.ts) the fallback is EXACTLY that bounded set: never the whole pool.
  const all = () => (i.live
    ? Array.from({ length: i.feedCount }, (_, k) => i.live!.includes(k))
    : Array.from({ length: i.feedCount }, (_, k) => (i.pool ? i.pool.includes(k) : k < core) || (i.extra?.includes(k) ?? false)));
  if (i.active && ROUTE_STAGES.has(i.stage)) {
    const set = [...new Set(i.active.filter((x) => x >= 0 && x < i.feedCount))].slice(0, MAX_ACTIVE_FEEDS);
    if (set.length) return Array.from({ length: i.feedCount }, (_, k) => set.includes(k)); // unknown route: never pause what might be visible
  }
  switch (i.stage) {
    case 'globe':
      return Array.from({ length: i.feedCount }, () => false);
    case 'selected':
      return i.selectedFeed >= 0 ? only(i.selectedFeed) : all(); // unknown camera: never pause what might be visible
    case 'turning':
      return i.targetFeed >= 0 ? only(i.targetFeed) : all();
    case 'entering': {
      // City-scoped pool (a city may own several clips): the geographic entry decodes the ready target + the current endpoint
      // (`extra`) plus a small near set of the city's own feeds, never more than the spatial cap. Legacy callers keep the pool.
      if (!i.pool) return all();
      const want = [...new Set([i.targetFeed, ...(i.extra ?? []), ...i.pool].filter((x) => x >= 0 && x < i.feedCount))].slice(0, MAX_ACTIVE_FEEDS);
      return Array.from({ length: i.feedCount }, (_, k) => want.includes(k));
    }
    default:
      return all();
  }
}

export interface PlayableVideo {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  play(): Promise<void> | void;
  pause(): void;
}

/**
 * Applies the desired set. Cheap per frame (ten comparisons) but play()/pause() are only called on an actual difference:
 * at most one play attempt in flight per video, and a refused attempt backs off (500 ms doubling, 4 s cap) instead of
 * retrying every frame. `unlock()` (a user gesture) clears the back-off; it never plays anything that is not wanted.
 */
export class PlaybackDriver {
  private inflight = new Set<number>();
  private retryAt = new Map<number, number>();
  private fails = new Map<number, number>();
  private now = 0;

  unlock() { this.retryAt.clear(); this.fails.clear(); }

  apply(desired: readonly boolean[], videos: readonly (PlayableVideo | null | undefined)[], now: number) {
    this.now = now;
    videos.forEach((v, i) => {
      if (!v) return;
      if (desired[i]) {
        if (v.paused && !v.ended && v.readyState >= 2 && !this.inflight.has(i) && now >= (this.retryAt.get(i) ?? 0)) this.start(i, v);
      } else if (!v.paused && !this.inflight.has(i)) v.pause();
    });
  }

  private start(i: number, v: PlayableVideo) {
    this.inflight.add(i);
    let p: Promise<void>;
    try { p = Promise.resolve(v.play()); } catch { p = Promise.reject(new Error('play')); }
    p.then(
      () => { this.inflight.delete(i); this.fails.delete(i); this.retryAt.delete(i); },
      () => {
        this.inflight.delete(i);
        const n = (this.fails.get(i) ?? 0) + 1;
        this.fails.set(i, n);
        this.retryAt.set(i, this.now + Math.min(4000, 500 * 2 ** (n - 1)));
      },
    );
  }
}
