import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {sha256,escapeHTML,xmlElements,xmlText,htmlText,cleanOfficeFieldCodes} from './lib.mjs';
import {fingerprint,imageDistance} from './image-match.mjs';
import {organizeSource} from './organize-source.mjs';
import {hierarchyCompletenessErrors} from './hierarchy-inventory.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]??path.join(repo,'exports/LIFE'));
const initial=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(initial.errors.length || initial.pages.some(p=>p.status!=='exported')) throw Error('Export is incomplete');
const hierarchyErrors=hierarchyCompletenessErrors(await fs.readFile(path.join(root,'_source/hierarchy.xml'),'utf8'),initial);
if(hierarchyErrors.length)throw Error(hierarchyErrors.join('; '));
if(initial.pages.some(p=>p.acquisitionVersion!==2||!p.sourceHash))throw Error('Legacy source snapshots may be incomplete. Re-export with the current exporter.');
const manifest=await organizeSource(root);
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,parseTagValue:false,trimValues:false,htmlEntities:true});
const audit={builtAt:new Date().toISOString(),pages:[],warnings:[],errors:[]};
const catalog=[];
for(const page of manifest.pages){
  const dir=path.dirname(path.join(root,page.url));
  const raw=await fs.readFile(path.join(dir,'native.htm'),'utf8');
  const xml=parser.parse(await fs.readFile(path.join(root,page.source),'utf8'));
  const $=load(raw,{decodeEntities:false});
  const imgs=$('img').toArray();
  let cleanedFieldCodes=0;
  $('img[alt]').each((_,el)=>{const old=$(el).attr('alt'),clean=cleanOfficeFieldCodes(old);if(old!==clean){$(el).attr('alt',clean);cleanedFieldCodes++}});
  const replacements=[],composites=[];
  const sourceFingerprints=[];
  for(const original of page.images){try{sourceFingerprints.push({original,f:await fingerprint(await fs.readFile(path.join(dir,original.file)))})}catch{/* EMF originals remain downloadable */}}
  for(let i=0;i<imgs.length;i++){
    const el=$(imgs[i]),src=el.attr('src');
    if(!src || /^(https?:|data:)/i.test(src))continue;
    const bytes=await fs.readFile(path.join(dir,decodeURIComponent(src)));
    const hash=sha256(bytes);
    // Native HTML can contain tag icons. Match the actual binary before using positional mapping.
    let original=page.images.find(x=>x.sha256===hash),matchDistance=null;
    if(!original){
      const parent=el.closest('div'),style=parent.attr('style')??'';
      const widthInch=Number(style.match(/(?:^|;)\s*width:([\d.]+)in/i)?.[1]);
      const width=Number(el.attr('width')),height=Number(el.attr('height'));
      // OneNote's flattened floating regions can be rasterized at desktop DPI,
      // while their wrapper retains the correct 96 CSS px/in layout dimensions.
      const ratio=width/(widthInch*96);
      if(parent[0]?.tagName==='div'&&widthInch&&ratio>1.2&&ratio<3.1){
        el.attr('width',String(widthInch*96)).attr('height',String(height/ratio));
        composites.push({index:i,file:src,nativeWidth:width,nativeHeight:height,displayWidth:widthInch*96,displayHeight:height/ratio,dpiScale:ratio});
      }
    }
    if(!original&&sourceFingerprints.length){
      try{
        const f=await fingerprint(bytes),scores=sourceFingerprints.map(s=>({...s,d:imageDistance(f,s.f)})).sort((a,b)=>a.d-b.d);
        const best=scores[0],w=Number(el.attr('width')),h=Number(el.attr('height'));
        if(best.d<.008&&(!scores[1]||scores[1].d-best.d>.012)&&Math.abs(w/(Number(best.original.width)*4/3)-1)<.015&&Math.abs(h/(Number(best.original.height)*4/3)-1)<.015){original=best.original;matchDistance=best.d}
      }catch{}
    }
    if(original){
      el.attr('src',original.file);
      replacements.push({native:src,original:original.file,nativeSha256:hash,originalSha256:original.sha256,identical:hash===original.sha256,matchDistance});
    }
  }
  const missing=page.images.filter(x=>!replacements.some(r=>r.original===x.file));
  // Identical source image occurrences can map to the same original file without losing any pixels.
  const unmapped=missing.filter(x=>!replacements.some(r=>r.originalSha256===x.sha256));
  if(unmapped.length)audit.warnings.push({key:page.key,message:'Originals not individually matched in native HTML; inspect composite rendering. Lossless files retained in original-image gallery.',files:unmapped.map(x=>x.file)});
  if(page.images.length&&!imgs.length)audit.errors.push({key:page.key,message:'Source contains images but native HTML contains none'});
  $('link[rel="File-List"],link[rel="Main-File"]').remove();
  $('head').prepend(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHTML(page.title)}</title>`);
  // Isolate the original native document from the navigation styles.
  $('head').append('<style>html{background:#fff}#archive-files{font:14px/1.7 system-ui,sans-serif;border-top:1px solid #ddd;margin-top:30px;padding-top:16px}#archive-files a{display:block}</style>');
  $('script').remove();
  const pageScript=path.relative(dir,path.join(root,'assets/page.js')).replaceAll('\\','/');
  $('body').append(`<script src="${pageScript}"></script>`);
  if(page.attachments.length) $('body').append(`<aside id="archive-files"><b>页面附件</b>${page.attachments.map(a=>`<a download href="${escapeHTML(a.file)}">${escapeHTML(a.name)}</a>`).join('')}</aside>`);
  const gallery=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(page.title)} · 原图</title><style>body{font:14px/1.7 system-ui;margin:30px;color:#263b2e}h1{font-size:21px}section{border-top:1px solid #ddd;padding:20px 0}img{max-width:100%;height:auto;display:block;margin:15px 0}a{color:#24634f}</style><h1>${escapeHTML(page.title)} · 原图</h1><p>以下文件与 OneNote 原始图片逐字节一致。点击图片可查看原始尺寸，或下载原文件。</p>${page.images.map((im,i)=>`<section><b>图片 ${i+1}</b> · ${im.bytes.toLocaleString()} 字节 · <a href="${im.file}" download>下载原文件</a>${/\.(png|jpe?g|gif|bmp)$/i.test(im.file)?`<a href="${im.file}" target="_blank"><img loading="lazy" src="${im.file}" alt="原图 ${i+1}"></a>`:'<p>原始矢量图片（EMF/WMF）已保留，请下载后用支持该格式的软件打开。</p>'}</section>`).join('')}</html>`;
  await fs.writeFile(path.join(dir,'originals.html'),gallery);
  $('a[href]').each((_,el)=>{const href=$(el).attr('href');if(/^https?:/i.test(href))$(el).attr('target','_blank').attr('rel','noopener noreferrer');});
  // Keep OneNote's document mode: adding a doctype changes image baseline and
  // line-box behavior, accumulating visible spacing differences on long pages.
  await fs.writeFile(path.join(root,page.url),$.html());
  const text=xmlElements(xml,'T').map(xmlText).map(htmlText).join(' ');
  const ocr=xmlElements(xml,'OCRText').map(xmlText).join(' ');
  catalog.push({...page,images:page.images.length,attachments:page.attachments.length,search:(text+' '+ocr).replace(/\s+/g,' ').trim()});
  audit.pages.push({key:page.key,sourceImages:page.images.length,nativeImages:imgs.length,replacements,composites,compositedOriginals:unmapped.length,cleanedFieldCodes,ink:xmlElements(xml,'InkDrawing').length,attachments:page.attachments.length});
}
await fs.mkdir(path.join(root,'assets'),{recursive:true});
for(const name of ['app.js','page.js','style.css']) await fs.copyFile(path.join(repo,'site',name),path.join(root,'assets',name));
await fs.copyFile(path.join(repo,'site','index.html'),path.join(root,'index.html'));
const data={name:manifest.displayName,exportedAt:manifest.exportedAt,sections:manifest.sections,pages:catalog};
await fs.writeFile(path.join(root,'assets','catalog.js'),'window.NOTEBOOK='+JSON.stringify(data).replace(/</g,'\\u003c')+';');
await fs.writeFile(path.join(root,'_audit','build.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({pages:catalog.length,images:catalog.reduce((s,p)=>s+p.images,0),errors:audit.errors.length}));
if(audit.errors.length)process.exitCode=1;
