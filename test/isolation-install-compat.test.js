import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const installer=fs.readFileSync(new URL('../scripts/install-isolation.mjs',import.meta.url),'utf8');
const start=installer.indexOf('function patchMoodTurnGuard('),end=installer.indexOf('\nconst manifest=',start);
const patch=vm.runInNewContext('('+installer.slice(start,end)+')');
const old='if (!stillBound()) return\n        // 以会话事件';
const modern="if (!stillBound()) {\n          diag('turn-stopping unbound')\n          return\n        }\n        // 以会话事件";
for(const [version,input] of [['0.8.3',old],['0.8.7',modern]])test('mood '+version+' preserves bound/private gates and diagnostic behavior',()=>{
 const output=patch(input);assert.equal(patch(output),output);
 for(const [bound,internal] of [[false,false],[true,true],[true,false]]){
  const calls=[];const run=vm.runInNewContext('(function(){'+output+'\n return "judged";})',{stillBound:()=>bound,isInternalMessage:()=>internal,lastSrc:'fixture',diag:value=>calls.push(value)});
  assert.equal(run(),bound&&!internal?'judged':undefined);
  assert.equal(calls.length,version==='0.8.7'&&!bound?1:0);
 }
});
test('mood guard rejects an unknown callback instead of dropping new work',()=>{
 assert.throws(()=>patch(modern.replace("diag('turn-stopping unbound')","doSomethingElse()")),/不兼容/);
 assert.throws(()=>patch(modern+'\n'+modern),/不兼容/);
});
