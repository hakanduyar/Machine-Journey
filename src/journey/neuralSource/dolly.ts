import type { Object3D } from "three";

/**
 * Draws with the authored camera pulled back along its own Z by `amount * distance`, then restores the camera's
 * authored local position EXACTLY.
 *
 * Why not just `camera.translateZ(...)` per frame: the rig re-evaluates the authored clip with `mixer.update(0)`, and
 * three's PropertyMixer only writes a track value back when its own cached value changed. While the authored time is
 * held constant (the pull-back to the globe, or any repeated pose sample) the mixer therefore never rewrites the
 * camera, so a transient offset would persist and, applied again every frame, accumulate. Restoring after the draw
 * keeps the offset a pure function of `amount`: dolly 1 -> .5 -> 0 at the same time lands back on the exact base pose.
 */
export function withDolly<T>(camera: Object3D, amount: number, distance: number, draw: () => T): T {
  if (!(amount > 0)) return draw();
  const { x, y, z } = camera.position;
  camera.translateZ(amount * distance);
  camera.updateMatrixWorld(true);
  try {
    return draw();
  } finally {
    camera.position.set(x, y, z);
    camera.updateMatrixWorld(true);
  }
}
