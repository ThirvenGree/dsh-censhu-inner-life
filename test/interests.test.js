import test from 'node:test';
import assert from 'node:assert/strict';
import {Interests} from '../lib/interests.js';
test('a new self-directed clue may create an interest, repeated clues do not rejudge, later evidence may end it',async()=>{
 let now=Date.now(),count=0,subject='想去看画框',store;
 const c={dir:'Z:/synthetic/inner',now:()=>now,config:{enabled:true},read:(_f,d)=>store||d,write:(_f,r)=>{store=structuredClone(r)},record:{entries:[]},sourceId:()=>'main',life:{status:()=>({enabled:true,sessionIds:['main'],events:[{id:'event',name:subject}]}),judge:async(_p,_s,input)=>{count++;return {decision:'update',reason:'这次有新线索',nextMinutes:5,changes:[{id:input.existing[0]?.id||'',topic:'画框',state:count===1?'刚好奇':'已看够',archive:count===2,validDays:1,reason:'本次生活线索',evidence:[input.sources[0].id]}]}}}};
 const interest=new Interests(c);await interest.tick();assert.equal(interest.active().length,1);now+=864000;await new Interests(c).tick();assert.equal(count,1);subject='看过后想做别的';await interest.tick();assert.equal(count,2);assert.deepEqual(interest.active(),[]);assert.equal(interest.view().history[1].previous,'刚好奇');
});
