import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ActionLedger} from '../lib/action-ledger.js';
import {spawnSync} from 'node:child_process';
test('a fresh Node process cannot repeat a completed external action or a crash-uncertain action',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-process-'));
 try{
 const script=`import fs from 'node:fs';import path from 'node:path';import {ActionLedger} from ${JSON.stringify(new URL('../lib/action-ledger.js',import.meta.url).href)};const dir=process.argv[1],mode=process.argv[2],ledger=new ActionLedger(dir,mode),exec={name:'write',arguments:{file:'kept.txt',text:'once'},callId:'new-'+Date.now()};if(!ledger.claim(exec)){fs.appendFileSync(path.join(dir,mode+'.txt'),'executed\\n');if(mode==='completed')ledger.settle(exec,{isError:false});}`;
 for(const mode of ['completed','crash'])for(let i=0;i<2;i++){const child=spawnSync(process.execPath,['--input-type=module','-e',script,dir,mode],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);}
 for(const mode of ['completed','crash'])assert.equal(fs.readFileSync(path.join(dir,mode+'.txt'),'utf8'),'executed\n');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('completed and interrupted actions stay blocked after disk reload; distinct tasks remain independent',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-ledger-'));
 try{let ledger=new ActionLedger(dir,'run1');const exec={name:'image_generate',arguments:{prompt:'窗台',size:512},callId:'first'};
 assert.equal(ledger.claim(exec),undefined);ledger.settle(exec,{isError:false});ledger=new ActionLedger(dir,'run1');assert.match(ledger.claim({...exec,callId:'new',arguments:{size:512,prompt:'窗台'}}),/completed/);
 const uncertain={name:'qq_send_message',arguments:{text:'你好'},callId:'send'};assert.equal(ledger.claim(uncertain),undefined);assert.match(new ActionLedger(dir,'run1').claim({...uncertain,callId:'retry'}),/pending/);
 assert.equal(new ActionLedger(dir,'run2').claim(exec),undefined);
 const read={name:'read_image',arguments:{file_path:'picture.png'}};assert.equal(ledger.claim(read),undefined);assert.equal(ledger.claim(read),undefined);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('corrupt or unwritable ledger fails before dispatch instead of silently forgetting actions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-ledger-'));try{const ledger=new ActionLedger(dir,'run');fs.writeFileSync(ledger.file,'broken');assert.throws(()=>ledger.claim({name:'write',arguments:{},callId:'x'}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('context and memory reads remain repeatable after failure without persistent action claims; edits stay protected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-read-ledger-'));
 try{
  const ledger=new ActionLedger(dir,'reading');
  for(const [name,args] of [
   ['censhu_context_recall',{action:'catalog'}],['censhu_context_recall',{action:'read',offset:0}],
   ['censhu_question_recall',{question:'一件旧事'}],['censhu_life_context',{}],['censhu_read_memory',{backend:'openviking'}],
   ['censhu_agency_method',{action:'recall'}],['censhu_agency_method','{"action":"recall"}'],
   ['censhu_agency_note','{"action":"read"}'],['censhu_private_archive',{action:'compare'}],
  ]){
   const exec={name,arguments:args,callId:'read'};
   assert.equal(ledger.claim(exec),undefined);ledger.settle(exec,{isError:true});
   assert.equal(ledger.claim({...exec,callId:'retry'}),undefined);
  }
  assert.equal(fs.existsSync(ledger.file),false,'pure reads must not create action-ledger state');
  for(const [name,args] of [['censhu_agency_method',{action:'choose'}],['censhu_agency_note',{action:'keep'}],['censhu_private_archive',{action:'save'}],['censhu_correct_memory',{action:'replace'}]]){
   const exec={name,arguments:args,callId:'write'};
   assert.equal(ledger.claim(exec),undefined);ledger.settle(exec,{isError:true});
   assert.match(ledger.claim({...exec,callId:'retry'}),/uncertain/);
  }
  assert.equal(ledger.view().length,4);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('agency life-turn hooks protect dispatch, late calls, restart and task boundaries',async()=>{
 const {lifeActionGate}=await import('../lib/action-ledger.js');
 const {DisplaySession}=await import('../lib/display-session.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agency-live-gate-'));
 try{
  fs.writeFileSync(path.join(dir,'display-session.json'),JSON.stringify({sessionId:'life'}));
  let gate,post,tracking=false;
  const ctx={effect:f=>f(),on:()=>()=>{},tools:{guard(fn){gate=fn;return ()=>{gate=null;};}}};
  const agent={session:{id:'life'},ctx:{on(event,fn){assert.equal(event,'tools/post-execute');post=fn;return ()=>{post=null;};}}};
  const build=()=>lifeActionGate(ctx,dir,new DisplaySession(ctx,dir),()=>'life');
  const call=(name,args,id)=>({name,arguments:args,callId:id,agent});
  const write=call('write',{text:'once',file:'out'},'one'),image=call('image_generate',{prompt:'ticket'},'two'),code=call('run_code',{code:'externalAction()'},'three');
  let service=build(),release=service.claim(agent,'opportunity-A',()=>tracking,()=>{});
  assert.equal(typeof gate(write),'string');assert.equal(gate({...write,agent:{id:'qq'}}),undefined);
  tracking=true;
  if(!gate(write))fs.appendFileSync(path.join(dir,'out'),'once');
  assert.deepEqual(await post(write,{isError:false},async()=>({kind:'accept'})),{kind:'accept'});
  assert.match(gate({...write,arguments:{file:'out',text:'once'},callId:'retry'}),/completed/);
  assert.equal(gate(image),undefined); // crash after dispatch, without a result
  assert.equal(gate(code),undefined);await post(code,{isError:false},async()=>({kind:'block'}));
  for(let n=0;n<2;n++)assert.equal(gate(call('censhu_agency_event_history',{eventId:'ticket'},String(n))),undefined);
  release();assert.equal(post,null);assert.equal(typeof gate(write),'string');service.dispose();
  service=build();assert.equal(typeof gate(write),'string');release=service.claim(agent,'opportunity-A',()=>true,()=>{});
  assert.match(gate({...image,callId:'again'}),/pending/);assert.match(gate({...code,callId:'again'}),/uncertain/);
  assert.match(gate({...write,callId:'again'}),/completed/);assert.equal(fs.readFileSync(path.join(dir,'out'),'utf8'),'once');
  release();release=service.claim(agent,'opportunity-B',()=>true,()=>{});assert.equal(gate(write),undefined);release();service.dispose();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
