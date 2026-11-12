import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return}catch{}await sleep(60)}throw Error('startup failed')}
async function body(req){const chunks=[];for await(const c of req)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString()||'{}')}

test('local Ollama drives website mode and ZIP export',async t=>{
  const ollamaPort=20200+Math.floor(Math.random()*200),fluxPort=20500+Math.floor(Math.random()*200),dir=fs.mkdtempSync(path.join(os.tmpdir(),'flux-local-'));
  let lastChat=null;
  const ollama=http.createServer(async(req,res)=>{
    if(req.url==='/api/tags'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({models:[{name:'qwen-test:latest'}]}))}
    if(req.url==='/api/chat'&&req.method==='POST'){lastChat=await body(req);res.setHeader('content-type','application/x-ndjson');const analyst=lastChat.messages[0].content.includes('Data Analyst Agent'),content=analyst?JSON.stringify({summary:'Revenue grew',insights:['West leads'],dashboard:{title:'Sales overview',kpis:[{label:'Revenue',value:'120',detail:'Total'}],charts:[{type:'bar',title:'Revenue by region',labels:['West','East'],values:[70,50]}]},answer:'West is the strongest region.'}):'```file path="index.html"\n<h1>Hello local</h1>\n```\n';res.write(JSON.stringify({message:{content}})+'\n');res.end(JSON.stringify({done:true,prompt_eval_count:20,eval_count:12})+'\n');return}
    res.statusCode=404;res.end()
  });
  await new Promise(r=>ollama.listen(ollamaPort,'127.0.0.1',r));
  const searx=http.createServer((req,res)=>{if(req.url?.startsWith('/search')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({results:[{title:'Local research evidence',url:'http://127.0.0.1:9/blocked',content:'Verified local research snippet'}]}))}res.statusCode=404;res.end()});await new Promise(r=>searx.listen(8080,'127.0.0.1',r));
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:process.cwd(),env:{...process.env,FLUX_PORT:String(fluxPort),FLUX_DATA_DIR:dir,FLUX_MASTER_KEY:'local-test-master-key-32-characters!!'},stdio:'ignore'});
  t.after(()=>{child.kill();ollama.close();searx.close()});await wait('http://127.0.0.1:'+fluxPort+'/api/health');
  let r=await fetch('http://127.0.0.1:'+fluxPort+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Local Test',email:'local@example.com',password:'long secure password'})});assert.equal(r.status,201);const cookie=r.headers.get('set-cookie').split(';')[0],reg=await r.json(),h={cookie,'content-type':'application/json','x-csrf-token':reg.csrf};
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/providers',{method:'POST',headers:h,body:JSON.stringify({type:'ollama',name:'Local Ollama',baseUrl:'http://127.0.0.1:'+ollamaPort})});assert.equal(r.status,201);const provider=await r.json();
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/providers/'+provider.id+'/validate',{method:'POST',headers:h,body:'{}'});assert.equal(r.status,200);
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/providers/'+provider.id+'/models',{headers:{cookie}});assert.equal(r.status,200);{const models=(await r.json()).items;assert.ok(models.some(x=>x.id==='qwen-test:latest'));assert.ok(!models.some(x=>x.id==='fabric:1.0'));}
  await fetch('http://127.0.0.1:'+fluxPort+'/api/providers/'+provider.id+'/default',{method:'POST',headers:h,body:'{}'});
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/files/upload',{method:'POST',headers:{...h,'x-file-name':encodeURIComponent('sales.csv'),'x-file-type':'text/csv'},body:'region,revenue\nWest,70\nEast,50'});assert.equal(r.status,201);const dataFile=await r.json();for(let i=0;i<30;i++){r=await fetch('http://127.0.0.1:'+fluxPort+'/api/files',{headers:{cookie}});const item=(await r.json()).items.find(x=>x.id===dataFile.id);if(item?.status==='ready')break;await sleep(20)}
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/agents/data-analyst',{method:'POST',headers:h,body:JSON.stringify({query:'Build a revenue dashboard',fileIds:[dataFile.id],providerId:provider.id,model:'qwen-test:latest'})});assert.equal(r.status,200);const analysis=await r.json();assert.match(analysis.dashboard.title,/Sales/i);assert.equal(analysis.dashboard.charts[0].values[0],70);assert.equal(analysis.semanticModel.domain,'sales');assert.equal(lastChat,null);

  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/conversations',{method:'POST',headers:h,body:'{"title":"Website build"}'});const conversation=await r.json();
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/chat/stream',{method:'POST',headers:h,body:JSON.stringify({conversationId:conversation.id,providerId:provider.id,model:'qwen-test:latest',content:'Build a home page',mode:'website',maxTokens:256})});const stream=await r.text();assert.match(stream,/event: done/);assert.equal(lastChat.options.num_predict,256);assert.equal(lastChat.options.num_ctx,4096);assert.equal(lastChat.keep_alive,'30m');assert.match(lastChat.messages[0].content,/accessible, responsive website/);assert.equal(lastChat.model,'qwen-test:latest');assert.doesNotMatch(lastChat.messages[0].content,/You are Fabric 1.0/);
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/conversations/'+conversation.id,{headers:{cookie}});const loaded=await r.json(),assistant=loaded.messages.at(-1);assert.equal(assistant.mode,'website');assert.match(assistant.content,/index\.html/);
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/artifacts',{method:'POST',headers:h,body:JSON.stringify({messageId:assistant.id,name:'Local website'})});assert.equal(r.status,201);const artifact=await r.json();assert.equal(artifact.fileCount,1);
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/artifacts/'+artifact.id+'/download',{headers:{cookie}});assert.equal(r.status,200);const zip=Buffer.from(await r.arrayBuffer());assert.equal(zip.subarray(0,2).toString(),'PK');assert.ok(zip.includes(Buffer.from('index.html')));
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/research/settings',{method:'PATCH',headers:h,body:JSON.stringify({url:'http://127.0.0.1:8080'})});assert.equal(r.status,200);
  r=await fetch('http://127.0.0.1:'+fluxPort+'/api/conversations',{method:'POST',headers:h,body:'{"title":"Research"}'});const researchConversation=await r.json();r=await fetch('http://127.0.0.1:'+fluxPort+'/api/chat/stream',{method:'POST',headers:h,body:JSON.stringify({conversationId:researchConversation.id,providerId:provider.id,model:'qwen-test:latest',content:'Investigate the test evidence',mode:'research',maxTokens:256})});const researchStream=await r.text();assert.match(researchStream,/"id":"S1"/);assert.doesNotMatch(lastChat.messages[0].content,/Verified local research snippet/);assert.match(lastChat.messages.at(-1).content,/BEGIN UNTRUSTED EVIDENCE/);assert.match(lastChat.messages.at(-1).content,/Verified local research snippet/);r=await fetch('http://127.0.0.1:'+fluxPort+'/api/conversations/'+researchConversation.id,{headers:{cookie}});const researched=await r.json();assert.equal(researched.messages.at(-1).sources[0].id,'S1');
});
