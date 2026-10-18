import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DayStore} from '../local-diary/days.mjs';
import {createDiaryServer} from '../local-diary/server.mjs';
import {memoriesOn,MOODS,WEATHERS,dayIcon} from '../local-diary/public/day-model.js';

async function fixture(){const base=path.resolve('qa-output/day-tests');await fs.mkdir(base,{recursive:true});return fs.mkdtemp(path.join(base,'run-'));}
test('daily choices remain optional, retain multiple values and history across restart without editing diary bytes',async()=>{
  const root=await fixture(),store=await new DayStore(root).init();
  assert.deepEqual(store.list(),[]);assert.deepEqual(await store.get('2024-02-29'),{date:'2024-02-29',revision:0,moods:[],weather:[]});
  await assert.rejects(fs.stat(path.join(root,'source')),{code:'ENOENT'});
  const folder=path.join(root,'source/24/02/29');await fs.mkdir(folder,{recursive:true});
  const original=Buffer.from('<p>Fixture original</p>');await fs.writeFile(path.join(folder,'index.html'),original);
  const first=await store.save('2024-02-29',{revision:0,moods:['happy','sad','happy'],weather:['sunny','rainy']});
  assert.deepEqual(first.moods,['happy','sad']);assert.deepEqual(first.weather,['sunny','rainy']);
  const reopened=await new DayStore(root).init();assert.deepEqual(await reopened.get('2024-02-29'),first);
  await reopened.save('2024-02-29',{revision:1,moods:[],weather:[]});
  assert.deepEqual((await reopened.get('2024-02-29')).moods,[]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder,'_history/day/00000001.json'),'utf8')),first);
  assert.deepEqual(await fs.readFile(path.join(folder,'index.html')),original);
});
test('daily validation and concurrent revisions reject unsafe dates, unknown choices and silent overwrites',async()=>{
  const store=await new DayStore(await fixture()).init(),input={revision:0,moods:['calm'],weather:[]};
  for(const date of ['2023-02-29','../../bad','2024-13-01'])await assert.rejects(store.save(date,input),{status:400});
  for(const invalid of [null,{...input,revision:-1},{...input,revision:'0'},{...input,moods:['<script>']},{...input,weather:'sunny'},{...input,weather:['unknown']}])await assert.rejects(store.save('2024-01-01',invalid),{status:400});
  const results=await Promise.allSettled([store.save('2024-01-01',input),store.save('2024-01-01',{...input,moods:['sad']})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const other=await new DayStore(store.root).init();await other.save('2024-01-01',{revision:1,moods:['tired'],weather:['cloudy']});
  await assert.rejects(store.save('2024-01-01',{...input,revision:1}),{status:409});
  assert.deepEqual((await store.get('2024-01-01')).moods,['tired']);
});
test('daily HTTP API requires write credentials, publishes change versions and survives server restart',async()=>{
  const root=await fixture();let app=await createDiaryServer({root});
  try{
    const request=async(route,options)=>{const response=await fetch(app.url+route,options);return {status:response.status,data:await response.json()};};
    const boot=(await request('/api/bootstrap')).data;
    const input={revision:0,moods:['happy','anxious'],weather:['sunny','windy']};
    const options={method:'PUT',body:JSON.stringify(input),headers:{'Content-Type':'application/json'}};
    assert.equal((await request('/api/days/2024-02-29',options)).status,403);
    options.headers['X-Diary-Token']=boot.token;
    assert.equal((await request('/api/days/2024-02-29',{...options,headers:{...options.headers,Origin:'https://example.invalid'}})).status,403);
    const saved=await request('/api/days/2024-02-29',options);assert.equal(saved.status,200);
    const next=(await request('/api/bootstrap')).data;assert.notEqual(next.changeVersion,boot.changeVersion);assert.equal(next.entries.length,0);assert.equal(next.days.length,1);
    assert.equal((await request('/api/days/2024-02-29',options)).status,409);
    assert.equal((await request('/api/days/2023-02-29')).status,400);
    await app.close();app=await createDiaryServer({root});
    assert.deepEqual((await request('/api/days/2024-02-29')).data,saved.data);
  }finally{await app.close();}
});
test('memories retain every previous-year entry while excluding deleted, group, current and future records',()=>{
  const entries=[{id:'a',date:'2023-02-28'},{id:'b',date:'2024-02-28'},{id:'c',date:'2024-02-28'},{id:'d',date:'2025-02-28'},{id:'now',date:'2026-02-28'},{id:'future',date:'2027-02-28'},{id:'deleted',date:'2022-02-28',deleted:true},{id:'group',date:'2021-02-28',group:true},{id:'leap',date:'2024-02-29'}];
  assert.deepEqual(memoriesOn(entries,'02-28',2026).map(e=>e.id),['d','b','c','a']);
  assert.deepEqual(memoriesOn(entries,'02-29',2026).map(e=>e.id),['leap']);
  for(const [kind,items] of [['moods',MOODS],['weather',WEATHERS]])for(const item of items){assert.match(dayIcon(kind,item.id),/^<svg/);assert.doesNotMatch(dayIcon(kind,item.id),/https?:|<script|onload/);}
});
