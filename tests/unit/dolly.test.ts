import { describe, expect, it } from 'vitest';
import { AnimationClip, Object3D, PerspectiveCamera, Vector3, VectorKeyframeTrack } from 'three';
import { createSceneRig } from '../../src/journey/neuralSource/sceneRig';
import { withDolly } from '../../src/journey/neuralSource/dolly';

function rig() {
  const root = new Object3D();
  const cam = new PerspectiveCamera(); cam.name = 'Cam';
  const screen = new Object3D(); screen.name = 'Screen';
  root.add(cam, screen);
  const clip = new AnimationClip('Take', 10, [new VectorKeyframeTrack('Cam.position', [0, 10], [0, 0, 0, 40, 20, -60])]);
  root.updateMatrixWorld(true);
  return { cam, rig: createSceneRig(root, [clip], { cameraName: 'Cam', clipName: 'Take', durationSeconds: 10, focalScreenName: 'Screen' }) };
}
const pos = (c: Object3D) => [c.position.x, c.position.y, c.position.z];

describe('neural dolly is transient: repeated same-time renders never accumulate an offset', () => {
  it('dolly 1 -> .5 -> 0 at one authored time returns the exact base pose (real AnimationMixer semantics)', () => {
    const { cam, rig: r } = rig();
    r.seek(5);
    const base = pos(cam);
    const seen: number[][] = [];
    for (const d of [1, 1, 0.5, 0.5, 0.25, 0]) {
      r.seek(5); // same authored time every frame, exactly as the pull-back holds it
      withDolly(cam, d, 2600, () => seen.push(pos(cam)));
      expect(pos(cam)).toEqual(base); // restored after every draw, whatever the mixer chooses to rewrite
    }
    // inside the draw the offset is absolute (base + local -Z... translateZ), not compounded by the earlier frames
    const along = (p: number[]) => Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]);
    expect(along(seen[0])).toBeCloseTo(2600, 3);
    expect(along(seen[1])).toBeCloseTo(2600, 3);
    expect(along(seen[2])).toBeCloseTo(1300, 3);
    expect(along(seen[4])).toBeCloseTo(650, 3);
    expect(along(seen[5])).toBeCloseTo(0, 6);
  });

  it('the unrestored pattern DOES leave the camera displaced (the bug this guards against)', () => {
    const { cam, rig: r } = rig();
    r.seek(5);
    const base = pos(cam);
    for (const d of [1, 0.5, 0]) { r.seek(5); if (d > 0) { cam.translateZ(d * 2600); cam.updateMatrixWorld(true); } }
    expect(pos(cam)).not.toEqual(base); // mixer does not rewrite an unchanged track value
  });

  it('a point projected INSIDE the draw transform shrinks with the dolly; the restored camera would not (projection must be captured in-draw)', () => {
    const { cam, rig: r } = rig();
    cam.far = 10000; cam.updateProjectionMatrix();
    const target = new Vector3(0, 0, -300);
    const width = () => { cam.updateMatrixWorld(true); const a = target.clone().add(new Vector3(-50, 0, 0)).project(cam); const b = target.clone().add(new Vector3(50, 0, 0)).project(cam); return b.x - a.x; };
    r.seek(0);
    const w0 = width();
    let wIn = 0; let wMid = 0;
    withDolly(cam, 1, 600, () => { wIn = width(); });
    withDolly(cam, 0.5, 600, () => { wMid = width(); });
    const wAfter = width(); // what a post-render projection would (wrongly) measure
    expect(wIn).toBeLessThan(wMid); expect(wMid).toBeLessThan(w0);
    expect(wAfter).toBeCloseTo(w0, 9);
  });

  it('a later authored time still evaluates the authored path from the clean base', () => {
    const { cam, rig: r } = rig();
    r.seek(5); withDolly(cam, 1, 2600, () => undefined);
    r.seek(10);
    expect(pos(cam)).toEqual([40, 20, -60]);
    r.seek(0);
    expect(pos(cam)).toEqual([0, 0, 0]);
  });
});
