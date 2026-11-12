import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(()=>resolve()));

test('Fabric 1.0 and Fabric Voice use managed native endpoints without Ollama',async()=>{
  const runtime=http.createServer((req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"status":"ok"}')}
    if(req.url==='/v1/chat/completions'){
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.write('data: {"choices":[{"delta":{"content":"Native "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"Fabric works"}}]}\n\n');
      res.write('data: [DONE]\n\n');return res.end();
    }
    if(req.url==='/inference'&&req.method==='POST'){req.resume();res.writeHead(200,{'content-type':'application/json'});return res.end('{"text":"native voice works"}')}
    res.writeHead(404);res.end();
  });
  const runtimePort=await listen(runtime),dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'fabric-native-test-'));
  process.env.FABRIC_DATA_DIR=dataDir;
  process.env.FABRIC_MASTER_KEY='native-test-master-key-32-characters!';
  process.env.FABRIC_NATIVE_BASE_URL=`http://127.0.0.1:${runtimePort}/v1`;
  process.env.FABRIC_NATIVE_STT_URL=`http://127.0.0.1:${runtimePort}`;
  delete process.env.FABRIC_NATIVE_DISABLE;
  const {server}=await import('../src/server.mjs?native-test='+Date.now());
  const port=await listen(server),base=`http://127.0.0.1:${port}`;
  const request=async(url,options={})=>fetch(base+url,options);
  try{
    let response=await request('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Native Tester',email:'native@example.com',password:'long-test-password'})});
    assert.equal(response.status,201);const registration=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0],headers={'content-type':'application/json','x-csrf-token':registration.csrf,cookie};
    response=await request('/api/providers',{headers});const providers=(await response.json()).items,native=providers.find(x=>x.type==='fabric-native');
    assert.ok(native);assert.equal(native.isDefault,true);assert.equal(native.config.defaultModel,'fabric:1.0');assert.equal(native.hasCredential,false);
    response=await request('/api/runtime',{headers});const status=(await response.json()).native;assert.equal(status.installed,true);assert.equal(status.voiceInstalled,true);assert.equal(status.runtime,'managed-endpoint');
    response=await request('/api/conversations',{method:'POST',headers,body:'{"title":"Native test"}'});const conversation=await response.json();
    response=await request('/api/chat/stream',{method:'POST',headers,body:JSON.stringify({conversationId:conversation.id,providerId:native.id,model:'fabric:1.0',content:'Say hello',mode:'general'})});
    assert.equal(response.status,200);const stream=await response.text();assert.match(stream,/\"text\":\"Native /);assert.match(stream,/\"text\":\"Fabric works\"/);assert.match(stream,/"model":"fabric:1.0"/);
    response=await request('/api/voice/transcribe',{method:'POST',headers,body:JSON.stringify({audio:'UklGRg==',mime:'audio/wav',language:'en'})});
    assert.equal(response.status,200);const voice=await response.json();assert.equal(voice.text,'native voice works');assert.equal(voice.engine,'fabric-native-voice');
  }finally{await close(server);await close(runtime);await fs.rm(dataDir,{recursive:true,force:true})}
});
