// Mark only entries actually present in the downstream life context.
export async function assembleWithReceipt(core,sessionId,next,onError=()=>{}) {
  const assembly=await next();
  try {
    const ids=new Set();
    for(const context of assembly.contexts||[]) {
      if(context.name!=='cen-shu-life'||typeof context.text!=='string')continue;
      const marker='【岑舒独处后的临时状态】';
      const start=context.text.indexOf(marker);
      if(start<0)continue;
      const raw=context.text.slice(start+marker.length).split('。这是你自己的生活感受与打算')[0];
      const rows=JSON.parse(raw);
      if(Array.isArray(rows))for(const row of rows)if(typeof row?.id==='string')ids.add(row.id);
    }
    const included=(core.context({sessionId}).ids||[]).filter(id=>ids.has(id));
    if(included.length)core.seen(sessionId,included);
  }catch(error){try{onError(error);}catch{}}
  return assembly;
}
