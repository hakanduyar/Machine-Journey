import {describe,it,expect} from 'vitest';
import {RECORDING_MANIFEST,RECORDING_COUNTS,manifestCandidatesFor} from '../../src/journey/recordingManifest';
import {allocateCityRecordings, type RecordingCandidate} from '../../src/journey/recordingIdentity';
import {CITIES} from '../../src/journey/globe';
import {ALL_FEEDS} from '../../src/journey/feeds';
import {admitCityLayout} from '../../src/journey/uniqueCityLayout';
const event=RECORDING_MANIFEST.find(c=>c.reviewedEvent)!;
const base=RECORDING_MANIFEST.find(c=>!c.reviewedEvent&&c.reviewedView!.viewId===event.reviewedView!.viewId)!;
const allocation=(e:RecordingCandidate)=>allocateCityRecordings(e.cityId,2,[{...base,cityId:e.cityId},e]);
describe('explicit city-scoped event identity',()=>{
 it('counts the same physical camera once and its separate reviewed occurrence once',()=>{
  expect(RECORDING_COUNTS).toEqual({physicalViews:95,recordings:96,eventRecordings:1});
  expect(event.reviewedView!.viewId).toBe('meva-mutc-g340');
  const a=allocation(event);expect(a.status).toBe('ready');
  if(a.status==='invalid')return;
  expect(new Set(a.recordings.map(r=>r.viewId)).size).toBe(1);
  expect(new Set(a.allocations.map(r=>r.tileId)).size).toBe(2);
  expect(a.allocations.some(r=>r.tileId.includes('#event:'))).toBe(true);
 });
 it('rejects missing city pin, foreign city, invented camera, same original and repeated event aliases',()=>{
  expect(allocation({...event,reviewedEvent:{...event.reviewedEvent!,decisionSha256:'0'.repeat(64)}}).status).toBe('invalid');
  expect(allocation({...event,cityId:'paris'}).status).toBe('invalid');
  expect(allocation({...event,reviewedView:{...event.reviewedView!,viewId:'invented-camera'}}).status).toBe('invalid');
  expect(allocation({...event,originalAssetKey:base.originalAssetKey}).status).toBe('invalid');
  expect(allocateCityRecordings('butlerville',3,[base,event,{...event,feedId:'alias'}]).status).toBe('invalid');
  const alias={...event,reviewedEvent:{...event.reviewedEvent!,eventId:'renamed'},originalAssetKey:'different',originalAssetUrl:'https://example.org/different',originalSha256:'a'.repeat(64)};
  expect(allocateCityRecordings('butlerville',3,[base,event,alias]).status).toBe('invalid');
 });
 it('binds twenty distinct recording tiles to city-owned feeds; seventy-eight remains blocked',()=>{
  const city=CITIES.find(c=>c.id==='butlerville')!;
  const opts={cityId:city.id,candidates:manifestCandidatesFor(city.id),feedIds:ALL_FEEDS.map(f=>f.id),ownedFeedIds:city.feedIds!,width:3000,height:1000};
  const a=admitCityLayout({...opts,requestedSlots:20});expect(a.status).toBe('ready');
  if(a.status==='ready')expect(new Set(a.mosaic.tiles.map(t=>t.feedIndex)).size).toBe(20);
  expect(admitCityLayout({...opts,requestedSlots:78}).status).toBe('insufficient');
 });
});
