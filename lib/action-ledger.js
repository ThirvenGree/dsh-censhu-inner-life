import {imageArtifact,verifyImageArtifact} from './image-artifact.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const readOnly=exec=>['read','read_file','read_image','list_directory','grep','glob','web_search','censhu_agency_context_page','censhu_agency_find_event','censhu_agency_event_history','censhu_question_recall','censhu_read_memory','censhu_agency_method'].includes(exec.name)||exec.name==='censhu_agency_note'&&exec.arguments?.action==='read'||exec.name==='censhu_private_archive'&&['read','list','search','compare'].includes(exec.arguments?.action);
function fileExpectation(exec){
 if(!['write','write_file'].includes(exec.name))return;
 const args=exec.arguments||{},file=args.file_path??args.path;
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof args.content!=='string')return;
 return {path:file,bytes:Buffer.byteLength(args.content),hash:createHash('sha256').update(args.content).digest('hex')};
}
export function verifyFile(row){
 if(!row.expectedFile)return false;
 const expected=row.expectedFile;
 try{
   const stat=fs.lstatSync(expected.path);
   if(!stat.isFile()||stat.size!==expected.bytes||stat.size>16*1024*1024)return false;
   return createHash('sha256').update(fs.readFileSync(expected.path)).digest('hex')===expected.hash;
 }catch{return false;}
}
// A claim precedes dispatch: a crash without a result remains uncertain, never retryable automatically.
export class ActionLedger {
 constructor(dir,runId){this.file=path.join(dir,'action-ledger.json');this.runId=runId;}
 read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,actions:{}};throw e;}}
 save(data){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,this.file);}
 key(exec,legacy=false){
   let args=exec.arguments;
   if(!legacy&&/(?:^|__)qq_generate_image$/.test(exec.name)&&args){const {token,...intent}=args;args=intent;}
   return createHash('sha256').update(JSON.stringify([this.runId,exec.name,canonical(args)])).digest('hex');
 }
 claim(exec){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),old=data.actions[key]||data.actions[this.key(exec,true)];if(old&&old.expectedFile&&!old.verifiedAt&&verifyFile(old)){old.verifiedAt=Date.now();old.verification="file-content-matched";this.save(data);}if(old)return `同一独处任务的相同动作已登记（${old.state}，行动编号 ${old.actionId||key}${old.imageArtifact&&verifyImageArtifact(old.imageArtifact)?'，已核对原图 '+old.imageArtifact.id:''}），禁止重复执行。已有结果请查看原会话；结果不确定先核实，不能通过改写参数绕过。`;
 data.actions[key]={actionId:key,runId:this.runId,name:exec.name,callId:exec.callId,state:'pending',expectedFile:fileExpectation(exec),at:Date.now()};this.save(data);}
 settle(exec,result){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),row=data.actions[key];if(!row||row.callId!==exec.callId||row.state!=='pending')return;row.state=result.isError?'uncertain':'completed';const ids={};for(const field of ['messageId','message_id','requestId','id']){const value=result[field]??result.structuredContent?.[field];if(typeof value==='number'||typeof value==='string'&&value.length<=200)ids[field]=value;}row.receipt={...ids,resultHash:createHash('sha256').update(JSON.stringify(result.content??result.structuredContent??null)).digest('hex')};row.finishedAt=Date.now();row.imageArtifact=imageArtifact(exec,result);if(!row.imageArtifact&&/(?:^|__)qq_generate_image$/.test(exec.name))row.state='uncertain';if(row.imageArtifact){if(verifyImageArtifact(row.imageArtifact)){row.verifiedAt=row.finishedAt;row.verification='image-content-matched';}else{row.state='uncertain';}}if(verifyFile(row)){row.verifiedAt=row.finishedAt;row.verification='file-content-matched';}this.save(data);}
 view(){
   return Object.values(this.read().actions).filter(x=>x.runId===this.runId).map(row=>
     row.imageArtifact?{...row,currentArtifact:verifyImageArtifact(row.imageArtifact)?'matched':'missing-or-changed'}:row);
 }
}

// Keep the final gate installed between turns. After a restart there is no
// owner until agency reacquires the same opportunity; a late call fails closed.
export function lifeActionGate(ctx,dir,display,getSessionId){
 let owner;
 const agentId=agent=>agent?.session?.id||agent?.session?.sessionId||agent?.id;
 const same=(a,b)=>Boolean(a&&b)&&String(a).replace(/^session-/,'')===String(b).replace(/^session-/,'');
 const dispose=ctx.tools.guard(exec=>{
   const id=agentId(exec.agent);
   if(!same(id,getSessionId()))return;
   if(!owner||!same(owner.id,id)||!owner.tracking())return '生活会话没有已接管的主动执行回合，工具未派发';
   return owner.ledger.claim(exec);
 });
 return {dispose,claim(agent,thread,tracking,notify){
   const id=agentId(agent);
   if(!same(id,getSessionId())||typeof thread!=='string'||!thread.trim()||typeof tracking!=='function')throw Error('生活动作登记缺少有效的会话或任务编号');
   const release=display.claimLifeTurn(id,notify);if(!release)return null;
   const ledger=new ActionLedger(dir,'agency:'+thread);
   let off;
   try{
     off=agent.ctx.on('tools/post-execute',async(exec,result,next)=>{
       const decision=await next();
       if(same(agentId(exec.agent),id))ledger.settle(exec,{...result,isError:!result||result.isError===true||decision?.kind!=='accept'});
       return decision;
     },{prepend:true});
     owner={id,ledger,tracking};
   }catch(e){release();throw e;}
   let released=false;return ()=>{if(released)return;released=true;owner=undefined;try{off();}finally{release();}};
 }};
}

export function guardContactMedia(ctx,dir,agent,thread,isCurrent){
 const ledger=new ActionLedger(dir,'contact-media:'+thread);
 const matches=exec=>exec.agent?.session?.id===agent.session.id&&/(?:^|__)qq_generate_image$/.test(exec.name);
 const guard=ctx.tools.guard(exec=>{
   if(matches(exec))return isCurrent()?ledger.claim(exec):'主动联系已变化，暂缓生成';
 });
 let off;
 try{off=agent.ctx.on('tools/post-execute',async(exec,result,next)=>{
   const decision=await next();
   if(matches(exec))ledger.settle(exec,{...result,isError:!result||result.isError||decision?.kind!=='accept'});
   return decision;
 },{prepend:true});}catch(error){guard();throw error;}
 return ()=>{off();guard();};
}
