import { describe, it, expect } from 'vitest';
import { advanceGlobeLeg, globeLegClock, globeLegTime, legEase, LOCAL_CLOCK_END } from '../../src/journey/scale';
describe('local half of globe travel', () => {
  it('retains global half timing and shortens only the local half', () => {
    expect(LOCAL_CLOCK_END).toBeLessThan(.5);
    for (const t of [.5,.6,.8,.99]) expect(advanceGlobeLeg(t,.001)-t).toBeCloseTo(.001,10);
  });
  it('accelerates actual spatial ease toward the pane and reverses exactly', () => {
    const speeds = [.49,.4,.3,.2,.1,.01].map(t => (legEase(t)-legEase(advanceGlobeLeg(t,-.00001)))/.00001);
    for(let i=1;i<speeds.length;i++) expect(speeds[i]).toBeGreaterThan(speeds[i-1]);
    for(const t of [.02,.1,.2,.49,.5,.7,.95]) {
      expect(globeLegTime(globeLegClock(t))).toBeCloseTo(t,10);
      expect(advanceGlobeLeg(advanceGlobeLeg(t,.003),-.003)).toBeCloseTo(t,10);
    }
    expect(globeLegTime(0)).toBe(0); expect(globeLegTime(10)).toBe(1);
  });
});
