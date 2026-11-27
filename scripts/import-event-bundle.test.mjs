import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importEventBundle,APPROVED_EVENT_BUNDLE} from './import-event-bundle.mjs';
const root=path.resolve('.');
test('event importer rejects unauthorized manifest before reading or writing assets',async()=>{
 await assert.rejects(importEventBundle({root,bundleDir:root,approvedManifestSha:'0'.repeat(64),apply:true}),/not authorized/);
});
test('exact approval does not admit altered manifest bytes',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'event-import-test-'));
 try{await fs.writeFile(path.join(tmp,'manifest.json'),'{}');await assert.rejects(importEventBundle({root,bundleDir:tmp,approvedManifestSha:APPROVED_EVENT_BUNDLE,apply:true}),/byte SHA mismatch/);}
 finally{await fs.rm(tmp,{recursive:true,force:true});}
});
