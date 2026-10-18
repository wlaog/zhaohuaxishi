import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {organizeSource} from '../scripts/organize-source.mjs';
test('migration and a later heading rename retain child pages and asset bytes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'onenote-layout-'));
 t.after(async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('onenote-layout-'))throw Error('Unsafe test cleanup');await fs.rm(root,{recursive:true})});
 await fs.mkdir(root+'/_source');
 const m={sections:[{key:'s',name:'2023',groups:[],pageCount:2}],pages:[{key:'parent',sectionKey:'s',title:'九月',level:1,url:'pages/s/parent/index.html',source:'_source/parent.xml'},{key:'child',sectionKey:'s',title:'9.30',level:3,url:'pages/s/child/index.html',source:'_source/child.xml'}]};
 for(const p of m.pages){const d=path.dirname(path.join(root,p.url));await fs.mkdir(d+'/native.files',{recursive:true});await fs.writeFile(d+'/native.htm','<html>content</html>');await fs.writeFile(d+'/native.files/image.png',Buffer.from([1,2,3,4]));await fs.writeFile(root+'/'+p.source,'<page>'+p.key+'</page>')}
 await fs.writeFile(root+'/manifest.json',JSON.stringify(m));
 let organized=await organizeSource(root);
 const original=organized.pages[1].source;
 organized.pages[0].title='十月';organized.pages[1].title='10.1';await fs.writeFile(root+'/manifest.json',JSON.stringify(organized));
 organized=await organizeSource(root);
 assert.notEqual(organized.pages[1].source,original);
 assert.equal(await fs.readFile(root+'/'+organized.pages[1].source,'utf8'),'<page>child</page>');
 assert.deepEqual(await fs.readFile(path.dirname(root+'/'+organized.pages[1].url)+'/native.files/image.png'),Buffer.from([1,2,3,4]));
 const again=await organizeSource(root);assert.deepEqual(again,organized);
});
