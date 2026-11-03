import test from 'node:test';
import assert from 'node:assert/strict';
import {observationBatch} from '../lib/reflections.js';
test('an unrelated event in the middle survives repeated stages at both ends',()=>{
 const rows=Array.from({length:101},(_,i)=>({id:String(i),at:i,state:'pending',data:{eventId:i===50?'ticket':'scanning'}}));
 rows[51].revisitAt=100;
 assert.deepEqual(observationBatch(rows,3,10).map(r=>r.at),[0,50,100]);
 assert.deepEqual(observationBatch(rows,0),[]);
});
