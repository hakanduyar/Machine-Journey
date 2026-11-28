import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function validPolygon(poly){
 if(!Array.isArray(poly)||poly.length<3||poly.length>14||poly.some(p=>!exact(p,['x','y'])||![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)))return false;
 if(new Set(poly.map(p=>`${p.x},${p.y}`)).size!==poly.length)return false;
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const on=(a,b,c)=>cross(a,b,c)===0&&c.x>=Math.min(a.x,b.x)&&c.x<=Math.max(a.x,b.x)&&c.y>=Math.min(a.y,b.y)&&c.y<=Math.max(a.y,b.y);
 const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
 let area=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];area+=a.x*b.y-b.x*a.y;for(let j=i+1;j<poly.length;j++){if(j===i+1||i===0&&j===poly.length-1)continue;if(intersects(a,b,poly[j],poly[(j+1)%poly.length]))return false;}}
 return Math.abs(area)>Number.EPSILON;
}
function reviewedMasks(p,authored){
 if(Object.hasOwn(authored,'occlusionPolygons')||Object.hasOwn(authored,'timedOcclusionPolygons')||authored.tracks.some(t=>Object.hasOwn(t,'occlusionPolygons')))throw Error('unsupported authored mask form');
 const masked=authored.tracks.filter(t=>Object.hasOwn(t,'timedOcclusionPolygons'));
 if(!masked.length){if(Object.hasOwn(authored,'foregroundOcclusionReview'))throw Error('occlusion review without masks');return undefined;}
 const r=authored.foregroundOcclusionReview;
 if(!exact(r,['sourceVideoSha256','coordinateSpace','timeUnit','sourceWidth','sourceHeight','reviewRef','evidenceSha256','reviewedInterval'])||!sha(r.sourceVideoSha256)||r.sourceVideoSha256!==p.videoSha256||!sha(r.evidenceSha256)||typeof r.reviewRef!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(r.reviewRef)||r.coordinateSpace!=='source-normalized'||r.timeUnit!=='seconds'||r.sourceWidth!==p.width||r.sourceHeight!==p.height||!exact(r.reviewedInterval,['start','end']))throw Error('source-bound foreground occlusion review required');
 const interval=r.reviewedInterval;if(![interval.start,interval.end].every(Number.isFinite)||interval.start<0||interval.end>authored.duration||interval.start>=interval.end)throw Error('invalid occlusion review interval');
 // Validate source tracks before filtering; never attach a mask by the renumbered output ID.
 for(const t of masked){const windows=t.timedOcclusionPolygons,keys=t.keyframes;
  if(t.entityKind!=='person'||!Array.isArray(keys)||!keys.length||!keys.every(k=>Number.isFinite(k.t))||!Array.isArray(windows)||!windows.length||windows.length>8)throw Error('invalid timed foreground mask');
  const first=Math.min(...keys.map(k=>k.t)),last=Math.max(...keys.map(k=>k.t));let previousEnd=-1;
  for(const w of windows){if(!exact(w,['start','end','polygons'])||![w.start,w.end].every(Number.isFinite)||w.start<interval.start||w.end>interval.end||w.start<first||w.end>last||w.start>=w.end||w.start<previousEnd||!Array.isArray(w.polygons)||!w.polygons.length||w.polygons.length>8||!w.polygons.every(validPolygon))throw Error('invalid timed foreground mask');
   if(p.trackPolicy?.[t.id]?.status==='INCLUDE'){const spans=p.trackPolicy[t.id].spans;if(!Array.isArray(spans)||!spans.length||w.start<Math.min(...spans.map(s=>s.start))||w.end>Math.max(...spans.map(s=>s.end)))throw Error('mask outside reviewed track interval');}previousEnd=w.end;
  }
 }
 return structuredClone(r);
}
/** Offline conversion only: no detector, network, interpolation, identity inference or visibility invention. */
export function convertHeads(p, authored) {
 if(!/^[a-z0-9-]+$/.test(p.feedId)||![p.width,p.height,authored.duration].every(n=>Number.isFinite(n)&&n>0)||!Array.isArray(authored.tracks))throw Error('invalid source geometry');
 const foregroundReview=reviewedMasks(p,authored);
 const corrections=p.measuredCorrections||[];
 if(corrections.length){
  if(!/^[a-f0-9]{64}$/.test(p.correctionEvidenceSha256)||!p.correctionReviewRef)throw Error('correction evidence required');
  authored=structuredClone(authored);
  for(const c of corrections){const track=authored.tracks[c.sourceTrackIndex];if(!track||track.entityKind!=='person'||!Number.isFinite(c.t)||c.t<0||c.t>authored.duration||!c.frameSha256||!Number.isFinite(c.cx)||!Number.isFinite(c.cy)||!Number.isFinite(c.w)||!Number.isFinite(c.h))throw Error('invalid measured correction');
   const k={t:c.t,x:c.cx-c.w/2,y:c.cy-c.h/2,w:c.w,h:c.h,visible:true};const i=track.keyframes.findIndex(k=>k.t===c.t);if(i>=0){if(track.keyframes[i].visible===false)throw Error('cannot override authored invisibility');track.keyframes[i]=k;}else track.keyframes.push(k);track.keyframes.sort((a,b)=>a.t-b.t);
  }
 }
 const selected=authored.tracks.map((track,index)=>({track,index}));
 if(p.entityPolicy!=='person-only' && selected.some(({track})=>track.entityKind!=='person'))throw Error('human head annotations required');
 if(p.trackPolicy && (!p.policyReviewRef || Object.keys(p.trackPolicy).some(id=>!authored.tracks.some(t=>t.id===id))))throw Error('explicit track policy review required');
 const included=selected.filter(({track})=>track.entityKind==='person' && (!p.trackPolicy || p.trackPolicy[track.id]?.status==='INCLUDE'));
 if(!included.length)throw Error('no admitted human tracks');
 const tracks=included.map(({track,index},i)=>({id:`person-${String(i+1).padStart(2,'0')}`,...(p.trackPolicy?{sourceTrackIndex:index,reviewedSpans:p.trackPolicy[track.id].spans}:{}),keyframes:track.keyframes.map(k=>({t:k.t,cx:k.x+k.w/2,cy:k.y+k.h/2,size:Math.max(k.w*p.width,k.h*p.height)*1.36*.94/p.height,visible:k.visible}))}));
 for(let i=0;i<included.length;i++)if(included[i].track.timedOcclusionPolygons!==undefined)tracks[i].timedOcclusionPolygons=structuredClone(included[i].track.timedOcclusionPolygons);
 for(const tr of tracks){if(p.trackPolicy && (!Array.isArray(tr.reviewedSpans)||!tr.reviewedSpans.length||tr.reviewedSpans.some(r=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>authored.duration||r.end<r.start||!r.reviewRef)))throw Error('reviewed interpolation spans required');let last=-1;for(const k of tr.keyframes){if(![k.t,k.cx,k.cy,k.size].every(Number.isFinite)||k.t<0||k.t>authored.duration||k.t<=last||k.cx+k.size*p.height/p.width/2<=0||k.cx-k.size*p.height/p.width/2>=1||k.cy+k.size/2<=0||k.cy-k.size/2>=1||k.size<=0||k.size>1||typeof k.visible!=='boolean')throw Error('invalid authored head key');last=k.t;}}
 return {...(foregroundReview&&tracks.some(t=>t.timedOcclusionPolygons)?{foregroundOcclusionReview:foregroundReview}:{}),...(corrections.length?{derivedCorrections:{evidenceSha256:p.correctionEvidenceSha256,reviewRef:p.correctionReviewRef,measurement:'Manual source-frame head bounds; approximately 2–3 pixels uncertainty.',keys:corrections}}:{}),...(p.trackPolicy?{policyReviewRef:p.policyReviewRef,coverage:'Only independently supported tracks and time ranges; not complete person coverage.',excludedTracks:selected.filter(({track})=>!included.some(x=>x.track===track)).map(({track,index})=>({sourceTrackIndex:index,entityKind:track.entityKind,reason:track.entityKind!=='person'?'Object track excluded from head renderer':p.trackPolicy[track.id]?.reason||'HOLD: no reviewed interpolation range'}))}:{}),schemaVersion:1,feedId:p.feedId,videoSha256:p.videoSha256,annotationSha256:p.annotationSha256,sourceMediaUrl:p.sourceMediaUrl,method:'Existing authored head keyframes; visibility preserved. No automated detection or real-world identity classification.',geometryReference:'Existing Machine neutral person reticle: off-white dashed square and corner ticks;1.36scale and0.94extent.',sourceWidth:p.width,sourceHeight:p.height,duration:authored.duration,maxGapSeconds:1.05,reviewScope:authored.reviewR31?.scope||'Authored tracks require independent alignment review',tracks};
}
export async function importHeads(packetFile,outFile){const p=JSON.parse(await fs.readFile(packetFile,'utf8'));for(const [file,want]of [[p.videoFile,p.videoSha256],[p.annotationFile,p.annotationSha256]])if(!/^[a-f0-9]{64}$/.test(want)||digest(await fs.readFile(file))!==want)throw Error('source bytes do not match binding');const u=new URL(p.sourceMediaUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error('public source URL required');const out=JSON.stringify(convertHeads(p,JSON.parse(await fs.readFile(p.annotationFile,'utf8'))),null,2)+'\n';try{if(await fs.readFile(outFile,'utf8')===out)return {written:0};throw Error('existing tracking differs; explicit reviewed replacement required');}catch(e){if(e.code!=='ENOENT')throw e;}await fs.writeFile(outFile,out,{flag:'wx'});return {written:1};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))importHeads(...process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
