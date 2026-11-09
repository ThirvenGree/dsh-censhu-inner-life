import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {InnerLife,validateReflection} from '../lib/core.js';
import {receiveDiary,tickWithAgency} from '../lib/inner-agency.js';
import {PrivateArchive,retainPrivateEntries} from '../lib/private-archive.js';
import {testSessionWrite} from '../lib/tool-isolation.js';
// 2026-11-09: fixes from the full review of the plugin.
const diary={feeling:'有一点怀念',reflection:'票根留在书里，看到它就想起旧书的味道',intention:'先夹回书里',behaviorHint:'慢一点',validMinutes:90,nextReflectionMinutes:60,windowEndMinutes:120,shareDecision:'private',action:'none',memoryCandidate:''};
const attention={decision:'attend',reason:'旧票根值得停下来想一会',delayMinutes:60,windowEndMinutes:120};
const audit={valid:true,reason:'感受属于自身反思',remember:false,memoryText:'',evidence:'',importance:0,newFeeling:false,confidence:95};
async function fixture(reflected,fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'inner-review-')),dir=path.join(home,'censhu-inner-life');fs.mkdirSync(dir,{recursive:true});
 let now=Date.parse('2026-10-30T09:00:00+08:00');let gap=false;
 const rows=[{sequence:1,id:'life:1',kind:'event-start',at:now,data:{eventId:'book',name:'旧票根',stageText:'整理旧书时找到一张旧票根'}}],sent=[];
 const life={contract:'censhu.life-integration',version:2,status:()=>({enabled:true,sessionIds:['session-main'],timezone:'Asia/Shanghai',life:{activity:'休息'},mood:{ok:true,mood:null,dims:{}},drawing:{items:[]}}),changesSince:cursor=>({contract:'censhu.life-changes',version:1,cursor:rows.at(-1).sequence,gap,items:rows.filter(x=>x.sequence>cursor)}),snapshot:()=>({context:'c',memories:[]}),judge:async(_p,_s,input)=>input.candidate?audit:attention,submitInnerResult:r=>{sent.push(structuredClone(r));return {memory:'queued',mood:'queued'};}};
 const core=new InnerLife({dir,life,now:()=>now,random:()=>.4,reflect:async()=>reflected});
 try{await fn({core,sent,home,advance:ms=>now+=ms,setGap:v=>gap=v});}finally{fs.rmSync(home,{recursive:true,force:true});}
}
test('fields the model adds to its diary never reach the record or the effects',()=>fixture({...diary,id:'inner:forged',actions:[],rejected:true,supersededAt:1,memory:{text:'没有来源的事',quote:'x',importance:95},mood:{qualitative:true,diary:true,feeling:'塞进来的'}},async({core,sent})=>{
 await core.tick({force:true});const row=core.record.entries[0];
 assert.match(row.id,/^inner:(?!forged)/);assert.equal(row.memory,undefined);assert.equal(row.rejected,undefined);assert.equal(row.supersededAt,undefined);assert.equal(row.mood.feeling,diary.feeling);assert.equal(sent[0].memory,undefined);
}));
test('the fields a diary may carry are kept',()=>{
 const v=validateReflection({...diary,diaryImages:[{id:'x',caption:'c'}],readingNotes:[{title:'t'}],supersedesIds:['a']});
 assert.deepEqual(v.diaryImages,[{id:'x',caption:'c'}]);assert.deepEqual(v.readingNotes,[{title:'t'}]);assert.deepEqual(v.supersedesIds,['a']);assert.equal(v.validMinutes,90);
});
const agency=(home,core)=>{const dir=path.join(home,'censhu-agency');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({sessionId:'session-main',until:core.now()+86400000}));};
test('a diary written by agency reaches the mood through its reflection',()=>fixture(diary,async({core,sent,home,advance})=>{
 agency(home,core);core.ingest();receiveDiary(core,{run:'r1',sessionId:'session-main',reflection:'今天看的那段话让我想了很久',eventIds:['book'],observationIds:[]});advance(25*60000);
 await tickWithAgency(core,core.tick.bind(core),{ingested:true});
 assert.deepEqual(core.record.entries[0].mood,{qualitative:true,diary:true,feeling:'今天看的那段话让我想了很久'});assert.equal(sent.length,1);
}));
test('a diary written by agency with no observation also reaches the mood',()=>fixture(diary,async({core,sent,home,advance})=>{
 agency(home,core);core.ingest();core.record.queue=[];receiveDiary(core,{run:'r2',sessionId:'session-main',reflection:'没有对应事件的一段想法',eventIds:[],observationIds:[]});advance(25*60000);
 await tickWithAgency(core,core.tick.bind(core),{ingested:true});
 assert.equal(core.record.entries[0].mood.diary,true);assert.equal(sent.length,1);
}));
test('the gap notice stays for a day and then clears itself',()=>fixture(diary,async({core,advance,setGap})=>{
 setGap(true);core.ingest();assert.match(core.record.warning,/缺口/);setGap(false);core.ingest();assert.match(core.record.warning,/缺口/);
 advance(86400000);core.ingest();assert.equal(core.record.warning,undefined);
}));
test('a blank feeling does not stop private diaries from being archived',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-archive-'));
 try{const a=new PrivateArchive(dir),row=(id,feeling)=>({id,feeling,reflection:'r',at:Date.now(),reviewedAt:Date.now(),shareState:'private',sourceId:'s'});
 retainPrivateEntries(a,[row('inner:1','  '),row('inner:2','正常的一篇')]);const list=a.list();assert.equal(list.total,2);assert.ok(list.items.some(x=>x.title==='独处记录'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a test session reads censhu_inner_life without an action; keep_private stays a write',()=>{
 const agent={session:{id:'session-probe',header:{id:'session-probe',cwd:path.join(os.tmpdir(),'qq-bridge-probe-abc')}}};
 assert.equal(testSessionWrite({name:'censhu_inner_life',agent,arguments:{}}),false);assert.equal(testSessionWrite({name:'censhu_inner_life',agent,arguments:{action:'read'}}),false);assert.equal(testSessionWrite({name:'censhu_inner_life',agent,arguments:{action:'keep_private'}}),true);
});
