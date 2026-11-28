import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PILOT_TRACKING,trackingFor,parseHeadTracking,sampleHeadTracks,headSquares,type HeadTracking} from '../../src/journey/headTracking';
import {computeCrop} from '../../src/journey/geometry';
const fixture=(keys:HeadTracking['tracks'][number]['keyframes']):HeadTracking=>({...PILOT_TRACKING,tracks:[{id:'fixture',keyframes:keys}]});
const k=(t:number,visible=true)=>({t,cx:.5,cy:.4,size:.1,visible});

it('m04 preserves fourteen reviewed tracks without bridging unknown crossings or dissolve',()=>{
 const d=trackingFor('m04')!;expect(d.videoSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync('public/media/m04/loop.mp4')).digest('hex'));expect(d.tracks).toHaveLength(14);expect(d.tracks[0].keyframes).toHaveLength(569);expect(d.tracks[0].timedOcclusionPolygons).toBeUndefined();expect(d.tracks[1].keyframes).toHaveLength(559);
 for(let n=0;n<588;n++){expect(sampleHeadTracks(d,n/24)).toHaveLength(n>568?0:10-(n>=150&&n<=159?1:0)-(n>=399&&n<=417?1:0)-(n>=393&&n<=417?1:0)-(n>=533&&n<=542?1:0)-(n>=333&&n<=355?1:0)-(n>=273&&n<=277?1:0)-(n>=424&&n<=429?1:0)-(n>=77&&n<=85?1:0)+((n>=285&&n<=381)||(n>=390&&n<=568)?1:0)+(n<=272||(n>=376&&n<=551)?1:0)+(n<=176||(n>=248&&n<=364)?1:0)+(n<=161||(n>=220&&n<=339)?1:0));if(n<=568)expect(d.tracks[0].keyframes[n].t).toBe(n/24);}
 for(const n of [149.5,150,159,159.5])expect(sampleHeadTracks({...d,tracks:[d.tracks[1]]},n/24)).toEqual([]);
 expect(d.tracks[1].timedOcclusionPolygons).toEqual([{start:145/24,end:165/24,polygons:[[{x:494/1280,y:115/720},{x:499/1280,y:115/720},{x:499/1280,y:150/720},{x:494/1280,y:150/720}]]}]);
 expect(d.tracks.map(t=>t.keyframes.length)).toEqual([569,559,550,544,569,559,546,564,563,560,276,450,294,284]);
 expect(d.tracks.map(t=>t.id)).toEqual(['person-01','person-02','person-03','person-04','person-05','person-06','person-07','person-08','person-09','person-10','person-11','person-12','person-13','person-14']);
 for(const n of [398.5,399,417,417.5])expect(sampleHeadTracks({...d,tracks:[d.tracks[2]]},n/24)).toEqual([]);
 for(const n of [392.5,393,417,417.5])expect(sampleHeadTracks({...d,tracks:[d.tracks[3]]},n/24)).toEqual([]);
 for(const [index,end] of [[2,440],[3,446]])expect(d.tracks[index].timedOcclusionPolygons).toEqual([{start:361/24,end:end/24,polygons:[[{x:768.5/1280,y:80/720},{x:771/1280,y:80/720},{x:771/1280,y:110/720},{x:768.5/1280,y:110/720}]]}]);
 for(const [index,start,end] of [[5,533,542],[6,333,355],[7,273,277],[8,424,429],[9,77,85]])for(const n of [start-.5,start,end,end+.5])expect(sampleHeadTracks({...d,tracks:[d.tracks[index]]},n/24)).toEqual([]);
 for(const [index,start,end,left,right,top,bottom] of [[5,518,552,494,499,115,150],[6,320,380,768.5,771,80,110],[7,260,290,494,499,195,230],[8,414,442,494,499,140,175],[9,70,96,176,184,280,310]])expect(d.tracks[index].timedOcclusionPolygons).toEqual([{start:start/24,end:end/24,polygons:[[{x:left/1280,y:top/720},{x:right/1280,y:top/720},{x:right/1280,y:bottom/720},{x:left/1280,y:bottom/720}]]}]);
 expect(sampleHeadTracks(d,568.1/24)).toEqual([]);expect(sampleHeadTracks(d,24.5)).toEqual([]);
});
describe('source-bound head tracking pilot',()=>{
 it('binds to exact accepted m01 bytes and keeps anonymous authored person tracks',()=>{const hash=crypto.createHash('sha256').update(fs.readFileSync('public/media/m01/loop.mp4')).digest('hex');expect(hash).toBe(PILOT_TRACKING.videoSha256);expect(PILOT_TRACKING.feedId).toBe('m01');expect(PILOT_TRACKING.tracks).toHaveLength(4);expect(PILOT_TRACKING.tracks.every(t=>/^person-\d+$/.test(t.id))).toBe(true);});
 it('samples decoder time deterministically across pause, seek and wrap without extrapolation',()=>{const d=fixture([k(4),{...k(5),cx:.7},k(6,false)]);expect(sampleHeadTracks(d,4.5)[0].cx).toBeCloseTo(.6);expect(sampleHeadTracks(d,4.5)).toEqual(sampleHeadTracks(d,4.5));expect(sampleHeadTracks(d,25)).toEqual([]);expect(sampleHeadTracks(d,0)).toEqual([]);expect(sampleHeadTracks(d,4)[0].cx).toBe(.5);expect(sampleHeadTracks(d,5.1)).toEqual([]);expect(sampleHeadTracks(d,NaN)).toEqual([]);});
 it('never bridges invisible keys or unannotated long gaps',()=>{expect(sampleHeadTracks(fixture([k(1),k(2,false),k(3)]),1.5)).toEqual([]);expect(sampleHeadTracks(fixture([k(1),k(3)]),2)).toEqual([]);expect(sampleHeadTracks(fixture([k(1,false),k(2)]),1.5)).toEqual([]);});
 it('keeps source head center and true pixel-square through portrait/landscape crop',()=>{const d=fixture([k(0),k(1)]);for(const [w,h]of [[960,536],[390,844],[844,390]]){const crop=computeCrop(w,h,960/536,{z:1,cx:.5,cy:.5});const [r]=headSquares(d,.5,crop,w,h);expect(r.x+r.side/2).toBeCloseTo((.5-crop.sx)/crop.sw*w);expect(r.y+r.side/2).toBeCloseTo((.4-crop.sy)/crop.sh*h);expect(r.side).toBeCloseTo(.1/crop.sh*h);expect(r.side).toBeGreaterThan(0);}});
 it('fails closed for malformed or nonmonotonic source-bound tracks',()=>{expect(()=>parseHeadTracking({...PILOT_TRACKING,videoSha256:'bad'})).toThrow();expect(()=>parseHeadTracking(fixture([k(1),k(1)]))).toThrow();expect(()=>parseHeadTracking(fixture([{...k(1),cx:2}]))).toThrow();});
});

