import { CanvasTexture, SRGBColorSpace, type WebGLRenderer } from 'three';
import { trackingFor, drawHeadTracks } from './headTracking';
import { frameCount } from './frames';
import { uploadNow } from './glUpload';
interface Surface { strokeScale:number; canvas:HTMLCanvasElement; version:number; visible:boolean; time:number; frames:number|undefined; seeking:boolean; ready:boolean }
const FULL={sx:0,sy:0,sw:1,sh:1};
/** One annotation canvas per existing decoder; no video copies, decoder ownership or React frame state. */
export class HeadTrackingSurfaces {
 private surfaces=new WeakMap<HTMLVideoElement,Surface>();
 constructor(private makeCanvas:()=>HTMLCanvasElement=()=>document.createElement('canvas')){}
 sync(feedId:string,video:HTMLVideoElement|null|undefined,strokeScale?:number):Surface|null {
  const data=trackingFor(feedId);if(!data||!video)return null;
  let s=this.surfaces.get(video);
  if(!s){const canvas=this.makeCanvas();canvas.width=data.sourceWidth;canvas.height=data.sourceHeight;s={strokeScale:1,canvas,version:0,visible:false,time:-1,frames:-1,seeking:false,ready:false};this.surfaces.set(video,s);}
  const scale=strokeScale===undefined?s.strokeScale:Math.max(1,Math.min(3,Math.round(strokeScale*4)/4));
  const ready=video.readyState>=2&&video.videoWidth===data.sourceWidth&&video.videoHeight===data.sourceHeight,frames=frameCount(video);
  if(s.strokeScale===scale&&s.time===video.currentTime&&s.frames===frames&&s.seeking===video.seeking&&s.ready===ready)return s;
  s.strokeScale=scale;s.time=video.currentTime;s.frames=frames;s.seeking=video.seeking;s.ready=ready;s.visible=ready&&!video.seeking;
  const ctx=s.canvas.getContext('2d');if(ctx){ctx.clearRect(0,0,s.canvas.width,s.canvas.height);if(s.visible)drawHeadTracks(ctx,data,s.time,FULL,s.canvas.width,s.canvas.height,s.strokeScale);}else s.visible=false;
  s.version++;return s;
 }
}
/** Per-renderer GPU wrapper over the shared annotation surface. Base VideoTexture stays unchanged. */
export class GLHeadTracking {
 private entries=new Map<string,{surface:Surface;texture:CanvasTexture;version:number;ready:boolean;visible:boolean}>();
 constructor(private renderer:WebGLRenderer,private surfaces:HeadTrackingSurfaces|undefined,private flipY:boolean){}
 sync(feedId:string,video:HTMLVideoElement|null|undefined,strokeScale?:number){
  const surface=this.surfaces?.sync(feedId,video,strokeScale);if(!surface)return null;
  let e=this.entries.get(feedId);if(!e||e.surface!==surface){e?.texture.dispose();const texture=new CanvasTexture(surface.canvas);texture.colorSpace=SRGBColorSpace;texture.flipY=this.flipY;e={surface,texture,version:-1,ready:false,visible:false};this.entries.set(feedId,e);}
  e.visible=surface.visible;
  if(e.version!==surface.version){e.texture.needsUpdate=true;e.version=surface.version;}
  if(!e.ready)e.ready=uploadNow(this.renderer,e.texture);
  return e;
 }
 isWarm(feedId:string){return !this.surfaces||!trackingFor(feedId)||!!this.entries.get(feedId)?.ready;}
 invalidate(){for(const e of this.entries.values()){e.ready=false;e.texture.needsUpdate=true;}}
 dispose(){for(const e of this.entries.values())e.texture.dispose();this.entries.clear();}
}

