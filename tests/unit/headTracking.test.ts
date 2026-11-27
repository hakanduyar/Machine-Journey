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
