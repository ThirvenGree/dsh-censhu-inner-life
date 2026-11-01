import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {registerPrivateSession, isPrivateSession} from './isolation.js';

export function diaryText(entry) {
  if(entry.displayText)return entry.displayText;
  const at = new Date(entry.at).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'});
  return [`独处记录 · ${at}（已审核）`, entry.feeling,
    entry.reflection, entry.intention ? `接下来的打算：${entry.intention}` : '']
    .filter(Boolean).join('\n\n');
}

export function personalitySnapshot(p){
  if(!p)return null;
  const rows=(p.activeItems||[]).map(x=>({id:x.id,text:x.text,status:x.status,updatedAt:x.updatedAt,expiresAt:x.expiresAt,reason:x.reason})).sort((a,b)=>a.id.localeCompare(b.id));
  const hash=createHash('sha256').update(JSON.stringify({enabled:p.enabled,rows})).digest('hex');
  const date=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  const text=['当前性格 · 已审核的动态倾向','这是同步时仍生效的性格概览；后续以最新概览为准，原有人设继续保留。',
    !p.enabled?'性格发展已关闭，动态倾向当前不生效。':!rows.length?'尚未形成审核通过且当前生效的新性格倾向。':rows.map(x=>`• ${x.text}\n${x.status==='established'?'已形成':'正在形成'} · 更新于 ${date(x.updatedAt)} · 有效至 ${date(x.expiresAt)}${x.reason?'\n形成或更新原因：'+x.reason:''}`).join('\n\n')].join('\n\n');
  return {hash,text};
}

