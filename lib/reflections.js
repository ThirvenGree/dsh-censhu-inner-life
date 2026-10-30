// Transport budgets preserve old backlog and fresh observations. Meaning and focus
// selection belong to the model; these helpers do not classify free text.
export function observationBatch(queue,limit=80,now=Date.now()){
  const rows=queue.filter(x=>x.state==='pending'&&!(x.revisitAt>now)),half=Math.floor(limit/2);
  return [...new Map([...rows.slice(0,half),...rows.slice(-(limit-half))].map(x=>[x.id,x])).values()].sort((a,b)=>a.at-b.at);
}
export function episodes(rows){
  const groups=new Map();for(const row of rows){const key=row.data?.eventId||row.data?.sessionId||row.id;
    if(!groups.has(key))groups.set(key,{id:key,name:row.data?.name||row.kind,observationIds:[],timeline:[]});
    const group=groups.get(key);group.observationIds.push(row.id);group.timeline.push({id:row.id,at:row.at,kind:row.kind});
  }return [...groups.values()];
}
export function reflectionCatalog(entries,now){
  return entries.filter(x=>!x.rejected).slice(-200).map(x=>({id:x.id,at:x.at,importance:x.importance||0,feeling:x.feeling,reflection:x.reflection,intention:x.intention,supersededBy:x.supersededBy||null,active:!x.supersededAt&&x.expiresAt>now}));
}
export function selectedIds(value,allowed,{fallback=[],limit=80,label='来源'}={}){
  if(value===undefined)return fallback;
  if(!Array.isArray(value)||value.length>limit||value.some(x=>typeof x!=='string'||!allowed.has(x)))throw Error(label+'编号无效');
  return [...new Set(value)];
}
