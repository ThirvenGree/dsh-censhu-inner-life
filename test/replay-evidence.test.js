import test from 'node:test';
import assert from 'node:assert/strict';
import {replayEvidence} from '../lib/source-roots.js';
test('replay presents different phases as one experience and preserves contrary episodes',()=>{
 const queue=[{id:'o1',kind:'start',data:{eventId:'e1',choice:'draw'}},{id:'o2',kind:'end',data:{eventId:'e1',choice:'stopped'}},{id:'o3',kind:'start',data:{eventId:'e2',choice:'read'}}];
 const replay=replayEvidence(queue,[{sourceGroups:['event:e1']},{sourceGroups:['event:e1']}]);
 assert.deepEqual(replay.map(r=>[r.group,r.linked,r.observations.length]),[['event:e1',true,2],['event:e2',false,1]]);
});
