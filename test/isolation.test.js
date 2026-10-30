import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {registerPrivateSession,isPrivateSession,isInternalMessage} from '../lib/isolation.js';import {isolationHealth} from '../lib/isolation-health.js';
test('pre-registered identities and legacy identities are private; main sessions remain ordinary',()=>{
 const original=process.env.DSH_HOME,home=fs.mkdtempSync(path.join(os.tmpdir(),'inner-isolation-'));process.env.DSH_HOME=home;
 try{const dir=path.join(home,'censhu-inner-life');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({worker:{sessionId:'session-legacy'},workers:[]}));registerPrivateSession('session-private');assert.equal(isPrivateSession({session:{id:'private'}}),true);assert.equal(isPrivateSession({id:'session-legacy'}),true);assert.equal(isPrivateSession('session-human'),false);for(const kind of ['censhu-inner-life','censhu-inner-life-notice','plugin:censhu-inner-life'])assert.equal(isInternalMessage({source:{kind}}),true);assert.equal(isInternalMessage({source:{kind:'user'}}),false);
 }finally{if(original)process.env.DSH_HOME=original;else delete process.env.DSH_HOME;fs.rmSync(home,{recursive:true,force:true});}
});
test('adapter health fails closed on changed source and recovers after manifest repair',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-health-')),file=path.join(dir,'adapter.js'),hash=x=>createHash('sha256').update(x).digest('hex');
 try{fs.writeFileSync(file,'original');const manifest={version:1,protocol:'censhu-private-session-v1',files:[{file,hash:hash('original')}]};fs.writeFileSync(path.join(dir,'isolation-adapters.json'),JSON.stringify(manifest));assert.equal(isolationHealth(dir,100000).ready,true);fs.writeFileSync(file,'upgraded');assert.equal(isolationHealth(dir,131000).ready,false);manifest.files[0].hash=hash('upgraded');fs.writeFileSync(path.join(dir,'isolation-adapters.json'),JSON.stringify(manifest));assert.equal(isolationHealth(dir,162000).ready,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
