/**
 * Neural bridge route planning (pure). The authored scene has eight screen anchors with hold windows
 * (manifest `anchors`). A visit picks 2..4 of them as camera stops; the camera later seeks the authored clip
 * to each hold's midpoint (stationary hold) and travels between them along the authored route.
 */
export interface NeuralHold { screen: string; holdStart: number; holdEnd: number }
export interface NeuralPlan { feeds: string[]; anchors: number[]; times: number[] }

/** Feed that naturally belongs to each authored screen anchor (same order as the manifest anchors). */
export const ANCHOR_FEEDS: readonly string[] = [
  'parking-walk', 'covered-road', 'm06', 'm04', 'm07', 'm01', 'm02', 'm03',
];
export const holdMid = (h: NeuralHold) => (h.holdStart + h.holdEnd) / 2;

/**
 * Stop 0 is the screen of the feed that was fullscreen (so the shared pane shrinks into its own screen); a feed with
 * no authored screen is placed on a rotating anchor. Later stops continue in ONE direction along the authored route
 * (monotonic, so no earlier focused pane is re-crossed), are 1..3 anchors apart, never reuse an anchor or a feed, and
 * show the feed that belongs to that screen. Direction is chosen among those with enough remaining anchors.
 */
export function planNeuralRoute(
  fromFeedId: string | null, stops: number, visit: number, holds: readonly NeuralHold[],
  /**
   * Feeds for stops 1..n-1 (from the shared deck). A screen anchor is only a SPATIAL slot: any feed can be shown on any
   * anchor (the world binds a video texture per stop). Absent: each later stop shows the anchor's natural feed.
   */
  destFeeds?: readonly string[],
): NeuralPlan | null {
  const n = Math.max(2, Math.min(4, Math.round(stops)));
  const count = Math.min(holds.length, ANCHOR_FEEDS.length);
  if (count < n) return null;
  const natural = fromFeedId ? ANCHOR_FEEDS.indexOf(fromFeedId) : -1;
  const first = natural >= 0 && natural < count ? natural : (visit * 3 + 1) % count;
  // One direction per visit: the route is monotonic along the authored timeline, so the camera never travels back
  // through a pane/corridor it already focused. A direction is valid only if it has room for all n-1 further stops.
  const room = (d: number) => (d > 0 ? count - 1 - first : first);
  const valid = [1, -1].filter((d) => room(d) >= n - 1);
  if (valid.length === 0) return null;
  const dir = valid[(visit + first) % valid.length];
  const slack = room(dir);
  const anchors = [first];
  const feeds = [fromFeedId ?? ANCHOR_FEEDS[first]];
  let used = 0;
  for (let k = 1; k < n; k++) {
    // leave at least 1 anchor of room for each remaining stop; step 1..3, varied deterministically per visit
    const maxStep = Math.min(3, slack - used - (n - 1 - k));
    const step = 1 + ((visit * 2 + k + first) % maxStep);
    used += step;
    const pick = first + dir * used;
    const feed = destFeeds ? destFeeds[k - 1] : ANCHOR_FEEDS[pick];
    if (!feed || feeds.includes(feed)) return null; // never reuse an actual feed within a visit; no duplicate fallback
    anchors.push(pick); feeds.push(feed);
  }
  return { feeds, anchors, times: anchors.map((a) => holdMid(holds[a])) };
}
