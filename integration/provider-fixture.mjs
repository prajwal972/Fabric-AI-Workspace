// Test-only protocol server. These deterministic responses/vectors are fixtures,
// not evidence of live model quality or production embeddings.
import http from 'node:http';
export async function providerFixture(){
 const embeddingInputs=[];
 const server=http.createServer(async(req,res)=>{let input='';for await(const c of req)input+=c;const b=input?JSON.parse(input):{};res.setHeader('content-type','application/json');
 if(req.url==='/api/show')return res.end(JSON.stringify({capabilities:['completion','tools'],model_info:{'fixture.context_length':32000}}));
 if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'fixture-tools'}]}));
 if(req.url==='/api/embed'){embeddingInputs.push(...b.input);return res.end(JSON.stringify({embeddings:b.input.map(()=>Array.from({length:768},(_,i)=>i===0?1:0))}));}
 if(req.url!=='/api/chat'){res.writeHead(404);return res.end('{}');}
 const system=b.messages.find(m=>m.role==='system')?.content||'',last=b.messages.at(-1),question=b.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');let text='',calls;
 if(system.includes('Create a JSON execution plan')&&question.includes('fixture deterministic analytics'))text=JSON.stringify({objective:'Fixture: discover and analyze the dataset',steps:[{title:'List workspace datasets',tool:'list_files',input:{limit:10,offset:0}},{title:'Calculate revenue deterministically',tool:'analyze_data',input:{fileIds:[{$fromStep:0,path:['items',0,'id']}],plan:{action:'sum',columns:['Revenue']}}}],successCriteria:'A real deterministic total and provenance are returned'});
 else if(system.includes('Verify the executed observations')&&question.includes('fixture deterministic analytics'))text=JSON.stringify({verified:true,answer:'Protocol fixture verification: the deterministic analysis returned 120.'});
 else if(system.includes('Create a JSON execution plan'))text=JSON.stringify({objective:'Calculate exactly',steps:[{title:'Calculate 6 times 7',tool:'calculator',input:{expression:'6*7'}}],successCriteria:'The calculator returns 42'});
 else if(system.includes('Verify the executed observations'))text=JSON.stringify({verified:true,answer:'The calculator returned 42.'});
 else if(system.includes('Choose a deterministic analysis plan'))text=JSON.stringify({action:'sum',columns:['Revenue']});
 else if(system.includes('Explain the supplied deterministic facts'))text='The computed revenue total is 120.';
 else if(last?.role==='tool'){
  const result=JSON.parse(last.content);
  if(question.includes('fixture deterministic analytics')&&Array.isArray(result.items)&&result.items.length)calls=[{function:{name:'analyze_data',arguments:{fileIds:[result.items[0].id],plan:{action:'sum',columns:['Revenue']}}}}];
  else if(question.includes('fixture deterministic analytics')&&result.provenance)text='Protocol fixture explanation: the deterministic total is '+result.value+'.';
  else if(question.includes('fixture knowledge')&&Array.isArray(result.sources)&&result.sources.length)calls=[{function:{name:'read_file',arguments:{fileId:result.sources[0].fileId}}}];
  else if(question.includes('fixture knowledge')&&result.citationSourceId)text='Protocol fixture read-source reference ['+result.citationSourceId+'].';
  else text='The calculator returned '+result.value+'.';
 }
 else if(question.includes('fixture deterministic analytics')&&b.tools?.some(t=>t.function.name==='list_files'))calls=[{function:{name:'list_files',arguments:{limit:10,offset:0}}}];
 else if(question.includes('fixture knowledge')&&b.tools?.some(t=>t.function.name==='search_knowledge'))calls=[{function:{name:'search_knowledge',arguments:{query:'Revenue',fileIds:[]}}}];
 else if(b.tools?.some(t=>t.function.name==='calculator')&&/calculate/.test(last?.content||''))calls=[{function:{name:'calculator',arguments:{expression:'6*7'}}}];
 else text='Protocol fixture answer [1].';
 res.setHeader('content-type','application/x-ndjson');res.end(JSON.stringify({message:{role:'assistant',content:text,...(calls?{tool_calls:calls}:{})},done:true,prompt_eval_count:20,eval_count:8})+'\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));return {embeddingInputs,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}
