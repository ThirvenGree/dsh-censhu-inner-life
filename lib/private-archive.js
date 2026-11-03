import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isPrivateSession} from './isolation.js';

export class PrivateArchive {
  constructor(dir){this.dir=path.join(dir,'private-archive');fs.mkdirSync(this.dir,{recursive:true});}
  location(id){if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('收藏编号无效');return path.join(this.dir,id);}
  read(id){const dir=this.location(id),meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));return {...meta,path:dir,text:fs.readFileSync(path.join(dir,'note.md'),'utf8'),...(meta.asset?{assetPath:path.join(dir,meta.asset)}:{})};}
  list(query='',offset=0){const items=[];for(const item of fs.readdirSync(this.dir,{withFileTypes:true})){if(!item.isDirectory()||!/^[a-f0-9-]{36}$/.test(item.name))continue;try{const row=this.read(item.name);if(!query||(row.title+'\n'+(row.project||'')+'\n'+row.text).toLowerCase().includes(query.toLowerCase()))items.push({id:row.id,title:row.title,at:row.at,asset:row.asset||null,version:row.version||1,project:row.project||'',previousVersionId:row.previousVersionId||null});}catch{}}
    items.sort((a,b)=>b.at-a.at);return {folder:this.dir,total:items.length,offset,items:items.slice(offset,offset+30)};}
  save({title,text='',sourcePath,previousVersionId,project,eventIds},source,stableId){if(typeof title!=='string'||!title.trim()||title.length>120||typeof text!=='string'||text.length>20000||(!text.trim()&&!sourcePath))throw Error('标题1–120字；文字最多20000字，文字或本地作品至少提供一项');
    let asset;if(sourcePath){if(!path.isAbsolute(sourcePath))throw Error('作品使用本地绝对路径');const st=fs.statSync(sourcePath);if(!st.isFile()||st.size>100*1024*1024)throw Error('作品必须是100MB以内的文件');asset='asset'+path.extname(sourcePath).slice(0,20);}
    const id=stableId||randomUUID(),dir=this.location(id);if(stableId&&fs.existsSync(path.join(dir,'meta.json')))return this.read(id);const previous=previousVersionId?this.read(previousVersionId):null;if(previous&&previous.id===id)throw Error('作品不能引用自身');if(eventIds&&(!Array.isArray(eventIds)||eventIds.length>20||eventIds.some(x=>typeof x!=='string'||x.length>180)))throw Error('事件编号无效');fs.mkdirSync(dir,{recursive:true});const meta={id,title:title.trim(),at:Date.now(),source:'character-life-private',sessionId:source,asset,project:String(project??previous?.project??'').slice(0,180),eventIds:eventIds||[],previousVersionId:previous?.id||null,version:(previous?.version||(previous?1:0))+1};
    if(asset){fs.copyFileSync(sourcePath,path.join(dir,asset));meta.assetHash=createHash('sha256').update(fs.readFileSync(path.join(dir,asset))).digest('hex');}fs.writeFileSync(path.join(dir,'note.md'),text);fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify(meta,null,2));return this.read(id);
  }
}