it('registry binds all six annotated feeds to actual bytes and preserves bounded ranges',()=>{for(const id of ['m01','m02','m03','m06','m07','parking-walk']){const d=trackingFor(id)!;expect(d).toBeDefined();expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);expect(d.maxGapSeconds).toBe(1.05);}expect(trackingFor('m03')!.tracks).toHaveLength(1);expect(sampleHeadTracks(trackingFor('m02')!,9)).toEqual([]);expect(sampleHeadTracks(trackingFor('m02')!,12.5).length).toBe(3);expect(sampleHeadTracks(trackingFor('m02')!,53)).toEqual([]);expect(sampleHeadTracks(trackingFor('m06')!,28.8)).toHaveLength(1);});
it('reviewed sparse interpolation is whitelisted and never overrides false endpoints',()=>{const d=fixture([k(0),k(10)]);d.tracks[0].reviewedSpans=[{start:3,end:5,reviewRef:'fixture-reviewed'}];expect(sampleHeadTracks(d,4)).toHaveLength(1);expect(sampleHeadTracks(d,2)).toEqual([]);d.tracks[0].keyframes[1].visible=false;expect(sampleHeadTracks(d,4)).toEqual([]);});
it('measured corrections have the source-frame head center at their exact time',()=>{const a=sampleHeadTracks(trackingFor('m07')!,11.4)[2];expect(a.cx).toBeCloseTo(449/960);expect(a.cy).toBeCloseTo(223/540);const b=sampleHeadTracks(trackingFor('parking-walk')!,37.5)[1];expect(b.cx).toBeCloseTo(945/960);expect(b.cy).toBeCloseTo(141.5/540);});



