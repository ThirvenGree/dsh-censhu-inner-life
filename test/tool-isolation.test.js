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
 assert.equal(guard({agent,name:'censhu_agency_diary'}),undefined);assert.equal(guard({agent,name:'censhu_agency_contact'}),undefined);assert.equal(guard({agent,name:'exec'}),PRIVATE_TOOL_DENIAL);off();
 }finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;fs.rmSync(h,{recursive:true,force:true});}
});
