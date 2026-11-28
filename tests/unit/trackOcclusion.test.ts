import {it,expect} from 'vitest';
import {drawHeadTracks,parseHeadTracking,type HeadTracking} from '../../src/journey/headTracking';
// @ts-expect-error The existing Node importer is JavaScript without declarations.
import {convertHeads} from '../../scripts/import-head-tracks.mjs';
const FULL={sx:0,sy:0,sw:1,sh:1};
const still=(cx:number)=>[0,1,2].map(t=>({t,cx,cy:.5,size:.2,visible:true}));
const poly=[{x:.1,y:.1},{x:.4,y:.1},{x:.4,y:.4}];
const make=(tracks:HeadTracking['tracks'],extra:Partial<HeadTracking>={}):HeadTracking=>({schemaVersion:1,feedId:'t-occ',videoSha256:'a'.repeat(64),annotationSha256:'b'.repeat(64),sourceWidth:100,sourceHeight:100,duration:2,maxGapSeconds:1,tracks,...extra});
/** Logs, per drawn shape, how many clips beyond the base clip were active at stroke time; also tracks save/restore balance. */
function rec(){let depth=0;const stack:number[]=[];let clips=0;const drawn:{id:string;clips:number}[]=[];let n=0;const order=['a','b','c','d'];
 const ctx={save(){stack.push(clips);depth++;},restore(){clips=stack.pop()!;depth--;},beginPath(){},rect(){},moveTo(){},lineTo(){},closePath(){},clip(){clips++;},setLineDash(){},stroke(){},
  strokeRect(){drawn.push({id:order[n++],clips});},strokeStyle:'',shadowColor:'',shadowBlur:0,lineWidth:0} as unknown as CanvasRenderingContext2D;
 return {ctx,drawn,get depth(){return depth;}};}
const three=(win:{start:number;end:number}=({start:.5,end:1.5}))=>make([
 {id:'far',keyframes:still(.2)},
 {id:'landing',keyframes:still(.5),timedOcclusionPolygons:[{...win,polygons:[poly]}]},
 {id:'near',keyframes:still(.8)}]);
const base=2; // outer rect clip counts as 1 -> baseline clips for unmasked shapes
it('converter preserves reviewed P07 mask with cropped-source mapping and isolated timing',()=>{
 const polygon=[{x:494/1280,y:115/720},{x:499/1280,y:115/720},{x:499/1280,y:150/720},{x:494/1280,y:150/720}],videoSha256='a'.repeat(64);
 const keys=[144,145,149,160,161,162,163].map(n=>({t:n/24,x:.38,y:.18,w:7/1280,h:8/720,visible:true}));
 const d=convertHeads({feedId:'m04',width:1280,height:720,videoSha256,annotationSha256:'c'.repeat(64)},{duration:24.5,foregroundOcclusionReview:{sourceVideoSha256:videoSha256,sourceWidth:1280,sourceHeight:720,coordinateSpace:'source-normalized',timeUnit:'seconds',reviewRef:'R161-P07',evidenceSha256:'b'.repeat(64),reviewedInterval:{start:0,end:24.5}},tracks:[{entityKind:'person',keyframes:keys,timedOcclusionPolygons:[{start:145/24,end:162/24,polygons:[polygon]}]},{entityKind:'person',keyframes:keys}]});
 parseHeadTracking(d);const crop={sx:.25,sy:.1,sw:.5,sh:.5};
 for(const [time,clips] of [[144/24,1],[145/24,2],[161/24,2],[162/24,1]]){const r=rec(),points:number[][]=[];r.ctx.moveTo=(x,y)=>{points.push([x,y]);};drawHeadTracks(r.ctx,d,time,crop,640,360);expect(r.drawn.map(x=>x.clips)).toEqual([clips,1]);expect(r.depth).toBe(0);if(clips===2){expect(points[0][0]).toBeCloseTo(174);expect(points[0][1]).toBeCloseTo(43);}}
});
it('clips only the landing track while active; nearer/other heads unaffected',()=>{
 const r=rec();drawHeadTracks(r.ctx,three(),1,FULL,100,100);
 expect(r.drawn.map(d=>d.clips)).toEqual([1,1+1,1]);expect(r.depth).toBe(0);void base;
});
it('active window is start-inclusive, end-exclusive',()=>{
 const at=(t:number)=>{const r=rec();drawHeadTracks(r.ctx,three(),t,FULL,100,100);return r.drawn[1].clips;};
 expect(at(.49)).toBe(1);expect(at(.5)).toBe(2);expect(at(1.49)).toBe(2);expect(at(1.5)).toBe(1);
});
it('restores per-track state on the aircraft continue branch',()=>{
 const d=make([{id:'plane',marker:'aircraft-triangle',keyframes:still(.5),timedOcclusionPolygons:[{start:0,end:2,polygons:[poly]}]},{id:'p',keyframes:still(.8)}]);
 const r=rec();drawHeadTracks(r.ctx,d,1,FULL,100,100);expect(r.depth).toBe(0);expect(r.drawn[0].clips).toBe(1);
});
it('legacy global occlusionPolygons still clip every track and are unchanged',()=>{
 const r=rec();drawHeadTracks(r.ctx,make([{id:'a',keyframes:still(.3)},{id:'b',keyframes:still(.7)}],{occlusionPolygons:[poly]}),1,FULL,100,100);
 expect(r.drawn.map(d=>d.clips)).toEqual([2,2]);expect(r.depth).toBe(0);
});
it('rejects malformed timed occlusions',()=>{
 const bad=(o:unknown)=>()=>parseHeadTracking(make([{id:'x',keyframes:still(.5),timedOcclusionPolygons:o as never}]));
 const ok={start:0,end:1,polygons:[poly]};
 expect(bad([ok])).not.toThrow();
 for(const o of [[],{},[{...ok,start:1,end:.5}],[{...ok,start:1,end:1}],[{...ok,start:-1}],[{...ok,end:3}],[{...ok,start:NaN}],[{...ok,end:Infinity}],[{...ok,polygons:[]}],[{...ok,polygons:[poly.slice(0,2)]}],[{...ok,polygons:[[...poly.slice(0,2),{x:2,y:0}]]}],[{...ok,polygons:[[...poly.slice(0,2),{x:NaN,y:0}]]}],[null]])
  expect(bad(o),JSON.stringify(o)).toThrow('Invalid timed track occlusion');
});
