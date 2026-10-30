import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
let checkedAt=0,cached,checkedDir;
export function isolationHealth(dir,now=Date.now()){
 if(cached&&checkedDir===dir&&now-checkedAt<30000)return cached;checkedAt=now;checkedDir=dir;
 try{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'isolation-adapters.json'),'utf8'));if(manifest.version!==1||manifest.protocol!=='censhu-private-session-v1'||!manifest.files?.length)throw Error('缺少隔离适配清单');
 const changed=manifest.files.filter(x=>!fs.existsSync(x.file)||createHash('sha256').update(fs.readFileSync(x.file)).digest('hex')!==x.hash);
 if(changed.length)throw Error('插件升级或改动后需要重新接入：'+changed.map(x=>path.basename(path.dirname(x.file))).join('、'));
 return cached={ready:true,message:'独处会话隔离已验证',count:manifest.files.length};
 }catch(e){return cached={ready:false,message:'独处已暂停：'+e.message+'；运行 scripts/install-isolation.mjs 后重启DSH'};}
}
