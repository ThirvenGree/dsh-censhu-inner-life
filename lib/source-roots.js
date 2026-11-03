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
 const changed=new Set(corrections.filter(x=>x.phase==='done'&&x.revokedHash).map(x=>x.revokedHash));
 if(!changed.size)return;
 const items=parts.flatMap(part=>(part.record.items||[]).map(item=>({part,item})));
 const dirty=new Set(), visited=new Set(), invalidIds=new Set();
 // Follow actual citations only. Merely sharing a topic or an event is insufficient.
 let advanced=true;
 while(advanced){
   advanced=false;
   for(const {part,item} of items){
     if(visited.has(item))continue;
     const refs=[...(item.provenance||[]),...(item.evidence||[]),...(item.evidenceSnapshots||[])];
     const matches=refs.filter(ref=>invalidIds.has(ref.id)||(ref.sourceHashes||[evidenceHash(ref.text||ref.content)]).some(h=>changed.has(h)));
     if(!matches.length&&!(item.evidenceIds||[]).some(id=>invalidIds.has(id)))continue;
     const hits=matches.flatMap(ref=>(ref.sourceHashes||[evidenceHash(ref.text||ref.content)]).filter(h=>changed.has(h)));
     visited.add(item);invalidIds.add(item.id);advanced=true;
     if(!item.needsEvidenceReview||hits.some(h=>!item.disputedSources?.includes(h))){
       item.disputedSources=[...new Set([...(item.disputedSources||[]),...hits])];
       item.needsEvidenceReview=true;item.reviewAt=0;dirty.add(part);
     }
   }
 }
 for(const part of dirty){part.record.nextAt=0;part.record.nextReviewAt=0;part.save();}
}
