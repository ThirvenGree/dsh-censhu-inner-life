import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingEvidence} from '../lib/reading-evidence.js';
import {diaryText} from '../lib/display-session.js';
test('reading notes require a matching successful page observation from this run',()=>{
 const e=new ReadingEvidence();
 const start=(session,id)=>e.observe(session,{type:'tool/call',data:{callId:id,name:'browser_direct_inspect',arguments:'{"action":"observe"}'}});
 const end=(session,id,isError,text)=>e.observe(session,{type:'tool/result',data:{message:{toolCallId:id,isError,content:[{type:'text',text}]}}});
 start('inner','one');end('other','one',false,'不属于该页面的内容');end('inner','one',false,'木框背面的铅笔日期。');
 start('inner','two');end('inner','two',true,'错误时返回的页面片段');
 const note={title:'旧框',url:'https://example.org/frames?key=secret',takeaway:'我想起今天整理画册时翻到的日期。'};
 const notes=e.verify(['木框背面的铅笔日期','不属于该页面的内容','错误时返回的页面片段','没有见到的说明'].map(quote=>({...note,quote})));
 assert.equal(notes.length,1);assert.equal(notes[0].source,'https://example.org/frames');assert.equal(notes[0].receipt,'inner:one');
 assert.match(diaryText({at:1,reflection:'对照了日期',readingNotes:notes}),/铅笔日期/);
 assert.deepEqual(new ReadingEvidence().verify(notes),[]);
});