export function installDisplayReadOnly(controller,getId){
 const original=controller.prompt;
 if(typeof original!=='function')throw Error('会话只读接口不可用');
 const wrapped=function(request,...args){if(request.sessionId&&request.sessionId===getId())throw Error('独处展示会话只读，请在正常聊天会话中交流');return original.call(this,request,...args);};
 controller.prompt=wrapped;return()=>{if(controller.prompt===wrapped)controller.prompt=original;};
}
const phaseNames={research:'围绕问题检索经历',researching:'Gemini 正在检索和筛选旧经历',waiting:'等待变化',judging:'Gemini 正在判断是否关注',reflecting:'DSH 正在生成独处记录',auditing:'Gemini 正在审核记录',degraded:'等待恢复',attention:'感知判断',reflect:'独处生成',audit:'来源审核',ready:'已就绪',private:'留给自己',pending:'等待处理',delivered:'已投递分享机会',dispatching:'正在投递',expired:'已过期',uncertain:'不确定',attend:'现在关注',record:'只记下',later:'稍后考虑'};
const label=x=>phaseNames[x]||x||'暂无';
const when=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未安排';
export function dynamicSnapshot(v){
 if(!v)return null;
 const data={questionRecall:v.questionRecall,thoughts:v.thoughts,modelChoices:v.modelChoices,schedule:v.schedule,innerState:v.innerState,timing:v.timing,enabled:v.config?.enabled,status:v.status,checkpoint:v.checkpoint,pending:v.pending,recorded:v.recorded,nextAt:v.nextAt,decision:v.lastDecision,attention:v.attentionItems,observations:v.observations,growth:v.personalGrowth,personality:v.personality,deliberation:v.deliberation,entries:v.entries,deliveries:v.deliveries,health:v.health,isolation:v.isolation,initiative:v.initiativeHealth,error:v.error,warning:v.warning,retryAt:v.retryAt,daily:v.daily,recollections:v.recollections,recollectionPlan:v.recollectionPlan,actions:v.actions,worker:v.worker};
 // Polling heartbeat and display health are intentionally excluded.
 const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const g=v.personalGrowth||{},p=v.personality||{};
 const lines=['## 独处动态概览',`实际运行状态：${v.config?.enabled?'开启':'暂停'} · ${label(v.status)}`,
 `当前阶段：${label(v.checkpoint?.phase)} · 待感知 ${v.pending||0} 项 · 已记下 ${v.recorded||0} 项`,
 v.worker?.model?'独处模型：'+v.worker.model.provider+' / '+v.worker.model.model:'',
 v.lastDecision?'最近关注判断：'+label(v.lastDecision.decision)+' — '+v.lastDecision.reason:'',
 ...((v.attentionItems||[]).map(x=>`- ${x.name}：${label(x.decision)}；${x.reason||''}`)),
 '当前模型节奏：'+JSON.stringify(v.timing||{}),'### 收到的生活变化',...(v.observations||[]).slice(-20).map(x=>`- ${when(x.at)} · ${x.name}${x.stage?'：'+x.stage:''} · ${label(x.state)}${x.reason?'；'+x.reason:''}`),'### 审核与实际联动',...(v.entries||[]).slice(0,15).map(x=>`${when(x.at)} · ${x.feeling||''}\n审核：${x.auditReason||'已通过'}\n${x.intention?'打算：'+x.intention+'\n':''}联动：${x.effects?.applied?'已处理':'待处理'}${x.effects?.error?'；错误：'+x.effects.error:''}\n${x.effects?.result?JSON.stringify(x.effects.result):'无新增联动回执'}\n分享：${label(x.shareState)}${x.shareBlocked?'；'+x.shareBlocked:''}`),
 '### 带着问题回忆',JSON.stringify(v.questionRecall||{},null,2),'### 想法范围与变化脉络',JSON.stringify({routing:v.thoughts?.routing,history:v.thoughts?.history?.slice(-3)},null,2),'### 对人、事、物的想法',v.thoughts?.lastChoice?'最近选择：'+v.thoughts.lastChoice.decision+' · '+v.thoughts.lastChoice.reason:'尚未形成想法',...(v.thoughts?.active||[]).map(x=>'#### '+x.subject+' · '+x.kind+'（'+x.certainty+'）\n'+x.summary+'\n'+x.dimensions.map(d=>'- '+d.label+'：'+d.view+'；影响：'+d.influence).join('\n')+'\n'+x.links.map(l=>'关联 '+l.targetId+'：'+l.relation+'；'+l.influence).join('\n')+'\n来源：'+((x.provenance||[]).map(p=>p.kind+' · '+p.id).join('；')||'主观联想或未标注')),'想法联动：'+JSON.stringify(v.thoughts?.receipt||{}),'### 全插件主动选择', '进行只表示愿意，不代表已执行；不进行/暂缓与不确定保留原结果，工具回执另列。',...(v.modelChoices||[]).slice(0,40).map(x=>when(x.at)+' · '+x.feature+(x.category==='review'?'（技术审核，并非角色意愿）':'')+' · '+({proceed:'进行',skip:'不进行 / 暂缓',uncertain:'不确定'}[x.state]||x.state)+'（'+x.raw+'） · '+x.reason+(x.nextMinutes?' · 建议复看 '+x.nextMinutes+' 分钟后':'')+' · '+x.path),'### 想回忆一下',v.lastDecision?.activity==='recall'?'Gemini最近选择回忆：'+(v.lastDecision.recallTopic||'随意回顾')+'；选择不等于已经读完':'目前没有专门选择回忆',...(v.entries||[]).filter(x=>x.recollectionPlan?.activity==='recall').slice(0,5).map(x=>when(x.at)+' · 回忆主题：'+x.recollectionPlan.topic+' · 提供旧日记 '+(x.recallIds?.length||0)+' 条'),...(v.recollections||[]).slice(-15).map(x=>when(x.at)+' · '+(x.status==='read'?'已读取收藏原文':'已查找收藏目录')+' · '+(x.title||x.query||'全部收藏')+' · '+x.count+' 项'),'### 自主行动工具记录',...(v.actions||[]).slice(-30).map(x=>when(x.at)+' · '+x.type+' · '+(x.name||x.callId)+' · '+(x.type==='tool/result'?(x.isError?'工具报告错误':'已收到工具回执，成功与否以原回执为准'):'已请求，尚不代表成功')),'### 动态内在状态',JSON.stringify(v.innerState||{},null,2),'### 生活积累',`状态：${label(g.status)}${g.error?'；'+g.error:''}`,...(g.items||[]).map(x=>'- '+x.text+(x.reason?'；'+x.reason:'')),
 '### 当前性格',`状态：${label(p.status)}${p.error?'；'+p.error:''}`,...(p.activeItems||[]).map(x=>'- '+x.text+(x.reason?'；'+x.reason:'')),
 '### 同步回执',`生活积累：${JSON.stringify(g.sync||{})}`,`性格：${JSON.stringify(p.sync||{})}`,
 ...[v.health?.message,v.isolation?.message,v.initiativeHealth?.message].filter(Boolean),
 ...(v.deliveries||[]).slice(-5).map(x=>`分享投递 ${when(x.at)}：${label(x.state)}`),
 v.error?'**运行错误：'+v.error+'**':'',v.warning?'提示：'+v.warning:'',
 `独处调度：${v.schedule?.nextAt?when(v.schedule.nextAt):v.schedule?.label||when(v.nextAt)}${v.schedule?.reason?'；'+v.schedule.reason:''}${v.configurationError?'；需处理账户或配置后手动重试':v.retryAt?'；重试：'+when(v.retryAt):''}`,
 '以上来自插件真实状态及回执；计划、候选和待处理不代表已经执行。'];
 return{hash,text:lines.filter(Boolean).join('\n\n')};
}
// Persist every meaningful transition at the write boundary, including short stages
// that would disappear between UI polls. This is operational telemetry, not model reasoning.
export class ProcessJournal {
 constructor(dir){this.file=path.join(dir,'process-journal.json');try{this.rows=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{this.rows=[];}this.last=this.rows.at(-1)?.hash;}
 capture(v){
 const state=JSON.parse(JSON.stringify({questionRecall:v.questionRecall,thoughts:v.thoughts,modelChoices:v.modelChoices,innerState:v.innerState,enabled:v.config?.enabled,status:v.status,phase:v.checkpoint?.phase,runId:v.checkpoint?.id,pending:v.pending,recorded:v.recorded,observations:v.observations,decision:v.lastDecision,recollections:v.recollections,recollectionPlan:v.recollectionPlan,actions:v.actions,worker:v.worker,entries:(v.entries||[]).map(x=>({id:x.id,reviewedAt:x.reviewedAt,effects:x.effects,shareState:x.shareState,shareBlocked:x.shareBlocked})),growth:{status:v.personalGrowth?.status,error:v.personalGrowth?.error,sync:v.personalGrowth?.sync,items:v.personalGrowth?.items},personality:{status:v.personality?.status,error:v.personality?.error,sync:v.personality?.sync,items:v.personality?.activeItems},error:v.error,retryAt:v.retryAt,configurationError:v.configurationError,deliveries:v.deliveries}));
 const hash=createHash('sha256').update(JSON.stringify(state)).digest('hex');if(hash===this.last)return;
 const old=this.rows.at(-1)?.state,at=Date.now(),notes=[];
 if(!old||old.status!==state.status||old.phase!==state.phase)notes.push(`阶段：${label(state.status)} / ${label(state.phase)}`);
 if(!old||old.pending!==state.pending||old.recorded!==state.recorded)notes.push(`待感知 ${state.pending||0} 项；已记下 ${state.recorded||0} 项`);
 for(const x of state.observations||[])if(!old?.observations?.some(y=>y.id===x.id))notes.push('收到变化：'+x.name+(x.stage?'；'+x.stage:''));
 if(state.decision&&JSON.stringify(old?.decision)!==JSON.stringify(state.decision))notes.push('关注判断：'+label(state.decision.decision)+'；'+state.decision.reason);
 for(const x of state.entries){const prev=old?.entries?.find(y=>y.id===x.id);if(JSON.stringify(prev)!==JSON.stringify(x))notes.push(`记录 ${x.id}：审核${x.reviewedAt?'已通过':'未确认'}；联动${x.effects?.applied?'已处理':'待处理'}${x.effects?.error?'；'+x.effects.error:''}；分享${label(x.shareState)}${x.shareBlocked?'；'+x.shareBlocked:''}${x.effects?.result?'\n实际回执：'+JSON.stringify(x.effects.result):''}`);}
 if(JSON.stringify(old?.innerState)!==JSON.stringify(state.innerState))notes.push('动态内在状态：'+JSON.stringify(state.innerState||{}));
 for(const [key,title]of [['growth','生活积累'],['personality','性格发展']])if(JSON.stringify(old?.[key])!==JSON.stringify(state[key]))notes.push(title+'：'+label(state[key].status)+(state[key].error?'；'+state[key].error:'')+'；当前 '+(state[key].items?.length||0)+' 项；同步回执 '+JSON.stringify(state[key].sync||{}));
 if(JSON.stringify(old?.thoughts)!==JSON.stringify(state.thoughts))notes.push('想法更新：'+(state.thoughts?.lastChoice?.decision||state.thoughts?.status)+' · '+(state.thoughts?.lastChoice?.reason||state.thoughts?.error||''));
 if(JSON.stringify(old?.questionRecall)!==JSON.stringify(state.questionRecall))notes.push('问题回忆：'+JSON.stringify(state.questionRecall?.last||{}));
 if(JSON.stringify(old?.modelChoices)!==JSON.stringify(state.modelChoices))notes.push('跨插件主动选择：'+JSON.stringify((state.modelChoices||[]).slice(0,5)));
 if(JSON.stringify(old?.recollections)!==JSON.stringify(state.recollections))notes.push('私人收藏回顾回执：'+JSON.stringify((state.recollections||[]).slice(-4)));
 if(JSON.stringify(old?.actions)!==JSON.stringify(state.actions))notes.push('自主工具记录：'+JSON.stringify((state.actions||[]).slice(-6)));
 if(state.worker&&JSON.stringify(old?.worker)!==JSON.stringify(state.worker))notes.push('独处执行：'+(state.worker.model?.provider||'')+' / '+(state.worker.model?.model||'')+'；'+(state.worker.failed?'本次失败':state.worker.turns?'已返回正文':'等待正文'));
 if(state.error)notes.push('错误：'+state.error+(state.configurationError?'；账户或配置问题，处理后点击重试':state.retryAt?'；重试时间 '+when(state.retryAt):''));else if(old?.error)notes.push('旧错误已清除，等待后续执行结果确认恢复。');
 if(JSON.stringify(old?.deliveries)!==JSON.stringify(state.deliveries))for(const d of (state.deliveries||[]).slice(-3))notes.push('分享投递：'+when(d.at)+' · '+label(d.state));
 if(!notes.length){this.last=hash;return;}
 const row={id:'process:'+at+':'+hash.slice(0,12),hash,at,reviewedAt:at,state,displayText:'## 实际运行进程 · '+when(at)+'\n\n'+notes.join('\n\n')};
 this.rows.push(row);this.rows=this.rows.slice(-500);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify(this.rows,null,2));this.last=hash;
 }
}


