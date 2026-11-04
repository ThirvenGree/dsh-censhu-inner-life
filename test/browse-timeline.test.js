import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {BrowseTimeline} from '../lib/browse-timeline.js';import {diaryText} from '../lib/display-session.js';
test('browser preview and chosen diary image are separate; duplicate events do not reappear after reopen',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'browser-diary-display-'));
 try{
 const t=new BrowseTimeline(dir),a={attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png'},b={...a,attachmentId:'sha256:'+'b'.repeat(64)};
 const start={type:'tool/call',data:{callId:'one',name:'bsk_inspect',arguments:'{"action":"screenshot"}'}},end={type:'tool/result',data:{message:{toolCallId:'one',content:[a,b].map(attachment=>({type:'image',attachment}))}}};
 t.observe('run','child',start);t.observe('run','child',end);const reopened=new BrowseTimeline(dir);reopened.observe('run','child',start);reopened.observe('run','child',end);assert.equal(reopened.rows.length,2);assert.deepEqual(reopened.rows[1].processImages.map(x=>x.attachment.attachmentId),[a.attachmentId,b.attachmentId]);
 const entry={at:1,feeling:'看着很安静',diaryImages:[{attachment:b,caption:'我只想留下第二张。'}]};assert.match(diaryText(entry),/看着很安静/);assert.match(diaryText(entry),/配图 1.*第二张/);assert.doesNotMatch(diaryText(entry),/配图 2/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
