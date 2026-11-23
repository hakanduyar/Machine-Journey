import { mulberry32 } from './layout';
import { smoothstep } from './scale';

/**
 * The regional camera network of the globe bridges (canvas, no new decoders): a FREE camera field, never a mosaic block.
 *
 * The focal pane (the one real, persistent <video>) sits at the field's origin. Around it lie hundreds of independent
 * panes: a near cluster of a dozen large, clearly separated panes, then many smaller and dimmer ones in multi-scale
 * clusters whose size, density and brightness taper with distance (a size / depth hierarchy), then, as panes shrink below
 * legibility, cluster lights, nodes and links, and a wider ring of small "town" nodes. Every pane is a sub-rectangle of
 * ONE downscaled composite of the EXISTING per-tile canvases (painted from the ten shared videos); the composite itself is
 * never drawn as a block, so no contiguous gapless rectangle exists at any bridge sample, and nothing here decodes anything.
 *
 * All positions are in "units" of the focal pane's width and scale with ONE shared projector: a unit is `pose.unit` screen
 * px (the focal pane's current screen width, which the bridge animates from fullscreen down to the globe hold). The
 * schematic is abstract (panes, dots, links): it draws no streets or names and implies nothing about where footage was
 * recorded.
 */
export interface FieldGeom {
  worldW: number;
  worldH: number;
  tiles: readonly { x: number; y: number; w: number; h: number }[];
  canvases: readonly (HTMLCanvasElement | null | undefined)[];
}

/** Screen placement of the field: the focal pane's centre, its on-screen width (px per unit) and aspect (h / w). */
export interface FieldPose { cx: number; cy: number; unit: number; aspect: number; /** overall opacity 0..1 (default 1) */ alpha?: number }

interface Thumb { x: number; y: number; w: number; h: number; src: number; a: number; z: number }
interface Node { x: number; y: number; s: number; tier: 0 | 1 | 2 }
interface Light { x: number; y: number; px: number; a: number; tier: 1 | 2 }
interface Net { key: string; thumbs: Thumb[]; nodes: Node[]; links: [number, number][]; lights: Light[] }

/** Field extent in focal-pane widths (the old block-relative extents, expressed in units of the focal pane). */
export const FIELD_W = 14;
/** Worst-case focal half extents (a tall tile) used to keep the build clear of the focal pane; draw checks the real one. */
const FOCAL_HW = 0.5; const FOCAL_HH = 0.75;

let net: Net | null = null;

