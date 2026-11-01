import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const readOnly=exec=>['read','read_file','read_image','list_directory','grep','glob','web_search','run_code'].includes(exec.name)||exec.name==='censhu_private_archive'&&['read','list','search'].includes(exec.arguments?.action);
// A claim precedes dispatch: a crash without a result remains uncertain, never retryable automatically.
export class ActionLedger {
 constructor(dir,runId){this.file=path.join(dir,'action-ledger.json');this.runId=runId;}
 read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,actions:{}};throw e;}}
 save(data){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,this.file);}
 key(exec){return createHash('sha256').update(JSON.stringify([this.runId,exec.name,canonical(exec.arguments)])).digest('hex');}
 claim(exec){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),old=data.actions[key];if(old)return `同一独处任务的相同动作已登记（${old.state}），禁止重复执行。已有结果请查看原会话；结果不确定先核实，不能通过改写参数绕过。`;
 data.actions[key]={runId:this.runId,name:exec.name,callId:exec.callId,state:'pending',at:Date.now()};this.save(data);}
 settle(exec,result){if(readOnly(exec))return;const data=this.read(),key=this.key(exec),row=data.actions[key];if(!row||row.callId!==exec.callId)return;row.state=result.isError?'uncertain':'completed';row.finishedAt=Date.now();this.save(data);}
 view(){return Object.values(this.read().actions).filter(x=>x.runId===this.runId);}
}
