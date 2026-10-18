import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateSettings,loadSettings} from '../local-diary/settings.mjs';

test('launcher settings share defaults and reject invalid port values',()=>{
 assert.deepEqual(validateSettings(),{version:1,port:8766,httpsPort:443});
 assert.deepEqual(validateSettings({port:9001,httpsPort:8443}),{version:1,port:9001,httpsPort:8443});
 for(const value of [0,65536,-1,2.5,'9000',true,NaN])assert.throws(()=>validateSettings({port:value}));
});
test('missing local settings use defaults; malformed settings do not silently start another service',async()=>{
 const base=path.resolve('qa-output/settings-tests');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'run-'));
 assert.deepEqual(await loadSettings(root),validateSettings());
 await fs.mkdir(path.join(root,'local-state'));await fs.writeFile(path.join(root,'local-state/diary-settings.json'),'{broken');
 await assert.rejects(loadSettings(root));
});
