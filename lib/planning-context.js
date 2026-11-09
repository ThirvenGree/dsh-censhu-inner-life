import {agencyPlans} from './agency-plans.js';
// Private planning is independent of conversational relevance and sharing consent.
export function planningContext(core,{sessionId,now=core.now()}={}){
 const sid=x=>String(x||'').replace(/^session-/,'');
 if(!core.config.enabled||!(core.life.isRoleSession?.(sessionId)??core.statusSnapshot?.sessionIds.some(x=>sid(x)===sid(sessionId))))return {records:[],items:[]};
 return {interests:core.interests?.active()||[],thoughts:core.thoughts?.active()||[],innerState:core.innerState?.active()||null,records:core.record.entries.filter(x=>!x.rejected&&!x.supersededAt&&x.expiresAt>now).slice(-200).map(x=>({id:x.id,at:x.at,expiresAt:x.expiresAt,feeling:x.feeling,reflection:x.reflection,readingNotes:(x.readingNotes||[]).map(({title,takeaway})=>({title,takeaway})),intention:x.intention,shareState:x.shareState,intentionChanges:x.effects?.result?.intentions||null})).concat(agencyPlans(core.dir,sessionId,now)),personality:core.personality.active(),items:core.personalGrowth.record.items,today:usedToday(core)};
}
// 2026-11-09: what the rhythm judge needs to decide today's remaining solitude (read only; never creates the day row).
function usedToday(core){const day=core.record.daily?.[core.date?.()]||{};return {judgments:day.judgments||0,reflections:day.reflections||0};}
