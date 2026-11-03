import test from 'node:test';
import assert from 'node:assert/strict';
import {observationBatch} from '../lib/reflections.js';
test('an unrelated event in the middle survives repeated stages at both ends',()=>{
 const rows=Array.from({length:101},(_,i)=>({id:String(i),at:i,state:'pending',data:{eventId:i===50?'ticket':'scanning'}}));
 rows[51].revisitAt=100;
 assert.deepEqual(observationBatch(rows,3,10).map(r=>r.at),[0,50,100]);
 assert.deepEqual(observationBatch(rows,0),[]);
});

test('specific observations and every referenced event survive the sixteen-row budget',async()=>{
 const {InnerLife}=await import('../lib/core.js');
 const rows=Array.from({length:40},(_,n)=>({id:'o'+n,at:n,data:{eventId:n===0?'ticket':'scan'}}));
 const v=InnerLife.prototype.diaryEvidence.call({},rows,['ticket','scan','gone'],['o4','absent'],30);
 assert.equal(v.observations.length,16);assert.ok(['o0','o4','o30'].every(id=>v.observations.some(r=>r.id===id)));
 assert.ok(v.observations.every(r=>r.at<=30));assert.deepEqual(v.missingEvents,['gone']);assert.deepEqual(v.missingObservations,['absent']);
});
