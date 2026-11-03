import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export function displayId(row){
 if(/^[0-9a-f]{24}$/.test(row.timelineId||''))return 'process:agency:'+row.timelineId;
 return 'process:agency:'+createHash('sha256').update(JSON.stringify([row.at,row.run,row.type,row.detail])).digest('hex').slice(0,24);
}
const directory=home=>path.join(home,'censhu-agency/display-outbox');
export function queueDisplay(home,row){
 if(!row.sessionId)return;
 const dir=directory(home);fs.mkdirSync(dir,{recursive:true});
 const target=path.join(dir,displayId(row).split(':').at(-1)+'.json'),tmp=target+'.'+randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(row),{mode:0o600});fs.renameSync(tmp,target);
}
export function pendingDisplay(home,sessionId){
 const dir=directory(home);if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir).filter(n=>/^[a-f0-9]{24}\.json$/.test(n)).flatMap(n=>{
   try{const row=JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));return row.sessionId===sessionId?[row]:[];}
   catch(e){if(e.code==='ENOENT')return [];throw e;}
 });
}
export function acknowledgeDisplay(home,id){
 if(/^process:agency:[a-f0-9]{24}$/.test(id||''))fs.rmSync(path.join(directory(home),id.split(':').at(-1)+'.json'),{force:true});
}
export function watchDisplay(home,refresh){
 const dir=directory(home);fs.mkdirSync(dir,{recursive:true});let timer;
 const watcher=fs.watch(dir,(_event,name)=>{if(!String(name).endsWith('.json'))return;
   if(!timer)timer=setTimeout(()=>{timer=null;refresh();},100);
 });
 watcher.on('error',()=>watcher.close());
 return ()=>{clearTimeout(timer);watcher.close();};
}
const local=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
export function describePlan(n){
 return [n.text,n.resume&&'接回时从这里继续：'+n.resume,n.eventId&&'等到事件'+(n.when==='event-end'?'结束':'推进')+'：'+n.eventId,n.due&&'提醒时间：'+local(n.due),n.shareUntil&&'规划参考至：'+local(n.shareUntil)].filter(Boolean).join('\n');
}
export function describeActivity(v){
 return [v.activity,({__proto__:null,tired:'感到疲惫',rested:'精力尚好',uncertain:'还说不清精力如何'})[v.energy]||v.energy,v.judgment&&'此刻的判断：'+v.judgment,v.thought&&'当时的想法：'+v.thought,'有效至：'+local(v.until)].filter(Boolean).join('\n');
}

export function acknowledgeSeenAgency(home,seen){
 const dir=directory(home);if(!fs.existsSync(dir))return;
 for(const file of fs.readdirSync(dir)){
   if(/^[a-f0-9]{24}\.json$/.test(file)&&seen.has('process:agency:'+file.slice(0,-5)))fs.rmSync(path.join(dir,file),{force:true});
 }
}

function brief(value){
 return String(value).replace(/(?:sk-[\w-]{10,}|AIza[\w-]{12,}|gh[pous]_[\w-]+|Bearer\s+[\w.=-]+)/gi,'[已隐藏]').replace(/([?&](?:token|key|signature|auth|code)=)[^&#\s]*/gi,'$1[已隐藏]').slice(0,180);
}
export function describeCall(name,raw){
 let args=raw;try{if(typeof raw==='string')args=JSON.parse(raw);}catch{return name;}
 if(!args||typeof args!=='object')return name;
 const fields={action:'动作',query:'查找',eventId:'事件',activity:'活动',minutes:'分钟',title:'标题',url:'页面',selector:'元素',file_path:'文件',videoId:'视频',bv:'视频',stage:'阶段'};
 const info=[];
 for(const [key,label] of Object.entries(fields)){
   const v=args[key];if(typeof v!=='string'&&typeof v!=='number')continue;
   if(key==='url'){try{const u=new URL(v);if(['http:','https:'].includes(u.protocol))info.push(label+' '+u.origin+brief(u.pathname));}catch{}}
   else info.push(label+' '+brief(v));
 }
 return [name,...info].join(' · ');
}
export function describeResult(name,message){
 const blocks=Array.isArray(message.content)?message.content:[];
 const summary=[];for(const block of blocks){
   if(block.type==='image'){summary.push('返回图片');continue;}
   if(block.type!=='text')continue;
   let v;try{v=JSON.parse(block.text);}catch{continue;}
   if(!v||typeof v!=='object')continue;
   for(const [k,label] of Object.entries({total:'匹配',count:'数量',status:'状态',confirmed:'平台确认',eventId:'事件',olderBefore:'更早页游标'})){
     if(['boolean','number','string'].includes(typeof v[k]))summary.push(label+' '+brief(v[k]));
   }
   for(const [k,label] of [['rows','阶段'],['candidates','候选'],['items','条目']])if(Array.isArray(v[k]))summary.push(v[k].length+' 条'+label);
 }
 return [name,...new Set(summary)].join(' · ');
}
