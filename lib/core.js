import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {attentionPrompt,attentionSchema,auditPrompt,auditSchema} from './prompts.js';
export const defaults={enabled:true,mergeSeconds:120,minimumMinutes:20,maxJudgmentsDaily:12,maxReflectionsDaily:6,queueLimit:500,quietStart:2,quietEnd:6,shareEnabled:true,memoryEnabled:true,moodEnabled:true};
const clean=(text,max)=>typeof text==='string'&&text.length<=max&&!/AIza[\w-]{12}|sk-[\w-]{12}|gh[pous]_[\w]{12}/.test(text);
const same=(a,b)=>String(a||'').replace(/^session-/,'')===String(b||'').replace(/^session-/,'');
export function validateConfig(value){const c={...defaults,...value};for(const k of ['enabled','shareEnabled','memoryEnabled','moodEnabled'])if(typeof c[k]!=='boolean')throw Error(k+'须为布尔值');for(const[k,min,max]of [['mergeSeconds',10,1800],['minimumMinutes',5,1440],['maxJudgmentsDaily',1,48],['maxReflectionsDaily',1,24],['queueLimit',50,2000],['quietStart',0,23],['quietEnd',0,23]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error(k+'超出范围');return c;}
export function validateReflection(value){if(!value||typeof value!=='object')throw Error('独处记录须为JSON');for(const[k,max]of [['feeling',200],['reflection',300],['intention',200],['behaviorHint',200],['memoryCandidate',200]])if(!clean(value[k],max))throw Error('独处内容无效：'+k);if(!['private','later','offer','uncertain'].includes(value.shareDecision)||!['none','draw','read','remember'].includes(value.action))throw Error('独处决定无效');if(!Number.isInteger(value.validMinutes)||value.validMinutes<1||value.validMinutes>1440)throw Error('独处有效期无效');validateTiming({delayMinutes:value.nextReflectionMinutes,windowEndMinutes:value.windowEndMinutes});return structuredClone(value);}
export function validateTiming(value){if(!Number.isInteger(value.delayMinutes)||value.delayMinutes<20||value.delayMinutes>1435||!Number.isInteger(value.windowEndMinutes)||value.windowEndMinutes<value.delayMinutes+5||value.windowEndMinutes>1440)throw Error('思考时间窗口无效');return value;}
export class InnerLife {
  constructor({dir,life,reflect,now=Date.now,random=Math.random}){
    this.dir=dir;this.life=life;this.reflect=reflect;this.now=now;this.random=random;fs.mkdirSync(dir,{recursive:true});this.config=validateConfig(this.read('config.json',defaults));
    this.record=this.read('state.json',{version:1,cursor:0,queue:[],entries:[],daily:{},lastJudgmentAt:0,nextAt:now()+30*60000,receipts:{},deliveries:[]});
    if(this.record.version!==1||!Array.isArray(this.record.queue)||!Array.isArray(this.record.entries))throw Error('独处状态协议不兼容');
    // A persisted in-flight lease is retried from its observations; no side effect has been acknowledged yet.
    this.record.status='waiting';this.save();
  }
  read(name,fallback){const file=path.join(this.dir,name);try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw Error('独处文件无法读取：'+name);}}
  write(name,value){const file=path.join(this.dir,name),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
  save(){this.write('state.json',this.record);}
  configure(value){this.config=validateConfig({...this.config,...value});this.write('config.json',this.config);return this.config;}
  date(){return new Intl.DateTimeFormat('en-CA',{timeZone:this.statusSnapshot?.timezone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(this.now());}
  quiet(){const h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:this.statusSnapshot?.timezone||'Asia/Shanghai',hour:'numeric',hourCycle:'h23'}).format(this.now())),{quietStart:a,quietEnd:b}=this.config;return a===b?false:a<b?h>=a&&h<b:h>=a||h<b;}
  count(){const day=this.date();this.record.daily[day]||={judgments:0,reflections:0};this.record.daily=Object.fromEntries(Object.entries(this.record.daily).slice(-14));return this.record.daily[day];}
  ingest(){
    if(this.life.contract!=='censhu.life-integration'||this.life.version!==2)throw Error('生活接口需要升级至v2');
    const status=this.life.status();this.statusSnapshot=status;if(!status.enabled||!status.sessionIds?.length)throw Error('岑舒生活未启用或未绑定会话');
    let source=this.life.changesSince(this.record.cursor);if(source.contract!=='censhu.life-changes'||source.version!==1||!Array.isArray(source.items))throw Error('生活变化协议不兼容');
    if(this.record.cursor>source.cursor||this.record.sourceGeneration&&source.generation&&this.record.sourceGeneration!==source.generation){this.record.warning='生活变化流已重建，重新读取可用记录；旧待感知项仍保留';this.record.cursor=0;source=this.life.changesSince(0);}if(source.generation)this.record.sourceGeneration=source.generation;
    if(source.gap)this.record.warning='生活变化记录存在缺口，请检查停机期间记录；已保留可恢复部分';
    let count=0;for(const row of source.items){if(this.record.queue.filter(x=>!['done','recorded'].includes(x.state)).length>=this.config.queueLimit){this.record.warning='待感知队列已满，暂缓接收；游标保留在未读取位置';break;}
      if(!this.record.queue.some(x=>x.id===row.id)){this.record.queue.push({...row,state:'pending',receivedAt:this.now()});count++;}this.record.cursor=row.sequence;
    }
    if(!source.items.length)this.record.cursor=source.cursor;
    // The bridge interface stays encapsulated in the life plugin. Snapshots supplement, not replace, the durable event stream.
    const mood=status.mood?.ok?{mood:status.mood.mood,dims:status.mood.dims,at:status.mood.updatedAt}:null,prior=this.record.moodBaseline;
    if(mood){const delta=prior?mood.mood-prior.mood:0,dims=Object.fromEntries(Object.entries(mood.dims||{}).map(([k,v])=>[k,v-(prior?.dims?.[k]||0)]));
      if(prior&&(Math.abs(delta)>=2||Object.values(dims).some(v=>Math.abs(v)>=3))){this.enqueue('mood:'+mood.at,'mood',{before:prior,after:mood,delta,dims,alreadyApplied:true});this.record.moodBaseline=mood;}else if(!prior)this.record.moodBaseline=mood;
    }
    for(const row of status.drawing?.items||[]){if(!['ready','prepared','sent'].includes(row.status)||row.eventExpiresAt<=this.now())continue;this.enqueue('drawing:'+row.eventId+':'+row.status,'inspiration',{eventId:row.eventId,idea:row.idea,status:row.status,alreadyShared:row.status==='sent'});}
    const pending=this.record.queue.filter(x=>!['done','recorded'].includes(x.state)),completed=this.record.queue.filter(x=>['done','recorded'].includes(x.state)&&this.now()-(x.processedAt||x.at)<7*86400000).slice(-500);this.record.queue=[...pending,...completed].sort((a,b)=>a.at-b.at);this.save();return count;
  }
  enqueue(id,kind,data){if(this.record.queue.some(x=>x.id===id))return false;if(this.record.queue.filter(x=>!['done','recorded'].includes(x.state)).length>=this.config.queueLimit)return false;this.record.queue.push({id,kind,data,at:this.now(),receivedAt:this.now(),state:'pending'});return true;}
  due(force=false){if(!this.config.enabled||this.disposed||this.busy||this.quiet()||this.record.configurationError)return false;if(this.now()<(this.record.retryAt||0))return false;const c=this.count();if(c.judgments>=this.config.maxJudgmentsDaily||c.reflections>=this.config.maxReflectionsDaily)return false;if(this.now()-this.record.lastJudgmentAt<this.config.minimumMinutes*60000)return false;
    const queue=this.record.queue.filter(x=>x.state==='pending');if(force)return true;if(this.record.deferredUntil>this.now())return false;if(queue.some(x=>this.now()-x.receivedAt>=this.config.mergeSeconds*1000&&['event-start','event-end','inspiration','mood'].includes(x.kind)))return true;return this.now()>=this.record.nextAt;
  }
  schedule(value){validateTiming(value);const lo=Math.max(this.config.minimumMinutes,value.delayMinutes),hi=Math.max(lo+5,value.windowEndMinutes),at=this.now()+Math.floor((lo+(hi-lo)*Math.max(0,Math.min(.999999,this.random())))*60000);this.record.nextAt=at;return at;}
  async tick({force=false}={}){
    if(this.busy)return this.busy;if(this.disposed||!this.config.enabled)return;
    try{this.ingest();this.record.health={ready:true,message:'生活接口 v2 已连接'};}catch(error){this.record.health={ready:false,message:error.message};this.save();return;}
    if(!this.due(force))return;
    this.busy=this.process().finally(()=>{this.busy=null;});return this.busy;
  }
  async process(){
    const queue=this.record.queue.filter(x=>x.state==='pending').slice(0,40),input={observations:queue.map(({id,at,kind,data})=>({id,at,kind,data})),life:this.statusSnapshot.life,weather:this.statusSnapshot.weather,mood:this.statusSnapshot.mood,previous:this.record.entries.slice(-4).map(x=>({feeling:x.feeling,reflection:x.reflection,intention:x.intention,at:x.at})),now:this.now()};
    const runId='inner:'+randomUUID(),signature=JSON.stringify(this.config);this.record.status='judging';this.record.lastJudgmentAt=this.now();this.count().judgments++;this.record.attempt={id:runId,ids:queue.map(x=>x.id),at:this.now()};this.save();
    const active=()=>!this.disposed&&this.config.enabled&&signature===JSON.stringify(this.config);
    try{
      const decision=await this.life.judge(attentionPrompt,attentionSchema,input,{signal:AbortSignal.timeout(60000),temperature:.8,maxOutputTokens:700});if(!active())return;
      if(!['attend','later','record','uncertain'].includes(decision?.decision)||!clean(decision.reason,200))throw Error('注意判断格式无效');this.schedule(decision);this.record.lastDecision={...decision,at:this.now()};
      if(decision.decision==='record'){for(const row of queue)Object.assign(row,{state:'recorded',processedAt:this.now(),reason:decision.reason});}
      else if(decision.decision==='later'||decision.decision==='uncertain')this.record.deferredUntil=this.record.nextAt;
      else {
        this.count().reflections++;this.record.status='reflecting';this.save();
        const sourceId=this.statusSnapshot.sessionIds[0],snapshot=this.life.snapshot({sessionId:sourceId});
        const value=validateReflection(await this.reflect({runId,sourceId,input:{...input,context:snapshot.context,memories:snapshot.memories},previous:this.record.entries.slice(-4)}));if(!active())return;
        this.record.status='auditing';this.save();const audit=await this.life.judge(auditPrompt,auditSchema,{...input,memories:snapshot.memories,candidate:value},{signal:AbortSignal.timeout(60000),temperature:0,maxOutputTokens:1800});if(!active())return;
        if(audit?.valid!==true)throw Error('独处记录未通过来源核验：'+String(audit?.reason||'不确定').slice(0,200));
        const row={id:runId,...value,at:this.now(),expiresAt:this.now()+value.validMinutes*60000,evidenceIds:queue.map(x=>x.id),sourceId,auditReason:String(audit.reason||'').slice(0,200),effects:{},shareState:value.shareDecision==='offer'?'pending':'private'};
        // Persist the diary before side effects. Effect requests are idempotent and resumed on the next tick.
        const evidenceText=JSON.stringify({...input,memories:snapshot.memories})+'\n'+input.observations.map(x=>Object.values(x.data||{}).filter(v=>typeof v==='string').join('\n')).join('\n')+'\n'+snapshot.memories.map(x=>x.text).join('\n');
        if(this.config.memoryEnabled&&audit.remember===true&&Number.isInteger(audit.importance)&&audit.importance>=75&&audit.importance<=100&&clean(audit.memoryText,200)&&audit.memoryText.trim()&&clean(audit.evidence,1000)&&audit.evidence.length>=4&&evidenceText.includes(audit.evidence))row.memory={text:audit.memoryText,quote:audit.evidence,importance:audit.importance};
        if(this.config.moodEnabled&&audit.newFeeling===true&&audit.confidence>=70&&clean(audit.reason,200)&&queue.some(x=>!['mood','solitude'].includes(x.kind))){const dims=audit.dims;if(Number.isInteger(audit.moodDelta)&&Math.abs(audit.moodDelta)<=3&&dims&&['happy','calm','sad'].every(k=>Number.isInteger(dims[k])&&Math.abs(dims[k])<=6)&&(audit.moodDelta||Object.values(dims).some(Boolean)))row.mood={moodDelta:audit.moodDelta,dims,confidence:audit.confidence,reason:audit.reason};}
        this.record.entries.push(row);this.record.entries=this.record.entries.slice(-200);for(const item of queue)Object.assign(item,{state:'done',processedAt:this.now(),entryId:runId});this.schedule({delayMinutes:value.nextReflectionMinutes,windowEndMinutes:value.windowEndMinutes});this.record.deferredUntil=0;this.save();await this.applyEffects(row);
      }
      this.record.status='waiting';this.record.failures=0;this.record.retryAt=0;this.record.error='';delete this.record.attempt;this.save();
    }catch(error){if(this.disposed)return;this.record.failures=(this.record.failures||0)+1;const status=Number(error.httpStatus||error.status);this.record.configurationError=status>=400&&status<500&&![408,429].includes(status);this.record.retryAt=this.now()+[15,60,360][Math.min(2,this.record.failures-1)]*60000;this.record.status='degraded';this.record.error=String(error.message).slice(0,400);this.save();}finally{if(!this.disposed&&!active()){this.record.status='waiting';delete this.record.attempt;this.save();}}
  }
  async applyEffects(row){if(row.effects.applied)return;if(!row.memory&&!row.mood){row.effects.applied=true;this.save();return;}try{row.effects.result=await this.life.submitInnerResult({sessionId:row.sourceId,id:row.id,...(row.memory&&this.config.memoryEnabled?{memory:row.memory}:{}),...(row.mood&&this.config.moodEnabled?{mood:row.mood}:{})});row.effects.applied=true;delete row.effects.error;}catch(e){row.effects.error=String(e.message).slice(0,200);row.effects.retryAt=this.now()+5*60000;}this.save();}
  retry(){this.record.retryAt=0;this.record.configurationError=false;this.record.error='';this.record.failures=0;this.record.status='waiting';this.save();}
  context({sessionId,now=this.now()}={}){if(!this.config.enabled||!this.statusSnapshot?.sessionIds.some(x=>same(x,sessionId)))return {context:''};const rows=this.record.entries.filter(x=>x.expiresAt>now).slice(-3);if(!rows.length)return {context:''};return {context:'\n【岑舒独处后的临时状态】'+JSON.stringify(rows.map(x=>({id:x.id,feeling:x.feeling,reflection:x.reflection,intention:x.intention,behaviorHint:x.behaviorHint,action:x.action,shareDecision:x.shareDecision,at:x.at,expiresAt:x.expiresAt})))+'。这是你自己的生活感受与打算，不是青枔发来的话；打算还没有执行。可以自然影响表达，也可以不提，不逐条汇报、不把思考当外部事实，不因此强制回复或发送。',ids:rows.map(x=>x.id)};}
  seen(sessionId,ids){this.record.receipts[sessionId]={ids:[...new Set([...(this.record.receipts[sessionId]?.ids||[]),...ids])].slice(-200),at:this.now()};this.save();}
  view(){return {ok:true,config:this.config,status:this.record.status,health:this.record.health||{ready:false,message:'等待生活接口'},initiativeHealth:this.record.initiativeHealth,warning:this.record.warning||'',error:this.record.error||'',configurationError:!!this.record.configurationError,retryAt:this.record.retryAt||null,cursor:this.record.cursor,pending:this.record.queue.filter(x=>x.state==='pending').length,recorded:this.record.queue.filter(x=>x.state==='recorded').length,nextAt:this.record.nextAt,lastDecision:this.record.lastDecision||null,daily:this.record.daily[this.date()]||{judgments:0,reflections:0},busy:!!this.busy,worker:this.record.worker||null,entries:this.record.entries.slice(-15).reverse(),receipts:this.record.receipts,deliveries:this.record.deliveries.slice(-20)};}
}
