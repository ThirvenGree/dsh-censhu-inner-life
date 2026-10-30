import {randomUUID} from 'node:crypto';
import {reflectionPrompt} from './prompts.js';
const sid=agent=>agent?.session?.id||agent?.id;
const busyError=()=>Object.assign(Error('主会话或独处会话忙碌，继续排队'),{code:'INNER_BUSY'});
const same=(a,b)=>String(a||'').replace(/^session-/,'')===String(b||'').replace(/^session-/,'');
export function parseDiary(text){const body=String(text).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');return JSON.parse(body);}
// Native DSH turns own persistence, persona assembly and provider accounting. A scoped
// schema-free turn cannot execute external actions; its output is a proposed diary.
export class DshWorker {
  constructor(ctx,core){this.ctx=ctx;this.core=core;}
  list(){try{return this.ctx.agents.roots?.()||this.ctx.agents.list()||[];}catch{return [];}}
  source(sourceId){return this.list().find(a=>same(sid(a),sourceId));}
  async resolve(sourceId,runId){
    const controller=this.ctx.get('sessionController');if(!controller?.create||!controller.resolveAgent)throw Error('DSH缺少会话创建/恢复接口，需要重新适配');
    let id=this.core.record.worker?.runId===runId&&!this.core.record.worker?.failed?this.core.record.worker.sessionId:null;
    if(!id){if(this.core.record.worker){this.core.record.workers||=[];if(!this.core.record.workers.some(x=>x.sessionId===this.core.record.worker.sessionId))this.core.record.workers.push({...this.core.record.worker});}const source=this.source(sourceId);if(!source)throw Error('请先载入岑舒主会话');const cwd=source.session?.meta?.cwd||this.core.dir;const created=await controller.create({cwd});id=created.sessionId;if(!id||same(id,sourceId))throw Error('未创建独立生活会话');this.core.record.worker={sessionId:id,runId,createdAt:this.core.now(),turns:0};this.core.save();}
    await this.archiveOld(sourceId);const resolved=await controller.resolveAgent(id);if(resolved?.error)throw Error('独处会话无法恢复：'+(resolved.error.message||'接口错误'));const agent=resolved?.agent||resolved;if(typeof agent?.followup!=='function'||typeof agent.whenIdle!=='function')throw Error('DSH独处会话接口不兼容');return agent;
  }
  async archiveOld(sourceId){const registry=this.ctx.get('workspaceRegistry');const rows=this.core.record.workers||[];for(const row of rows.filter(x=>!x.archivedAt).slice(0,-2)){if(same(row.sessionId,sourceId)||same(row.sessionId,this.core.record.worker?.sessionId)||this.core.statusSnapshot?.sessionIds?.some(x=>same(x,row.sessionId)))continue;const agent=this.list().find(a=>same(sid(a),row.sessionId));if(agent&&agent.status!=='idle')continue;if(!registry?.archiveSession){row.archiveError='DSH未提供会话归档接口';continue;}try{await registry.archiveSession(row.sessionId);row.archivedAt=this.core.now();delete row.archiveError;}catch(e){row.archiveError=String(e.message).slice(0,150);}}this.core.record.workers=rows.slice(-100);this.core.save();}
  async run({runId,sourceId,input,previous}){
    if(this.disposed)throw Error('独处插件已停止');const source=this.source(sourceId);if(!source||source.status!=='idle')throw busyError();
    const agent=await this.resolve(sourceId,runId);if(agent.status!=='idle'||source.status!=='idle')throw busyError();
    const pending=this.ctx.get('sessionProjections')?.stateOf?.(source.session,'modelSelection')?.pending;
    const selection=pending?.provider&&pending?.model?pending:source.session.requestHeader?.()?.config||source.options;
    if(!selection?.provider||!selection?.model)throw Error('主会话没有可用模型选择');
    let output='',failure='';this.core.record.worker.model={provider:selection.provider,model:selection.model};const offs=[];
    offs.push(agent.ctx.on('agent/request',async(_details,next)=>{const config={...await next()};delete config.reasoningEffort;return {...config,provider:selection.provider,model:selection.model,...(selection.reasoningEffort?{reasoningEffort:selection.reasoningEffort}:{})};}));
    offs.push(agent.ctx.on('system-prompt/assemble',assembly=>({...assembly,tools:[],sections:[...assembly.sections,{name:'censhu-inner-life-purpose',text:reflectionPrompt,interpolate:false}],contexts:[...assembly.contexts,{name:'censhu-inner-life-observations',text:JSON.stringify({runId,...input,previous}),interpolate:false}]})));
    offs.push(this.ctx.on('session/event',(session,event)=>{if(!same(session?.id,agent.id))return;if(event.type==='request/header'){this.core.record.worker.model={provider:selection.provider,model:selection.model};}if(event.type==='assistant/message')output=(event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');if(event.type==='turn/end'&&['error','aborted'].includes(event.data?.reason?.kind))failure=event.data?.reason?.failure?.message||event.data.reason.kind;}));
    let timer;const timeout=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{agent.cancel({kind:'user'});reject(Error('独处模型超时'));},120000);});this.active=agent;
    try{
      await agent.followup({id:randomUUID(),role:'user',source:{kind:'censhu-inner-life',runId},content:[{type:'text',text:'这是你独处时的一次生活感知，不是青枔来信。只写上述JSON日记；可以留给自己，打算不代表已执行。'}]});
      await Promise.race([agent.whenIdle(),timeout]);if(this.disposed)throw Error('独处插件已停止');if(failure||!output)throw Error('独处模型未完成：'+(failure||'未返回正文'));
      this.core.record.worker.turns++;this.core.record.worker.lastAt=this.core.now();this.core.save();return parseDiary(output);
    }catch(error){if(error instanceof SyntaxError)error.code='INNER_OUTPUT_FORMAT';this.core.record.worker.failed=true;this.core.save();throw error;}finally{clearTimeout(timer);this.active=null;for(const off of offs)if(typeof off==='function')off();}
  }
  dispose(){this.disposed=true;this.active?.cancel({kind:'user'});}
}
