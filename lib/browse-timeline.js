import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const labels={start:'打开浏览器',navigate:'打开页面',sync:'同步页面',observe:'阅读页面',extract:'提取正文',snapshot:'查看页面结构',screenshot:'截取画面',click:'点击',scroll:'滚动',fill:'填写',stop:'关闭浏览器'};
const scrub=s=>String(s||'').replace(/https?:\/\/[^\s<>"]+/gi,x=>{try{const u=new URL(x);return u.origin+u.pathname;}catch{return '[网址]';}}).replace(/(?:Bearer\s+\S+|(?:sk-|AIza)[\w-]{12,})/gi,'[隐藏]').slice(0,220);
export class BrowseTimeline {
 constructor(dir){this.file=path.join(dir,'browser-process.json');try{this.rows=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.rows=[];}this.calls=new Map();}
 observe(runId,session,event){
  const p=event.data||{},m=p.message||{},id=p.callId||m.toolCallId;
  if(!id||!['tool/call','tool/result'].includes(event.type))return;
  const key=JSON.stringify([runId,session,id]),stepId='process:browse:'+createHash('sha256').update(key+event.type).digest('hex').slice(0,24);
  if(this.rows.some(x=>x.id===stepId))return;
  let step=this.calls.get(key);
  if(event.type==='tool/call'){
    if(!/^(?:browser_direct_|bsk_)/.test(p.name||''))return;
    let a=p.arguments;try{if(typeof a==='string')a=JSON.parse(a);}catch{return;}
    const act=String(a?.action||'');step={name:labels[act]||scrub(act)||p.name,act};
    this.calls.set(key,step);
    if(a.url)step.url=scrub(a.url);
  }else{
    if(!step)return;this.calls.delete(key);
  }
  const at=Date.now(),finished=event.type==='tool/result';
  const images=(finished&&!m.isError?m.content||[]:[]).filter(x=>x.type==='image'&&/^sha256:[a-f0-9]{64}$/.test(x.attachment?.attachmentId)).slice(-2).map(x=>({attachment:x.attachment}));
  let observation='';
  if(finished&&!m.isError&&['extract','observe','snapshot'].includes(step.act)){
    const body=(m.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
    observation=scrub(body.split('\n').filter(l=>l.trim()&&!/^\s*[@{[]/.test(l)).slice(0,4).join(' '));
  }
  const displayText=['浏览过程 · '+(finished?(m.isError?'未完成':'已返回'):'开始')+' · '+step.name,step.url,observation&&'页面观察：'+observation,images.length?'本步看到的画面（过程预览）':''].filter(Boolean).join('\n');
  this.rows.push({id:stepId,runId,at,reviewedAt:at,displayText,processImages:images});this.rows=this.rows.slice(-500);
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.rows));fs.renameSync(tmp,this.file);
 }
}
