import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInventory,compareSourceInventories} from '../scripts/source-inventory.mjs';
const page=body=>`<one:Page xmlns:one="urn:test" ID="page" lastModifiedTime="unchanged"><one:Outline objectID="outline"><one:OEChildren>${body}</one:OEChildren></one:Outline></one:Page>`;
test('same timestamp does not hide unhydrated images and attachments',()=>{
 const old=page('<one:OE objectID="image"/><one:OE objectID="attachment"/>');
 const live=page('<one:OE objectID="image"><one:Image format="png"><one:CallbackID>x</one:CallbackID></one:Image></one:OE><one:OE objectID="attachment"><one:InsertedFile preferredName="file.pdf"/></one:OE>');
 const failures=compareSourceInventories(sourceInventory(old),sourceInventory(live));
 assert.ok(failures.includes('Unhydrated empty OneNote object'));
 assert.ok(failures.includes('Fresh OneNote source differs: images'));
 assert.ok(failures.includes('Fresh OneNote source differs: attachments'));
});
test('callback and binary payloads do not change the structural inventory',()=>{
 const full=page('<one:OE objectID="image"><one:Image format="png"><one:Size width="20" height="30"/><one:Data>YWJj</one:Data></one:Image></one:OE>');
 const basic=full.replace('<one:Data>YWJj</one:Data>','<one:CallbackID>callback</one:CallbackID>');
 assert.deepEqual(compareSourceInventories(sourceInventory(full),sourceInventory(basic)),[]);
});
test('changed text or image geometry fails even when counts are unchanged',()=>{
 const a=page('<one:OE objectID="i"><one:Image format="png"><one:Size width="20" height="30"/></one:Image></one:OE><one:OE><one:T>text</one:T></one:OE>');
 const b=a.replace('width="20"','width="21"').replace('>text<','>new text<');
 assert.deepEqual(compareSourceInventories(sourceInventory(a),sourceInventory(b)),['Fresh OneNote source differs: images','Fresh OneNote source differs: text']);
});
test('piAll transient empty caret UUIDs do not hide real object changes',()=>{
 const a='<one:Page xmlns:one="urn:test" ID="page"><one:Outline objectID="volatile1"><one:Position x="3" y="4"/><one:OEChildren><one:OE objectID="volatile2" selected="partial"><one:T selected="all"><![CDATA[]]></one:T></one:OE></one:OEChildren></one:Outline></one:Page>';
 const b=a.replace('volatile1','new1').replace('volatile2','new2');
 assert.deepEqual(compareSourceInventories(sourceInventory(a),sourceInventory(b)),[]);
 assert.ok(compareSourceInventories(sourceInventory(a),sourceInventory(b.replace('CDATA[]','CDATA[actual text]'))).length>0);
 assert.ok(compareSourceInventories(sourceInventory(a),sourceInventory(b.replace('x="3"','x="5"'))).length>0);
});
test('focus-only empty selection in a title does not hide real title changes',()=>{
 const a=page('<one:OE objectID="title"><one:T>9.30</one:T></one:OE>');
 const b=a.replace('objectID="title"','objectID="title" selected="partial"').replace('<one:T>9.30','<one:T selected="all"><![CDATA[]]></one:T><one:T>9.30');
 assert.deepEqual(compareSourceInventories(sourceInventory(a),sourceInventory(b)),[]);
 assert.ok(compareSourceInventories(sourceInventory(a),sourceInventory(b.replace('9.30','10.1'))).includes('Fresh OneNote source differs: text'));
});
