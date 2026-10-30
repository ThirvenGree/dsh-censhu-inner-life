import {InnerDeliberation} from './deliberation.js';
import {attentionPlan,applyAttentionPlan} from './attention-plan.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {observationBatch,episodes,reflectionCatalog,selectedIds} from './reflections.js';
import {attentionPrompt,attentionSchema,auditPrompt,auditSchema} from './prompts.js';
export const defaults={enabled:true,mergeSeconds:120,minimumMinutes:20,maxJudgmentsDaily:12,maxReflectionsDaily:6,maxDeliberationsDaily:96,queueLimit:500,queueHours:48,chatQuietMinutes:10,moodDailyLimit:6,dimensionDailyLimit:12,quietStart:2,quietEnd:6,shareEnabled:true,memoryEnabled:true,moodEnabled:true};
const clean=(text,max)=>typeof text==='string'&&text.length<=max&&!/AIza[\w-]{12}|sk-[\w-]{12}|gh[pous]_[\w]{12}/.test(text);
// Per-event receipts are carried by selected observations; omit unrelated history from model input.
const modelMood=mood=>mood&&Object.fromEntries(Object.entries(mood).filter(([key])=>!['lifeContributionReceipts','lifeEventReceipts'].includes(key)));
const same=(a,b)=>String(a||'').replace(/^session-/,'')===String(b||'').replace(/^session-/,'');
export function validateConfig(value){const c={...defaults,...value};for(const k of ['enabled','shareEnabled','memoryEnabled','moodEnabled'])if(typeof c[k]!=='boolean')throw Error(k+'须为布尔值');for(const[k,min,max]of [['mergeSeconds',10,1800],['minimumMinutes',5,1440],['maxJudgmentsDaily',1,48],['maxReflectionsDaily',1,24],['maxDeliberationsDaily',1,500],['queueLimit',50,2000],['queueHours',1,168],['chatQuietMinutes',1,120],['moodDailyLimit',0,6],['dimensionDailyLimit',0,12],['quietStart',0,23],['quietEnd',0,23]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error(k+'超出范围');return c;}
export function validateReflection(value){if(!value||typeof value!=='object')throw Error('独处记录须为JSON');for(const[k,max]of [['feeling',200],['reflection',300],['intention',200],['behaviorHint',200],['memoryCandidate',200]])if(!clean(value[k],max))throw Error('独处内容无效：'+k);if(!['private','later','offer','uncertain'].includes(value.shareDecision)||!['none','draw','read','remember'].includes(value.action))throw Error('独处决定无效');if(!Number.isInteger(value.validMinutes)||value.validMinutes<1||value.validMinutes>1440)throw Error('独处有效期无效');validateTiming({delayMinutes:value.nextReflectionMinutes,windowEndMinutes:value.windowEndMinutes});if(value.supersedesIds!==undefined&&(!Array.isArray(value.supersedesIds)||value.supersedesIds.length>10||value.supersedesIds.some(x=>typeof x!=='string')))throw Error('替代记录编号无效');const changes=[],errors=value.intentionChanges!==undefined&&!Array.isArray(value.intentionChanges)?['意向调整不是数组']:[],seen=new Set();for(const change of (Array.isArray(value.intentionChanges)?value.intentionChanges:[]).slice(0,6)){if(!change||typeof change.id!=='string'||!/^intention:[a-z0-9-]{1,80}$/i.test(change.id)||seen.has(change.id)||!['lower','raise','cancel'].includes(change.action)||!Number.isFinite(change.priority)||change.priority<0||change.priority>2||change.action==='cancel'&&change.priority!==0||!clean(change.reason,160)||!change.reason.trim()){errors.push('意向调整格式无效或重复');continue;}seen.add(change.id);changes.push({id:change.id,action:change.action,priority:change.priority,reason:change.reason});}return structuredClone({...value,intentionChanges:changes,intentionChangeErrors:errors});}
export function validateTiming(value){if(!Number.isInteger(value.delayMinutes)||value.delayMinutes<20||value.delayMinutes>1435||!Number.isInteger(value.windowEndMinutes)||value.windowEndMinutes<value.delayMinutes+5||value.windowEndMinutes>1440)throw Error('思考时间窗口无效');return value;}
export class InnerLife {
  constructor({dir,life,reflect,now=Date.now,random=Math.random}){
    this.dir=dir;this.life=life;this.reflect=reflect;this.now=now;this.random=random;fs.mkdirSync(dir,{recursive:true});this.config=validateConfig(this.read('config.json',defaults));
    this.record=this.read('state.json',{version:1,cursor:0,queue:[],entries:[],daily:{},lastJudgmentAt:0,nextAt:now()+30*60000,receipts:{},deliveries:[]});
    if(this.record.version!==1||!Array.isArray(this.record.queue)||!Array.isArray(this.record.entries))throw Error('独处状态协议不兼容');
    // A persisted in-flight lease is retried from its observations; no side effect has been acknowledged yet.
    this.record.status=this.record.attempt?.phase?'recovering':'waiting';this.deliberation=new InnerDeliberation(this);this.save();
  }
  read(name,fallback){const file=path.join(this.dir,name);try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw Error('独处文件无法读取：'+name);}}
  write(name,value){const file=path.join(this.dir,name),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
  save(){const fingerprint=JSON.stringify(this.record);if(fingerprint===this.lastSaved)return;this.write('state.json',this.record);this.lastSaved=fingerprint;}
  configure(value){this.config=validateConfig({...this.config,...value});this.write('config.json',this.config);return this.config;}
  date(){return new Intl.DateTimeFormat('en-CA',{timeZone:this.statusSnapshot?.timezone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(this.now());}
  quiet(){const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:this.statusSnapshot?.timezone||'Asia/Shanghai',hour:'numeric',hourCycle:'h23'}).format(this.now())),{quietStart:a,quietEnd:b}=this.config;return a===b?false:a<b?h>=a&&h<b:h>=a||h<b;}
  count(){const day=this.date();this.record.daily[day]||={judgments:0,reflections:0};this.record.daily=Object.fromEntries(Object.entries(this.record.daily).slice(-14));return this.record.daily[day];}
  signature(){return JSON.stringify({memoryEnabled:this.config.memoryEnabled,moodEnabled:this.config.moodEnabled});}
  sourceId(){const recent=this.statusSnapshot?.activity?.sessionId;return this.statusSnapshot?.sessionIds.find(x=>same(x,recent))||this.statusSnapshot?.sessionIds[0];}
  expireQueue(){if(this.record.attempt?.startedAt+this.config.queueHours*3600000<=this.now()){delete this.record.attempt;this.record.warning='过期的独处候选已清理';}for(const row of this.record.queue){if(row.state==='pending'&&(row.kind==='conversation'||row.at+this.config.queueHours*3600000<=this.now()))Object.assign(row,{state:'recorded',processedAt:this.now(),reason:row.kind==='conversation'?'聊天改用近期快照':'待感知记录已过期'});}}
  chatting(){return this.now()-(this.statusSnapshot?.activity?.at||0)<this.config.chatQuietMinutes*60000;}
  ingest(){
    this.expireQueue();
    if(this.life.contract!=='censhu.life-integration'||this.life.version!==2)throw Error('生活接口需要升级至v2');
    const status=this.life.status();this.statusSnapshot=status;if(!status.enabled||!status.sessionIds?.length)throw Error('岑舒生活未启用或未绑定会话');
    let source=this.life.changesSince(this.record.cursor);if(source.contract!=='censhu.life-changes'||source.version!==1||!Array.isArray(source.items))throw Error('生活变化协议不兼容');
    if(this.record.cursor>source.cursor||this.record.sourceGeneration&&source.generation&&this.record.sourceGeneration!==source.generation){this.record.warning='生活变化流已重建，重新读取可用记录；旧待感知项仍保留';this.record.cursor=0;source=this.life.changesSince(0);}if(source.generation)this.record.sourceGeneration=source.generation;
    if(source.gap)this.record.warning='生活变化记录存在缺口，请检查停机期间记录；已保留可恢复部分';
    let count=0;for(const row of source.items){if(row.kind==='conversation'||row.at+this.config.queueHours*3600000<=this.now()){this.record.cursor=row.sequence;continue;}if(this.record.queue.filter(x=>!['done','recorded'].includes(x.state)).length>=this.config.queueLimit){this.record.warning='待感知队列已满，暂缓接收；游标保留在未读取位置';break;}
      if(!this.record.queue.some(x=>x.id===row.id)){this.record.queue.push({...row,state:'pending',receivedAt:this.now()});count++;}this.record.cursor=row.sequence;
    }
    if(!source.items.length)this.record.cursor=source.cursor;
    // The bridge interface stays encapsulated in the life plugin. Snapshots supplement, not replace, the durable event stream.
    const mood=status.mood?.ok?{mood:status.mood.mood,dims:status.mood.dims,at:status.mood.updatedAt}:null,prior=this.record.moodBaseline;
    if(mood){const delta=prior?mood.mood-prior.mood:0,dims=Object.fromEntries(Object.entries(mood.dims||{}).map(([k,v])=>[k,v-(prior?.dims?.[k]||0)]));
      if(prior&&!(status.mood.lastLifeInfluence?.at>=prior.at&&status.mood.lastLifeInfluence?.ids?.some(x=>(String(x).startsWith('inner:')||status.innerMoodIds?.includes(x))))&&!this.chatting()&&(delta!==0||Object.values(dims).some(v=>v!==0))){const pending=this.record.queue.find(x=>x.kind==='mood'&&x.state==='pending'&&!this.record.attempt?.ids.includes(x.id));if(pending){const before=pending.data.before;pending.data={before,after:mood,delta:mood.mood-before.mood,dims:Object.fromEntries(Object.entries(mood.dims||{}).map(([k,v])=>[k,v-(before.dims?.[k]||0)])),alreadyApplied:true};}else this.enqueue('mood:'+mood.at,'mood',{before:prior,after:mood,delta,dims,alreadyApplied:true});this.record.moodBaseline=mood;}else this.record.moodBaseline=mood;
    }
    for(const row of status.drawing?.items||[]){if(!['ready','prepared'].includes(row.status)||row.eventExpiresAt<=this.now())continue;this.enqueue('drawing:'+row.eventId+':'+row.status,'inspiration',{eventId:row.eventId,idea:row.idea,status:row.status,sharingOwner:'drawing-inspiration',alreadyShared:false});}
    const drawingIds=new Set([...(status.drawing?.items||[]).map(x=>x.eventId),...(status.events||[]).filter(x=>x.templateId==='drawing-inspiration').map(x=>x.id)]);for(const item of this.record.queue)if(drawingIds.has(item.data?.eventId))item.data.sharingOwner='drawing-inspiration';
    const pending=this.record.queue.filter(x=>!['done','recorded'].includes(x.state)),completed=this.record.queue.filter(x=>['done','recorded'].includes(x.state)&&this.now()-(x.processedAt||x.at)<7*86400000).slice(-500);this.record.queue=[...pending,...completed].sort((a,b)=>a.at-b.at);this.save();return count;
  }
  enqueue(id,kind,data){if(this.record.queue.some(x=>x.id===id))return false;if(this.record.queue.filter(x=>!['done','recorded'].includes(x.state)).length>=this.config.queueLimit)return false;this.record.queue.push({id,kind,data,at:this.now(),receivedAt:this.now(),state:'pending'});return true;}
  due(force=false){if(!this.config.enabled||this.disposed||this.busy||this.quiet()||this.chatting()||this.record.configurationError)return false;if(this.now()<(this.record.retryAt||0))return false;if(this.record.attempt?.phase)return true;const c=this.count();if(c.judgments>=this.config.maxJudgmentsDaily||c.reflections>=this.config.maxReflectionsDaily)return false;if(this.now()-this.record.lastJudgmentAt<this.config.minimumMinutes*60000)return false;
    const queue=this.record.queue.filter(x=>x.state==='pending');if(force)return true;const eligible=queue.filter(x=>!(x.revisitAt>this.now()));if(this.record.deferredUntil>this.now()&&!eligible.some(x=>x.receivedAt>this.record.lastJudgmentAt))return false;if(eligible.some(x=>this.now()-x.receivedAt>=this.config.mergeSeconds*1000))return true;return this.now()>=this.record.nextAt;
  }
  schedule(value){validateTiming(value);const lo=Math.max(this.config.minimumMinutes,value.delayMinutes),hi=Math.max(lo+5,value.windowEndMinutes),at=this.now()+Math.floor((lo+(hi-lo)*Math.max(0,Math.min(.999999,this.random())))*60000);this.record.nextAt=at;return at;}
  async tick({force=false,ingested=false}={}){
    if(this.busy)return this.busy;if(this.disposed||!this.config.enabled)return;
    try{if(!ingested)this.ingest();this.record.health={ready:true,message:'生活接口 v2 已连接'};}catch(error){this.record.health={ready:false,message:error.message};this.save();return;}
    if(!this.due(force))return;
    this.busy=this.process().finally(()=>{this.busy=null;});return this.busy;
  }
  async process(){
    const signature=this.signature(),sourceId=this.sourceId();
    if(this.record.attempt&&(!this.record.attempt.phase||this.record.attempt.signature!==signature||this.record.attempt.sourceId!==sourceId)){delete this.record.attempt;this.record.warning='设定或绑定已变化，旧候选未采用，原始变化仍保留';}
    let attempt=this.record.attempt;
    if(!attempt){
      const queue=observationBatch(this.record.queue,80,this.now()),catalog=reflectionCatalog(this.record.entries,this.now());
      attempt={id:'inner:'+randomUUID(),phase:'attention',ids:queue.map(x=>x.id),sourceId,signature,startedAt:this.now(),input:{observations:queue.map(({id,at,kind,data})=>({id,at,kind,data})),episodes:episodes(queue),recentConversation:this.statusSnapshot.activity?.recent||[],life:this.statusSnapshot.life,weather:this.statusSnapshot.weather,eventContext:this.life.attentionContext?.({sessionId:sourceId,eventIds:[...new Set(queue.map(x=>x.data?.eventId).filter(Boolean))]})||null,mood:modelMood(this.statusSnapshot.mood),lifeIntentions:this.statusSnapshot.intentions||[],previous:catalog.slice(-4),reflectionCatalog:catalog,now:this.now()}};
      this.record.attempt=attempt;this.save();
    }
    const active=()=>!this.disposed&&this.config.enabled&&signature===this.signature()&&this.life.status().sessionIds?.some(x=>same(x,sourceId));
    try{
      if(attempt.phase==='attention'){
        if(this.count().judgments>=this.config.maxJudgmentsDaily)return;
        if(this.life.attentionContext)attempt.input.eventContext=this.life.attentionContext({sessionId:sourceId,eventIds:[...new Set(attempt.input.observations.map(x=>x.data?.eventId).filter(Boolean))]});
        this.record.status='judging';this.record.lastJudgmentAt=this.now();this.count().judgments++;this.save();
        const decision=await this.life.judge(attentionPrompt,attentionSchema,attempt.input,{signal:AbortSignal.timeout(60000),temperature:.8,maxOutputTokens:16000});if(!active())return;
        if(!['attend','later','record','uncertain'].includes(decision?.decision)||!clean(decision.reason,200))throw Error('注意判断格式无效');const plan=attentionPlan(decision.observationDecisions,new Set(attempt.ids));if(plan?.some(x=>x.decision==='attend')&&decision.decision!=='attend')throw Error('逐项关注与总决定不一致');this.schedule(decision);if(plan)applyAttentionPlan(this.record.queue,plan,this.now());this.record.lastDecision={...decision,at:this.now()};
        if(decision.decision==='record'){if(!plan)for(const row of this.record.queue.filter(x=>attempt.ids.includes(x.id)))Object.assign(row,{state:'recorded',processedAt:this.now(),reason:decision.reason});delete this.record.attempt;}
        else if(decision.decision==='later'||decision.decision==='uncertain'){this.record.deferredUntil=plan?0:this.record.nextAt;delete this.record.attempt;}
        else {
          const focus=selectedIds(plan?plan.filter(x=>x.decision==='attend').map(x=>x.id):decision.focusIds,new Set(attempt.ids),{fallback:attempt.ids,label:'反思焦点'}),recall=selectedIds(decision.recallIds,new Set(attempt.input.reflectionCatalog.map(x=>x.id)),{fallback:attempt.input.previous.map(x=>x.id),limit:8,label:'回忆'});
          attempt.ids=focus;attempt.input.observations=attempt.input.observations.filter(x=>focus.includes(x.id));attempt.input.episodes=episodes(attempt.input.observations);attempt.input.previous=attempt.input.reflectionCatalog.filter(x=>recall.includes(x.id));delete attempt.input.reflectionCatalog;attempt.decision=decision;attempt.phase='reflect';
        }this.save();
      }
      if(this.record.attempt&&attempt.phase==='reflect'){
        this.statusSnapshot=this.life.status();if(this.chatting()){this.record.status='waiting';this.save();return;}
        if(this.count().reflections>=this.config.maxReflectionsDaily)return;
        this.record.status='reflecting';attempt.reflectionDay=this.date();this.count().reflections++;this.save();
        attempt.snapshot ||= this.life.snapshot({sessionId:sourceId,purpose:'reflection'});this.save();
        const proposed=await this.reflect({runId:attempt.id,sourceId,input:{...attempt.input,context:attempt.snapshot.context,memories:attempt.snapshot.memories,lifeIntentions:attempt.snapshot.lifeIntentions||[]},previous:attempt.input.previous});if(!active())return;try{attempt.candidate=validateReflection(proposed);selectedIds(attempt.candidate.supersedesIds,new Set(attempt.input.previous.filter(x=>x.active).map(x=>x.id)),{limit:10,label:'替代记录'});}catch(error){delete this.record.attempt;throw error;}attempt.generatedAt=this.now();
        const value=attempt.candidate;
        if(['feeling','reflection','intention','behaviorHint','memoryCandidate'].every(k=>!value[k].trim())&&value.action==='none'&&value.shareDecision==='private'&&!value.intentionChanges.length){
          for(const item of this.record.queue.filter(x=>attempt.ids.includes(x.id)))Object.assign(item,{state:'done',processedAt:this.now(),quiet:true});
          this.record.lastQuiet={at:this.now(),evidenceIds:attempt.ids};this.schedule({delayMinutes:value.nextReflectionMinutes,windowEndMinutes:value.windowEndMinutes});delete this.record.attempt;
        }else attempt.phase='audit';this.save();
      }
      if(this.record.attempt&&attempt.phase==='audit'){
        this.statusSnapshot=this.life.status();if(this.chatting()){this.record.status='waiting';this.save();return;}
        this.record.status='auditing';this.save();const input=attempt.input,value=attempt.candidate,snapshot=attempt.snapshot;
        const current=this.life.status();input.observations=input.observations.map(x=>({...x,data:{...x.data,...(current.moodAccounting?.[x.data?.eventId]||{})}}));input.mood=modelMood(current.mood);
        const audit=await this.life.judge(auditPrompt,auditSchema,{...input,memories:snapshot.memories,lifeIntentions:snapshot.lifeIntentions||[],currentLifeIntentions:current.intentions||[],candidate:value,candidateGeneratedAt:attempt.generatedAt||attempt.startedAt,reviewedAt:this.now()},{signal:AbortSignal.timeout(60000),temperature:0,maxOutputTokens:1800});if(!active())return;
        if(audit?.valid!==true){this.record.rejected||=[];this.record.rejected.push({id:attempt.id,at:this.now(),reason:String(audit?.reason||'不确定').slice(0,200)});this.record.rejected=this.record.rejected.slice(-20);delete this.record.attempt;throw Error('独处记录未通过来源核验：'+String(audit?.reason||'不确定').slice(0,200));}
        const supersedes=selectedIds(value.supersedesIds,new Set(input.previous.filter(x=>x.active).map(x=>x.id)),{limit:10,label:'替代记录'});
        const generatedAt=attempt.generatedAt||attempt.startedAt,expiresAt=generatedAt+value.validMinutes*60000;const row={id:attempt.id,...value,supersedesIds:expiresAt>this.now()?supersedes:[],at:generatedAt,reviewedAt:this.now(),expiresAt,evidenceIds:attempt.ids,recallIds:input.previous.map(x=>x.id),sourceId,importance:Number.isInteger(audit.importance)?Math.max(0,Math.min(100,audit.importance)):0,auditReason:String(audit.reason||'').slice(0,200),effects:{},shareState:value.shareDecision==='offer'?(expiresAt>this.now()?'pending':'expired'):'private'};
        const permitted=new Set(Array.isArray(audit.approvedIntentionIds)?audit.approvedIntentionIds:[]),known=new Map((snapshot.lifeIntentions||[]).map(item=>[item.id,item]));
        row.intentionChanges=expiresAt>this.now()?(value.intentionChanges||[]).filter(change=>permitted.has(change.id)&&known.has(change.id)).map(change=>({...change,generatedAt:known.get(change.id).generatedAt,expectedRevision:known.get(change.id).revision||0})):[];
        row.intentionChangeErrors=[...(value.intentionChangeErrors||[]),...(value.intentionChanges||[]).filter(change=>!permitted.has(change.id)||!known.has(change.id)).map(change=>'未通过审核或不在本轮意向快照：'+change.id)];
        const lifeSources=input.observations.filter(x=>/^event-(start|stage|end)$/.test(x.kind)&&x.data?.eventId);
        row.eventIds=[...new Set(lifeSources.map(x=>x.data.eventId))];
        const evidenceText=lifeSources.flatMap(x=>[x.data.name,x.data.stageText]).filter(x=>typeof x==='string').join('\n');
        if(this.config.memoryEnabled&&audit.remember===true&&Number.isInteger(audit.importance)&&audit.importance>=75&&audit.importance<=100&&clean(audit.memoryText,200)&&audit.memoryText.trim()&&clean(audit.evidence,1000)&&audit.evidence.length>=4&&evidenceText.includes(audit.evidence))row.memory={text:audit.memoryText,quote:audit.evidence,importance:audit.importance,eventIds:lifeSources.map(x=>x.data.eventId)};
        // Drawing has one sharing owner. Reflection can enrich feelings, never offer the same picture again.
        if(input.observations.some(x=>x.data?.sharingOwner==='drawing-inspiration'||x.data?.templateId==='drawing-inspiration')){row.shareState='private';row.shareDecision='private';row.shareBlocked='画画灵感由原分享通道负责';}
        const used=new Set(this.record.moodEventIds||[]),origins=[...new Set(lifeSources.filter(x=>x.data.moodAdmission==='admitted').map(x=>x.data.eventId))],origin=audit.eventId||(origins.length===1?origins[0]:null);
        if(expiresAt>this.now()&&this.config.moodEnabled&&audit.newFeeling===true&&audit.confidence>=70&&clean(audit.reason,200)&&origins.includes(origin)&&!used.has(origin)&&clean(audit.reflectionEvidence,300)&&audit.reflectionEvidence.trim().length>=4&&[value.feeling,value.reflection].some(text=>text.includes(audit.reflectionEvidence))&&clean(audit.distinctReason,200)&&audit.distinctReason.trim()){
          const dims=audit.dims,c=this.count();c.moodUsed||=0;c.dimsUsed||={happy:0,calm:0,sad:0};
          if(Number.isInteger(audit.moodDelta)&&Math.abs(audit.moodDelta)<=3&&dims&&['happy','calm','sad'].every(k=>Number.isInteger(dims[k])&&Math.abs(dims[k])<=6)&&(audit.moodDelta||Object.values(dims).some(Boolean))&&c.moodUsed+Math.abs(audit.moodDelta)<=this.config.moodDailyLimit&&['happy','calm','sad'].every(k=>(c.dimsUsed[k]||0)+Math.abs(dims[k])<=this.config.dimensionDailyLimit)){
            row.mood={moodDelta:audit.moodDelta,dims,confidence:audit.confidence,reason:audit.distinctReason,eventId:origin,reflectionEvidence:audit.reflectionEvidence,distinctReason:audit.distinctReason};
            c.moodUsed+=Math.abs(audit.moodDelta);for(const k of ['happy','calm','sad'])c.dimsUsed[k]=(c.dimsUsed[k]||0)+Math.abs(dims[k]);
            this.record.moodEventIds=[...used,origin].slice(-5000);
          }
        }
        row.moodAudit={newFeeling:audit.newFeeling===true,eventId:origin||null,reflectionEvidence:audit.reflectionEvidence||'',distinctReason:audit.distinctReason||'',decision:row.mood?'proposed':(audit.newFeeling!==true?'no-new-feeling':!origins.includes(origin)?'source-not-admitted':'evidence-or-budget-rejected')};
        for(const prior of this.record.entries.filter(x=>row.supersedesIds.includes(x.id))){prior.supersededAt=this.now();prior.supersededBy=row.id;if(prior.shareState==='pending')prior.shareState='superseded';}
        this.record.entries.push(row);this.record.entries=this.record.entries.slice(-200);for(const item of this.record.queue.filter(x=>attempt.ids.includes(x.id)))Object.assign(item,{state:'done',processedAt:this.now(),entryId:row.id});
        this.schedule({delayMinutes:value.nextReflectionMinutes,windowEndMinutes:value.windowEndMinutes});this.record.deferredUntil=0;delete this.record.attempt;this.save();await this.applyEffects(row);
      }
      this.record.status='waiting';this.record.failures=0;this.record.retryAt=0;this.record.error='';this.save();
    }catch(error){if(this.disposed)return;if(error.code==='INNER_BUSY'){const day=this.record.daily[attempt.reflectionDay];if(day)day.reflections=Math.max(0,day.reflections-1);this.record.retryAt=this.now()+30000;this.record.status='waiting';this.save();return;}if(error.code==='INNER_SESSION_IDENTITY'){const day=this.record.daily[attempt.reflectionDay];if(day)day.reflections=Math.max(0,day.reflections-1);this.record.configurationError=true;this.record.status='degraded';this.record.error=error.message;this.save();return;}if(error.code==='INNER_OUTPUT_FORMAT')delete this.record.attempt;this.record.failures=(this.record.failures||0)+1;const status=Number(error.httpStatus||error.status);this.record.configurationError=status>=400&&status<500&&![408,429].includes(status);this.record.retryAt=this.now()+[15,60,360][Math.min(2,this.record.failures-1)]*60000;this.record.status='degraded';this.record.error=String(error.message).slice(0,400);this.save();}finally{if(!this.disposed&&!active()){this.record.status='waiting';delete this.record.attempt;this.save();}}
  }
  async applyEffects(row){
    if(row.effects.applied)return;
    if(!row.memory&&!row.mood&&!row.intentionChanges?.length){row.effects.applied=true;this.save();return;}
    try{
      // Freeze the delivery payload so retries cannot change an already accepted operation.
      row.effects.request||={sessionId:row.sourceId,id:row.id,
        ...(this.life.capabilities?.independentEffects===1?{effectsProtocol:1,expiresAt:row.expiresAt}:{}),
        ...(row.intentionChanges?.length?{intentionChanges:row.intentionChanges}:{}),
        ...(row.memory&&this.config.memoryEnabled?{memory:row.memory}:{}),
        ...(row.mood&&this.config.moodEnabled?{mood:row.mood}:{})};
      this.save();
      row.effects.result=await this.life.submitInnerResult(row.effects.request);
      const result=row.effects.result;
      if(row.effects.request.effectsProtocol===1){
        if(result?.effectsProtocol!==1)throw Error('生活插件未确认分项联动协议，请检查版本');
        if(!result.complete)throw Error(Object.entries(result.channels||{}).filter(([,v])=>!v.done).map(([k,v])=>k+'：'+v.error).join('；')||'联动尚未完成');
      }
      if(row.intentionChanges?.length&&(!Array.isArray(result?.intentions?.accepted)||!Array.isArray(result?.intentions?.rejected)))throw Error('生活插件未确认意向调整，请升级生活插件');
      row.effects.applied=true;delete row.effects.error;delete row.effects.retryAt;
    }catch(e){row.effects.error=String(e.message).slice(0,200);row.effects.retryAt=this.now()+5*60000;}
    this.save();
  }
  retry(){this.record.retryAt=0;this.record.configurationError=false;this.record.error='';this.record.failures=0;this.record.status='waiting';this.save();}
  context({sessionId,now=this.now()}={}){if(!this.config.enabled||!this.statusSnapshot?.sessionIds.some(x=>same(x,sessionId)))return {context:''};const selection=this.deliberation.selected(sessionId);const rows=this.record.entries.filter(x=>!x.supersededAt&&x.expiresAt>now&&selection.has(x.id));if(!rows.length)return {context:''};return {context:'\n【岑舒独处后的临时状态】'+JSON.stringify(rows.map(x=>({id:x.id,feeling:x.feeling,reflection:x.reflection,intention:x.intention,intentionChanges:x.effects?.result?.intentions||null,behaviorHint:x.behaviorHint,action:x.action,shareDecision:x.shareDecision,at:x.at,expiresAt:x.expiresAt})))+'。这是你自己的生活感受与打算，不是青枔发来的话；打算还没有执行。涉及生活意向时以生活插件当前状态为准；调整回执未确认时不能声称已修改安排，近期已提及的意向也不主动重述。可以自然影响表达，也可以不提，不逐条汇报、不把思考当外部事实，不因此强制回复或发送。',ids:rows.map(x=>x.id),records:rows.map(x=>({id:x.id,source:'character-life',at:x.at,expiresAt:x.expiresAt,feeling:x.feeling,reflection:x.reflection,intention:x.intention,intentionChanges:x.effects?.result?.intentions||null}))};}
  seen(sessionId,ids){this.record.receipts[sessionId]={ids:[...new Set([...(this.record.receipts[sessionId]?.ids||[]),...ids])].slice(-200),at:this.now()};this.save();}
  view(){return {ok:true,deliberation:this.record.deliberation,config:this.config,status:this.record.status,isolation:this.record.isolation,health:this.record.health||{ready:false,message:'等待生活接口'},initiativeHealth:this.record.initiativeHealth,warning:this.record.warning||'',error:this.record.error||'',configurationError:!!this.record.configurationError,retryAt:this.record.retryAt||null,cursor:this.record.cursor,pending:this.record.queue.filter(x=>x.state==='pending').length,attentionItems:this.record.queue.filter(x=>x.state==='pending'&&x.attention).slice(-20).map(x=>({id:x.id,name:x.data?.name||x.kind,...x.attention,revisitAt:x.revisitAt||null})),recorded:this.record.queue.filter(x=>x.state==='recorded').length,nextAt:this.record.nextAt,lastDecision:this.record.lastDecision||null,daily:this.record.daily[this.date()]||{judgments:0,reflections:0},busy:!!this.busy,worker:this.record.worker||null,creationFailure:this.record.creationFailure||null,workerHistory:(this.record.workers||[]).slice(-10),checkpoint:this.record.attempt?{id:this.record.attempt.id,phase:this.record.attempt.phase,startedAt:this.record.attempt.startedAt}:null,rejected:this.record.rejected||[],entries:this.record.entries.slice(-15).reverse(),receipts:this.record.receipts,deliveries:this.record.deliveries.slice(-20)};}
}
