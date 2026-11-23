import { stopSide } from './floatField';
import { cityById } from './globe';

/**
 * Alternative companion content of the floating field (pure, no DOM): three families of authored, FICTIONAL, clearly DEMO
 * panel groups with different silhouettes, and the deterministic procedural time functions that animate them. Nothing here
 * claims real audio, interception, analytics or the identity of anyone filmed; the signal is SIMULATED and the portraits are
 * AI-generated fictional adults (see public/assets/companions/ASSETS.md). All facts shown come from the active city's catalog.
 */
export type Role = 'portrait' | 'dossier' | 'wave' | 'transcript' | 'paper' | 'trend';
export type Family = 0 | 1 | 2;
/** The two panels (spec 0, spec 1) of each family. */
export const FAMILY_ROLES: readonly (readonly [Role, Role])[] = [['portrait', 'dossier'], ['wave', 'transcript'], ['paper', 'trend']];

/** Family of the k-th stop of a visit whose first stop sits on `firstSlot`: consecutive stops always differ; 3+ panelled stops show all three. */
export const familyFor = (firstSlot: number, k: number): Family => ((((firstSlot + k) % 3) + 3) % 3) as Family;

export interface CompanionSpec { role: Role; w: number; h: number; dx: number; dy: number; dz: number; ry: number }
type Base = Omit<CompanionSpec, 'role'>;
// Landscape (side = 1: right of the pane, extents <= ~22.5 units from the stop) and portrait (below the pane) groupings. A is
// TALL (photo above a dossier), B is WIDE and SHALLOW (signal strip above a transcript strip), C is NARROW (paper + small counter).
const LAND: readonly (readonly [Base, Base])[] = [
  [{ w: 6.4, h: 9.2, dx: 14.6, dy: 3.2, dz: -2, ry: -0.1 }, { w: 8.6, h: 6.2, dx: 15.6, dy: -5.0, dz: 2, ry: -0.1 }],
  [{ w: 12.4, h: 3.9, dx: 16.3, dy: 4.2, dz: -2, ry: -0.1 }, { w: 10.6, h: 3.5, dx: 15.6, dy: -0.6, dz: 2, ry: -0.12 }],
  [{ w: 6.6, h: 8.8, dx: 13.6, dy: 1.0, dz: -1, ry: -0.08 }, { w: 5.0, h: 5.4, dx: 19.9, dy: -0.4, dz: 3, ry: -0.14 }],
];
const PORT: readonly (readonly [Base, Base])[] = [
  [{ w: 9, h: 13.2, dx: -5.8, dy: -13.5, dz: -2, ry: 0.05 }, { w: 11, h: 9.2, dx: 6.0, dy: -12.6, dz: 2, ry: -0.05 }],
  [{ w: 20, h: 6.4, dx: 0, dy: -10.5, dz: -2, ry: 0.06 }, { w: 17.5, h: 5.6, dx: 1.2, dy: -17.6, dz: 2, ry: -0.05 }],
  [{ w: 10.4, h: 14, dx: -5.2, dy: -14, dz: -2, ry: 0.05 }, { w: 8.4, h: 8.8, dx: 6.6, dy: -11.2, dz: 2, ry: -0.05 }],
];

/** Placement of a family's two panels at a stop (mirrored with the stop's side, exactly like the old companions). */
export function groupSpecs(family: Family, slot: number, land: boolean): CompanionSpec[] {
  const side = stopSide(slot);
  const roles = FAMILY_ROLES[family];
  return (land ? LAND : PORT)[family].map((p, i) => (land
    ? { role: roles[i], ...p, dx: p.dx * side, ry: p.ry * side }
    : { role: roles[i], ...p, dx: p.dx * side, dy: p.dy * side, ry: p.ry * side }));
}

// ---------------------------------------------------------------- city facts (catalog) + authored fiction

export interface CityFacts { name: string; country: string; place: string; source: string }
export function cityFacts(cityId: string | null | undefined): CityFacts {
  const c = cityId ? cityById(cityId) : null;
  if (!c) return { name: 'UNKNOWN', country: '', place: 'NO CITY', source: '' };
  return {
    name: c.name.toUpperCase(), country: c.country.toUpperCase(),
    place: c.verified ? c.verified.label : `ARCHIVE PLACE · ${c.name.toUpperCase()}`,
    source: c.verified ? c.verified.source : 'STOCK ARCHIVE',
  };
}

