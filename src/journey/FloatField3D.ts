import { GLHeadTracking, type HeadTrackingSurfaces } from './headTrackingSurface';
import {
  CanvasTexture, Color, EdgesGeometry, FogExp2, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Texture, VideoTexture, WebGLRenderer,
} from 'three';
import {
  FLOAT_STOPS, FOV, PANE_H, PANE_W, PANEL_TAG, buildBackground, holdDistance, holdPose, inPose, movePose, outPose, panelContent, sceneOfFeed,
  type FloatFraming, type FloatPose, type PanelKind, type SceneGroup,
} from './floatField';
import { CANVAS_H, CANVAS_W, drawCompanion } from './companionCanvas';
import { cityFacts, groupSpecs, portraitIndex, redrawEvery, type CompanionSpec, type Family } from './companions';
import { invalidate, markUploaded, needsDomOverlay, uploadAction, videoHasFrame, type TexState } from './handoff';
import { frameCount } from './frames';
import { uploadNow, watchContext } from './glUpload';

/**
 * Three.js renderer for the floating camera field. It owns no timer, no input and no media element:
 *  - `Journey` calls `render()` from its single frame loop with the state it wants drawn;
 *  - stop panes show `VideoTexture`s wrapping the EXISTING persistent <video> elements (never `new video`);
 *  - the dense background uses the existing poster images as textures (one instanced draw per feed poster);
 *  - `dispose()` frees GL resources only. VideoTexture/Texture disposal never pauses, removes or reloads a video.
 * Video textures are warmed explicitly (see `handoff.ts`), so the shared video never appears as a black plane.
 */
export interface FloatFrameInput {
  mode: 'in' | 'hold' | 'move' | 'out';
  slotA: number; framingA: FloatFraming;
  slotB: number; framingB: FloatFraming;
  /** Raw 0..1 progress of the current leg (ignored for `hold`). */
  f: number;
  /** Route leg index (selects the camera profile). */
  leg: number;
  /** Slot whose pane is currently drawn as the DOM overlay (the shared fullscreen video), or -1. */
  overlaySlot: number;
  /** Slots whose decorative context panels may show (this visit's medium-framed stops). */
  panelSlots: readonly number[];
  /** Companion family of each panelled stop of this visit (see `familyFor`); a slot not listed shows no companions. */
  families?: readonly { slot: number; family: number }[];
  /** Shared animation clock in seconds, the active city (all companion content belongs to it) and the reduced-motion flag. */
  time?: number; cityId?: string | null; reduced?: boolean;
  /** This visit's pane bindings (slot -> catalog feed index). Slots not listed show their default feed. */
  bindings?: readonly { slot: number; feedIndex: number }[];
  vw: number; vh: number;
}

/** Camera pose plus the slot the DOM video must still cover (-1: none), which can extend a hold until the texture is ready. */
export interface FloatRender extends FloatPose { overlay: number }

