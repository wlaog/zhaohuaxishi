import sharp from 'sharp';
export async function placeholderEvidence(bytes){
 const metadata=await sharp(bytes).metadata();
 const thumb=await sharp(bytes).flatten({background:'#fff'}).resize(128,128,{fit:'fill'}).png().toBuffer();
 const stats=await sharp(thumb).stats();
 const white=stats.channels.every(c=>c.mean>250&&c.stdev<8);
 return {width:metadata.width,height:metadata.height,entropy:stats.entropy,blank:metadata.width>=128&&metadata.height>=128&&white&&stats.entropy<.35};
}

// A visual review applies only to an almost empty final raster strip, and
// expires if either the source, native document or strip bytes change.
export function reviewedWhitespaceStrip(review, actual){
 if(review?.type!=='trailing-whitespace'||!review.reason?.trim()||!Number.isFinite(Date.parse(review.reviewedAt)))return false;
 if(!actual.lastStrip||!actual.evidence.blank||actual.evidence.entropy>=.01)return false;
 return ['key','src','sourceHash','nativeHash','imageHash'].every(field=>typeof actual[field]==='string'&&actual[field]===review[field])
  && ['sourceHash','nativeHash','imageHash'].every(field=>/^[a-f0-9]{64}$/.test(actual[field]));
}
