import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {receiveDiary,tickWithAgency,agencyDisplay} from '../lib/inner-agency.js';
test('主动决定 → 独处审核 → 原有记忆渠道；重复请求不再执行', async()=>{
 const {InnerLife}=await import('../lib/core.js');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agency-inner-')),dir=path.join(home,'censhu-inner-life');
 const now=Date.parse('2026-11-02T10:00:00+08:00'),sessionId='session-main',events=[{sequence:1,id:'ev1',kind:'event-start',at:now,data:{eventId:'book',name:'整理旧书',stageText:'翻开旧书找到一张票根'}}];
 const requests=[];let audits=0;
 try{
 const agency=path.join(home,'censhu-agency');fs.mkdirSync(agency);fs.writeFileSync(path.join(agency,'owner.json'),JSON.stringify({until:now+60000,sessionId}));
 const life={contract:'censhu.life-integration',version:2,status:()=>({enabled:true,sessionIds:[sessionId],timezone:'Asia/Shanghai',life:{activity:'整理旧书'},mood:{ok:false}}),
 changesSince:cursor=>({contract:'censhu.life-changes',version:1,cursor:1,items:events.filter(e=>e.sequence>cursor)}),snapshot:()=>({context:'生活',memories:[{text:'曾经整理过旧书'}]}),
 judge:async(_p,_s,input)=>{assert.equal(input.candidate.reflection,'看到那张票根，有点怀念。');assert.equal(input.memories.length,1);assert.equal(input.observations[0].data.eventId,'book');audits++;return {valid:true,reason:'有原文依据',remember:true,memoryText:'在旧书里发现票根',evidence:'翻开旧书找到一张票根',importance:91,newFeeling:false};},
 submitInnerResult:async r=>{requests.push(r);return {memory:'queued'};}};
 const core=new InnerLife({dir,life,now:()=>now,reflect:()=>assert.fail('不应启动第二个独处执行者')});
 core.ingest();const tick=()=>tickWithAgency(core,core.tick.bind(core),{ingested:true});
 await tick();assert.equal(audits,0);
 const r={sessionId,run:'r1',reflection:'看到那张票根，有点怀念。',eventIds:['book']};
 const first=receiveDiary(core,r);assert.equal(first.status,'queued');assert.deepEqual(receiveDiary(core,r),first);
 core.record.queue=[]; // 审核前队列已清理，仍应使用提交当时的生活观察。
 await tick();await tick();
 assert.equal(audits,1);assert.equal(requests.length,1);assert.equal(requests[0].memory.quote,'翻开旧书找到一张票根');assert.equal(core.record.entries.length,1);
 assert.equal(receiveDiary(core,r).status,'reviewed');assert.ok(agencyDisplay(dir,sessionId).some(row=>row.displayText.includes('来源回合 r1')));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('跨会话不可提交日记、未接手时恢复原处理',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'agency-owner-'));
 try{const core={dir:path.join(home,'inner'),now:()=>Date.now(),record:{},config:{enabled:true},statusSnapshot:{sessionIds:['main']}};
 assert.throws(()=>receiveDiary(core,{sessionId:'other'}));assert.equal(await tickWithAgency(core,()=>7,{}),7);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
