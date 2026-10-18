import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('PowerShell acquisition waits for loading and rejects partial or divergent section inventories',{skip:process.platform!=='win32'},()=>{
 const output=execFileSync('powershell.exe',['-NoProfile','-STA','-File',fileURLToPath(new URL('./hierarchy-acquisition.ps1',import.meta.url))],{encoding:'utf8',timeout:30000});
 assert.match(output,/PASS complete, stable/);
});
