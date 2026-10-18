import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fingerprint,imageDistance} from '../scripts/image-match.mjs';
test('original and recompressed pixels match while different content does not',async()=>{
 const red=await sharp({create:{width:160,height:240,channels:3,background:'#df231a'}}).png().toBuffer();
 const jpeg=await sharp(red).jpeg({quality:90}).toBuffer();
 const dark=await sharp({create:{width:160,height:240,channels:3,background:'#111'}}).png().toBuffer();
 const a=await fingerprint(red),b=await fingerprint(jpeg),c=await fingerprint(dark);
 assert.ok(imageDistance(a,b)<.008);assert.ok(imageDistance(a,c)>.1);
});
test('aspect mismatch prevents a composite being mistaken for an original',async()=>{
 const a={ratio:1,pixels:Buffer.alloc(4096,255)},b={ratio:2,pixels:Buffer.alloc(4096,255)};
 assert.equal(imageDistance(a,b),Infinity);
});