const safeError=e=>String(e?.message||e).replace(/AIza[\w-]+|sk-[\w-]+/g,'[已隐藏凭据]').slice(0,500);
export function geminiPurpose(feature,input={}){const audit=Object.hasOwn(input||{},'candidate');return ({'inner-state':'内在状态、复杂度与矛盾感判断','inner-core':audit?'独处日记来源审核':'生活变化关注判断','inner-deliberation':input?.purpose==='share'?'是否分享的判断':'上下文与表达筛选','inner-personal-growth':audit?'生活积累审核':'生活积累生成','inner-personality':audit?'性格变化审核':'性格发展判断','inner-host':'独处诊断审核'})[feature]||'独处辅助判断';}
export function geminiInputSummary(input={}){return Object.entries(input||{}).map(([k,v])=>k+': '+(Array.isArray(v)?v.length+' 项':v&&typeof v==='object'?Object.keys(v).length+' 个字段':typeof v==='string'?v.length+' 字':'已提供')).join('；');}
export function geminiResultSummary(v){if(!v||typeof v!=='object')return '已返回结果，等待原插件校验。';const out=[];for(const k of ['decision','valid','reason','confidence','importance','remember','newFeeling'])if(v[k]!==undefined)out.push(k+'：'+String(v[k]).slice(0,500));for(const k of ['approvedIndices','changes','observationDecisions','selectedIds','focusIds'])if(Array.isArray(v[k]))out.push(k+'：'+v[k].length+' 项');return out.join('\n\n')||'结构化结果已返回（'+Object.keys(v).join('、')+'），等待原插件校验。';}

