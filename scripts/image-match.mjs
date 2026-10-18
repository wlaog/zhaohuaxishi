import sharp from 'sharp';
// Compare only same-aspect pictures. Used to recognize OneNote's re-rasterized
// individual pictures, never to replace a composite containing different content.
export async function fingerprint(bytes){
 const im=sharp(bytes),meta=await im.metadata();
 const pixels=await im.resize(64,64,{fit:'fill'}).flatten({background:'#fff'}).greyscale().raw().toBuffer();
 return {pixels,ratio:meta.width/meta.height,width:meta.width,height:meta.height};
}
export function imageDistance(a,b){
 if(Math.abs(Math.log(a.ratio/b.ratio))>.035)return Infinity;
 let total=0;for(let i=0;i<a.pixels.length;i++)total+=Math.abs(a.pixels[i]-b.pixels[i]);
 return total/(a.pixels.length*255);
}
