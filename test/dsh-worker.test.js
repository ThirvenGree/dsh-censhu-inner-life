import test from 'node:test';import assert from 'node:assert/strict';import {DshWorker} from '../lib/dsh-worker.js';
test('native session is reused when DSH omits an unchanged request header on later turns',async()=>{
 const listeners=new Set(),scoped=new Map();let requests=0,created=0;
 const source={id:'session-main',status:'idle',session:{id:'session-main',meta:{cwd:'test'},requestHeader:()=>({config:{provider:'deepseek-account',model:'deepseek-flash'}})}};
 const worker={id:'session-inner',status:'idle',ctx:{on:(name,fn)=>{scoped.set(name,fn);return ()=>scoped.delete(name);}},followup(){this.status='running';},async whenIdle(){requests++;const request=await scoped.get('agent/request')({},async()=>({provider:'old',model:'old',reasoningEffort:'unsupported'}));assert.equal(request.model,'deepseek-flash');assert.equal(request.reasoningEffort,undefined);const assembly=scoped.get('system-prompt/assemble')({sections:[],contexts:[],tools:[{name:'qq_send_message'}]});assert.equal(assembly.tools.length,0);for(const listener of listeners){if(requests===1)listener({id:this.id},{type:'request/header'});listener({id:this.id},{type:'assistant/message',data:{message:{content:[{type:'text',text:'{"feeling":"平常"}'}]}}});}this.status='idle';}};
 const controller={async create(){created++;return {sessionId:worker.id};},async resolveAgent(){return {agent:worker};}};
 const ctx={agents:{roots:()=>[source,worker]},get:name=>name==='sessionController'?controller:undefined,on:(_name,fn)=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
 const core={dir:'test',record:{},now:()=>123,save(){}};const adapter=new DshWorker(ctx,core);
 for(let i=0;i<2;i++)assert.equal((await adapter.run({runId:'test:'+i,sourceId:'session-main',input:{},previous:[]})).feeling,'平常');
 assert.equal(created,1);assert.equal(core.record.worker.turns,2);assert.equal(listeners.size,0);assert.equal(scoped.size,0);
});
