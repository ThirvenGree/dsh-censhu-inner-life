import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {requiresReviewedCapture} from '../lib/isolation.js';
test('desktop role bindings require reviewed capture while unrelated sessions retain native behavior',()=>{
 const previous=process.env.DSH_HOME,home=fs.mkdtempSync(path.join(os.tmpdir(),'capture-surfaces-'));process.env.DSH_HOME=home;
 try{
  fs.mkdirSync(path.join(home,'characters/censhu'),{recursive:true});fs.mkdirSync(path.join(home,'cen-shu-life'));
  fs.writeFileSync(path.join(home,'characters/censhu/integration.json'),JSON.stringify({sessionId:'session-qq'}));
  const file=path.join(home,'cen-shu-life/config.json');fs.writeFileSync(file,JSON.stringify({sessionIds:['session-qq','session-desktop']}));
  assert.equal(requiresReviewedCapture('qq'),true);assert.equal(requiresReviewedCapture('desktop'),true);assert.equal(requiresReviewedCapture('other'),false);
  fs.writeFileSync(file,JSON.stringify({sessionIds:['session-qq']}));assert.equal(requiresReviewedCapture('desktop'),false);
  fs.writeFileSync(file,'{broken');assert.throws(()=>requiresReviewedCapture('desktop'));
 }finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
});

import {InnerLife} from '../lib/core.js';
test('recent desktop activity cannot change the canonical agency owner',()=>{
 const snapshot={primarySessionId:'session-qq',sessionIds:['session-qq','session-desktop'],activity:{sessionId:'session-desktop'}};
 assert.equal(InnerLife.prototype.sourceId.call({statusSnapshot:snapshot}),'session-qq');
});