export function retainPrivateEntries(archive,entries){for(const row of entries||[]){if(!row.reviewedAt||row.rejected||row.shareState!=='private')continue;const h=createHash('sha256').update(String(row.id)).digest('hex').slice(0,32),id=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');archive.save({title:(row.feeling||'独处记录').slice(0,120),text:['# 留给自己的独处记录','原记录：'+row.id,'记录时间：'+new Date(row.at).toISOString(),row.feeling,row.reflection,row.intention?'当时的打算：'+row.intention:''].filter(Boolean).join('\n\n').slice(0,20000)},row.sourceId,id);}}

async function attachImage(ctx,exec,result){try{if(typeof ctx.tools.execute!=='function')throw Error('DSH图片读取接口不可用');const image=await ctx.tools.execute({name:'read_image',arguments:{file_path:result.assetPath},agent:exec.agent,callId:randomUUID(),rootCallId:exec.rootCallId||exec.callId,parent:exec.token,signal:exec.signal||new AbortController().signal});if(image.isError)throw Error((image.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(' ').slice(0,300)||'图片读取失败');result.imageContent=(image.content||[]).filter(x=>x.type==='image'&&x.attachment);if(!result.imageContent.length)throw Error('图片工具未返回图像内容');result.imageStatus='attached';}catch(error){result.imageStatus='unavailable';result.imageError=error.message;}}

export function installPrivateArchive(ctx,core){const archive=new PrivateArchive(core.dir);
  return ctx.tools.register({name:'censhu_private_archive',description:'自己的私人收藏。compare 用 id、otherId 和 question 返回两份原图，看完后用 report-analysis 提交 comparisonId 和 finding。save保存文字或复制本地图片/文件，list/search翻阅目录，read读取原文及作品路径。不会自动分享或写入人物设定；read遇到图片会调用DSH read_image并返回实际图像；不支持时明确报告，不能把路径当作已看过图片。',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['save','list','search','read','compare','report-analysis']},otherId:{type:'string'},question:{type:'string',maxLength:600},comparisonId:{type:'string'},finding:{type:'string',maxLength:1600},id:{type:'string'},title:{type:'string'},text:{type:'string'},sourcePath:{type:'string'},project:{type:'string'},previousVersionId:{type:'string'},eventIds:{type:'array',items:{type:'string'}},query:{type:'string'},offset:{type:'integer',minimum:0}}},output:{schema:{type:'string'},render:(_args,text)=>{const value=JSON.parse(text),images=value.imageContent||[];delete value.imageContent;return [{type:'text',text:JSON.stringify(value)},...images];}},async execute(args,exec){const id=exec.agent?.session?.id||exec.agent?.id,normalize=v=>String(v||'').replace(/^session-/,'');if(!isPrivateSession(exec.agent)&&!core.statusSnapshot?.sessionIds?.some(v=>normalize(v)===normalize(id)))throw Error('当前会话未绑定岑舒');let result;
if(args.action==='compare'||args.action==='report-analysis'){
 if(!isPrivateSession(exec.agent))throw Error('图片对照限生活会话');
 core.record||={};const records=core.record.recollections||=[];
 if(args.action==='report-analysis'){
   const comparison=records.find(r=>r.comparisonId===args.comparisonId&&r.sessionId===id&&r.status==='images-attached');
   if(!comparison||!args.finding?.trim()||args.finding.length>1600)throw Error('请先对照两张原图，再提交本次问题的观察');
   comparison.status='analysis-reported';comparison.finding=args.finding;core.save?.();return JSON.stringify({ok:true,status:comparison.status});
 }
 if(!args.question?.trim()||args.question.length>600||args.id===args.otherId)throw Error('需要两个不同的作品编号和具体的对照问题');
 const images=[],items=[];
 for(const ref of [args.id,args.otherId]){
   const row=archive.read(ref);if(!row.assetPath||!/\.(png|jpe?g|webp|gif)$/i.test(row.assetPath))throw Error('收藏缺少可读原图');
   await attachImage(ctx,exec,row);if(row.imageStatus!=='attached')throw Error(row.imageError||'未取得原图');
   images.push(...row.imageContent);items.push({id:ref,title:row.title,version:row.version||1,hash:row.assetHash||null,imageCount:row.imageContent.length});
 }
 const receipt={at:Date.now(),sessionId:id,comparisonId:randomUUID(),question:args.question,items,status:'images-attached'};
 records.push(receipt);core.record.recollections=records.slice(-200);core.save?.();return JSON.stringify({...receipt,imageContent:images});
}
if(args.action==='save')result=archive.save(args,id);else if(args.action==='read')result=archive.read(args.id);else if(['list','search'].includes(args.action))result=archive.list(args.query||'',Math.max(0,Math.floor(args.offset||0)));else throw Error('未知操作');if(args.action==='read'&&result.assetPath&&/\.(png|jpe?g|webp|gif)$/i.test(result.assetPath)){await attachImage(ctx,exec,result);}if(['list','search','read'].includes(args.action)){core.record||={};core.record.recollections||=[];core.record.recollections.push({at:Date.now(),sessionId:id,source:'private-archive',action:args.action,query:String(args.query||'').slice(0,160),id:args.id||null,title:result.title||null,count:result.total??1,status:args.action==='read'?(result.imageStatus==='attached'?'image-attached':result.imageStatus==='unavailable'?'image-unavailable':'read'):'catalog'});core.record.recollections=core.record.recollections.slice(-200);core.save?.();}return JSON.stringify({ok:true,...result});}});
}