export interface FloatFieldOptions {
  tracking?: HeadTrackingSurfaces;
  host: HTMLElement;
  feedIds: readonly string[];
  /** The persistent decoder pool, indexed like `feedIds`. Read live; never created or paused here. */
  videos: () => readonly (HTMLVideoElement | null)[];
  posters: readonly HTMLImageElement[];
  labels: readonly string[];
  /** Pool indices (into `feedIds`) of the ACTIVE CITY: every default pane and the whole background show only these. */
  catalog?: readonly number[];
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Legacy static record renderer (the older single-kind companions); the field now draws `companionCanvas` families instead. */
export function panelCanvas(kind: PanelKind, slot: number, tagged: boolean, scene: SceneGroup | null = null, into?: HTMLCanvasElement): HTMLCanvasElement {
  const W = 384; const H = 240;
  const cv = into ?? document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const content = panelContent(kind, slot, scene);
  c.fillStyle = 'rgba(4,8,11,0.97)'; c.fillRect(0, 0, W, H); // near-opaque backing: background cameras never show through the copy
  c.strokeStyle = 'rgba(150,178,190,0.38)'; c.lineWidth = 1.5; c.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
  c.fillStyle = 'rgba(140,200,220,0.85)'; c.fillRect(0, 0, 4, H);
  c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(228,238,242,0.95)'; c.font = `600 20px ${MONO}`; c.fillText(content.title, 20, 32);
  c.fillStyle = 'rgba(150,178,190,0.9)'; c.font = `14px ${MONO}`; c.fillText(content.subtitle, 20, 54);
  // the one discreet designation (only the first panel of a stop carries it)
  if (tagged) {
    c.font = `11px ${MONO}`; const tw = c.measureText(PANEL_TAG).width;
    c.strokeStyle = 'rgba(150,178,190,0.5)'; c.lineWidth = 1; c.strokeRect(W - tw - 26, 14, tw + 12, 18);
    c.fillStyle = 'rgba(150,178,190,0.85)'; c.fillText(PANEL_TAG, W - tw - 20, 27);
  }
  c.strokeStyle = 'rgba(150,178,190,0.22)'; c.beginPath(); c.moveTo(20, 66); c.lineTo(W - 20, 66); c.stroke();

  let y = 94;
  const rowGap = kind === 'dossier' ? 27 : 30;
  const ink = 'rgba(226,236,240,0.95)'; const dim = 'rgba(130,158,170,0.85)'; const line = 'rgba(150,178,190,0.5)'; const accent = 'rgba(140,200,220,0.8)';
  const foot = () => { c.fillStyle = 'rgba(150,178,190,0.8)'; c.font = `italic 12px ${MONO}`; c.fillText(content.lines[0] ?? '', 20, H - 14); };
  if (kind === 'checklist') {
    content.rows.forEach(([n, label], i) => {
      const ry = 96 + i * 24;
      c.strokeStyle = line; c.lineWidth = 1.3; c.strokeRect(20.5, ry - 11.5, 13, 13); // empty tick box: a blank form
      c.fillStyle = dim; c.font = `12px ${MONO}`; c.fillText(n, 44, ry);
      c.fillStyle = ink; c.font = `16px ${MONO}`; c.fillText(label, 62, ry);
    });
    foot();
  } else if (kind === 'floorplan') {
    content.rows.forEach(([k, label], i) => {
      c.fillStyle = accent; c.font = `600 17px ${MONO}`; c.fillText(k, 20, 100 + i * 28);
      c.fillStyle = ink; c.font = `14px ${MONO}`; c.fillText(label, 44, 100 + i * 28);
    });
    const x0 = 206; const y0 = 80; const w = 158; const h = 116;
    c.strokeStyle = 'rgba(150,178,190,0.7)'; c.lineWidth = 2; c.strokeRect(x0, y0, w, h);
    c.strokeStyle = line; c.lineWidth = 1; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(x0 + w * (0.42 + ((slot * 7) % 5) / 50), y0); c.lineTo(x0 + w * (0.42 + ((slot * 7) % 5) / 50), y0 + h); c.moveTo(x0, y0 + h * 0.52); c.lineTo(x0 + w, y0 + h * 0.52); c.stroke();
    c.setLineDash([]);
    c.fillStyle = accent; c.font = `600 15px ${MONO}`;
    [[0.2, 0.28], [0.72, 0.28], [0.2, 0.78], [0.72, 0.78]].forEach(([fx, fy], i) => c.fillText('ABCD'[i], x0 + w * fx, y0 + h * fy + 5));
    c.clearRect(x0 + w * 0.5 - 12, y0 + h - 2, 24, 4); c.fillStyle = 'rgba(4,8,11,0.97)'; c.fillRect(x0 + w * 0.5 - 12, y0 + h - 2, 24, 4); // door gap
    foot();
  } else if (kind === 'siteplan') {
    content.rows.forEach(([k, label], i) => {
      c.fillStyle = dim; c.font = `13px ${MONO}`; c.fillText(k, 20, 100 + i * 34);
      c.fillStyle = ink; c.font = `16px ${MONO}`; c.fillText(label, 20, 118 + i * 34);
    });
    const x0 = 190; const y0 = 80; const w = 176; const h = 116;
    c.strokeStyle = line; c.lineWidth = 1; c.strokeRect(x0, y0, w, h);
    if (scene === 'road') { // two lanes, a dashed centre line and a crossing: a blank observation template
      c.strokeStyle = 'rgba(150,178,190,0.7)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x0, y0 + h * 0.3); c.lineTo(x0 + w, y0 + h * 0.3); c.moveTo(x0, y0 + h * 0.7); c.lineTo(x0 + w, y0 + h * 0.7); c.stroke();
      c.setLineDash([8, 6]); c.beginPath(); c.moveTo(x0, y0 + h * 0.5); c.lineTo(x0 + w, y0 + h * 0.5); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(150,178,190,0.55)';
      for (let i = 0; i < 5; i++) c.fillRect(x0 + w * (0.55 + (slot % 3) * 0.04) + i * 7, y0 + h * 0.3, 4, h * 0.4);
    } else { // two blocks and a walkway between them
      c.strokeStyle = 'rgba(150,178,190,0.7)'; c.lineWidth = 1.5;
      c.strokeRect(x0 + 14, y0 + 14, w * 0.38, h * 0.34); c.strokeRect(x0 + w * 0.5, y0 + h * 0.5, w * 0.42, h * 0.38);
      c.strokeStyle = accent; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(x0 + 18, y0 + h * 0.8); c.lineTo(x0 + w * 0.45, y0 + h * 0.62); c.lineTo(x0 + w * 0.82, y0 + h * 0.3); c.stroke(); c.setLineDash([]);
    }
    [['A', 0.12, 0.5], ['B', 0.88, 0.5]].forEach(([k, fx, fy]) => {
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.4; c.beginPath(); c.arc(x0 + w * (fx as number), y0 + h * (fy as number), 9, 0, Math.PI * 2); c.stroke();
      c.fillStyle = ink; c.font = `600 12px ${MONO}`; c.fillText(k as string, x0 + w * (fx as number) - 4, y0 + h * (fy as number) + 4);
    });
    foot();
  } else for (const [label, value] of content.rows) {
    c.fillStyle = 'rgba(130,158,170,0.85)'; c.font = `13px ${MONO}`; c.fillText(label, 20, y);
    c.fillStyle = 'rgba(226,236,240,0.95)'; c.font = `18px ${MONO}`; c.fillText(value, 132, y);
    if (kind === 'ledger') { c.strokeStyle = 'rgba(150,178,190,0.28)'; c.lineWidth = 1; c.beginPath(); c.moveTo(132, y + 5); c.lineTo(W - 20, y + 5); c.stroke(); }
    y += rowGap;
  }
  if (kind === 'ledger') {
    c.fillStyle = 'rgba(150,178,190,0.8)'; c.font = `italic 12px ${MONO}`; c.fillText(content.lines[0] ?? '', 20, H - 14);
  } else if (kind === 'news') {
    c.fillStyle = 'rgba(226,236,240,0.95)'; c.font = `17px ${MONO}`;
    content.lines.slice(0, 2).forEach((l, i) => c.fillText(l, 20, 98 + i * 26));
    c.fillStyle = 'rgba(130,158,170,0.85)'; c.font = `12px ${MONO}`; c.fillText(content.lines[2] ?? '', 20, 174);
  } else if (kind === 'dossier') {
    c.fillStyle = 'rgba(150,178,190,0.8)'; c.font = `italic 13px ${MONO}`; c.fillText(content.lines[0] ?? '', 20, H - 22);
  } else if (kind === 'location') {
    // schematic coastline + grid, authored per slot; not a real map
    const x0 = 200; const y0 = 80; const w = 164; const h = 120;
    c.strokeStyle = 'rgba(150,178,190,0.2)'; c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(x0 + (w * i) / 4, y0); c.lineTo(x0 + (w * i) / 4, y0 + h); c.stroke(); c.beginPath(); c.moveTo(x0, y0 + (h * i) / 4); c.lineTo(x0 + w, y0 + (h * i) / 4); c.stroke(); }
    c.strokeStyle = 'rgba(140,200,220,0.8)'; c.lineWidth = 1.6; c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const px = x0 + w * t; const py = y0 + h * (0.55 + 0.22 * Math.sin(t * 5 + slot) + 0.12 * Math.sin(t * 13 + slot * 2));
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    const mx = x0 + w * (0.3 + ((slot * 37) % 40) / 100); const my = y0 + h * 0.4;
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(mx, my, 5, 0, Math.PI * 2); c.moveTo(mx - 10, my); c.lineTo(mx + 10, my); c.moveTo(mx, my - 10); c.lineTo(mx, my + 10); c.stroke();
  } else if (kind === 'waveform') {
    const x0 = 20; const w = W - 40; const base = 176;
    c.strokeStyle = 'rgba(150,178,190,0.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, base); c.lineTo(x0 + w, base); c.stroke();
    for (let i = 0; i <= 10; i++) { c.beginPath(); c.moveTo(x0 + (w * i) / 10, base); c.lineTo(x0 + (w * i) / 10, base + 5); c.stroke(); }
    c.strokeStyle = 'rgba(120,230,200,0.88)'; c.lineWidth = 1.8; c.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const t = x / 22;
      const py = base - 6 - 20 - Math.sin(t + slot) * 16 - Math.sin(t * 2.7 + slot * 2) * 9 - Math.sin(t * 6.1) * 4;
      if (x === 0) c.moveTo(x0 + x, py); else c.lineTo(x0 + x, py);
    }
    c.stroke();
  }
  return cv;
}