it('school-hall partial track preserves native clock, corrected heads, and entry/exit abstention',()=>{
 const d=trackingFor('city-butlerville-school-hall')!;
 expect(crypto.createHash('sha256').update(fs.readFileSync('public/media/city-butlerville-school-hall/loop.mp4')).digest('hex')).toBe(d.videoSha256);
 expect(d.annotationSha256).toBe('d251c2cbe92532e62b99a3855d7bc6205445c4f07b3bcffda5746f8b754e0794');
 expect(d.tracks).toHaveLength(1);expect(d.tracks[0].keyframes.filter(k=>k.visible)).toHaveLength(541);
 for(const time of [0,169/24,175/24,717/24,722/24,34.49])expect(sampleHeadTracks(d,time)).toEqual([]);
 const first=sampleHeadTracks(d,176/24)[0];expect(first.cx).toBeCloseTo(603/1280);expect(first.cy).toBeCloseTo(228/720);
 const corrected=sampleHeadTracks(d,704/24)[0];expect(corrected.cx).toBeCloseTo(593/1280);expect(corrected.cy).toBeCloseTo(302/720);
 expect(sampleHeadTracks(d,716/24)[0].cy).toBeCloseTo(304.5/720);
 expect(sampleHeadTracks(d,716.5/24)).toEqual([]);
 const provenance=JSON.parse(fs.readFileSync('public/media/city-butlerville-school-hall/head-tracks.json','utf8')).sourceProvenance;
 expect(provenance.manualCorrectionFrames.map((f:{frame:number})=>f.frame)).toEqual([704,705,706,707,708,709,710,711,712,713,714,715,716]);
 expect(provenance.excludedHeldOutClaims).toEqual([708,712]);
});

it('binds the G340 event partial track to its own bytes and keeps native-time boundaries invisible',()=>{
 const id='city-butlerville-event-6be3a62539fcd5e7e29c',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(1);expect(d.maxGapSeconds).toBe(1.05);
 expect(sampleHeadTracks(d,357/24)).toEqual([]);expect(sampleHeadTracks(d,589/24)).toEqual([]);
 expect(sampleHeadTracks(d,358/24)[0].cy).toBeGreaterThan(1);expect(sampleHeadTracks(d,588/24)[0].cx).toBeLessThan(0);
 expect(sampleHeadTracks(d,0)).toEqual([]);expect(sampleHeadTracks(d,54.49)).toEqual([]);
 const measured=sampleHeadTracks(d,450/24)[0];expect(measured.cx).toBeCloseTo(265/1280);expect(measured.cy).toBeCloseTo(578.5/720);
 expect(sampleHeadTracks(d,19.125)).toHaveLength(1);
});

it('retains signed anatomical centres only when their square overlaps the source viewport',()=>{
 const edge=fixture([{...k(0),cx:-.01,cy:.5}]);expect(parseHeadTracking(edge)).toBe(edge);
 const [r]=headSquares(edge,0,{sx:0,sy:0,sw:1,sh:1},960,536);expect(r.x+r.side/2).toBeCloseTo(-9.6);expect(r.x).toBeLessThan(0);
 expect(()=>parseHeadTracking(fixture([{...k(0),cx:-.2}]))).toThrow();
 expect(()=>parseHeadTracking(fixture([{...k(0),cy:1.2}]))).toThrow();
});

