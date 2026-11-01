import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {InnerLife,validateReflection,validateConfig} from '../lib/core.js';import {parseDiary} from '../lib/dsh-worker.js';import {guard} from '../lib/host.js';
const diary={feeling:'有一点怀念',reflection:'票根留在书里，看到它就想起旧书的味道',intention:'先夹回书里，之后再想',behaviorHint:'说话可以慢一点',validMinutes:90,nextReflectionMinutes:60,windowEndMinutes:120,shareDecision:'private',action:'none',memoryCandidate:''};
const attention={decision:'attend',reason:'旧票根值得停下来想一会',delayMinutes:60,windowEndMinutes:120};
const audit={valid:true,reason:'感受属于自身反思，不是用户事实',remember:false,memoryText:'',evidence:'',importance:0,newFeeling:false,moodDelta:0,dims:{happy:0,calm:0,sad:0},confidence:95};
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-life-'));let now=Date.parse('2026-10-30T09:00:00+08:00'),rows=[{sequence:1,id:'life:1',kind:'event-start',at:now,data:{eventId:'book',name:'旧票根',stageText:'整理旧书时找到一张旧票根'}}],calls=0,reflections=0,effects=0;
 const life={contract:'censhu.life-integration',version:2,status:()=>({enabled:true,sessionIds:['session-main'],timezone:'Asia/Shanghai',life:{activity:'休息'},mood:{ok:true,mood:70,dims:{happy:1}},drawing:{items:[]}}),changesSince:cursor=>({contract:'censhu.life-changes',version:1,cursor:rows.at(-1)?.sequence||0,items:rows.filter(x=>x.sequence>cursor)}),snapshot:()=>({context:'原有人设与生活',memories:[]}),judge:async(_prompt,_schema,input)=>{calls++;return input.candidate?audit:attention;},submitInnerResult:()=>{effects++;return {memory:'none',mood:'none'};}};
 const options={dir,life,now:()=>now,random:()=>.4,reflect:async()=>{reflections++;return diary;}};const core=new InnerLife(options);
 try{await fn({core,life,options,dir,advance:ms=>now+=ms,now:()=>now,rows,calls:()=>calls,reflections:()=>reflections,effects:()=>effects});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('changes persist and one batch becomes a private diary without notifying a chat',()=>fixture(async({core,calls,reflections})=>{core.ingest();await core.tick();assert.equal(calls(),0);await core.tick({force:true});assert.equal(calls(),2);assert.equal(reflections(),1);assert.equal(core.record.entries.length,1);assert.equal(core.record.entries[0].shareState,'private');assert.equal(core.record.queue[0].state,'done');core.record.deliberation.contexts.main={selectedIds:core.record.entries.map(x=>x.id),expiresAt:core.now()+60000};assert.match(core.context({sessionId:'main'}).context,/打算还没有执行/);}));
test('restart retains processed cursor and timing instead of reflecting twice',()=>fixture(async({core,options,advance,calls})=>{await core.tick({force:true});const next=core.record.nextAt;advance(1000);const resumed=new InnerLife(options);await resumed.tick();assert.equal(resumed.record.nextAt,next);assert.equal(resumed.record.entries.length,1);assert.equal(calls(),2);}));
test('later and uncertain do not rerun on every five second poll or discard observations',()=>fixture(async({core,life,advance,calls})=>{life.judge=async()=>{return {...attention,decision:'uncertain'};};await core.tick({force:true});const deferred=core.record.deferredUntil;advance(25*60000);await core.tick();assert.equal(core.record.lastJudgmentAt,Date.parse('2026-10-30T09:00:00+08:00'));assert.equal(core.record.queue[0].state,'pending');assert.ok(deferred>core.now());}));
test('record-only completes awareness without creating a character response',()=>fixture(async({core,life,reflections})=>{life.judge=async()=>({...attention,decision:'record'});await core.tick({force:true});assert.equal(reflections(),0);assert.equal(core.record.queue[0].state,'recorded');}));
test('all events through start, stages and ending reach a single batch',()=>fixture(async({core,rows,options})=>{rows.push(...[2,3,4].map((sequence,i)=>({sequence,id:'life:'+sequence,kind:i<2?'event-stage':'event-end',at:options.now(),data:{stage:i+1}})));await core.tick({force:true});assert.equal(core.record.entries[0].evidenceIds.length,4);assert.equal(core.record.queue.filter(x=>x.state==='done').length,4);}));
test('queue backpressure preserves the producer cursor until capacity becomes available',()=>fixture(async({core,rows,now})=>{for(let i=2;i<=60;i++)rows.push({sequence:i,id:'life:'+i,kind:'event-stage',at:now(),data:{}});core.configure({queueLimit:50});core.ingest();assert.equal(core.record.cursor,50);assert.equal(core.record.queue.length,50);core.record.queue.slice(0,20).forEach(x=>x.state='recorded');core.ingest();assert.equal(core.record.cursor,60);assert.equal(core.record.queue.length,60);}));
test('quiet time and daily caps also apply to manual consideration',()=>fixture(async({core,advance,calls})=>{advance(17*3600000);await core.tick({force:true});assert.equal(calls(),0);advance(4*3600000);core.count().judgments=core.config.maxJudgmentsDaily;await core.tick({force:true});assert.equal(calls(),0);}));
test('network backoff retains pending data and retry clears configuration suspension',()=>fixture(async({core,life,advance})=>{life.judge=async()=>{throw Object.assign(Error('invalid model'),{httpStatus:404});};await core.tick({force:true});assert.equal(core.record.configurationError,true);assert.equal(core.record.queue[0].state,'pending');advance(3600000);assert.equal(core.due(true),false);core.retry();assert.equal(core.record.configurationError,false);}));
test('concurrent ticks share one processing promise',()=>fixture(async({core,options,reflections})=>{const a=core.tick({force:true}),b=core.tick({force:true});await Promise.all([a,b]);assert.equal(reflections(),1);assert.equal(core.record.entries.length,1);}));
test('unsupported protocols stop visibly and do not advance the cursor',()=>fixture(async({core,life,calls})=>{life.version=3;await core.tick({force:true});assert.equal(core.view().health.ready,false);assert.equal(core.record.cursor,0);assert.equal(calls(),0);}));
test('a rebuilt producer is reread without losing its first new record',()=>fixture(async({core,life,rows})=>{core.ingest();core.record.sourceGeneration='old';life.changesSince=cursor=>({contract:'censhu.life-changes',version:1,generation:'new',cursor:1,items:cursor<1?[{...rows[0],id:'new:1'}]:[]});core.ingest();assert.ok(core.record.queue.some(x=>x.id==='new:1'));assert.ok(core.record.queue.some(x=>x.id==='life:1'));assert.match(core.record.warning,/已重建/);}));
test('mood-only feedback cannot generate a second mood contribution',()=>fixture(async({core,life,rows})=>{rows[0].kind='mood';life.judge=async(_p,_s,input)=>input.candidate?{...audit,newFeeling:true,moodDelta:2}:attention;await core.tick({force:true});assert.equal(core.record.entries[0].mood,undefined);}));
test('memory requires exact independent evidence and successful audit',()=>fixture(async({core,life})=>{life.judge=async(_p,_s,input)=>input.candidate?{...audit,remember:true,memoryText:'岑舒整理旧书时找到旧票根',evidence:'整理旧书时找到一张旧票根',importance:90}:attention;await core.tick({force:true});assert.equal(core.record.entries[0].memory.importance,90);assert.equal(core.record.entries[0].effects.applied,true);}));
test('invalid reflection is not committed, while sources remain available',()=>fixture(async({core,options})=>{core.reflect=async()=>({...diary,validMinutes:-1});await core.tick({force:true});assert.equal(core.record.entries.length,0);assert.equal(core.record.queue[0].state,'pending');assert.match(core.record.error,/有效期/);}));
test('manual settings, expiry and malformed JSON are validated',()=>{assert.throws(()=>validateConfig({minimumMinutes:0}));assert.throws(()=>validateReflection({...diary,shareDecision:'always'}));assert.deepEqual(parseDiary('```json\n{"a":1}\n```'),{a:1});assert.throws(()=>parseDiary('not json'));});
test('modifying routes reject DNS rebinding hosts, foreign origins and missing CSRF tokens',()=>{const req={method:'POST',headers:{host:'127.0.0.1:1234','x-inner-life-csrf':'a'.repeat(64)},socket:{localPort:1234,remoteAddress:'127.0.0.1'}};assert.doesNotThrow(()=>guard(req,'a'.repeat(64)));assert.throws(()=>guard({...req,headers:{...req.headers,host:'attacker.example:1234'}},'a'.repeat(64)));assert.throws(()=>guard({...req,headers:{...req.headers,origin:'https://evil.example'}},'a'.repeat(64)));assert.throws(()=>guard({...req,headers:{host:'127.0.0.1:1234'}},'a'.repeat(64)));});
test('audit failure resumes only audit after restart, even when daily reflection quota is exhausted',()=>fixture(async({core,life,options,advance,reflections})=>{
 let attentionCalls=0,auditCalls=0;life.judge=async(_p,_s,input)=>{if(!input.candidate){attentionCalls++;return attention;}auditCalls++;if(auditCalls===1)throw Error('network');return audit;};
 await core.tick({force:true});assert.equal(core.record.attempt.phase,'audit');const runId=core.record.attempt.id;assert.equal(core.record.entries.length,0);
 core.configure({maxReflectionsDaily:1});core.record.attempt.signature=core.signature();core.save();advance(20*60000);const resumed=new InnerLife(options);await resumed.tick();
 assert.equal(attentionCalls,1);assert.equal(reflections(),1);assert.equal(auditCalls,2);assert.equal(resumed.record.entries[0].id,runId);assert.equal(resumed.count().judgments,1);assert.equal(resumed.count().reflections,1);
}));
test('model focus acknowledges selected observations while unrelated items remain pending',()=>fixture(async({core,life,rows,now})=>{
 rows.push({sequence:2,id:'life:2',at:now(),kind:'event-stage',data:{text:'另一件事'}});life.judge=async(_p,_s,input)=>input.candidate?audit:{...attention,focusIds:['life:1'],recallIds:[]};await core.tick({force:true});
 assert.equal(core.record.queue.find(x=>x.id==='life:1').state,'done');assert.equal(core.record.queue.find(x=>x.id==='life:2').state,'pending');assert.deepEqual(core.record.entries[0].evidenceIds,['life:1']);
}));
test('the model can recall an older important diary and explicitly replace its temporary state',()=>fixture(async({core,life,now})=>{
 const old={id:'inner:old',...diary,at:now()-86400000,expiresAt:now()+3600000,importance:95,shareState:'pending',effects:{applied:true}};core.record.entries.push(old);
 for(let i=0;i<9;i++)core.record.entries.push({...old,id:'inner:recent'+i,at:now()-9000+i,importance:5,shareState:'private'});
 life.judge=async(_p,_s,input)=>{if(input.candidate)return {...audit,importance:85};assert.ok(input.reflectionCatalog.some(x=>x.id===old.id));return {...attention,focusIds:['life:1'],recallIds:[old.id]};};
 core.reflect=async({previous})=>{assert.equal(previous[0].id,old.id);return {...diary,feeling:'已经放下那件事',supersedesIds:[old.id]};};await core.tick({force:true});
 assert.equal(old.shareState,'superseded');assert.equal(old.supersededBy,core.record.entries.at(-1).id);assert.equal(core.record.entries.length,11);assert.deepEqual(core.record.entries.at(-1).recallIds,[old.id]);core.record.deliberation.contexts.main={selectedIds:core.record.entries.map(x=>x.id),expiresAt:core.now()+60000};assert.ok(!core.context({sessionId:'main'}).ids.includes(old.id));
}));
test('an empty private reflection is acknowledged silently without audit or blank diary',()=>fixture(async({core,calls})=>{
 core.reflect=async()=>({...diary,feeling:'',reflection:'',intention:'',behaviorHint:'',memoryCandidate:''});await core.tick({force:true});assert.equal(calls(),1);assert.equal(core.record.entries.length,0);assert.equal(core.record.queue[0].quiet,true);assert.ok(core.record.lastQuiet);assert.equal(core.record.attempt,undefined);
}));
test('unknown recall IDs fail without acknowledging observations',()=>fixture(async({core,life})=>{life.judge=async()=>({...attention,focusIds:['missing'],recallIds:[]});await core.tick({force:true});assert.equal(core.record.queue[0].state,'pending');assert.equal(core.record.entries.length,0);assert.match(core.record.error,/编号无效/);}));
test('busy source queues the reflection without spending a reflection quota or rerunning attention',()=>fixture(async({core,advance,calls})=>{
 core.reflect=async()=>{throw Object.assign(Error('busy'),{code:'INNER_BUSY'});};await core.tick({force:true});assert.equal(core.count().reflections,0);assert.equal(core.count().judgments,1);assert.equal(core.record.failures||0,0);assert.equal(core.record.attempt.phase,'reflect');
 core.reflect=async()=>diary;advance(31000);await core.tick();assert.equal(core.count().judgments,1);assert.equal(core.count().reflections,1);assert.equal(calls(),2);assert.equal(core.record.entries.length,1);
}));
test('late audit preserves the original diary time without reviving expired mood or sharing',()=>fixture(async({core,life,advance,now})=>{
 let audits=0;core.reflect=async()=>({...diary,validMinutes:1,shareDecision:'offer'});life.judge=async(_p,_s,input)=>{if(!input.candidate)return attention;if(++audits===1)throw Error('network');return {...audit,newFeeling:true,moodDelta:2};};const generatedAt=now();await core.tick({force:true});advance(20*60000);await core.tick();const entry=core.record.entries[0];assert.equal(entry.at,generatedAt);assert.equal(entry.shareState,'expired');assert.equal(entry.mood,undefined);assert.equal(core.context({sessionId:'main'}).context,'');
}));


test('active real chat defers both fresh work and checkpoint retry; newest bound surface chooses the session',()=>fixture(async({core,life,now,advance,calls})=>{
 const status=life.status();life.status=()=>({...status,sessionIds:['session-main','session-other'],activity:{sessionId:'session-other',surface:'dsh',at:now()-1000}});
 await core.tick({force:true});assert.equal(calls(),0);assert.equal(core.sourceId(),'session-other');
 const at=now();life.status=()=>({...status,activity:{at}});advance(11*60000);await core.tick({force:true});assert.equal(core.record.entries.length,1);
}));
test('expired observations leave the pending queue, including legacy per-message chat records',()=>fixture(async({core,rows,advance})=>{
 rows.push({...rows[0],id:'chat',sequence:2,kind:'conversation'});core.ingest();assert.equal(core.record.queue.length,1);
 advance(49*3600000);core.ingest();assert.equal(core.record.queue.filter(x=>x.state==='pending').length,0);
}));
test('runtime limits preserve an audit checkpoint without calling reflection again',()=>fixture(async({core,life,advance,reflections})=>{
 let failed=false;life.judge=async(_p,_s,input)=>{if(input.candidate&&!failed){failed=true;throw Error('network');}return input.candidate?audit:attention;};
 await core.tick({force:true});const id=core.record.attempt.id;core.configure({queueLimit:700,minimumMinutes:30});advance(20*60000);await core.tick({force:true});assert.equal(reflections(),1);assert.equal(core.record.entries[0].id,id);
}));
test('prior diary and recalled private memory cannot become evidence of a new memory',()=>fixture(async({core,life})=>{
 life.snapshot=()=>({context:'',memories:[{text:'岑舒过去独处想到了海边'}]});life.judge=async(_p,_s,input)=>input.candidate?{...audit,remember:true,memoryText:'岑舒看见海边',evidence:'岑舒过去独处想到了海边',importance:90}:attention;
 await core.tick({force:true});assert.equal(core.record.entries[0].memory,undefined);
}));
test('drawing sharing remains owned by drawing plugin even after reflection offers to share',()=>fixture(async({core,life,rows})=>{
 rows[0].data.templateId='drawing-inspiration';core.reflect=async()=>({...diary,shareDecision:'offer'});await core.tick({force:true});assert.equal(core.record.entries[0].shareState,'private');
}));
test('original event is scored at most once and daily absolute budget applies',()=>fixture(async({core,life,rows,advance,now})=>{
 rows[0].data.moodAdmission='admitted';life.judge=async(_p,_s,input)=>input.candidate?{...audit,newFeeling:true,reflectionEvidence:diary.reflection,distinctReason:'看见票根后的反思带来珍惜，与原本烦闷不同',moodDelta:3,dims:{happy:6,calm:0,sad:0}}:attention;
 await core.tick({force:true});assert.equal(core.record.entries[0].mood.eventId,'book');
 for(const [i,eventId] of ['book','new-book','third-book'].entries()){advance(30*60000);rows.push({sequence:i+2,id:'life:'+(i+2),kind:'event-stage',at:now(),data:{eventId,name:eventId,moodAdmission:'admitted'}});await core.tick({force:true});}
 assert.equal(core.record.entries.filter(x=>x.mood).length,2);assert.equal(core.count().moodUsed,6);assert.equal(core.count().dimsUsed.happy,12);
}));
test('already queued ordinary event cannot score without independent reflection evidence',()=>fixture(async({core,life,rows})=>{
 rows[0].data.moodAccounted=true;life.judge=async(_p,_s,input)=>input.candidate?{...audit,newFeeling:true,moodDelta:3}:attention;await core.tick({force:true});assert.equal(core.record.entries[0].mood,undefined);
}));
test('own mood receipts and chat-time mood changes are absorbed into baseline without reenqueuing',()=>fixture(async({core,life,rows,now,advance})=>{
 rows.length=0;const status=life.status();let mood=70;life.status=()=>({...status,mood:{ok:true,mood,dims:{happy:0},updatedAt:now(),lastLifeInfluence:{at:now(),ids:['inner:test:reflection']}}});core.ingest();advance(1000);mood=73;core.ingest();assert.equal(core.record.queue.length,0);assert.equal(core.record.moodBaseline.mood,73);
}));

test('quota-rejected events cannot acquire points through reflection even with a positive audit',()=>fixture(async({core,life,rows})=>{
 rows[0].data.moodAdmission='daily-limit';life.judge=async(_p,_s,input)=>input.candidate?{...audit,newFeeling:true,eventId:'book',reflectionEvidence:diary.reflection,distinctReason:'新认识',moodDelta:2}:attention;await core.tick({force:true});assert.equal(core.record.entries[0].mood,undefined);
}));
test('latest admission and receipts override stale observation flags before audit',()=>fixture(async({core,life,rows})=>{
 rows[0].data.moodAccounted=true;const status=life.status();life.status=()=>({...status,moodAccounting:{book:{moodAdmission:'admitted',moodReceipts:[{id:'book:start:0',applied:true}]}}});
 life.judge=async(_p,_s,input)=>{if(!input.candidate)return attention;assert.equal(input.observations[0].data.moodReceipts[0].applied,true);return {...audit,newFeeling:true,eventId:'book',reflectionEvidence:diary.reflection,distinctReason:'由反思产生，与原有反应不同',moodDelta:1};};await core.tick({force:true});assert.equal(core.record.entries[0].mood.moodDelta,1);
}));

test('only audited intention IDs are enriched with their snapshot versions and submitted',()=>fixture(async({core,life,now})=>{
 const plan={id:'intention:books',generatedAt:now(),revision:3,priority:2};life.snapshot=()=>({context:'',memories:[],lifeIntentions:[plan]});core.reflect=async({input})=>{assert.equal(input.lifeIntentions[0].id,plan.id);return {...diary,intentionChanges:[{id:plan.id,action:'cancel',priority:0,reason:'今晚想早睡'}]};};life.judge=async(_p,_s,input)=>input.candidate?{...audit,approvedIntentionIds:[plan.id]}:attention;let submitted;life.submitInnerResult=request=>{submitted=request;return {memory:'none',mood:'none',intentions:{accepted:[{id:plan.id}],rejected:[]}};};await core.tick({force:true});assert.equal(submitted.intentionChanges[0].expectedRevision,3);assert.equal(submitted.intentionChanges[0].generatedAt,plan.generatedAt);core.record.deliberation.contexts.main={selectedIds:core.record.entries.map(x=>x.id),expiresAt:core.now()+60000};assert.equal(core.context({sessionId:'session-main'}).records[0].source,'character-life');assert.equal(core.record.entries[0].effects.result.intentions.accepted.length,1);
}));
test('unapproved or nonexistent intentions do not discard the rest of a valid diary',()=>fixture(async({core,life,now,effects})=>{
 life.snapshot=()=>({context:'',memories:[],lifeIntentions:[{id:'intention:books',generatedAt:now(),revision:0}]});core.reflect=async()=>({...diary,intentionChanges:[{id:'intention:unknown',action:'cancel',priority:0,reason:'想改变'}]});life.judge=async(_p,_s,input)=>input.candidate?{...audit,approvedIntentionIds:['intention:unknown']}:attention;await core.tick({force:true});assert.equal(core.record.entries.length,1);assert.equal(core.record.entries[0].intentionChanges.length,0);assert.equal(core.record.entries[0].intentionChangeErrors.length,1);assert.equal(effects(),0);
}));

test('partial effect delivery persists receipt and resumes with the original payload after restart',()=>fixture(async({core,life,options,now})=>{
 life.capabilities={independentEffects:1};let first=true,requests=[];
 life.submitInnerResult=request=>{requests.push(structuredClone(request));return first?{effectsProtocol:1,complete:false,memory:'retry',mood:'queued',channels:{memory:{done:false,state:'retry',error:'offline'},mood:{done:true,state:'completed'}}}:{effectsProtocol:1,complete:true,memory:'queued',mood:'queued',channels:{memory:{done:true,state:'completed'},mood:{done:true,state:'completed'}}};};
 const row={id:'inner:retry-test',sourceId:'session-main',expiresAt:now()+60000,memory:{text:'留下票根',quote:'票根',importance:90},effects:{}};core.record.entries.push(row);
 await core.applyEffects(row);assert.equal(row.effects.applied,undefined);assert.match(row.effects.error,/offline/);assert.equal(row.effects.result.mood,'queued');
 first=false;const resumed=new InnerLife(options),saved=resumed.record.entries[0];await resumed.applyEffects(saved);assert.equal(saved.effects.applied,true);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[1].expiresAt,row.expiresAt);assert.equal(saved.effects.retryAt,undefined);
}));

