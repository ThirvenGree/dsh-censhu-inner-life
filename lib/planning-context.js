// Private planning is independent of conversational relevance and sharing consent.
export function planningContext(core,{sessionId,now=core.now()}={}){
 const sid=x=>String(x||'').replace(/^session-/,'');
 if(!core.config.enabled||!core.statusSnapshot?.sessionIds.some(x=>sid(x)===sid(sessionId)))return {records:[],items:[]};
 return {records:core.record.entries.filter(x=>!x.rejected&&!x.supersededAt&&x.expiresAt>now).slice(-200).map(x=>({id:x.id,at:x.at,expiresAt:x.expiresAt,feeling:x.feeling,reflection:x.reflection,intention:x.intention,shareState:x.shareState,intentionChanges:x.effects?.result?.intentions||null})),items:core.personalGrowth.record.items};
}
