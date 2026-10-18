import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('controller lifecycle uses configured ports, keeps journal bytes and preserves unrelated routes',{skip:process.platform!=='win32',timeout:120000},async()=>{
 const base=path.resolve('qa-output/controller-tests');await fs.mkdir(base,{recursive:true});
 const fixture=await fs.mkdtemp(path.join(base,'path & fixture-'));
 await fs.cp('local-diary',path.join(fixture,'local-diary'),{recursive:true});
 await fs.symlink(path.resolve('node_modules'),path.join(fixture,'node_modules'),'junction');
 const {stdout}=await exec('powershell.exe',['-NoProfile','-File',path.resolve('tests/controller-core.ps1'),'-Fixture',fixture],{timeout:110000});
 assert.match(stdout,/PASS controller lifecycle/);
});
