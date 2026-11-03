import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QuestionRecall} from '../lib/question-recall.js';
import {PrivateArchive} from '../lib/private-archive.js';

const question='那次碰到的图案是什么颜色？',cue='雁桥纹样卡';
const seed={id:'seed',at:10,source:'engram',text:'颜色依据收在雁桥纹样卡。'};
const evidence={id:'detail',at:11,source:'lingshu',text:'雁桥纹样卡上画的是青绿色。'};
const picked=(selected,sufficiency='sufficient',leadId='',leadQuote='')=>({decision:'proceed',reason:'test',selectedIds:selected,sufficiency,leadId,leadQuote});
function fixture(t,provider){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'two-hop-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store={},calls=[],core={dir,now:()=>100,date:()=>'today',config:{enabled:true,maxDeliberationsDaily:50},record:{entries:[]},
  read:(k,d)=>structuredClone(store[k]??d),write:(k,v)=>{store[k]=structuredClone(v)},save(){},sourceId:()=>'s',
  life:{status:()=>({life:{}}),personalitySources:async({sessionId,query})=>{calls.push({sessionId,query});return {memories:await provider(query),health:[]}}}};
 return {core,calls,q:new QuestionRecall(core)};
}
test('sufficient, uncertain, and no hits stop after one retrieval',async t=>{
 for(const state of ['sufficient','uncertain','empty']){
  const {q,calls}=fixture(t,async()=>state==='empty'?[]:[seed]);
  const r=await q.lookup(question,{sessionId:'qq',judge:async()=>picked(['memory:seed'],state)});
  assert.equal(calls.length,1);assert.equal(r.trace.length,1);assert.equal(r.trace[0].state,state==='empty'?'uncertain':state);
 }
});
test('a grounded clue starts one new search within the same scope, excludes repeated and out-of-window sources',async t=>{
 const {q,calls,core}=fixture(t,async query=>query===question?[seed]:[seed,evidence,{...evidence,id:'out',at:100}]);
 new PrivateArchive(core.dir).save({title:cue,text:'私人的颜色'},'s');
 q.record.diaries=[{id:'private',reflection:cue}];
 const result=await q.lookup(question,{sessionId:'qq',requestId:'scope',from:8,to:12,judge:async(_p,_s,input)=>{
   assert.ok(!('life' in input));
   if(input.hop===1)return picked(['memory:seed'],'insufficient','memory:seed',cue);
   assert.deepEqual(input.candidates.map(x=>x.id),['memory:detail']);
   assert.equal(input.priorEvidence[0].id,'memory:seed');
   return picked(['memory:detail'],'insufficient','memory:detail','青绿色');
 }});
 assert.deepEqual(calls.map(c=>[c.sessionId,c.query]),[['qq',question],['qq',cue]]);
 assert.deepEqual(result.matches.map(x=>[x.id,x.hop]),[['memory:seed',1],['memory:detail',2]]);
 assert.equal(result.trace[1].state,'insufficient');assert.equal(result.trace[1].via,'memory:seed');
});
test('unfounded or identical clues never start another retrieval',async t=>{
 const {q,calls}=fixture(t,async()=>[{...seed,text:seed.text+question}]);
 await assert.rejects(q.lookup(question,{sessionId:'qq',judge:async()=>picked(['memory:seed'],'insufficient','memory:seed','杜撰线索')}),/无法在已选原文中核对/);
 const r=await q.lookup(question,{sessionId:'qq',judge:async()=>picked(['memory:seed'],'insufficient','memory:seed',question)});
 assert.equal(r.trace.length,1);assert.equal(calls.length,2);
});
test('restart after second-hop failure resumes selection without repeating the first model call; changed archive blocks paging',async t=>{
 const {q,core}=fixture(t,async query=>query===question?[seed]:[]);
 const archive=new PrivateArchive(core.dir);const asset=archive.save({title:cue,text:'颜色青绿'},'s');
 let judged1=0,fail=true;
 const opt={sessionId:'s',privateScope:true,requestId:'resume',judge:async(_p,_s,input)=>{
  if(input.hop===1){judged1++;return picked(['memory:seed'],'insufficient','memory:seed',cue);}
  if(fail){fail=false;throw Error('offline');}
  return picked(input.candidates.filter(r=>r.archiveId===asset.id).map(r=>r.id));
 }};
 await assert.rejects(q.lookup(question,opt),/offline/);
 const recovered=new QuestionRecall(core),r=await recovered.lookup(question,opt);
 assert.equal(judged1,1);assert.ok(r.matches.some(x=>x.archiveId===asset.id&&x.hop===2));
 fs.writeFileSync(path.join(asset.path,'note.md'),'已修改');
 await assert.rejects(recovered.lookup(question,{...opt,sourceId:r.matches[1].id,sourceVersion:r.sourceVersion}),/来源版本已变化/);
});
test('a shared source changing between hops cannot validate stale evidence',async t=>{
 const {q}=fixture(t,async query=>query===question?[seed]:[{...seed,text:'已撤回'},evidence]);
 await assert.rejects(q.lookup(question,{sessionId:'qq',judge:async()=>picked(['memory:seed'],'insufficient','memory:seed',cue)}),/两跳之间来源版本已变化/);
});

test('mid-turn loss of caller access aborts before a second provider call',async t=>{
 const {q,calls}=fixture(t,async()=>[seed]);let authorized=true;
 await assert.rejects(q.lookup(question,{sessionId:'qq',authorize(){if(!authorized)throw Error('revoked')},judge:async()=>{
   authorized=false;return picked(['memory:seed'],'insufficient','memory:seed',cue);
 }}),/revoked/);
 assert.equal(calls.length,1);assert.equal(q.view().last.status,'waiting');
});

test('native record revision conflicts remain visible when provider excerpt IDs change',async t=>{
 const origin={provider:'openviking',scope:'user',id:'viking://user/fixture/memories/one.md',versionKind:'native'};
 const {q}=fixture(t,async query=>query===question?[{...seed,records:[{...origin,version:'old'}]}]:[{...evidence,records:[{...origin,version:'changed'}]}]);
 await assert.rejects(q.lookup(question,{sessionId:'qq',judge:async()=>picked(['memory:seed'],'insufficient','memory:seed',cue)}),/原记录版本已变化/);
});
