import { CanvasTexture, type Mesh, type MeshBasicMaterial, type Object3D, type Texture } from 'three';

/**
 * City-local camera photographs for the authored neural scene (runtime only; the GLB binary is never touched).
 *
 * The scene's camera photos and background photo nodes sample ONE embedded atlas through the `mat_field_nodes` /
 * `mat_macro_nodes` materials (the same meshes `machinePhotoPresentation` biases). Those atlas photographs are foreign
 * fictional scenes, so for the ACTIVE CITY a canvas atlas of the very same size replaces the material's `map`: every UV
 * island (one island = one photograph, found from the mesh's own triangles) is repainted, cover-cropped to that island's
 * aspect, with a poster of the active city's own catalogue. UVs, geometry, animation and tone are unchanged. A poster that is
 * not decoded yet leaves its island NEUTRAL (never the foreign photo). Non-photo regions of the atlas keep the authored pixels.
 */
export interface UvRect { u0: number; v0: number; u1: number; v1: number }

/**
 * UV islands of a mesh: triangles connected through shared vertex indices form one photograph; its rect is the UV bbox.
 * Non-indexed geometry gives one island per triangle (a quad's two triangles share the same bbox and dedupe later).
 */
export function uvIslands(index: ArrayLike<number> | null, count: number, u: (i: number) => number, v: (i: number) => number): UvRect[] {
  const parent = new Int32Array(count); for (let i = 0; i < count; i++) parent[i] = i;
  const used = new Uint8Array(count);
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const n = index ? index.length : count;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = index ? index[t] : t; const b = index ? index[t + 1] : t + 1; const c = index ? index[t + 2] : t + 2;
    if (a >= count || b >= count || c >= count) continue;
    used[a] = used[b] = used[c] = 1; union(a, b); union(b, c);
  }
  const boxes = new Map<number, UvRect>();
  for (let i = 0; i < count; i++) {
    if (!used[i]) continue;
    const r = find(i); const x = u(i); const y = v(i);
    const b = boxes.get(r);
    if (!b) boxes.set(r, { u0: x, v0: y, u1: x, v1: y });
    else { b.u0 = Math.min(b.u0, x); b.u1 = Math.max(b.u1, x); b.v0 = Math.min(b.v0, y); b.v1 = Math.max(b.v1, y); }
  }
  return [...boxes.values()];
}

const q = (x: number) => Math.round(x * 1e4);
/** Distinct rects (quantised), in a stable reading order (top to bottom, then left to right). */
export function uniqueRects(rects: readonly UvRect[]): UvRect[] {
  const seen = new Map<string, UvRect>();
  for (const r of rects) seen.set(`${q(r.u0)},${q(r.v0)},${q(r.u1)},${q(r.v1)}`, r);
  return [...seen.values()].sort((a, b) => a.v0 - b.v0 || a.u0 - b.u0 || a.v1 - b.v1 || a.u1 - b.u1);
}

/** Poster slot of the k-th rect for a catalogue of `n` posters: cycles, so a one-clip city repeats its clip truthfully. */
export const posterSlot = (k: number, n: number) => (n > 0 ? k % n : -1);

