import {createHash} from 'node:crypto';
export const digest=v=>createHash('sha256').update(v).digest('hex');
function terms(text){
 const out=new Set();
 for(const word of String(text||'').toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu)||[]){
   if(/\p{Script=Han}/u.test(word)){if(word.length===1)out.add(word);for(let i=1;i<word.length;i++)out.add(word.slice(i-1,i+1));}
   else out.add(word);
 }
 return out;
}
export class RecallIndex{
 constructor(){this.index=new Map();this.docs=new Map();}
 rank(rows,questions){
   const live=new Set(rows.map(r=>r.id));
   for(const [id,d] of this.docs)if(!live.has(id))this.remove(id,d);
   for(const r of rows){
     const text=[r.title,r.project,r.text].filter(Boolean).join(' '),previous=this.docs.get(r.id);
     if(previous?.text===text)continue;if(previous)this.remove(r.id,previous);
     const tokens=terms(text);this.docs.set(r.id,{text,tokens});
     for(const t of tokens){if(!this.index.has(t))this.index.set(t,new Set());this.index.get(t).add(r.id);}
   }
   const scores=new Map();for(const t of terms(questions.join(' '))){const ids=this.index.get(t);if(ids)for(const id of ids)scores.set(id,(scores.get(id)||0)+Math.log1p(rows.length/ids.size));}
   return rows.filter(r=>scores.has(r.id)).sort((a,b)=>scores.get(b.id)-scores.get(a.id));
 }
 remove(id,d){this.docs.delete(id);for(const t of d.tokens){const ids=this.index.get(t);ids.delete(id);if(!ids.size)this.index.delete(t);}}
}
