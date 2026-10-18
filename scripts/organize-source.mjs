import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {archivePaths,withinRoot} from './archive-paths.mjs';
import {escapeHTML} from './lib.mjs';
export async function organizeSource(root){
 root=path.resolve(root);
 const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 const paths=archivePaths(m);
 for(const p of m.pages){
  const dir=paths.get(p.key),old=path.posix.dirname(p.url);
  const target=withinRoot(root,dir),oldDir=withinRoot(root,old);
  const xml=p.source===dir+'/page.xml'?null:await fs.readFile(withinRoot(root,p.source));
  if(old!==dir){
   await fs.mkdir(target,{recursive:true});
   // A heading directory may already contain child pages. Move only this
   // page's own files and native companion directory, never its descendants.
   for(const entry of await fs.readdir(oldDir,{withFileTypes:true})){
    if(entry.isDirectory()&&entry.name!=='native.files')continue;
    const from=path.join(oldDir,entry.name),to=path.join(target,entry.name);
    try{await fs.access(to);throw Error('Destination file already exists: '+to)}catch(e){if(e.code!=='ENOENT')throw e}
    await fs.rename(from,to);
   }
  }
  const oldSource=p.source;
  p.url=dir+'/index.html';p.source=dir+'/page.xml';p.checkpoint=dir+'/checkpoint.json';
  if(xml)await fs.writeFile(withinRoot(root,p.source),xml);
  await fs.writeFile(withinRoot(root,p.checkpoint),JSON.stringify(p,null,2));
  if(oldSource!==p.source){try{await fs.unlink(withinRoot(root,oldSource))}catch(e){if(e.code!=='ENOENT')throw e}}
  if(old!==dir){try{await fs.unlink(withinRoot(root,'_source/'+p.key+'.json'))}catch(e){if(e.code!=='ENOENT')throw e}}
 }
 m.storageLayout='short-dates-v1';
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(m,null,2));
 // The index works without a web server; every directory is also browsable
 // in Explorer/Finder and contains the page, source XML, originals and files.
 const sections=m.sections.filter(s=>s.pageCount).map(s=>`<details open><summary>${escapeHTML(s.name)} · ${s.pageCount} 页</summary><ul>${m.pages.filter(p=>p.sectionKey===s.key).map(p=>`<li style="margin-left:${Math.max(0,p.level-1)*18}px"><a href="${escapeHTML(p.url.replace(/^source\//,''))}">${escapeHTML(p.title)}</a> · <a href="${escapeHTML(p.source.replace(/^source\//,''))}">XML</a></li>`).join('')}</ul></details>`).join('');
 await fs.mkdir(path.join(root,'source'),{recursive:true});
 await fs.writeFile(path.join(root,'source/index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LIFE 原始资料目录</title><style>body{font:15px/1.8 system-ui;max-width:1100px;margin:40px auto;padding:20px}a{color:#24634f}li{list-style:none}summary{font-size:20px;cursor:pointer}</style><h1>LIFE 原始资料目录</h1><p><a href="../index.html">返回阅读网站</a> · 文件夹采用两位年/月/日，例如 26/03/31。上中下旬分组页分别保存在对应月份的 _1、_2、_3 中，完整标题及原始层级见下方目录。每页文件夹均包含 XML、网页、原图和附件。</p>${sections}</html>`);
 async function pruneEmpty(relative){
  const target=withinRoot(root,relative);
  for(const entry of await fs.readdir(target,{withFileTypes:true}))if(entry.isDirectory())await pruneEmpty(relative+'/'+entry.name);
  if(relative!=='source'){try{await fs.rmdir(target)}catch(e){if(e.code!=='ENOTEMPTY'&&e.code!=='EEXIST')throw e}}
 }
 await pruneEmpty('source');
 return m;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const m=await organizeSource(process.argv[2]??'exports/LIFE');console.log(JSON.stringify({pages:m.pages.length,layout:m.storageLayout}))}
