import {it,expect,vi} from 'vitest';
import fs from 'node:fs';import crypto from 'node:crypto';
import {trackingFor,parseHeadTracking,sampleHeadTracks,headSquares,drawHeadTracks} from '../../src/journey/headTracking';
it('binds compact object markers to exact recordings and preserves actual vehicle entry and exit',()=>{
 for(const id of ['parked-c130','palmdale-dc8','covered-road']){const d=trackingFor(id)!;expect(d.videoSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${id}/loop.mp4`)).digest('hex'));expect(d.tracks).toHaveLength(1);}
 const road=trackingFor('covered-road')!;expect(sampleHeadTracks(road,9.29)).toEqual([]);expect(sampleHeadTracks(road,14.96)).toEqual([]);expect(sampleHeadTracks(road,9.7)).toHaveLength(1);expect(sampleHeadTracks(road,14.5)).toHaveLength(1);expect(sampleHeadTracks(road,12)[0].marker).toBe('vehicle-square');
 const d=trackingFor('parked-c130')!,r=headSquares(d,4,{sx:0,sy:0,sw:1,sh:1},960,540)[0];expect(r.marker).toBe('aircraft-triangle');expect(r.side).toBeLessThan(140);expect(r.side).toBeGreaterThan(40);expect(sampleHeadTracks(d,0)).toEqual(sampleHeadTracks(d,8).map(k=>({...k,t:0})));
 expect(()=>parseHeadTracking({...d,tracks:[{...d.tracks[0],marker:'ship-diamond'}]})).toThrow('Unsupported');
});
it('draws a green hollow upright dashed triangle and a neutral square with corner ticks',()=>{
 const calls:string[]=[],ctx=Object.fromEntries(['save','beginPath','rect','clip','strokeRect','setLineDash','moveTo','lineTo','closePath','stroke','restore'].map(k=>[k,vi.fn(()=>calls.push(k))])) as unknown as CanvasRenderingContext2D;
 drawHeadTracks(ctx,trackingFor('parked-c130')!,4,{sx:0,sy:0,sw:1,sh:1},960,540);
 expect(ctx.strokeStyle).toBe('#78d47a');expect(ctx.closePath).toHaveBeenCalledTimes(1);expect(ctx.strokeRect).not.toHaveBeenCalled();expect(ctx.moveTo).toHaveBeenCalledWith(expect.any(Number),expect.any(Number));
 vi.clearAllMocks();drawHeadTracks(ctx,trackingFor('covered-road')!,12,{sx:0,sy:0,sw:1,sh:1},960,540);
 expect(ctx.strokeStyle).toBe('#f1f0ea');expect(ctx.strokeRect).toHaveBeenCalledTimes(1);expect(ctx.clip).toHaveBeenCalledWith('evenodd');expect(ctx.moveTo).toHaveBeenCalledWith(251,103);expect(ctx.lineTo).toHaveBeenCalledWith(318,115);
 expect(()=>parseHeadTracking({...trackingFor('covered-road')!,occlusionPolygons:[[{x:NaN,y:0},{x:0,y:1},{x:1,y:0}]]})).toThrow('occlusion');
});
it('new event vehicle targets retain exact source bytes, signed centres, nulls and mask',()=>{const suv=trackingFor('city-butlerville-event-7d31316b3ce1c2c82ffc')!,bus=trackingFor('city-butlerville-event-0be6b9181c39c2a7d918')!;for(const d of [suv,bus])expect(crypto.createHash('sha256').update(fs.readFileSync(`public/media/${d.feedId}/loop.mp4`)).digest('hex')).toBe(d.videoSha256);expect(sampleHeadTracks(suv,19)).toEqual([]);expect(sampleHeadTracks(suv,52)[0].cx).toBe(1288/1280);expect(sampleHeadTracks(suv,53.25)).toEqual([]);expect(sampleHeadTracks(bus,12.5)).toEqual([]);expect(sampleHeadTracks(bus,26.25)[0].cx).toBe(1120/1280);expect(sampleHeadTracks(bus,26.5)).toEqual([]);expect(bus.occlusionPolygons?.[0][0]).toEqual({x:1138/1280,y:414/720});});
