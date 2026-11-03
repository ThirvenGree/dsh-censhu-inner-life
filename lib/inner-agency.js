import {displayId,pendingDisplay} from './timeline.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

function data(dir,name,fallback){
 try{return JSON.parse(fs.readFileSync(path.join(path.dirname(dir),'censhu-agency',name+'.json'),'utf8'));}
 catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
export function ownsInner(core){
 const control=data(core.dir,'control',{});if(control.disabled===true)return false;
 const owner=data(core.dir,'owner',{});return owner.until>core.now()&&core.statusSnapshot?.sessionIds?.includes(owner.sessionId);
}
export function agencyDisplay(dir,sessionId){
 const state=data(dir,'state',{}), control=data(dir,'control',{}),owner=control.sessionId?control:data(dir,'owner',{});
 if(!sessionId||owner.sessionId!==sessionId)return [];
 const home=path.dirname(dir);
 const records=[...(state.history||[]).filter(r=>r.sessionId===sessionId||(!r.sessionId&&r.run)),...pendingDisplay(home,sessionId)];
 const target=path.join(dir,'display-session.json');
 const destination=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')).sessionId:null;
 const routed=records.filter(row=>!row.displaySessionId||row.displaySessionId===destination);
 const unique=new Map(routed.map(r=>[displayId(r),r]));
 const outcomes=Array.from(unique,([id,r])=>({id,at:r.at,reviewedAt:r.at,displayText:'**主动进行 · '+r.type+'**\n\n'+r.detail+(r.thread?'\n\n同一件事 '+r.thread+(r.eventIds?.length?' · 事件 '+r.eventIds.join('、'):''):'')+(r.run?'\n\n回合 '+r.run:'')}));
 const inner=fs.existsSync(path.join(dir,'state.json'))?JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8')):{};
 for(const r of inner.agencyRequests||[]){
   if(r.sourceId!==sessionId||!r.updatedAt)continue;
   const entry=inner.entries?.find(e=>e.id===r.id);
   outcomes.push({id:'process:agency:review:'+r.id+':'+r.status,at:r.updatedAt,reviewedAt:r.updatedAt,displayText:'**独处日记审核 · '+r.status+'**\n\n'+(entry?.reflection||'本次未生成已审核日记。')+'\n\n来源回合 '+r.run});
 }
 return outcomes;
}
export function receiveDiary(core,request){
 const {run,sessionId,reflection,eventIds=[],observationIds=[]}=request;
 if(!core.config.enabled||!ownsInner(core)||!core.statusSnapshot.sessionIds.includes(sessionId))throw Error('独处未接入当前角色');
 if(typeof reflection!=='string'||!reflection.trim()||reflection.length>1000||!Array.isArray(eventIds)||eventIds.length>8)throw Error('请提交本次感受及最多八个相关事件编号');
 if(!Array.isArray(observationIds)||observationIds.length>8||[...eventIds,...observationIds].some(id=>typeof id!=='string'||!id||id.length>250))throw Error('来源编号无效');
 const key='inner:'+createHash('sha256').update(JSON.stringify([sessionId,run,reflection,eventIds,...(observationIds.length?[observationIds]:[])])).digest('hex').slice(0,32);
 core.record.agencyRequests||=[];
 const previous=core.record.agencyRequests.find(x=>x.id===key);
 if(previous)return {id:key,status:previous.status};
 if(core.record.agencyRequests.filter(x=>x.status==='queued').length>=12)throw Error('独处积压，请稍后再处理');
 const observations=structuredClone(core.diaryEvidence(core.record.queue||[],eventIds,observationIds).observations);
 const row={observationIds,observations,id:key,sourceId:sessionId,run,reflection:reflection.trim(),actions:request.actions||[],eventIds:[...new Set(eventIds)],at:core.now(),status:'queued'};
 core.record.agencyRequests=[...core.record.agencyRequests.filter(x=>x.status!=='queued'&&x.status!=='auditing').slice(-75),...core.record.agencyRequests.filter(x=>['queued','auditing'].includes(x.status)),row];
 core.save();return {id:key,status:row.status};
}
export async function tickWithAgency(core,tick,args){
 for(const row of core.record.agencyRequests||[]){
   if(row.status!=='auditing')continue;
   const entry=core.record.entries.find(e=>e.id===row.id),reject=core.record.rejected?.find(e=>e.id===row.id);
   if(entry||reject||core.record.attempt?.id!==row.id){row.status=entry?'reviewed':reject?'rejected':'unconfirmed';row.updatedAt=core.now();delete row.observations;core.save();}
 }
 if(!ownsInner(core))return tick(args);
 if(core.busy)return;
 // Observations stay pending when an old, not-yet-executed selection is superseded.
 if(core.record.attempt&&!core.record.attempt.agencyRun&&core.record.attempt.phase!=='audit'){delete core.record.attempt;core.save();}
 if(!core.record.attempt&&core.record.configurationError&&String(core.record.error).startsWith('独处模型未完成：')){
   core.record.previousWorkerError=core.record.error;core.record.configurationError=false;core.record.retryAt=0;core.record.error='';core.record.status='waiting';core.save();
 }
 if(core.record.attempt)return tick(args);
 const row=core.record.agencyRequests?.find(x=>x.status==='queued'&&x.sourceId===core.sourceId());
 if(!row||core.quiet()||core.chatting()||core.record.configurationError||core.record.retryAt>core.now())return;
 if(core.count().reflections>=core.config.maxReflectionsDaily)return;
 // Ingestion can lag behind submission. Fill missing events only from observations
 // already dated at submission; later stages cannot support an earlier diary.
 const byId=new Map(core.record.queue.map(r=>[r.id,r]));
 for(const r of row.observations||[])byId.set(r.id,r);
 const {observations,missingEvents,missingObservations}=core.diaryEvidence([...byId.values()],row.eventIds,row.observationIds||[],row.at);
 const snapshot=core.life.snapshot({sessionId:row.sourceId,purpose:'reflection'});
 const now=core.now(), minutes=Math.min(1430,Math.max(5,Math.round(Number(core.config.minimumMinutes)||30)));
 // The character already chose and wrote this reflection. The existing audit alone decides effects.
 core.record.attempt={id:row.id,agencyRun:row.run,phase:'audit',sourceId:row.sourceId,signature:core.signature(),startedAt:now,generatedAt:now,snapshot,ids:observations.map(x=>x.id),
 input:{observations,missingEvents,missingObservations,previous:[],life:core.statusSnapshot.life,agencyRun:row.run,agencyToolReceipts:row.actions||[]},
 candidate:{reflection:row.reflection,feeling:'',intention:'',behaviorHint:'',memoryCandidate:'',shareDecision:'private',action:'none',intentionChanges:[],supersedesIds:[],readingNotes:[],diaryImages:[],validMinutes:1440,nextReflectionMinutes:minutes,windowEndMinutes:minutes+10}};
 row.status='auditing';core.count().reflections++;core.save();return tick(args);
}
