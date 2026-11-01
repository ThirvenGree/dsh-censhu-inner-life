import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleWithReceipt} from '../lib/assembly-receipt.js';
const text=ids=>'prefix【岑舒独处后的临时状态】'+JSON.stringify(ids.map(id=>({id,reflection:'自己的感受'})))+'。这是你自己的生活感受与打算，不是青枔发来的话';
test('receipt awaits next and acknowledges only entries actually assembled',async()=>{
 let continued=0;const receipts=[];
 const core={context:()=>({ids:['a','b']}),seen:(...args)=>receipts.push(args)};
 const result={contexts:[{name:'cen-shu-life',text:text(['b','unknown'])}],tools:[{name:'keep'}]};
 assert.equal(await assembleWithReceipt(core,'main',async()=>{continued++;await Promise.resolve();assert.equal(receipts.length,0);return result;}),result);
 assert.equal(continued,1);assert.deepEqual(receipts,[['main',['b']]]);
});
test('absent, unrelated, or malformed contexts produce no receipts',async()=>{
 const core={context:()=>({ids:['a']}),seen:()=>assert.fail('not included')};
 for(const contexts of [[],[{name:'other',text:text(['a'])}],[{name:'cen-shu-life',text:'ordinary life'}],[{name:'cen-shu-life',text:'【岑舒独处后的临时状态】invalid'}]]){
  const result={contexts};assert.equal(await assembleWithReceipt(core,'main',async()=>result),result);
 }
});
test('receipt write failures are optional but downstream failures propagate',async()=>{
 const failure=new Error('disk full'),errors=[],result={contexts:[{name:'cen-shu-life',text:text(['a'])}]};
 const core={context:()=>({ids:['a']}),seen:()=>{throw failure;}};
 assert.equal(await assembleWithReceipt(core,'main',async()=>result,e=>errors.push(e)),result);assert.deepEqual(errors,[failure]);
 await assert.rejects(assembleWithReceipt(core,'main',async()=>{throw failure;}),e=>e===failure);
});
