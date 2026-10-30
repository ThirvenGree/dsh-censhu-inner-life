import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const originalHome=process.env.DSH_HOME,testHome=fs.mkdtempSync(path.join(os.tmpdir(),'inner-worker-'));process.env.DSH_HOME=testHome;
process.on('exit',()=>{if(originalHome)process.env.DSH_HOME=originalHome;else delete process.env.DSH_HOME;fs.rmSync(testHome,{recursive:true,force:true});});
import test from 'node:test';import assert from 'node:assert/strict';import {isPrivateSession} from '../lib/isolation.js';
import {DshWorker} from '../lib/dsh-worker.js';
test('native session is reused when DSH omits an unchanged request header on later turns',async()=>{
 const listeners=new Set(),scoped=new Map();let requests=0,created=0;
 const source={id:'session-main',status:'idle',session:{id:'session-main',meta:{cwd:'test'},requestHeader:()=>({config:{provider:'deepseek-account',model:'deepseek-flash'}})}};
 const worker={id:'session-inner',status:'idle',ctx:{on:(name,fn)=>{scoped.set(name,fn);return ()=>scoped.delete(name);}},followup(){this.status='running';},async whenIdle(){requests++;const request=await scoped.get('agent/request')({},async()=>({provider:'old',model:'old',reasoningEffort:'unsupported'}));assert.equal(request.model,'deepseek-flash');assert.equal(request.reasoningEffort,undefined);const assembly=scoped.get('system-prompt/assemble')({sections:[],contexts:[],tools:[{name:'qq_send_message'}]});assert.equal(assembly.tools.length,0);for(const listener of listeners){if(requests===1)listener({id:this.id},{type:'request/header'});listener({id:this.id},{type:'assistant/message',data:{message:{content:[{type:'text',text:'{"feeling":"平常"}'}]}}});}this.status='idle';}};
 const controller={async create({sessionId}){assert.equal(isPrivateSession(sessionId),true);created++;worker.id=sessionId;return {sessionId};},async resolveAgent(){return {agent:worker};}};
 const ctx={agents:{roots:()=>[source,worker]},get:name=>name==='sessionController'?controller:undefined,on:(_name,fn)=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
 const core={dir:'test',record:{},now:()=>123,save(){}};const adapter=new DshWorker(ctx,core);
 for(let i=0;i<2;i++)assert.equal((await adapter.run({runId:'test:resume',sourceId:'session-main',input:{},previous:[]})).feeling,'平常');
 assert.equal(created,1);assert.equal(core.record.worker.turns,2);assert.equal(listeners.size,0);assert.equal(scoped.size,0);
 await adapter.run({runId:'test:new-batch',sourceId:'session-main',input:{},previous:[]});assert.equal(created,2);assert.equal(core.record.worker.runId,'test:new-batch');
});
test('only older plugin-owned idle sessions are archived, never the primary or current session',async()=>{
 const archived=[],main={id:'session-main',status:'idle'},current={id:'session-current',status:'idle'};
 const ctx={agents:{roots:()=>[main,current,{id:'session-old',status:'idle'}]},get:name=>name==='workspaceRegistry'?{archiveSession:async id=>archived.push(id)}:undefined};
 const core={record:{worker:{sessionId:current.id},workers:[{sessionId:main.id},{sessionId:'session-old'},{sessionId:'session-recent1'},{sessionId:'session-recent2'}]},statusSnapshot:{sessionIds:[main.id]},now:()=>10,save(){}};
 const adapter=new DshWorker(ctx,core);await adapter.archiveOld(main.id);assert.deepEqual(archived,['session-old']);assert.equal(core.record.workers.find(x=>x.sessionId==='session-old').archivedAt,10);
});

test('missing archive support cannot grow worker sessions indefinitely',async()=>{
 const source={id:'session-main',status:'idle',session:{id:'session-main'}},ctx={agents:{roots:()=>[source]},get:name=>name==='sessionController'?{create(){throw Error('must not create');},resolveAgent(){}}:undefined};
 const core={dir:testHome,record:{workers:Array.from({length:5},(_,i)=>({sessionId:'owned-'+i})),worker:{sessionId:'owned-current',runId:'old'}},now:()=>123,save(){}};
 const adapter=new DshWorker(ctx,core);await assert.rejects(()=>adapter.resolve('session-main','new'),/停止新建/);assert.equal(core.record.workers.length,5);
});

test('ignored requested identity archives only a verified new empty private session and latches creation',async()=>{
 let creates=0;const archived=[],source={id:'session-main',status:'idle',session:{id:'session-main'}},agents=[source];const controller={async create(){creates++;agents.push({id:'session-unexpected',status:'idle',session:{id:'session-unexpected',header:{cwd:testHome},snapshotEvents:()=>[]}});return {sessionId:'session-unexpected'};},resolveAgent(){throw Error('must not start the mismatched session');}};
 const ctx={agents:{roots:()=>agents},get:name=>name==='sessionController'?controller:name==='sessionQuery'?{listSessions:async()=>[{header:{id:'session-main'}}]}:name==='workspaceRegistry'?{archiveSession:async id=>archived.push(id)}:undefined};const core={dir:testHome,record:{},statusSnapshot:{sessionIds:[source.id]},now:()=>100,save(){}};const adapter=new DshWorker(ctx,core);
 await assert.rejects(()=>adapter.resolve(source.id,'first'),{code:'INNER_SESSION_IDENTITY'});assert.deepEqual(archived,['session-unexpected']);assert.equal(core.record.creationFailure.cleanup.state,'archived');assert.equal(core.record.creationFailure.blocked,true);await assert.rejects(()=>adapter.resolve(source.id,'second'),{code:'INNER_SESSION_IDENTITY'});assert.equal(creates,1);const restarted=new DshWorker(ctx,core);await assert.rejects(()=>restarted.resolve(source.id,'third'),{code:'INNER_SESSION_IDENTITY'});assert.equal(creates,1);
});
test('an existing or unverified returned session is never archived or muted and never loops creation',async()=>{
 for(const complete of [true,false]){let creates=0;const main={id:'session-main',status:'idle',session:{id:'session-main',header:{cwd:testHome},snapshotEvents:()=>[]}},archived=[];const ctx={agents:{roots:()=>[main]},get:name=>name==='sessionController'?{create:async()=>{creates++;return {sessionId:main.id};},resolveAgent(){}}:name==='sessionQuery'&&complete?{listSessions:async()=>[{header:{id:main.id}}]}:name==='workspaceRegistry'?{archiveSession:async id=>archived.push(id)}:undefined};const core={dir:testHome,record:{},statusSnapshot:{sessionIds:[main.id]},now:()=>100,save(){}};const adapter=new DshWorker(ctx,core);await assert.rejects(()=>adapter.resolve(main.id,'first'),{code:'INNER_SESSION_IDENTITY'});await assert.rejects(()=>adapter.resolve(main.id,'again'),{code:'INNER_SESSION_IDENTITY'});assert.equal(creates,1);assert.equal(archived.length,0);assert.equal(core.record.creationFailure.ownershipVerified,false);await assert.rejects(()=>adapter.retryIdentity(),/保持暂停/);}
});
test('missing archive support preserves the failed session for repair but prevents another creation',async()=>{
 let creates=0;const main={id:'session-main',status:'idle',session:{id:'session-main'}},agents=[main];const ctx={agents:{roots:()=>agents},get:name=>name==='sessionController'?{create:async()=>{creates++;agents.push({id:'session-orphan',status:'idle',session:{id:'session-orphan',header:{cwd:testHome},snapshotEvents:()=>[]}});return {sessionId:'session-orphan'};},resolveAgent(){}}:name==='sessionQuery'?{listSessions:async()=>[{header:{id:main.id}}]}:undefined};const core={dir:testHome,record:{},statusSnapshot:{sessionIds:[main.id]},now:()=>100,save(){}};const worker=new DshWorker(ctx,core);await assert.rejects(()=>worker.resolve(main.id,'first'),{code:'INNER_SESSION_IDENTITY'});assert.equal(core.record.creationFailure.cleanup.state,'archive-unavailable');await assert.rejects(()=>worker.resolve(main.id,'second'),{code:'INNER_SESSION_IDENTITY'});assert.equal(creates,1);assert.equal(core.record.workers[0].sessionId,'session-orphan');
});
