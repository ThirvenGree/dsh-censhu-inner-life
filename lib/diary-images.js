import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sha=/^sha256:([a-f0-9]{64})$/;
const mime=new Set(['image/png','image/jpeg','image/webp','image/gif']);
export class SeenImages {
 constructor(){this.seen=new Map();}
 observe(session,event){
  const m=event.data?.message;
  if(event.type!=='tool/result'||!m||m.isError)return;
  for(const b of m.content||[]){
   const a=b.attachment;if(b.type!=='image'||!a||!sha.test(a.attachmentId)||!mime.has(a.mediaType))continue;
   this.seen.delete(a.attachmentId);
   this.seen.set(a.attachmentId,{attachment:{attachmentId:a.attachmentId,mediaType:a.mediaType,bytes:a.bytes,width:a.width,height:a.height},receipt:session+':'+m.toolCallId});
   if(this.seen.size>32)this.seen.delete(this.seen.keys().next().value);
  }
 }
 catalog(){return [...this.seen.values()].map(({attachment,receipt})=>({id:attachment.attachmentId,receipt}));}
 select(proposals){
  const selected=new Map();
  for(const p of Array.isArray(proposals)?proposals:[]){
   const id=p?.id==='latest'?[...this.seen.keys()].at(-1):p?.id;
   const seen=this.seen.get(id),caption=typeof p?.caption==='string'?p.caption.trim().slice(0,240):'';
   if(seen&&caption&&!selected.has(id))selected.set(id,{...seen,caption});
   if(selected.size>=4)break;
  }
  return [...selected.values()];
 }
}
export function preserveDiaryImages(dir,images){
 const saved=[];
 for(const image of images||[]){
  const hash=sha.exec(image.attachment?.attachmentId)?.[1];if(!hash||!mime.has(image.attachment.mediaType))continue;
  const folder=path.join(dir,'diary-images'),dest=path.join(folder,hash);
  let tmp;
  try{
   if(!fs.existsSync(dest)){
    const src=path.join(path.dirname(dir),'attachments/v1/objects',hash.slice(0,2),hash);
    const bytes=fs.readFileSync(src);if(createHash('sha256').update(bytes).digest('hex')!==hash)continue;
    fs.mkdirSync(folder,{recursive:true});tmp=dest+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,dest);
   }
   saved.push(image);
  }catch(error){if(error.code!=='ENOENT')throw error;}finally{if(tmp&&fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 return saved;
}
