import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { load } from 'cheerio';
import sharp from 'sharp';
import { DiaryStore, atomicJson, validDate, within } from '../local-diary/store.mjs';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const cleanText = value => value.replace(/\s+/g, '');
const supported = new Set(['.png','.jpg','.jpeg','.gif','.webp','.avif','.txt','.html','.htm','.docx']);
const jsonFile = async (file, fallback) => {
  try { return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')); }
  catch(e) { if(e.code==='ENOENT')return fallback; throw e; }
};

export function sourceDate(relative, defaultYear) {
  const normalized = relative.replaceAll('\\','/');
  const folderYear = normalized.match(/(?:^|\/)(20\d{2})(?:\/|$)/)?.[1];
  const filename = path.posix.basename(normalized, path.posix.extname(normalized));
  const first = filename.match(/^(?:(20\d{2})[.年/-])?(\d{1,2})[.月/-](\d{1,2})/);
  const year=first?.[1]??folderYear??(defaultYear===undefined?undefined:String(defaultYear));
  if(!year||!/^20\d{2}$/.test(year)||!first)throw Error('无法确定文件日期：'+relative+'；无年份目录请明确指定 --year');
  const date = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const start = date(first[1]??year,first[2],first[3]);
  const tail = filename.slice(first[0].length);
  const range = tail.match(/^\s*[-—–~～至]\s*(?:(20\d{2})[.年/-])?(\d{1,2})[.月/-](\d{1,2})/);
  let rangeStart = start, end = range ? date(range[1]??year,range[2],range[3]) : start;
  const parenthetical = tail.match(/[（(]\s*(20\d{2})\.(\d{1,2})\.(\d{1,2})\s*[-—–~～至]\s*(20\d{2})\.(\d{1,2})\.(\d{1,2})\s*[）)]/);
  if(parenthetical) { rangeStart=date(...parenthetical.slice(1,4));end=date(...parenthetical.slice(4,7)); }
  if(!validDate(start)||!validDate(rangeStart)||!validDate(end)||end<rangeStart)throw Error('文件日期或区间无效：'+relative);
  return { date:start, rangeStart, rangeEnd:end, ranged:rangeStart!==end, label:filename };
}
export function decodeText(bytes) {
  if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
  if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}
}
async function immutable(file, bytes) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  try{const previous=await fs.readFile(file);if(!previous.equals(bytes))throw Error('导入目标已存在不同内容：'+file);}
  catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(file,bytes,{flag:'wx'});}
}
async function collect(directory, project) {
  const files=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('不导入符号链接：'+file);
    if(entry.isDirectory())files.push(...await collect(file,project));
    else if(entry.isFile())files.push(path.relative(project,file).replaceAll('\\','/'));
  }
  return files;
}

async function imageAsset(bytes, root, folder, assets) {
  const meta=await sharp(bytes,{limitInputPixels:300_000_000,animated:true}).metadata();
  const ext={png:'png',jpeg:'jpg',gif:'gif',webp:'webp',avif:'avif',heif:'avif'}[meta.format];
  if(!ext)throw Error('不支持的导入图片格式：'+meta.format);
  const hash=sha256(bytes), file=`media-${hash}.${ext}`, relative=`${folder}/${file}`;
  await immutable(within(root,relative),bytes);
  if(!assets.some(a=>a.path===relative))assets.push({path:relative,sha256:hash,bytes:bytes.length,role:'original-image',width:meta.width,height:meta.height});
  return file;
}

