import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import sharp from 'sharp';
import { DiaryStore, within } from '../local-diary/store.mjs';
import { sha256, decodeText } from './import-diary-folders.mjs';

const plain = html => {const $=load(html);$('head,script,style').remove();return $.text().replace(/\s+/g,'');};
export function expectedTxtText(original, source) {
  const text=decodeText(original).replace(/\r\n?/g,'\n');
  if(!source.textTransform)return text;
  if(source.textTransform.type!=='drop-time-title'||source.textTransform.lines!==2)throw Error('未知的 TXT 正文转换');
  const lines=text.split('\n'),titleDate=lines[1]?.match(/^(\d{1,2})\.(\d{1,2})/);
  if(!/^\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2}$/.test(lines[0]?.trim()??'')||!titleDate
    ||Number(titleDate[1])!==Number(source.date.slice(5,7))||Number(titleDate[2])!==Number(source.date.slice(8,10)))throw Error('TXT 时间或标题前缀不符合已确认的转换');
  return lines.slice(2).join('\n');
}
export async function verifyImports({project=process.cwd(),root=path.resolve(project,'exports/LIFE'),wordRoot=path.resolve(project,'qa-output/import/word')}={}) {
  project=path.resolve(project);root=path.resolve(root);
  const manifest=JSON.parse(await fs.readFile(path.join(root,'_imports/manifest.json'),'utf8'));
  const store=await new DiaryStore(root).init();
  const report={checkedAt:new Date().toISOString(),sources:0,images:0,wordMedia:0,entries:new Set(manifest.sources.map(s=>s.entryId)).size,formats:{},inputCompared:0,archiveOnly:0,missingInputRoots:[],errors:[]};
  for(const source of manifest.sources) {
    try{
      const copy=await fs.readFile(within(root,source.originalPath));
      if(sha256(copy)!==source.sha256||copy.length!==source.bytes)throw Error('归档原件哈希或长度不同');
      let original;
      try{original=await fs.readFile(within(project,source.source));report.inputCompared++;}
      catch(error){if(error.code!=='ENOENT')throw error;original=copy;report.archiveOnly++;}
      if(sha256(original)!==source.sha256)throw Error('输入原件哈希发生变化');
      if(!copy.equals(original))throw Error('原件副本与输入不同');
      const entry=store.get(source.entryId);
      if(entry.date!==source.date)throw Error('归档日期不同');
      const blocks=source.blockIds.map(id=>entry.blocks.find(b=>b.id===id));
      if(blocks.some(b=>!b))throw Error('导入内容块缺失');
      for(const asset of source.assets){
        const bytes=await fs.readFile(within(root,asset.path));
        if(sha256(bytes)!==asset.sha256||bytes.length!==asset.bytes)throw Error('派生资源哈希或长度不同');
        if(asset.role==='original-image'){await sharp(bytes,{limitInputPixels:300_000_000,animated:true}).metadata();report.images++;}
      }
      if(source.format==='txt') {
        const $=load(blocks[0].html,null,false);
        const pasted=$.root().children('p').toArray().map(p=>$(p).text()).join('\n');
        if(pasted!==expectedTxtText(original,source))throw Error('TXT 正文或段落换行不同');
      }
      if(['html','htm'].includes(source.format)&&plain(blocks[0].html)!==plain(decodeText(original)))throw Error('HTML 正文字符不同');
      if(source.viewPath){
        const view=await fs.readFile(within(root,source.viewPath),'utf8');
        if(view!==blocks[0].html)throw Error('预览文件与内容块不一致');
        if(sha256(plain(view))!==source.textHash)throw Error('正文指纹不一致');
        const $=load(view);
        for(const el of $('img').toArray()) {
          const src=el.attribs.src;
          if(!/^media-[a-f0-9]{64}\./.test(src))throw Error('预览图片没有本地归档');
          const bytes=await fs.readFile(within(root,source.folder+'/'+src));
          if(!source.assets.some(a=>a.sha256===sha256(bytes)))throw Error('预览图片未列入原图清单');
        }
      }
      if(source.format==='docx') {
        const stage=within(wordRoot,source.key);
        const meta=JSON.parse((await fs.readFile(path.join(stage,'conversion.json'),'utf8')).replace(/^\uFEFF/,''));
        const content=plain(blocks[0].html);
        if(meta.texts.join('').replace(/\s+/g,'')!==content)throw Error('Word 原始文本与预览不一致');
        for(const image of meta.images){if(!source.assets.some(a=>a.sha256===image.sha256))throw Error('Word 原图缺失');report.wordMedia++;}
      }
      report.sources++;report.formats[source.format]=(report.formats[source.format]??0)+1;
    }catch(error){report.errors.push({source:source.source,message:error.message});}
  }
  const expected=[];
  const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else if(e.isFile())expected.push(path.relative(project,file).replaceAll('\\','/'));}};
  for(const directory of new Set(manifest.sources.map(s=>s.source.split('/')[0]))){
    try{await walk(within(project,directory));}
    catch(error){if(error.code!=='ENOENT')throw error;report.missingInputRoots.push(directory);}
  }
  for(const file of expected)if(!manifest.sources.some(s=>s.source===file))report.errors.push({source:file,message:'输入文件没有导入记录'});
  report.status=report.errors.length?'FAIL':'PASS';report.expectedFiles=expected.length;
  await fs.writeFile(path.join(root,'_imports/verification.json'),JSON.stringify(report,null,2));
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const report=await verifyImports();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;}
