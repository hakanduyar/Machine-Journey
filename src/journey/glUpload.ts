import type { Texture, WebGLRenderer } from 'three';

/**
 * Explicit texture upload that reports whether a GPU texture really exists afterwards (live context, uploaded object).
 * `initTexture` on a lost context silently does nothing, so a "warm" flag must not be set from the call alone.
 */
export function uploadNow(r: WebGLRenderer, tex: Texture): boolean {
  try {
    if (r.getContext().isContextLost()) return false;
    r.initTexture(tex);
    return !!(r.properties.get(tex) as { __webglTexture?: unknown }).__webglTexture;
  } catch { return false; }
}

/** WebGL context loss / restore of one renderer. Loss is prevented from being final (preventDefault) so restore can fire. */
export function watchContext(r: WebGLRenderer, onLost: () => void, onRestored: () => void): () => void {
  const el = r.domElement;
  const lost = (ev: Event) => { ev.preventDefault(); onLost(); };
  const back = () => onRestored();
  el.addEventListener('webglcontextlost', lost);
  el.addEventListener('webglcontextrestored', back);
  return () => { el.removeEventListener('webglcontextlost', lost); el.removeEventListener('webglcontextrestored', back); };
}
