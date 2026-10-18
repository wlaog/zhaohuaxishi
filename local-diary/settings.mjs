import fs from 'node:fs/promises';
import path from 'node:path';

export function validateSettings(value = {}) {
  const settings={version:1,port:value.port??8766,httpsPort:value.httpsPort??443};
  for(const name of ['port','httpsPort'])if(!Number.isInteger(settings[name])||settings[name]<1||settings[name]>65535)throw Error('访问端口必须是 1–65535 的整数');
  return settings;
}

export async function loadSettings(project) {
  try{return validateSettings(JSON.parse(await fs.readFile(path.join(project,'local-state/diary-settings.json'),'utf8')));}
  catch(error){if(error.code==='ENOENT')return validateSettings();throw error;}
}