it('G508 reviewed passage keeps signed entry, raw invisible guards and overhead mask',()=>{
 const id='city-butlerville-meva-6ca7fe9c563418d9',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.videoSha256).toBe('0c17c64f6eaa4e76f1b797026fe611259708bcb88dfa4785da56fe85e16b0582');
 expect(sampleHeadTracks(d,11.375)).toEqual([]);
 const entry=sampleHeadTracks(d,274/24)[0];expect(entry.cx).toBeCloseTo(-8/1280);expect(entry.size).toBeCloseTo(30/720);
 expect(sampleHeadTracks(d,13.25)).toHaveLength(1);expect(sampleHeadTracks(d,26.625)).toHaveLength(1);
 expect(sampleHeadTracks(d,640/24)).toEqual([]);expect(sampleHeadTracks(d,0)).toEqual([]);
 expect(d.maxGapSeconds).toBe(.51);expect(d.occlusionPolygons).toHaveLength(1);
 const raw=JSON.parse(fs.readFileSync(`public/media/${id}/head-tracks.json`,'utf8'));
 expect(raw.tracks[0].sourceFrames.filter((k:{visible:boolean})=>!k.visible).every((k:{target:unknown})=>k.target===null)).toBe(true);
});

it('G419 native annotation keeps per-person cutouts and inclusive source end frames',()=>{
 const id='city-butlerville-event-dfdbfd1a0a68b6f25919',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(3);expect(d.occlusionPolygons).toBeUndefined();
 expect(d.tracks[0].timedOcclusionPolygons![0].end).toBeCloseTo(14+1/24);
 expect(d.tracks[0].timedOcclusionPolygons!.at(-1)!.start).toBe(39.5);
 expect(d.tracks.slice(1).every(t=>t.timedOcclusionPolygons!.every(w=>w.start<39))).toBe(true);
 expect(sampleHeadTracks(d,22.75)).toHaveLength(2);expect(sampleHeadTracks(d,39.875)).toHaveLength(1);expect(sampleHeadTracks(d,40)).toEqual([]);
});

it('courtyard passage preserves source half-open masks and head visibility guards',()=>{
 const id='city-butlerville-courtyard',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(2);expect(d.occlusionPolygons).toBeUndefined();
 expect(d.tracks.map(t=>t.timedOcclusionPolygons!.map(w=>[w.start,w.end]))).toEqual([[[7.5,9.5],[24,25.25]],[[10,11],[27.5,31.25]]]);
 expect(sampleHeadTracks(d,0)).toEqual([]);expect(sampleHeadTracks(d,15.25)).toHaveLength(2);
 expect(sampleHeadTracks(d,32)).toEqual([]);
 expect(d.tracks.reduce((n,t)=>n+t.keyframes.filter(k=>k.visible).length,0)).toBe(83);
});

it('cafe head keeps signed entry, opaque post nulls and half-open glass cutouts',()=>{
 const id='city-butlerville-cafe',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(1);expect(d.tracks[0].keyframes.filter(k=>k.visible)).toHaveLength(34);
 expect(sampleHeadTracks(d,28.25)[0].cx).toBeCloseTo(1288/1280);
 expect(sampleHeadTracks(d,34.5)).toEqual([]);expect(sampleHeadTracks(d,35.875)).toHaveLength(1);
 expect(sampleHeadTracks(d,38)).toEqual([]);
 const mask=d.tracks[0].timedOcclusionPolygons![0];expect([mask.start,mask.end]).toEqual([32.75,37.5]);expect(mask.polygons).toHaveLength(4);
 expect(d.occlusionPolygons).toBeUndefined();
});

