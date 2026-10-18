import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {sha256,normalizeText,xmlElements,xmlText,htmlText,escapeHTML} from './lib.mjs';
import sharp from 'sharp';
import {sourceInventory,compareSourceInventories} from './source-inventory.mjs';
import {hierarchyCompletenessErrors} from './hierarchy-inventory.mjs';
const root=path.resolve(process.argv[2]??'exports/LIFE');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const build=JSON.parse(await fs.readFile(path.join(root,'_audit/build.json'),'utf8'));
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,parseTagValue:false,trimValues:false,htmlEntities:true});
const errors=[...manifest.errors,...build.errors],warnings=[...build.warnings];
const renderAudit=JSON.parse(await fs.readFile(path.join(root,'_audit/render-images.json'),'utf8'));
if(renderAudit.status!=='PASS'||Date.parse(renderAudit.checkedAt)<Date.parse(manifest.exportedAt))errors.push({message:'Missing or failed current blank-placeholder image check'});
const liveAudit=JSON.parse(await fs.readFile(path.join(root,'_audit/live-recheck/report.json'),'utf8'));
if(!liveAudit.startedAt||Date.parse(liveAudit.startedAt)<Date.parse(manifest.exportedAt))errors.push({message:'Independent live audit must run after this export'});
if(liveAudit.notebookId!==manifest.notebookId||liveAudit.pages?.length!==manifest.pages.length||liveAudit.pages?.some(p=>p.error))errors.push({message:'Independent live audit is incomplete or refers to another notebook'});
if(liveAudit.hierarchyComplete!==true)errors.push({message:'Independent live audit did not certify the full hierarchy'});
for(const file of ['_source/hierarchy.xml','_audit/hierarchy-after.xml','_audit/live-recheck/hierarchy-before.xml','_audit/live-recheck/hierarchy-after.xml']){
 try{for(const message of hierarchyCompletenessErrors(await fs.readFile(path.join(root,file),'utf8'),manifest))errors.push({message,file});}
 catch(e){errors.push({message:'Cannot verify full hierarchy: '+e.message,file});}
}
const stats={pages:0,activePages:0,recyclePages:0,sourceImages:0,imagesHashVerified:0,liveImagesHashVerified:0,attachments:0,textFragments:0,localLinks:0,nativeLayoutVerified:0,liveSourceVerified:0};
const checks=[],files=[],seenFiles=new Set();
async function checkedFile(rel){rel=rel.replaceAll('\\','/');const b=await fs.readFile(path.join(root,rel));if(!seenFiles.has(rel)){files.push({path:rel,bytes:b.length,sha256:sha256(b)});seenFiles.add(rel)}return b}
const before=parser.parse(await checkedFile('_source/hierarchy.xml'));
const after=parser.parse(await checkedFile('_audit/hierarchy-after.xml'));
const excluded=new Set((manifest.excludedPages??[]).map(p=>p.id));
const oldPages=xmlElements(before,'Page').filter(p=>!excluded.has(p['@ID'])),newPages=xmlElements(after,'Page').filter(p=>!excluded.has(p['@ID']));
const expectedIds=oldPages.map(p=>p['@ID']);
if(expectedIds.length!==manifest.pages.length || new Set(manifest.pages.map(p=>p.id)).size!==expectedIds.length)errors.push({message:'Page count / uniqueness mismatch'});
if(expectedIds.some(id=>!manifest.pages.some(p=>p.id===id)))errors.push({message:'Missing source page IDs'});
for(const sourceSection of xmlElements(before,'Section')){
 const record=manifest.sections.find(s=>s.id===sourceSection['@ID']);
 if(!record)continue;
 const sourcePages=(sourceSection.Page?(Array.isArray(sourceSection.Page)?sourceSection.Page:[sourceSection.Page]):[]).filter(p=>!excluded.has(p['@ID']));
 const outputPages=manifest.pages.filter(p=>p.sectionKey===record.key);
 for(let i=0;i<sourcePages.length;i++){
  const a=sourcePages[i],b=outputPages[i];
  if(!b||a['@ID']!==b.id||a['@name']!==b.title||Number(a['@pageLevel'])!==b.level||b.order!==i+1)errors.push({message:'Source page order, title, or level mismatch',section:record.key,index:i});
 }
}
const oldState=oldPages.map(p=>[p['@ID'],p['@name'],p['@pageLevel'],p['@lastModifiedTime']]);
const newState=newPages.map(p=>[p['@ID'],p['@name'],p['@pageLevel'],p['@lastModifiedTime']]);
if(JSON.stringify(oldState)!==JSON.stringify(newState)) errors.push({message:'Source hierarchy changed during export; re-export required'});
for(const s of manifest.sections){const sp=manifest.pages.filter(p=>p.sectionKey===s.key);if(sp.length!==s.pageCount)errors.push({message:'Section count mismatch',section:s.key});if(s.backup)await checkedFile(s.backup)}
for(const p of manifest.pages){
 const row={key:p.key,errors:[],warnings:[]};
 try{
  const sourceBytes=await checkedFile(p.source);
  // OCR token coordinates are not used by this verifier. Excluding them from
  // repeated DOM parses preserves checks while bounding memory and runtime.
  const withoutOCR=s=>s.replace(/<one:OCRData\b[^>]*>[\s\S]*?<\/one:OCRData>/g,'');
  const sourceText=withoutOCR(sourceBytes.toString('utf8'));
  const xml=parser.parse(sourceText.replace(/<one:Data>[^<]*<\/one:Data>/g,'<one:Data/>'));
  const liveBytes=await checkedFile('_audit/live-recheck/'+p.key+'.xml');
  const liveText=withoutOCR(liveBytes.toString('utf8'));
  const liveErrors=compareSourceInventories(sourceInventory(sourceText),sourceInventory(liveText));
  row.errors.push(...liveErrors);
  if(!liveErrors.length)stats.liveSourceVerified++;
  if(p.acquisitionVersion!==2||sha256(sourceBytes)!==p.sourceHash)row.errors.push('Missing or invalid hydrated source acquisition hash');
  if(xml.Page['@ID']!==p.id)row.errors.push('Page XML identity mismatch');
  const dir=path.dirname(p.url),native=await checkedFile(path.join(dir,'native.htm')),html=await checkedFile(p.url);
  const $=load(html.toString('utf8')),nativeDoc=load(native.toString('utf8'));
  $('script').remove();nativeDoc('script').remove();
  const rawText=normalizeText(nativeDoc('body').text()),resultText=normalizeText($('body').text());
  const accessibleDOM=load($.html());
  accessibleDOM('img[alt]').each((_,el)=>{accessibleDOM(el).replaceWith(accessibleDOM('<span>').text(accessibleDOM(el).attr('alt')))});
  const accessibleText=normalizeText(accessibleDOM('body').text());
  if(!resultText.includes(rawText))row.errors.push('Native HTML text changed or missing');
  const fragments=xmlElements(xml,'T').map(xmlText).map(htmlText).map(normalizeText).filter(Boolean);
  for(const [index,f] of fragments.entries()){stats.textFragments++;if(!accessibleText.includes(f)&&!resultText.includes(f))row.errors.push('Source text fragment missing from HTML: fragment '+index+' ('+f.length+' characters)');}
  // XMLParser's grouped object form does not preserve interleaved Outline/Image
  // order. Query the XML DOM in document order, matching the COM extraction.
  const sourceDOM=load(sourceText,{xmlMode:true});
  const liveDOM=load(liveText,{xmlMode:true});
  const srcImages=sourceDOM('one\\:Image').toArray();
  const liveImages=liveDOM('one\\:Image').toArray();
  if(srcImages.length!==p.images.length)row.errors.push('Source image count mismatch');
  if(liveImages.length!==p.images.length)row.errors.push('Live source image count mismatch');
  for(let i=0;i<srcImages.length;i++){
    const bytes=Buffer.from(sourceDOM(srcImages[i]).children('one\\:Data').text(),'base64'),exported=await checkedFile(path.join(dir,p.images[i].file));
    if(!bytes.equals(exported) || sha256(exported)!==p.images[i].sha256)row.errors.push('Image bytes mismatch: '+i);else stats.imagesHashVerified++;
    const liveData=liveDOM(liveImages[i]).children('one\\:Data').text();
    if(!liveData||sha256(Buffer.from(liveData,'base64'))!==p.images[i].sha256)row.errors.push('Fresh OneNote image binary mismatch: '+i);else stats.liveImagesHashVerified++;
    if(/\.(png|jpe?g|gif|bmp|tiff?)$/i.test(p.images[i].file)){try{await sharp(exported).resize(1,1,{fit:'fill'}).toBuffer()}catch{row.errors.push('Original image failed decoding: '+i)}}
  }
  // Every native layout style and image display dimension is retained.
  const originalStyles=nativeDoc('body,[style]').toArray().map(e=>[e.tagName,nativeDoc(e).attr('style')??'']);
  const resultStyles=$('body,[style]').toArray().map(e=>[e.tagName,$(e).attr('style')??'']);
  if(JSON.stringify(originalStyles)!==JSON.stringify(resultStyles))row.errors.push('Native inline layout styles changed');else stats.nativeLayoutVerified++;
  const changes=build.pages.find(x=>x.key===p.key).composites;
  const ni=nativeDoc('img').toArray(),oi=$('img').toArray();
  if(ni.length!==oi.length)row.errors.push('Rendered image count changed');
  for(let i=0;i<ni.length;i++){
    const old=nativeDoc(ni[i]),now=$(oi[i]),change=changes.find(c=>c.index===i);
    if(old.attr('decoding')!==now.attr('decoding'))row.errors.push('Native image decoding behavior changed');
    if(change){if(Math.abs(Number(now.attr('width'))-change.displayWidth)>.001||Math.abs(Number(now.attr('height'))-change.displayHeight)>.001)row.errors.push('Incorrect DPI correction')}
    else if(old.attr('width')!==now.attr('width')||old.attr('height')!==now.attr('height'))row.errors.push('Unexplained image size change');
  }
  for(const el of $('img[src],a[href],link[href]').toArray()){
    const url=$(el).attr('src')??$(el).attr('href');
    if(!url||url.startsWith('#')||/^(https?:|data:|mailto:|tel:|onenote:)/i.test(url))continue;
    if(/^file:/i.test(url)){row.warnings.push('External local file link: '+url);continue}
    const target=path.resolve(root,dir,decodeURIComponent(url.split('#')[0].split('?')[0]));
    if(!target.startsWith(root+path.sep)){row.errors.push('Link escapes export root: '+url);continue}
    try{await checkedFile(path.relative(root,target));stats.localLinks++}catch{row.errors.push('Broken local reference: '+url)}
  }
  const gallery=load((await checkedFile(path.join(dir,'originals.html'))).toString('utf8'));
  for(const im of p.images){if(!gallery('a[href]').toArray().some(el=>gallery(el).attr('href')===im.file))row.errors.push('Original missing from gallery: '+im.file)}
  const liveAttachments=liveDOM('one\\:InsertedFile').toArray();
  if(liveAttachments.length!==p.attachments.length)row.errors.push('Fresh OneNote attachment count mismatch');
  for(const [i,a] of p.attachments.entries()){
   const b=await checkedFile(path.join(dir,a.file));if(sha256(b)!==a.sha256)row.errors.push('Attachment hash mismatch');
   const cache=liveDOM(liveAttachments[i]).attr('pathCache');
   if(!cache||sha256(await fs.readFile(cache))!==a.sha256)row.errors.push('Fresh OneNote attachment binary mismatch: '+i);
  }
  stats.sourceImages+=srcImages.length;stats.attachments+=p.attachments.length;stats.pages++;p.recycle?stats.recyclePages++:stats.activePages++;
 }catch(e){row.errors.push(e.message)}
 errors.push(...row.errors.map(message=>({key:p.key,message})));warnings.push(...row.warnings.map(message=>({key:p.key,message})));checks.push(row);
}
const report={status:errors.length?'FAIL':'PASS',verifiedAt:new Date().toISOString(),scope:'Current locally available notebook pages, including recycle bin; not historical page versions or independent cloud verification.',stats,sections:manifest.sections.map(s=>({name:s.name,recycle:s.recycle,pages:s.pageCount})),errors,warnings,checks};
await fs.writeFile(path.join(root,'_audit','verification.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(root,'_audit','checksums.json'),JSON.stringify(files,null,2));
await fs.writeFile(path.join(root,'_audit','verification.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LIFE 导出校验</title><style>body{font:15px/1.8 system-ui;max-width:900px;margin:50px auto;padding:0 24px;color:#26392c}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>LIFE 导出校验：${report.status}</h1><p>${escapeHTML(report.verifiedAt)}</p><table>${Object.entries(stats).map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table><h2>分区</h2><table>${report.sections.map(s=>`<tr><td>${escapeHTML(s.name)}${s.recycle?'（回收站）':''}</td><td>${s.pages}</td></tr>`).join('')}</table><h2>异常 ${errors.length} / 提示 ${warnings.length}</h2><pre>${escapeHTML(JSON.stringify({errors,warnings},null,2))}</pre><p>核验范围：当前 OneNote 本地可读页面及回收站；不包含历史版本，也不代表独立验证了云端同步。逐页原始 XML、原生 HTML 和 SHA-256 清单一并保留。</p><p><a href="../index.html">返回目录</a> · <a href="verification.json">完整报告</a> · <a href="checksums.json">文件校验清单</a></p></html>`);
console.log(JSON.stringify({status:report.status,stats,errors:errors.slice(0,15),warnings:warnings.length},null,2));
if(errors.length)process.exitCode=1;
