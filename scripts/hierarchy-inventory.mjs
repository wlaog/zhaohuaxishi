import {load} from 'cheerio';

export function hierarchyCompletenessErrors(xml, manifest) {
  const $=load(xml,{xmlMode:true}), nodes=$('*').toArray();
  const local=n=>n.name?.split(':').at(-1);
  const errors=[];
  if(nodes.some(n=>n.attribs?.areAllPagesAvailable==='false')) errors.push('OneNote hierarchy contains pages that are not yet available');
  if(nodes.some(n=>n.attribs?.isLocked==='true')) errors.push('OneNote hierarchy contains locked content');
  const notebook=nodes.find(n=>local(n)==='Notebook');
  if(notebook?.attribs.ID!==manifest.notebookId) errors.push('Hierarchy notebook identity mismatch');
  const excluded=new Set((manifest.excludedPages??[]).map(p=>p.id));
  const pages=nodes.filter(n=>local(n)==='Page'&&!excluded.has(n.attribs.ID));
  const ids=pages.map(n=>n.attribs.ID), exported=manifest.pages.map(p=>p.id);
  if(ids.length!==exported.length||new Set(ids).size!==ids.length||new Set(exported).size!==exported.length||ids.some(id=>!exported.includes(id))||exported.some(id=>!ids.includes(id))) errors.push('Complete live hierarchy and archive page inventory differ');
  const sections=nodes.filter(n=>local(n)==='Section');
  const sectionIds=sections.map(n=>n.attribs.ID), savedSections=manifest.sections.map(s=>s.id);
  if(sectionIds.length!==savedSections.length||new Set(sectionIds).size!==sectionIds.length||sectionIds.some(id=>!savedSections.includes(id))) errors.push('Complete live hierarchy and archive section inventory differ');
  for(const section of sections) {
    const record=manifest.sections.find(s=>s.id===section.attribs.ID);
    if(!record) continue;
    const expected=$(section).children().toArray().filter(n=>local(n)==='Page'&&!excluded.has(n.attribs.ID));
    const saved=manifest.pages.filter(p=>p.sectionKey===record.key);
    if(expected.length!==saved.length||expected.some((p,i)=>p.attribs.ID!==saved[i]?.id||p.attribs.name!==saved[i]?.title||Number(p.attribs.pageLevel)!==saved[i]?.level)) errors.push('Complete live hierarchy page order, title or level differs: '+record.key);
  }
  return errors;
}
