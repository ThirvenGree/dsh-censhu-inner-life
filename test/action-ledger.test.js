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
