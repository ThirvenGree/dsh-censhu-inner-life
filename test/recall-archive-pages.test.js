import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {QuestionRecall} from '../lib/question-recall.js';
import {PrivateArchive} from '../lib/private-archive.js';
test('a private result pages across chunks, rejects replacement and stays inaccessible from chat',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'question-pages-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const archive=new PrivateArchive(dir),row=archive.save({title:'窗台',text:'甲'.repeat(3000)+'后半原文'},'life');
 const core={dir,read:(_,v)=>v,write(){},record:{entries:[]},config:{enabled:true,maxDeliberationsDaily:15},life:{status:()=>({}),personalitySources:()=>({})},date:()=>'today',now:()=>1};
 const q=new QuestionRecall(core),opt={sessionId:'life',privateScope:true,requestId:'r',judge:async(_p,_s,{candidates})=>({decision:'proceed',reason:'test',selectedIds:[candidates[0].id]})};
 const first=await q.lookup('窗台',opt),page={...opt,sourceId:first.matches[0].id,sourceVersion:first.sourceVersion,offset:3000};
 assert.equal((await q.lookup('窗台',page)).matches[0].text,'后半原文');
 await assert.rejects(q.lookup('窗台',{...page,privateScope:false,sessionId:'qq'}));
 fs.writeFileSync(path.join(row.path,'note.md'),'替换');
 await assert.rejects(q.lookup('窗台',page),/来源版本已变化/);
});
