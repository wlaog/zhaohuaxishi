import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './lib.mjs';
import {withinRoot} from './archive-paths.mjs';
const root=path.resolve(process.argv[2]??'exports/LIFE'),write=process.argv.includes('--write');
const listPath=path.join(root,'_audit/portable-checksums.json');
async function walk(dir){let all=[];for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const p=dir+'/'+item.name;if(item.isSymbolicLink())throw Error('Archive must not depend on symlinks: '+p);all.push(...(item.isDirectory()?await walk(p):[p]))}return all}
if(write){
 const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 const build=JSON.parse(await fs.readFile(path.join(root,'_audit/build.json'),'utf8'));
 for(const file of ['verification.json','render-images.json','browser/report.json']){
  const report=JSON.parse(await fs.readFile(path.join(root,'_audit',file),'utf8'));if(report.status!=='PASS')throw Error('Cannot seal failing archive: '+file);
  if(file==='verification.json'&&(report.stats.pages!==m.pages.length||Date.parse(report.verifiedAt)<Date.parse(build.builtAt)))throw Error('Source verification must cover this build');
  if(file==='browser/report.json'&&(report.pages!==m.pages.length||Date.parse(report.layoutVerifiedAt)<Date.parse(build.builtAt)))throw Error('Browser verification must cover this build');
 }
 const files=['index.html','manifest.json','_source/hierarchy.xml',...await walk('source'),...await walk('assets'),...['verification.json','verification.html','build.json','render-images.json','browser/report.json'].map(p=>'_audit/'+p)];
 try{await fs.access(path.join(root,'_audit/render-reviewed.json'));files.push('_audit/render-reviewed.json')}catch(e){if(e.code!=='ENOENT')throw e}
 const rows=[];
 for(const p of files){const b=await fs.readFile(withinRoot(root,p));rows.push({path:p,bytes:b.length,sha256:sha256(b)})}
 await fs.writeFile(listPath,JSON.stringify({sealedAt:new Date().toISOString(),pages:m.pages.length,files:rows},null,2));
}
const manifest=JSON.parse(await fs.readFile(listPath,'utf8')),errors=[];
for(const item of manifest.files){try{const b=await fs.readFile(withinRoot(root,item.path));if(b.length!==item.bytes||sha256(b)!==item.sha256)errors.push({path:item.path,message:'Hash or length mismatch'})}catch(e){errors.push({path:item.path,message:e.message})}}
const report={status:errors.length?'FAIL':'PASS',checkedAt:new Date().toISOString(),pages:manifest.pages,files:manifest.files.length,errors,scope:'Self-contained archived files; no OneNote COM, source-device caches, node_modules, or network required to read the archive.'};
await fs.writeFile(path.join(root,'_audit/portable-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
