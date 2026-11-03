import {createHash} from 'node:crypto';
export const evidenceHash=s=>createHash('sha256').update(String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ')).digest('hex');
export function roots(row,kind){
 if(row.sourceGroups?.length)return row.sourceGroups;
 const ids=[...new Set([row.data?.eventId,row.eventId,...(row.eventIds||[])].filter(Boolean))];
 if(ids.length)return ids.map(id=>'event:'+id);
 if(kind==='life-event')return ['event:'+row.id];
 if(row.evidenceIds?.length)return row.evidenceIds.map(id=>'observation:'+id);
 return [kind+':'+(row.id||evidenceHash(row.text||row.reflection))];
}
export function markDependencies(parts,corrections){
 const withdrawal=r=>corrections.find(c=>c.phase==='done'&&c.backend===r.provider&&c.recordId===r.id&&(!r.scope||c.scope===r.scope)&&(r.versionKind==='native'&&c.version?c.version===r.version:c.revokedHash===r.contentHash||(r.observedAt>0&&r.observedAt<=(c.applyAt||c.at)&&['remove','replace'].includes(c.action))));
 const sourceMatches=(ref,h)=>{
   let snapshot;try{snapshot=JSON.parse(ref.snapshot||'{}');}catch{snapshot={};}
   const labels=[ref.source,...(ref.sources||[]),snapshot.source,...(Array.isArray(snapshot.sources)?snapshot.sources:[])].filter(v=>typeof v==='string');
   const matches=(c,label)=>{
    if(c.file)return label===c.file||label==='memory:'+c.file;
    if(c.backend==='lingshu')return /lingshu|mdcg|灵枢/i.test(label)&&(!label.includes(':lingshu-node:')||label.endsWith(':lingshu-node:'+c.nodeId));
    if(!c.scoped)return true;
    if(c.backend==='engram')return /engram/i.test(label);
    if(c.backend==='mnemon')return /mnemon/i.test(label);
    if(c.backend==='openviking')return /openviking/i.test(label);
    if(c.backend==='qq')return /qq_memory/i.test(label);
    return /(?:^|\/)(?:MEMORY|KEY|USER|DAILY)\.md$/i.test(label)||/memory:(?:snapshot|(?:tool:)?(?:memory|de_memory)(?:$|:))/.test(label);
   };
   const rows=corrections.filter(c=>c.phase==='done'&&c.revokedHash===h);
   const refs=ref.records||snapshot.records||[];
   if(refs.length){
    if(!refs.every(r=>r.withdrawnAt||withdrawal(r)))return false;
    return labels.every(label=>refs.some(r=>matches({backend:r.provider,scoped:true,nodeId:r.id},label))||rows.some(c=>matches(c,label)));
   }
   if(rows.some(c=>!c.scoped&&c.backend!=='lingshu'))return true;
   // A coalesced fact stays supported while another cited store retains it.
   return labels.length>0&&labels.every(label=>rows.some(c=>matches(c,label)));
 };
 const changed=new Set(corrections.filter(x=>x.phase==='done'&&x.revokedHash).map(x=>x.revokedHash));
 if(!changed.size)return;
 const items=parts.flatMap(part=>(part.record.items||[]).map(item=>({part,item})));
 const dirty=new Set(), visited=new Set(), invalidIds=new Set();
 for(const {part,item} of items){
   for(const ref of [...(item.provenance||[]),...(item.evidence||[]),...(item.evidenceSnapshots||[])]){
     for(const origin of ref.records||[]){
       const receipt=withdrawal(origin);
       if(!origin.withdrawnAt&&receipt){origin.withdrawnAt=receipt.applyAt||receipt.at||Date.now();dirty.add(part);}
     }
   }
 }
 // Follow actual citations only. Merely sharing a topic or an event is insufficient.
 let advanced=true;
 while(advanced){
   advanced=false;
   for(const {part,item} of items){
     if(visited.has(item))continue;
     const refs=[...(item.provenance||[]),...(item.evidence||[]),...(item.evidenceSnapshots||[])];
     const matches=refs.filter(ref=>invalidIds.has(ref.id)||(ref.sourceHashes||[evidenceHash(ref.text||ref.content)]).some(h=>(changed.has(h)||ref.records?.length)&&sourceMatches(ref,h)));
     if(!matches.length&&!(item.evidenceIds||[]).some(id=>invalidIds.has(id)))continue;
     const hits=matches.flatMap(ref=>(ref.sourceHashes||[evidenceHash(ref.text||ref.content)]).filter(h=>(changed.has(h)||ref.records?.length)&&sourceMatches(ref,h)));
     visited.add(item);invalidIds.add(item.id);advanced=true;
     if(!item.needsEvidenceReview||hits.some(h=>!item.disputedSources?.includes(h))){
       item.disputedSources=[...new Set([...(item.disputedSources||[]),...hits])];
       item.needsEvidenceReview=true;item.reviewAt=0;dirty.add(part);
     }
   }
 }
 for(const part of dirty){if(items.some(row=>row.part===part&&visited.has(row.item))){part.record.nextAt=0;part.record.nextReviewAt=0;}part.save();}
}

export function replayEvidence(queue,citations){
 const wanted=new Set(citations.flatMap(e=>e.sourceGroups||[]));
 const groups=new Map();
 for(const observation of queue){
   if(observation.kind==='conversation'||!observation.id)continue;
   for(const group of roots(observation,'observation')){
     if(!groups.has(group))groups.set(group,[]);
     groups.get(group).push({id:observation.id,at:observation.at,kind:observation.kind,event:JSON.stringify(observation.data||{}).slice(0,600)});
   }
 }
 const linked=[...groups.keys()].filter(k=>wanted.has(k));
 const comparison=[...groups.keys()].filter(k=>!wanted.has(k)).slice(-8);
 return [...linked,...comparison].map(group=>{const rows=groups.get(group);return {group,linked:wanted.has(group),observations:rows.length>3?[rows[0],...rows.slice(-2)]:rows};});
}

export async function selectReplay(core,citations,candidates){
 const queue=(core.record.queue||[]).filter(row=>row.id&&row.kind!=='conversation');
 const basic=replayEvidence(queue,citations);
 if(queue.length<=8&&basic.every(g=>queue.filter(o=>roots(o,'observation').includes(g.group)).length<=3))return basic;
 const directory=queue.map(o=>({id:o.id,group:roots(o,'observation'),at:o.at,summary:String(o.data?.stageText||o.data?.reason||o.data?.name||o.kind).slice(0,130)}));
 const value=await core.life.judge('为本次判断选择最有解释力的原始观察：支持、反例、中途改主意，以及看似无关但能区分其他解释的经历。只选目录中的编号。无需凑数。',{type:'object',required:['ids'],properties:{ids:{type:'array',items:{type:'string'}}}},{candidates:candidates.map(x=>x.text),directory},{feature:'inner-growth-review',signal:AbortSignal.timeout(45000),maxOutputTokens:1200});
 if(!Array.isArray(value.ids)||value.ids.some(id=>!directory.some(o=>o.id===id)))throw Error('回放选择引用了未知观察');
 const selected=new Set(value.ids.slice(0,32));return {linked:basic.filter(g=>g.linked),selected:queue.filter(o=>selected.has(o.id)).map(o=>({id:o.id,group:roots(o,'observation'),at:o.at,data:o.data}))};
}
