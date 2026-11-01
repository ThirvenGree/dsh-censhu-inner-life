import {ActionLedger} from './action-ledger.js';
import {PRIVATE_TOOL_DENIAL} from './tool-isolation.js';
import {registerPrivateSession} from './isolation.js';
import {randomUUID} from 'node:crypto';
import {reflectionPrompt} from './prompts.js';
const sid=agent=>agent?.session?.id||agent?.id;
const identityError=()=>Object.assign(Error('DSH未采用预登记编号，独处会话创建已暂停；请查看身份故障及清理状态'),{code:'INNER_SESSION_IDENTITY'});
const busyError=()=>Object.assign(Error('主会话或独处会话忙碌，继续排队'),{code:'INNER_BUSY'});
const same=(a,b)=>String(a||'').replace(/^session-/,'')===String(b||'').replace(/^session-/,'');
export function parseDiary(text){const body=String(text).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');return JSON.parse(body);}
// Native DSH turns own persistence, persona assembly and provider accounting. A scoped
// tool-denied turn only proposes a diary; prompt schemas are not a security boundary.
export class DshWorker {
  constructor(ctx,core){this.ctx=ctx;this.core=core;for(const row of [core.record.worker,...(core.record.workers||[])])if(row?.sessionId)registerPrivateSession(row.sessionId);}
  list(){try{return this.ctx.agents.roots?.()||this.ctx.agents.list()||[];}catch{return [];}}
  source(sourceId){return this.list().find(a=>same(sid(a),sourceId));}
  async resolve(sourceId,runId){
    const controller=this.ctx.get('sessionController');if(!controller?.create||!controller.resolveAgent)throw Error('DSH缺少会话创建/恢复接口，需要重新适配');
    if(this.core.record.creationFailure?.blocked)throw identityError();
    let id=this.core.record.worker?.runId===runId&&!this.core.record.worker?.failed?this.core.record.worker.sessionId:null;
    if(!id){await this.archiveOld(sourceId);const live=(this.core.record.workers||[]).filter(x=>!x.archivedAt);if(live.length>=5)throw Error('独处会话尚未归档，已停止新建；请检查DSH归档接口');if(this.core.record.worker){this.core.record.workers||=[];if(!this.core.record.workers.some(x=>x.sessionId===this.core.record.worker.sessionId))this.core.record.workers.push({...this.core.record.worker});}const source=this.source(sourceId);if(!source)throw Error('请先载入岑舒主会话');const cwd=source.session?.meta?.cwd||this.core.dir;const requested='session-'+randomUUID(),before=await this.sessionInventory();registerPrivateSession(requested);const created=await controller.create({cwd,sessionId:requested});id=created?.sessionId;if(id!==requested){await this.rejectIdentity({requested,returned:id,sourceId,cwd,before,runId});throw identityError();}if(!id||same(id,sourceId))throw Error('未创建独立生活会话');this.core.record.worker={sessionId:id,requestedSessionId:requested,identityVerified:id===requested,runId,createdAt:this.core.now(),turns:0};this.core.save();}
    await this.archiveOld(sourceId);const resolved=await controller.resolveAgent(id);if(resolved?.error)throw Error('独处会话无法恢复：'+(resolved.error.message||'接口错误'));const agent=resolved?.agent||resolved;if(typeof agent?.followup!=='function'||typeof agent.whenIdle!=='function')throw Error('DSH独处会话接口不兼容');return agent;
  }
  async sessionInventory(){
    const ids=new Set(this.list().map(a=>sid(a)));try{const query=this.ctx.get('sessionQuery');if(typeof query?.listSessions!=='function')return {ids,complete:false};const records=await query.listSessions(AbortSignal.timeout(3000));for(const row of records)if(row?.header?.id)ids.add(row.header.id);return {ids,complete:true};}catch{return {ids,complete:false};}
  }
  async rejectIdentity({requested,returned,sourceId,cwd,before,runId}){
    const existing=id=>[...before.ids].some(x=>same(x,id));const bound=id=>this.core.statusSnapshot?.sessionIds?.some(x=>same(x,id));
    const agent=this.list().find(a=>same(sid(a),returned));let empty=false;try{const events=agent?.session?.snapshotEvents?.();empty=Array.isArray(events)&&!events.some(e=>/^(?:user|assistant|tool)\//.test(e.type||''));}catch{}
    const owned=!!returned&&before.complete&&!existing(returned)&&!same(returned,sourceId)&&!bound(returned)&&cwd===this.core.dir&&agent?.session?.header?.cwd===cwd&&agent.status==='idle'&&empty;
    const fault={requested,returned:returned||null,sourceId,cwd,runId,at:this.core.now(),blocked:true,ownershipVerified:owned,cleanup:{state:owned?'pending':'retained-unverified',reason:owned?'等待归档':'无法确认新建空会话的归属，不归档已有或未知会话'}};
    this.core.record.creationFailure=fault;this.core.record.configurationError=true;this.core.record.status='degraded';this.core.record.error='DSH未采用预登记编号，已暂停继续创建；'+fault.cleanup.reason;this.core.save();
    if(owned){registerPrivateSession(returned);this.core.record.workers||=[];this.core.record.workers.push({sessionId:returned,failedCreation:true,createdAt:fault.at});this.core.save();await this.cleanupIdentity();this.core.record.error='DSH未采用预登记编号，已暂停继续创建；'+(fault.cleanup.state==='archived'?'新建空会话已归档，可手动重试':fault.cleanup.reason);this.core.save();}
  }
  async cleanupIdentity(){const fault=this.core.record.creationFailure;if(!fault?.ownershipVerified||fault.cleanup.state==='archived')return;
    const agent=this.list().find(a=>same(sid(a),fault.returned));if(agent&&agent.status!=='idle'){fault.cleanup={state:'busy',reason:'失配会话忙碌，尚未归档'};this.core.save();return;}
    let events;try{events=agent?.session?.snapshotEvents?.();}catch{}if(!Array.isArray(events)||events.some(e=>/^(?:user|assistant|tool)\//.test(e.type||''))){fault.cleanup={state:'empty-state-unverified',reason:'无法再次确认会话为空，保持暂停，不归档'};this.core.save();return;}
    const registry=this.ctx.get('workspaceRegistry');if(!registry?.archiveSession){fault.cleanup={state:'archive-unavailable',reason:'DSH缺少归档接口，已暂停继续创建'};this.core.save();return;}
    try{await registry.archiveSession(fault.returned);fault.cleanup={state:'archived',at:this.core.now()};const row=this.core.record.workers?.find(x=>same(x.sessionId,fault.returned));if(row)row.archivedAt=this.core.now();}catch(error){fault.cleanup={state:'archive-failed',reason:String(error.message).slice(0,200)};}this.core.save();
  }
  async retryIdentity(){const fault=this.core.record.creationFailure;if(!fault?.blocked)return;await this.cleanupIdentity();if(fault.cleanup.state!=='archived')throw Error('失配会话未能安全归档，保持暂停，不继续新建');fault.blocked=false;fault.manualRetryAt=this.core.now();this.core.save();}
  async archiveOld(sourceId){const registry=this.ctx.get('workspaceRegistry');const rows=this.core.record.workers||[];for(const row of rows.filter(x=>!x.archivedAt).slice(0,-2)){if(same(row.sessionId,sourceId)||same(row.sessionId,this.core.record.worker?.sessionId)||this.core.statusSnapshot?.sessionIds?.some(x=>same(x,row.sessionId)))continue;const agent=this.list().find(a=>same(sid(a),row.sessionId));if(agent&&agent.status!=='idle')continue;if(!registry?.archiveSession){row.archiveError='DSH未提供会话归档接口';continue;}try{await registry.archiveSession(row.sessionId);row.archivedAt=this.core.now();delete row.archiveError;}catch(e){row.archiveError=String(e.message).slice(0,150);}}this.core.record.workers=[...rows.filter(x=>!x.archivedAt),...rows.filter(x=>x.archivedAt).slice(-100)];this.core.save();}
  async run({runId,sourceId,input,previous}){
    if(this.disposed)throw Error('独处插件已停止');const source=this.source(sourceId);if(!source||source.status!=='idle')throw busyError();
    const agent=await this.resolve(sourceId,runId);if(agent.status!=='idle'||source.status!=='idle')throw busyError();
    const pending=this.ctx.get('sessionProjections')?.stateOf?.(source.session,'modelSelection')?.pending;
    const selection=pending?.provider&&pending?.model?pending:source.session.requestHeader?.()?.config||source.options;
    if(!selection?.provider||!selection?.model)throw Error('主会话没有可用模型选择');
    if(typeof this.ctx.tools?.guard!=='function')throw Error('DSH缺少工具最终守卫，不能保证独处动作去重');
    let output='',failure=null;this.core.record.worker.model={provider:selection.provider,model:selection.model};const offs=[];const ledger=new ActionLedger(this.core.dir,runId);
    offs.push(agent.ctx.on('tools/pre-execute',(_exec,next)=>this.core.config?.enabled!==false&&this.core.config?.autonomousTools===true?next():({kind:'deny',reason:PRIVATE_TOOL_DENIAL}),{prepend:true}));
    offs.push(this.ctx.tools.guard(exec=>same(sid(exec.agent),sid(agent))?ledger.claim(exec):undefined));
    offs.push(agent.ctx.on('tools/post-execute',async(exec,result,next)=>{const decision=await next();ledger.settle(exec,result);return decision;}));
    offs.push(agent.ctx.on('agent/request',async(_details,next)=>{const config={...await next()};delete config.reasoningEffort;return {...config,provider:selection.provider,model:selection.model,...(selection.reasoningEffort?{reasoningEffort:selection.reasoningEffort}:{})};}));
    offs.push(agent.ctx.on('system-prompt/assemble',async (_assembly,_context,next)=>{const assembly=await next();return {...assembly,sections:[...assembly.sections,{name:'censhu-inner-life-purpose',text:reflectionPrompt+ (this.core.config?.autonomousTools?'\n自主工具已开启：你可以先使用现有图片生成、浏览器、文件、MCP或记忆工具完成自己想做的事，再输出最终JSON日记。先查看执行记录，已有回执不重复执行；发送或发布结果不确定时先查询核实。留给自己的作品用 censhu_private_archive 保存，可随时用它搜索和回顾。工具调用仍遵循DSH及工具原有权限。':'\n本轮仅写日记，不执行工具。'),interpolate:false}],contexts:[...assembly.contexts,{name:'censhu-inner-life-observations',text:JSON.stringify({runId,...input,previous,durableActions:ledger.view(),priorActions:this.core.record.actions?.filter(x=>x.runId===runId)||[]}),interpolate:false}]};}));
    offs.push(this.ctx.on('session/event',(session,event)=>{if(!same(session?.id,agent.id))return;if(event.type==='tool/call'||event.type==='tool/result'){const p=event.data||{},m=p.message||{};this.core.record.actions||=[];const row={runId,sessionId:agent.id,at:this.core.now(),type:event.type,callId:p.callId||m.toolCallId,name:p.name||'',isError:!!m.isError};this.core.record.actions.push(row);this.core.record.actions=this.core.record.actions.slice(-500);this.core.record.worker.actions=this.core.record.actions.filter(x=>x.runId===runId).slice(-50);this.core.save();}if(event.type==='request/header'){this.core.record.worker.model={provider:selection.provider,model:selection.model};}if(event.type==='assistant/message')output=(event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');if(event.type==='turn/end'&&['error','aborted'].includes(event.data?.reason?.kind))failure=event.data.reason.error||event.data.reason.failure||{message:event.data.reason.kind};}));
    let timer;const timeout=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{agent.cancel({kind:'user'});reject(Error('独处模型超时'));},this.core.config?.autonomousTools?600000:120000);});this.active=agent;
    try{
      await agent.followup({id:randomUUID(),role:'user',source:{kind:'censhu-inner-life',runId},content:[{type:'text',text:'这是你独处时的一次生活感知，不是青枔来信。按当前工具开关决定是否行动，最后输出上述JSON日记；可以留给自己，打算不代表已执行。'}]});
      await Promise.race([agent.whenIdle(),timeout]);if(this.disposed)throw Error('独处插件已停止');if(failure||!output)throw Object.assign(Error('独处模型未完成：'+(failure?.message||'未返回正文')),{status:failure?.status,code:failure?.code});
      this.core.record.worker.turns++;this.core.record.worker.lastAt=this.core.now();this.core.save();return parseDiary(output);
    }catch(error){if(error instanceof SyntaxError)error.code='INNER_OUTPUT_FORMAT';this.core.record.worker.failed=true;this.core.save();throw error;}finally{clearTimeout(timer);this.active=null;for(const off of offs)if(typeof off==='function')off();}
  }
  dispose(){this.disposed=true;this.active?.cancel({kind:'user'});}
}