function build(g: FieldGeom): Net {
  const W = FIELD_W;
  const rnd = mulberry32(7301);
  const focalDist = (x: number, y: number) => Math.hypot(Math.max(Math.abs(x) - FOCAL_HW, 0), Math.max(Math.abs(y) - FOCAL_HH, 0));
  const nodes: Node[] = [{ x: 0, y: 0, s: 1, tier: 0 }];
  const thumbs: Thumb[] = [];
  const lights: Light[] = [];
  const gauss = () => rnd() + rnd() + rnd() - 1.5; // roughly normal, +-1.5
  const aspectOf = (src: number) => { const t = g.tiles[src]; return t ? Math.min(1.5, Math.max(0.55, t.h / t.w)) : 0.5625; };
  const fits = (x: number, y: number, w: number, h: number) => {
    if (Math.abs(x) < FOCAL_HW + w / 2 + 0.12 && Math.abs(y) < FOCAL_HH + h / 2 + 0.12) return false; // never over the focal pane
    // clear separation from every other pane: an absolute gap plus a share of the panes' own size
    return !thumbs.some((o) => {
      const gap = 0.09 + 0.14 * Math.min(o.w, w);
      return Math.abs(o.x - x) < (o.w + w) / 2 + gap && Math.abs(o.y - y) < (o.h + h) / 2 + gap;
    });
  };
  const depth = (x: number, y: number) => 1 / (1 + Math.hypot(x, y) / 5); // 1 = nearest

  // Near cluster: ~14 large, well separated panes right around the focal pane, biggest nearest (the size hierarchy starts here).
  for (let tries = 0, made = 0; made < 14 && tries < 600; tries++) {
    const ang = rnd() * Math.PI * 2; const r = 0.95 + Math.pow(rnd(), 0.8) * 2.4;
    const w = Math.max(0.3, (1.0 - 0.17 * r) * (0.8 + 0.4 * rnd())); // ~0.85 beside the focus down to ~0.45 at the cluster's edge
    const src = Math.floor(rnd() * g.tiles.length);
    const h = w * aspectOf(src);
    const x = Math.cos(ang) * r * 1.25; const y = Math.sin(ang) * r * 0.85;
    if (!fits(x, y, w, h)) continue;
    thumbs.push({ x, y, w, h, src, a: 1, z: depth(x, y) });
    made++;
  }

  // Tier 1: ~44 clusters around the focal pane; density and size taper with distance from it.
  const reach = W * 1.1;
  for (let tries = 0; nodes.length < 45 && tries < 4000; tries++) {
    const x = (rnd() - 0.5) * 2 * reach; const y = (rnd() - 0.5) * 2 * reach * 0.8;
    const d = focalDist(x, y);
    if (d > reach || d < 1.5 || rnd() > 1 / (1 + Math.pow(d / (0.3 * W), 1.4))) continue;
    const s = (0.55 + rnd() * 0.95) / Math.pow(1 + d / (0.7 * W), 1.1); // steep taper: far clusters are clearly smaller panes
    nodes.push({ x, y, s, tier: 1 });
  }
  for (const n of nodes) {
    if (n.tier !== 1) continue;
    const rho = 0.9 * n.s;
    const count = Math.round(7.5 + 11 * n.s); // population no longer shrinks with the steeper size taper: far clusters stay populated with smaller panes
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const x = n.x + gauss() * rho; const y = n.y + gauss() * rho * 0.75;
        const src = Math.floor(rnd() * g.tiles.length);
        if (!g.tiles[src]) continue;
        const w = (0.22 + rnd() * 0.62) * n.s;
        const h = w * aspectOf(src);
        if (!fits(x, y, w, h)) continue;
        thumbs.push({ x, y, w, h, src, a: 0.95 - 0.5 * Math.min(1, focalDist(x, y) / reach), z: depth(x, y) });
        break;
      }
    }
    for (let i = 0; i < 12; i++) lights.push({ x: n.x + gauss() * rho * 1.3, y: n.y + gauss() * rho, px: 1.2 + rnd() * 1.1, a: 0.35 + rnd() * 0.5, tier: 1 });
  }
  for (let i = 0; i < 40; i++) lights.push({ x: (rnd() - 0.5) * 6, y: (rnd() - 0.5) * 4, px: 1.2 + rnd() * 1, a: 0.3 + rnd() * 0.5, tier: 1 }); // around the focus
  thumbs.sort((a, b) => a.z - b.z); // far first, near last

  // Tier 2: ~60 towns out to ~25 field-widths, thinning outward.
  for (let i = 0; i < 60; i++) {
    const ang = rnd() * Math.PI * 2; const r = W * (1.3 + 22 * Math.pow(rnd(), 1.8));
    const n: Node = { x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.8, s: 0.5 + rnd() * 0.8, tier: 2 };
    nodes.push(n);
    for (let k = 0; k < 8; k++) lights.push({ x: n.x + gauss() * W * 0.18 * n.s, y: n.y + gauss() * W * 0.14 * n.s, px: 1.1 + rnd() * 1, a: 0.3 + rnd() * 0.45, tier: 2 });
  }

  // Links: each node joins its nearest already-linked node (a tree growing outward); clusters add one more neighbour.
  const order = nodes.map((_, i) => i).sort((a, b) => Math.hypot(nodes[a].x, nodes[a].y) - Math.hypot(nodes[b].x, nodes[b].y));
  const links: [number, number][] = [];
  const done: number[] = [];
  for (const i of order) {
    if (done.length) {
      const near = done.map((j) => [j, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)] as const).sort((a, b) => a[1] - b[1]);
      links.push([i, near[0][0]]);
      if (nodes[i].tier === 1 && near[1]) links.push([i, near[1][0]]);
    }
    done.push(i);
  }
  return { key: '', thumbs, nodes, links, lights };
}

/** The field's panes in focal-pane units (read-only view for review / tests). */
export function freePanes(g: FieldGeom): readonly Readonly<Thumb>[] { return build(g).thumbs; }

const THUMB_W = 1440;
let thumb: HTMLCanvasElement | null = null;

/** One downscaled composite of every tile canvas: only the SOURCE of the individual panes, never drawn as a block. */
function composeThumb(g: FieldGeom): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const th = Math.max(2, Math.round((THUMB_W * g.worldH) / g.worldW));
  thumb ??= document.createElement('canvas');
  if (thumb.width !== THUMB_W || thumb.height !== th) { thumb.width = THUMB_W; thumb.height = th; }
  const c = thumb.getContext('2d');
  if (!c) return null;
  const k = THUMB_W / g.worldW;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'low';
  c.fillStyle = '#0a0d10';
  c.fillRect(0, 0, THUMB_W, th);
  for (let i = 0; i < g.tiles.length; i++) {
    const cv = g.canvases[i];
    if (!cv || cv.width < 2 || cv.height < 2) continue;
    const t = g.tiles[i];
    const x0 = Math.round(t.x * k); const y0 = Math.round(t.y * k);
    c.drawImage(cv, x0, y0, Math.max(1, Math.round((t.x + t.w) * k) - x0), Math.max(1, Math.round((t.y + t.h) * k) - y0));
  }
  c.fillStyle = 'rgba(0,0,0,0.14)'; // the same dimming the tiles carry
  c.fillRect(0, 0, THUMB_W, th);
  return thumb;
}

