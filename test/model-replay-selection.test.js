import test from 'node:test';import assert from 'node:assert/strict';
import {selectReplay} from '../lib/source-roots.js';
test('reviewer can read an intermediate change and an older contrary observation',async()=>{
 const queue=Array.from({length:12},(_,i)=>({id:'o'+i,kind:'stage',at:i,data:{eventId:i<6?'one':'two',stageText:'stage '+i}}));
 const core={record:{queue},life:{judge:async(_p,_s,input)=>{assert.equal(input.directory.length,12);return {ids:['o2','o7']};}}};
 const replay=await selectReplay(core,[{sourceGroups:['event:one']}],[{text:'test'}]);assert.deepEqual(replay.selected.map(x=>x.id),['o2','o7']);
});