async function prepareHtml({ html, base, root, folder, assets, wordImages=[] }) {
  const $=load(html);
  $('script,base,iframe,object,embed').remove();
  $('meta[http-equiv]').each((_,el)=>{if(/refresh|content-security-policy/i.test(el.attribs['http-equiv']??''))$(el).remove();});
  $('meta[charset]').attr('charset','utf-8');
  if(!$('meta[charset]').length)$('head').prepend('<meta charset="utf-8">');
  const mappings=[];
  for(const element of $('[src],[href]').toArray()) {
    const node=$(element), attribute=element.attribs.src!==undefined?'src':'href', value=node.attr(attribute);
    if(!value||value.startsWith('#'))continue;
    if(attribute==='href'&&element.tagName==='a')continue;
    if(/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(value)) {
      const payload=value.slice(value.indexOf(',')+1).replace(/\s/g,'');
      if(!/^[A-Za-z0-9+/]*={0,2}$/.test(payload))throw Error('无效内嵌图片');
      const bytes=Buffer.from(payload,'base64'),file=await imageAsset(bytes,root,folder,assets);
      node.attr(attribute,file);mappings.push({kind:'embedded',sha256:sha256(bytes),file});continue;
    }
    if(/^(?:https?:|file:|\/\/|javascript:)/i.test(value))throw Error('导入预览依赖外部资源：'+value.slice(0,100));
    const local=within(base,decodeURIComponent(value.split(/[?#]/)[0]));
    const bytes=await fs.readFile(local);
    if(element.tagName==='img') {
      const file=await imageAsset(bytes,root,folder,assets);node.attr(attribute,file);mappings.push({kind:'relative',sha256:sha256(bytes),file});
    } else {
      throw Error('需要处理的非图片资源：'+value);
    }
  }
  if($('[style]').toArray().some(el=>/url\s*\(/i.test(el.attribs.style))||/url\s*\(/i.test($('style').text()))throw Error('HTML 含尚未归档的 CSS url 资源');
  // Every image extracted from DOCX is independently retained, including unused parts.
  for(const image of wordImages) {
    const bytes=await fs.readFile(within(base,image.file));
    if(sha256(bytes)!==image.sha256)throw Error('Word 原图校验失败');
    await imageAsset(bytes,root,folder,assets);
  }
  const result=$.html();
  const before=load(html);before('head,script,style').remove();
  const after=load(result);after('head,script,style').remove();
  if(cleanText(before.text())!==cleanText(after.text()))throw Error('HTML 转换后正文发生变化');
  return {html:result,mappings,text:after.text()};
}

export async function importFolders({project=process.cwd(), root=path.resolve(project,'exports/LIFE'), roots=['imports'], wordRoot=path.resolve(project,'qa-output/import/word'),year}={}) {
  project=path.resolve(project);root=path.resolve(root);wordRoot=path.resolve(wordRoot);
  const store=await new DiaryStore(root).init();
  const manifestFile=path.join(root,'_imports/manifest.json');
  const manifest=await jsonFile(manifestFile,{version:1,sources:[]});
  const report={startedAt:new Date().toISOString(),imported:0,skipped:0,files:[],errors:[]};
  let paths=[];
  for(const directory of roots)paths.push(...await collect(within(project,directory),project));
  paths.sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
  // Reject unrecognized files/dates before making any entry changes.
  const plan=await Promise.all(paths.map(async relative=>{
    const ext=path.extname(relative).toLowerCase();
    if(!supported.has(ext))throw Error('未处理的文件类型：'+relative);
    return {relative,ext,timing:sourceDate(relative,year),bytes:await fs.readFile(within(project,relative))};
  }));
  for(const source of plan) {
    const {relative,ext,timing,bytes}=source;
    const hash=sha256(bytes),key=sha256(relative).slice(0,16),id=sha256(relative+'\0'+hash).slice(0,20);
    const prior=manifest.sources.find(s=>s.id===id);
    if(prior){
      for(const asset of [...prior.assets,{path:prior.originalPath,sha256:prior.sha256}])if(sha256(await fs.readFile(within(root,asset.path)))!==asset.sha256)throw Error('已导入文件的校验不一致：'+asset.path);
      report.skipped++;continue;
    }
    const existing=store.list().filter(e=>e.date===timing.date&&!e.deleted).sort((a,b)=>Number(b.legacy)-Number(a.legacy)||a.id.localeCompare(b.id))[0];
    const entryId=existing?.id??'n-'+sha256('import-day:'+timing.date).slice(0,24);
    const folder=existing?.folder??`source/${timing.date.slice(2,4)}/${timing.date.slice(5,7)}/${timing.date.slice(8,10)}`;
    const entry=existing?store.get(entryId):{id:entryId,date:timing.date,title:timing.ranged?`${timing.rangeStart}～${timing.rangeEnd}`:timing.date+' '+timing.label.replace(/^\d{1,2}[.]\d{1,2}/,'').trim(),revision:0,deleted:false,pinned:false,tags:['资料导入'],blocks:[]};
    if(!entry.title.trim())entry.title=timing.date;
    const assets=[],blocks=[];
    let originalPath=`${folder}/import-${id}${ext}`,viewPath=null,mappings=[],textHash=null;
    if(/\.(png|jpe?g|gif|webp|avif)$/.test(ext)) {
      const file=await imageAsset(bytes,root,folder,assets);originalPath=`${folder}/${file}`;
      blocks.push({id:'import-'+id,type:'image',file,caption:timing.label});
    }else {
      await immutable(within(root,originalPath),bytes);
      if(ext==='.txt') {
        const content=decodeText(bytes).replace(/\r\n?/g,'\n');
        blocks.push({id:'import-'+id,type:'text',html:content.split('\n').map(line=>`<p>${line?escape(line):'<br>'}</p>`).join('')});
        textHash=sha256(cleanText(content));
      }else {
        let html,base=path.dirname(within(project,relative)),wordImages=[];
        if(ext==='.docx') {
          base=within(wordRoot,key);
          const conversion=await jsonFile(path.join(base,'conversion.json'));
          if(!conversion||conversion.sourceHash!==hash||conversion.source!==relative)throw Error('请先运行 prepare-word-imports.py：'+relative);
          html=await fs.readFile(within(base,conversion.view),'utf8');wordImages=conversion.images;
        }else html=decodeText(bytes);
        const result=await prepareHtml({html,base,root,folder,assets,wordImages});mappings=result.mappings;textHash=sha256(cleanText(result.text));
        viewPath=`${folder}/view-${id}.html`;
        await immutable(within(root,viewPath),Buffer.from(result.html));
        assets.push({path:viewPath,sha256:sha256(Buffer.from(result.html)),bytes:Buffer.byteLength(result.html),role:'preview'});
        blocks.push({id:'import-'+id,type:'html',html:result.html});
      }
    }
    const newBlocks=blocks.filter(b=>!entry.blocks.some(old=>old.id===b.id));
    if(newBlocks.length)await store.save(entryId,{...entry,tags:[...new Set([...entry.tags,'资料导入',...(timing.ranged?['跨日记录']:[])])],blocks:[...entry.blocks,...newBlocks]});
    const record={id,key,source:relative,sha256:hash,bytes:bytes.length,format:ext.slice(1),...timing,entryId,folder,originalPath,viewPath,assets,mappings,textHash,blockIds:blocks.map(b=>b.id),importedAt:new Date().toISOString()};
    manifest.sources.push(record);manifest.updatedAt=new Date().toISOString();
    await atomicJson(manifestFile,manifest);
    report.imported++;report.files.push({id,source:relative,entryId,date:timing.date});
  }
  const reopened=await new DiaryStore(root).init();
  await writeSourceIndex(root,reopened,manifest);
  report.finishedAt=new Date().toISOString();report.sourceFiles=paths.length;report.totalRecords=manifest.sources.length;report.totalEntries=reopened.entries.size;
  await atomicJson(path.join(root,'_imports/import-report.json'),report);
  return report;
}

export async function writeSourceIndex(root,store,manifest) {
  const records=new Map();for(const s of manifest.sources){if(!records.has(s.entryId))records.set(s.entryId,[]);records.get(s.entryId).push(s);}
  const rows=store.list().filter(e=>!e.deleted).sort((a,b)=>(a.date??a.folder).localeCompare(b.date??b.folder));
  const groups=new Map();
  for(const e of rows){const year=e.folder.match(/^source\/(\d{2})\//)?.[1]??'其他';if(!groups.has(year))groups.set(year,[]);groups.get(year).push(e);}
  const body=[...groups].sort().map(([year,entries])=>`<details open><summary>20${escape(year)} · ${entries.length} 篇</summary>${entries.map(e=>{
    const imported=records.get(e.id)??[], links=[];
    if(e.legacy)links.push(`<a href="../${escape(e.folder)}/index.html">原始网页</a> <a href="../${escape(e.folder)}/page.xml">XML</a>`);
    for(const s of imported)links.push(`<a href="../${escape(s.viewPath??s.originalPath)}">${escape(path.posix.basename(s.source))}</a> <a href="../${escape(s.originalPath)}" download>原件</a>${s.ranged?` <small>${s.rangeStart}～${s.rangeEnd}</small>`:''}`);
    if(e.revision)links.push(`<a href="../${escape(e.folder)}/entry-${e.id}.json">可编辑数据 JSON</a>`);
    return `<li><b>${escape(e.date??'目录')} · ${escape(e.title)}</b><div>${links.join(' · ')}</div></li>`;
  }).join('')}</details>`).join('');
  await fs.mkdir(path.join(root,'_imports'),{recursive:true});
  await fs.writeFile(path.join(root,'_imports/sources.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LIFE 全部原始资料</title><style>body{font:14px/1.8 system-ui;max-width:1100px;margin:30px auto;padding:20px;color:#263b2e}details{margin:18px 0}summary{font-size:20px;cursor:pointer}li{list-style:none;border-bottom:1px solid #eee;padding:12px}a{color:#386350}small{color:#777}li div{font-size:12px}</style><h1>LIFE 全部原始资料</h1><p><a href="../source/index.html">OneNote 原始目录</a> · <a href="../index.html">原始阅读器</a> · 按年/月/日归档；跨日文件保留完整区间，图片与文档保留原始字节。</p>${body}</html>`,'utf8');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=parseArgs({options:{year:{type:'string'}},allowPositionals:true});
  const report=await importFolders({...(args.positionals.length?{roots:args.positionals}:{}),year:args.values.year});console.log(JSON.stringify({imported:report.imported,skipped:report.skipped,sourceFiles:report.sourceFiles,totalEntries:report.totalEntries}));
}
