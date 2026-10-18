import {load} from 'cheerio';

// Compare two independent piAll snapshots by document objects, text and
// geometry. The verifier checks image and attachment bytes separately.
export function sourceInventory(xml){
 // OCR tokens and base64 data can dwarf the actual page structure. Their bytes
 // are verified separately; omit them from this structural comparison.
 xml=xml.replace(/<one:Data>[^<]*<\/one:Data>/g,'<one:Data/>').replace(/<one:OCRData\b[^>]*>[\s\S]*?<\/one:OCRData>/g,'');
 const $=load(xml,{xmlMode:true});
 const nodes=name=>$('*').toArray().filter(e=>e.name?.split(':').at(-1)===name);
 const local=e=>e.name?.split(':').at(-1);
 // When focus moves, piAll may prepend an empty selected text run to an
 // existing title. It carries the caret only; retain all actual title text.
 for(const t of nodes('T')){
  const parent=$(t).parent();
  if($(t).attr('selected')==='all'&&$(t).text()===''&&local(parent[0])==='OE'&&parent.attr('selected')==='partial'&&parent.children().toArray().some(s=>s!==t&&local(s)==='T'&&$(s).text()!==''))$(t).remove();
 }
 const isCaret=e=>{
  const children=$(e).children().toArray();
  return local(e)==='OE'&&$(e).attr('selected')==='partial'&&children.length===1&&local(children[0])==='T'&&$(children[0]).attr('selected')==='all'&&$(children[0]).text()==='';
 };
 const isCaretOutline=e=>{
  const objects=$(e).find('*').toArray().filter(x=>local(x)==='OE');
  return objects.length===1&&isCaret(objects[0]);
 };
 const geometry=e=>$(e).children().toArray().filter(x=>['Position','Size'].includes(local(x))).map(x=>[local(x),Object.entries(x.attribs??{}).sort()]);
 return {
  id:$(nodes('Page')[0]).attr('ID'),
  // piAll creates a new UUID for a selected empty insertion caret on each
  // read. Normalize only that exact empty selected object; keep its geometry.
  objects:nodes('OE').map(e=>({id:isCaret(e)?'selection-caret':$(e).attr('objectID')??'',children:$(e).children().toArray().map(local)})),
  images:nodes('Image').map(e=>({object:$(e).parent().attr('objectID')??'',format:$(e).attr('format'),geometry:geometry(e),alt:$(e).attr('alt')??''})),
  attachments:nodes('InsertedFile').map(e=>({object:$(e).parent().attr('objectID')??'',name:$(e).attr('preferredName')??''})),
  text:nodes('T').map(e=>$(e).text()),
  outlines:nodes('Outline').map(e=>({id:isCaretOutline(e)?'selection-caret-outline':$(e).attr('objectID')??'',geometry:geometry(e)})),
 };
}

export function compareSourceInventories(saved,live){
 const errors=[];
 if(saved.objects.some(o=>!o.children.length)||live.objects.some(o=>!o.children.length))errors.push('Unhydrated empty OneNote object');
 for(const field of ['id','objects','images','attachments','text','outlines']){
  if(JSON.stringify(saved[field])!==JSON.stringify(live[field]))errors.push('Fresh OneNote source differs: '+field);
 }
 return errors;
}
