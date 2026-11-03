import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function imageArtifact(exec,result){
 if(result?.isError||!/(?:^|__)qq_generate_image$/.test(exec.name))return;
 const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
 const id=/\bcaptureId=([a-f0-9-]{36})\b/i.exec(text)?.[1],hash=/\bartifactHash=([a-f0-9]{64})\b/i.exec(text)?.[1];
 return id&&hash?{id,hash}:undefined;
}
export function verifyImageArtifact(ref,root=process.env.QQ_BRIDGE_ROOT||path.join(os.homedir(),'OneDrive','文档','Playground','qq-bridge')){
 if(!ref||!/^[a-f0-9-]{36}$/i.test(ref.id))return false;
 try{
   const file=path.join(root,'state','generated-images',ref.id+'.image'),stat=fs.lstatSync(file);
   if(!stat.isFile()||stat.size<12||stat.size>100*1024*1024)return false;
   const bytes=fs.readFileSync(file);
   const magic=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'||bytes.readUInt16BE(0)===0xffd8||(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
   return magic&&createHash('sha256').update(bytes).digest('hex')===ref.hash;
 }catch{return false;}
}
