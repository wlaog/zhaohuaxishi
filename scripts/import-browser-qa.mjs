import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createDiaryServer } from '../local-diary/server.mjs';
import { sha256 } from './import-diary-folders.mjs';

const output=path.resolve('qa-output/import-browser');await fs.mkdir(output,{recursive:true});
const root=path.resolve('exports/LIFE');
const manifest=JSON.parse(await fs.readFile(path.join(root,'_imports/manifest.json'),'utf8'));
const app=await createDiaryServer({root});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu']});
const report={startedAt:new Date().toISOString(),entries:0,sourceLinks:0,images:0,failures:[],consoleErrors:[],screenshots:[]};
try {
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage();page.on('pageerror',e=>report.consoleErrors.push(e.message));
  await page.goto(app.url);await page.locator('.memo-card').first().waitFor();
  const years=[...new Set(manifest.sources.map(s=>s.date.slice(0,4)))];
  for(const year of years)assert.equal(await page.locator(`#directory [data-year="${year}"]`).count(),1);
  await page.screenshot({path:path.join(output,'timeline.png'),fullPage:false});
  const ids=[...new Set(manifest.sources.map(s=>s.entryId))];
  for(const id of ids){
    const failures=[];const onResponse=response=>{if(response.status()>=400)failures.push(`${response.status()}: ${response.url()}`);};page.on('response',onResponse);
    try{
      await page.goto(app.url+'/?check='+id+'#entry='+id);
      await page.locator('#editor-dialog').waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll('#blocks iframe')].every(f=>f.contentDocument?.readyState==='complete'));
      const decoded=await page.evaluate(async()=>{
        const frames=[...document.querySelectorAll('#blocks iframe')],images=[...document.querySelectorAll('#blocks img'),...frames.flatMap(f=>[...f.contentDocument.images])];
        const failed=[];
        for(const img of images){try{await img.decode();if(!img.naturalWidth)failed.push(img.src);}catch{failed.push(img.src);}}
        return {count:images.length,failed};
      });
      failures.push(...decoded.failed);report.images+=decoded.count;
      const sources=manifest.sources.filter(s=>s.entryId===id);
      const links=await page.locator('#import-sources a[download]').count();assert.equal(links,sources.length);report.sourceLinks+=links;
      if(sources.some(s=>s.format==='docx')){
        for(const source of sources.filter(s=>s.format==='docx')){
          const position=await page.locator(`[data-block="${source.blockIds[0]}"]`).getAttribute('data-type');assert.equal(position,'html');
        }
      }
      if(sources.some(s=>s.format==='txt'))assert.match(await page.locator('.text-editor').first().innerText(),/\S/);
      report.entries++;
    }catch(error){failures.push(error.message);}
    finally{page.off('response',onResponse);}
    if(failures.length)report.failures.push({id,failures});
    if(report.entries%25===0)console.log(`Imported diary pages checked ${report.entries}/${ids.length}`);
  }
  assert.equal(report.entries,ids.length);assert.equal(report.sourceLinks,manifest.sources.length);
  await page.goto(app.url+'/archive/_imports/sources.html');
  for(const year of years)assert.match(await page.locator('body').innerText(),new RegExp(year));
  const links=await page.locator('a').evaluateAll(elements=>elements.map(e=>e.href).filter(h=>h.includes('/archive/')));
  const unique=[...new Set(links)];
  for(let offset=0;offset<unique.length;offset+=8)await Promise.all(unique.slice(offset,offset+8).map(async href=>{const response=await context.request.head(href);if(!response.ok())report.failures.push({href,status:response.status()});}));
  const document=manifest.sources.find(s=>s.format==='docx');
  if(document){
    const downloading=page.waitForEvent('download');
    await page.locator(`a[download][href="../${document.originalPath}"]`).click();
    const download=await downloading;const downloaded=path.join(output,'downloaded-original.docx');await download.saveAs(downloaded);
    assert.equal(sha256(await fs.readFile(downloaded)),document.sha256);
    report.downloadedOriginals=1;
  }
  // Standalone full-page screenshots avoid clipping at an iframe's viewport boundary.
  for(const source of manifest.sources.filter(s=>s.format==='docx')) {
    await page.goto(app.url+'/archive/'+source.viewPath,{waitUntil:'load'});
    await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>img.decode()));});
    await page.screenshot({path:path.join(output,'word-'+source.id+'.png'),fullPage:true});
    report.screenshots.push('word-'+source.id+'.png');
  }
  assert.equal(report.failures.length,0,JSON.stringify(report.failures.slice(0,3)));assert.deepEqual(report.consoleErrors,[]);
  report.status='PASS';
}catch(error){report.status='FAIL';report.failures.push({message:error.stack});console.error(error.stack);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await browser.close();await app.close();
  console.log(JSON.stringify({status:report.status,entries:report.entries,sourceLinks:report.sourceLinks,images:report.images,failures:report.failures.length,consoleErrors:report.consoleErrors.length}));
}