test('advertised independent-effect support must be confirmed by the response',()=>fixture(async({core,life,now})=>{
 life.capabilities={independentEffects:1};const row={id:'inner:unsupported',sourceId:'session-main',expiresAt:now()+60000,memory:{text:'票根',quote:'票根',importance:90},effects:{}};await core.applyEffects(row);assert.notEqual(row.effects.applied,true);assert.match(row.effects.error,/协议/);
}));

test('Gemini per-item decisions preserve uncertainty without postponing unrelated new events',()=>fixture(async({core,life,rows,now,advance,options})=>{
 rows.push({sequence:2,id:'life:2',at:now(),kind:'event-stage',data:{eventId:'desk',stageText:'整理桌面'}});
 life.judge=async(_p,_s,input)=>input.candidate?audit:{...attention,decision:'uncertain',observationDecisions:[{id:'life:1',decision:'uncertain',reason:'还没想清楚',revisitMinutes:180},{id:'life:2',decision:'record',reason:'只是日常收拾',revisitMinutes:1}]};
 await core.tick({force:true});assert.equal(core.record.queue.find(x=>x.id==='life:1').revisitAt,now()+180*60000);assert.equal(core.record.queue.find(x=>x.id==='life:2').state,'recorded');
 advance(21*60000);rows.push({sequence:3,id:'life:3',at:now(),kind:'event-stage',data:{eventId:'call',stageText:'家里来电话'}});core.ingest();advance(3*60000);assert.equal(core.due(),true);
 let offered;life.judge=async(_p,_s,input)=>{offered=input.observations;return {...attention,decision:'record',observationDecisions:[{id:'life:3',decision:'record',reason:'已经知道了',revisitMinutes:1}]};};
 await core.tick();assert.deepEqual(offered.map(x=>x.id),['life:3']);const resumed=new InnerLife(options);assert.equal(resumed.record.queue.find(x=>x.id==='life:1').attention.decision,'uncertain');assert.equal(resumed.view().attentionItems.length,1);
}));
test('per-item focus controls reflection while omitted observations remain pending',()=>fixture(async({core,life,rows,now})=>{
 rows.push({sequence:2,id:'life:2',at:now(),kind:'event-stage',data:{}});
 life.judge=async(_p,_s,input)=>input.candidate?audit:{...attention,focusIds:['life:2'],observationDecisions:[{id:'life:1',decision:'attend',reason:'想一想票根',revisitMinutes:1}]};
 await core.tick({force:true});assert.deepEqual(core.record.entries[0].evidenceIds,['life:1']);assert.equal(core.record.queue.find(x=>x.id==='life:2').state,'pending');
}));
test('invalid attention IDs cannot discard observations',()=>fixture(async({core,life})=>{
 life.judge=async()=>({...attention,decision:'record',observationDecisions:[{id:'foreign',decision:'record',reason:'忽略',revisitMinutes:1}]});await core.tick({force:true});assert.equal(core.record.queue[0].state,'pending');assert.match(core.record.error,/逐项注意/);
}));

