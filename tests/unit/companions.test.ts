import { describe, expect, it } from 'vitest';
import {
  CADENCE, FAMILY_ROLES, PORTRAIT_COUNT, REDUCED_T, cityFacts, counterAt, envelopeAt, familyFor, groupSpecs, lossAt, portraitIndex,
  redrawEvery, statusStep, transcriptReveal, transcriptStep, trendAt, waveAt, type Family,
} from '../../src/journey/companions';

const FAMS: Family[] = [0, 1, 2];
const overlap = (a: { dx: number; dy: number; w: number; h: number }, b: typeof a) =>
  Math.abs(a.dx - b.dx) < (a.w + b.w) / 2 && Math.abs(a.dy - b.dy) < (a.h + b.h) / 2;

describe('companion families across a 2-4 stop visit', () => {
  it('consecutive panelled stops always differ and a 4-stop visit (3 panelled stops) shows all three families', () => {
    for (let first = 0; first < 10; first++) {
      const f = [0, 1, 2].map((k) => familyFor(first, k));
      expect(f[0]).not.toBe(f[1]); expect(f[1]).not.toBe(f[2]);
      expect(new Set(f).size).toBe(3);
      expect(familyFor(first, 0)).toBe(familyFor(first, 0)); // stable for a recorded visit (back / redo)
    }
  });
  it('a 3-stop visit has two panelled stops; with the per-visit offset (2 x ordinal) ANY two consecutive visits show all three families', () => {
    const visit = (ordinal: number) => [0, 1].map((k) => familyFor(ordinal * 2, k)); // stops 0 and 1 are the panelled (medium) ones
    for (let v = 0; v < 12; v++) {
      expect(new Set(visit(v)).size).toBe(2); // two different families inside one visit
      expect(new Set([...visit(v), ...visit(v + 1)]).size).toBe(3); // the document family is reached within two visits
    }
  });
  it('the three groups have clearly different silhouettes: tall, wide + shallow, narrow', () => {
    const [a, b, c] = FAMS.map((f) => groupSpecs(f, 0, true));
    expect(a[0].h / a[0].w).toBeGreaterThan(1.3);       // A: tall portrait card
    expect(b[0].w / b[0].h).toBeGreaterThan(3);         // B: wide shallow strip
    expect(c[0].w).toBeLessThan(7); expect(c[0].h / c[0].w).toBeGreaterThan(1.2); // C: narrow paper
    expect(FAMILY_ROLES.map((r) => r[0])).toEqual(['portrait', 'wave', 'paper']);
  });
  it('every group stays beside / below the pane inside the view extents and its two cards never overlap', () => {
    for (const slot of [0, 1, 2, 5]) for (const f of FAMS) {
      const land = groupSpecs(f, slot, true); const port = groupSpecs(f, slot, false);
      for (const s of land) { expect(Math.abs(s.dx) - s.w / 2).toBeGreaterThanOrEqual(10); expect(Math.abs(s.dx) + s.w / 2).toBeLessThanOrEqual(22.6); expect(Math.abs(s.dy) + s.h / 2).toBeLessThanOrEqual(8.2); }
      for (const s of port) { expect(Math.abs(s.dx) + s.w / 2).toBeLessThanOrEqual(11.6); expect(Math.abs(s.dy) + s.h / 2).toBeLessThanOrEqual(27.6); }
      expect(overlap(land[0], land[1])).toBe(false); expect(overlap(port[0], port[1])).toBe(false);
    }
  });
});

describe('deterministic procedural motion', () => {
  it('during any 3 s hold the signal envelope, the transcript, the counter and the status channel all evolve (different cadences)', () => {
    for (let t = 0; t < 40; t += 0.7) {
      const env = Array.from({ length: 31 }, (_, i) => envelopeAt(t + i * 0.1));
      expect(Math.max(...env) - Math.min(...env)).toBeGreaterThan(0.04); // the envelope visibly changes within 3 s
      expect(transcriptStep(t + 3)).toBeGreaterThan(transcriptStep(t)); // a new transcript line (2.6 s cadence)
      expect(counterAt(t + 3, 0)).toBeGreaterThan(counterAt(t, 0));       // the 1 s counter
    }
    expect(new Set([CADENCE.envelope, CADENCE.transcript, CADENCE.status, CADENCE.counter, CADENCE.entries]).size).toBe(5); // not one shared clock
    expect(new Set(Array.from({ length: 20 }, (_, i) => statusStep(i * 1))).size).toBeGreaterThan(3);
  });
  it('is smooth and continuous in time and space (no loop jump, no random noise) and deterministic', () => {
    for (let t = 0; t < 30; t += 0.37) for (let x = 0; x <= 1; x += 0.1) {
      expect(Math.abs(waveAt(x, t + 1 / 60) - waveAt(x, t))).toBeLessThan(0.2); // bounded per-frame change, also through a dropout
      expect(Math.abs(waveAt(x + 0.002, t) - waveAt(x, t))).toBeLessThan(0.15);
      expect(Math.abs(trendAt(x, t + 1 / 60) - trendAt(x, t))).toBeLessThan(0.02);
      expect(waveAt(x, t)).toBe(waveAt(x, t));
    }
    for (let t = 0; t < 60; t += 0.5) { const e = envelopeAt(t, 1.3); expect(e).toBeGreaterThanOrEqual(0.04); expect(e).toBeLessThanOrEqual(1); }
    expect(transcriptReveal(0)).toBe(0); expect(transcriptReveal(CADENCE.transcript - 1e-6)).toBe(1);
  });
  it('a smooth ~1.4 s SIGNAL LOST dropout recurs every 7.3 s; the reduced composition is calm and never lost', () => {
    const lost = Array.from({ length: 730 }, (_, i) => lossAt(i * 0.01)); // exactly one period
    expect(Math.max(...lost)).toBeGreaterThan(0.99);
    const secs = lost.filter((v) => v > 0.5).length * 0.01; expect(secs).toBeGreaterThan(0.8); expect(secs).toBeLessThan(1.8);
    expect(lossAt(CADENCE.loss + 6.2)).toBeGreaterThan(0.99);
    expect(lossAt(REDUCED_T)).toBe(0);
    expect(redrawEvery('wave', true)).toBe(0); expect(redrawEvery('trend', true)).toBe(0); // reduced motion: nothing keeps redrawing
    expect(redrawEvery('wave', false)).toBeGreaterThan(0); expect(redrawEvery('portrait', false)).toBe(0);
  });
});

describe('content belongs to the active city and the fictional portraits', () => {
  it('city facts come from the catalog (verified places keep their source label; stock cities say archive place)', () => {
    expect(cityFacts('butlerville').place).toContain('BUTLERVILLE');
    expect(cityFacts('butlerville').source).toBe('MEVA collection');
    expect(cityFacts('paris')).toMatchObject({ name: 'PARIS', country: 'FRANCE', place: 'ARCHIVE PLACE · PARIS', source: 'STOCK ARCHIVE' });
    expect(cityFacts('nowhere').name).toBe('UNKNOWN');
  });
  it('portrait index is one of the three sheet columns and stable per (city, stop)', () => {
    for (const city of ['butlerville', 'paris', 'tokyo']) for (let s = 0; s < 10; s++) {
      const i = portraitIndex(city, s); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(PORTRAIT_COUNT); expect(portraitIndex(city, s)).toBe(i);
    }
    expect(new Set([0, 1, 2, 3, 4, 5].map((s) => portraitIndex('butlerville', s))).size).toBeGreaterThan(1);
  });
});
