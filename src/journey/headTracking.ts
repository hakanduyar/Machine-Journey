import type { SrcRect } from './geometry';
export type ObjectMarker = 'aircraft-triangle' | 'vehicle-square';
export interface HeadKey { t:number; cx:number; cy:number; size:number; visible:boolean; marker?:ObjectMarker }
export interface ReviewedSpan { start:number; end:number; reviewRef:string }
export type OcclusionPolygon={x:number;y:number}[];
/** Foreground cutout(s) applied to ONE track only. Active for start <= currentTime < end (start inclusive, end exclusive), in source-normalized 0..1 coordinates. */
export interface TimedOcclusion { start:number; end:number; polygons:OcclusionPolygon[] }
export interface HeadTrack { id:string; keyframes:HeadKey[]; reviewedSpans?:ReviewedSpan[]; marker?:ObjectMarker; timedOcclusionPolygons?:TimedOcclusion[] }
export interface HeadTracking { schemaVersion:number; feedId:string; videoSha256:string; annotationSha256:string; sourceWidth:number; sourceHeight:number; duration:number; maxGapSeconds:number; occlusionPolygons?:{x:number;y:number}[][]; tracks:HeadTrack[] }
export function parseHeadTracking(value:unknown):HeadTracking {
 const d=value as HeadTracking;
 if(!d||d.schemaVersion!==1||!d.feedId||![d.videoSha256,d.annotationSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||![d.sourceWidth,d.sourceHeight,d.duration,d.maxGapSeconds].every(n=>Number.isFinite(n)&&n>0)||d.maxGapSeconds>2||!Array.isArray(d.tracks))throw Error('Invalid source-bound head tracks');
 if(d.occlusionPolygons&&(!Array.isArray(d.occlusionPolygons)||d.occlusionPolygons.length>8||d.occlusionPolygons.some(poly=>!Array.isArray(poly)||poly.length<3||poly.length>14||poly.some(p=>![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)))))throw Error('Invalid source occlusion polygon');
 for(const tr of d.tracks)if(tr.marker!==undefined&&!['aircraft-triangle','vehicle-square'].includes(tr.marker))throw Error('Unsupported object marker');
 const ids=new Set<string>();for(const tr of d.tracks){if(!tr.id||ids.has(tr.id)||!tr.keyframes?.length)throw Error('Invalid head track');ids.add(tr.id);
  if(tr.timedOcclusionPolygons!==undefined){const w=tr.timedOcclusionPolygons;if(!Array.isArray(w)||!w.length||w.length>8||w.some(o=>!o||!Number.isFinite(o.start)||!Number.isFinite(o.end)||o.start<0||o.end>d.duration||o.start>=o.end||!Array.isArray(o.polygons)||!o.polygons.length||o.polygons.length>8||o.polygons.some(poly=>!Array.isArray(poly)||poly.length<3||poly.length>14||poly.some(p=>!p||![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)))))throw Error('Invalid timed track occlusion');}
if(tr.reviewedSpans && (!tr.reviewedSpans.length || tr.reviewedSpans.some(r=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>d.duration||r.end<r.start||!r.reviewRef)))throw Error('Invalid reviewed span');let previous=-1;for(const k of tr.keyframes){if(![k.t,k.cx,k.cy,k.size].every(Number.isFinite)||k.t<=previous||k.t<0||k.t>d.duration||k.cx+k.size*d.sourceHeight/d.sourceWidth/2<=0||k.cx-k.size*d.sourceHeight/d.sourceWidth/2>=1||k.cy+k.size/2<=0||k.cy-k.size/2>=1||k.size<=0||k.size>1||typeof k.visible!=='boolean')throw Error('Invalid head key');previous=k.t;}}
 return d;
}
const trackingFiles=import.meta.glob<unknown>(['../../public/media/*/head-tracks.json','../../public/media/*/object-tracks.json'],{eager:true,import:'default'});
const trackingEntries=Object.entries(trackingFiles).map(([path,raw])=>{const d=parseHeadTracking(raw);if(path.split('/').at(-2)!==d.feedId)throw Error('Tracking folder/feed mismatch');if(path.endsWith('/object-tracks.json')&&d.tracks.some(t=>!t.marker))throw Error('Object marker required');return[d.feedId,d] as const;});
if(new Set(trackingEntries.map(([id])=>id)).size!==trackingEntries.length)throw Error('Duplicate feed tracking registry');
export const HEAD_TRACKING:Readonly<Record<string,HeadTracking>>=Object.freeze(Object.fromEntries(trackingEntries));
export const trackingFor=(feedId:string)=>HEAD_TRACKING[feedId];
/** Preserved accepted pilot alias for its dedicated regression fixtures. */
export const PILOT_TRACKING=HEAD_TRACKING.m01;
/** Sample only the actual decoder clock. Never extrapolate, wrap time or bridge missing/occluded annotations. */
export function sampleHeadTracks(data:HeadTracking,time:number):HeadKey[] {return sampleWithIds(data,time).map(s=>s.key);}
/** Author-selected display emphasis only (one human track per feed); not a model classification, identity or threat claim. Source tracking data is never mutated. */
export const HUMAN_HIGHLIGHT_TRACKS:Readonly<Record<string,readonly string[]>>=Object.freeze({m01:['person-01'],m02:['person-01'],'city-butlerville-event-6be3a62539fcd5e7e29c':['person-01']});
export const HUMAN_MARKER_COLORS={neutral:'#f1f0ea',highlight:'#c9b45a'} as const;
const OBJECT_MARKER_COLORS={'aircraft-triangle':'#78d47a','vehicle-square':'#f1f0ea'} as const;
function sampleWithIds(data:HeadTracking,time:number):{key:HeadKey;id:string}[] {
 if(!Number.isFinite(time)||time<0||time>data.duration)return [];
 const result:{key:HeadKey;id:string}[]=[];
 for(const tr of data.tracks){const keys=tr.keyframes;if(time<keys[0].t||time>keys[keys.length-1].t)continue;let a=keys[0],b=a;for(const k of keys){if(k.t<=time)a=k;if(k.t>=time){b=k;break;}}
  const reviewed=tr.reviewedSpans?.some(r=>time>=r.start&&time<=r.end);
  if(tr.reviewedSpans && !reviewed)continue;
  if(!a.visible||!b.visible||(!reviewed && b.t-a.t>data.maxGapSeconds))continue;
  const mix=b.t===a.t?0:(time-a.t)/(b.t-a.t);result.push({id:tr.id,key:{t:time,cx:a.cx+(b.cx-a.cx)*mix,cy:a.cy+(b.cy-a.cy)*mix,size:a.size+(b.size-a.size)*mix,visible:true,...(tr.marker?{marker:tr.marker}:{})}});
 }
 return result;
}
function styledSquares(data:HeadTracking,time:number,crop:SrcRect,width:number,height:number){
 if(width<=0||height<=0||crop.sw<=0||crop.sh<=0)return [];
 const scale=Math.min(width/(crop.sw*data.sourceWidth),height/(crop.sh*data.sourceHeight));
 return sampleWithIds(data,time).map(({key:k,id})=>{const side=k.size*data.sourceHeight*scale,cx=(k.cx-crop.sx)/crop.sw*width,cy=(k.cy-crop.sy)/crop.sh*height;return {id,x:cx-side/2,y:cy-side/2,side,...(k.marker?{marker:k.marker}:{}),highlight:!k.marker&&!!HUMAN_HIGHLIGHT_TRACKS[data.feedId]?.includes(id)};}).filter(r=>r.x+r.side>=0&&r.y+r.side>=0&&r.x<=width&&r.y<=height);
}
export function headSquares(data:HeadTracking,time:number,crop:SrcRect,width:number,height:number){
 return styledSquares(data,time,crop,width,height).map(({highlight:_h,id:_id,...r})=>r);
}
function clipOutPolygon(ctx:CanvasRenderingContext2D,polygon:{x:number;y:number}[],crop:SrcRect,width:number,height:number){ctx.beginPath();ctx.rect(0,0,width,height);polygon.forEach((p,i)=>{const x=(p.x-crop.sx)/crop.sw*width,y=(p.y-crop.sy)/crop.sh*height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();ctx.clip('evenodd');}
/** Reference-derived neutral person square; display geometry only, no classification or inferred identity. */
export function drawHeadTracks(ctx:CanvasRenderingContext2D,data:HeadTracking,time:number,crop:SrcRect,width:number,height:number,strokeScale=1):void {
 ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();for(const polygon of data.occlusionPolygons||[])clipOutPolygon(ctx,polygon,crop,width,height);ctx.strokeStyle='#f1f0ea';ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=1;
 for(const r of styledSquares(data,time,crop,width,height)){
  // Per-track foreground cutouts: clip only this track, then restore on every exit path (incl. the aircraft `continue`).
  let scoped=false;const timed=r.id?data.tracks.find(t=>t.id===r.id)?.timedOcclusionPolygons:undefined;
  if(timed)for(const w of timed)if(time>=w.start&&time<w.end){if(!scoped){ctx.save();scoped=true;}for(const polygon of w.polygons)clipOutPolygon(ctx,polygon,crop,width,height);}
  const corner=r.side*.12;ctx.strokeStyle=r.marker?OBJECT_MARKER_COLORS[r.marker]:r.highlight?HUMAN_MARKER_COLORS.highlight:HUMAN_MARKER_COLORS.neutral;ctx.lineWidth=strokeScale===1?1.4:Math.min(1.4*strokeScale,r.side*.22);ctx.setLineDash([r.side*.04,r.side*.04]);if(r.marker==='aircraft-triangle'){ctx.beginPath();ctx.moveTo(r.x+r.side/2,r.y);ctx.lineTo(r.x+r.side,r.y+r.side);ctx.lineTo(r.x,r.y+r.side);ctx.closePath();ctx.stroke();if(scoped)ctx.restore();continue;}ctx.strokeRect(r.x,r.y,r.side,r.side);ctx.setLineDash([]);ctx.lineWidth=strokeScale===1?2.2:Math.min(2.2*strokeScale,r.side*.3);ctx.beginPath();for(const sx of [0,1])for(const sy of [0,1]){const x=r.x+sx*r.side,y=r.y+sy*r.side;ctx.moveTo(x+(sx?-corner:corner),y);ctx.lineTo(x,y);ctx.lineTo(x,y+(sy?-corner:corner));}ctx.stroke();if(scoped)ctx.restore();}
 ctx.restore();
}
