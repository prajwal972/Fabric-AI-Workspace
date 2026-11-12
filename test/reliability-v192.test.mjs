import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.FABRIC_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-reliable-'));
process.env.FABRIC_MASTER_KEY='reliability-test-master-key-32!!';
const {internals}=await import('../src/server.mjs?reliability=192');
test('Windows synchronized-folder rename failures fall back to direct persistence',async()=>{const writes=[],file=path.join(os.tmpdir(),'fabric-fallback.json'),ops={async writeFile(name,value){writes.push({name,value})},async rename(){const error=Error('operation not permitted');error.code='EPERM';throw error},async rm(){}};const result=await internals.persistSnapshot(file,'{"ok":true}',ops);assert.equal(result.mode,'direct-with-backup');assert.equal(writes.at(-1).name,file);assert.equal(writes.at(-1).value,'{"ok":true}')});
test('Fabric deterministic analyst creates semantic metrics and evidence-backed charts',()=>{const file={id:'f1',name:'sales.csv',kind:'text',status:'ready',extraction:'text',text:'region,revenue,date\nWest,70,2026-01-01\nEast,50,2026-01-01\nWest,30,2026-02-01'},result=internals.executeAnalystEngine({files:[file],query:'Create a revenue dashboard'});assert.equal(result.dashboard.metrics.find(x=>x.id==='total_revenue').rawValue,150);const category=result.dashboard.visuals.find(x=>x.id==='revenue_by_region');assert.deepEqual(category.labels,['West','East']);assert.deepEqual(category.values,[100,50]);assert.match(result.dashboard.story.summary,/3 records/)});
test('frontend includes Windows voice fallback and automatic analyst extraction wait',()=>{const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');assert.match(app,/Switching to Windows Speech Recognition/);assert.match(app,/voiceRecorder\?\.state==='recording'/);assert.match(app,/for\(let i=0;i<80;i\+\+\)/);assert.match(server,/LOCALAPPDATA/);assert.match(server,/waitForFilesReady/);assert.match(server,/Ollama is not reachable at/)})
