import {
  Box3, Color, Mesh, MeshBasicMaterial, Quaternion, Scene, SRGBColorSpace, Vector3, VideoTexture, WebGLRenderer,
  type BufferGeometry, type Material, type Object3D,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { invalidate, markUploaded, uploadAction, type TexState } from './handoff';
import { frameCount } from './frames';
import { withDolly } from './neuralSource/dolly';
import { uploadNow, watchContext } from './glUpload';
import { disposeObjectTree } from './neuralSource/dispose';
import { createMachineFraming } from './neuralSource/machineFraming';
import { createMachinePhotoPresentation, type MachinePhotoPresentation } from './neuralSource/machinePhotoPresentation';
import { createNeuralCityAtlas, type NeuralCityAtlas } from './neuralSource/cityAtlas';
import { createMachineSynapse, type MachineSynapse } from './neuralSource/machineSynapse';
import { createMachineTreatment, type FocusHold, type MachineTreatment } from './neuralSource/machineTreatment';
import { createSceneRig, type SceneRig } from './neuralSource/sceneRig';
import { buildTravelProfile, type CameraPose, type TravelProfile } from './neuralSource/travelProfile';

/**
 * Adapter that renders the accepted authored neural scene (GLB + manifest) for the journey.
 *
 * Visual integration order is exactly: scene rig -> synapse -> treatment -> photo presentation (the helpers in
 * `neuralSource/` are used unchanged). Time comes only from `render({ time })`: the authored clip is evaluated at
 * exactly that second, so the Journey frame loop is the single clock. This class owns no RAF, no input listener and no
 * media element: screens show `VideoTexture`s wrapping the EXISTING persistent <video> elements, and `dispose()`
 * frees GPU/scene resources only, never pausing, removing or reloading a video.
 */
export interface NeuralManifest {
  cameraName: string; clipName: string; durationSeconds: number; framingAspectRatio: number;
  focalScreenName: string; backgroundColor: string; sceneUrl: string;
  anchors: FocusHold[];
}

export interface NeuralAssets { manifest: NeuralManifest; gltf: GLTF }

export interface NeuralWorldOptions {
  host: HTMLElement;
  feedIds: readonly string[];
  /** The persistent decoder pool, indexed like `feedIds`. Read live; never created or paused here. */
  videos: () => readonly (HTMLVideoElement | null)[];
  /**
   * The ACTIVE CITY's already-loaded poster images (live read). Every camera photo / background photo node of the scene is
   * repainted from them (see neuralSource/cityAtlas.ts); undecoded posters stay neutral, never the authored foreign photo.
   */
  cityPosters: () => { key: string | null; images: readonly (HTMLImageElement | undefined | null)[] };
}

export interface NeuralFrame {
  /** Authored clip seconds to evaluate exactly. */
  time: number;
  /** Optional direct world camera pose overriding the authored track for this draw (neuralMove legs). */
  pose?: CameraPose;
  /** 0..1: how far the camera has pulled straight back from its authored pose (the exit to the globe). */
  dolly: number;
  /** Anchors whose screen rect should be captured inside this draw's exact camera transform (see `drawnRect`). */
  project?: readonly number[];
  /** Anchor whose screen mesh is not drawn this frame (the DOM pane owns that picture; see `render`). */
  hideAnchor?: number;
  vw: number; vh: number;
}

export interface PxRect { x: number; y: number; w: number; h: number }

/** How far (scene units) a full pull-back dollies the authored camera; the scene spans ~1300 units of depth. */
const DOLLY_DISTANCE = 2600;

/** Fetches and parses manifest + GLB (async, no GL context needed). Meshopt-compressed geometry is supported. */
export async function loadNeuralAssets(baseUrl: string): Promise<NeuralAssets> {
  const manifestUrl = new URL(`${baseUrl}assets/machine/manifest.json`, window.location.href);
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const manifest = (await res.json()) as NeuralManifest;
  if (!manifest.cameraName || !manifest.clipName || !Array.isArray(manifest.anchors) || !manifest.sceneUrl) throw new Error('manifest incomplete');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(new URL(manifest.sceneUrl, manifestUrl).href);
  return { manifest, gltf };
}

interface Override {
  mesh: Mesh; geometry: BufferGeometry; material: Material | Material[]; own: BufferGeometry; ownMaterial: MeshBasicMaterial; feedIndex: number;
}

export class NeuralWorld {
  readonly holds: readonly FocusHold[];
  duration = 0;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private rig!: SceneRig;
  private synapse!: MachineSynapse;
  private treatment!: MachineTreatment;
  private photo!: MachinePhotoPresentation;
  private cityAtlas!: NeuralCityAtlas;
  private frame!: (w: number, h: number) => unknown;
  private root: Object3D;
  private opts: NeuralWorldOptions;
  private videoTex = new Map<number, VideoTexture>();
  private texState = new Map<number, TexState>();
  private overrides: Override[] = [];
  private screenCache = new Map<number, Mesh | null>();
  private drawn = new Map<number, PxRect>();
  private w = 0; private h = 0;
  private disposed = false;
  private profiles = new Map<string, TravelProfile>();
  private lastTime = 0;

  /** Builds the GL context and every authored layer. Throws if the scene does not satisfy the helpers' contracts. */
  constructor(assets: NeuralAssets, opts: NeuralWorldOptions) {
    const { manifest, gltf } = assets;
    this.opts = opts;
    this.root = gltf.scene;
    this.holds = manifest.anchors;
    const r = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = SRGBColorSpace;
    r.domElement.className = 'neural';
    r.domElement.setAttribute('aria-hidden', 'true');
    r.domElement.style.visibility = 'hidden';
    this.renderer = r;
    try {
      this.scene.background = new Color(manifest.backgroundColor);
      this.scene.add(gltf.scene);
      // rig -> synapse -> treatment -> photo presentation
      this.rig = createSceneRig(gltf.scene, gltf.animations, {
        cameraName: manifest.cameraName, clipName: manifest.clipName,
        durationSeconds: manifest.durationSeconds, focalScreenName: manifest.focalScreenName,
      });
      this.duration = this.rig.duration;
      const synapse = createMachineSynapse(gltf.scene);
      if (!synapse) throw new Error('authored neural scene is missing MachineMacroEXP01 / macro_far / macro_links_group');
      this.synapse = synapse;
      this.treatment = createMachineTreatment(gltf.scene, manifest.anchors);
      this.photo = createMachinePhotoPresentation(gltf.scene);
      // After the photo presentation (its cloned materials carry the atlas): the active city's posters replace the foreign
      // atlas before the first draw. A released focused override restores THIS material, so it stays the city's.
      this.cityAtlas = createNeuralCityAtlas(gltf.scene);
      this.syncCity();
      this.frame = createMachineFraming(this.rig.camera, manifest.framingAspectRatio);
      this.rig.camera.far = Math.max(this.rig.camera.far, 6000);
      this.rig.camera.updateProjectionMatrix();
      this.rig.seek(0);
    } catch (err) {
      r.dispose();
      throw err;
    }
    opts.host.appendChild(r.domElement);
    this.unwatch = watchContext(r, () => { this.lost = true; this.rewarm(); }, () => { this.lost = false; this.rewarm(); });
  }

  /** Repaints the scene's photo atlas when the active city or the set of decoded posters changed (cheap; safe every frame). */
  syncCity() {
    if (this.disposed) return;
    const c = this.opts.cityPosters();
    this.cityAtlas.update(c.key, c.images);
  }

  setVisible(visible: boolean, opacity = 1) {
    const s = this.renderer.domElement.style;
    const v = visible ? 'visible' : 'hidden';
    if (s.visibility !== v) s.visibility = v;
    const o = opacity.toFixed(3);
    if (s.opacity !== o) s.opacity = o;
  }

  /**
   * Pose-aware profile of one authored leg (built once per leg and cached; ~65 rig seeks). Call ahead of the move
   * (e.g. while the entry stage runs) so the first move frame never pays for it. The rig is restored afterwards.
   */
  legProfile(from: number, to: number): TravelProfile {
    const key = `${from}|${to}`;
    let p = this.profiles.get(key);
    if (p) return p;
    const cam = this.rig.camera;
    const pos = new Vector3(); const quat = new Quaternion();
    p = buildTravelProfile(from, to, (t) => {
      this.rig.seek(t);
      cam.getWorldPosition(pos); cam.getWorldQuaternion(quat);
      return { p: [pos.x, pos.y, pos.z], q: [quat.x, quat.y, quat.z, quat.w] };
    });
    this.rig.seek(this.lastTime);
    this.profiles.set(key, p);
    return p;
  }

  /** Evaluates the authored clip at exactly `time`, applies the tonal treatment, draws. */
  render(f: NeuralFrame) {
    if (this.disposed) return;
    if (f.vw !== this.w || f.vh !== this.h) {
      this.w = f.vw; this.h = f.vh;
      this.renderer.setSize(f.vw, f.vh, false);
    }
    this.frame(f.vw, f.vh);
    this.syncCity();
    for (const o of this.overrides) this.syncVideo(o.feedIndex);
    const t = this.rig.seek(f.time);
    this.lastTime = t;
    this.treatment.update(t);
    const cam = this.rig.camera;
    this.drawn.clear();
    // The pose override and the pull-back are transient and restored (a mixer never rewrites an unchanged track value,
    // so a persisted offset would stick / accumulate). Projection happens INSIDE the same transform as the draw.
    // Focal-pixel ownership: while the DOM pane has taken over this screen's picture, its mesh is hidden for THIS draw only
    // (restored in `finally`, so a hold / re-entry / release always sees it again); the network around it is unchanged.
    const hidden = f.hideAnchor !== undefined ? this.screenMesh(f.hideAnchor) : null;
    const wasVisible = hidden ? hidden.visible : true;
    if (hidden) hidden.visible = false;
    try {
      this.withWorldPose(f.pose, () => withDolly(cam, f.dolly, DOLLY_DISTANCE, () => {
        if (!this.lost) this.renderer.render(this.scene, cam);
        for (const a of f.project ?? []) { const r = this.projectScreen(a); if (r) this.drawn.set(a, r); }
      }));
    } finally {
      if (hidden) hidden.visible = wasVisible;
    }
  }

  /** Screen rect (CSS px) of `anchor` exactly as drawn by the LAST `render()` (requested via `NeuralFrame.project`). */
  drawnRect(anchor: number): PxRect | null { return this.drawn.get(anchor) ?? null; }

  /**
   * Screen rect of `anchor` under an arbitrary frame's exact camera (authored time + optional pose + dolly) without drawing.
   * The rig is re-seeked to the last drawn time afterwards.
   */
  projectFrame(f: NeuralFrame, anchor: number): PxRect | null {
    if (this.disposed) return null;
    this.frame(f.vw, f.vh);
    this.rig.seek(f.time);
    const cam = this.rig.camera;
    try { return this.withWorldPose(f.pose, () => withDolly(cam, f.dolly, DOLLY_DISTANCE, () => this.projectScreen(anchor))); }
    finally { this.rig.seek(this.lastTime); }
  }

  /** Places the camera at an explicit WORLD pose for the duration of `fn`, then restores the authored local transform. */
  private withWorldPose<T>(pose: CameraPose | undefined, fn: () => T): T {
    if (!pose) return fn();
    const cam = this.rig.camera;
    const sp = cam.position.clone(); const sq = cam.quaternion.clone();
    const wp = new Vector3(pose.p[0], pose.p[1], pose.p[2]);
    const wq = new Quaternion(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    const parent = cam.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const pq = new Quaternion(); parent.getWorldQuaternion(pq);
      cam.position.copy(parent.worldToLocal(wp));
      cam.quaternion.copy(pq.invert().multiply(wq));
    } else { cam.position.copy(wp); cam.quaternion.copy(wq); }
    cam.updateMatrixWorld(true);
    try { return fn(); } finally { cam.position.copy(sp); cam.quaternion.copy(sq); cam.updateMatrixWorld(true); }
  }

  /** The mesh that shows a screen's photograph (and, while bound, the live video). */
  private screenMesh(anchor: number): Mesh | null {
    if (this.screenCache.has(anchor)) return this.screenCache.get(anchor) ?? null;
    const hold = this.holds[anchor];
    let found: Mesh | null = null;
    if (hold) {
      const candidates: (Object3D | undefined)[] = [
        this.root.getObjectByName(`${hold.screen}_image`),
        anchor === this.holds.length - 1 ? this.rig.focalScreen : undefined,
        this.root.getObjectByName(hold.screen),
      ];
      for (const c of candidates) {
        if (!c || found) continue;
        if ((c as Mesh).isMesh) { found = c as Mesh; break; }
        c.traverse((o) => { if (!found && (o as Mesh).isMesh && !Array.isArray((o as Mesh).material) && (o as Mesh).geometry.getAttribute('uv')) found = o as Mesh; });
      }
    }
    this.screenCache.set(anchor, found);
    return found;
  }

  /** Screen rectangle (CSS px) of a screen as seen by the camera of the LAST `render()`. */
  screenRect(anchor: number, vw: number, vh: number): PxRect | null {
    return this.projectScreen(anchor, vw, vh);
  }

  /** Projects the screen with the camera in its CURRENT transform (callers inside a transient pose/dolly get the drawn view). */
  private projectScreen(anchor: number, vw = this.w, vh = this.h): PxRect | null {
    const mesh = this.screenMesh(anchor);
    if (!mesh) return null;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox as Box3;
    const cam = this.rig.camera;
    mesh.updateWorldMatrix(true, false);
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const p = new Vector3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      p.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(cam);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
    return { x: ((x0 + 1) / 2) * vw, y: ((1 - y1) / 2) * vh, w: ((x1 - x0) / 2) * vw, h: ((y1 - y0) / 2) * vh };
  }

  private videoTexture(feedIndex: number): VideoTexture | null {
    const v = this.opts.videos()[feedIndex];
    if (!v) return null;
    let t = this.videoTex.get(feedIndex);
    if (!t) {
      t = new VideoTexture(v);
      t.colorSpace = SRGBColorSpace;
      t.flipY = false; // glTF uv convention: the atlas is not flipped either
      this.videoTex.set(feedIndex, t);
      this.texState.set(feedIndex, { warmed: false, lastTime: -1 });
    }
    return t;
  }

  /**
   * Explicit first-frame upload (see `handoff.ts`): once the video has a decoded frame its texture is flagged and
   * uploaded immediately, and re-flagged whenever `currentTime` moves, instead of waiting for a frame callback.
   */
  private syncVideo(feedIndex: number) {
    const t = this.videoTex.get(feedIndex); const st = this.texState.get(feedIndex);
    const v = this.opts.videos()[feedIndex];
    if (!t || !st) return;
    if (this.lost) return; // no upload possible: isWarm stays false, so the DOM video keeps covering the hold
    const frames = frameCount(v);
    const action = uploadAction(v, st, frames);
    if (action === 'none') return;
    t.needsUpdate = true;
    markUploaded(st, action, v!, frames, action === 'warm' ? uploadNow(this.renderer, t) : true);
  }

  private lost = false;
  private unwatch: (() => void) | null = null;
  /** Un-warm every screen texture (context return / tab return): re-uploaded on the next frame, before promotion. */
  rewarm() { for (const [i, st] of this.texState) { invalidate(st); const t = this.videoTex.get(i); if (t) t.needsUpdate = true; } }

  /** True once the feed's screen texture holds an uploaded frame (the DOM video may then be hidden). */
  isWarm(feedIndex: number): boolean {
    return this.texState.get(feedIndex)?.warmed === true;
  }

  /**
   * Shows the given feeds' live videos on the given authored screens (instead of their authored stills).
   * Only those screens change; geometry is cloned with the photo uv rectangle stretched to the full 0..1 frame.
   */
  bind(stops: readonly { anchor: number; feedIndex: number }[]) {
    this.release();
    for (const stop of stops) {
      const mesh = this.screenMesh(stop.anchor);
      const tex = this.videoTexture(stop.feedIndex);
      if (!mesh || !tex || Array.isArray(mesh.material) || this.overrides.some((o) => o.mesh === mesh)) continue;
      const own = mesh.geometry.clone();
      const uv = own.getAttribute('uv');
      if (uv) {
        let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
        for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
        if (u1 - u0 > 1e-6 && v1 - v0 > 1e-6) {
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0), (uv.getY(i) - v0) / (v1 - v0));
          uv.needsUpdate = true;
        }
      }
      const ownMaterial = new MeshBasicMaterial({
        map: tex, toneMapped: false, side: (mesh.material as Material).side,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      });
      this.overrides.push({ mesh, geometry: mesh.geometry, material: mesh.material, own, ownMaterial, feedIndex: stop.feedIndex });
      mesh.geometry = own; mesh.material = ownMaterial;
      this.syncVideo(stop.feedIndex); // prewarm now, before the screen is first drawn
    }
  }

  /** Puts the authored stills back (and frees the temporary geometry/materials; textures are kept for reuse). */
  release() {
    for (const o of this.overrides) {
      o.mesh.geometry = o.geometry; o.mesh.material = o.material;
      o.own.dispose(); o.ownMaterial.dispose();
    }
    this.overrides = [];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.cityAtlas.dispose(); // authored map back on the clones before they are freed; only our canvas textures are disposed
    this.photo.dispose();
    this.treatment.dispose();
    this.synapse.dispose();
    this.rig.dispose();
    for (const t of this.videoTex.values()) t.dispose(); // GPU texture only; the <video> keeps playing
    this.videoTex.clear(); this.texState.clear();
    this.unwatch?.(); this.unwatch = null;
    disposeObjectTree(this.root);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
