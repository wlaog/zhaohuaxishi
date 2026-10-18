import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createDiaryServer } from '../local-diary/server.mjs';

const output=path.resolve('qa-output/petals-browser');await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'fixture-')),app=await createDiaryServer({root});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={checks:[],errors:[],httpErrors:[]},check=name=>{report.checks.push(name);console.log('PASS '+name);};
try {
  for(const [i,title,html] of [[1,'把今天的风，收进日记','<p>走过树下的时候，花落在了肩上。</p><p>晚一点再翻开，也能记得这一刻。</p>'],[2,'一杯热茶的时间','<p>读了几页书，听了一阵雨。平常的日子也有值得收藏的小事。</p>'],[3,'慢慢走，慢慢记','<p>给自己留一点空白，让想说的话慢慢长出来。</p>']]) {
    await app.store.save('n-'+String(i).repeat(24),{revision:0,date:`2026-10-${18-i}`,title,blocks:[{id:'text',type:'text',html}]});
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push(`${r.status()} ${r.url()}`);});
  await page.goto(app.url);await page.locator('.petal-track').first().waitFor({state:'attached'});await page.locator('.memo-card').first().waitFor();
  assert.equal(await page.title(),'朝花夕拾 · 本地日记');assert.match(await page.locator('.brand').innerText(),/朝花夕拾/);
  assert.doesNotMatch(await page.locator('body').innerText(),/LIFE/);
  assert.equal(await page.getByRole('switch',{name:'花瓣飘落'}).getAttribute('aria-checked'),'true');
  assert.equal(await page.locator('.petal-track').count(),14);
  const initial=await page.locator('.petal-track').first().evaluate(el=>el.getBoundingClientRect().y);
  await page.waitForFunction(y=>Math.abs(document.querySelector('.petal-track').getBoundingClientRect().y-y)>2,initial);
  assert.equal(await page.locator('#petals-layer').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  const properties=await page.locator('.petal-track').evaluateAll(els=>els.map(el=>({duration:parseFloat(getComputedStyle(el).animationDuration),opacity:Number(el.style.getPropertyValue('--petal-opacity'))})));
  assert(properties.every(p=>p.duration>=34&&p.duration<=58&&p.opacity>=.19&&p.opacity<=.32));
  await page.screenshot({path:path.join(output,'desktop-light.png'),fullPage:false});
  check('new branding, sparse slow translucent falling petals, and non-interactive overlay');

  await page.getByRole('switch',{name:'花瓣飘落'}).click();assert.equal(await page.locator('.petal-track').count(),0);
  assert.equal(await page.locator('#petals-layer').isVisible(),false);
  await page.reload();await page.locator('.memo-card').first().waitFor();assert.equal(await page.getByRole('switch',{name:'花瓣飘落'}).getAttribute('aria-checked'),'false');
  await page.getByRole('switch',{name:'花瓣飘落'}).focus();await page.keyboard.press('Space');await page.locator('.petal-track').first().waitFor({state:'attached'});
  const sibling=await context.newPage();await sibling.goto(app.url);await sibling.locator('.petal-track').first().waitFor({state:'attached'});
  await page.getByRole('switch',{name:'花瓣飘落'}).click();await sibling.waitForFunction(()=>document.querySelector('#petals-toggle').getAttribute('aria-checked')==='false');
  await sibling.close();await page.getByRole('switch',{name:'花瓣飘落'}).click();
  check('switch removes animations, supports keyboard, remembers choice and updates sibling tabs');

  await page.locator('.memo-title').first().click();await page.locator('.text-editor').fill('花瓣开启时仍能正常编辑与保存。');
  const downloading=page.waitForEvent('download');await page.locator('#download-entry').click();const download=await downloading;assert.match(download.suggestedFilename(),/^朝花夕拾-/);
  await page.locator('#save-entry').click();await page.locator('#editor-dialog').waitFor({state:'hidden'});assert.match(app.store.get('n-'+String(1).repeat(24)).blocks[0].html,/正常编辑/);
  check('editing and saving work with petals enabled; exported drafts use the new name');
  await page.locator('#theme').click();await page.screenshot({path:path.join(output,'desktop-dark.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelectorAll('.petal-track').length===8);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#menu').click();assert.equal(await page.locator('.brand').isVisible(),true);await page.locator('#shade').click();
  await page.screenshot({path:path.join(output,'mobile-dark.png'),fullPage:false});
  // Headless Chromium keeps every tab visible, so explicitly simulate the browser visibility signal.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.locator('#petals-layer').getAttribute('data-paused'),'true');
  assert.equal(await page.locator('#petals-layer').evaluate(el=>el.getAnimations({subtree:true}).every(a=>a.playState==='paused')),true);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.locator('#petals-layer').getAttribute('data-paused'),'false');
  check('dark/mobile layouts fit; mobile uses fewer petals and visibility signals pause/resume animations');

  const quiet=await browser.newContext({reducedMotion:'reduce'});const quietPage=await quiet.newPage();await quietPage.goto(app.url);await quietPage.locator('.memo-card').first().waitFor();
  assert.equal(await quietPage.getByRole('switch',{name:'花瓣飘落'}).getAttribute('aria-checked'),'false');assert.equal(await quietPage.locator('.petal-track').count(),0);await quiet.close();
  const broken=await browser.newContext();const brokenPage=await broken.newPage();await brokenPage.route('**/petals.json',route=>route.fulfill({status:503,body:'Unavailable'}));await brokenPage.goto(app.url);await brokenPage.locator('.memo-card').first().waitFor();
  await brokenPage.waitForFunction(()=>document.querySelector('#petals-toggle').disabled);await brokenPage.locator('.memo-title').first().click();await brokenPage.locator('.text-editor').waitFor();await broken.close();
  check('reduced motion defaults off; failed decoration loading leaves the diary usable');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.errors.push(error.stack);process.exitCode=1;}
finally{await browser.close();await app.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