interface VideoEntry { tex: VideoTexture; st: TexState }

export class FloatField3D {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 1700);
  private opts: FloatFieldOptions;
  private posterTex: Texture[];
  private videoTex = new Map<number, VideoEntry>();
  private headTracking: GLHeadTracking;
  private disposables: { dispose(): void }[] = [];
  private panes: { group: Group; material: MeshBasicMaterial; geometry: PlaneGeometry; overlay?: Mesh<PlaneGeometry,MeshBasicMaterial>; feedIndex: number }[] = [];
  private defaultFeed: number[] = [];
  private panels: { slot: number; mesh: Mesh; spec: number; cv: HTMLCanvasElement | null; tex: CanvasTexture | null; key: string; layoutKey: string; at: number }[] = [];
  /** The three fictional portraits (one 1536 x 1024 sheet, three columns); requested only when a portrait card first shows. */
  private portraits: HTMLImageElement | null = null;
  private portraitsFor() {
    if (!this.portraits) { this.portraits = new Image(); this.portraits.src = `${import.meta.env.BASE_URL}assets/companions/fictional-portraits-v1.png`; }
    return this.portraits;
  }
  private batches: InstancedMesh[] = [];
  private w = 0; private h = 0;

  constructor(opts: FloatFieldOptions) {
    this.opts = opts;
    const r = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = SRGBColorSpace;
    r.domElement.className = 'float';
    r.domElement.setAttribute('aria-hidden', 'true');
    r.domElement.style.visibility = 'hidden';
    opts.host.appendChild(r.domElement);
    this.renderer = r;
    this.headTracking = new GLHeadTracking(r,opts.tracking,true);
    this.unwatch = watchContext(r, () => { this.lost = true; this.rewarm(); }, () => { this.lost = false; this.rewarm(); });
    this.scene.background = new Color('#05090c');
    this.scene.fog = new FogExp2('#05090c', 0.0015);

    this.posterTex = opts.posters.map((img) => {
      const t = new Texture(img); t.colorSpace = SRGBColorSpace;
      this.disposables.push(t);
      return t;
    });

    // Stop panes (video-capable, poster until the decoder has a frame and the texture is warm).
    this.catalog = opts.catalog && opts.catalog.length ? [...opts.catalog] : opts.feedIds.map((_, i) => i);
    FLOAT_STOPS.forEach((stop) => {
      const feedIndex = this.catalog[stop.slot % this.catalog.length]; // city-scoped default: never another city's feed
      const geo = new PlaneGeometry(PANE_W, PANE_H);
      const mat = new MeshBasicMaterial({ map: this.posterTex[feedIndex] ?? null, color: '#ffffff' });
      const group = new Group(); group.position.set(stop.x, stop.y, stop.z);
      group.add(new Mesh(geo, mat));
      const border = new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: '#8c9894', transparent: true, opacity: 0.65 }));
      border.position.z = 0.015; group.add(border);
      this.scene.add(group);
      this.disposables.push(geo, mat, border.geometry, border.material as LineBasicMaterial);
      this.panes.push({ group, material: mat, geometry: geo, feedIndex });
      this.defaultFeed.push(feedIndex);
    });

    // Companion panels (two per stop). Meshes only: the canvas texture of a panel is created on first use and redrawn for the
    // family / city / feed it currently shows. Canvas textures only; no media, no decoder.
    FLOAT_STOPS.forEach((stop) => {
      for (let i = 0; i < 2; i++) {
        const geo = new PlaneGeometry(1, 1);
        // Drawn after every opaque plane and without depth testing, so no background thumbnail (however close in depth) covers the card.
        const mat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
        const mesh = new Mesh(geo, mat); mesh.visible = false; mesh.renderOrder = 10;
        this.scene.add(mesh);
        this.disposables.push(geo, mat);
        this.panels.push({ slot: stop.slot, mesh, spec: i, cv: null, tex: null, key: '', layoutKey: '', at: -1e9 });
      }
    });

    this.buildBackdrop();
    this.portraitsFor(); // one small local companion sheet, requested while the field is built idle (no first-use pop-in)
  }

  private catalog: number[] = [];

  /** Dense asymmetric background: one instanced draw per poster texture of the ACTIVE CITY's catalog (and no other). */
  private buildBackdrop() {
    const opts = this.opts; const cat = this.catalog;
    const variants = Math.max(1, cat.length);
    // Pictures of one motif family (aircraft ramp, building + lawn, ...) are kept apart as if they were the same picture.
    const FAM: Record<SceneGroup, number> = { aircraft: 0, dock: 1, gym: 2, road: 3, campus: 4, clinic: 4, office: 4 };
    const bg = buildBackground(variants, cat.map((gi, i) => { const g = sceneOfFeed(opts.feedIds[gi]); return g ? FAM[g] : 100 + i; }));
    const dummy = new Object3D(); const tint = new Color();
    for (let ti = 0; ti < variants; ti++) {
      const entries = bg.filter((p) => p.texture === ti);
      // (assignment is farthest-first per picture / motif family: see assignTextures)
      if (!entries.length) continue;
      const geo = new PlaneGeometry(1, 9 / 16);
      const mat = new MeshBasicMaterial({ map: this.posterTex[cat[ti]] ?? null, color: '#9aa7a8' });
      const mesh = new InstancedMesh(geo, mat, entries.length);
      entries.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z); dummy.scale.setScalar(p.w); dummy.rotation.set(0, p.ry, 0); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint.setScalar(p.shade));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.batches.push(mesh);
      this.backdrop.push(geo, mat);
    }
  }
  private backdrop: { dispose(): void }[] = [];

  /**
   * Rebinds the field to another city's catalog (global pool indices): default panes and the whole background then show only
   * that city's sources. Cheap no-op when unchanged; called while the field is not on screen (the city changed at the globe).
   */
  setCatalog(catalog: readonly number[]) {
    const next = catalog.length ? [...catalog] : this.catalog;
    if (next.length === this.catalog.length && next.every((v, i) => v === this.catalog[i])) return;
    this.catalog = next;
    for (const b of this.batches) { this.scene.remove(b); b.dispose(); }
    this.batches = [];
    for (const d of this.backdrop) d.dispose();
    this.backdrop = [];
    this.defaultFeed = FLOAT_STOPS.map((stop) => next[stop.slot % next.length]);
    this.buildBackdrop();
  }

  setVisible(v: boolean) {
    const s = this.renderer.domElement.style;
    const want = v ? 'visible' : 'hidden';
    if (s.visibility !== want) s.visibility = want;
  }

  private setSize(vw: number, vh: number) {
    if (vw === this.w && vh === this.h) return;
    this.w = vw; this.h = vh;
    this.camera.aspect = vw / Math.max(1, vh);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(vw, vh, false);
  }

  /** Places a panel for its family at its stop (only when the family or orientation changed: no per-frame layout jitter). */
  private placePanel(p: FloatField3D['panels'][number], sp: CompanionSpec) {
    const stop = FLOAT_STOPS[p.slot];
    p.mesh.position.set(stop.x + sp.dx, stop.y + sp.dy, stop.z + sp.dz);
    p.mesh.scale.set(sp.w, sp.h, 1); p.mesh.rotation.set(0, sp.ry, 0);
  }

  /** Texture sources that finished loading after construction get uploaded; no listeners, polled from the frame. */
  private syncPosters() {
    this.opts.posters.forEach((img, i) => {
      const t = this.posterTex[i];
      if (t && !t.userData.ready && img.complete && img.naturalWidth > 0) { t.userData.ready = true; t.needsUpdate = true; }
    });
  }

  /**
   * Makes the video's texture current: created once the video has a decoded frame, uploaded explicitly (even while its
   * mesh is hidden), and re-flagged whenever `currentTime` moves. Returns whether it has been uploaded at least once.
   */
  private syncVideo(feedIndex: number): boolean {
    const v = this.opts.videos()[feedIndex];
    let e = this.videoTex.get(feedIndex);
    if (!v || !videoHasFrame(v)) return !!e?.st.warmed;
    if (!e) {
      const tex = new VideoTexture(v); tex.colorSpace = SRGBColorSpace;
      e = { tex, st: { warmed: false, lastTime: -1 } };
      this.videoTex.set(feedIndex, e); this.disposables.push(tex);
    }
    if (this.lost) return false; // nothing can be uploaded: the DOM video keeps covering the hold
    const frames = frameCount(v);
    const action = uploadAction(v, e.st, frames);
    if (action !== 'none') {
      e.tex.needsUpdate = true;
      markUploaded(e.st, action, v, frames, action === 'warm' ? uploadNow(this.renderer, e.tex) : true);
    }
    this.headTracking.sync(this.opts.feedIds[feedIndex],v);
    return e.st.warmed && this.headTracking.isWarm(this.opts.feedIds[feedIndex]);
  }

  /** Context lost: every texture is stale and drawing pauses. Restored: textures re-warm (under the DOM pane) before promotion. */
  private lost = false;
  private unwatch: (() => void) | null = null;
  /** Mark every video texture un-warmed (context return, tab return): the next hold frame re-uploads before promoting. */
  rewarm() { this.headTracking.invalidate(); for (const e of this.videoTex.values()) { invalidate(e.st); e.tex.needsUpdate = true; } }

  /** Draws one frame; returns the camera pose and the slot the DOM video must still cover. */
  render(f: FloatFrameInput): FloatRender {
    this.setSize(f.vw, f.vh);
    const aspect = f.vw / Math.max(1, f.vh);
    this.syncPosters();
    let p: FloatPose;
    switch (f.mode) {
      case 'in': p = inPose(f.slotA, f.framingA, f.f, aspect); break;
      case 'out': p = outPose(f.slotA, f.framingA, f.f, aspect); break;
      case 'move': p = movePose(f.slotA, f.framingA, f.slotB, f.framingB, f.f, f.leg, aspect); break;
      default: p = holdPose(f.slotA, f.framingA, aspect);
    }
    this.camera.position.set(p.eye.x, p.eye.y, p.eye.z);
    this.camera.lookAt(p.aim.x, p.aim.y, p.aim.z);
    this.camera.updateMatrixWorld();

    // Spatial slot vs camera identity: this visit's stops show their planned feeds; every other pane its default feed.
    this.panes.forEach((pane, slot) => { pane.feedIndex = this.defaultFeed[slot]; });
    for (const b of f.bindings ?? []) if (this.panes[b.slot] && b.feedIndex >= 0) this.panes[b.slot].feedIndex = b.feedIndex;

    // Prewarm the shared video of the current stop (and the next one while travelling) while still under the DOM pane.
    const warmA = this.syncVideo(this.panes[f.slotA].feedIndex);
    if (f.mode === 'move') this.syncVideo(this.panes[f.slotB].feedIndex);
    const overlay = f.mode === 'hold' ? (needsDomOverlay('hold', warmA) ? f.slotA : -1) : f.overlaySlot;

    this.panes.forEach((pane, slot) => {
      const near = Math.abs(pane.group.position.z - p.eye.z) < 520;
      pane.group.visible = near && slot !== overlay;
      if (!pane.group.visible) return;
      const warm = this.syncVideo(pane.feedIndex);
      const entry = this.videoTex.get(pane.feedIndex);
      const map = warm && entry ? entry.tex : this.posterTex[pane.feedIndex] ?? null;
      if (pane.material.map !== map) { pane.material.map = map; pane.material.needsUpdate = true; }
      const heads=this.headTracking.sync(this.opts.feedIds[pane.feedIndex],this.opts.videos()[pane.feedIndex],1);
      if(heads && !pane.overlay){
        const material=new MeshBasicMaterial({map:heads.texture,transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
        pane.overlay=new Mesh(pane.geometry,material);pane.overlay.position.z=.002;pane.group.add(pane.overlay);this.disposables.push(material);
      }
      if(pane.overlay && heads && pane.overlay.material.map!==heads.texture){pane.overlay.material.map=heads.texture;pane.overlay.material.needsUpdate=true;}
      if(pane.overlay) pane.overlay.visible=!!heads?.ready && !!heads.visible && !!entry && map===entry.tex;
    });
    const medD = holdDistance('medium', aspect);
    const land = aspect >= 1; const clockT = f.time ?? 0;
    for (const pl of this.panels) {
      const stop = FLOAT_STOPS[pl.slot];
      let o = 0;
      const fam = f.families?.find((x) => x.slot === pl.slot)?.family;
      if (fam !== undefined && f.panelSlots.includes(pl.slot)) {
        const sp = groupSpecs(fam as Family, pl.slot, land)[pl.spec];
        const lk = `${fam}|${land ? 1 : 0}`;
        if (pl.layoutKey !== lk) { pl.layoutKey = lk; pl.key = ''; this.placePanel(pl, sp); } // layout only changes with family / orientation
        const dist = Math.hypot(p.eye.x - stop.x, p.eye.y - stop.y, p.eye.z - stop.z);
        // Short coordinated stagger: the second card of a group settles a beat after the first as the camera arrives.
        o = smooth(clamp((medD * 1.5 - dist) / (medD * 0.6) - pl.spec * 0.22, 0, 1));
        if (o > 0.01) {
          const city = f.cityId ?? null; const feedIdx = this.panes[pl.slot].feedIndex;
          const im = sp.role === 'portrait' ? this.portraitsFor() : null;
          const loaded = im && im.complete && im.naturalWidth > 0 ? 1 : 0;
          const key = `${lk}|${city}|${feedIdx}|${loaded}`;
          const every = redrawEvery(sp.role, !!f.reduced);
          if (pl.key !== key || (every > 0 && clockT - pl.at >= every)) {
            if (!pl.cv) {
              pl.cv = document.createElement('canvas'); pl.cv.width = CANVAS_W; pl.cv.height = CANVAS_H;
              pl.tex = new CanvasTexture(pl.cv); pl.tex.colorSpace = SRGBColorSpace; this.disposables.push(pl.tex);
              const pm = pl.mesh.material as MeshBasicMaterial; pm.map = pl.tex; pm.needsUpdate = true;
            }
            drawCompanion(pl.cv, sp.role, sp.w, sp.h, {
              time: clockT, reduced: !!f.reduced, city: cityFacts(city), cityId: city, slot: pl.slot,
              feedLabel: this.opts.labels[feedIdx] ?? '', portraitIdx: portraitIndex(city, pl.slot), portraits: im,
            });
            pl.tex!.needsUpdate = true; pl.key = key; pl.at = clockT;
          }
        }
      }
      const m = pl.mesh.material as MeshBasicMaterial;
      m.opacity = o; pl.mesh.visible = o > 0.01;
    }
    if (!this.lost) this.renderer.render(this.scene, this.camera);
    return { eye: p.eye, aim: p.aim, overlay };
  }

  /** Frees GPU/CPU resources owned by the field. Never touches the shared <video> elements. */
  dispose() {
    this.headTracking.dispose();
    for (const m of this.batches) { this.scene.remove(m); m.dispose(); }
    for (const d of this.disposables) d.dispose();
    for (const d of this.backdrop) d.dispose();
    this.disposables = []; this.backdrop = []; this.videoTex.clear();
    this.unwatch?.(); this.unwatch = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
