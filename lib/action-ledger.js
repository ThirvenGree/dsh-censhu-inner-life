import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const readOnly=exec=>['read','read_file','read_image','list_directory','grep','glob','web_search','censhu_agency_context_page','censhu_agency_find_event','censhu_agency_event_history','censhu_question_recall'].includes(exec.name)||exec.name==='censhu_agency_note'&&exec.arguments?.action==='read'||exec.name==='censhu_private_archive'&&['read','list','search'].includes(exec.arguments?.action);
// A claim precedes dispatch: a crash without a result remains uncertain, never retryable automatically.
export class ActionLedger {
 constructor(dir,runId){this.file=path.join(dir,'action-ledger.json');this.runId=runId;}
 read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,actions:{}};throw e;}}
 save(data){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,this.file);}
 key(exec){return createHash('sha256').update(JSON.stringify([this.runId,exec.name,canonical(exec.arguments)])).digest('hex');}
 claim(exec){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),old=data.actions[key];if(old)return `同一独处任务的相同动作已登记（${old.state}），禁止重复执行。已有结果请查看原会话；结果不确定先核实，不能通过改写参数绕过。`;
 data.actions[key]={runId:this.runId,name:exec.name,callId:exec.callId,state:'pending',at:Date.now()};this.save(data);}
 settle(exec,result){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),row=data.actions[key];if(!row||row.callId!==exec.callId||row.state!=='pending')return;row.state=result.isError?'uncertain':'completed';row.finishedAt=Date.now();this.save(data);}
 view(){return Object.values(this.read().actions).filter(x=>x.runId===this.runId);}
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
       if(same(agentId(exec.agent),id))ledger.settle(exec,{isError:!result||result.isError===true||decision?.kind!=='accept'});
       return decision;
     },{prepend:true});
     owner={id,ledger,tracking};
   }catch(e){release();throw e;}
   let released=false;return ()=>{if(released)return;released=true;owner=undefined;try{off();}finally{release();}};
 }};
}
