import ExcelJS from 'exceljs';
import {MemoryService} from '../src/memory/service.mjs';
import {AgentEngine} from '../src/agents/engine.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createApplication} from '../src/application/server.mjs';import {startWorker} from '../src/workers/production.mjs';import {providerFixture} from './provider-fixture.mjs';
if(process.env.NODE_ENV!=='test'||!process.env.FABRIC_TEST_DATABASE_URL||process.env.DATABASE_URL!==process.env.FABRIC_TEST_DATABASE_URL)throw new Error('Explicit disposable test configuration is required');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('real PostgreSQL, Redis, encrypted S3 and workers; model protocol fixtures explicitly labelled', {timeout:90000},async t=>{
 const fixture=await providerFixture();let app,worker,closed=false;
 t.after(async()=>{if(worker)await worker.close();if(app&&!closed)await app.close();await fixture.close();});
 app=await createApplication();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 await t.test('API liveness remains available while readiness requires an active worker',async()=>{
  assert.equal((await fetch(base+'/api/live')).status,200);
  const absent=await fetch(base+'/api/ready');assert.equal(absent.status,503);assert.equal((await absent.json()).dependencies.find(d=>d.name==='workers').error,'WORKERS_UNAVAILABLE');
  worker=await startWorker();const ready=await fetch(base+'/api/ready');assert.equal(ready.status,200);assert.equal((await ready.json()).dependencies.find(d=>d.name==='workers').ok,true);
 });
 async function register(name){const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,email:name+'-'+Date.now()+'@example.test',password:'disposable runtime password'})});assert.equal(r.status,201);return {data:await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]};}
 const a=await register('Owner'),b=await register('Other');
 async function call(p,{method='GET',data,raw,headers={},user=a}={}){const r=await fetch(base+p,{method,headers:{cookie:user.cookie,'x-csrf-token':user.data.csrf,...(data?{'content-type':'application/json'}:{}),...headers},body:raw??(data?JSON.stringify(data):undefined)});return {r,j:await r.json()};}
 async function job(id){for(let i=0;i<100;i++){const {j}=await call('/api/jobs/'+id);if(['completed','dead_letter','failed','cancelled'].includes(j.status)){assert.equal(j.status,'completed',JSON.stringify(j));return j.output;}await wait(150);}throw new Error('Job did not finish');}
 await t.test('secure sessions, CSRF, origin and tenant boundary',async()=>{
  assert.equal((await call('/api/me')).j.workspace.id,a.data.workspace.id);
  assert.equal((await call('/api/conversations',{method:'POST',data:{},headers:{'x-csrf-token':'wrong'}})).r.status,403);
  assert.equal((await call('/api/conversations',{method:'POST',data:{},headers:{origin:'https://evil.test'}})).r.status,403);
  const {j:c}=await call('/api/conversations',{method:'POST',data:{title:'Persistent conversation'}});a.cid=c.id;
  assert.equal((await call('/api/conversations/'+c.id,{user:b})).r.status,404);
  const hash=(await app.ctx.repo.pool.query('SELECT password_hash FROM users WHERE id=$1',[a.data.user.id])).rows[0].password_hash;assert.match(hash,/^\$argon2id\$/);
  const {j:items}=await call('/api/auth/sessions');assert.equal(items.items.length,1);
 });
 await t.test('provider fixture traverses real gateway tool roundtrip and usage ledger',async()=>{
  const {r,j:p}=await call('/api/providers',{method:'POST',data:{type:'ollama',name:'PROTOCOL FIXTURE—not a live model',baseUrl:fixture.url,defaultModel:'fixture-tools',embeddingModel:'fixture-vectors',contextWindow:32000}});assert.equal(r.status,201,JSON.stringify(p));a.provider=p.id;
  await call('/api/providers/'+p.id+'/default',{method:'POST',data:{}});
  const streamResponse=await fetch(base+'/api/chat/stream',{method:'POST',headers:{cookie:a.cookie,'x-csrf-token':a.data.csrf,'content-type':'application/json'},body:JSON.stringify({conversationId:a.cid,content:'calculate 6 times 7',providerId:p.id})});const stream=await streamResponse.text();assert.match(stream,/calculator returned 42/);assert.match(stream,/event: done/);assert.doesNotMatch(stream,/event: error/);
  const {j:conversation}=await call('/api/conversations/'+a.cid);assert.equal(conversation.messages.length,2);assert.match(conversation.messages[1].content,/42/);
  const rows=(await app.ctx.repo.pool.query('SELECT * FROM usage_ledger WHERE workspace_id=$1',[a.data.workspace.id])).rows;assert.ok(rows.length>=2);assert.ok(rows.some(x=>Number(x.input_tokens)===20&&!x.tokens_estimated));assert.ok(rows.some(x=>x.pricing_version==='unpriced'));
 });
 await t.test('upload executes real asynchronous parser, encrypted object storage and pgvector queries',async()=>{
  const {r,j:file}=await call('/api/files/upload',{method:'POST',raw:'Month,Revenue\nJan,50\nFeb,70\n',headers:{'content-type':'text/csv','x-file-name':'revenue.csv'}});assert.equal(r.status,202,JSON.stringify(file));a.file=file.id;await job(file.jobId);
  const {j:ready}=await call('/api/files/'+file.id);assert.equal(ready.status,'ready');assert.equal(ready.ragStatus,'ready');assert.match(ready.text,/Revenue/);
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const sources=await app.ctx.rag.retrieve(actor,'revenue',[file.id]);assert.equal(sources.length,1);assert.equal(sources[0].fileId,file.id);assert.equal(sources[0].id,1);
  await assert.rejects(app.ctx.rag.retrieve({...actor,workspaceId:b.data.workspace.id},'revenue',[file.id]),{code:'NOT_FOUND'});
  const downloaded=await fetch(base+'/api/files/'+file.id+'/download',{headers:{cookie:a.cookie}});assert.match(await downloaded.text(),/Jan,50/);
 });
 await t.test('real cited chat and successive knowledge/read-file tools preserve source IDs and metadata privacy',async()=>{
  const {j:c}=await call('/api/conversations',{method:'POST',data:{title:'Citation grounding fixture'}});
  async function stream(content,extra={}){const r=await fetch(base+'/api/chat/stream',{method:'POST',headers:{cookie:a.cookie,'x-csrf-token':a.data.csrf,'content-type':'application/json'},body:JSON.stringify({conversationId:c.id,content,providerId:a.provider,...extra})});assert.equal(r.status,200);return r.text();}
  const attached=await stream('Describe the supplied fixture evidence',{fileIds:[a.file],includeFileContext:true,tools:false});assert.match(attached,/event: done/);assert.doesNotMatch(attached,/event: error/);
  let reply=(await call('/api/conversations/'+c.id)).j.messages.at(-1);assert.equal(reply.citationValidation.status,'valid_source_ids');assert.equal(reply.citationValidation.semanticSupportVerified,false);assert.equal(reply.sources[0].fileId,a.file);assert.equal(reply.sources[0].text,undefined);assert.match(reply.sources[0].excerptHash,/^[a-f0-9]{64}$/);
  const tools=await stream('fixture knowledge then read');assert.match(tools,/read-source reference \[2\]/);assert.match(tools,/event: done/);assert.doesNotMatch(tools,/event: error/);
  reply=(await call('/api/conversations/'+c.id)).j.messages.at(-1);assert.deepEqual(reply.citationValidation.usedSourceIds,[2]);assert.deepEqual(reply.sources.map(x=>x.id),[1,2]);assert.equal(reply.sources[1].sourceType,'file_excerpt');assert.ok(reply.sources.every(x=>x.text===undefined));
 });
 await t.test('LLM plan delegates to unchanged deterministic analyst with provenance',async()=>{
  const {j}=await call('/api/agents/data-analyst',{method:'POST',data:{fileIds:[a.file],query:'sum Revenue',providerId:a.provider}});const output=await job(j.jobId);assert.equal(output.plannerMode,'llm');assert.equal(output.operation.facts.value,120);assert.equal(output.operation.facts.provenance.rowsIncluded,2);assert.match(output.answer,/120/);
 });
 await t.test('deterministic tools traverse real HTTP authorization, PostgreSQL audit and agent result bindings',async()=>{
  const listed=await call('/api/tools/execute',{method:'POST',data:{toolId:'list_files',input:{limit:10}}});assert.equal(listed.r.status,200);assert.equal(listed.j.result.items[0].id,a.file);assert.equal(listed.j.result.items[0].text,undefined);assert.equal(listed.j.result.items[0].objectKey,undefined);
  const calculated=await call('/api/tools/execute',{method:'POST',data:{toolId:'analyze_data',input:{fileIds:[a.file],plan:{action:'sum',columns:['Revenue']}}}});assert.equal(calculated.r.status,200);assert.equal(calculated.j.result.value,120);assert.equal(calculated.j.result.provenance.rowsIncluded,2);assert.match(calculated.j.result.provenance.sourceHashes[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal((await call('/api/tools/execute',{method:'POST',user:b,data:{toolId:'analyze_data',input:{fileIds:[a.file],plan:{action:'sum',columns:['Revenue']}}}})).r.status,404);
  const {j:c}=await call('/api/conversations',{method:'POST',data:{title:'Deterministic tool protocol fixture'}});const response=await fetch(base+'/api/chat/stream',{method:'POST',headers:{cookie:a.cookie,'x-csrf-token':a.data.csrf,'content-type':'application/json'},body:JSON.stringify({conversationId:c.id,content:'fixture deterministic analytics',providerId:a.provider})});const events=await response.text();assert.match(events,/deterministic total is 120/);assert.match(events,/event: done/);assert.doesNotMatch(events,/event: error/);
  const {j:run}=await call('/api/agents/run',{method:'POST',data:{task:'fixture deterministic analytics'}});let final;for(let i=0;i<100;i++){final=(await call('/api/agents/runs/'+run.id)).j;if(['completed','failed','cancelled'].includes(final.status))break;await wait(100);}assert.equal(final.status,'completed',JSON.stringify(final));assert.equal(final.state.observations[0].tool,'list_files');assert.equal(final.state.observations[1].tool,'analyze_data');assert.equal(final.state.observations[1].result.value,120);assert.deepEqual(final.state.observations[1].result.provenance.fileIds,[a.file]);
  const recorded=(await app.ctx.repo.pool.query("SELECT tool_name,status FROM tool_executions WHERE workspace_id=$1 AND run_id=$2 ORDER BY created_at",[a.data.workspace.id,run.id])).rows;assert.deepEqual(recorded.map(x=>x.tool_name),['list_files','analyze_data']);assert.ok(recorded.every(x=>x.status==='completed'));
 });
 await t.test('real PostgreSQL agent scheduling and approval resume roll back on injected outbox failure',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const marker='Atomic schedule fixture '+Date.now();const originalCreate=app.ctx.jobs.create.bind(app.ctx.jobs);
  app.ctx.jobs.create=async()=>{throw new Error('Explicit test-only outbox insertion failure')};
  try{const response=await call('/api/agents/run',{method:'POST',data:{task:marker}});assert.equal(response.r.status,500);assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM agent_runs WHERE workspace_id=$1 AND objective=$2',[actor.workspaceId,marker])).rows[0].count,'0');}
  finally{app.ctx.jobs.create=originalCreate;}
  const run=await app.ctx.agents.create(actor,'Explicit waiting-action transaction fixture');const approvalId=await app.ctx.tools.requestApproval(actor,'remember',{content:'Transaction fixture—not executed',scope:'user'},run.id);
  await app.ctx.repo.agent_runs.update(actor.workspaceId,run.id,{status:'waiting_approval',state:{index:0,observations:[],attempts:0,approvalId}});
  app.ctx.jobs.create=async()=>{throw new Error('Explicit test-only resume insertion failure')};
  try{const response=await call('/api/approvals/'+approvalId,{method:'POST',data:{approved:true}});assert.equal(response.r.status,500);assert.equal((await app.ctx.repo.pool.query('SELECT status FROM approvals WHERE id=$1',[approvalId])).rows[0].status,'pending');assert.equal((await app.ctx.repo.agent_runs.require(actor.workspaceId,run.id)).status,'waiting_approval');assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM jobs WHERE workspace_id=$1 AND idempotency_key=$2',[actor.workspaceId,'resume-'+approvalId])).rows[0].count,'0');}
  finally{app.ctx.jobs.create=originalCreate;}
  assert.equal((await call('/api/approvals/'+approvalId,{method:'POST',data:{approved:false}})).r.status,200);assert.equal((await app.ctx.repo.agent_runs.require(actor.workspaceId,run.id)).status,'cancelled');
 });
 await t.test('agent plans, executes calculator and verifies results with durable transitions',async()=>{
  const {r,j:run}=await call('/api/agents/run',{method:'POST',data:{task:'calculate 6 times 7'}});assert.equal(r.status,202);
  let final;for(let i=0;i<100;i++){final=(await call('/api/agents/runs/'+run.id)).j;if(['completed','failed','cancelled'].includes(final.status))break;await wait(100);}assert.equal(final.status,'completed',JSON.stringify(final));assert.equal(final.state.observations[0].result.value,42);assert.match(final.output,/42/);
  const replay=await app.ctx.agents.execute(await app.ctx.auth.authenticate(a.cookie.split('=')[1]),run.id);assert.equal(replay.status,'completed');
 });
 await t.test('dangerous tools bind single-use approvals to exact arguments',async()=>{
  const input={content:'Prefer short project summaries',scope:'user'};
  const {j:pending}=await call('/api/tools/execute',{method:'POST',data:{toolId:'remember',input}});assert.equal(pending.status,'waiting_approval');await call('/api/approvals/'+pending.approvalId,{method:'POST',data:{approved:true}});
  const bad=await call('/api/tools/execute',{method:'POST',data:{toolId:'remember',input:{...input,content:'Different action'},approvalId:pending.approvalId}});assert.equal(bad.r.status,403);
  const ok=await call('/api/tools/execute',{method:'POST',data:{toolId:'remember',input,approvalId:pending.approvalId}});assert.equal(ok.r.status,200,JSON.stringify(ok.j));
  assert.equal((await call('/api/tools/execute',{method:'POST',data:{toolId:'remember',input,approvalId:pending.approvalId}})).r.status,403);
  const memories=(await call('/api/memory')).j.items;assert.equal(memories.length,1);assert.equal((await call('/api/memory',{user:b})).j.items.length,0);
 });
 await t.test('real idempotency, cancellation and viewer authorization',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const [j1,j2]=await Promise.all([app.ctx.jobs.create(actor,'cleanup',{},'same-'+a.cid),app.ctx.jobs.create(actor,'cleanup',{},'same-'+a.cid)]);assert.equal(j1.id,j2.id);await assert.rejects(app.ctx.jobs.create(actor,'cleanup',{different:true},'same-'+a.cid),{code:'IDEMPOTENCY_CONFLICT'});
  const queued=await app.ctx.jobs.create(actor,'cleanup',{},'cancel-'+a.cid);await app.ctx.jobs.cancel(actor,queued.id);await wait(1500);assert.equal((await app.ctx.repo.jobs.require(actor.workspaceId,queued.id)).status,'cancelled');
  await app.ctx.repo.setMember(actor.workspaceId,b.data.user.id,'viewer');await call('/api/workspaces/switch',{method:'POST',data:{workspaceId:actor.workspaceId},user:b});assert.equal((await call('/api/conversations',{method:'POST',data:{},user:b})).r.status,403);assert.equal((await call('/api/tools/execute',{method:'POST',data:{toolId:'calculator',input:{expression:'1+1'}},user:b})).r.status,403);
 });
 await t.test('editing preserves prior content and never edits another tenant',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const conversation=await app.ctx.conversations.create(actor,{title:'Editing test'});const message=await app.ctx.repo.createMessage(actor,conversation.id,{role:'user',content:'original request'});const reply=await app.ctx.repo.createMessage(actor,conversation.id,{role:'assistant',content:'original answer'});
  assert.equal((await call('/api/messages/'+message.id,{method:'PATCH',data:{content:'edited request'},user:b})).r.status,403);
  const edited=await call('/api/messages/'+message.id,{method:'PATCH',data:{content:'edited request'}});assert.equal(edited.r.status,200,JSON.stringify(edited.j));const messages=await app.ctx.repo.messages(actor.workspaceId,conversation.id);assert.equal(messages[0].content,'edited request');assert.equal(messages[0].revisions[0].content,'original request');assert.equal(messages[1].status,'superseded');
 });
 await t.test('memory expiry, paged review, opt-out races and stale roles use real PostgreSQL',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const expiry=new Date(Date.now()+86400000).toISOString();
  const created=await call('/api/memory',{method:'POST',data:{content:'Expiring explicit project fact',expiresAt:expiry}});assert.equal(created.r.status,201,JSON.stringify(created.j));assert.equal(created.j.expiresAt,expiry);await job(created.j.jobId);
  const expired=await app.ctx.repo.memories.create(actor.workspaceId,{userId:actor.user.id,scope:'user',content:'Expired review-only fact',expiresAt:'2000-01-01'});
  assert.ok(!(await call('/api/memory?limit=100')).j.items.some(m=>m.id===expired.id));assert.equal((await call('/api/memory?limit=100&includeExpired=true')).j.items.find(m=>m.id===expired.id).expired,true);
  const page=await call('/api/memory?limit=1&offset=0');assert.equal(page.j.items.length,1);assert.equal(page.j.nextOffset,1);
  assert.equal((await call('/api/memory?limit=101')).r.status,400);assert.equal((await call('/api/memory?includeExpired=1')).r.status,400);
  await assert.rejects(app.ctx.memory.add({workspaceId:actor.workspaceId,user:{id:b.data.user.id},role:'admin'},{content:'Stale administrator write',scope:'workspace'}),{code:'FORBIDDEN'});
  const racing=new MemoryService({repo:app.ctx.repo,jobs:app.ctx.jobs,env:{FABRIC_MEMORY_MAX_DISTANCE:2},ai:{embed:async(...args)=>{const value=await app.ctx.ai.embed(...args);await app.ctx.memory.toggle(actor,false);return value;}}});
  try {assert.deepEqual(await racing.retrieve(actor,'explicit project fact'),[]);} finally {await app.ctx.memory.toggle(actor,true);}
  await app.ctx.memory.remove(actor,created.j.id);const removed=(await app.ctx.repo.pool.query('SELECT deleted_at,embedding FROM memories WHERE id=$1',[created.j.id])).rows[0];assert.ok(removed.deleted_at);assert.equal(removed.embedding,null);
 });
 await t.test('queued memory backfill respects ownership, expiry, deletion and fresh opt-out',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);
  const own=await app.ctx.repo.memories.create(actor.workspaceId,{userId:actor.user.id,scope:'user',content:'Imported explicit fixture preference'});
  const workspace=await app.ctx.repo.memories.create(actor.workspaceId,{scope:'workspace',content:'Shared fixture project context'});
  const privateOther=await app.ctx.repo.memories.create(actor.workspaceId,{userId:b.data.user.id,scope:'user',content:'Other user private context'});
  const expired=await app.ctx.repo.memories.create(actor.workspaceId,{userId:actor.user.id,scope:'user',content:'Expired context',expiresAt:'2000-01-01'});
  const sensitive=await app.ctx.repo.memories.create(actor.workspaceId,{userId:actor.user.id,scope:'user',content:'Legacy api key: explicitly-sensitive-test-fixture'});
  const {r,j:queued}=await call('/api/memory/reindex',{method:'POST',data:{limit:50}});assert.equal(r.status,202);const output=await job(queued.jobId);assert.ok(output.indexed>=2);assert.equal(output.skippedSensitive,1);assert.ok(!fixture.embeddingInputs.includes(sensitive.content),'Sensitive imported text must not be transmitted for embedding');
  const indexed=(await app.ctx.repo.pool.query('SELECT id,embedding IS NOT NULL AS indexed FROM memories WHERE id=ANY($1)',[[own.id,workspace.id,privateOther.id,expired.id,sensitive.id]])).rows;
  assert.equal(indexed.find(x=>x.id===own.id).indexed,true);assert.equal(indexed.find(x=>x.id===workspace.id).indexed,true);assert.equal(indexed.find(x=>x.id===privateOther.id).indexed,false);assert.equal(indexed.find(x=>x.id===expired.id).indexed,false);assert.equal(indexed.find(x=>x.id===sensitive.id).indexed,false);
  await app.ctx.memory.toggle(actor,false);assert.equal((await call('/api/memory/reindex',{method:'POST',data:{}})).r.status,409);assert.deepEqual(await app.ctx.memory.retrieve(actor,'fixture'),[]);await app.ctx.memory.toggle(actor,true);
  const deleted=await app.ctx.repo.memories.create(actor.workspaceId,{userId:actor.user.id,scope:'user',content:'Delete while indexing fixture'});
  const racing=new MemoryService({repo:app.ctx.repo,jobs:app.ctx.jobs,ai:{embed:async(...args)=>{const result=await app.ctx.ai.embed(...args);await app.ctx.repo.memories.delete(actor.workspaceId,deleted.id);return result;}}});
  const skipped=await racing.reindex(actor,{ids:[deleted.id]});assert.equal(skipped.indexed,0);assert.equal(skipped.skipped,1);assert.equal((await app.ctx.repo.pool.query('SELECT embedding IS NULL AS empty FROM memories WHERE id=$1',[deleted.id])).rows[0].empty,true);
 });
 await t.test('agent step dependencies, bounded tail replanning and multi-action approval resumes use real durable tools',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);
  // This planner is explicitly a protocol-independent test fixture, not a live-model claim.
  const planner={generate:async(_actor,{requestId,messages})=>{
   const data=messages.at(-1).content;
   if(requestId.endsWith('/plan')){
    const steps=data==='chain'?[{title:'First result',tool:'calculator',input:{expression:'6*7'}},{title:'Use previous value',tool:'calculator',input:{expression:{$concat:[{$fromStep:0,path:['value']},'*2']}}}]:data==='repair'?[{title:'Keep completed action',tool:'calculator',input:{expression:'6*7'}},{title:'Bad read input',tool:'calculator',input:{expression:'1+'}}]:[{title:'Save first explicit memory',tool:'remember',input:{content:'Approval regression fixture one',scope:'user'}},{title:'Save second explicit memory',tool:'remember',input:{content:'Approval regression fixture two',scope:'user'}}];
    return {text:JSON.stringify({objective:data,steps,successCriteria:'All planned tool results are present'})};
   }
   if(requestId.includes('/repair/'))return {text:JSON.stringify({steps:[{title:'Use prior completed result',tool:'calculator',input:{expression:{$concat:[{$fromStep:0,path:['value']},'+1']}}}]})};
   const observations=JSON.parse(data).observations;return {text:JSON.stringify({verified:true,answer:'Fixture verified actual results: '+JSON.stringify(observations.filter(o=>o.result).map(o=>o.result))})};
  }};
  const engine=new AgentEngine({repo:app.ctx.repo,ai:planner,tools:app.ctx.tools,env:{MAX_AGENT_STEPS:'4',MAX_TOTAL_RUNTIME:'120000'}});
  const chained=await engine.create(actor,'chain');const chainResult=await engine.execute(actor,chained.id);assert.equal(chainResult.status,'completed');assert.equal(chainResult.state.observations[1].result.value,84);assert.equal(chainResult.state.executionCount,2);assert.ok(chainResult.state.runtimeMs>0);
  const repaired=await engine.create(actor,'repair');const repairResult=await engine.execute(actor,repaired.id);assert.equal(repairResult.status,'completed',JSON.stringify(repairResult));assert.equal(repairResult.state.executionCount,3);assert.equal(repairResult.state.observations.at(-1).result.value,43);assert.equal(repairResult.state.observations.filter(o=>o.index===0).length,1,'Completed steps must not replay');
  const limited=new AgentEngine({repo:app.ctx.repo,ai:planner,tools:app.ctx.tools,env:{MAX_AGENT_STEPS:'2',MAX_TOTAL_RUNTIME:'120000'}});
  const approvalRun=await limited.create(actor,'approval');let waiting=await limited.execute(actor,approvalRun.id);assert.equal(waiting.status,'waiting_approval');assert.equal(waiting.state.executionCount,0);const first=waiting.state.approvalId;
  await app.ctx.tools.decision(actor,first,true);waiting=await limited.execute(actor,approvalRun.id,{approvalId:first});assert.equal(waiting.status,'waiting_approval');assert.equal(waiting.state.executionCount,1);assert.notEqual(waiting.state.approvalId,first);
  await app.ctx.tools.decision(actor,waiting.state.approvalId,true);const done=await limited.execute(actor,approvalRun.id,{approvalId:waiting.state.approvalId});assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.state.executionCount,2);assert.ok(done.state.runtimeMs>=waiting.state.runtimeMs);
  const exhausted=await limited.create(actor,'approval');await app.ctx.repo.agent_runs.update(actor.workspaceId,exhausted.id,{state:{index:0,observations:[],attempts:0,runtimeMs:120000}});const failure=await limited.execute(actor,exhausted.id);assert.equal(failure.status,'failed');assert.equal(failure.error,'AGENT_RUNTIME_LIMIT');
 });
 await t.test('bounded history cursors and response versions preserve real prior replies',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);
  const conversation=await app.ctx.conversations.create(actor,{title:'Versioned history'});
  // Deliberately populate more than one bounded page using a single real SQL insert.
  await app.ctx.repo.pool.query("INSERT INTO messages(id,workspace_id,conversation_id,user_id,role,content,status,created_at) SELECT 'page_fixture_'||$3||'_'||lpad(n::text,3,'0'),$1,$2,$4,'user','History row '||n,'complete',now()-interval '1 day'+n*interval '1 second' FROM generate_series(1,105) n",[actor.workspaceId,conversation.id,Date.now().toString(),actor.user.id]);
  const first=(await call('/api/conversations/'+conversation.id+'?limit=100')).j;assert.equal(first.messages.length,100);assert.ok(first.messagesNextCursor);
  const older=(await call('/api/conversations/'+conversation.id+'?limit=100&before='+first.messagesNextCursor)).j;assert.equal(older.messages.length,5);assert.equal(older.messagesNextCursor,null);assert.equal(new Set([...first.messages,...older.messages].map(m=>m.id)).size,105);
  assert.equal((await call('/api/conversations/'+conversation.id+'?limit=1000')).r.status,400);
  const latest=await app.ctx.repo.latestUserMessage(actor.workspaceId,conversation.id);let reply1=await app.ctx.repo.completeAssistantReply(actor,conversation.id,{role:'assistant',content:'First real stored response'},latest.id);const reply2=await app.ctx.repo.completeAssistantReply(actor,conversation.id,{role:'assistant',content:'Second real stored response'},latest.id);reply1=await app.ctx.repo.message(actor.workspaceId,reply1.id);assert.equal(reply1.status,'superseded');assert.equal(reply2.previousVersionId,reply1.id);assert.equal(reply2.replyTo,latest.id);
  const active=await app.ctx.repo.activeMessages(actor.workspaceId,conversation.id,{limit:4});assert.ok(active.some(m=>m.id===reply2.id));assert.ok(!active.some(m=>m.id===reply1.id));
  await assert.rejects(app.ctx.repo.completeAssistantReply(actor,conversation.id,{role:'assistant',content:'Invalid old-turn reply'},older.messages[0].id),{code:'REPLY_TURN_CHANGED'});
  const versionCount=(await app.ctx.repo.pool.query("SELECT count(*) FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND role='assistant'",[actor.workspaceId,conversation.id])).rows[0].count;assert.equal(versionCount,'2');
 });
 await t.test('artifact metadata failure compensates real object storage writes',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const originalPut=app.ctx.storage.put.bind(app.ctx.storage);let uploaded;
  app.ctx.storage.put=async input=>{uploaded=input;return originalPut(input)};
  await app.ctx.repo.pool.query("CREATE FUNCTION reject_fixture_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Explicit artifact failure fixture'; END $$; CREATE TRIGGER reject_fixture_artifact BEFORE INSERT ON artifacts FOR EACH ROW EXECUTE FUNCTION reject_fixture_artifact()");
  try{await assert.rejects(app.ctx.artifacts.report(actor,{name:'Compensation fixture',result:{value:84}}));assert.ok(uploaded);await assert.rejects(app.ctx.storage.get({workspaceId:actor.workspaceId,objectId:uploaded.objectId}));assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM artifacts WHERE id=$1',[uploaded.objectId])).rows[0].count,'0');}
  finally{app.ctx.storage.put=originalPut;await app.ctx.repo.pool.query('DROP TRIGGER reject_fixture_artifact ON artifacts; DROP FUNCTION reject_fixture_artifact()');}
  const successful=await app.ctx.artifacts.report(actor,{name:'Actual report',result:{value:84}});const downloaded=await app.ctx.artifacts.download(actor,successful.id);const chunks=[];for await(const chunk of downloaded.object.Body)chunks.push(chunk);assert.equal(JSON.parse(Buffer.concat(chunks).toString()).value,84);
 });
 await t.test('logical deletion and retryable physical cleanup use real PostgreSQL, Redis and S3',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);
  const {r,j:file}=await call('/api/files/upload',{method:'POST',raw:'Month,Revenue\nJan,9\n',headers:{'content-type':'text/csv','x-file-name':'delete.csv'}});assert.equal(r.status,202);await job(file.jobId);
  const remove=worker.ctx.storage.delete.bind(worker.ctx.storage);let faults=0;
  // Explicit transient storage fault: all subsequent operations use the real S3 client.
  worker.ctx.storage.delete=async input=>{if(input.objectId===file.id&&faults++===0){const e=new Error('Injected storage outage');e.status=503;throw e;}return remove(input)};
  try{
   const deleted=await call('/api/files/'+file.id,{method:'DELETE'});assert.equal(deleted.r.status,200);assert.equal(deleted.j.storageStatus,'queued');assert.ok(deleted.j.cleanupJobId);
   assert.equal((await call('/api/files/'+file.id)).r.status,404);assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM rag_chunks WHERE workspace_id=$1 AND file_id=$2',[actor.workspaceId,file.id])).rows[0].count,'0');
   assert.equal((await call('/api/jobs/'+deleted.j.cleanupJobId+'/cancel',{method:'POST',data:{}})).r.status,409);
   await job(deleted.j.cleanupJobId);const record=await app.ctx.repo.jobs.require(actor.workspaceId,deleted.j.cleanupJobId);assert.equal(record.attempts,2);assert.equal(record.maxAttempts,4);assert.equal(record.error,null);
   for(const objectId of [file.id,file.id+'.text'])await assert.rejects(app.ctx.storage.get({workspaceId:actor.workspaceId,objectId}),e=>e.$metadata?.httpStatusCode===404);
   const again=await call('/api/files/'+file.id,{method:'DELETE'});assert.equal(again.j.cleanupJobId,record.id);assert.equal(again.j.storageStatus,'completed');
  }finally{worker.ctx.storage.delete=remove;}
 });
 await t.test('permanent cleanup failures are visible and administrator retries are bounded and idempotent',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const artifact=await app.ctx.artifacts.report(actor,{name:'Cleanup retry fixture',result:{value:42}});
  const remove=worker.ctx.storage.delete.bind(worker.ctx.storage);
  worker.ctx.storage.delete=async input=>{if(input.objectId===artifact.id){const e=new Error('Injected access denial');e.status=403;throw e;}return remove(input)};
  let cleanup;
  try{
   const deleted=await call('/api/artifacts/'+artifact.id,{method:'DELETE'});assert.equal(deleted.r.status,200);cleanup=deleted.j.cleanupJobId;
   for(let i=0;i<100;i++){const record=await app.ctx.repo.jobs.require(actor.workspaceId,cleanup);if(record.status==='dead_letter'){assert.equal(record.attempts,1);break;}await wait(100);}
   assert.equal((await app.ctx.repo.jobs.require(actor.workspaceId,cleanup)).status,'dead_letter');
   const retained=await app.ctx.storage.get({workspaceId:actor.workspaceId,objectId:artifact.id});await retained.Body.transformToString();
  }finally{worker.ctx.storage.delete=remove;}
  assert.equal((await call('/api/jobs/'+cleanup+'/retry-cleanup',{method:'POST',data:{},user:b})).r.status,403);
  const retry=await call('/api/jobs/'+cleanup+'/retry-cleanup',{method:'POST',data:{}});assert.equal(retry.r.status,202);await job(retry.j.jobId);
  const same=await call('/api/jobs/'+cleanup+'/retry-cleanup',{method:'POST',data:{}});assert.equal(same.j.jobId,retry.j.jobId);
  await assert.rejects(app.ctx.storage.get({workspaceId:actor.workspaceId,objectId:artifact.id}),e=>e.$metadata?.httpStatusCode===404);
  const live=await app.ctx.artifacts.report(actor,{name:'Never delete live fixture',result:{value:9}});
  const invalid=await app.ctx.jobs.create(actor,'storage-delete',{entity:'artifact',id:live.id});await app.ctx.jobs.dispatch();
  for(let i=0;i<100;i++){if((await app.ctx.repo.jobs.require(actor.workspaceId,invalid.id)).status==='dead_letter')break;await wait(100);}
  const denied=await app.ctx.repo.jobs.require(actor.workspaceId,invalid.id);assert.equal(denied.status,'dead_letter');assert.equal(denied.attempts,1);assert.equal(denied.error,'CLEANUP_NOT_AUTHORIZED');
  const retained=await app.ctx.storage.get({workspaceId:actor.workspaceId,objectId:live.id});await retained.Body.transformToString();
 });
 await t.test('cleanup survives membership revocation but ordinary queued jobs fail closed with accurate terminal state',async()=>{
  const temp=await register('Revoked');const actor=await app.ctx.auth.authenticate(temp.cookie.split('=')[1]);
  const artifact=await app.ctx.artifacts.report(actor,{name:'Revoked member cleanup',result:{value:7}});
  await worker.worker.pause();let cleaned,ordinary;
  try{
   cleaned=await app.ctx.artifacts.delete(actor,artifact.id);ordinary=await app.ctx.jobs.create(actor,'cleanup',{});
   await app.ctx.repo.pool.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2',[actor.workspaceId,actor.user.id]);
   await app.ctx.jobs.dispatch();
  }finally{await worker.worker.resume();}
  for(let i=0;i<100;i++){const c=await app.ctx.repo.jobs.require(actor.workspaceId,cleaned.cleanupJobId),o=await app.ctx.repo.jobs.require(actor.workspaceId,ordinary.id);if(c.status==='completed'&&o.status==='dead_letter')break;await wait(100);}
  assert.equal((await app.ctx.repo.jobs.require(actor.workspaceId,cleaned.cleanupJobId)).status,'completed');const denied=await app.ctx.repo.jobs.require(actor.workspaceId,ordinary.id);assert.equal(denied.status,'dead_letter');assert.equal(denied.error,'FORBIDDEN');assert.equal(denied.attempts,1);
  await assert.rejects(app.ctx.storage.get({workspaceId:actor.workspaceId,objectId:artifact.id}),e=>e.$metadata?.httpStatusCode===404);
 });
 await t.test('deletion during RAG embedding cannot republish indexed chunks or strand newly produced text',async()=>{
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const {j:file}=await call('/api/files/upload',{method:'POST',raw:'Month,Revenue\nJan,8\n',headers:{'content-type':'text/csv','x-file-name':'race.csv'}});await job(file.jobId);
  const original=app.ctx.rag.ai;let cleaned;
  app.ctx.rag.ai={embed:async(...args)=>{const result=await original.embed(...args);cleaned=await app.ctx.files.delete(actor,file.id);return result;}};
  try{await assert.rejects(app.ctx.rag.index(actor,file,[{pageNumber:1,text:'Racing indexed content'}]),{code:'NOT_FOUND'});}finally{app.ctx.rag.ai=original;}
  await job(cleaned.cleanupJobId);assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM rag_chunks WHERE workspace_id=$1 AND file_id=$2',[actor.workspaceId,file.id])).rows[0].count,'0');
 });
 await t.test('real queued CSV/XLSX processing preserves logical rows, worksheet provenance and permanent parser failures',async()=>{
  const good=await call('/api/files/upload',{method:'POST',raw:'Region,Revenue,Note\nWest,-20,"one\ntwo"\nEast,50,plain\n',headers:{'content-type':'text/csv','x-file-name':'multiline.csv'}});assert.equal(good.r.status,202);await job(good.j.jobId);
  const actor=await app.ctx.auth.authenticate(a.cookie.split('=')[1]);const facts=await app.ctx.tools.execute(actor,'analyze_data',{fileIds:[good.j.id],plan:{action:'sum',columns:['Revenue']}});assert.equal(facts.value,30);assert.equal(facts.provenance.rowsIncluded,2);assert.equal(facts.provenance.parserVersion,'fabric-dataset-v2');
  const book=new ExcelJS.Workbook();for(const [name,amount]of [['Jan',-20],['Feb',50]]){const sheet=book.addWorksheet(name);sheet.addRow(['Region','Revenue']);sheet.addRow([name,amount]);}
  const xlsx=await call('/api/files/upload',{method:'POST',raw:await book.xlsx.writeBuffer(),headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-file-name':'compatible.xlsx'}});assert.equal(xlsx.r.status,202);await job(xlsx.j.jobId);const total=await app.ctx.tools.execute(actor,'analyze_data',{fileIds:[xlsx.j.id],plan:{action:'sum',columns:['Revenue']}});assert.equal(total.value,30);assert.equal(total.provenance.sourceWorksheets[0].worksheets.length,2);assert.equal(total.provenance.sourceWorksheets[0].formulaResults,'cached_not_recalculated');
  const bad=await call('/api/files/upload',{method:'POST',raw:'FixtureLabel,Value\n"unterminated,2',headers:{'content-type':'text/csv','x-file-name':'malformed.csv'}});assert.equal(bad.r.status,202);let failed;
  for(let i=0;i<100;i++){failed=await app.ctx.repo.jobs.require(actor.workspaceId,bad.j.jobId);if(['failed','dead_letter'].includes(failed.status))break;await wait(100);}assert.equal(failed.status,'dead_letter');assert.equal(failed.attempts,1);assert.equal(failed.error,'DATASET_CSV_INVALID');const record=await app.ctx.repo.files.require(actor.workspaceId,bad.j.id);assert.equal(record.status,'failed');assert.equal(record.error,'DATASET_CSV_INVALID');assert.equal((await app.ctx.repo.pool.query('SELECT count(*) FROM rag_chunks WHERE workspace_id=$1 AND file_id=$2',[actor.workspaceId,bad.j.id])).rows[0].count,'0');
 });
 await t.test('restart retains PostgreSQL history without flux.json',async()=>{
  await app.close();closed=true;const second=await createApplication();try{const actor=await second.ctx.auth.authenticate(a.cookie.split('=')[1]);assert.ok(actor);assert.equal((await second.ctx.repo.messages(actor.workspaceId,a.cid)).length,2);await assert.rejects(fs.access(process.env.FABRIC_DATA_DIR+'/flux.json'));}finally{await second.close();}
 });
});
