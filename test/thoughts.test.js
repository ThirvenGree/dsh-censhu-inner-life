import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Thoughts,applyThoughtChanges,thoughtSources,projectThought} from '../lib/thoughts.js';
import {readThoughts,innerStateContext} from '../../dsh-cen-shu-life/lib/inner-state-view.js';
import {LifeEngine} from '../../dsh-cen-shu-life/lib/engine.js';
const subject=(id='book')=>({id,operation:'upsert',subject:id==='book'?'一本旧书':'窗边画作',kind:'作品',summary:'想亲近，也有些保留',reason:'翻看之后有了不同理解',certainty:'mixed',salience:70,validHours:48,dimensions:[{id:'curiosity',label:'好奇',view:'想知道另一种解释',intensity:null,certainty:'uncertain',influence:'先查资料再下结论'}],links:[]});
const value=(changes=[subject()])=>({decision:'proceed',reason:'愿意再想想',nextMinutes:120,changes});

test('thoughts support extensible dimensions and cross-object links; reject individual invalid items',()=>{
 const book=subject(),picture=subject('picture');book.links=[{targetId:'picture',relation:'联想',influence:'书的气氛影响画的理解'},{targetId:'missing',relation:'不存在',influence:''}];book.dimensions.push({id:'invalid'});const r=applyThoughtChanges([],value([book,picture,{id:'bad'}]),1000);assert.equal(r.items.length,2);assert.equal(r.items[0].dimensions.length,1);assert.equal(r.items[0].links.length,1);assert.equal(r.rejected.length,2);assert.equal(r.items[0].dimensions[0].intensity,null);
 const removed=applyThoughtChanges(r.items,value([{id:'picture',operation:'remove'}]),2000);assert.equal(removed.items.length,1);assert.equal(removed.items[0].links.length,0);
 const duplicate=applyThoughtChanges(r.items,value([{...book,id:'new-id'}]),2000);assert.equal(duplicate.items.length,2);assert.match(duplicate.rejected[0],/沿用编号/);
});

test('skip and uncertainty preserve all existing thoughts even if candidate changes were supplied',()=>{const items=applyThoughtChanges([],value(),1000).items;for(const decision of ['skip','uncertain']){const r=applyThoughtChanges(items,{...value([{id:'book',operation:'remove'}]),decision},2000);assert.deepEqual(r.items,items);assert.deepEqual(r.applied,[]);}});

test('memory, mood and life feed thoughts; dynamic revisit, failure retention and disabling work',async()=>{
 let now=100000,at=1,calls=0,fail=false;const files=new Map(),c={config:{enabled:true,thoughtsEnabled:true,maxThoughtsDaily:10},now:()=>now,date:()=> '2026-11-01',read:(n,f)=>structuredClone(files.get(n)||f),write:(n,v)=>files.set(n,structuredClone(v)),record:{entries:[]},sourceId:()=> 'main',life:{status:()=>({activity:{at,recent:[]},mood:{mood:60},life:{activity:'看书'},events:[]}),personalitySources:async()=>({memories:[{id:'m1',text:'聊过这本书'}],health:[{name:'memory',status:'read'}]}),judge:async(_p,_s,input,options)=>{if(options.feature==='inner-thought-routing')return {decision:'proceed',reason:'考虑新对象',targetIds:[],selectedIds:[],allowCreate:true,nextMinutes:120};calls++;assert.equal(input.memories[0].id,'m1');assert.equal(input.mood.mood,60);assert.equal(options.feature,'inner-thoughts');if(fail)throw Error('offline');return value();}}};
 const t=new Thoughts(c);await t.tick();assert.equal(t.active().length,1);assert.match(t.context(),/主观想法/);await t.tick();assert.equal(calls,1);now+=60001;at++;fail=true;await t.tick();assert.equal(t.active().length,1);assert.equal(t.view().status,'degraded');c.config.thoughtsEnabled=false;assert.deepEqual(t.active(),[]);assert.equal(t.context(),'');
});

test('thoughts feed the real life and mood shared projection independently of an inner-state snapshot',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'thought-link-'));try{const dir=path.join(home,'censhu-inner-life');fs.mkdirSync(dir);const now=Date.now(),items=applyThoughtChanges([],value(),now).items;fs.writeFileSync(path.join(dir,'thoughts.json'),JSON.stringify({version:1,items}));assert.equal(readThoughts(home,now).length,1);assert.match(innerStateContext(home,now),/一本旧书/);const e=new LifeEngine({home,now:()=>now});assert.equal(e.life().thoughts[0].id,'book');fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({thoughtsEnabled:false}));assert.deepEqual(e.life().thoughts,[]);assert.equal(innerStateContext(home,now),'');fs.writeFileSync(path.join(dir,'config.json'),'{}');assert.deepEqual(readThoughts(home,now+49*3600000),[]);}finally{fs.rmSync(home,{recursive:true,force:true});}
});


test('thought provenance keeps exact catalog snapshots and rejects invented sources per item',()=>{
 const input={memories:[{id:'memory1',text:'青枔提起一本旧书'}],diaries:[{id:'diary1',text:'我对此有些保留'}]};
 const catalog=thoughtSources(input);assert.equal(catalog.length,2);assert.equal(catalog[1].kind,'private-diary');
 const r=applyThoughtChanges([],value([{...subject(),sourceIds:[catalog[0].id]}, {...subject('picture'),sourceIds:['invented']}]),1000,catalog);
 assert.equal(r.items.length,1);assert.match(r.rejected[0],/引用来源/);assert.equal(r.items[0].provenance[0].snapshot,JSON.stringify(input.memories[0]));
 catalog[0].snapshot='changed';assert.notEqual(r.items[0].provenance[0].snapshot,'changed');
 const updated=applyThoughtChanges(r.items,value([{...subject(),sourceIds:[]}]),2000,[]);assert.equal(updated.items[0].provenance.length,0);assert.equal(updated.items[0].provenanceStatus,'subjective-unreferenced');
 assert.notEqual(thoughtSources({memories:[{id:'memory1',text:'不同原文'}]})[0].id,r.items[0].provenance[0].id);
});

test('routine context omits raw provenance while persisted objects keep it',()=>{const item={id:'book',provenance:[{id:'m',kind:'memory',snapshot:'private source',digest:'abc'}]};assert.equal(projectThought(item).provenance[0].snapshot,undefined);assert.equal(item.provenance[0].snapshot,'private source');});

test('shared life projection follows contextual selection rather than highest salience',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'thought-selection-'));try{const dir=path.join(home,'censhu-inner-life');fs.mkdirSync(dir);const now=Date.now(),low=applyThoughtChanges([],value([{...subject(),salience:1}]),now).items[0],high={...low,id:'unrelated',subject:'另一件不相关的事',salience:100};fs.writeFileSync(path.join(dir,'thoughts.json'),JSON.stringify({version:1,items:[low,high],selection:{ids:['book'],expiresAt:now+60000}}));const e=new LifeEngine({home,now:()=>now});assert.deepEqual(e.life().thoughts.map(x=>x.id),['book']);assert.doesNotMatch(innerStateContext(home,now),/另一件不相关的事/);assert.equal(readThoughts(home,now+61000).length,2);}finally{fs.rmSync(home,{recursive:true,force:true});}
});
