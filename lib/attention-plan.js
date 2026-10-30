// Validate model decisions; do not classify observation text in local rules.
export function attentionPlan(value,allowed){
 if(value===undefined)return null; // Compatibility with checkpoints from previous versions.
 if(!Array.isArray(value)||value.length>80)throw Error('逐项注意判断格式无效');
 const seen=new Set();
 return value.map(item=>{
  if(!item||!allowed.has(item.id)||seen.has(item.id)||!['attend','later','record','uncertain'].includes(item.decision)||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>200||!Number.isInteger(item.revisitMinutes)||item.revisitMinutes<1||item.revisitMinutes>1440)throw Error('逐项注意判断编号、理由或复看时间无效');
  seen.add(item.id);return {id:item.id,decision:item.decision,reason:item.reason,revisitMinutes:item.revisitMinutes};
 });
}
export function applyAttentionPlan(queue,plan,now){
 for(const item of plan){
  const row=queue.find(x=>x.id===item.id&&x.state==='pending');if(!row)continue;
  row.attention={...item,at:now};
  if(item.decision==='record')Object.assign(row,{state:'recorded',processedAt:now,reason:item.reason});
  else row.revisitAt=['later','uncertain'].includes(item.decision)?now+item.revisitMinutes*60000:0;
 }
}
