import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const runtime=fs.readFileSync(new URL('../src/native-runtime.mjs',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
test('Fabric fast performance settings reduce cold and normal response cost',()=>{
  assert.match(runtime,/FABRIC_NATIVE_THREADS/);
  assert.match(runtime,/FABRIC_NATIVE_CONTEXT \|\| 4096/);
  assert.match(runtime,/'-t'/);
  assert.match(server,/history:4/);
  assert.match(server,/Hello — Fabric1\.0 is ready/);
  assert.match(server,/performance==='fast'\?256/);assert.match(server,/cache_prompt:true/);
});
