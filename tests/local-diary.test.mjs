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
test('permanent deletion removes trashed entries with history and unreferenced media only', async t => {
  const root=await fixture(t), store=await new DiaryStore(root).init();
  const otherId='n-abcdefabcdefabcdefabcdef';
  let e=await store.save(id,input());
  const bytes=await sharp({create:{width:4,height:4,channels:3,background:'#3a7b5e'}}).png().toBuffer();
  const image=await store.upload(id,bytes);
  e=await store.save(id,{...e,deleted:true,blocks:[...e.blocks,{id:'image-one',type:'image',file:image.file,caption:''}]});
  assert.equal(e.deleted,true);assert.ok(e.deletedAt,'trashing records a deletion timestamp');
  let other=await store.save(otherId,input());
  other=await store.save(otherId,{...other,blocks:[...other.blocks,{id:'image-two',type:'image',file:image.file,caption:'shared'}]});
  // Same date folder, so the shared image must survive the first purge.
  const first=await store.purge(id);
  assert.equal(first.purged,id);
  assert.equal(store.entries.has(id),false);
  await fs.access(path.join(root,'source/26/10/17',image.file));
  // Purging a diary that is not in the trash is refused.
  await assert.rejects(store.purge(otherId),{status:400});
  await assert.rejects(store.purge(legacyId),{status:400});
  other=await store.save(otherId,{...other,deleted:true});
  const second=await store.purge(otherId);
  assert.equal(second.purged,otherId);
  await assert.rejects(fs.access(path.join(root,'source/26/10/17',image.file)));
  await assert.rejects(fs.access(path.join(root,'source/26/10/17',`entry-${id}.json`)));
  await assert.rejects(fs.access(path.join(root,'source/26/10/17/_history',id)));
  // Restarting cannot resurrect purged entries, and saving them again is refused.
  const reopened=await new DiaryStore(root).init();
  assert.equal(reopened.entries.has(id),false);
  assert.equal(reopened.entries.has(otherId),false);
  assert.equal(reopened.get(legacyId).title,'Fixture original');
  await assert.rejects(reopened.save(id,input()),{status:404});
});
test('restoring clears the deletion clock and expired trash is purged after 30 days', async t => {
  const root=await fixture(t), store=await new DiaryStore(root).init();
  let e=await store.save(id,input());
  e=await store.save(id,{...e,deleted:true});
  assert.ok(e.deletedAt);
  e=await store.save(id,{...e,deleted:false});
  assert.equal(e.deleted,false);assert.equal(e.deletedAt,null);
  e=await store.save(id,{...e,deleted:true});
  // Entries trashed before timestamps existed count from their last update.
  const file=path.join(root,'source/26/10/17',`entry-${id}.json`);
  const disk=JSON.parse(await fs.readFile(file,'utf8'));
  delete disk.deletedAt;disk.updated=new Date(Date.now()-31*86_400_000).toISOString();
  await fs.writeFile(file,JSON.stringify(disk));
  const freshId='n-fedcbafedcbafedcbafedcba';
  const fresh=await store.save(freshId,{...input(),date:'2026-10-17'});
  await store.save(freshId,{...fresh,deleted:true});
  const reopened=await new DiaryStore(root).init();
  assert.equal(reopened.get(id).deleted,true);
  assert.ok(Date.parse(reopened.get(id).deletedAt)<=Date.now()-30*86_400_000,'missing timestamps are backfilled from the last update');
  assert.equal(await reopened.purgeExpired(),1);
  assert.equal(reopened.entries.has(id),false);
  assert.equal(reopened.get(freshId).deleted,true,'recently trashed entries survive the sweep');
  assert.equal(await reopened.purgeExpired(),0);
});
test('HTTP permanent delete requires the write token and only removes trashed entries', async t => {
  const root=await fixture(t), app=await createDiaryServer({root});t.after(()=>app.close());
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();
  const token={method:'DELETE',headers:{'X-Diary-Token':boot.token}};
  const put=body=>fetch(app.url+'/api/entries/'+id,{method:'PUT',headers:{'X-Diary-Token':boot.token},body:JSON.stringify(body)});
  assert.equal((await fetch(app.url+'/api/entries/'+id,{method:'DELETE'})).status,403);
  let e=await (await put(input())).json();
  assert.equal((await fetch(app.url+'/api/entries/'+id,token)).status,400);
  e=await (await put({...e,deleted:true})).json();
  const purge=await fetch(app.url+'/api/entries/'+id,token);
  assert.equal(purge.status,200);assert.equal((await purge.json()).purged,id);
  const after=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(after.entries.find(x=>x.id===id),undefined);
  assert.equal((await fetch(app.url+'/api/entries/'+id,token)).status,404);
  const emptied=await fetch(app.url+'/api/trash',token);
  assert.equal(emptied.status,200);assert.equal((await emptied.json()).purged,0);
  assert.equal((await fetch(app.url+'/api/trash',{method:'DELETE'})).status,403);
});
test('the server purges expired trash when it starts', async t => {
  const root=await fixture(t);
  const store=await new DiaryStore(root).init();
  const e=await store.save(id,input());
  await store.save(id,{...e,deleted:true});
  const file=path.join(root,'source/26/10/17',`entry-${id}.json`);
  const disk=JSON.parse(await fs.readFile(file,'utf8'));
  disk.deletedAt=new Date(Date.now()-31*86_400_000).toISOString();
  await fs.writeFile(file,JSON.stringify(disk));
  const app=await createDiaryServer({root});t.after(()=>app.close());
  const boot=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(boot.entries.find(x=>x.id===id),undefined,'expired trash is purged on startup');
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