test('expired and unknown replacement references do not discard an otherwise valid diary',()=>fixture(async({core,life,now})=>{
 const old={id:'inner:expired',...diary,at:now()-86400000,expiresAt:now()-1000,effects:{applied:true}};core.record.entries.push(old);
 life.judge=async(_p,_s,input)=>{if(!input.candidate)return {...attention,recallIds:[old.id]};assert.deepEqual(input.candidate.supersedesIds,[]);return audit;};
 core.reflect=async()=>({...diary,supersedesIds:[old.id,'inner:unknown']});await core.tick({force:true});
 assert.equal(core.record.error,'');assert.equal(core.record.entries.length,2);assert.equal(old.supersededAt,undefined);assert.equal(core.record.entries[1].supersedesErrors.length,2);assert.ok(core.record.entries[1].reviewedAt);
}));
test('schedule view shows quota pause without changing persisted plans and recovers across days',()=>fixture(async({core,advance,now,calls})=>{
 core.record.nextAt=now()-60000;core.count().reflections=core.config.maxReflectionsDaily;
 const before=JSON.stringify(core.record);const s=core.view().schedule;
 assert.equal(s.state,'reflection-limit');assert.equal(s.nextAt,null);assert.equal(s.plannedAt,now()-60000);assert.equal(JSON.stringify(core.record),before);assert.equal(core.due(),false);assert.equal(calls(),0);
 advance(24*3600000);assert.equal(core.view().schedule.state,'due');assert.equal(core.due(),true);
}));
test('schedule distinguishes future plan, retry, and unfinished review from daily quota',()=>fixture(async({core,now})=>{
 assert.equal(core.view().schedule.state,'scheduled');assert.ok(core.view().schedule.nextAt>now());
 core.count().reflections=core.config.maxReflectionsDaily;core.record.attempt={phase:'audit'};assert.equal(core.view().schedule.state,'resume');
 core.record.retryAt=now()+60000;assert.equal(core.view().schedule.state,'retry');assert.equal(core.view().schedule.nextAt,core.record.retryAt);
}));

