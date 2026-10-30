import {planningContext} from './planning-context.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolationHealth} from './isolation-health.js';
import {InnerLife,validateReflection} from './core.js';
import {DshWorker} from './dsh-worker.js';
import {auditPrompt,auditSchema} from './prompts.js';
export const name='censhu-inner-life';
export const inject=['agents','webServer','timer','tools','cenShuLifeShared'];
const idOf=a=>a?.session?.id||a?.id;
const same=(a,b)=>String(a||'').replace(/^session-/,'')===String(b||'').replace(/^session-/,'');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const body=req=>new Promise((resolve,reject)=>{let text='';req.on('data',c=>{text+=c;if(text.length>16000)reject(Error('请求过大'));});req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch{reject(Error('JSON无效'));}});req.on('error',reject);});
export function guard(req,token){
  let host;try{host=new URL('http://'+req.headers.host);}catch{throw Error('Host无效');}
  if(!['127.0.0.1','localhost','[::1]'].includes(host.hostname)||host.host!==req.headers.host||host.username||host.password||req.socket?.localPort&&Number(host.port||80)!==req.socket.localPort)throw Error('仅允许本机Host');
  if(req.socket?.remoteAddress&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw Error('仅允许本机访问');
  if(req.headers.origin&&req.headers.origin!=='http://'+host.host)throw Error('拒绝跨来源请求');
  if(req.headers['sec-fetch-site']==='cross-site'&&!(req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'))throw Error('拒绝跨站请求');
  if(!['GET','HEAD'].includes(req.method)){const supplied=req.headers['x-inner-life-csrf'];if(typeof supplied!=='string'||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))throw Error('操作令牌无效');}
}
export function apply(ctx){
  const life=ctx.cenShuLifeShared,dir=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'censhu-inner-life');let worker;
  const core=new InnerLife({dir,life,reflect:request=>{const health=isolationHealth(dir);if(!health.ready)throw Error(health.message);return worker.run(request);}});worker=new DshWorker(ctx,core);const csrf=randomBytes(32).toString('hex');
  let initiativePolicy=null;
  (async()=>{try{const home=path.dirname(dir),require=createRequire(path.join(home,'profiles/desktop/package.json')),speakUp=require.resolve('dsh-speak-up'),module=createRequire(speakUp).resolve('dsh-censhu-policy'),policy=await import(pathToFileURL(module).href);if(typeof policy.gate!=='function'||typeof policy.bound!=='function')throw Error('主动机会接口不兼容');initiativePolicy=policy;core.record.initiativeHealth={ready:true,message:'已接入 bridge / 主动搭话共同冷却'};}catch(e){core.record.initiativeHealth={ready:false,message:'主动分享暂缓：'+e.message};}core.save();})();
  const off=life.setInnerLifeProvider(request=>core.context(request),request=>core.deliberation.prepare(request),request=>planningContext(core,request));ctx.effect(()=>off);
  const list=()=>worker.list(),mounted=new Map();let ticking=false,disposed=false,lastForced=0,diagnosing=false;
  async function deliver(){
    if(!core.config.enabled||!core.config.shareEnabled||core.quiet()||core.chatting())return;
    for(const row of core.record.entries.filter(x=>x.shareState==='pending')){
      if(row.expiresAt<=core.now()){row.shareState='expired';core.save();continue;}
      if(core.statusSnapshot?.activity?.surface==='pet'){row.shareBlocked='当前在桌宠交流，临时状态由桌宠读取；不转投QQ';core.save();return;}
      const target=core.sourceId()||row.sourceId;const agent=list().find(a=>same(idOf(a),target));if(!agent||agent.status!=='idle')return;
      const policy=initiativePolicy;if(!policy?.bound(target)){row.shareBlocked='共同主动机会接口未绑定；会在正常聊天中读取';core.save();return;}
      if(!await core.deliberation.share(row,target))continue;core.ingest();if(disposed||!core.config.enabled||!core.config.shareEnabled||core.quiet()||core.chatting()||row.expiresAt<=core.now()||row.supersededAt||agent.status!=='idle'||core.sourceId()!==target)return;
      const opportunity=policy.gate(target,{claim:true,source:'censhu-inner-life'});if(!opportunity.allowed){row.shareBlocked=opportunity.reason;core.save();return;}
      // Claim the durable delivery before enqueue. A doubtful crash is shown, never blindly resent.
      row.shareState='dispatching';row.noticeId=randomUUID();core.save();
      try{await agent.followup({id:row.noticeId,role:'user',source:{kind:'plugin:censhu-inner-life',entryId:row.id,eventIds:row.eventIds||[]},content:[{type:'text',text:'【你自己的独处记录，非青枔来信】你之前有一点愿意分享的想法：'+JSON.stringify({id:row.id,feeling:row.feeling,reflection:row.reflection,intention:row.intention,action:row.action})+'。先看当前对话是否适合，可以准备图片、查资料、使用现有工具，也可以什么都不做。想法和打算尚未执行，不声称已经做完；若决定发QQ，沿用当前会话桥接工具并先预览，任意形式和条数，不必回应这条通知。'}]});row.shareState='delivered';core.record.deliveries.push({id:row.id,noticeId:row.noticeId,at:core.now(),state:'queued'});}catch(e){row.shareState='delivery_unknown';row.shareBlocked='投递结果未确认，不自动重发：'+String(e.message).slice(0,200);}core.save();return;
    }
  }
  async function tick(){if(disposed||ticking||diagnosing)return;ticking=true;try{
    if(!core.config.enabled){await core.personality.tick();return;}
    const isolation=isolationHealth(dir);core.record.isolation=isolation;if(!isolation.ready){core.record.health=isolation;core.save();return;}
    core.ingest();core.record.health={ready:true,message:'生活接口 v2 已连接'};
    for(const agent of list()){
      const id=idOf(agent);if(!core.statusSnapshot.sessionIds.some(x=>same(x,id))||mounted.has(agent))continue;
      const dispose=agent.ctx.on('system-prompt/assemble',assembly=>{const value=core.context({sessionId:id});if(value.ids?.length)core.seen(id,value.ids);return assembly;});mounted.set(agent,dispose);
    }
    for(const[a,dispose]of mounted)if(!list().includes(a)){dispose?.();mounted.delete(a);}
    for(const entry of core.record.entries.filter(x=>!x.effects.applied&&!(x.effects.retryAt>core.now())).slice(0,2))await core.applyEffects(entry);
    const busy=list().some(a=>core.statusSnapshot.sessionIds.some(x=>same(x,idOf(a)))&&a.status!=='idle');
    if(!busy){await core.tick({ingested:true});await core.personalGrowth.tick();await core.personality.tick();if(!disposed)await deliver();}
  }catch(e){core.record.health={ready:false,message:String(e.message).slice(0,300)};core.save();}finally{ticking=false;}}
  ctx.effect(()=>ctx.interval(()=>void tick(),5000));void tick();
  ctx.provide('cenShuInnerLife',{version:1,context:request=>core.context(request),view:()=>core.view()});
  ctx.effect(()=>ctx.tools.register({name:'censhu_inner_life',description:'读取自己的独处感受、日记和尚未执行的打算。可选择某条记录留给自己；不自动发消息，不将主观反思冒充青枔事实。',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['read','keep_private']},id:{type:'string'}}},output:{schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]},execute(args,exec){if(!core.statusSnapshot?.sessionIds.some(x=>same(x,idOf(exec.agent))))throw Error('当前会话未绑定');if(args.action==='keep_private'){const row=core.record.entries.find(x=>x.id===args.id);if(!row)throw Error('独处记录不存在');row.shareState='private';core.save();}return JSON.stringify({context:core.context({sessionId:idOf(exec.agent)}),entries:core.view().entries.slice(0,5)});}}));
  ctx.effect(()=>ctx.tools.register({name:'censhu_personality',description:'读取自身性格发展，或提出希望保留、改变、观察的处事与表达倾向。由Gemini结合生活和记忆独立审核后同步到Cosplay及生活；不能直接改核心身份、关系或权限。',parameters:{type:'object',required:['action'],properties:{action:{type:'string',enum:['read','propose']},text:{type:'string'}}},output:{schema:{type:'string'},render:(_a,text)=>[{type:'text',text}]},execute(args,exec){if(!core.statusSnapshot?.sessionIds.some(x=>same(x,idOf(exec.agent))))throw Error('会话未绑定');if(args.action==='propose'){if(!core.config.personalityEnabled)throw Error('性格发展已关闭');core.personality.propose(args.text);}return JSON.stringify(core.personality.view());}}));
  ctx.effect(()=>ctx.tools.register({name:'censhu_self_develop',description:'查看自己的跨日生活积累，或提交一个自身偏好、习惯、私人项目/物件想法供Gemini生成与独立审核。通过后自动同步到Cosplay和生活插件补充区；计划不能冒充已完成，不修改青枔事实或核心身份。',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['read','propose']},text:{type:'string'}}},output:{schema:{type:'string'},render:(_a,text)=>[{type:'text',text}]},async execute(args,exec){const sessionId=idOf(exec.agent);if(!core.statusSnapshot?.sessionIds.some(x=>same(x,sessionId)))throw Error('当前会话未绑定');if(args.action==='propose'){if(!core.config.personalGrowthEnabled)throw Error('自身积累已关闭');if(typeof args.text!=='string'||!args.text.trim()||args.text.length>500)throw Error('请用1至500字描述自己的想法');const r=core.personalGrowth.record;r.proposals||=[];r.proposals.push({id:'proposal:'+randomUUID(),text:args.text,at:core.now()});r.proposals=r.proposals.slice(-32);core.personalGrowth.save();await core.personalGrowth.tick();}return JSON.stringify(core.personalGrowth.view());}}));
  const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  for(const suffix of ['/state','/config','/retry','/consider','/diagnose','/settings','/personality/review','/personality/propose'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/dsh-censhu-inner-life'+suffix,handler:async(req,res)=>{try{
    guard(req,csrf);if(suffix==='/settings'){if(req.method!=='GET')throw Error('只支持GET');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(fs.readFileSync(path.join(root,'settings.html')));return;}
    if(suffix==='/state'){if(req.method!=='GET')throw Error('只支持GET');send(res,200,{...core.view(),csrfToken:csrf});return;}
    if(req.method!=='POST')throw Error('需要POST');
    if(suffix==='/config'){core.configure(await body(req));if(!core.config.enabled)worker.active?.cancel({kind:'user'});send(res,200,{ok:true,config:core.config});return;}
    if(suffix==='/personality/review'){if(!core.config.enabled||!core.config.personalityEnabled)throw Error('性格发展已关闭');if(core.personality.record.configurationError&&core.personality.record.attempt?.phase==='generate')delete core.personality.record.attempt;core.personality.record.nextAt=0;core.personality.record.retryAt=0;core.personality.record.configurationError=false;core.personality.save();void tick();send(res,200,{ok:true});return;}
    if(suffix==='/personality/propose'){const b=await body(req);if(!core.config.personalityEnabled)throw Error('性格发展已关闭');core.personality.propose(b.text);send(res,200,{ok:true});return;}
    if(suffix==='/retry'){await worker.retryIdentity();core.retry();send(res,200,{ok:true});return;}
    if(core.now()-lastForced<60000)throw Error('请至少间隔1分钟');lastForced=core.now();if(ticking||core.busy)throw Error('正在感知，请稍后');
    const isolation=isolationHealth(dir);if(!isolation.ready)throw Error(isolation.message);
    core.ingest();if(list().some(a=>core.statusSnapshot.sessionIds.some(x=>same(x,idOf(a)))&&a.status!=='idle'))throw Error('主会话正在回复，保留排队');
    if(suffix==='/diagnose'){
      if(!core.config.enabled)throw Error('独处插件已关闭');diagnosing=true;
      try{const sourceId=core.sourceId(),snapshot=life.snapshot({sessionId:sourceId}),input={observations:core.record.queue.filter(x=>x.state==='pending').slice(0,40),context:snapshot.context,memories:snapshot.memories,lifeIntentions:snapshot.lifeIntentions||[],now:core.now()};const value=validateReflection(await worker.run({runId:'diagnose:'+randomUUID(),sourceId,input,previous:[]}));const audit=await life.judge(auditPrompt,auditSchema,{...input,candidate:value},{signal:AbortSignal.timeout(60000),temperature:0,maxOutputTokens:1800});send(res,200,{ok:true,audited:audit.valid===true,reason:audit.reason,model:core.record.worker.model,sessionIdentity:{requested:core.record.worker.requestedSessionId,returned:core.record.worker.sessionId,verified:core.record.worker.identityVerified===true},feeling:value.feeling,reflection:value.reflection,shareDecision:value.shareDecision,formalDiarySaved:false,moodSubmitted:false,memorySubmitted:false,intentionChangesProposed:value.intentionChanges||[],intentionChangesApplied:false,externalNoticeSent:false});}finally{diagnosing=false;}return;
    }
    void core.tick({force:true,ingested:true}).catch(e=>ctx.logger?.warn(e.message));send(res,200,{ok:true,message:'已请求考虑，仍遵守休息时间、间隔与调用上限'});
  }catch(e){send(res,400,{ok:false,error:String(e.message).slice(0,300)});}}}));
  ctx.effect(()=>()=>{disposed=true;core.disposed=true;worker.dispose();for(const off of mounted.values())off?.();});
}
