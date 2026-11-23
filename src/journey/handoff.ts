/**
 * Policy for handing a shared <video> from its fullscreen DOM pane to a WebGL texture of the SAME element (pure).
 *
 * `THREE.VideoTexture` normally uploads only when `requestVideoFrameCallback` fires after it was created, so a texture
 * created at the hand-over can stay black until a later frame callback. The policy therefore never relies on that:
 *  - a texture is created as soon as the video has a decoded frame and is flagged for upload with an explicit
 *    `needsUpdate` plus an immediate `renderer.initTexture` ("warm"), even while its mesh is hidden;
 *  - it only counts as warm when that upload actually produced a GPU texture on a live context (`markUploaded`);
 *  - it is re-flagged whenever frame evidence moves (presented-frame counter, see frames.ts) OR `currentTime` moves;
 *  - a lost context invalidates every texture (`invalidate`): the DOM pane covers the hold until it is re-warmed;
 *  - the DOM pane stays over a hold until the texture is warm, so a black plane is never exposed.
 * Nothing here reloads, pauses or replaces a video, and no poster is ever substituted for the focus pane.
 */
export interface VideoLike { readyState: number; videoWidth: number; currentTime: number }
export interface TexState { warmed: boolean; lastTime: number; lastFrame?: number }
export type UploadAction = 'none' | 'warm' | 'refresh';

/** A decoded frame is available for upload. */
export const videoHasFrame = (v: VideoLike | null | undefined): v is VideoLike => !!v && v.readyState >= 2 && v.videoWidth > 0;

/** `frames`: optional frame-evidence counter (frames.ts). Either evidence moving (counter or clock) means a fresh frame. */
export function uploadAction(v: VideoLike | null | undefined, st: TexState, frames?: number): UploadAction {
  if (!videoHasFrame(v)) return 'none';
  if (!st.warmed) return 'warm';
  const moved = v.currentTime !== st.lastTime || (frames !== undefined && frames !== st.lastFrame);
  return moved ? 'refresh' : 'none';
}

/** Records an upload attempt. A warm only counts when the GPU texture exists on a live context; otherwise it is retried. */
export function markUploaded(st: TexState, action: UploadAction, v: VideoLike, frames: number | undefined, gpuOk: boolean) {
  if (action === 'none') return;
  if (action === 'warm') st.warmed = gpuOk;
  st.lastTime = v.currentTime; st.lastFrame = frames;
  if (!gpuOk) st.lastTime = -1; // not uploaded: the next frame tries again (bounded by the frame loop, no timer)
}

/** Context lost / returned: nothing is uploaded any more; the next hold frame re-warms before promotion. */
export function invalidate(st: TexState) { st.warmed = false; st.lastTime = -1; st.lastFrame = undefined; }

/** Whether the shared DOM video must still be drawn over the pane for a given leg mode. */
export function needsDomOverlay(mode: 'in' | 'hold' | 'move' | 'out', warmed: boolean): boolean {
  if (mode === 'in' || mode === 'out') return true; // the DOM pane IS the bridge animation
  if (mode === 'hold') return !warmed;
  return false;
}
