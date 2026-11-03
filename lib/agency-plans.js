import fs from 'node:fs';
import path from 'node:path';

// Only explicitly shared, current intentions enter planning. Diary and memory review never read here.
export function agencyPlans(dir,sessionId,now){
 try{
   const home=path.dirname(dir);
   const owner=JSON.parse(fs.readFileSync(path.join(home,'censhu-agency/owner.json'),'utf8'));
   if(owner.until<=now||owner.sessionId!==sessionId)return [];
   const state=JSON.parse(fs.readFileSync(path.join(home,'censhu-agency/state.json'),'utf8'));
   return state.notes.filter(n=>n.sessionId===sessionId&&n.shareUntil>now).slice(-6).map(n=>({
     id:n.id,intention:n.text,progress:n.resume||'',source:'agency-plan',shareState:'planning-only'
   }));
 }catch{return [];}
}
