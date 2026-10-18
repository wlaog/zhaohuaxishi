import fs from 'node:fs/promises';
import sharp from 'sharp';

const directory=new URL('../local-diary/controller/',import.meta.url);
const source=await fs.readFile(new URL('icon.svg',directory));
const sizes=[16,24,32,48,64,128,256];
const images=await Promise.all(sizes.map(size=>sharp(source).resize(size,size).png().toBuffer()));
const header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
  const entry=6+i*16;
  header[entry]=header[entry+1]=sizes[i]===256?0:sizes[i];
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);
  offset+=images[i].length;
}
await fs.writeFile(new URL('icon.ico',directory),Buffer.concat([header,...images]));
await fs.writeFile(new URL('icon.png',directory),images.at(-1));
console.log('Generated controller icon (16–256 px).');
