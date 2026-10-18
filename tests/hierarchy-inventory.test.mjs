import test from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyCompletenessErrors} from '../scripts/hierarchy-inventory.mjs';

const page=(id,title)=>`<one:Page ID="${id}" name="${title}" pageLevel="1"/>`;
const xml=(pages,attributes='')=>`<one:Notebook xmlns:one="urn:test" ID="n"><one:Section ID="s" ${attributes}>${pages}</one:Section></one:Notebook>`;
const manifest={notebookId:'n',sections:[{id:'s',key:'section'}],pages:[{id:'a',sectionKey:'section',title:'Example',level:1}]};
test('partial hierarchy is rejected even when every reported page was exported',()=>{
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Example'),'areAllPagesAvailable="false"'),manifest).some(e=>e.includes('not yet available')));
});
test('independent live hierarchy discovers pages absent from the export manifest',()=>{
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Example')+page('b','Another')),manifest).some(e=>e.includes('inventory differ')));
});
test('complete matching hierarchy passes and intentional exclusions remain excluded',()=>{
 assert.deepEqual(hierarchyCompletenessErrors(xml(page('a','Example')),manifest),[]);
 assert.deepEqual(hierarchyCompletenessErrors(xml(page('x','Excluded')+page('a','Example')),{...manifest,excludedPages:[{id:'x'}]}),[]);
});
test('locked sections, duplicate pages, missing sections and reordered pages fail',()=>{
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Example'),'isLocked="true"'),manifest).length);
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Example').repeat(2)),manifest).length);
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Example')),{...manifest,sections:[]}).length);
 assert.ok(hierarchyCompletenessErrors(xml(page('a','Changed')),manifest).length);
});
