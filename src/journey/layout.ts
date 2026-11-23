import type { CropParams, Rect } from './geometry';

export interface Tile {
  id: string;
  index: number;
  /** Pixel rect in world space; edges are shared integers, so the mosaic is gapless. */
  rect: Rect;
  feedIndex: number;
  crop: CropParams;
}

export interface Mosaic { width: number; height: number; tiles: Tile[] }

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEIGHTS = [0.55, 0.7, 0.9, 1, 1, 1.2, 1.5, 2, 2.6, 3.6, 5];

interface Leaf { r: Rect; weight: number }

/** Weighted binary partition of the full world rectangle: always fills it exactly. */
function partition(rect: Rect, weights: number[], rng: () => number, out: Leaf[]) {
  if (weights.length === 1) { out.push({ r: rect, weight: weights[0] }); return; }
  const total = weights.reduce((a, b) => a + b, 0);
  const goal = total * (0.38 + rng() * 0.24);
  let acc = 0;
  let k = 0;
  while (k < weights.length - 1 && acc + weights[k] / 2 < goal) acc += weights[k++];
  k = Math.min(weights.length - 1, Math.max(1, k));
  const left = weights.slice(0, k);
  const frac = left.reduce((a, b) => a + b, 0) / total;
  if (rect.w >= rect.h) {
    const cut = Math.round(rect.w * frac);
    partition({ x: rect.x, y: rect.y, w: cut, h: rect.h }, left, rng, out);
    partition({ x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }, weights.slice(k), rng, out);
  } else {
    const cut = Math.round(rect.h * frac);
    partition({ x: rect.x, y: rect.y, w: rect.w, h: cut }, left, rng, out);
    partition({ x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut }, weights.slice(k), rng, out);
  }
}

const aspectPenalty = (r: Rect) => Math.max(r.w / r.h, r.h / r.w);

function touches(a: Rect, b: Rect) {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const sideX = (a.x + a.w === b.x || b.x + b.w === a.x) && yOverlap > 0;
  const sideY = (a.y + a.h === b.y || b.y + b.h === a.y) && xOverlap > 0;
  return sideX || sideY;
}

export interface MosaicOptions {
  width: number; height: number; tileCount: number; feedCount: number; seed?: number;
}

export function generateMosaic({ width, height, tileCount, feedCount, seed = 7 }: MosaicOptions): Mosaic {
  width = Math.round(width); height = Math.round(height);
  // Try a handful of deterministic seeds, keep the one with the least extreme tile shapes.
  let best: Leaf[] | null = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 14; attempt++) {
    const rng = mulberry32(seed * 1013 + attempt * 7919);
    const weights = Array.from({ length: tileCount }, () => WEIGHTS[Math.floor(rng() * WEIGHTS.length)]);
    const leaves: Leaf[] = [];
    partition({ x: 0, y: 0, w: width, h: height }, weights, rng, leaves);
    const worst = Math.max(...leaves.map((l) => aspectPenalty(l.r)));
    const small = Math.min(...leaves.map((l) => Math.min(l.r.w, l.r.h)));
    const score = worst + (small < 56 ? 50 : 0);
    if (score < bestScore) { bestScore = score; best = leaves; }
  }
  const leaves = best!;
  const rng = mulberry32(seed + 99);
  const usage = new Array<number>(feedCount).fill(0);
  const feeds: number[] = [];
  leaves.forEach((leaf, i) => {
    const blocked = new Set<number>();
    for (let j = 0; j < i; j++) if (touches(leaf.r, leaves[j].r)) blocked.add(feeds[j]);
    let pick = -1;
    let bestUse = Infinity;
    for (let f = 0; f < feedCount; f++) {
      if (blocked.has(f)) continue;
      const u = usage[f] + rng() * 1.6;
      if (u < bestUse) { bestUse = u; pick = f; }
    }
    if (pick < 0) pick = i % feedCount;
    usage[pick]++; feeds.push(pick);
  });
  const tiles: Tile[] = leaves.map((leaf, i) => {
    const big = leaf.weight >= 2.6;
    return {
      id: `t${i}`,
      index: i,
      rect: leaf.r,
      feedIndex: feeds[i],
      crop: {
        z: big ? 1 + rng() * 0.35 : 1 + rng() * 1.5,
        cx: 0.25 + rng() * 0.5,
        cy: 0.3 + rng() * 0.4,
      },
    };
  });
  return { width, height, tiles };
}

export function tileCountFor(vw: number, vh: number, screens: number) {
  const avg = Math.min(80000, Math.max(24000, (vw * vh) / 26));
  return Math.round((screens * vw * vh) / avg);
}

/** Spatial neighbour for roving focus. dir: -1 left, 1 right, -2 up, 2 down. */
export function neighbour<T extends Tile>(tiles: T[], from: T, dir: -2 | -1 | 1 | 2): T | null {
  const cx = from.rect.x + from.rect.w / 2;
  const cy = from.rect.y + from.rect.h / 2;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const t of tiles) {
    if (t === from) continue;
    const tx = t.rect.x + t.rect.w / 2 - cx;
    const ty = t.rect.y + t.rect.h / 2 - cy;
    const along = dir === 1 ? tx : dir === -1 ? -tx : dir === 2 ? ty : -ty;
    const across = dir === 1 || dir === -1 ? ty : tx;
    if (along <= 1) continue;
    const score = along + Math.abs(across) * 1.8;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}
