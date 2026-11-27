import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PILOT_TRACKING,trackingFor,parseHeadTracking,sampleHeadTracks,headSquares,type HeadTracking} from '../../src/journey/headTracking';
import {computeCrop} from '../../src/journey/geometry';
const fixture=(keys:HeadTracking['tracks'][number]['keyframes']):HeadTracking=>({...PILOT_TRACKING,tracks:[{id:'fixture',keyframes:keys}]});
const k=(t:number,visible=true)=>({t,cx:.5,cy:.4,size:.1,visible});
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
