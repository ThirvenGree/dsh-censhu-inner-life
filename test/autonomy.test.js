import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PrivateArchive,installPrivateArchive,retainPrivateEntries} from '../lib/private-archive.js';
import {installToolIsolation} from '../lib/tool-isolation.js';
import {registerPrivateSession} from '../lib/isolation.js';
import {validateConfig} from '../lib/core.js';

test('archive image read sends the copied bytes through DSH and renders image content, not just a path',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archive-image-'));
 try{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=','base64'),file=path.join(dir,'image.png');fs.writeFileSync(file,bytes);
 const archive=new PrivateArchive(dir),row=archive.save({title:'收藏图片',sourcePath:file},'main');fs.unlinkSync(file);
 let tool,calls=0;const attachment={id:'verified-image',mediaType:'image/png'};const core={dir,record:{},statusSnapshot:{sessionIds:['main']},save(){}};
 installPrivateArchive({tools:{register:t=>(tool=t,()=>{}),async execute(exec){calls++;assert.equal(exec.name,'read_image');assert.deepEqual(fs.readFileSync(exec.arguments.file_path),bytes);return {content:[{type:'image',attachment}]};}}},core);
 const result=await tool.execute({action:'read',id:row.id},{agent:{id:'main'}}),blocks=tool.output.render({},result);
 assert.equal(calls,1);assert.deepEqual(blocks[1],{type:'image',attachment});assert.equal(core.record.recollections.at(-1).status,'image-attached');
 fs.unlinkSync(archive.read(row.id).assetPath);const failed=JSON.parse(await tool.execute({action:'read',id:row.id},{agent:{id:'main'}}));assert.equal(failed.imageStatus,'unavailable');assert.equal(core.record.recollections.at(-1).status,'image-unavailable');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('autonomous gate permits existing tool policy and can be disabled immediately',async()=>{
 const old=process.env.DSH_HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'autonomy-'));process.env.DSH_HOME=dir;
 try{registerPrivateSession('session-own');let gate,guard,enabled=true;installToolIsolation({on:(_n,fn)=>(gate=fn,()=>{}),tools:{guard:fn=>(guard=fn,()=>{})}},()=>enabled);
 for(const name of ['image_generate','browser','write','memory','mcp__action']){const exec={name,agent:{id:'session-own'}};assert.equal(await gate(exec,()=> 'existing-policy'),'existing-policy');assert.equal(guard(exec),undefined);enabled=false;assert.equal((await gate(exec,()=> 'must-not-run')).kind,'deny');assert.match(guard(exec),/禁止/);enabled=true;}
 assert.equal(validateConfig({}).autonomousTools,true);assert.throws(()=>validateConfig({autonomousTools:'yes'}));
 }finally{if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;fs.rmSync(dir,{recursive:true,force:true});}
});

test('private collection persists original text and a separate asset copy, supports recall and rejects traversal',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-archive-'));try{const a=new PrivateArchive(dir),source=path.join(dir,'drawing.png');fs.writeFileSync(source,Buffer.from([1,2,3]));const row=a.save({title:'窗台画作',text:'只留给自己的一点薄荷绿。',sourcePath:source},'own');fs.writeFileSync(source,'changed');assert.deepEqual(fs.readFileSync(a.read(row.id).assetPath),Buffer.from([1,2,3]));assert.equal(a.list('薄荷').total,1);assert.equal(new PrivateArchive(dir).read(row.id).text,'只留给自己的一点薄荷绿。');assert.equal(a.list('不存在').total,0);assert.throws(()=>a.read('../state.json'));let tool;installPrivateArchive({tools:{register:t=>(tool=t,()=>{})}},{dir,statusSnapshot:{sessionIds:['session-main']}});assert.equal(JSON.parse(await tool.execute({action:'list'},{agent:{id:'main'}})).total,1);await assert.rejects(()=>tool.execute({action:'list'},{agent:{id:'unrelated'}}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reviewed private diaries are retained once; pending and shared diaries are not copied',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-retain-'));try{const archive=new PrivateArchive(dir),row={id:'entry:1',at:Date.now(),reviewedAt:Date.now(),shareState:'private',reflection:'一张留给自己的画',sourceId:'main'};retainPrivateEntries(archive,[row,{...row,id:'pending',reviewedAt:0},{...row,id:'shared',shareState:'delivered'}]);retainPrivateEntries(archive,[row]);assert.equal(archive.list().total,1);assert.match(archive.read(archive.list().items[0].id).text,/一张留给自己的画/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('private recall receipts distinguish catalog search from reading an original',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recall-receipt-'));try{const archive=new PrivateArchive(dir),item=archive.save({title:'旧画',text:'那年的窗台'},'session-main');let tool;const core={dir,record:{},statusSnapshot:{sessionIds:['session-main']},save(){}};installPrivateArchive({tools:{register:t=>(tool=t,()=>{})}},core);const exec={agent:{id:'session-main'}};await tool.execute({action:'search',query:'旧画'},exec);assert.equal(core.record.recollections[0].status,'catalog');await tool.execute({action:'read',id:item.id},exec);assert.equal(core.record.recollections[1].status,'read');assert.equal(core.record.recollections[1].title,'旧画');await assert.rejects(()=>tool.execute({action:'read',id:'missing'},exec));assert.equal(core.record.recollections.length,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