test('Gemini can choose recollection without new events and pass selected old diaries to the worker',()=>fixture(async({core,life,rows,now,effects})=>{
 rows.length=0;
 core.record.entries.push({id:'old-recall',at:now()-86400000,expiresAt:now()-1000,reviewedAt:now()-86400000,feeling:'那天的旧书',reflection:'曾在书中留下一张票根',intention:'',shareState:'private'});
 life.judge=async(_p,_s,input)=>input.candidate?audit:{...attention,activity:'recall',recallTopic:'想翻翻旧书里的票根',focusIds:[],recallIds:['old-recall'],observationDecisions:[]};
 core.reflect=async({input,previous})=>{assert.equal(input.recollectionPlan.activity,'recall');assert.equal(input.recollectionPlan.topic,'想翻翻旧书里的票根');assert.equal(input.observations.length,0);assert.equal(previous[0].id,'old-recall');assert.equal(previous[0].active,false);return {...diary,action:'recall',intention:'以后再看看那张票根'};};
 await core.tick({force:true});const row=core.record.entries.at(-1);assert.equal(row.action,'recall');assert.equal(row.recollectionPlan.activity,'recall');assert.deepEqual(row.recallIds,['old-recall']);assert.equal(effects(),0);assert.equal(core.record.deliveries.length,0);
}));

