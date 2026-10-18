import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import { DiaryStore, sanitizeText, validDate } from '../local-diary/store.mjs';
import { createDiaryServer } from '../local-diary/server.mjs';

const id = 'n-1234567890abcdef12345678';
const legacyId = '1234567890abcdef1234';
async function fixture(t) {
  await fs.mkdir('qa-output/diary-tests', { recursive: true });
  const root = path.resolve(await fs.mkdtemp('qa-output/diary-tests/run-'));
  await fs.mkdir(path.join(root, 'source/26/03/31'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ pages: [{ key: legacyId, title: 'Fixture original', url: 'source/26/03/31/index.html', created: '2026-03-31T00:00:00Z', modified: '2026-03-31T00:00:00Z', images: [], attachments: [] }], sections: [] }));
  await fs.writeFile(path.join(root, 'assets/catalog.js'), `window.NOTEBOOK=${JSON.stringify({ pages: [{ key: legacyId, search: 'Fixture original with text' }] })};`);
  await fs.writeFile(path.join(root, 'source/26/03/31/index.html'), '<html><body><p style="color:red">Original</p><script>window.BAD=true</script></body></html>');
  return root;
}
const input = (revision = 0) => ({ title: 'Fixture diary', date: '2026-10-17', revision, tags: ['test'], pinned: false, deleted: false, blocks: [{ id: 'text-one', type: 'text', html: '<p>First draft <strong>bold</strong></p>' }] });

test('valid calendar dates reject rollover, malformed and impossible dates', () => {
  for (const value of ['2026-02-29','2026-13-01','2026-00-01','2026-04-31','2026-1-01','../file']) assert.equal(validDate(value), false, value);
  assert.equal(validDate('2024-02-29'), true);
});
test('text blocks retain formatting and remove active or remote content', () => {
  const sanitized = sanitizeText('<p onclick="fetch(1)"><b>B</b><img src="https://x/a" onerror="alert(1)"><script>x</script><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a><iframe src="/api/bootstrap"></iframe></p>');
  assert.match(sanitized, /<b>B<\/b>/);
  assert.doesNotMatch(sanitized, /onclick|img|script|iframe/);
  assert.match(sanitized, /rel="noopener noreferrer"/);
});
test('file-backed entries, HTML source, originals, revisions and recovery survive restart', async t => {
  const root=await fixture(t), store=await new DiaryStore(root).init();
  assert.equal(store.entries.size, 1);
  const original=await fs.readFile(path.join(root,'source/26/03/31/index.html'));
  let e=await store.save(id, input());
  assert.equal(e.folder,'source/26/10/17');assert.equal(e.revision,1);
  const bytes=await sharp({create:{width:40,height:30,channels:4,background:'#346450'}}).png().toBuffer();
  const image=await store.upload(id,bytes);
  assert.deepEqual(await fs.readFile(path.join(root,e.folder,image.file)),bytes);
  const html='<section style="display:grid;gap:2px"><h2>Custom HTML</h2></section>';
  e=await store.save(id,{...e,blocks:[...e.blocks,{id:'html-one',type:'html',html},{id:'image-one',type:'image',file:image.file,caption:'original'}]});
  assert.equal(e.imageCount,1);
  await assert.rejects(store.save(id,input(1)),{status:409});
  e=await store.save(id,{...e,title:'Changed',deleted:true});
  assert.equal(e.deleted,true);
  let reopened=await new DiaryStore(root).init();
  assert.equal(reopened.get(id).blocks[1].html,html);
  assert.equal(reopened.list().find(e=>e.id===id).media[0],image.file);
  e=await reopened.restore(id,1,e.revision);
  assert.equal(e.title,'Fixture diary');assert.equal(e.deleted,false);assert.equal(e.blocks.length,1);assert.equal(e.revision,4);
  assert.equal((await reopened.history(id)).length,3);
  assert.deepEqual(await fs.readFile(path.join(root,'source/26/03/31/index.html')),original);
  const legacy=reopened.get(legacyId);
  const edit=await reopened.save(legacyId,{...legacy,title:'Edited old title',blocks:[...legacy.blocks,{id:'added',type:'text',html:'<p>Added after original</p>'}]});
  assert.equal(edit.blocks[0].pageKey,legacyId);
  assert.deepEqual(await fs.readFile(path.join(root,'source/26/03/31/index.html')),original);
  const restore=await reopened.restore(legacyId,0,edit.revision);
  assert.equal(restore.title,legacy.title);assert.equal(restore.blocks.length,1);
});
test('parallel writers serialize and preserve a conflict instead of losing data', async t => {
  const store=await new DiaryStore(await fixture(t)).init();
  await store.save(id,input());
  const results=await Promise.allSettled([store.save(id,{...input(1),title:'A'}),store.save(id,{...input(1),title:'B'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(store.get(id).title,'A');assert.equal((await store.history(id)).length,1);
});
test('save validation protects date folders, image references and original references', async t => {
  const store=await new DiaryStore(await fixture(t)).init();
  await assert.rejects(store.save('../secret',input()),{status:400});
  await assert.rejects(store.save(id,{...input(),date:'2026-13-01'}),{status:400});
  await assert.rejects(store.save(id,{...input(),blocks:[{id:'x',type:'archive',pageKey:legacyId}]}),{status:400});
  await assert.rejects(store.save(id,{...input(),blocks:[{id:'x',type:'image',file:'../private.png'}]}),{status:400});
  await assert.rejects(store.save(id,{...input(),blocks:[{id:'x',type:'image',file:`media-${'a'.repeat(64)}.png`}]}),{status:400});
  await store.save(id,input());
  await assert.rejects(store.save(id,{...input(1),date:'2026-10-18'}),{status:400});
  await assert.rejects(store.upload(id,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')),{status:400});
});
test('HTTP requires local host, same origin and write token; archived scripts never execute', async t => {
  const root=await fixture(t), app=await createDiaryServer({root});t.after(()=>app.close());
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();assert.equal(boot.entries.length,1);
  const request=(suffix,options)=>fetch(app.url+suffix,options);
  assert.equal((await request('/api/entries/'+id,{method:'PUT',body:JSON.stringify(input())})).status,403);
  assert.equal((await request('/api/entries/'+id,{method:'PUT',headers:{'X-Diary-Token':boot.token,Origin:'https://evil.invalid'},body:JSON.stringify(input())})).status,403);
  const wrongHost = await new Promise((resolve,reject)=>{const req=http.get(app.url+'/api/bootstrap',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(wrongHost,403);
  assert.equal((await request('/api/entries/'+id,{method:'PUT',headers:{'X-Diary-Token':boot.token},body:JSON.stringify(input())})).status,200);
  const page=await request('/archive/source/26/03/31/index.html');
  assert.match(page.headers.get('content-security-policy'),/sandbox allow-same-origin/);
  const html=await page.text();assert.doesNotMatch(html,/<script/);assert.match(html,/style="color:red"/);
  assert.match(await fs.readFile(path.join(root,'source/26/03/31/index.html'),'utf8'),/<script/);
  assert.equal((await request('/archive/%2e%2e%2flocal-diary/server.mjs')).status,403);
  assert.equal((await request('/archive/no-such-file')).status,404);
  const image=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
  const uploaded=await (await request(`/api/entries/${id}/images`,{method:'POST',headers:{'X-Diary-Token':boot.token},body:image})).json();
  const downloaded=Buffer.from(await (await request(uploaded.url)).arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'),crypto.createHash('sha256').update(image).digest('hex'));
});
