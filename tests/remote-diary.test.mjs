import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { remoteAccess, requestAccess } from '../local-diary/access.mjs';
import { createDiaryServer } from '../local-diary/server.mjs';

const config={origin:'https://diary.fixture.ts.net',login:'owner@example.invalid'};
const headers={Host:'diary.fixture.ts.net','X-Forwarded-Host':'diary.fixture.ts.net','X-Forwarded-Proto':'https','Tailscale-User-Login':config.login};
test('remote access fails closed without an exact HTTPS tailnet origin and owner identity',()=>{
  const remote=remoteAccess(config);
  const req=(changes={})=>({socket:{remoteAddress:'127.0.0.1'},headers:{...Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v])),...changes}});
  assert.equal(requestAccess(req(),8766,remote).origin,config.origin);
  for(const change of [
    {'tailscale-user-login':'other@example.invalid'}, {'tailscale-user-login':undefined},
    {'tailscale-funnel-request':'?1'}, {'x-forwarded-proto':'http'},
    {'x-forwarded-host':'evil.invalid'}, {host:'evil.invalid'},
  ])assert.throws(()=>requestAccess(req(change),8766,remote),{status:403});
  assert.throws(()=>requestAccess(req(),8766,null),{status:403});
  const network=req();network.socket.remoteAddress='100.64.1.2';assert.throws(()=>requestAccess(network,8766,remote),{status:403});
  assert.equal(requestAccess({socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:8766'}},8766,remote).remote,false);
  for(const origin of ['http://diary.fixture.ts.net','https://evil.invalid','https://diary.fixture.ts.net/path','https://u:p@diary.fixture.ts.net'])assert.throws(()=>remoteAccess({...config,origin}));
  assert.equal(remoteAccess({enabled:false}),null);
});

test('private proxy protects every resource; two devices save through one store with version conflicts',async t=>{
  await fs.mkdir('qa-output/remote-tests',{recursive:true});
  const root=path.resolve(await fs.mkdtemp('qa-output/remote-tests/run-'));
  const app=await createDiaryServer({root,remote:config});t.after(()=>app.close());
  const request=(suffix,options={})=>fetch(app.url+suffix,{...options,headers:{...headers,...options.headers}});
  const boot=await(await request('/api/bootstrap')).json();assert.equal(typeof boot.changeVersion,'string');
  for(const resource of ['/','/app.js','/api/bootstrap','/api/changes','/archive/private.txt']) {
    assert.equal((await request(resource,{headers:{'Tailscale-User-Login':'stranger@example.invalid'}})).status,403);
    assert.equal((await request(resource,{headers:{'Tailscale-User-Login':'','Tailscale-Funnel-Request':'?1'}})).status,403);
  }
  const id='n-1234567890abcdef12345678',payload={revision:0,title:'Remote fixture',date:'2026-10-18',blocks:[{id:'text-one',type:'text',html:'<p>From phone</p>'}]};
  const writeHeaders={'X-Diary-Token':boot.token,Origin:config.origin,'Content-Type':'application/json'};
  assert.equal((await request('/api/entries/'+id,{method:'PUT',headers:{...writeHeaders,Origin:'https://evil.invalid'},body:JSON.stringify(payload)})).status,403);
  let response=await request('/api/entries/'+id,{method:'PUT',headers:writeHeaders,body:JSON.stringify(payload)});assert.equal(response.status,200);
  let saved=await response.json();assert.equal(saved.revision,1);
  assert.notEqual((await(await request('/api/changes')).json()).changeVersion,boot.changeVersion);
  const disk=JSON.parse(await fs.readFile(path.join(root,saved.folder,`entry-${id}.json`),'utf8'));assert.equal(disk.blocks[0].html,'<p>From phone</p>');
  const localBoot=await(await fetch(app.url+'/api/bootstrap')).json();
  response=await fetch(app.url+'/api/entries/'+id,{method:'PUT',headers:{'X-Diary-Token':localBoot.token},body:JSON.stringify({...saved,title:'From desktop'})});assert.equal(response.status,200);
  assert.equal((await request('/api/entries/'+id,{method:'PUT',headers:writeHeaders,body:JSON.stringify({...saved,title:'Stale phone'})})).status,409);
  saved=await(await request('/api/entries/'+id)).json();assert.equal(saved.title,'From desktop');
  const beforeRestore=(await(await request('/api/changes')).json()).changeVersion;
  response=await request('/api/entries/'+id+'/restore',{method:'POST',headers:writeHeaders,body:JSON.stringify({revision:saved.revision,restoreRevision:1})});assert.equal(response.status,200);
  assert.notEqual((await(await request('/api/changes')).json()).changeVersion,beforeRestore);
  await fs.writeFile(path.join(root,'private.txt'),'private fixture');
  assert.equal((await request('/archive/private.txt')).headers.get('cache-control'),'no-store');
});
