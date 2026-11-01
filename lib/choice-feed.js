import fs from 'node:fs';
import path from 'node:path';
let cached={at:0,home:'',rows:[]};
export function choiceFeed(home,now=Date.now()){
 if(cached.home===home&&now-cached.at<5000)return cached.rows;
 const rows=[],dir=path.join(home,'gemini-monitor');
 try{const files=fs.readdirSync(dir).filter(x=>/^calls-\d+\.json$/.test(x)).map(name=>({name,at:fs.statSync(path.join(dir,name)).mtimeMs})).sort((a,b)=>b.at-a.at).slice(0,32);
 for(const f of files){try{const data=JSON.parse(fs.readFileSync(path.join(dir,f.name),'utf8'));for(const r of data.rows||[]){if(r.status!=='success')continue;for(const c of r.choices||[])rows.push({at:r.at,feature:r.feature,model:r.model,...c,stage:'model-choice'});}}catch{}}
 }catch{}
 rows.sort((a,b)=>b.at-a.at);cached={home,at:now,rows:rows.slice(0,100)};return cached.rows;
}
