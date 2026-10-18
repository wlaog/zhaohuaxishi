import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const staged=process.argv.includes('--staged');
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:30_000_000});
const files=git(staged?['diff','--cached','--name-only','--diff-filter=ACMR','-z']:['ls-files','-z']).split('\0').filter(Boolean);
const findings=[];
const privatePath=/^(?:exports|qa-output|local-state|references)\/|^docs\/VALIDATION\.md$|^Config\/archive-exclusions\.json$/i;
const rules=[
  ['local-profile-path',/[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/])|Default(?:[\\/]))[^\s'"\\/]+/i],
  ['private-tailnet-address',/\b[a-z0-9-]+\.tail[a-z0-9-]+\.ts\.net\b/i],
  ['personal-education-email',/\b[\w.+-]+@[\w.-]+\.edu\.cn\b/i],
  ['personal-session-record',/随[后]用户|本轮新增\s*\d+\s*篇|本批\s*\d+\s*份|用户.*回复[“「]/],
];
// Private comparison values are loaded locally; they are never embedded in this script or its output.
const privateValues=[];
const profileName=path.basename(process.env.USERPROFILE??'');
if(profileName.length>=3&&!/^(Public|Default)$/i.test(profileName))privateValues.push(profileName);
try{const c=JSON.parse(await fs.readFile('local-state/remote-access.json','utf8'));if(c.login)privateValues.push(c.login);}catch{}
try{const c=JSON.parse(await fs.readFile('Config/archive-exclusions.json','utf8'));for(const p of c.pages??[])if(p.id)privateValues.push(p.id);}catch{}
try{const c=JSON.parse(await fs.readFile('exports/LIFE/manifest.json','utf8'));for(const p of c.pages??[])if(p.title?.length>=10&&!/^\d{4}-\d{2}-\d{2}$/.test(p.title))privateValues.push(p.title);}catch{}
for(const file of files){
  if(privatePath.test(file)){findings.push({file,rule:'private-file'});continue;}
  let text;try{text=staged?git(['show',':'+file]):await fs.readFile(file,'utf8');}catch{continue;}
  for(const [rule,pattern] of rules)if(pattern.test(text))findings.push({file,rule});
  if(privateValues.some(value=>text.includes(value)))findings.push({file,rule:'local-private-value'});
}
if(findings.length){console.error(JSON.stringify({status:'FAIL',findings},null,2));process.exitCode=1;}
else console.log(`Public-content check passed (${files.length} files).`);
