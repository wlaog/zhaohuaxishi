import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,DiaryError,validDate} from './store.mjs';
import {MOODS,WEATHERS} from './public/day-model.js';

const fail=(status,message)=>{throw new DiaryError(status,message);};
function selections(value,allowed){
  if(!Array.isArray(value)||value.length>allowed.length||value.some(id=>typeof id!=='string'||!allowed.some(item=>item.id===id)))fail(400,'心情或天气选项无效');
  return [...new Set(value)];
}
export class DayStore{
  constructor(root){this.root=path.resolve(root);this.days=new Map();this.queue=Promise.resolve();}
  folder(date){if(!validDate(date))fail(400,'日期无效');return path.join(this.root,'source',date.slice(2,4),date.slice(5,7),date.slice(8,10));}
  async init(){
    const directories=async folder=>{try{return (await fs.readdir(folder,{withFileTypes:true})).filter(d=>d.isDirectory()&&!d.isSymbolicLink()&&/^\d{2}$/.test(d.name)).map(d=>d.name);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
    const source=path.join(this.root,'source');
    for(const year of await directories(source))for(const month of await directories(path.join(source,year)))for(const day of await directories(path.join(source,year,month))){
      const date=`20${year}-${month}-${day}`;if(validDate(date))await this.get(date);
    }
    return this;
  }
  async get(date){
    const file=path.join(this.folder(date),'day.json');
    try{
      const value=JSON.parse(await fs.readFile(file,'utf8'));
      if(value.date!==date||!Number.isSafeInteger(value.revision)||value.revision<1)fail(500,'每日信息文件无效');
      const day={schemaVersion:1,date,revision:value.revision,moods:selections(value.moods,MOODS),weather:selections(value.weather,WEATHERS),updated:value.updated};
      this.days.set(date,day);return structuredClone(day);
    }catch(error){if(error.code!=='ENOENT')throw error;this.days.delete(date);return {date,revision:0,moods:[],weather:[]};}
  }
  list(){return [...this.days.values()].map(day=>structuredClone(day));}
  save(date,input){
    const task=this.queue.then(async()=>{
      this.folder(date);
      if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'每日信息版本无效');
      const moods=selections(input.moods,MOODS),weather=selections(input.weather,WEATHERS);
      const current=await this.get(date);
      if(input.revision!==current.revision)fail(409,'其他设备已修改这一天。你的选择仍保留，请重新载入最新记录后再修改。');
      const day={schemaVersion:1,date,revision:current.revision+1,moods,weather,updated:new Date().toISOString()};
      if(current.revision)await atomicJson(path.join(this.folder(date),'_history/day',`${String(current.revision).padStart(8,'0')}.json`),current);
      await atomicJson(path.join(this.folder(date),'day.json'),day);this.days.set(date,day);return structuredClone(day);
    });
    this.queue=task.catch(()=>{});return task;
  }
}
