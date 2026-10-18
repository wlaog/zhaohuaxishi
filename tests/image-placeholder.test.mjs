import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {placeholderEvidence,reviewedWhitespaceStrip} from '../scripts/image-placeholder.mjs';
test('a decodable white placeholder with a thin gray border is rejected',async()=>{
 const b=await sharp(Buffer.from('<svg width="736" height="3976"><rect width="736" height="3976" fill="white" stroke="#ddd" stroke-width="1"/></svg>')).png().toBuffer();
 assert.equal((await placeholderEvidence(b)).blank,true);
});
test('substantial image content is not a white placeholder',async()=>{
 const b=await sharp(Buffer.from('<svg width="736" height="3976"><rect width="736" height="3976" fill="white"/><rect x="30" y="50" width="600" height="3000" fill="#35984a"/></svg>')).png().toBuffer();
 assert.equal((await placeholderEvidence(b)).blank,false);
});

test('reviewed tail whitespace is bound to source, native document and image hashes',()=>{
 const review={type:'trailing-whitespace',reason:'Original image confirmed in preceding raster strip',reviewedAt:'2024-01-01T00:00:00Z',key:'example',src:'native.files/tail.png',sourceHash:'a'.repeat(64),nativeHash:'b'.repeat(64),imageHash:'c'.repeat(64)};
 const actual={...review,lastStrip:true,evidence:{blank:true,entropy:.003}};
 assert.equal(reviewedWhitespaceStrip(review,actual),true);
 for(const field of ['sourceHash','nativeHash','imageHash'])assert.equal(reviewedWhitespaceStrip(review,{...actual,[field]:'d'.repeat(64)}),false);
 assert.equal(reviewedWhitespaceStrip(review,{...actual,lastStrip:false}),false);
 assert.equal(reviewedWhitespaceStrip(review,{...actual,evidence:{blank:true,entropy:.05}}),false);
 assert.equal(reviewedWhitespaceStrip(undefined,actual),false);
});