it('Paris path keeps six reviewed heads, per-person foliage and dissolve policy null',()=>{
 const id='city-paris-path',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(6);expect(d.tracks.reduce((n,t)=>n+t.keyframes.filter(k=>k.visible).length,0)).toBe(75);
 expect(d.tracks[0].timedOcclusionPolygons![0].end).toBe(1);
 expect(d.tracks[4].timedOcclusionPolygons![0].end).toBe(10);
 expect(d.tracks[0].timedOcclusionPolygons![0].polygons[0]).toHaveLength(14);
 for(const i of[1,2,3,5])expect(d.tracks[i].timedOcclusionPolygons).toBeUndefined();
 expect(sampleHeadTracks(d,17)).toHaveLength(1);expect(sampleHeadTracks(d,17.25)).toEqual([]);
 const raw=JSON.parse(fs.readFileSync(`public/media/${id}/head-tracks.json`,'utf8'));
 const guard=raw.tracks[5].sourceFrames.find((k:{reason:string})=>k.reason==='LOOP_DISSOLVE_UNCERTAINTY');
 expect(guard.sourceFrameSha256).toBeNull();expect(guard.evidenceKind).toBe('POLICY_CUTOFF_NOT_NATIVE_MEASUREMENT');
});

it('Istanbul selected foreground heads retain cart occlusion and edit-policy nulls',()=>{
 const id='city-istanbul-street',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(6);expect(d.tracks.reduce((n,t)=>n+t.keyframes.filter(k=>k.visible).length,0)).toBe(71);
 expect(d.tracks.filter(t=>!t.timedOcclusionPolygons)).toHaveLength(5);
 const bald=d.tracks.find(t=>t.id==='walker-bald-black')!;
 expect(bald.timedOcclusionPolygons!.map(w=>[w.start,w.end])).toEqual([[0,1],[1,1.25],[2.75,3]]);
 expect(sampleHeadTracks({...d,tracks:[bald]},1.5)).toEqual([]);
 expect(sampleHeadTracks(d,10.875)).toEqual([]);
 const raw=JSON.parse(fs.readFileSync(`public/media/${id}/head-tracks.json`,'utf8'));
 const guards=raw.tracks.flatMap((t:{sourceFrames:{reason:string;sourceFrameSha256:unknown;evidenceKind:string}[]})=>t.sourceFrames).filter((k:{reason:string})=>k.reason==='FINAL_LOOP_DISSOLVE');
 expect(guards.length).toBeGreaterThan(0);expect(guards.every((k:{sourceFrameSha256:unknown;evidenceKind:string})=>k.sourceFrameSha256===null&&k.evidenceKind==='POLICY_CUTOFF_NOT_NATIVE_MEASUREMENT')).toBe(true);
});

it('G423 reviewed March passage keeps overlap null and person-specific half-open masks',()=>{
 const id='city-butlerville-event-aa4fd544b8e12da53881',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(2);expect(d.tracks.reduce((n,t)=>n+t.keyframes.filter(k=>k.visible).length,0)).toBe(79);
 const light=d.tracks.find(t=>t.id==='person-light')!,dark=d.tracks.find(t=>t.id==='person-dark')!;
 expect(light.timedOcclusionPolygons!.map(w=>[w.start,w.end])).toEqual([[13.125,13.375],[13.625,13.875],[29.125,29.375]]);
 expect(dark.timedOcclusionPolygons!.map(w=>[w.start,w.end])).toEqual([[19.75,20.25]]);
 expect(sampleHeadTracks({...d,tracks:[light]},13.5)).toEqual([]);
 expect(sampleHeadTracks(d,15)).toHaveLength(2);expect(sampleHeadTracks(d,30)).toEqual([]);
 expect(d.occlusionPolygons).toBeUndefined();
});

