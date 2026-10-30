import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createDiaryServer } from '../local-diary/server.mjs';
import { makeSakuraConfig, sakuraAccess, createSakuraAuth } from '../local-diary/sakura-auth.mjs';

const origin = 'https://diary.example.invalid:23456', password = 'fixture-日记-password-2026';
const record = await makeSakuraConfig({ origin, port:8767, password });
const freePort = async () => {
  const listener = net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;
};
function request(port, suffix, { headers={}, method='GET', body }={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:suffix,method,headers:{Host:new URL(origin).host,'X-Forwarded-Proto':'https',...headers}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(parts).toString()}));
    });req.on('error',reject);req.end(body);
  });
}
const login = (port, value=password, headers={}) => request(port,'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify({password:value})});

test('Sakura config requires HTTPS, a separate valid port and a password hash',async()=>{
  assert.equal(record.origin,origin);assert.equal(record.password.hash.includes(password),false);
  assert.equal(sakuraAccess({enabled:false}),null);
  for(const value of [0,65536,1.5,'8767',true])assert.throws(()=>sakuraAccess({...record,port:value}));
  for(const value of ['http://diary.example.invalid','https://u:p@diary.example.invalid','https://diary.example.invalid/path','https://diary.example.invalid?q=x'])assert.throws(()=>sakuraAccess({...record,origin:value}));
  await assert.rejects(makeSakuraConfig({origin,port:8767,password:'short'}));
  await assert.rejects(makeSakuraConfig({origin,port:8767,password:''}));
  assert.deepEqual((await makeSakuraConfig({origin,port:8768,password:''},record)).password,record.password);
  for(const additionalOrigins of ['https://backup.example.invalid',["http://backup.example.invalid"],['https://backup.example.invalid/path'],Array(5).fill('https://backup.example.invalid')])assert.throws(()=>sakuraAccess({...record,additionalOrigins}));
  const backup='https://backup.example.invalid:34567';
  const migrated=await makeSakuraConfig({origin,port:8768,password:''},{...record,additionalOrigins:[backup]});
  assert.deepEqual(migrated.additionalOrigins,[backup]);assert.deepEqual(migrated.password,record.password);
});

test('explicit backup origins share the same diary and password while enforcing each request origin',async t=>{
  const base=path.resolve('qa-output/sakura-tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'backup-')),port=await freePort();
  const backup='https://backup.example.invalid:34567',Host=new URL(backup).host;
  const app=await createDiaryServer({root,sakura:{...record,port,additionalOrigins:[backup]}});t.after(()=>app.close());
  assert.equal((await request(port,'/login',{headers:{Host}})).status,200);
  assert.equal((await request(port,'/api/bootstrap',{headers:{Host}})).status,401);
  assert.equal((await request(port,'/api/bootstrap',{headers:{Host:'unknown.example.invalid','X-Forwarded-Host':Host}})).status,403);
  assert.equal((await login(port,password,{Host,Origin:origin})).status,403);
  const response=await login(port,password,{Host,Origin:backup});assert.equal(response.status,200);
  const Cookie=response.headers['set-cookie'][0].split(';')[0];
  const boot=JSON.parse((await request(port,'/api/bootstrap',{headers:{Host,Cookie}})).text);
  const id='n-abcdef1234567890abcdef12',entry={revision:0,title:'Backup fixture',date:'2026-10-30',blocks:[{id:'one',type:'text',html:'<p>Shared from backup</p>'}]};
  const headers={Host,Cookie,Origin:backup,'Content-Type':'application/json','X-Diary-Token':boot.token};
  assert.equal((await request(port,'/api/entries/'+id,{method:'PUT',headers:{...headers,Origin:origin},body:JSON.stringify(entry)})).status,403);
  assert.equal((await request(port,'/api/entries/'+id,{method:'PUT',headers,body:JSON.stringify(entry)})).status,200);
  assert.equal((await(await fetch(app.url+'/api/entries/'+id)).json()).title,entry.title);
  const mainLogin=await login(port);assert.equal(mainLogin.status,200);
  const mainCookie=mainLogin.headers['set-cookie'][0].split(';')[0];
  assert.equal(JSON.parse((await request(port,'/api/entries/'+id,{headers:{Cookie:mainCookie}})).text).title,entry.title);
});

test('public listener protects all resources, isolates loopback trust, shares saves, and revokes sessions',async t=>{
  const base=path.resolve('qa-output/sakura-tests');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'run-'));
  await fs.writeFile(path.join(root,'private.txt'),'private fixture');
  const port=await freePort();const app=await createDiaryServer({root,sakura:{...record,port},remote:{origin:'https://diary.fixture.ts.net',login:'owner@example.invalid'}});t.after(()=>app.close());
  for(const suffix of ['/api/bootstrap','/api/health','/api/changes','/archive/private.txt','/app.js','/index.html','/api/entries/n-1234567890abcdef12345678/history'])assert.equal((await request(port,suffix)).status,401,suffix);
  assert.equal((await request(port,'/')).headers.location,'/login');
  const navigation={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
  assert.equal((await request(port,'/',{headers:navigation})).headers.location,'/login');
  assert.equal((await request(port,'/login',{headers:navigation})).status,200);
  assert.equal((await request(port,'/api/bootstrap',{headers:navigation})).status,403);
  assert.match((await request(port,'/login')).text,/访问密码/);
  for(const suffix of ['/auth/login.js','/auth/style.css'])assert.equal((await request(port,suffix)).status,200);
  for(const headers of [{Host:`127.0.0.1:${port}`},{'X-Forwarded-Proto':'http'},{'X-Forwarded-Proto':''},{'Tailscale-User-Login':'owner@example.invalid'}])assert.equal((await request(port,'/api/bootstrap',{headers})).status,403);
  assert.equal((await login(port,password,{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await login(port,password,{Origin:''})).status,403);
  assert.equal((await login(port,'wrong-password')).status,401);
  const loggedIn=await login(port);assert.equal(loggedIn.status,200);
  const setCookie=loggedIn.headers['set-cookie'][0];assert.match(setCookie,/Secure; SameSite=Strict/);assert.match(setCookie,/HttpOnly/);
  const Cookie=setCookie.split(';')[0];
  assert.equal((await request(port,'/api/bootstrap',{headers:{Cookie:Cookie+'a'}})).status,401);
  assert.equal((await request(port,'/api/bootstrap',{headers:{Cookie:`${Cookie}; ${Cookie}`}})).status,401);
  const boot=JSON.parse((await request(port,'/api/bootstrap',{headers:{Cookie}})).text);assert.equal(boot.remoteSession,true);
  const id='n-1234567890abcdef12345678';
  const entry={revision:0,title:'Phone fixture',date:'2026-10-19',blocks:[{id:'one',type:'text',html:'<p>Phone text</p>'}]};
  const headers={Cookie,Origin:origin,'Content-Type':'application/json','X-Diary-Token':boot.token};
  assert.equal((await request(port,'/api/entries/'+id,{method:'PUT',headers:{...headers,'X-Diary-Token':''},body:JSON.stringify(entry)})).status,403);
  const saved=await request(port,'/api/entries/'+id,{method:'PUT',headers,body:JSON.stringify(entry)});assert.equal(saved.status,200);
  const local=await(await fetch(app.url+'/api/entries/'+id)).json();assert.equal(local.title,entry.title);
  assert.equal((await request(port,'/api/entries/'+id,{method:'PUT',headers,body:JSON.stringify(entry)})).status,409);
  assert.equal((await request(port,'/archive/private.txt',{headers:{Cookie}})).text,'private fixture');
  const health=await(await fetch(app.url+'/api/health')).json();assert.equal(health.sakuraPort,port);assert.equal(health.remoteOrigin,'https://diary.fixture.ts.net');
  const tailHeaders={Host:'diary.fixture.ts.net','X-Forwarded-Host':'diary.fixture.ts.net','X-Forwarded-Proto':'https','Tailscale-User-Login':'owner@example.invalid'};
  assert.equal((await fetch(app.url+'/api/bootstrap',{headers:tailHeaders})).status,200);
  assert.equal((await request(port,'/auth/logout',{method:'POST',headers:{Cookie,Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await request(port,'/auth/logout',{method:'POST',headers:{Cookie,Origin:origin}})).status,200);
  assert.equal((await request(port,'/archive/private.txt',{headers:{Cookie}})).status,401);
  assert.equal((await fetch(app.url+'/api/bootstrap')).status,200);
  const secondCookie=(await login(port)).headers['set-cookie'][0].split(';')[0];
  await app.close();
  const restarted=await createDiaryServer({root,sakura:{...record,port}});t.after(()=>restarted.close());
  assert.equal((await request(port,'/api/bootstrap',{headers:{Cookie:secondCookie}})).status,401);
  assert.equal((await(await fetch(restarted.url+'/api/entries/'+id)).json()).revision,1);
});

test('login attempts are limited globally without trusting spoofed IP headers; sessions expire',async()=>{
  let time=0;const auth=createSakuraAuth(record,()=>time);const headers={};const res={setHeader:(name,value)=>headers[name]=value};
  for(let i=0;i<5;i++)await assert.rejects(auth.login('wrong',res),{status:401});
  await assert.rejects(auth.login(password,res),{status:429});
  time+=15*60*1000+1;await auth.login(password,res);
  const req={headers:{cookie:headers['Set-Cookie'].split(';')[0]}};assert.equal(auth.authenticated(req),true);
  time+=30*24*60*60*1000;assert.equal(auth.authenticated(req),false);
});

test('occupied Sakura port rolls back listener startup instead of leaving an unsecured partial service',async()=>{
  const blocker=net.createServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
  const port=blocker.address().port;
  try{await assert.rejects(createDiaryServer({root:path.resolve('qa-output/sakura-tests/occupied'),sakura:{...record,port}}),{code:'EADDRINUSE'});}finally{await new Promise(resolve=>blocker.close(resolve));}
});
