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
const testIds=new Set();
export function isProbeWorkspace(cwd){if(typeof cwd!=='string'||!cwd)return false;const resolved=path.resolve(cwd);return path.relative(os.tmpdir(),path.dirname(resolved))==='' && /^qq-bridge-(?:probe-[a-z0-9-]+|self-test)$/i.test(path.basename(resolved));}
export function isPrivateSession(value){load();const session=value?.session||value;const sid=typeof value==='string'?value:session?.id||session?.header?.id; if(isProbeWorkspace(session?.header?.cwd||session?.cwd)){if(sid)testIds.add(normalize(sid));return true;} if(testIds.has(normalize(sid)))return true;const id=typeof value==='string'?value:value?.session?.id||value?.id||value?.header?.id;return ids.has(normalize(id));}
export function registerPrivateSession(id){load();ids.add(normalize(id));const f=file();fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,sessions:[...ids]}));fs.renameSync(tmp,f);stamp='';}
export function isInternalMessage(message){const text=Array.isArray(message?.content)?message.content.filter(x=>x?.type==='text').map(x=>x.text).join(''):String(message?.content||'');if(text.includes('【生物钟】')&&text.includes('按以下夜间流程走一遍')&&text.includes('node bili.mjs'))return true;const source=message?.source?.kind;return String(source||'').startsWith('plugin:')||['dsh-censhu-agency','plugin:dsh-censhu-agency','plugin:dsh-censhu-inner-life','censhu-inner-life','censhu-inner-life-notice','plugin:censhu-inner-life'].includes(source);}

let rolePath,roleStamp,roleId;
export function requiresReviewedCapture(value){
 const session=value?.session||value,id=normalize(typeof value==='string'?value:session?.id||session?.header?.id);
 if(!id)return false;
 const file=path.join(home(),'characters','censhu','integration.json');
 try{const st=fs.statSync(file),stamp=st.mtimeMs+':'+st.size;if(file!==rolePath||roleStamp!==stamp){
   roleId=normalize(JSON.parse(fs.readFileSync(file,'utf8')).sessionId);rolePath=file;roleStamp=stamp;
 }return !!roleId&&roleId===id;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
