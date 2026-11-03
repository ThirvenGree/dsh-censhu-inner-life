import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {guardContactMedia,ActionLedger} from '../lib/action-ledger.js';
test('QQ handoff registers actual image tool, preserves unknown across retry, and unregisters hooks',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agency-contact-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let check,post,authorized=true;
 const ctx={tools:{guard(fn){check=fn;return ()=>{check=null;};}}};
 const agent={session:{id:'qq'},ctx:{on(name,fn){assert.equal(name,'tools/post-execute');post=fn;return ()=>{post=null;};}}};
 const call={agent,name:'mcp__snowluma__qq_generate_image',callId:'a',arguments:{prompt:'a tree'}};
 const start=()=>guardContactMedia(ctx,dir,agent,'intent',()=>authorized);
 let release=start();assert.equal(check(call),undefined);
 await post(call,{content:[{type:'text',text:'no artifact id'}]},async()=>({kind:'accept'}));
 assert.equal(new ActionLedger(dir,'contact-media:intent').view()[0].state,'uncertain');
 release();assert.equal(post,null);release=start();
 assert.ok(check({...call,callId:'b'}));authorized=false;assert.ok(check(call));release();
});
