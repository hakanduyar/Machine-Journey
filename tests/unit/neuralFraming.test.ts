import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createMachineFraming, portraitZoom } from '../../src/journey/neuralSource/machineFraming';

const SRC = 1.77777779;
const horizontalHalf = (w: number, h: number) => {
  const cam = new PerspectiveCamera(40, SRC, 0.1, 100);
  createMachineFraming(cam, SRC)(w, h);
  return cam.aspect * Math.tan((cam.fov * Math.PI) / 360);
};

describe('portrait neural framing', () => {
  it('leaves desktop / landscape projection exactly as authored', () => {
    expect(portraitZoom(SRC)).toBe(1); expect(portraitZoom(1.2)).toBe(1); expect(portraitZoom(1)).toBe(1);
    const cam = new PerspectiveCamera(40, SRC, 0.1, 100);
    createMachineFraming(cam, SRC)(1600, 900);
    // 1600/900 is 1e-8 below the manifest's 1.77777779, so the pre-existing "narrower host" branch runs and the FOV is
    // recomputed through atan/tan (~2.5e-7 deg off). Zoom is 1 there, so this is the unchanged baseline, not a portrait effect.
    expect(cam.fov).toBeCloseTo(40, 5); expect(cam.aspect).toBeCloseTo(1600 / 900, 9);
    expect(horizontalHalf(1600, 900)).toBeCloseTo(SRC * Math.tan((40 * Math.PI) / 360), 7);
  });

  it('tightens the horizontal extent in portrait (pane ~1.6x larger at 390x844), continuously in aspect', () => {
    const authored = SRC * Math.tan((40 * Math.PI) / 360);
    expect(horizontalHalf(390, 844)).toBeCloseTo(authored / 1.6, 6);
    let prev = portraitZoom(1);
    for (let a = 1; a >= 0.3; a -= 0.01) { const z = portraitZoom(a); expect(z).toBeGreaterThanOrEqual(prev - 1e-12); expect(z - prev).toBeLessThan(0.03); prev = z; }
  });
});