/** Centre cover crop of a (sw x sh) source into a (dw x dh) frame: no stretch, no random giant crop of the poster. */
export function coverCrop(sw: number, sh: number, dw: number, dh: number) {
  const s = Math.max(dw / sw, dh / sh);
  const cw = dw / s; const ch = dh / s;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

const NEUTRAL = '#0b1114';
const MAX_SIZE = 2048;
const NAMES = /^mat_(field|macro)_nodes$/;
const ready = (im: HTMLImageElement | undefined | null): im is HTMLImageElement => !!im && im.complete && im.naturalWidth > 0;

interface Group { orig: Texture; cv: HTMLCanvasElement; tex: CanvasTexture | null; rects: UvRect[]; mats: Set<MeshBasicMaterial> }

export function createNeuralCityAtlas(root: Object3D) {
  const groups = new Map<Texture, Group>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as MeshBasicMaterial;
    if (!NAMES.test(mat.name) || !mat.map) return;
    const uv = mesh.geometry.getAttribute('uv');
    if (!uv) return;
    let g = groups.get(mat.map);
    if (!g) { g = { orig: mat.map, cv: document.createElement('canvas'), tex: null, rects: [], mats: new Set() }; groups.set(mat.map, g); }
    g.mats.add(mat);
    g.rects.push(...uvIslands(mesh.geometry.getIndex()?.array ?? null, uv.count, (i) => uv.getX(i), (i) => uv.getY(i)));
  });
  for (const g of groups.values()) g.rects = uniqueRects(g.rects);

  const paint = (g: Group, images: readonly (HTMLImageElement | undefined | null)[]) => {
    const src = g.orig.image as { width?: number; height?: number } | null;
    const ow = src?.width || 1024; const oh = src?.height || 1024;
    const k = Math.min(1, MAX_SIZE / Math.max(ow, oh));
    const W = Math.max(2, Math.round(ow * k)); const H = Math.max(2, Math.round(oh * k));
    if (g.cv.width !== W || g.cv.height !== H) { g.cv.width = W; g.cv.height = H; }
    const ctx = g.cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = NEUTRAL; ctx.fillRect(0, 0, W, H);
    try { if (src && src.width) ctx.drawImage(src as CanvasImageSource, 0, 0, W, H); } catch { /* keep neutral */ }
    g.rects.forEach((r, i) => {
      const x = r.u0 * W; const y = r.v0 * H; const w = (r.u1 - r.u0) * W; const h = (r.v1 - r.v0) * H;
      if (w < 3 || h < 3) return; // sub-pixel islands are not photographs (keep the authored pixels)
      ctx.fillStyle = NEUTRAL; ctx.fillRect(x, y, w, h); // the foreign photograph never shows, loaded poster or not
      const im = images[posterSlot(i, images.length)];
      if (!ready(im)) return;
      const c = coverCrop(im.naturalWidth, im.naturalHeight, w, h);
      ctx.drawImage(im, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
    });
  };

  let sig = '';
  let disposed = false;
  return {
    /** Photo meshes found / photograph islands, for review. */
    get stats() { return { atlases: groups.size, islands: [...groups.values()].reduce((n, g) => n + g.rects.length, 0) }; },
    /** Repaints only when the city or the set of decoded posters changed (cheap to call every frame). */
    update(cityKey: string | null, images: readonly (HTMLImageElement | undefined | null)[]) {
      if (disposed) return;
      const next = `${cityKey ?? ''}|${images.map((im) => (ready(im) ? 1 : 0)).join('')}`;
      if (next === sig) return;
      sig = next;
      for (const g of groups.values()) {
        paint(g, images);
        if (!g.tex) {
          const t = new CanvasTexture(g.cv);
          const o = g.orig;
          t.colorSpace = o.colorSpace; t.flipY = false; t.wrapS = o.wrapS; t.wrapT = o.wrapT;
          t.minFilter = o.minFilter; t.magFilter = o.magFilter; t.anisotropy = o.anisotropy; t.generateMipmaps = o.generateMipmaps;
          t.offset.copy(o.offset); t.repeat.copy(o.repeat); t.center.copy(o.center); t.rotation = o.rotation;
          g.tex = t;
          for (const m of g.mats) { m.map = t; m.needsUpdate = true; }
        } else g.tex.needsUpdate = true;
      }
    },
    /** Puts the authored map back on every material and frees the canvas textures (the authored texture is not ours to free). */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const g of groups.values()) {
        for (const m of g.mats) { m.map = g.orig; m.needsUpdate = true; }
        g.tex?.dispose(); g.tex = null; g.mats.clear();
      }
      groups.clear();
    },
  };
}
export type NeuralCityAtlas = ReturnType<typeof createNeuralCityAtlas>;
