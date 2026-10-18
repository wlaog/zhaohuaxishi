import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createDiaryServer } from '../local-diary/server.mjs';

const output=path.resolve('qa-output/daily-browser');await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'fixture-'));
const app=await createDiaryServer({root});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={checks:[],errors:[]},check=name=>{report.checks.push(name);console.log('PASS '+name);};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  const today=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  const main='n-111111111111111111111111',extra='n-222222222222222222222222',old='n-333333333333333333333333',trash='n-444444444444444444444444';
  for(const [id,date,title,deleted] of [[main,today,'当天主记录',false],[extra,today,'当天独立记录',false],[old,'2020-01-02','过去的记录',false],[trash,'2020-01-03','回收站记录',true]]){
    await app.store.save(id,{revision:0,date,title,deleted,blocks:[{id:'text',type:'text',html:`<p>${title}正文</p>`}]});
  }
  await page.goto(app.url);await page.locator('.memo-card').first().waitFor();
  const close=async()=>{await page.locator('#save-entry').click();await page.locator('#editor-dialog').waitFor({state:'hidden'});};
  const selected=async date=>{
    await page.locator('#calendar-year').selectOption(date.slice(0,4));await page.locator('#calendar-month').selectOption(String(Number(date.slice(5,7))));await page.locator(`[data-date="${date}"]`).click();
  };
  await page.locator('.new-entry').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+main);
  await page.locator('.text-editor').fill('继续写入当天主记录');await close();
  assert.equal(app.store.list().length,4);assert.match(app.store.get(extra).blocks[0].html,/独立记录正文/);
  await page.locator('#quick-write').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+main);await close();
  await page.locator('[data-create="html"]').click();await page.locator('.html-source').waitFor();await close();assert.equal(app.store.list().length,4);assert.equal(app.store.get(main).blocks.length,2);
  check('today and quick text/HTML entries reuse one existing record and preserve same-day independent entries');
  await selected('2020-01-02');await page.locator('#quick-write').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+old);await close();
  await selected('2020-01-04');await page.locator('#quick-write').click();await page.locator('.text-editor').fill('这一天的第一篇');await close();
  const day=app.store.list().filter(e=>e.date==='2020-01-04'&&!e.deleted);assert.equal(day.length,1);
  await page.locator('[data-action="daily"]').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+day[0].id);await close();
  check('selected historical days continue an existing record or create one when missing');
  await page.locator('.independent-entry').click();await page.locator('#entry-title').fill('另建专题');await page.locator('.text-editor').fill('独立记录');await close();
  assert.equal(app.store.list().filter(e=>e.date==='2020-01-04'&&!e.deleted).length,2);
  await page.locator('#quick-write').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+day[0].id);await close();
  await page.locator('.new-entry').click();await page.locator('.text-editor').waitFor();assert.equal(new URL(page.url()).hash,'#entry='+main);await close();
  check('explicit independent records remain possible; write today ignores a historical date filter');
  await selected('2020-01-03');await page.locator('#quick-write').click();await page.locator('.text-editor').fill('新的正常记录');await close();
  assert.equal(app.store.get(trash).deleted,true);assert.equal(app.store.list().filter(e=>e.date==='2020-01-03'&&!e.deleted).length,1);
  await page.screenshot({path:path.join(output,'daily-entry.png'),fullPage:false});
  check('a trashed diary is preserved and does not become the daily writing destination');
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.errors.push(error.stack);process.exitCode=1;}
finally{await browser.close();await app.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
