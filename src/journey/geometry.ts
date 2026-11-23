export interface Rect { x: number; y: number; w: number; h: number }
/** Crop parameters of a source frame: zoom >= 1 and normalized centre. */
export interface CropParams { z: number; cx: number; cy: number }
/** Normalized source rectangle (0..1 of the frame). */
export interface SrcRect { sx: number; sy: number; sw: number; sh: number }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
});

export const lerpCrop = (a: CropParams, b: CropParams, t: number): CropParams => ({
  z: lerp(a.z, b.z, t), cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t),
});

/**
 * The part of a source frame shown in a box of the given size: "cover" fit at
 * zoom z, centred on (cx, cy) and clamped so it never leaves the frame.
 */
export function computeCrop(boxW: number, boxH: number, srcAspect: number, c: CropParams): SrcRect {
  const boxAspect = boxW / boxH;
  let sw: number;
  let sh: number;
  if (boxAspect >= srcAspect) { sw = 1; sh = srcAspect / boxAspect; }
  else { sw = boxAspect / srcAspect; sh = 1; }
  sw /= c.z; sh /= c.z;
  return {
    sx: clamp(c.cx - sw / 2, 0, 1 - sw),
    sy: clamp(c.cy - sh / 2, 0, 1 - sh),
    sw, sh,
  };
}

/** Box (px, relative to the pane) a <video> must occupy so `crop` fills a pane of size w x h. */
export function videoBoxForCrop(w: number, h: number, crop: SrcRect): Rect {
  const dw = w / crop.sw;
  const dh = h / crop.sh;
  return { x: -crop.sx * dw, y: -crop.sy * dh, w: dw, h: dh };
}
