import crypto from 'node:crypto';
import { load } from 'cheerio';
export const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
export const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalizeText = s => String(s).normalize('NFC').replace(/[\s\u200b\uFEFF]/gu,'');
export const htmlText = s => load(`<div>${s}</div>`)('div').text();
export const cleanOfficeFieldCodes = s => String(s).replace(/\uFDDF\s*HYPERLINK\s*"[^"]*"\s*/g,'');
export function pageTree(pages) {
  const root=[],stack=[];
  for(const p of pages){
    const node={...p,children:[]};
    while(stack.length && stack.at(-1).level >= p.level) stack.pop();
    (stack.length ? stack.at(-1).children : root).push(node);
    stack.push(node);
  }
  return root;
}
export function xmlElements(node, name, out=[]) {
  if(!node || typeof node!=='object') return out;
  for(const [key,value] of Object.entries(node)) {
    if(key===name) out.push(...(Array.isArray(value)?value:[value]));
    if(Array.isArray(value)) for(const v of value) xmlElements(v,name,out);
    else if(typeof value==='object') xmlElements(value,name,out);
  }
  return out;
}
export const xmlText = value => typeof value==='string' ? value : String(value?.['#text']??'');
