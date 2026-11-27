import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {baseline,digest} from './import-media-bundle.mjs';
// This release authorizes exactly ONE reviewed event. A second event requires a fresh
// admission review with the accepted-events baseline; changing CLI arguments cannot open it.
export const APPROVED_EVENT_BUNDLE='3fbca0519ddf96a84928c6268d76f2c6556d3206f5ba9a3de544630d4737333d';
export const CITY_DECISION='3cbf43f248a54d26d711d185e188fde7d018e5e895c670269e91eb70dbf9ec76';
const fail=m=>{throw Error(m);};
async function contained(root,relative){
 if(typeof relative!=='string'||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..'))fail('invalid relative path');
 const p=await fs.realpath(path.join(root,relative));
 if(!p.startsWith(root+path.sep)||!(await fs.stat(p)).isFile())fail('path escapes root');return p;
}
export async function importEventBundle({root,bundleDir,approvedManifestSha,apply=false,baselineData}){
 if(approvedManifestSha!==APPROVED_EVENT_BUNDLE)fail('event bundle is not authorized; new review and accepted-events baseline required');
 root=await fs.realpath(root);bundleDir=await fs.realpath(bundleDir);
 const bytes=await fs.readFile(await contained(bundleDir,'manifest.json'));
 if(digest(bytes)!==approvedManifestSha)fail('manifest byte SHA mismatch');
 const m=JSON.parse(bytes),i=m.items?.[0];
 if(m.schemaVersion!==3||m.admission!=='CITY_SCOPED_EVENT_MEDIA_APPROVED_NOT_RUNTIME_ADMITTED'||m.items.length!==1||m.acceptedEventRecords!==0||m.baselinePhysicalViews!==94)fail('unsupported event admission baseline');
 if(i.city!=='butlerville'||i.authorization?.decisionSha256!==CITY_DECISION||i.authorization.city!==i.city||i.physicalCameraId!==i.viewId||i.physicalViewIncrement!==0||i.eventRecordingIncrement!==1)fail('city authorization/physical identity mismatch');
 const data=baselineData||await baseline(root);
 const physical=data.records.filter(r=>!r.reviewedEvent);
 if(physical.length!==94||!data.cities.some(c=>c.id===i.city))fail('physical baseline changed; review required');
 const camera=physical.filter(r=>r.cityId===i.city&&r.reviewedView?.viewId===i.physicalCameraId);
 if(camera.length!==1||camera[0].feedId!==i.eventReview.comparisonFeedId||camera[0].originalAssetUrl!==i.eventReview.comparisonOriginal)fail('physical camera comparison mismatch');
 const media=await fs.realpath(path.join(root,'public/media'));
 if(!media.startsWith(root+path.sep))fail('destination escapes root');
 const rowPath=await contained(media,'city-event-sources.json'),old=await fs.readFile(rowPath),rows=JSON.parse(old);
 const feedId='city-butlerville-event-'+i.key.split(':')[1];
 const row={...i,cityId:i.city,feedId,archiveLabel:'ARCHIVE / DISTINCT EVENT',originalAssetKey:'meva/'+i.originalRecordingId,originalAssetUrl:i.originalMedia,admissionManifestSha256:approvedManifestSha};
 const existing=rows.find(r=>r.feedId===feedId);
 if(rows.length>(existing?1:0))fail('accepted-events baseline must be reconciled before a second event');
 if(existing&&JSON.stringify(existing)!==JSON.stringify(row))fail('existing event metadata conflict');
 for(const r of data.records){
  if(existing&&r.feedId===feedId)continue;
  if(r.feedId===feedId||r.originalAssetUrl===i.originalMedia||r.originalAssetKey===row.originalAssetKey||r.originalSha256?.toLowerCase()===i.originalSha256||r.reviewedEvent?.eventId===i.eventId||r.reviewedEvent?.equivalenceKey===i.eventEquivalenceKey)fail('original/event alias conflict');
 }
 // Derivative identities also cannot be reused under a new event label.
 const extra=JSON.parse(await fs.readFile(await contained(media,'city-sources-extra.json'),'utf8'));
 for(const r of [...extra,...rows.filter(r=>r.feedId!==feedId)])for(const k of ['loopSha256','posterSha256'])if(r[k]===i[k])fail('derivative alias conflict');
 const copies=[];
 for(const [kind,name,key]of [['loop','loop.mp4','loopSha256'],['poster','poster.jpg','posterSha256'],['credits','CREDITS.txt','creditsSha256']]){
  const b=await fs.readFile(await contained(bundleDir,i.files[kind]));if(digest(b)!==i[key])fail('asset SHA mismatch: '+kind);
  if(existing){if(digest(await fs.readFile(await contained(media,feedId+'/'+name)))!==i[key])fail('existing asset mismatch');}
  else copies.push({name,b});
 }
 if(apply&&!existing){
  if(!old.equals(await fs.readFile(rowPath)))fail('catalog changed during planning');
  const dest=path.join(media,feedId),temp=rowPath+'.import-'+process.pid;
  await fs.mkdir(dest); // no overwrite, symlink, or pre-existing directory admitted
  try{for(const c of copies)await fs.writeFile(path.join(dest,c.name),c.b,{flag:'wx'});await fs.writeFile(temp,JSON.stringify([...rows,row],null,2)+'\n',{flag:'wx'});await fs.rename(temp,rowPath);}
  catch(e){await fs.rm(temp,{force:true});await fs.rm(dest,{recursive:true,force:true});throw e;}
 }
 return {status:apply?'APPLIED_PENDING_RUNTIME_REVIEW':'DRY_RUN',feedId,physicalViews:94,recordings:95,eventRecordings:1,added:existing?0:1,filesWritten:apply&&!existing?4:0,approvedManifestSha};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [bundleDir,approvedManifestSha,flag]=process.argv.slice(2);if(flag&&flag!=='--apply')throw Error('only --apply supported');
 importEventBundle({root:fileURLToPath(new URL('..',import.meta.url)),bundleDir,approvedManifestSha,apply:flag==='--apply'}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
