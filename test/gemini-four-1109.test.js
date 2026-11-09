// 2026-11-09: rest window and daily counts follow the life plugin's Gemini rhythm plan; recall narrowing orders by meaning.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {InnerLife} from '../lib/core.js';
import {planningContext} from '../lib/planning-context.js';
import {semanticOrder} from '../lib/question-recall.js';

function fixture(timing,fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-four-'));let now=Date.parse('2026-11-09T03:00:00+08:00');
 const life={status:()=>({enabled:true,sessionIds:['session-main'],timezone:'Asia/Shanghai'}),...(timing?{timing:(key,fallback)=>Object.hasOwn(timing,key)?timing[key]:fallback}:{})};
 const core=new InnerLife({dir,life,now:()=>now});core.statusSnapshot={enabled:true,sessionIds:['session-main'],timezone:'Asia/Shanghai'};
 const at=t=>{now=Date.parse(t+'+08:00');};
 try{return fn(core,at);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('without a rhythm plan the configured 02:00–06:00 rest and 12/6 daily counts still apply',()=>fixture(null,(c,at)=>{
 at('2026-11-09T03:00:00');assert.equal(c.quiet(),true);at('2026-11-09T07:00:00');assert.equal(c.quiet(),false);
 assert.deepEqual(c.limits(),{judgments:12,reflections:6});
}));

test('rest window comes from the rhythm plan, may cross midnight, use fractions, or be skipped',()=>{
 fixture({innerQuietStartHour:23.25,innerQuietEndHour:7.5},(c,at)=>{
  at('2026-11-09T23:30:00');assert.equal(c.quiet(),true);at('2026-11-10T07:20:00');assert.equal(c.quiet(),true);
  at('2026-11-10T07:40:00');assert.equal(c.quiet(),false);at('2026-11-09T03:00:00');assert.equal(c.quiet(),true);at('2026-11-09T22:00:00');assert.equal(c.quiet(),false);
  assert.deepEqual(c.quietWindow(),{start:23.25,end:7.5});
 });
 fixture({innerQuietStartHour:3,innerQuietEndHour:3},(c,at)=>{at('2026-11-09T03:00:00');assert.equal(c.quiet(),false);});
});

test('daily counts come from the rhythm plan, are floored, and 0 stops solitude for the day',()=>fixture({innerJudgmentsDaily:3.7,innerReflectionsDaily:0,innerQuietStartHour:0,innerQuietEndHour:0},(c,at)=>{
 at('2026-11-09T15:00:00');assert.deepEqual(c.limits(),{judgments:3,reflections:0});
 c.record.queue.push({id:'x',kind:'event-start',data:{},at:c.now(),receivedAt:c.now(),state:'pending'});
 assert.equal(c.due(true),false,'0 reflections today blocks even a forced check');
 assert.equal(c.scheduleView().state,'reflection-limit');
}));

test('more room from the rhythm plan lets solitude continue past the old fixed count',()=>fixture({innerJudgmentsDaily:20,innerReflectionsDaily:9,innerQuietStartHour:0,innerQuietEndHour:0},(c,at)=>{
 at('2026-11-09T15:00:00');c.record.daily[c.date()]={judgments:12,reflections:6};
 c.record.queue.push({id:'x',kind:'event-start',data:{},at:c.now(),receivedAt:c.now(),state:'pending'});
 assert.equal(c.due(true),true);
}));

test('planning context reports today\'s usage for the rhythm judge without creating the day row',()=>fixture(null,(c,at)=>{
 at('2026-11-09T15:00:00');
 assert.deepEqual(planningContext(c,{sessionId:'session-main'}).today,{judgments:0,reflections:0});
 assert.equal(c.record.daily[c.date()],undefined);
 c.record.daily[c.date()]={judgments:2,reflections:1};
 assert.deepEqual(planningContext(c,{sessionId:'session-main'}).today,{judgments:2,reflections:1});
}));

test('semantic order maps returned ids to rows and falls back to null on any problem',async()=>{
 const rows=[{id:'a',title:'公园',text:'周末去公园摄影'},{id:'b',text:'整理抽屉'},{id:'c',text:'今天拍照了吗'}];
 let seen;const life={semanticRank:async req=>{seen=req;return {ids:['c','a','missing','b']};}};
 assert.deepEqual((await semanticOrder(life,rows,['拍照'])).map(r=>r.id),['c','a','b']);
 assert.equal(seen.docs[0].text,'公园 周末去公园摄影');assert.deepEqual(seen.queries,['拍照']);
 assert.equal(await semanticOrder({},rows,['拍照']),null);
 assert.equal(await semanticOrder({semanticRank:async()=>{throw Error('no model');}},rows,['拍照']),null);
 assert.equal(await semanticOrder({semanticRank:async()=>null},rows,['拍照']),null);
 assert.equal(await semanticOrder({semanticRank:()=>new Promise(()=>{})},rows,['拍照'],20),null,'a slow first run falls back to lexical order');
});
