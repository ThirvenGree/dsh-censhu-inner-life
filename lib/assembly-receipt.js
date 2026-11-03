// Mark only entries actually present in the downstream life context.
export async function assembleWithReceipt(core,sessionId,next,onError=()=>{}) {
  const assembly=await next();acknowledgeContext(core,sessionId,assembly.contexts,onError);return assembly;
}
export function acknowledgeContext(core,sessionId,contexts,onError=()=>{}){
  try {
    const ids=new Set();
    for(const context of contexts||[]) {
      if(context.name!=='cen-shu-life'||typeof context.text!=='string')continue;
      const marker='【岑舒独处后的临时状态】';
      for(const section of context.text.split(marker).slice(1)){
        const raw=section.split('。这是你自己的生活感受与打算')[0];
        const rows=JSON.parse(raw);
        if(Array.isArray(rows))for(const row of rows)if(typeof row?.id==='string')ids.add(row.id);
      }
    }
    const included=(core.context({sessionId}).ids||[]).filter(id=>ids.has(id));
    if(included.length)core.seen(sessionId,included);
  }catch(error){try{onError(error);}catch{}}
}
