import test from 'node:test';
import assert from 'node:assert/strict';
import {QuestionRecall} from '../lib/question-recall.js';
test('chat question recall searches shared sources, preserves diary state and records only selection usage',async()=>{
 const stored={version:1,diaries:[{id:'x',reflection:'私人日记'}],daily:{},last:{status:'previous'}};
 const c={read:()=>structuredClone(stored),write:()=>{},save:()=>assert.fail('no content writes'),record:{entries:[]},date:()=>'today',config:{enabled:true,maxDeliberationsDaily:5},now:()=>1,
 life:{status:()=>({life:{}}),personalitySources:async({sessionId,query})=>{assert.equal(sessionId,'qq');assert.equal(query,'那本书？');return {memories:[{id:'book',source:'engram',text:'旧书'}],health:[{name:'engram',status:'read'}]};}}};
 const q=new QuestionRecall(c);const result=await q.lookup('那本书？',{sessionId:'qq',judge:async(_p,_s,{candidates})=>{
 assert.deepEqual(candidates.map(x=>x.id),['memory:book']);return {decision:'proceed',reason:'相关',selectedIds:['memory:book']};}});
 assert.equal(result.matches[0].text,'旧书');assert.equal(result.matches[0].source,'engram');assert.deepEqual(q.record.diaries,stored.diaries);assert.deepEqual(q.record.last,stored.last);assert.equal(q.record.daily.today,1);
});
