import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createDiaryServer } from '../local-diary/server.mjs';

function request(url, { encoding='identity', method='GET', headers={}, body }={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method,headers:{'Accept-Encoding':encoding,...headers}},res=>{
      const chunks=[];res.on('data',value=>chunks.push(value));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end(body);
  });
}
const decode = response => response.headers['content-encoding']==='br' ? brotliDecompressSync(response.body) : response.headers['content-encoding']==='gzip' ? gunzipSync(response.body) : response.body;

test('compressed bootstrap round-trips UTF-8, negotiates encodings and refreshes after a save',async t=>{
  const base=path.resolve('qa-output/compression-tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'run-'));const app=await createDiaryServer({root});t.after(()=>app.close());
  const id='n-1234567890abcdef12345678';
  await app.store.save(id,{revision:0,title:'压缩测试',date:'2026-10-30',blocks:[{id:'one',type:'text',html:'<p>'+('一段包含中文和 emoji 🌸 的日记正文。'.repeat(300))+'</p>'}]});
  const raw=await request(app.url+'/api/bootstrap');assert.equal(raw.headers['content-encoding'],undefined);
  assert.equal(Number(raw.headers['content-length']),raw.body.length);
  const boot=JSON.parse(raw.body);
  for(const [encoding,expected] of [['gzip','gzip'],['br, gzip','br'],['br;q=0, gzip;q=1','gzip'],['br;q=1, gzip;q=0','br'],['br;q=0, gzip;q=0',undefined]]){
    const response=await request(app.url+'/api/bootstrap',{encoding});assert.equal(response.status,200);
    assert.equal(response.headers['content-encoding'],expected);assert.deepEqual(decode(response),raw.body);
    assert.equal(Number(response.headers['content-length']),response.body.length);
    assert.match(response.headers.vary,/Accept-Encoding/);assert.equal(response.headers['cache-control'],'no-store');
    if(expected)assert.ok(response.body.length<raw.body.length/2);
  }
  const entry=app.store.get(id);
  const saved=await request(app.url+'/api/entries/'+id,{method:'PUT',encoding:'br',headers:{'X-Diary-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify({...entry,title:'修改后刷新压缩响应'})});
  assert.equal(saved.status,200);assert.equal(JSON.parse(decode(saved)).revision,2);
  const refreshed=JSON.parse(decode(await request(app.url+'/api/bootstrap',{encoding:'gzip'})));
  assert.equal(refreshed.entries[0].title,'修改后刷新压缩响应');assert.notEqual(refreshed.changeVersion,boot.changeVersion);
});

test('static and sanitized archive text compress; HEAD and binary assets retain their semantics',async t=>{
  const base=path.resolve('qa-output/compression-tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'files-'));const app=await createDiaryServer({root});t.after(()=>app.close());
  await fs.writeFile(path.join(root,'fixture.html'),'<html><body>'+('safe archive '.repeat(300))+'<script>unsafe()</script></body></html>');
  const binary=Buffer.alloc(4096,17);await fs.writeFile(path.join(root,'fixture.png'),binary);
  for(const suffix of ['/app.js','/style.css','/archive/fixture.html']){
    const raw=await request(app.url+suffix);const compressed=await request(app.url+suffix,{encoding:'br'});
    assert.equal(compressed.status,200);assert.equal(compressed.headers['content-encoding'],'br');assert.deepEqual(decode(compressed),raw.body);
    assert.equal(compressed.headers['content-security-policy'],raw.headers['content-security-policy']);
    if(suffix.includes('archive'))assert.doesNotMatch(decode(compressed).toString(),/<script/);
    const head=await request(app.url+suffix,{encoding:'br',method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-encoding'],'br');
  }
  const image=await request(app.url+'/archive/fixture.png',{encoding:'br,gzip'});
  assert.equal(image.headers['content-encoding'],undefined);assert.deepEqual(image.body,binary);assert.equal(Number(image.headers['content-length']),binary.length);
  const small=await request(app.url+'/api/changes',{encoding:'br,gzip'});assert.equal(small.headers['content-encoding'],undefined);
  const denied=await request(app.url+'/api/bootstrap',{encoding:'br,gzip',headers:{Host:'evil.invalid'}});assert.equal(denied.status,403);
});
