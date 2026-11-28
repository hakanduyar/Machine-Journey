import {describe,it,expect} from 'vitest';
import {RECORDING_MANIFEST,RECORDING_COUNTS,manifestCandidatesFor} from '../../src/journey/recordingManifest';
import {allocateCityRecordings, REVIEWED_OCCURRENCES, type RecordingCandidate} from '../../src/journey/recordingIdentity';
import {CITIES} from '../../src/journey/globe';
import {ALL_FEEDS} from '../../src/journey/feeds';
import {admitCityLayout} from '../../src/journey/uniqueCityLayout';
const event=RECORDING_MANIFEST.find(c=>c.reviewedEvent)!;
const base=RECORDING_MANIFEST.find(c=>!c.reviewedEvent&&c.reviewedView!.viewId===event.reviewedView!.viewId)!;
const allocation=(e:RecordingCandidate)=>allocateCityRecordings(e.cityId,2,[{...base,cityId:e.cityId},e]);
it('catalog preserves the registered occurrence and allocates 33 Butlerville recordings across 21 views',()=>{
 const p=REVIEWED_OCCURRENCES[0],prior=RECORDING_MANIFEST.find(r=>r.feedId===p.accepted[0].feedId)!;
 expect(prior.sourceInterval).toEqual({startSec:100,endSec:125});expect(prior.eventAssets?.loopSha256).toMatch(/^[a-f0-9]{64}$/);
 const candidate=RECORDING_MANIFEST.find(r=>r.feedId===p.feedId)!;expect(candidate.sourceInterval).toEqual({startSec:150,endSec:166});expect(candidate.reviewedEvent!.sameOriginalReview).toEqual(p);expect(candidate.originalSha256).toBe(prior.originalSha256);
 const result=allocateCityRecordings('butlerville',33,RECORDING_MANIFEST);expect(result.status).toBe('ready');if(result.status==='invalid')return;expect(result.recordings).toHaveLength(33);expect(new Set(result.recordings.map(r=>r.viewId)).size).toBe(21);
});
describe('explicit city-scoped event identity',()=>{
 it('counts the same physical camera once and its separate reviewed occurrence once',()=>{
  expect(RECORDING_COUNTS).toEqual({physicalViews:101,recordings:113,eventRecordings:12});
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
 it('binds twenty-five distinct recording tiles to city-owned feeds; seventy-eight remains blocked',()=>{
  const city=CITIES.find(c=>c.id==='butlerville')!;
  const opts={cityId:city.id,candidates:manifestCandidatesFor(city.id),feedIds:ALL_FEEDS.map(f=>f.id),ownedFeedIds:city.feedIds!,width:3000,height:1000};
  const a=admitCityLayout({...opts,requestedSlots:25});expect(a.status).toBe('ready');
  if(a.status==='ready')expect(new Set(a.mosaic.tiles.map(t=>t.feedIndex)).size).toBe(25);
  expect(admitCityLayout({...opts,requestedSlots:78}).status).toBe('insufficient');
 });
});

it('new reviewed events retain their existing physical camera identities',()=>{const expected=[["city-butlerville-event-5b53880db45458d170a8","butlerville-meva-g326"],["city-butlerville-event-aa4fd544b8e12da53881","butlerville-meva-g423-school-hall"],["city-butlerville-event-42b9a7d07894762477da","meva-mutc-g419"],["city-butlerville-event-788995c15491e2f58728","butlerville-meva-g639-passage"],["city-butlerville-event-0cb69d3407458efbd9cb","meva-mutc-g419"]];for(const[id,view]of expected){const e=RECORDING_MANIFEST.find(r=>r.feedId===id)!;expect(e.reviewedEvent).toBeDefined();expect(e.reviewedView!.viewId).toBe(view);expect(RECORDING_MANIFEST.some(r=>!r.reviewedEvent&&r.reviewedView!.viewId===view)).toBe(true);}expect(new Set(manifestCandidatesFor('butlerville').map(r=>r.reviewedView!.viewId)).size).toBe(21);});