test('malformed recollection choices do not start reflection or acknowledge new observations',()=>fixture(async({core,life,reflections})=>{life.judge=async()=>({...attention,activity:'invented',recallTopic:''});await core.tick({force:true});assert.equal(reflections(),0);assert.equal(core.record.queue[0].state,'pending');assert.match(core.record.error,/回忆选择格式无效/);}));

test('question research feeds retrieved sources into the actual reflection request',()=>fixture(async({core,life})=>{
 const original=life.judge;life.personalitySources=async()=>({memories:[{id:'real',text:'青枔提起旧书'}]});let researchCalls=0,seen;
 life.judge=async(p,s,input,options)=>{if(options?.feature==='inner-question-recall'){researchCalls++;return {decision:'proceed',reason:'回应当前疑问',selectedIds:input.candidates.map(x=>x.id).slice(0,8)};}if(!input.candidate)return {...attention,questions:['这本书对我有什么意义？']};return audit;};
 core.reflect=async request=>{seen=request.input;return diary;};await core.tick({force:true});assert.equal(researchCalls,1);assert.equal(seen.recalledSources[0].id,'memory:real');assert.deepEqual(seen.questions,['这本书对我有什么意义？']);assert.equal(core.record.entries.length,1);assert.equal(core.questionRecall.record.diaries.length,1);
}));
