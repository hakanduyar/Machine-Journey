import {it,expect,vi} from 'vitest';
import {drawHeadTracks,headSquares,sampleHeadTracks,trackingFor,HUMAN_HIGHLIGHT_TRACKS,HUMAN_MARKER_COLORS,type HeadTracking} from '../../src/journey/headTracking';
const FULL={sx:0,sy:0,sw:1,sh:1};
const key=(cx:number,t:number,visible=true)=>({t,cx,cy:.5,size:.2,visible});
// Adjacent keys are exactly maxGapSeconds (1s) apart, so interior times are legitimately sampled.
const still=(cx:number)=>[key(cx,0),key(cx,1),key(cx,2)];
const make=(feedId:string,tracks:HeadTracking['tracks'],extra:Partial<HeadTracking>={}):HeadTracking=>({schemaVersion:1,feedId,videoSha256:'a'.repeat(64),annotationSha256:'b'.repeat(64),sourceWidth:100,sourceHeight:100,duration:2,maxGapSeconds:1,tracks,...extra});
const humans=[{id:'person-01',keyframes:still(.3)},{id:'person-02',keyframes:still(.7)}];
/** Records the colour actually active when each shape is stroked (strokeRect, or stroke for a triangle); ignores setup assignments and corner-tick strokes. */
function recorder(){const shapes:unknown[]=[];let s:unknown='#000',pendingRect=false;
 const calls=Object.fromEntries(['save','beginPath','rect','clip','strokeRect','setLineDash','moveTo','lineTo','closePath','stroke','restore'].map(k=>[k,vi.fn()]));
 calls.strokeRect=vi.fn(()=>{shapes.push(s);pendingRect=true;});
 calls.stroke=vi.fn(()=>{if(pendingRect)pendingRect=false;else shapes.push(s);});
 const ctx={...calls,get strokeStyle(){return s;},set strokeStyle(v:unknown){s=v;}} as unknown as CanvasRenderingContext2D;return {ctx,shapes,calls};}
const rects=(r:ReturnType<typeof recorder>)=>r.calls.strokeRect.mock.calls.map(c=>(c as number[]).map(Math.round));
it('configures one explicit highlighted human track in m01, m02 and the G340 event, without mutating source data',()=>{
 expect(HUMAN_HIGHLIGHT_TRACKS).toEqual({m01:['person-01'],m02:['person-01'],'city-butlerville-event-6be3a62539fcd5e7e29c':['person-01'],'city-butlerville-event-0e5edab9c311666c7614':['person-01']});
 for(const [feed,ids] of Object.entries(HUMAN_HIGHLIGHT_TRACKS)){const d=trackingFor(feed)!,before=JSON.stringify(d);expect(d.tracks.map(t=>t.id)).toEqual(expect.arrayContaining([...ids]));drawHeadTracks(recorder().ctx,d,1,FULL,960,540);expect(JSON.stringify(d)).toBe(before);}
});
it('draws configured human muted yellow, other humans neutral, unknown feeds neutral, with identical geometry',()=>{
 const r=recorder();drawHeadTracks(r.ctx,make('m01',humans),1,FULL,100,100);
 expect(r.shapes).toEqual([HUMAN_MARKER_COLORS.highlight,HUMAN_MARKER_COLORS.neutral]);expect(HUMAN_MARKER_COLORS.highlight).not.toBe(HUMAN_MARKER_COLORS.neutral);
 expect(rects(r)).toEqual([[20,40,20,20],[60,40,20,20]]);
 const u=recorder();drawHeadTracks(u.ctx,make('unknown-feed',humans),1,FULL,100,100);expect(u.shapes).toEqual([HUMAN_MARKER_COLORS.neutral,HUMAN_MARKER_COLORS.neutral]);expect(rects(u)).toEqual(rects(r));
 expect(headSquares(make('m01',humans),1,FULL,100,100)).toEqual(headSquares(make('unknown-feed',humans),1,FULL,100,100));
 expect(sampleHeadTracks(make('m01',humans),1)[0]).not.toHaveProperty('highlight');
});
it('object markers override a colliding feed/track highlight and humans never take object colours',()=>{
 const d=make('m01',[{id:'person-01',marker:'aircraft-triangle',keyframes:still(.3)},{id:'person-01b',marker:'vehicle-square',keyframes:still(.5)},{id:'person-02',keyframes:still(.7)}]);
 const r=recorder();drawHeadTracks(r.ctx,d,1,FULL,100,100);expect(r.shapes).toEqual(['#78d47a','#f1f0ea',HUMAN_MARKER_COLORS.neutral]);expect(r.calls.closePath).toHaveBeenCalledTimes(1);expect(r.calls.strokeRect).toHaveBeenCalledTimes(2);
 expect(Object.values(HUMAN_MARKER_COLORS)).not.toContain('#78d47a');
});
it('keeps crop, occlusion, null and oversize-gap behaviour unchanged for highlighted humans',()=>{
 const d=make('m01',[{id:'person-01',keyframes:[key(.3,0),key(.3,1,false),key(.3,2)]},humans[1]],{occlusionPolygons:[[{x:0,y:0},{x:.5,y:0},{x:.5,y:.5}]]});
 const crop={sx:.1,sy:0,sw:.8,sh:1};
 // Null key adjacent: highlighted human is absent, remaining human stays neutral; occlusion clip still requested.
 const a=recorder();drawHeadTracks(a.ctx,d,.5,crop,100,100);expect(a.calls.clip).toHaveBeenCalledWith('evenodd');expect(a.shapes).toEqual([HUMAN_MARKER_COLORS.neutral]);
 // Min-axis scale=min(100/(.8*100),100/100)=1, side=.2*100=20; x=(cx-sx)/sw*100-side/2.
 const b=recorder();drawHeadTracks(b.ctx,d,0,crop,100,100);expect(b.shapes).toEqual([HUMAN_MARKER_COLORS.highlight,HUMAN_MARKER_COLORS.neutral]);expect(rects(b)).toEqual([[15,40,20,20],[65,40,20,20]]);
 const off=recorder();drawHeadTracks(off.ctx,d,0,{sx:.5,sy:0,sw:.1,sh:1},100,100);expect(off.shapes).toEqual([]);expect(off.calls.strokeRect).not.toHaveBeenCalled();
 // Oversize gap (2s > maxGap 1s) is never bridged, even for a configured track.
 const gap=make('m01',[{id:'person-01',keyframes:[key(.3,0),key(.3,2)]}]);expect(sampleHeadTracks(gap,1)).toEqual([]);const g=recorder();drawHeadTracks(g.ctx,gap,1,FULL,100,100);expect(g.shapes).toEqual([]);
});
