import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createDiaryServer } from '../local-diary/server.mjs';
import { makeSakuraConfig } from '../local-diary/sakura-auth.mjs';

// Isolated HTTPS proxy models Sakura automatic HTTPS without an account or live tunnel.
const output=path.resolve('qa-output/sakura-browser');await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'fixture-'));
const key=path.join(root,'test-key.pem'),cert=path.join(root,'test-cert.pem');
let openssl=process.env.OPENSSL_PATH??'openssl';
if(!process.env.OPENSSL_PATH && process.platform==='win32'){
  try{
    const gitPath=execFileSync('git',['--exec-path'],{encoding:'utf8'}).trim();
    const bundled=path.resolve(gitPath,'../../../usr/bin/openssl.exe');
    if(existsSync(bundled))openssl=bundled;
  }catch{ /* Fall back to OpenSSL on PATH. */ }
}
execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=diary.example.invalid'],{stdio:'ignore'});
let app,browser;
const proxy=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
  const upstream=http.request({host:'127.0.0.1',port:app.sakuraServer.address().port,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const origin=`https://diary.example.invalid:${proxy.address().port}`,password='Browser-日记-fixture-2026';
const free=net.createServer();await new Promise(resolve=>free.listen(0,'127.0.0.1',resolve));
const port=free.address().port;await new Promise(resolve=>free.close(resolve));
const checks=[],errors=[],check=value=>{checks.push(value);console.log('PASS '+value);};
try{
  const sakura=await makeSakuraConfig({origin,port,password});
  app=await createDiaryServer({root,sakura});
  const id='n-1234567890abcdef12345678';
  await app.store.save(id,{revision:0,title:'手机登录测试',date:'2026-10-19',blocks:[{id:'one',type:'text',html:'<p>测试正文</p>'}]});
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP diary.example.invalid 127.0.0.1']});
  const desktop=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
  const pc=await desktop.newPage(),mobile=await phone.newPage();
  for(const page of [pc,mobile])page.on('pageerror',error=>errors.push(error.message));
  await pc.goto(origin);await pc.locator('#password').waitFor();await pc.screenshot({path:path.join(output,'login-desktop.png')});
  await mobile.goto(origin);await mobile.locator('#password').waitFor();
  assert.equal(await mobile.locator('body').evaluate(element=>element.scrollWidth<=innerWidth),true);
  await mobile.screenshot({path:path.join(output,'login-phone.png')});
  await mobile.locator('#password').fill('wrong-password');await mobile.getByRole('button',{name:'打开日记'}).click();
  await mobile.locator('#login-status').filter({hasText:'密码不正确'}).waitFor();
  await mobile.locator('#password').fill(password);await mobile.getByRole('button',{name:'打开日记'}).click();
  await mobile.locator('[data-open="'+id+'"]').first().waitFor();
  const cookies=await phone.cookies();const session=cookies.find(value=>value.name==='__Host-diary-session');
  assert.equal(session.secure,true);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Strict');
  check('desktop and mobile login, rejected password and secure session cookie');
  await mobile.locator('[data-open="'+id+'"]').first().click();await mobile.locator('.text-editor').waitFor();
  await mobile.locator('.text-editor').fill('从手机保存的日记正文');
  await mobile.locator('#save-status').filter({hasText:'已保存到电脑'}).waitFor();
  assert.match((await(await fetch(app.url+'/api/entries/'+id)).json()).blocks[0].html,/从手机保存/);
  await mobile.screenshot({path:path.join(output,'phone-editor.png')});
  check('phone autosave writes the same store served to the desktop');
  await mobile.evaluate(()=>fetch('/auth/logout',{method:'POST'}));
  await mobile.locator('.text-editor').fill('登录过期后仍保留的草稿');
  await mobile.locator('#auth-dialog').waitFor();
  assert.match(await mobile.locator('.text-editor').innerText(),/仍保留的草稿/);
  await mobile.screenshot({path:path.join(output,'phone-reauth.png')});
  await mobile.locator('#reauth-password').fill(password);await mobile.locator('#reauth-form').getByRole('button',{name:'继续记录'}).click();
  await mobile.locator('#auth-dialog').waitFor({state:'hidden'});
  await mobile.locator('#save-status').filter({hasText:'已保存到电脑'}).waitFor();
  assert.match((await(await fetch(app.url+'/api/entries/'+id)).json()).blocks[0].html,/仍保留的草稿/);
  check('expired session retains the draft and saves it after inline login');
  await mobile.locator('#close-editor').click();await mobile.locator('#editor-dialog').waitFor({state:'hidden'});
  await mobile.locator('#menu').click();await mobile.locator('#remote-logout').click();
  await mobile.locator('#password').waitFor();
  assert.equal(await mobile.evaluate(async()=> (await fetch('/api/bootstrap')).status),401);
  check('logout revokes access to diary resources');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>proxy.close(resolve));await app?.close();}
