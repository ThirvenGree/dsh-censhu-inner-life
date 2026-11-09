import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerPrivateSession} from '../lib/isolation.js';
import {installToolIsolation,PRIVATE_TOOL_DENIAL} from '../lib/tool-isolation.js';

test('private tools cannot dispatch even after another listener allows; ordinary tools still execute', async()=>{
  const home=process.env.DSH_HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-tool-policy-'));
  process.env.DSH_HOME=dir;
  let gate,guard,disposed=0,executions=0,nextCalls=0;
  const ctx={on(name,fn){assert.equal(name,'tools/pre-execute');gate=fn;return ()=>disposed++;},tools:{guard(fn){guard=fn;return ()=>disposed++;}}};
  try {
    const stop=installToolIsolation(ctx);
    registerPrivateSession('session-private'); // registration can happen after installation
    const privateAgent={session:{id:'private'}},ordinaryAgent={session:{id:'main'}};
    for(const name of ['memory_write','write','exec','mcp__service__call','qq_send_message','read']) {
      const exec={agent:privateAgent,name};
      const decision=await gate(exec,()=>{nextCalls++;return {kind:'allow'};});
      assert.equal(decision.kind,'deny');assert.equal(nextCalls,0);
      // DSH consults monotonic guards after the waterfall, even if a different
      // listener ignores its denial and substitutes allow.
      const overwritten={kind:'allow'};
      if(overwritten.kind==='allow' && guard(exec)===undefined)executions++;
      assert.equal(guard(exec),PRIVATE_TOOL_DENIAL);
    }
    assert.equal(executions,0);
    assert.equal((await gate({agent:ordinaryAgent},()=>({kind:'allow'}))).kind,'allow');
    assert.equal(guard({agent:ordinaryAgent}),undefined);
    assert.equal(guard({}),undefined); // host-side reviewed submissions have no private agent
    assert.equal(guard({agent:privateAgent}),PRIVATE_TOOL_DENIAL); // no active-turn condition
    for(const name of ['censhu_context_recall','censhu_question_recall']){
      const exec={agent:privateAgent,name,arguments:{action:'read'}};
      assert.equal((await gate(exec,()=>({kind:'allow'}))).kind,'allow');
      assert.equal(guard(exec),undefined,'read-only context tools must reach their own scope validation');
    }
    stop();assert.equal(disposed,2);
  } finally {
    if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('unsupported guard fails closed; failed registration releases its preliminary hook',()=>{
  let disposed=0;
  assert.throws(()=>installToolIsolation({}),/缺少tools.guard/);
  assert.throws(()=>installToolIsolation({on:()=>()=>disposed++,tools:{guard(){throw Error('registration failed');}}}),/registration failed/);
  assert.equal(disposed,1);
});

test('personal turn keeps its agency decisions with general tools off; internal handoffs are not user speech',async()=>{
 const {isInternalMessage}=await import('../lib/isolation.js');assert.ok(isInternalMessage({source:{kind:'plugin:dsh-censhu-agency'}}));assert.equal(isInternalMessage({source:{kind:'user'}}),false);
 const prev=process.env.DSH_HOME,h=fs.mkdtempSync(path.join(os.tmpdir(),'agency-guard-'));process.env.DSH_HOME=h;
 try{registerPrivateSession('life-test');let guard;
 const ctx={on:()=>()=>{},tools:{guard:fn=>{guard=fn;return ()=>{};}}};
 const off=installToolIsolation(ctx,()=>false,()=> 'life-test');const agent={session:{id:'life-test'}};
 assert.equal(guard({agent,name:'censhu_agency_diary'}),undefined);assert.equal(guard({agent,name:'censhu_agency_contact'}),undefined);assert.equal(guard({agent,name:'censhu_context_recall'}),undefined);assert.equal(guard({agent,name:'exec'}),PRIVATE_TOOL_DENIAL);off();
 }finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;fs.rmSync(h,{recursive:true,force:true});}
});

test('only the bound QQ session bypasses unsupervised memory capture',async()=>{
 const {requiresReviewedCapture}=await import('../lib/isolation.js');
 const prev=process.env.DSH_HOME,home=fs.mkdtempSync(path.join(os.tmpdir(),'qq-capture-'));process.env.DSH_HOME=home;
 try{const dir=path.join(home,'characters/censhu');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'integration.json'),JSON.stringify({sessionId:'session-qq'}));
 assert.equal(requiresReviewedCapture({session:{id:'qq'}}),true);assert.equal(requiresReviewedCapture('session-other'),false);
 }finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;fs.rmSync(home,{recursive:true,force:true});}
});

