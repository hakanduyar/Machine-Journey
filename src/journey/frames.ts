/**
 * Decoded-frame evidence for the shared <video> pool (structural types, so it is testable without a DOM).
 *
 * `currentTime` alone is weak evidence: it can plateau while frames are still presented (dropped / repeated frames) and
 * says nothing about whether any frame was ever decoded. This module offers, in order of preference:
 *   1. a presented-frame counter driven by `requestVideoFrameCallback` (event driven, re-armed only by a delivered frame,
 *      so it never runs on a timer and stops by itself while the video is paused);
 *   2. `getVideoPlaybackQuality().totalVideoFrames` where there is no RVFC;
 *   3. nothing (callers then fall back to `currentTime`).
 * It never plays, pauses, seeks, reloads or replaces a video.
 */
export interface FrameVideo {
  readyState: number; videoWidth: number; currentTime: number;
  requestVideoFrameCallback?: (cb: () => void) => number;
  getVideoPlaybackQuality?: () => { totalVideoFrames: number };
}

const counts = new WeakMap<object, number>();
const decoded = new WeakSet<object>();

/** Starts counting presented frames of `v` (idempotent). Where RVFC is missing this is a no-op. */
export function trackFrames(v: FrameVideo | null | undefined) {
  if (!v || typeof v.requestVideoFrameCallback !== 'function' || counts.has(v)) return;
  counts.set(v, 0);
  const tick = () => { counts.set(v, (counts.get(v) ?? 0) + 1); v.requestVideoFrameCallback!(tick); };
  v.requestVideoFrameCallback(tick);
}

/** A number that changes whenever a new frame was presented/decoded, or undefined when no evidence source exists. */
export function frameCount(v: FrameVideo | null | undefined): number | undefined {
  if (!v) return undefined;
  if (counts.has(v)) return counts.get(v);
  try { return v.getVideoPlaybackQuality?.().totalVideoFrames; } catch { return undefined; }
}

/** Freshness stamp for canvas / texture refresh: frame evidence where it exists, else `currentTime`. */
export const frameStamp = (v: FrameVideo): number => frameCount(v) ?? v.currentTime;

/**
 * True once the element has shown real decoded-frame evidence: dimensions + a current frame (readyState >= 2), and, when
 * a frame counter exists, either a counted frame or a moved clock. Sticky: after promotion the element keeps its last frame
 * through ordinary buffering dips, so a promoted pane never flickers back to the poster.
 */
export function isDecoded(v: FrameVideo | null | undefined): boolean {
  if (!v) return false;
  if (decoded.has(v)) return true;
  if (v.readyState < 2 || !(v.videoWidth > 0)) return false;
  const n = frameCount(v);
  if (n !== undefined && n <= 0 && !(v.currentTime > 0)) return false;
  decoded.add(v);
  return true;
}
