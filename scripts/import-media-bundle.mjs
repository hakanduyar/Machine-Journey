import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const fail = message => { throw new Error(message); };
const slug = s => typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const clean = s => typeof s === 'string' && s.trim() && !/(?:^|\s)[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/|localhost|127\.0\.0\.1|file:(?:[\\/]|[A-Za-z]:)/i.test(s);
const inside = (root, p) => p.startsWith(root + path.sep);
async function contained(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(relative)) fail('invalid relative asset path');
  const real = await fs.realpath(path.resolve(root, relative));
  if (!inside(root, real) || !(await fs.stat(real)).isFile()) fail('asset path escapes bundle');
  return real;
}
function url(raw) { const u = new URL(raw); if(u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) fail('unsafe public URL'); return u; }
export function validateItem(i, cityIds) {
  const safeNote = s => clean(s) && !/(?:https?:\/\/[^\s/]+:[^\s/]+@|(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=])/i.test(s);
  if (Array.isArray(i.notes)) {
    if (!i.notes.length || !i.notes.every(safeNote)) fail('missing or private metadata: notes');
    i = { ...i, notes: i.notes.join(' ') };
  }
  if (!safeNote(i.notes)) fail('missing or private metadata: notes');
  if (!/^(?:(?:pexels|mixkit):[1-9][0-9]*|meva:[0-9A-Za-z.-]+\.avi|commons:[A-Za-z0-9_(). -]+\.(?:webm|ogv))$/.test(i.key || '') || !slug(i.city) || !cityIds.includes(i.city) || !slug(i.viewId)) fail('invalid key/city/view');
  for (const k of ['credit','reviewRef','locationClaim','provenanceLevel','notes']) if (!clean(i[k])) fail('missing or private metadata: ' + k);
  for (const k of ['originalSha256','loopSha256','posterSha256','creditsSha256']) if (!hash(i[k])) fail('missing SHA: ' + k);
  if (i.originalSha256 === i.loopSha256 || i.originalSha256 === i.posterSha256) fail('original cannot be derivative');
  if(i.exactCameraCoordinatesVerified !== false) fail('camera coordinates are not verified by this adapter');
  const [provider,id] = i.key.split(':'), s=url(i.source), m=url(i.originalMedia);
  const px=provider==='pexels';
  if(provider==='commons'){
    const name=id.replaceAll(' ','_'), md5=crypto.createHash('md5').update(name).digest('hex');
    if(s.hostname!=='commons.wikimedia.org'||decodeURIComponent(s.pathname)!=='/wiki/File:'+name||m.hostname!=='upload.wikimedia.org'||decodeURIComponent(m.pathname)!==`/wikipedia/commons/${md5[0]}/${md5.slice(0,2)}/${name}`)fail('Commons source/item/media binding mismatch');
    const c=i.commons;
    if(!c||c.fileTitle!=='File:'+name||!/^\d+$/.test(c.revision)||!hash(c.sourcePageSha256)||!safeNote(c.author)||!safeNote(c.derivativeChanges))fail('missing Commons source/derivative provenance');
    if(i.license!=='CC BY-SA 4.0'||i.licenseUrl!=='https://creativecommons.org/licenses/by-sa/4.0/'||c.derivativeLicense!==i.license||c.derivativeLicenseUrl!==i.licenseUrl)fail('unsupported Commons license or derivative ShareAlike');
    if(i.provenanceLevel!=='publisher-city-claim'||!i.trim||!Number.isFinite(i.trim.start)||!Number.isFinite(i.trim.end)||i.trim.start<0||i.trim.end<=i.trim.start)fail('invalid Commons location/window');
    return {cityId:i.city,city:i.city,feedId:'city-'+i.city+'-commons-'+i.originalSha256.slice(0,16),source:i.source,credit:i.credit,license:i.license,licenseUrl:i.licenseUrl,archiveLabel:/time.?lapse/i.test(i.notes)?'ARCHIVE / TIMELAPSE':'ARCHIVE / CITY VIEW',locationClaim:i.locationClaim,provenanceLevel:'STOCK_PUBLISHER_LOCATION',bundleProvenanceLevel:i.provenanceLevel,exactCameraCoordinatesVerified:false,originalAssetKey:'commons/'+name,originalAssetUrl:i.originalMedia,originalSha256:i.originalSha256,loopSha256:i.loopSha256,posterSha256:i.posterSha256,creditsSha256:i.creditsSha256,reviewedViewId:i.viewId,reviewRef:i.reviewRef,sourceWindow:{start:i.trim.start,end:i.trim.end},commons:{fileTitle:c.fileTitle,revision:c.revision,sourcePageSha256:c.sourcePageSha256,author:c.author,derivativeLicense:c.derivativeLicense,derivativeLicenseUrl:c.derivativeLicenseUrl,derivativeChanges:c.derivativeChanges},loopNote:'Archived footage, not live. '+i.notes};
  }
  if(provider==='meva'){
    const name=m.pathname.split('/').at(-1),match=name?.match(/^(2018-\d{2}-\d{2})\.(\d{2})-\d{2}-\d{2}\.(\d{2})-\d{2}-\d{2}\.[a-z]+\.(G\d{3})\.r13\.avi$/);
    const parent=match&&('/drops-123-r13/'+match[1]+'/');
    if(!match||m.hostname!=='mevadata-public-01.s3.amazonaws.com'||s.href!==m.href||id!==name||!([match[2],match[3]].some(hour=>m.pathname===parent+hour+'/'+name)||m.pathname==='/drop-5-mevid/'+name))fail('MEVA source/item/media binding mismatch');
    if(i.city!=='butlerville'||i.license!=='CC BY 4.0'||i.licenseUrl!=='https://mevadata.org/resources/MEVA-data-license.txt'||i.provenanceLevel!=='official-camera-location')fail('unsupported MEVA location/license');
    if(!i.trim||!Number.isFinite(i.trim.start)||!Number.isFinite(i.trim.end)||i.trim.start<0||i.trim.end<=i.trim.start||i.trim.end>300)fail('invalid MEVA trim');
    return {cityId:i.city,city:i.city,feedId:'city-'+i.city+'-meva-'+i.originalSha256.slice(0,16),source:i.source,credit:i.credit,license:i.license,licenseUrl:i.licenseUrl,archiveLabel:'ARCHIVE / CITY VIEW',locationClaim:i.locationClaim,provenanceLevel:'OFFICIAL_DATASET_SITE',bundleProvenanceLevel:i.provenanceLevel,exactCameraCoordinatesVerified:false,originalAssetKey:'meva/'+name,originalAssetUrl:i.originalMedia,originalSha256:i.originalSha256,loopSha256:i.loopSha256,posterSha256:i.posterSha256,creditsSha256:i.creditsSha256,reviewedViewId:i.viewId,reviewRef:i.reviewRef,sourceCameraId:match[4],sourceWindow:{start:i.trim.start,end:i.trim.end},loopNote:'Archived footage, not live. '+i.notes};
  }
  if (!(px ? ['www.pexels.com','pexels.com'].includes(s.hostname) && new RegExp('^/video/[^/]+-'+id+'/$').test(s.pathname) && m.hostname==='videos.pexels.com' && m.pathname.startsWith('/video-files/'+id+'/') : s.hostname==='mixkit.co' && new RegExp('^/free-stock-video/[^/]+-'+id+'/$').test(s.pathname) && m.hostname==='assets.mixkit.co' && m.pathname.startsWith('/videos/'+id+'/'+id+'-'))) fail('source/item/media binding mismatch');
  if (!/^[\w./-]+\.mp4$/.test(m.pathname)) fail('invalid media URL');
  if(i.license !== (px?'Pexels License':'Mixkit Stock Video Free License') || i.licenseUrl !== (px?'https://www.pexels.com/license/':'https://mixkit.co/license/modal/videoFree/')) fail('unsupported license');
  return { cityId:i.city, city:i.city, feedId:`city-${i.city}-${provider}-${id}`, source:i.source, credit:i.credit, license:i.license, licenseUrl:i.licenseUrl, archiveLabel:/time.?lapse/i.test(i.notes+' '+i.source)?'ARCHIVE / TIMELAPSE':'ARCHIVE / CITY VIEW', locationClaim:i.locationClaim, provenanceLevel:'STOCK_PUBLISHER_LOCATION', bundleProvenanceLevel:i.provenanceLevel, exactCameraCoordinatesVerified:false, originalAssetKey:`${provider}-${id}/${path.posix.basename(m.pathname)}`, originalAssetUrl:i.originalMedia, originalSha256:i.originalSha256, loopSha256:i.loopSha256, posterSha256:i.posterSha256, creditsSha256:i.creditsSha256, reviewedViewId:i.viewId, reviewRef:i.reviewRef, loopNote:'Archived footage, not live. '+i.notes };
}
// Load canonical application data through the project's existing TypeScript bundler, without emitting files.
export async function baseline(root) {
  const { rolldown } = await import('rolldown');
  const entry='virtual:media-import-baseline';
  const bundle=await rolldown({input:entry,plugins:[{name:'baseline',resolveId(id){if(id===entry)return id;},load(id){if(id===entry)return `export { RECORDING_MANIFEST as records } from ${JSON.stringify(path.join(root,'src/journey/recordingManifest.ts'))}; export { CITIES as cities } from ${JSON.stringify(path.join(root,'src/journey/globe.ts'))};`;}}]});
  const {output}=await bundle.generate({format:'esm'}); await bundle.close();
  return import('data:text/javascript;base64,'+Buffer.from(output[0].code).toString('base64'));
}
export async function importBundle({root,bundleDir,approvedManifestSha,apply=false,baselineData}) {
  if(!hash(approvedManifestSha)) fail('explicit approved manifest byte SHA required');
  root=await fs.realpath(root); bundleDir=await fs.realpath(bundleDir);
  const manifestPath=await contained(bundleDir,'manifest.json'), bytes=await fs.readFile(manifestPath);
  if(digest(bytes)!==approvedManifestSha) fail('approved manifest SHA mismatch');
  const manifest=JSON.parse(bytes);
  if(manifest.schemaVersion!==2 || manifest.admission!=='INDEPENDENT_MEDIA_APPROVED_NOT_RUNTIME_ADMITTED' || !Array.isArray(manifest.items) || !manifest.items.length) fail('bundle is not approved schema2');
  const data=baselineData || await baseline(root), cities=data.cities.map(c=>c.id);
  const media=await fs.realpath(path.join(root,'public/media'));
  if(!inside(root,media))fail('destination media escapes app');
  const rowPath=await contained(media,'city-sources-extra.json'), oldBytes=await fs.readFile(rowPath), rows=JSON.parse(oldBytes);
  const additions=[], copies=[], feedIds=[], keys=new Set(), records=[...data.records];
  for(const i of manifest.items){
    const row=validateItem(i,cities); feedIds.push(row.feedId);
    if(keys.has(i.key))fail('duplicate bundle item'); keys.add(i.key);
    const existing=rows.find(r=>r.feedId===row.feedId);
    if(existing && JSON.stringify(existing)!==JSON.stringify({...row,admissionManifestSha256:approvedManifestSha})) fail('existing feed metadata conflict');
    for(const c of records){
      if(existing && c.feedId===row.feedId)continue;
      if(c.feedId===row.feedId || c.reviewedView?.viewId?.trim().toLowerCase()===i.viewId || c.originalSha256?.toLowerCase()===i.originalSha256 || c.originalAssetUrl===i.originalMedia || c.originalAssetKey===row.originalAssetKey || c.provenance?.sourceUrl===i.source) fail('global view/original alias collision: '+i.key);
    }
    const dest=path.join(media,row.feedId); let destExists=false;
    try {const st=await fs.lstat(dest);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(dest)!==dest)fail('unsafe destination folder');destExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(destExists&&!existing)fail('untracked destination already exists');
    for(const [kind,name,expected]of [['loop','loop.mp4',i.loopSha256],['poster','poster.jpg',i.posterSha256],['credits','CREDITS.txt',i.creditsSha256]]){
      const from=await contained(bundleDir,i.files?.[kind]), b=await fs.readFile(from);if(digest(b)!==expected)fail('bundle asset hash mismatch: '+kind);
      if(kind==='credits'){
        const credit=b.toString('utf8');if(!clean(credit))fail('private or missing credits');
        if(i.key.startsWith('commons:')&&![i.source,i.originalMedia,i.licenseUrl,i.commons.author,i.commons.derivativeChanges].every(s=>credit.includes(s)))fail('Commons attribution/derivative credits mismatch');
      }
      const to=path.join(dest,name);
      if(existing){const actual=await contained(media,row.feedId+'/'+name);if(digest(await fs.readFile(actual))!==expected)fail('existing asset mismatch');}
      else copies.push({to,bytes:b});
    }
    if(!existing){additions.push({...row,admissionManifestSha256:approvedManifestSha});records.push({feedId:row.feedId,reviewedView:{viewId:i.viewId},originalSha256:i.originalSha256,originalAssetKey:row.originalAssetKey,originalAssetUrl:i.originalMedia,provenance:{sourceUrl:i.source}});}
  }
  if(apply&&additions.length){
    // Every input and conflict is validated before the first write. No replacement of existing assets.
    if(!oldBytes.equals(await fs.readFile(rowPath)))fail('catalog changed during planning');
    const created=[];const temp=rowPath+'.import-'+process.pid;
    try {for(const row of additions){const d=path.join(media,row.feedId);await fs.mkdir(d);created.push(d);} for(const c of copies)await fs.writeFile(c.to,c.bytes,{flag:'wx'});await fs.writeFile(temp,JSON.stringify([...rows,...additions],null,2)+'\n',{flag:'wx'});await fs.rename(temp,rowPath);}
    catch(e){await fs.rm(temp,{force:true});for(const d of created)await fs.rm(d,{recursive:true,force:true});throw e;}
  }
  return {status:apply?'APPLIED_PENDING_RUNTIME_REVIEW':'DRY_RUN',approvedManifestSha,items:manifest.items.length,added:additions.length,unchanged:manifest.items.length-additions.length,filesWritten:apply?copies.length+(additions.length?1:0):0,feedIds};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const [bundleDir,approvedManifestSha,flag]=process.argv.slice(2);if(flag&&flag!=='--apply')throw Error('only --apply supported');
 importBundle({root:path.resolve(fileURLToPath(new URL('..',import.meta.url))),bundleDir,approvedManifestSha,apply:flag==='--apply'}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}

