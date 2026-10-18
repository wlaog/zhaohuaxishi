// Create a separate, explicitly partial development fixture while the real export continues.
import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
const source=path.resolve('exports/LIFE'),root=path.resolve('qa-output/preview');
await fs.mkdir(path.join(root,'_source'),{recursive:true});
await fs.mkdir(path.join(root,'_audit'),{recursive:true});
const pages=[],all=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8')).pages;
all.sort((a,b)=>a.order-b.order);
const chosen=new Map((process.argv.includes('--all')?all:[...all.slice(0,8),...all.slice().sort((a,b)=>b.images.length-a.images.length).slice(0,4),...all.slice(-2)]).map(p=>[p.key,p]));
for(const p of chosen.values()){
 pages.push(p);
 await fs.mkdir(path.dirname(path.join(root,p.source)),{recursive:true});
 await fs.copyFile(path.join(source,p.source),path.join(root,p.source));
 const dir=path.dirname(p.url);await fs.mkdir(path.join(root,dir),{recursive:true});
 for(const entry of await fs.readdir(path.join(source,dir),{withFileTypes:true})){
  if(entry.isDirectory()&&entry.name!=='native.files')continue;
  await fs.cp(path.join(source,dir,entry.name),path.join(root,dir,entry.name),{recursive:true});
 }
}
pages.sort((a,b)=>a.order-b.order);
const fullDOM=load(await fs.readFile(path.join(source,'_source/hierarchy.xml'),'utf8'),{xmlMode:true});
const sections=[...new Set(pages.map(p=>p.sectionKey))].map(key=>{
 const record=pages.find(p=>p.sectionKey===key),sourcePage=fullDOM('one\\:Page').toArray().find(el=>fullDOM(el).attr('ID')===record.id),section=fullDOM(sourcePage).parent();
 return {id:section.attr('ID'),key,name:section.attr('name'),groups:[],recycle:record.recycle,pageCount:pages.filter(p=>p.sectionKey===key).length};
});
// A partial fixture has its own contiguous order within each selected section.
for(const s of sections)pages.filter(p=>p.sectionKey===s.key).forEach((p,i)=>p.order=i+1);
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({displayName:'LIFE PREVIEW',exportedAt:new Date().toISOString(),pages,sections,errors:[]}));
const $=load(await fs.readFile(path.join(source,'_source/hierarchy.xml'),'utf8'),{xmlMode:true});
$('one\\:Page').each((_,el)=>{if(!pages.some(p=>p.id===$(el).attr('ID')))$(el).remove()});
await fs.writeFile(path.join(root,'_source/hierarchy.xml'),$.xml());
await fs.writeFile(path.join(root,'_audit/hierarchy-after.xml'),$.xml());
console.log(`Partial fixture: ${pages.length} pages`);