export const TRANSCRIPT: readonly string[] = [
  'shift handover logged at the front desk', 'delivery window moved to the second hour', 'please confirm the sample label before filing',
  'the archive copy is complete', 'relay check finished, nothing to report', 'reading room opens after the break',
  'badge reader replaced, test passed', 'closing notes added to the file',
];
export const STATUSES: readonly string[] = ['IN REVIEW', 'CLEARED', 'ON HOLD'];
export const PORTRAIT_COUNT = 3;

const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return h; };
/** Which of the three fictional portraits a stop shows: stable per (city, slot). */
export const portraitIndex = (cityId: string | null | undefined, slot: number) => (hash(cityId ?? '') + slot * 7) % PORTRAIT_COUNT;
/** Fictional file number of a stop (never a name). */
export const fileNumber = (cityId: string | null | undefined, slot: number) => 1000 + ((hash(cityId ?? '') + slot * 131) % 9000);
/** Per-stop phase offset (seconds) so the cards of a group do not share one clock. */
export const phaseOf = (cityId: string | null | undefined, slot: number, role: Role) => ((hash(`${cityId}|${slot}|${role}`) % 997) / 997) * 9;

// ---------------------------------------------------------------- deterministic procedural motion (no randomness, no loop)

const TAU = Math.PI * 2;
const sstep = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
export const CADENCE = { envelope: 6.4, transcript: 2.6, status: 4.1, counter: 1.0, trend: 9.1, loss: 7.3, entries: 1.7 } as const;
/** Time used when the user prefers reduced motion: a readable, calm, non-lost composition that never changes. */
export const REDUCED_T = 1.3;

/** 0..1: how "lost" the simulated signal is. A smooth ~1.4 s dropout once per `CADENCE.loss` seconds. */
export function lossAt(t: number): number {
  const p = ((t % CADENCE.loss) + CADENCE.loss) % CADENCE.loss;
  return sstep((p - 5.5) / 0.4) * (1 - sstep((p - 6.9) / 0.4));
}
/** Slowly evolving amplitude envelope (period 6.4 s + a faster shoulder), pulled down by a dropout. Always in [0.04, 1]. */
export function envelopeAt(t: number, phase = 0): number {
  const e = 0.56 + 0.32 * Math.sin((TAU * (t + phase)) / CADENCE.envelope) + 0.1 * Math.sin((TAU * (t + phase)) / 2.3);
  return Math.min(1, Math.max(0.04, e * (1 - 0.88 * lossAt(t))));
}
/** Smooth periodic simulated waveform sample in [-1, 1] at x in 0..1 (continuous in x and t; never loops or jumps). */
export function waveAt(x: number, t: number, phase = 0): number {
  const c = 0.6 * Math.sin(TAU * (x * 5.2 + (t + phase) * 0.9)) + 0.3 * Math.sin(TAU * (x * 11.3 - (t + phase) * 1.7)) + 0.1 * Math.sin(TAU * (x * 2.1 + (t + phase) * 0.35));
  return c * envelopeAt(t, phase);
}
/** Slow plot for the trend card in 0..1 (scrolls with time). */
export const trendAt = (x: number, t: number) => 0.5 + 0.3 * Math.sin(TAU * (x * 1.6 + t / CADENCE.trend)) + 0.12 * Math.sin(TAU * (x * 4.3 - t / 5.3));
export const transcriptStep = (t: number) => Math.floor(Math.max(0, t) / CADENCE.transcript);
/** 0..1 typing reveal of the current transcript line (smooth within each step). */
export const transcriptReveal = (t: number) => Math.min(1, (((t % CADENCE.transcript) + CADENCE.transcript) % CADENCE.transcript) / (CADENCE.transcript * 0.55));
export const statusStep = (t: number) => Math.floor(Math.max(0, t) / CADENCE.status);
export const counterAt = (t: number, base: number, every: number = CADENCE.counter) => base + Math.floor(Math.max(0, t) / every);

/** Seconds between redraws of a role's canvas (0 = static: drawn once per content change). */
export const redrawEvery = (role: Role, reduced: boolean): number => {
  if (reduced || role === 'portrait' || role === 'paper') return 0; // static cards redraw only when their content key changes
  return role === 'wave' ? 1 / 15 : role === 'trend' ? 1 / 12 : 1 / 8;
};
