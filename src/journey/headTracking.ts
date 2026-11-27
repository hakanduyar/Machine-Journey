import type { SrcRect } from './geometry';
export interface HeadKey { t:number; cx:number; cy:number; size:number; visible:boolean }
export interface ReviewedSpan { start:number; end:number; reviewRef:string }
export interface HeadTrack { id:string; keyframes:HeadKey[]; reviewedSpans?:ReviewedSpan[] }
export interface HeadTracking { schemaVersion:number; feedId:string; videoSha256:string; annotationSha256:string; sourceWidth:number; sourceHeight:number; duration:number; maxGapSeconds:number; tracks:HeadTrack[] }
export function parseHeadTracking(value:unknown):HeadTracking {
 const d=value as HeadTracking;
 if(!d||d.schemaVersion!==1||!d.feedId||![d.videoSha256,d.annotationSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||![d.sourceWidth,d.sourceHeight,d.duration,d.maxGapSeconds].every(n=>Number.isFinite(n)&&n>0)||d.maxGapSeconds>2||!Array.isArray(d.tracks))throw Error('Invalid source-bound head tracks');
 const ids=new Set<string>();for(const tr of d.tracks){if(!tr.id||ids.has(tr.id)||!tr.keyframes?.length)throw Error('Invalid head track');ids.add(tr.id);if(tr.reviewedSpans && (!tr.reviewedSpans.length || tr.reviewedSpans.some(r=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>d.duration||r.end<r.start||!r.reviewRef)))throw Error('Invalid reviewed span');let previous=-1;for(const k of tr.keyframes){if(![k.t,k.cx,k.cy,k.size].every(Number.isFinite)||k.t<=previous||k.t<0||k.t>d.duration||k.cx<0||k.cx>1||k.cy<0||k.cy>1||k.size<=0||k.size>1||typeof k.visible!=='boolean')throw Error('Invalid head key');previous=k.t;}}
 return d;
}
const trackingFiles=import.meta.glob<unknown>('../../public/media/*/head-tracks.json',{eager:true,import:'default'});
export const HEAD_TRACKING:Readonly<Record<string,HeadTracking>>=Object.freeze(Object.fromEntries(Object.entries(trackingFiles).map(([path,raw])=>{const d=parseHeadTracking(raw);if(path.split('/').at(-2)!==d.feedId)throw Error('Tracking folder/feed mismatch');return[d.feedId,d];})));
export const trackingFor=(feedId:string)=>HEAD_TRACKING[feedId];
/** Preserved accepted pilot alias for its dedicated regression fixtures. */
export const PILOT_TRACKING=HEAD_TRACKING.m01;
/** Sample only the actual decoder clock. Never extrapolate, wrap time or bridge missing/occluded annotations. */
export function sampleHeadTracks(data:HeadTracking,time:number):HeadKey[] {
 if(!Number.isFinite(time)||time<0||time>data.duration)return [];
 const result:HeadKey[]=[];
 for(const tr of data.tracks){const keys=tr.keyframes;if(time<keys[0].t||time>keys[keys.length-1].t)continue;let a=keys[0],b=a;for(const k of keys){if(k.t<=time)a=k;if(k.t>=time){b=k;break;}}
  const reviewed=tr.reviewedSpans?.some(r=>time>=r.start&&time<=r.end);
  if(tr.reviewedSpans && !reviewed)continue;
  if(!a.visible||!b.visible||(!reviewed && b.t-a.t>data.maxGapSeconds))continue;
  const mix=b.t===a.t?0:(time-a.t)/(b.t-a.t);result.push({t:time,cx:a.cx+(b.cx-a.cx)*mix,cy:a.cy+(b.cy-a.cy)*mix,size:a.size+(b.size-a.size)*mix,visible:true});
 }
 return result;
}
export function headSquares(data:HeadTracking,time:number,crop:SrcRect,width:number,height:number){
 if(width<=0||height<=0||crop.sw<=0||crop.sh<=0)return [];
 const scale=Math.min(width/(crop.sw*data.sourceWidth),height/(crop.sh*data.sourceHeight));
 return sampleHeadTracks(data,time).map(k=>{const side=k.size*data.sourceHeight*scale,cx=(k.cx-crop.sx)/crop.sw*width,cy=(k.cy-crop.sy)/crop.sh*height;return {x:cx-side/2,y:cy-side/2,side};}).filter(r=>r.x+r.side>=0&&r.y+r.side>=0&&r.x<=width&&r.y<=height);
}
/** Reference-derived neutral person square; display geometry only, no classification or inferred identity. */
export function drawHeadTracks(ctx:CanvasRenderingContext2D,data:HeadTracking,time:number,crop:SrcRect,width:number,height:number,strokeScale=1):void {
 ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.strokeStyle='#f1f0ea';ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=1;
 for(const r of headSquares(data,time,crop,width,height)){const corner=r.side*.12;ctx.lineWidth=strokeScale===1?1.4:Math.min(1.4*strokeScale,r.side*.22);ctx.setLineDash([r.side*.04,r.side*.04]);ctx.strokeRect(r.x,r.y,r.side,r.side);ctx.setLineDash([]);ctx.lineWidth=strokeScale===1?2.2:Math.min(2.2*strokeScale,r.side*.3);ctx.beginPath();for(const sx of [0,1])for(const sy of [0,1]){const x=r.x+sx*r.side,y=r.y+sy*r.side;ctx.moveTo(x+(sx?-corner:corner),y);ctx.lineTo(x,y);ctx.lineTo(x,y+(sy?-corner:corner));}ctx.stroke();}
 ctx.restore();
}
