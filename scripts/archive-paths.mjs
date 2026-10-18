import path from 'node:path';
const months=['一','二','三','四','五','六','七','八','九','十','十一','十二'];
export function safePart(value){
 let s=String(value).normalize('NFC').replace(/[<>:"/\\|?*#%\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
 if(!s)s='无标题页';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))s='_'+s;
 return Array.from(s).slice(0,48).join('').replace(/[. ]+$/g,'');
}
export function archivePaths(manifest){
 const result=new Map(),used=new Set();
 for(const section of manifest.sections){
  const year=/^\d{4}$/.test(section.name)?section.name.slice(-2):safePart(section.name);
  const sectionPath=['source',year];
  const stack=[];
  for(const p of manifest.pages.filter(p=>p.sectionKey===section.key)){
   while(stack.length&&stack.at(-1).level>=p.level)stack.pop();
   const dates=p.title.match(/^(\d{1,2})\s*[.．]\s*(\d{1,2})(?:\s*[-–—~～]\s*(\d{1,2})\s*[.．]\s*(\d{1,2}))?(?=\D|$)/u);
   // A year-boundary entry filed under January belongs to its January date.
   const useEnd=dates?.[3]&&Number(dates[1])!==stack.at(-1)?.month&&Number(dates[3])===stack.at(-1)?.month;
   const date=dates?[null,useEnd?dates[3]:dates[1],useEnd?dates[4]:dates[2]]:null;
   const explicitMonth=months.findIndex(m=>p.title.startsWith(m+'月'))+1;
   const month=date?Number(date[1]):explicitMonth||stack.at(-1)?.month;
   const base=sectionPath.join('/')+(month?'/'+String(month).padStart(2,'0'):'');
   const period=p.title.includes('上旬')?'_1':p.title.includes('中旬')?'_2':p.title.includes('下旬')?'_3':null;
   let dir=date?base+'/'+date[2].padStart(2,'0'):period?base+'/'+period:explicitMonth?base:base+'/_p'+String(p.order??1).padStart(3,'0');
   if(used.has(dir.toLocaleLowerCase()))dir+='~'+p.key.slice(0,6);
   if(used.has(dir.toLocaleLowerCase()))throw Error('Archive path collision: '+p.key);
   if(dir.length>195)throw Error('Archive path too long: '+dir);
   used.add(dir.toLocaleLowerCase());result.set(p.key,dir);stack.push({dir,level:p.level,month});
  }
 }
 return result;
}
export function withinRoot(root,relative){
 const target=path.resolve(root,relative),base=path.resolve(root)+path.sep;
 if(!target.startsWith(base))throw Error('Archive path escapes root: '+relative);
 return target;
}
