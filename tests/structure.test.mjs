import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { archiveDate, isEmptyStructurePage } from '../local-diary/structure.mjs';
import { DiaryStore } from '../local-diary/store.mjs';

const entry = { group:true, title:'七月上旬', imageCount:0, attachmentCount:0, tags:[], blocks:[{id:'original',type:'archive'}] };
const xml = body => `<one:Page xmlns:one="urn:onenote"><one:Title><one:OE><one:T><![CDATA[七月上旬]]></one:T></one:OE></one:Title><one:Outline><one:OEChildren>${body}</one:OEChildren></one:Outline></one:Page>`;
const empty = xml('<one:OE><one:T><![CDATA[<span>&nbsp;</span>]]></one:T></one:OE>');

test('date suffixes preserve actual same-day diaries and validate dates',()=>{
  assert.equal(archiveDate('source/25/11/12~951ae0/index.html'),'2025-11-12');
  assert.equal(archiveDate('source/25/11/12-951ae0/index.html'),'2025-11-12');
  assert.equal(archiveDate('source/24/02/29/index.html'),'2024-02-29');
  assert.equal(archiveDate('source/25/02/29/index.html'),null);
  assert.equal(archiveDate('source/25/07/_1/index.html'),null);
});
test('only title-only structure headings are removed; real, uncertain or edited content remains',()=>{
  assert.equal(isEmptyStructurePage(entry,empty),true);
  for(const title of ['一月','十二月中旬','十月下旬'])assert.equal(isEmptyStructurePage({...entry,title},empty),true);
  assert.equal(isEmptyStructurePage({...entry,title:'七月游记'},empty),false);
  assert.equal(isEmptyStructurePage(entry,xml('<one:OE><one:T><![CDATA[<p>真实日记内容</p>]]></one:T></one:OE>')),false);
  for(const content of ['<one:Image/>','<one:InsertedFile/>','<one:InkDrawing/>','<one:Future/>','<one:Table/>'])assert.equal(isEmptyStructurePage(entry,xml('<one:OE>'+content+'</one:OE>')),false);
  assert.equal(isEmptyStructurePage(entry,xml('<one:OE/>')),false);
  assert.equal(isEmptyStructurePage({...entry,imageCount:1},empty),false);
  assert.equal(isEmptyStructurePage({...entry,blocks:[...entry.blocks,{id:'new',type:'text',html:'记录'}]},empty),false);
  assert.equal(isEmptyStructurePage({...entry,importSources:[{}]},empty),false);
});
test('cleanup requires a matching raw snapshot and does not remove real daily pages',async()=>{
  await fs.mkdir('qa-output/structure-tests',{recursive:true});
  const root=path.resolve(await fs.mkdtemp('qa-output/structure-tests/run-'));
  const pages=[
    {key:'a'.repeat(20),title:'七月上旬',url:'source/25/07/_1/index.html',source:'source/25/07/_1/page.xml',content:empty},
    {key:'b'.repeat(20),title:'七月中旬',url:'source/25/07/_2/index.html',source:'source/25/07/_2/page.xml',content:xml('<one:OE><one:T>有内容</one:T></one:OE>')},
    {key:'c'.repeat(20),title:'七月下旬',url:'source/25/07/_3/index.html',source:'source/25/07/_3/page.xml',content:empty,badHash:true},
    {key:'d'.repeat(20),title:'同日另一篇日记',url:'source/25/07/12~dddddd/index.html',source:'source/25/07/12~dddddd/page.xml',content:empty},
  ];
  for(const p of pages){await fs.mkdir(path.dirname(path.join(root,p.source)),{recursive:true});await fs.writeFile(path.join(root,p.source),p.content);p.sourceHash=p.badHash?'invalid':crypto.createHash('sha256').update(p.content).digest('hex');p.images=[];p.attachments=[];}
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({pages,sections:[]}));
  const store=await new DiaryStore(root).init();
  assert.equal(store.removedGroups.length,1);assert.throws(()=>store.get('a'.repeat(20)),{status:404});
  assert.equal(store.get('b'.repeat(20)).title,'七月中旬');assert.equal(store.get('c'.repeat(20)).title,'七月下旬');
  assert.equal(store.get('d'.repeat(20)).date,'2025-07-12');
  assert.equal(await fs.readFile(path.join(root,pages[0].source),'utf8'),empty);
});