export function drawLocalField(ctx: CanvasRenderingContext2D, w: number, h: number, g: FieldGeom, p: FieldPose) {
  const unit = p.unit;
  const bw = unit * FIELD_W; // the old block-width measure that paces the thumbnail -> light -> geography hand-over
  if (bw < 2.5 || (p.alpha ?? 1) < 0.005) return;
  const meanW = Math.round(g.tiles.reduce((a, t) => a + t.w, 0) / Math.max(1, g.tiles.length));
  const key = `${g.tiles.length}x${meanW}`;
  if (!net || net.key !== key) { net = build(g); net.key = key; }
  const n = net;
  const baseAlpha = ctx.globalAlpha;
  const prevAlpha = baseAlpha * (p.alpha ?? 1);
  const sx = (x: number) => p.cx + x * unit; const sy = (y: number) => p.cy + y * unit;
  const fhw = 0.5 + 0.06; const fhh = p.aspect / 2 + 0.06; // the actual focal pane (+ a hair): no pane is ever drawn over it

  const thumbA = smoothstep(2.5, 14, bw);
  if (thumbA > 0.01) {
    const th = composeThumb(g);
    if (th) {
      const k = THUMB_W / g.worldW;
      for (const t of n.thumbs) {
        const pw = t.w * unit; const ph = t.h * unit;
        if (pw < 1) continue;
        const px = sx(t.x - t.w / 2); const py = sy(t.y - t.h / 2);
        if (px > w || py > h || px + pw < 0 || py + ph < 0) continue;
        if (Math.abs(t.x) < fhw + t.w / 2 && Math.abs(t.y) < fhh + t.h / 2) continue;
        const s = g.tiles[t.src];
        const vis = smoothstep(1, 3.5, pw);
        ctx.globalAlpha = prevAlpha * thumbA * vis * (0.55 + 0.45 * t.a);
        ctx.drawImage(th, s.x * k, s.y * k, s.w * k, s.h * k, px, py, pw, ph);
        // depth: farther panes are dimmer, and every pane has a thin dark edge so neighbours read as separate cameras
        ctx.fillStyle = `rgba(0,0,0,${((1 - t.z) * 0.38).toFixed(3)})`; ctx.fillRect(px, py, pw, ph);
        if (pw > 7) { ctx.globalAlpha = prevAlpha * thumbA * vis * 0.8; ctx.strokeStyle = 'rgba(6,9,12,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1); }
      }
    }
  }

  // Schematic cues that outlast the panes: links, clustered lights, nodes.
  const local = (1 - smoothstep(300, 1200, bw)) * smoothstep(3, 10, bw);
  const town = smoothstep(6, 24, bw) * (1 - smoothstep(300, 900, bw));
  const tierA = (tier: number) => (tier === 2 ? town : local);
  if (local > 0.01 || town > 0.01) {
    ctx.lineWidth = 0.8;
    for (const [a, b] of n.links) {
      const A = n.nodes[a]; const B = n.nodes[b];
      const al = Math.min(tierA(A.tier), tierA(B.tier)) * 0.3;
      if (al < 0.01) continue;
      const ax = sx(A.x); const ay = sy(A.y); const bx = sx(B.x); const by = sy(B.y);
      if ((ax < 0 && bx < 0) || (ax > w && bx > w) || (ay < 0 && by < 0) || (ay > h && by > h)) continue;
      ctx.strokeStyle = `rgba(150,190,240,${(prevAlpha * al).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of n.lights) {
      const a = tierA(l.tier) * l.a;
      if (a < 0.02) continue;
      const x = sx(l.x); const y = sy(l.y);
      if (x < -3 || x > w + 3 || y < -3 || y > h + 3) continue;
      ctx.fillStyle = `rgba(214,232,255,${(prevAlpha * a).toFixed(3)})`;
      ctx.fillRect(x - l.px / 2, y - l.px / 2, l.px, l.px);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const nd of n.nodes) {
      const a = tierA(nd.tier);
      if (a < 0.02) continue;
      const x = sx(nd.x); const y = sy(nd.y);
      if (x < -3 || x > w + 3 || y < -3 || y > h + 3) continue;
      const own = nd.tier === 0;
      ctx.fillStyle = own ? `rgba(235,244,255,${(prevAlpha * a * 0.9).toFixed(3)})` : `rgba(170,205,245,${(prevAlpha * a * 0.7).toFixed(3)})`;
      const s = own ? 3 : 2;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
  ctx.globalAlpha = baseAlpha;
}