describe('occlusion polygon vertex bound is exactly 3..14',()=>{
 const ring=(n:number)=>Array.from({length:n},(_,i)=>({x:.5+.3*Math.cos(2*Math.PI*i/n),y:.5+.3*Math.sin(2*Math.PI*i/n)}));
 const global=(n:number):HeadTracking=>({...fixture([k(1),k(2)]),occlusionPolygons:[ring(n)]});
 const timed=(n:number):HeadTracking=>{const d=fixture([k(1),k(2)]);d.tracks[0].timedOcclusionPolygons=[{start:1,end:2,polygons:[ring(n)]}];return d;};
 it('global polygons accept 14 vertices and reject 15, keeping the minimum of 3',()=>{
  expect(parseHeadTracking(global(14)).occlusionPolygons![0]).toHaveLength(14);
  expect(()=>parseHeadTracking(global(15))).toThrow();
  expect(parseHeadTracking(global(3))).toBeDefined();expect(()=>parseHeadTracking(global(2))).toThrow();
 });
 it('timed per-track polygons accept 14 vertices and reject 15, keeping the minimum of 3',()=>{
  expect(parseHeadTracking(timed(14)).tracks[0].timedOcclusionPolygons![0].polygons[0]).toHaveLength(14);
  expect(()=>parseHeadTracking(timed(15))).toThrow();
  expect(parseHeadTracking(timed(3))).toBeDefined();expect(()=>parseHeadTracking(timed(2))).toThrow();
 });
 it('still rejects out-of-range vertices at 14 points in both forms',()=>{
  const g=global(14);g.occlusionPolygons![0][13]={x:1.01,y:.5};expect(()=>parseHeadTracking(g)).toThrow();
  const t=timed(14);t.tracks[0].timedOcclusionPolygons![0].polygons[0][13]={x:.5,y:-.01};expect(()=>parseHeadTracking(t)).toThrow();
 });
 it('allows mixed masked and unmasked tracks when the optional field is omitted, but not an empty array',()=>{
  const d=timed(14);d.tracks.push({id:'unmasked',keyframes:[k(1),k(2)]});
  expect(parseHeadTracking(d).tracks[1].timedOcclusionPolygons).toBeUndefined();
  d.tracks[1].timedOcclusionPolygons=[];expect(()=>parseHeadTracking(d)).toThrow();
 });
});

it('G340 roadside SUV stays source-bound through signed edges and stops after the windscreen exits',()=>{
 const id='city-butlerville-roadside',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(1);expect(d.tracks[0].marker).toBe('vehicle-square');
 expect(sampleHeadTracks(d,4.25)).toEqual([]);expect(sampleHeadTracks(d,4.375)[0].cx).toBeLessThan(0);
 expect(sampleHeadTracks(d,9.125)[0].cx).toBeGreaterThan(1);expect(sampleHeadTracks(d,9.166666666666666)).toEqual([]);
 expect(sampleHeadTracks(d,6)[0].size*d.sourceHeight).toBe(44);
 expect(trackingFor('city-butlerville-event-6be3a62539fcd5e7e29c')!.tracks.every(t=>!t.marker)).toBe(true);
});

