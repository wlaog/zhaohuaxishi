import test from 'node:test';
import assert from 'node:assert/strict';
import {archivePaths,safePart,withinRoot} from '../scripts/archive-paths.mjs';
test('short year/month/day folders keep the original hierarchy in metadata',()=>{
 const m={sections:[{key:'s',name:'2026',groups:[]}],pages:[{key:'a',sectionKey:'s',title:'三月',level:1},{key:'b',sectionKey:'s',title:'三月下旬',level:2},{key:'c',sectionKey:'s',title:'3.31 示例记录',level:3}]};
 const paths=archivePaths(m);assert.equal(paths.get('c'),'source/26/03/31');assert.equal(paths.get('b'),'source/26/03/_3');assert.equal(paths.get('a'),'source/26/03');
});
test('duplicate Windows names stay distinct and unsafe URL/path characters are removed',()=>{
 const m={sections:[{key:'s',name:'2023',groups:[]}],pages:['9.30 abc','9.30 ABC'].map((title,i)=>({key:'key0000'+i,sectionKey:'s',title,level:1}))};
 const paths=[...archivePaths(m).values()];assert.notEqual(paths[0].toLowerCase(),paths[1].toLowerCase());
 assert.equal(safePart('CON'),'_CON');assert.equal(safePart('x/y:#%?'),'x_y____');
 assert.throws(()=>withinRoot('D:/archive','../outside'));
});
test('a date without a month heading still gets a readable month directory',()=>{
 const m={sections:[{key:'s',name:'2024',groups:[]}],pages:[{key:'day',sectionKey:'s',title:'1.2 示例记录',level:1}]};
 assert.equal(archivePaths(m).get('day'),'source/24/01/02');
});

test('spaced date punctuation and a cross-year entry under January remain daily entries',()=>{
 const m={sections:[{key:'s',name:'2024'}],pages:[
  {key:'heading',sectionKey:'s',title:'一月',level:1},
  {key:'range',sectionKey:'s',title:'12. 31-1.1 Example',level:3},
  {key:'spaced',sectionKey:'s',title:'1. 2 Example',level:3},
 ]};
 const paths=archivePaths(m);
 assert.equal(paths.get('range'),'source/24/01/01');
 assert.equal(paths.get('spaced'),'source/24/01/02');
});
