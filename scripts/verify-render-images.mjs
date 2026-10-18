import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import {sha256} from './lib.mjs';
import {placeholderEvidence,reviewedWhitespaceStrip} from './image-placeholder.mjs';
const root=path.resolve(process.argv[2]??'exports/LIFE');
const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
let reviewed=[];
try{reviewed=JSON.parse(await fs.readFile(path.join(root,'_audit/render-reviewed.json'),'utf8')).reviews;}catch(e){if(e.code!=='ENOENT')throw e}
const report={checkedAt:new Date().toISOString(),status:'PASS',images:0,exactSourceImages:0,unmatched:0,placeholders:[],trailingWhitespace:[],errors:[]};
for(const p of m.pages){
 const dir=path.dirname(path.join(root,p.url));
 const native=await fs.readFile(path.join(dir,'native.htm'));
 const $=load(native.toString('utf8'));
 for(const img of $('img').toArray()){
  const src=$(img).attr('src');
  if(!src||/^(https?:|data:)/i.test(src))continue;
  try{
   const bytes=await fs.readFile(path.join(dir,decodeURIComponent(src)));report.images++;
   if(p.images.some(im=>im.sha256===sha256(bytes))){report.exactSourceImages++;continue}
   report.unmatched++;
   const evidence=await placeholderEvidence(bytes);
   if(evidence.blank){
    const el=$(img),siblings=el.parent().children('img');
    // OneNote splits very tall composite regions into strips. A completely
    // white final strip with whitespace-only alt text represents trailing
    // empty lines, not a missing image. Keep an explicit audit trail.
    const lastStrip=el.parent()[0]?.tagName==='nobr'&&siblings.length>1&&siblings.last()[0]===img;
    const review=reviewed.find(r=>reviewedWhitespaceStrip(r,{key:p.key,src,sourceHash:p.sourceHash,nativeHash:sha256(native),imageHash:sha256(bytes),lastStrip,evidence}));
    const tail=lastStrip&&evidence.entropy===0&&/^\s+$/.test(el.attr('alt')??'')||Boolean(review);
    (tail?report.trailingWhitespace:report.placeholders).push({key:p.key,src,...evidence,...(review?{review}: {})});
   }
  }catch(e){report.errors.push({key:p.key,src,message:e.message})}
 }
}
if(report.placeholders.length||report.errors.length)report.status='FAIL';
await fs.writeFile(path.join(root,'_audit/render-images.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.status==='FAIL')process.exitCode=1;