it('NYC cab uses its exact source and signal cutout while excluding the final edit dissolve',()=>{
 const id='city-new-york-4272',d=trackingFor(id)!;
 expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);
 expect(d.tracks).toHaveLength(1);expect(d.tracks[0].marker).toBe('vehicle-square');expect(d.occlusionPolygons).toHaveLength(1);expect(d.occlusionPolygons![0]).toHaveLength(14);
 expect(sampleHeadTracks(d,0)).toHaveLength(1);expect(sampleHeadTracks(d,8)).toHaveLength(1);expect(sampleHeadTracks(d,11)).toEqual([]);expect(sampleHeadTracks(d,11.4)).toEqual([]);
 const raw=JSON.parse(fs.readFileSync(`public/media/${id}/object-tracks.json`,'utf8'));expect(raw.sourceProvenance.policyCutoff.evidenceKind).toBe('POLICY_CUTOFF_NOT_NATIVE_MEASUREMENT');
});
it('G419 March09 keeps source-bound reviewed head interval and unknown boundary',()=>{
 const id='city-butlerville-event-88f4d0809693f54eeb25',d=trackingFor(id)!;
 expect(d.videoSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex'));
 expect(d.tracks).toHaveLength(1);expect(d.tracks[0].timedOcclusionPolygons).toHaveLength(4);
 for(let n=0;n<312;n++)expect(sampleHeadTracks(d,n/24)).toHaveLength(n>=8&&n<=200?1:0);
 for(const n of [200.01,200.5,201,244])expect(sampleHeadTracks(d,n/24)).toEqual([]);
 expect(d.tracks[0].keyframes.find(key=>key.t===201/24)).toMatchObject({t:201/24,visible:false});
 expect(d.tracks[0].timedOcclusionPolygons!.at(-1)!.end).toBe(201/24);
});

it('m04 final four tracks preserve unknown boundaries and reviewed foreground timing',()=>{
 const d=trackingFor('m04')!;
 expect(d.tracks.slice(10).map(t=>t.keyframes.filter(k=>k.visible).length)).toEqual([276,449,294,282]);
 for(const [index,frames] of [[10,[0,282,284.99,381.01,389.99,568.01]],[11,[272.01,273,375.99,551.01,552,568]],[12,[176.01,177,247.99,364.01,365,568]],[13,[161.01,162,219.99,339.01,340,568]]] as const)for(const n of frames)expect(sampleHeadTracks({...d,tracks:[d.tracks[index]]},n/24)).toEqual([]);
 expect(d.tracks[11].keyframes.find(k=>k.t===552/24)?.visible).toBe(false);
 for(const n of [162,340])expect(d.tracks[13].keyframes.find(k=>k.t===n/24)?.visible).toBe(false);
 expect(d.tracks.slice(10).map(t=>t.timedOcclusionPolygons!.map(w=>[w.start*24,w.end*24]))).toEqual([[[374,398]],[[544,552]],[[156,177],[248,260]],[[144,225],[328,340]]]);
 const column=[{x:1177/1280,y:20/720},{x:1204/1280,y:20/720},{x:1204/1280,y:52/720},{x:1173/1280,y:52/720},{x:1174/1280,y:40/720},{x:1176/1280,y:30/720}];
 for(const w of d.tracks[12].timedOcclusionPolygons!)expect(w.polygons).toEqual([column]);
});

it('G420 March13 preserves three reviewed people and unknown entry/exit intervals',()=>{
 const id='city-butlerville-event-7d22021afd528fd44780',d=trackingFor(id)!;
 expect(d.videoSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex'));
 expect(d.tracks.map(t=>t.id)).toEqual(['person-01','person-02','person-03']);
 expect(d.tracks.map(t=>t.keyframes.length)).toEqual([296,51,198]);
 expect((JSON.parse(fs.readFileSync('public/media/'+id+'/head-tracks.json','utf8')).tracks as {sourceTrackIndex:number}[]).map(t=>t.sourceTrackIndex)).toEqual([0,1,2]);
 const intervals=[[196,490],[260,452],[330,526]];
 for(let n=0;n<816;n++)expect(sampleHeadTracks(d,n/24)).toHaveLength(intervals.filter(([a,b])=>n>=a&&n<=b).length);
 for(let i=0;i<3;i++){const one={...d,tracks:[d.tracks[i]]},[a,b]=intervals[i];for(const n of [a-.01,b+.01,b+1])expect(sampleHeadTracks(one,n/24)).toEqual([]);expect(sampleHeadTracks(one,b/24)).toHaveLength(1);}
 expect(d.tracks.map(t=>t.timedOcclusionPolygons!.map(w=>[w.start*24,w.end*24]))).toEqual([[[196,220],[400,491]],[[444,453]],[[330,342],[516,527]]]);
});