// Use the native agent loop; replay reviewed text locally without a provider call.
export class DisplaySession {
  constructor(ctx,dir){this.ctx=ctx;this.dir=dir;this.health={ready:false,message:'尚未同步'};this.active=new Map();this.serial=Promise.resolve();this.pendingRuns=0;
    ctx.effect(()=>ctx.on('llm/stream',(options,next)=>{
      const row=this.active.get(options.sessionId);
      if(!row)return next();
      const marker=options.messages?.some(m=>m.id===row.messageId);
      if(!marker)throw Error('独处展示请求缺少来源标记，拒绝调用外部模型');
      row.intercepted=true;
      return (async function*(){
        yield {type:'block-start',index:0,blockType:'text'};
        let text=row.text;yield {type:'text-delta',index:0,text};
        if(row.run){const started=Date.now();let tail;
          try{row.result=await row.run();row.completed=true;tail='\n\n**Gemini 请求已返回** · '+((Date.now()-started)/1000).toFixed(1)+' 秒\n\n'+geminiResultSummary(row.result)+'\n\n返回值已交回原插件流程，是否采用及后续联动以审核和写回回执为准。';}
          catch(e){row.error=e;tail='\n\n**Gemini 请求失败** · '+((Date.now()-started)/1000).toFixed(1)+' 秒\n\n'+safeError(e);}
          text+=tail;yield {type:'text-delta',index:0,text:tail};
        }
        yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
      })();
    },{prepend:true}));
  }
  enqueue(fn){const task=this.serial.catch(()=>{}).then(fn);this.serial=task.catch(()=>{});return task;}
  sync(...args){if(this.pendingRuns)return Promise.resolve();return this.enqueue(()=>this.syncSnapshot(...args));}
  async runGemini({feature,input,signal},run){
    this.pendingRuns++;
    try{return await this.enqueue(async()=>{
      signal?.throwIfAborted();
      const meta=JSON.parse(fs.readFileSync(path.join(this.dir,'display-session.json'),'utf8')),sessionId=meta.sessionId;
      if(!sessionId)throw Error('独处执行会话未设置');if(!isPrivateSession(sessionId))registerPrivateSession(sessionId);
      const resolved=await this.ctx.get('sessionController').resolveAgent(sessionId);if(resolved?.error)throw Error('独处执行会话无法恢复');const agent=resolved.agent||resolved;
      await agent.whenIdle();signal?.throwIfAborted();
      const requestId=randomUUID(),messageId='inner-gemini:'+requestId,purpose=geminiPurpose(feature,input),startedAt=Date.now();
      const info={requestId,feature,purpose,startedAt,status:'running',inputs:geminiInputSummary(input)};
      const persist=()=>{const file=path.join(this.dir,'gemini-executions.json');let rows=[];try{rows=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}rows=rows.filter(x=>x.requestId!==requestId);rows.push(info);fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(rows.slice(-300),null,2));};
      const job={messageId,intercepted:false,text:'## Gemini · '+purpose+'\n\n请求编号：'+requestId+'\n\n开始时间：'+when(startedAt)+'\n\n输入范围：'+info.inputs+'\n\n**正在执行插件内的真实请求…**',run:async()=>{persist();try{const result=await run();Object.assign(info,{status:'success',endedAt:Date.now(),summary:geminiResultSummary(result)});persist();return result;}catch(e){Object.assign(info,{status:'error',endedAt:Date.now(),error:safeError(e),httpStatus:e.httpStatus||e.status||null});persist();throw e;}}};
      this.active.set(sessionId,job);
      try{
        await agent.followup({id:messageId,role:'user',source:{kind:'censhu-inner-life',executionRequestId:requestId,feature},content:[{type:'text',text:'插件实际执行请求：'+purpose+'；请求编号 '+requestId+'。由原插件发起，在本轮执行真实 Gemini 调用；不是青枔来信，也不是历史结果同步。'}]});
        await agent.whenIdle();if(!job.intercepted)throw Error('执行会话未接管请求，未自动补发');if(job.error)throw job.error;if(!job.completed)throw Error('Gemini执行未完成');return job.result;
      }finally{this.active.delete(sessionId);}
    });}finally{this.pendingRuns--;}
  }
  async syncSnapshot(entries,personality,view,progress=[]) {
    const file=path.join(this.dir,'display-session.json');if(!fs.existsSync(file))return;
    const {sessionId}=JSON.parse(fs.readFileSync(file,'utf8'));if(!sessionId)return;
    if(!isPrivateSession(sessionId))registerPrivateSession(sessionId);
    const resolved=await this.ctx.get('sessionController').resolveAgent(sessionId);if(resolved?.error)throw Error('展示会话无法恢复');const agent=resolved.agent||resolved;
    if(agent.status!=='idle')return;
    const events=agent.session.snapshotEvents();
    const seen=new Set(events.filter(e=>e.type==='user/message'&&e.data.source?.displayEntryId).map(e=>e.data.source.displayEntryId));
    let row=progress.find(e=>!seen.has(e.id));
    if(!row)row=[...entries].sort((a,b)=>a.at-b.at).find(e=>e.id&&e.reviewedAt&&Number.isFinite(e.at)&&!seen.has(e.id));
    const snapshot=personalitySnapshot(personality);
    const last=events.filter(e=>e.type==='user/message'&&e.data.source?.personalityHash).at(-1)?.data.source.personalityHash;
    if(!row&&snapshot&&snapshot.hash!==last)row={id:'personality:'+snapshot.hash+':'+events.length,at:Date.now(),reviewedAt:Date.now(),displayText:snapshot.text,personalityHash:snapshot.hash};
    const dynamic=dynamicSnapshot(view);
    const previous=events.filter(e=>e.type==='user/message'&&e.data.source?.dynamicHash).at(-1)?.data.source;
    if(!row&&dynamic&&dynamic.hash!==previous?.dynamicHash&&(!previous?.dynamicAt||Date.now()-previous.dynamicAt>=60000))row={id:'dynamic:'+dynamic.hash+':'+events.length,at:Date.now(),reviewedAt:Date.now(),displayText:dynamic.text,dynamicHash:dynamic.hash};
    if(!row){this.health={ready:true,message:'原生会话已同步',sessionId,at:Date.now()};return;}
    const messageId='inner-display:'+row.id,job={messageId,text:diaryText(row),intercepted:false};this.active.set(sessionId,job);
    try{
      await agent.followup({id:messageId,role:'user',source:{kind:'censhu-inner-life',displayEntryId:row.id,...(row.dynamicHash?{dynamicHash:row.dynamicHash,dynamicAt:row.at}:{}),...(row.personalityHash?{personalityHash:row.personalityHash}:{})},content:[{type:'text',text:(row.id.startsWith('process:')?'实际运行进程 · ':row.dynamicHash?'动态概览 · ':row.personalityHash?'性格概览 · ':'独处记录 · ')+new Date(row.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+' · 插件运行记录同步（内部通知，非青枔来信）'}]});
      await agent.whenIdle();if(!job.intercepted)throw Error('记录同步未经过本地回放，请检查会话运行状态');
      this.health={ready:true,message:'已通过原生会话流程同步，无额外模型调用',sessionId,entryId:row.id,at:Date.now()};
    }finally{this.active.delete(sessionId);}
  }
}
