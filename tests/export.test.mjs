import test from 'node:test';
import assert from 'node:assert/strict';
import {pageTree,escapeHTML,normalizeText,xmlElements,cleanOfficeFieldCodes} from '../scripts/lib.mjs';
test('duplicate titles retain unique IDs and hierarchy in original order',()=>{
 const ps=[{key:'a',title:'八月',level:1},{key:'b',title:'重复',level:2},{key:'c',title:'重复',level:3},{key:'d',title:'重复',level:2},{key:'e',title:'九月',level:1}];
 const t=pageTree(ps);assert.deepEqual(t.map(x=>x.key),['a','e']);assert.deepEqual(t[0].children.map(x=>x.key),['b','d']);assert.equal(t[0].children[0].children[0].key,'c');
});
test('orphan subpages remain reachable',()=>assert.equal(pageTree([{key:'a',level:3}])[0].key,'a'));
test('unsafe titles are escaped and Chinese preserved',()=>assert.equal(escapeHTML('<日记 "A">&'), '&lt;日记 &quot;A&quot;&gt;&amp;'));
test('nested images and attachments are visited',()=>assert.equal(xmlElements({Page:{Outline:{OEChildren:{OE:[{Image:{Data:'a'}},{OEChildren:{OE:{Image:{Data:'b'}}}}]}}}},'Image').length,2));
test('text comparison tolerates formatting whitespace without losing characters',()=>{assert.equal(normalizeText('你好\n世 界'),'你好世界');assert.notEqual(normalizeText('你好世界'),'你好世')});
test('native Word hyperlink field marker is removed without removing visible link text',()=>assert.equal(cleanOfficeFieldCodes('开头\uFDDFHYPERLINK "https://example.com/a?q=1" 链接文字结尾'),'开头链接文字结尾'));
