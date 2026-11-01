import test from 'node:test';
import assert from 'node:assert/strict';
import {DisplaySession,diaryText} from '../lib/display-session.js';
test('local replay only intercepts the exact display session and preserves approved text',async()=>{
 let hook;const ctx={effect:f=>f(),on:(name,f)=>{assert.equal(name,'llm/stream');hook=f;return()=>{};}};
 const d=new DisplaySession(ctx,'unused');let remote=0;const next=()=>{remote++;return 'remote';};
 assert.equal(hook({sessionId:'ordinary'},next),'remote');
 d.active.set('display',{messageId:'m',text:'已审核的原文',intercepted:false});
 assert.throws(()=>hook({sessionId:'display',messages:[]},next),/来源标记/);
 const out=[];for await(const x of hook({sessionId:'display',messages:[{id:'m'}]},next))out.push(x);
 assert.equal(out.find(x=>x.type==='text-delta').text,'已审核的原文');assert.equal(out.at(-1).reason.kind,'stop');assert.equal(remote,1);assert.equal(d.active.get('display').intercepted,true);
});
test('diary rendering retains original feelings and distinguishes future intention',()=>{
 const text=diaryText({at:1,feeling:'轻松',reflection:'记下一件小事',intention:'明天再看'});assert.match(text,/轻松/);assert.match(text,/接下来的打算：明天再看/);
});
import {personalitySnapshot} from '../lib/display-session.js';
test('personality display uses effective traits only and changes on updates or expiry',()=>{
 const trait={id:'a',text:'更愿意表达感受',status:'established',updatedAt:1000,expiresAt:9000,reason:'经历带来的变化'};
 const p={enabled:true,activeItems:[trait],items:[trait,{id:'b',text:'未审核',status:'observing'}]};
 const s=personalitySnapshot(p);assert.match(s.text,/更愿意表达感受/);assert.doesNotMatch(s.text,/未审核/);assert.equal(s.hash,personalitySnapshot({...p,status:'reading'}).hash);
 assert.notEqual(s.hash,personalitySnapshot({...p,activeItems:[{...trait,text:'更新后的倾向'}]}).hash);
 assert.notEqual(s.hash,personalitySnapshot({...p,activeItems:[]}).hash);assert.match(personalitySnapshot({...p,activeItems:[]}).text,/尚未形成/);
});
import {installDisplayReadOnly,dynamicSnapshot} from '../lib/display-session.js';
test('display rejects manual prompts before admission but keeps ordinary conversations usable',()=>{let called=0;const controller={prompt(r){called++;return r.sessionId;}};const before=controller.prompt;const off=installDisplayReadOnly(controller,()=> 'display');assert.throws(()=>controller.prompt({sessionId:'display'}),/只读/);assert.equal(called,0);assert.equal(controller.prompt({sessionId:'normal'}),'normal');off();assert.equal(controller.prompt,before);});
test('dynamic overview tracks effects and growth while ignoring display heartbeat',()=>{const state={config:{enabled:true},entries:[],personalGrowth:{items:[]},personality:{activeItems:[]}};const a=dynamicSnapshot(state);assert.equal(a.hash,dynamicSnapshot({...state,display:{at:123}}).hash);assert.notEqual(a.hash,dynamicSnapshot({...state,personalGrowth:{items:[{text:'新的生活积累'}]}}).hash);assert.match(a.text,/独处动态概览/);});
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {ProcessJournal} from '../lib/display-session.js';
test('durable journal retains intermediate real stages and deduplicates polling',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-process-'));try{
 const j=new ProcessJournal(dir),v={config:{enabled:true},status:'judging',pending:2,entries:[],checkpoint:{id:'run',phase:'attention'}};
 j.capture(v);j.capture(v);assert.equal(j.rows.length,1);
 j.capture({...v,status:'reflecting',checkpoint:{id:'run',phase:'reflect'}});
 j.capture({...v,status:'degraded',error:'Insufficient Balance',checkpoint:{id:'run',phase:'reflect'}});
 const restored=new ProcessJournal(dir);assert.equal(restored.rows.length,3);assert.match(restored.rows[1].displayText,/DSH 正在生成/);assert.match(restored.rows[2].displayText,/Insufficient Balance/);assert.doesNotMatch(restored.rows[2].displayText,/已恢复/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('live Gemini execution starts inside native turn exactly once and returns original result',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-live-'));let hook,admitted=false,calls=0,current,promise;const outputs=[];
 const agent={status:'idle',followup(message){admitted=true;current=message;this.status='running';promise=(async()=>{for await(const chunk of hook({sessionId:'display',messages:[message]},()=>assert.fail('no extra provider call')))outputs.push(chunk);this.status='idle';})();},whenIdle(){return promise||Promise.resolve();}};
 const ctx={effect:f=>f(),on:(_,fn)=>{hook=fn;return()=>{};},get:()=>({resolveAgent:async()=>({agent})})};
 try{fs.writeFileSync(path.join(dir,'display-session.json'),JSON.stringify({sessionId:'display'}));const display=new DisplaySession(ctx,dir),result={decision:'later',reason:'暂不分享'};
 assert.equal(await display.runGemini({feature:'inner-deliberation',input:{purpose:'share'}},async()=>{assert.equal(admitted,true);calls++;return result;}),result);
 assert.equal(calls,1);assert.ok(current.source.executionRequestId);assert.match(outputs.filter(x=>x.type==='text-delta').map(x=>x.text).join(''),/正在执行插件内的真实请求/);assert.match(outputs.at(-2).block.text,/Gemini 请求已返回/);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'gemini-executions.json')))[0].status,'success');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('live Gemini failure is displayed and propagated without retrying the request',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inner-live-error-'));let hook,promise,calls=0;const chunks=[];
 const agent={followup(m){promise=(async()=>{for await(const x of hook({sessionId:'display',messages:[m]},()=>assert.fail()))chunks.push(x);})();},whenIdle(){return promise||Promise.resolve();}};
 const ctx={effect:f=>f(),on:(_,fn)=>{hook=fn;return()=>{};},get:()=>({resolveAgent:async()=>({agent})})};
 try{fs.writeFileSync(path.join(dir,'display-session.json'),JSON.stringify({sessionId:'display'}));const display=new DisplaySession(ctx,dir),error=Object.assign(Error('test timeout'),{httpStatus:503});await assert.rejects(()=>display.runGemini({feature:'inner-core',input:{}},async()=>{calls++;throw error;}),e=>e===error);assert.equal(calls,1);assert.match(chunks.at(-2).block.text,/请求失败/);assert.equal(display.active.size,0);assert.equal(display.pendingRuns,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
