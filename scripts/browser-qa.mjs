import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]??'exports/LIFE');
const visualOnly=process.argv.includes('--visual-only');
const browserPath=process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out=path.resolve(process.env.BROWSER_QA_OUTPUT??path.join(root,'_audit/browser'));await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const build=JSON.parse(await fs.readFile(path.join(root,'_audit/build.json'),'utf8'));
const base=process.env.SITE_URL??pathToFileURL(root+path.sep).href;
const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--disable-gpu']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
if(base.startsWith('file:'))await context.setOffline(true);
const errors=[],consoleErrors=[],pageFailures=[],visualChecks=[];
const page=await context.newPage();
page.on('pageerror',e=>consoleErrors.push(e.message));
page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
const url=rel=>new URL(rel,base).href;
try{
 await page.goto(url('index.html'));await page.waitForSelector('.year-card');
 assert.equal(await page.locator('.year-card').count(),manifest.sections.filter(s=>!s.recycle).length);
 await page.screenshot({path:path.join(out,'home-desktop.png'),fullPage:true});
 // Search uses titles, text, and OCR and must preserve Unicode.
 const first=manifest.pages.find(p=>!p.recycle&&p.images.length);
 await page.locator('#search').fill(first.title);
 assert.ok(await page.locator('#tree .page-link').count()>0);
 await page.locator(`#tree a[data-key="${first.key}"]`).click();
 await page.waitForFunction(url=>decodeURI(document.querySelector('#page-frame').src).endsWith(url),first.url);
 await page.locator('#search').fill('');
 assert.equal(await page.locator('#page-title').textContent(),first.title);
 await page.locator('#zoom').selectOption('1.5');
 await page.waitForFunction(()=>document.querySelector('#page-frame').contentWindow!==null);
 await page.waitForFunction(()=>document.querySelector('#page-frame').getAttribute('src'));
 const readerFrame=await page.locator('#page-frame').elementHandle().then(el=>el.contentFrame());
 assert.ok(readerFrame);
 await readerFrame.waitForFunction(()=>document.body.style.zoom==='1.5');await readerFrame.evaluate(async()=>{for(const im of document.images)await im.decode()});
 await page.locator('#zoom').selectOption('fit');
 await page.screenshot({path:path.join(out,'reader-desktop.png')});
 if(!await page.locator('#next').isDisabled()){await page.locator('#next').click();await page.waitForFunction(key=>location.hash!==('#'+key),first.key);await page.evaluate(key=>location.hash=key,first.key)}
 await page.setViewportSize({width:390,height:844});
 await page.goto(url('index.html'));await page.screenshot({path:path.join(out,'home-mobile.png'),fullPage:true});
 await page.locator('#menu').click();assert.ok(await page.locator('#sidebar').evaluate(e=>e.classList.contains('visible')));
 await page.screenshot({path:path.join(out,'directory-mobile.png')});
 await page.setViewportSize({width:1440,height:1000});
 const directory=await context.newPage();
 await directory.goto(url('source/index.html'));
 assert.equal(await directory.locator('a[href$="page.xml"]').count(),manifest.pages.length);
 const directoryTarget=manifest.pages.find(p=>p.images.length);
 await directory.locator(`a[href="${directoryTarget.url.replace(/^source\//,'')}"]`).click();
 await directory.waitForLoadState('load');
 assert.ok(decodeURI(directory.url()).endsWith(directoryTarget.url));
 await directory.close();
 // Decode every image in every generated page in a real browser.
 const content=await context.newPage();
 content.on('pageerror',e=>consoleErrors.push(e.message));
 content.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 let n=0,totalImages=0,galleryPages=0,galleryImages=0;
 for(const p of visualOnly?[]:manifest.pages){
  await content.goto(url(p.url),{waitUntil:'load'});
  const result=await content.evaluate(async()=>{
   const images=[...document.images];
   const broken=[];for(const i of images){try{await i.decode()}catch{broken.push(i.getAttribute('src'))}if(!i.naturalWidth&&!broken.includes(i.getAttribute('src')))broken.push(i.getAttribute('src'))}
   return {images:images.length,broken,text:document.body.innerText.length,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  totalImages+=result.images;
  if(result.broken.length)pageFailures.push({key:p.key,...result});
  if(!result.text && p.title)pageFailures.push({key:p.key,message:'Empty document'});
  if(p.images.length){
   await content.goto(url(p.url.replace('index.html','originals.html')),{waitUntil:'load'});
   const gallery=await content.evaluate(async()=>{
    const images=[...document.images],broken=[];
    for(const im of images){im.loading='eager';try{await im.decode()}catch{broken.push(im.getAttribute('src'))}}
    return {images:images.length,broken};
   });
   galleryPages++;galleryImages+=gallery.images;
   const expected=p.images.filter(im=>/\.(png|jpe?g|gif|bmp)$/i.test(im.file)).length;
   if(gallery.images!==expected||gallery.broken.length)pageFailures.push({key:p.key,message:'Original gallery image count/decode failure',expected,...gallery});
  }
  n++;if(n%50===0)console.log(`BROWSER ${n}/${manifest.pages.length}; failures=${pageFailures.length}`);
 }
 // Compare the native content block against the generated block, with the same viewport.
 const sampleKeys=new Set(manifest.sections.filter(s=>s.pageCount).flatMap(s=>{
  const ps=manifest.pages.filter(p=>p.sectionKey===s.key);
  return [ps[0]?.key,ps.find(p=>p.images.length)?.key,ps.at(-1)?.key,ps.slice().sort((a,b)=>b.images.length-a.images.length)[0]?.key].filter(Boolean);
 }));
 await content.setViewportSize({width:2000,height:2000});
 for(const w of build.warnings)sampleKeys.add(w.key);
 for(const key of sampleKeys){
  const p=manifest.pages.find(p=>p.key===key);
  await content.goto(url(p.url));
  await content.evaluate(async()=>{for(const im of document.images)await im.decode();await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
  const generated=content.locator('body > div').first();
  const b=await generated.boundingBox();
  // Keep screenshots bounded for very long diary pages, inspect the first 1800px.
  const gen=await content.screenshot({path:path.join(out,`${key}-generated.png`),clip:{x:b.x,y:b.y,width:Math.min(b.width,1350),height:Math.min(b.height,1800)},captureBeyondViewport:true});
  await content.goto(url(p.url.replace('index.html','native.htm')));
  await content.evaluate(async()=>{for(const im of document.images)await im.decode();await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
  const nb=await content.locator('body > div').first().boundingBox();
  const nat=await content.screenshot({path:path.join(out,`${key}-native.png`),clip:{x:nb.x,y:nb.y,width:Math.min(nb.width,1350),height:Math.min(nb.height,1800)},captureBeyondViewport:true});
  const pageBuild=build.pages.find(p=>p.key===key);
  const expectedChange=pageBuild.composites.length>0||pageBuild.replacements.some(r=>!r.identical);
  const pngIdentical=gen.equals(nat);
  if(!pngIdentical&&!expectedChange)pageFailures.push({key,message:'Unexplained native/generated visual difference'});
  visualChecks.push({key,widthDelta:b.width-nb.width,heightDelta:b.height-nb.height,pngIdentical,expectedChange});
 }
 const previous=visualOnly?JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8')):null;
 if(previous)previous.pageFailures=previous.pageFailures.filter(f=>f.message!=='Unexplained native/generated visual difference'||!sampleKeys.has(f.key));
 const report={status:pageFailures.length||consoleErrors.length?'FAIL':'PASS',verifiedAt:previous?.verifiedAt??new Date().toISOString(),layoutVerifiedAt:new Date().toISOString(),transport:base.startsWith('file:')?'file':'http',pages:previous?.pages??n,decodedImages:previous?.decodedImages??totalImages,galleryPages:previous?.galleryPages??galleryPages,galleryImages:previous?.galleryImages??galleryImages,consoleErrors:[...(previous?.consoleErrors??[]),...consoleErrors],pageFailures:[...(previous?.pageFailures??[]),...pageFailures],visualChecks};
 if(report.consoleErrors.length||report.pageFailures.length)report.status='FAIL';
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='PASS')process.exitCode=1;
}catch(e){errors.push(e.stack);await fs.writeFile(path.join(out,'failure.json'),JSON.stringify(errors));throw e}finally{await browser.close()}