// 2026-11-07: test sessions read memory/role state through tools but never write it,
// even while autonomous tools are allowed; platform tools stay usable for testing.
test('test-workspace sessions may read memory but every memory or role-state write is denied', async()=>{
  const {TEST_WRITE_DENIAL,testSessionWrite}=await import('../lib/tool-isolation.js');
  const home=process.env.DSH_HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-test-readonly-'));
  process.env.DSH_HOME=dir;
  let gate,guard;
  const ctx={on(name,fn){gate=fn;return ()=>{};},tools:{guard(fn){guard=fn;return ()=>{};}}};
  try {
    fs.mkdirSync(path.join(dir,'runtime-recovery'));
    fs.writeFileSync(path.join(dir,'runtime-recovery/test-workspace.json'),JSON.stringify({path:path.join(dir,'workspace')}));
    installToolIsolation(ctx,()=>true);
    const probe={session:{id:'session-probe-readonly',header:{cwd:path.join(dir,'workspace','sub')}}};
    const main={session:{id:'session-main',header:{cwd:path.join(dir,'qq-bridge')}}};
    const run=async(agent,name,args={})=>{const exec={agent,name,arguments:args};const d=await gate(exec,()=>({kind:'allow'}));return {kind:d.kind,reason:d.reason,guard:guard(exec)};};
    const writes=[['engram_save',{content:'x'}],['engram_update',{id:'1'}],['engram_forget',{id:'1'}],['engram_facts',{facts:[{entity:'a'}]}],['engram_profile_edit',{action:'edit'}],
      ['mnemon_remember',{}],['mnemon_runtime_memory',{}],['mnemon_forget',{}],['mdcg_remember',{}],['memory',{action:'add'}],['memory',{}],['memory_suggest',{}],
      ['mcp__openviking__write',{}],['mcp__openviking__remember',{}],['mcp__openviking__forget',{}],['mcp__snowluma__qq_memory_append',{}],['douyin_remember',{}],
      ['censhu_correct_memory',{}],['censhu_agency_diary',{}],['censhu_agency_note',{}],['censhu_personality',{action:'propose'}],['censhu_self_develop',{}],['censhu_inner_life',{action:'keep_private'}],
      ['censhu_private_archive',{action:'save'}],['learn_meme',{}],['meme_update',{}]];
    for(const [name,args] of writes){const r=await run(probe,name,args);assert.equal(r.kind,'deny',name);assert.equal(r.reason,TEST_WRITE_DENIAL);assert.equal(r.guard,TEST_WRITE_DENIAL,name);}
    const reads=[['engram_search',{query:'x'}],['engram_facts',{entity:'a'}],['engram_profile_edit',{action:'view'}],['mnemon_recall',{}],['mdcg_recall',{}],['memory',{action:'list'}],
      ['mcp__openviking__search',{}],['mcp__openviking__read',{}],['mcp__snowluma__qq_memory_query',{}],['douyin_recall',{}],['censhu_question_recall',{}],['censhu_read_memory',{}],
      ['censhu_knowledge_recall',{}],['censhu_life_context',{}],['censhu_personality',{action:'read'}],['censhu_private_archive',{action:'search'}],['memory_review_status',{action:'check'}],
      ['douyin_chat_send',{}],['bili_dm_send',{}],['browser_open',{}]];
    for(const [name,args] of reads){const r=await run(probe,name,args);assert.equal(r.kind,'allow',name);assert.equal(r.guard,undefined,name);}
    // The id stays recognised after its cwd was seen once (resumed or late dispatch without a header).
    assert.equal((await run({session:{id:'session-probe-readonly'}},'engram_save')).kind,'deny');
    // Formal role sessions keep writing.
    assert.equal((await run(main,'engram_save',{content:'x'})).kind,'allow');
    assert.equal(testSessionWrite({agent:main,name:'mnemon_remember'}),false);
  } finally {
    if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
