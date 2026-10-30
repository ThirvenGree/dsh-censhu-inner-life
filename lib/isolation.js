import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const normalize=id=>String(id||'').replace(/^session-/,'');
const home=()=>process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const file=()=>path.join(home(),'censhu-inner-life','isolation.json');
let stamp='',ids=new Set();
function load(){
  // Stat detects pre-creation registrations made by another module instance/process.
  const f=file();let key='';try{const st=fs.statSync(f);key=f+':'+st.mtimeMs+':'+st.size;}catch{}
  if(key===stamp&&key)return;
  const rows=[];try{rows.push(...JSON.parse(fs.readFileSync(f,'utf8')).sessions);}catch{}
  try{const s=JSON.parse(fs.readFileSync(path.join(home(),'censhu-inner-life/state.json'),'utf8'));rows.push(s.worker?.sessionId,...(s.workers||[]).map(x=>x.sessionId));}catch{}
  ids=new Set(rows.filter(Boolean).map(normalize));stamp=key;
}
export function isPrivateSession(value){load();const id=typeof value==='string'?value:value?.session?.id||value?.id||value?.header?.id;return ids.has(normalize(id));}
export function registerPrivateSession(id){load();ids.add(normalize(id));const f=file();fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,sessions:[...ids]}));fs.renameSync(tmp,f);stamp='';}
export function isInternalMessage(message){const source=message?.source?.kind;return ['censhu-inner-life','censhu-inner-life-notice','plugin:censhu-inner-life'].includes(source);}
