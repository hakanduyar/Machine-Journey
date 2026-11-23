import {
  CADENCE, REDUCED_T, STATUSES, TRANSCRIPT, counterAt, envelopeAt, fileNumber, lossAt, phaseOf, statusStep, transcriptReveal,
  transcriptStep, trendAt, waveAt, type CityFacts, type Role,
} from './companions';

/** Fixed texture size of every companion canvas; content is drawn in the panel's own aspect and scaled to it (no distortion). */
export const CANVAS_W = 768;
export const CANVAS_H = 384;
const PX = 60; // logical px per world unit
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const INK = '#e9f0f2'; const DIM = '#8fa5ad'; const LINE = 'rgba(233,240,242,0.55)'; const RED = '#d8403a'; const CYAN = 'rgba(140,210,225,0.95)';
const PAPER = '#ebe7da'; const PAPER_INK = '#1b2226'; const PAPER_DIM = '#5b6468';

export interface CompanionDraw {
  /** Seconds on the shared animation clock (frozen composition when `reduced`). */
  time: number; reduced: boolean;
  city: CityFacts; cityId: string | null; slot: number; feedLabel: string;
  portraitIdx: number; portraits: HTMLImageElement | null;
}

type Ctx = CanvasRenderingContext2D;
const font = (c: Ctx, px: number, weight = '') => { c.font = `${weight}${px}px ${MONO}`; };
/** Text that shrinks (to 55 %) rather than overflow `maxW`. */
function put(c: Ctx, s: string, x: number, y: number, size: number, color: string, maxW: number, weight = '') {
  let sz = size; font(c, sz, weight);
  while (sz > size * 0.55 && c.measureText(s).width > maxW) { sz -= 1; font(c, sz, weight); }
  c.fillStyle = color; c.fillText(s, x, y);
}
/** Main heading with ONE small honest tag beside it (the heading dominates; provenance stays visible but quiet). */
function head(c: Ctx, title: string, tag: string, x: number, y: number, size: number, maxW: number, paper = false) {
  put(c, title, x, y, size, paper ? PAPER_INK : INK, maxW * 0.62, '600 ');
  const w = c.measureText(title).width;
  put(c, tag, x + w + size * 0.7, y, size * 0.5, paper ? PAPER_DIM : DIM, Math.max(10, maxW - w - size * 0.7));
}
function backing(c: Ctx, W: number, H: number, paper = false) {
  c.fillStyle = paper ? PAPER : 'rgba(4,8,11,0.98)'; c.fillRect(0, 0, W, H); // opaque compact backing
  c.strokeStyle = paper ? 'rgba(27,34,38,0.7)' : LINE; c.lineWidth = 2; c.strokeRect(1, 1, W - 2, H - 2);
}
/** Subdued white corner brackets (reference style guidance); no target glyph, no red marker. */
function brackets(c: Ctx, x: number, y: number, w: number, h: number, len: number) {
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.5; c.beginPath();
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    c.moveTo(cx + sx * len, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + sy * len);
  }
  c.stroke();
}
const demo = (c: Ctx, W: number, size: number, paper = false) => {
  font(c, size); const tw = c.measureText('DEMO').width;
  c.strokeStyle = paper ? PAPER_DIM : LINE; c.lineWidth = 1.5; c.strokeRect(W - tw - size * 1.1, size * 0.5, tw + size * 0.7, size * 1.3);
  c.fillStyle = paper ? PAPER_DIM : DIM; c.fillText('DEMO', W - tw - size * 0.75, size * 1.45);
};
const mmss = (s: number) => `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

const PAINT: Record<Role, (c: Ctx, W: number, H: number, d: CompanionDraw, t: number) => void> = {
  portrait(c, W, H, d) {
    backing(c, W, H);
    const pad = W * 0.06; const ph = H * 0.76; const pw = W - pad * 2;
    c.fillStyle = '#0d1418'; c.fillRect(pad, pad, pw, ph);
    const im = d.portraits;
    if (im && im.complete && im.naturalWidth > 0) {
      const col = im.naturalWidth / 3; // three equal columns (512 x 1024): head-and-shoulders crop from the top of the column
      const sh = Math.min(im.naturalHeight, col * (ph / pw));
      c.drawImage(im, d.portraitIdx * col, 0, col, sh, pad, pad, pw, ph);
    } else put(c, 'PORTRAIT LOADING', pad + pw * 0.08, pad + ph / 2, H * 0.05, DIM, pw * 0.84);
    brackets(c, pad, pad, pw, ph, Math.min(pw, ph) * 0.12);
    const fs = Math.min(H * 0.052, W * 0.075);
    put(c, `SUBJECT F-${fileNumber(d.cityId, d.slot)}`, pad, pad + ph + fs * 1.45, fs, INK, pw, '600 ');
    put(c, 'FICTIONAL · AI-GENERATED', pad, pad + ph + fs * 2.6, fs * 0.8, DIM, pw);
  },
  dossier(c, W, H, d, t) {
    backing(c, W, H);
    const x = W * 0.06; const fs = Math.min(H * 0.078, W * 0.056); const ph = phaseOf(d.cityId, d.slot, 'dossier');
    head(c, 'RECORD', 'FICTIONAL', x, H * 0.14, fs * 1.3, W * 0.66);
    demo(c, W, fs * 0.8);
    c.strokeStyle = LINE; c.lineWidth = 1; c.beginPath(); c.moveTo(x, H * 0.2); c.lineTo(W - x, H * 0.2); c.stroke();
    const status = STATUSES[statusStep(t + ph) % STATUSES.length];
    const rows: [string, string][] = [['FILE', `F-${fileNumber(d.cityId, d.slot)}`], ['CITY', d.city.name], ['SOURCE', d.city.source], ['FEED', d.feedLabel]];
    rows.forEach(([k, v], i) => { const y = H * (0.31 + i * 0.12); put(c, k, x, y, fs * 0.82, DIM, W * 0.24); put(c, v, x + W * 0.26, y, fs, INK, W * 0.66); });
    const ys = H * 0.79; put(c, 'STATUS', x, ys, fs * 0.82, DIM, W * 0.24);
    const warn = status === 'ON HOLD';
    c.strokeStyle = warn ? RED : LINE; c.lineWidth = 1.5; c.strokeRect(x + W * 0.25, ys - fs * 1.05, W * 0.38, fs * 1.5);
    put(c, status, x + W * 0.28, ys, fs * 0.95, warn ? RED : INK, W * 0.33, '600 ');
    put(c, `T+${mmss(counterAt(t + ph, 0, CADENCE.counter))}`, x + W * 0.68, ys, fs * 0.9, DIM, W * 0.27);
    // thin simulated envelope: a second, calmer channel
    const by = H * 0.92; c.strokeStyle = CYAN; c.lineWidth = 1.4; c.beginPath();
    for (let i = 0; i <= 40; i++) { const u = i / 40; const y = by - waveAt(u, t, ph) * H * 0.035; if (i === 0) c.moveTo(x + u * (W - 2 * x), y); else c.lineTo(x + u * (W - 2 * x), y); }
    c.stroke();
  },
  wave(c, W, H, d, t) {
    backing(c, W, H);
    const x = W * 0.03; const fs = H * 0.13; const ph = phaseOf(d.cityId, d.slot, 'wave');
    const lost = lossAt(t); // one coordinated dropout event on the shared clock (not per-card blinking); 0 in the reduced composition
    head(c, 'SIGNAL', 'SIMULATED', x, H * 0.2, fs * 1.1, W * 0.66);
    demo(c, W, fs * 0.8);
    const y0 = H * 0.3; const y1 = H * 0.78; const mid = (y0 + y1) / 2;
    c.strokeStyle = 'rgba(233,240,242,0.14)'; c.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { c.beginPath(); c.moveTo(x + ((W - 2 * x) * i) / 10, y0); c.lineTo(x + ((W - 2 * x) * i) / 10, y1); c.stroke(); }
    c.beginPath(); c.moveTo(x, mid); c.lineTo(W - x, mid); c.stroke();
    c.strokeStyle = lost > 0.5 ? RED : CYAN; c.lineWidth = 2.2; c.beginPath();
    for (let i = 0; i <= 160; i++) { const u = i / 160; const y = mid - waveAt(u, t, ph) * (y1 - y0) * 0.5; if (i === 0) c.moveTo(x + u * (W - 2 * x), y); else c.lineTo(x + u * (W - 2 * x), y); }
    c.stroke();
    const ev = lost > 0.5 ? 'SIGNAL LOST' : 'LEVEL OK';
    c.strokeStyle = lost > 0.5 ? RED : LINE; c.lineWidth = 1.5; c.strokeRect(x, H * 0.82, W * 0.3, H * 0.15);
    put(c, ev, x + W * 0.02, H * 0.935, H * 0.115, lost > 0.5 ? RED : INK, W * 0.26, '600 ');
    put(c, `ENV ${Math.round(envelopeAt(t, ph) * 100)}%`, W * 0.4, H * 0.935, H * 0.115, DIM, W * 0.25);
    put(c, `CH 0${1 + (d.slot % 4)}`, W * 0.7, H * 0.935, H * 0.115, DIM, W * 0.27);
  },
  transcript(c, W, H, d, t) {
    backing(c, W, H);
    const x = W * 0.04; const fs = H * 0.115; const ph = phaseOf(d.cityId, d.slot, 'transcript');
    const step = transcriptStep(t + ph); const reveal = transcriptReveal(t + ph);
    head(c, 'TRANSCRIPT', 'SAMPLE · NOT AUDIO', x, H * 0.18, fs * 1.05, W * 0.74);
    demo(c, W, fs * 0.7);
    c.strokeStyle = LINE; c.lineWidth = 1; c.beginPath(); c.moveTo(x, H * 0.26); c.lineTo(W - x, H * 0.26); c.stroke();
    for (let k = 2; k >= 0; k--) {
      const n = step - k; if (n < 0) continue;
      const line = TRANSCRIPT[(n + d.slot) % TRANSCRIPT.length];
      const cur = k === 0; const shown = cur ? line.slice(0, Math.max(1, Math.ceil(line.length * reveal))) : line;
      put(c, `[${mmss(n * CADENCE.transcript)}] ${shown}`, x, H * (0.46 + (2 - k) * 0.19), fs, cur ? INK : DIM, W * 0.92);
    }
  },
  paper(c, W, H, d, t) {
    backing(c, W, H, true);
    const x = W * 0.08; const fs = Math.min(H * 0.055, W * 0.085);
    put(c, 'RECORD', x, H * 0.11, fs * 1.4, PAPER_INK, W * 0.84, '600 ');
    put(c, 'SAMPLE FORM · FICTIONAL', x, H * 0.165, fs * 0.72, PAPER_DIM, W * 0.84);
    c.strokeStyle = 'rgba(27,34,38,0.55)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, H * 0.2); c.lineTo(W - x, H * 0.2); c.stroke();
    const rows: [string, string][] = [['PLACE', d.city.name], ['COUNTRY', d.city.country], ['REF', `R-${fileNumber(d.cityId, d.slot + 3)}`], ['SECTION', `${'ABCDEF'[d.slot % 6]}-${2 + (d.slot * 3) % 7}`], ['SOURCE', d.city.source], ['FEED', d.feedLabel]];
    rows.forEach(([k, v], i) => {
      const y = H * (0.28 + i * 0.1);
      put(c, k, x, y, fs * 0.78, PAPER_DIM, W * 0.3); put(c, v, x, y + fs * 1.15, fs, PAPER_INK, W * 0.84);
      c.strokeStyle = 'rgba(27,34,38,0.18)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y + fs * 1.5); c.lineTo(W - x, y + fs * 1.5); c.stroke();
    });
    c.strokeStyle = RED; c.lineWidth = 2; c.strokeRect(x, H * 0.9, W * 0.5, H * 0.065);
    put(c, 'SAMPLE · NOT A RECORD', x + W * 0.03, H * 0.945, fs * 0.8, RED, W * 0.44, '600 ');
    void t;
  },
  trend(c, W, H, d, t) {
    backing(c, W, H);
    const x = W * 0.08; const fs = Math.min(H * 0.075, W * 0.085); const ph = phaseOf(d.cityId, d.slot, 'trend');
    put(c, 'TREND', x, H * 0.12, fs * 1.15, INK, W * 0.84, '600 ');
    put(c, 'SIMULATED · DEMO', x, H * 0.19, fs * 0.7, DIM, W * 0.84);
    const px = x; const pw = W - 2 * x; const y0 = H * 0.26; const y1 = H * 0.66;
    c.strokeStyle = 'rgba(233,240,242,0.14)'; c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(px, y0 + ((y1 - y0) * i) / 4); c.lineTo(px + pw, y0 + ((y1 - y0) * i) / 4); c.stroke(); }
    c.strokeStyle = CYAN; c.lineWidth = 2.2; c.beginPath();
    for (let i = 0; i <= 60; i++) { const u = i / 60; const y = y1 - trendAt(u, t + ph) * (y1 - y0); if (i === 0) c.moveTo(px + u * pw, y); else c.lineTo(px + u * pw, y); }
    c.stroke();
    const n = counterAt(t + ph, 400 + (fileNumber(d.cityId, d.slot) % 300), CADENCE.entries);
    put(c, 'ENTRIES', x, H * 0.78, fs * 0.8, DIM, W * 0.84);
    put(c, String(n).padStart(4, '0'), x, H * 0.92, fs * 2.1, INK, W * 0.84, '600 ');
  },
};

/** Draws one companion into its fixed-size canvas (the panel's own aspect w x h in world units is preserved by scaling). */
export function drawCompanion(cv: HTMLCanvasElement, role: Role, w: number, h: number, d: CompanionDraw) {
  if (cv.width !== CANVAS_W || cv.height !== CANVAS_H) { cv.width = CANVAS_W; cv.height = CANVAS_H; }
  const c = cv.getContext('2d');
  if (!c) return;
  const W = w * PX; const H = h * PX;
  c.setTransform(CANVAS_W / W, 0, 0, CANVAS_H / H, 0, 0);
  c.clearRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';
  PAINT[role](c, W, H, d, d.reduced ? REDUCED_T : d.time);
}
