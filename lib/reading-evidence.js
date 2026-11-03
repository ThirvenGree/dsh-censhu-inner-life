const norm=s=>typeof s==='string'?s.replace(/\s+/g,' ').trim():'';
function publicSource(value){
 try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';return u.origin+u.pathname;}catch{return '';}
}
// Keep page content only in this round's memory. Persist only short cited excerpts.
export class ReadingEvidence{
 constructor(){this.calls=new Map();this.pages=[];}
 observe(session,event){
  const p=event.data||{},message=p.message||{},key=session+':'+(p.callId||message.toolCallId);
  if(event.type==='tool/call'){
   if(!['browser_direct_inspect','bsk_inspect'].includes(p.name))return;
   let args=p.arguments;try{if(typeof args==='string')args=JSON.parse(args);}catch{return;}
   if(['observe','snapshot','extract'].includes(args?.action))this.calls.set(key,{tool:p.name,action:args.action});
   return;
  }
  if(event.type!=='tool/result')return;
  const call=this.calls.get(key);this.calls.delete(key);if(!call||message.isError)return;
  const body=norm((message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ')).slice(0,48000);
  if(body)this.pages=[...this.pages,{...call,key,body}].slice(-20);
 }
 verify(notes){
  const accepted=[];
  for(const n of (Array.isArray(notes)?notes:[]).slice(0,6)){
   const quote=norm(n?.quote),takeaway=norm(n?.takeaway),title=norm(n?.title),source=publicSource(n?.url);
   if(quote.length<6||quote.length>160||!title||title.length>160||!takeaway||takeaway.length>300||!source)continue;
   const page=this.pages.findLast(p=>p.body.includes(quote));
   if(page&&!accepted.some(x=>x.quote===quote))accepted.push({title,source,sourceAttribution:'reader-reported',quote,takeaway,receipt:page.key,tool:page.tool});
  }
  return accepted;
 }
}
