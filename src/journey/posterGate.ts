/**
 * Lightweight poster readiness for the cold opening collage (pure bookkeeping, no video involved).
 *
 * The mosaic is painted from the existing small poster images until a feed's decoder has a frame. The collage is revealed
 * once its tiles are painted from decoded posters - never gated on all videos. A slow / failed load never reveals a blank
 * grid: after `COLLAGE_MAX_WAIT_MS` the cover switches to a readable status and keeps waiting (see `collageStatus`).
 */
export type PosterState = 'pending' | 'ready' | 'failed';

export const COLLAGE_MAX_WAIT_MS = 2500;

export interface PosterEntry { img: HTMLImageElement; state: PosterState }

export interface PosterImage {
  src: string; complete: boolean; naturalWidth: number;
  onload: unknown; onerror: unknown;
  decode?: () => Promise<void>;
}

/** Start loading + decoding every poster immediately (idempotent per call site: callers keep the returned entries). */
export function loadPosters<T extends PosterImage>(urls: readonly string[], make: () => T): { img: T; state: PosterState }[] {
  return urls.map((url) => {
    const img = make();
    const entry: { img: T; state: PosterState } = { img, state: 'pending' };
    const ok = () => { if (entry.state === 'pending') entry.state = 'ready'; };
    const bad = () => { if (entry.state === 'pending') entry.state = 'failed'; };
    img.onerror = bad;
    if (typeof img.decode === 'function') {
      // decode() resolves once the bitmap is decoded, so the first drawImage does not stall; a rejection is only a failure
      // when the image is genuinely unusable.
      img.src = url;
      img.decode().then(ok, () => (img.complete && img.naturalWidth > 0 ? ok() : bad()));
    } else {
      img.onload = ok;
      img.src = url;
    }
    return entry;
  });
}

export type CollageStatus = 'loading' | 'slow' | 'failed' | 'ready';

/**
 * What the cold-opening cover shows. The collage is NEVER revealed blank: it needs the first-view tiles painted AND real
 * evidence (a decoded poster, or `evidence` = a video frame already drawn). A timeout only changes the message ('slow'),
 * it never lifts the cover; late posters / frames still complete it automatically. A poster that failed while others are
 * ready is a deliberate dark tile; every poster failed (and no video frame) is the explicit 'failed' status, not an empty grid.
 */
export function collageStatus(states: readonly PosterState[], waitedMs: number, painted: boolean, evidence = false, slowMs = COLLAGE_MAX_WAIT_MS): CollageStatus {
  const anyReady = evidence || states.some((s) => s === 'ready');
  const pending = states.some((s) => s === 'pending');
  if (painted && anyReady && (!pending || evidence)) return 'ready';
  if (!evidence && states.length > 0 && states.every((s) => s === 'failed')) return 'failed';
  return waitedMs >= slowMs ? 'slow' : 'loading';
}

/** True once the collage may be revealed (see `collageStatus`). Independent of whether all videos are ready. */
export function collageReady(states: readonly PosterState[], waitedMs: number, painted = true, evidence = false): boolean {
  return collageStatus(states, waitedMs, painted, evidence) === 'ready';
}
