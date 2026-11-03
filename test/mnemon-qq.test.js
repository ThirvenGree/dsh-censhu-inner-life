import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
test('installed Mnemon keeps QQ view and snapshot, skips capture and idle review',{skip:!process.env.AGENCY_PROFILE},async()=>{
 const src=fs.readFileSync(path.join(process.env.AGENCY_PROFILE,'node_modules/dsh-mnemon/lib/index.js'),'utf8');
 const method=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
 const install=method('install(agent, source) {','\n\t}');
 assert.match(install,/isPrivateSession/);assert.doesNotMatch(install,/requiresReviewedCapture/);
 const pre=method('async preStep(payload, next) {','\n\tasync assemblePrompt');
 const schedule=method('scheduleIdleReview(turn) {','\n\tidleReviewAllowed()');
 const scheduleMethod=schedule.slice(0,schedule.indexOf('\n\t}')+3);
 const f=vm.runInNewContext('({'+pre+','+scheduleMethod+'})',{requiresReviewedCapture:()=>true,isMnemonMessageSource:()=>false});
 let cancelled=0;const self={agent:{},config:{writeEnabled:true,writebackMode:'guided',lifecycleEnabled:true},cancelIdleReview(){cancelled++;},memorySnapshotMessage:()=>({text:'旧书'}),recordTurnMessages(){assert.fail('unaudited capture');},cueAlreadyVisible:()=>true};
 const r=await f.preStep.call(self,{step:1,turn:1,signal:{}},async()=>({kind:'enter',messages:[{text:'真实来信'}]}));
 assert.equal(r.messages.at(-1).text,'旧书');f.scheduleIdleReview.call(self,1);assert.equal(cancelled,2);
});
