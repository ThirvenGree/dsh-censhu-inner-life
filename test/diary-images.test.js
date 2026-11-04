import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {SeenImages,preserveDiaryImages} from '../lib/diary-images.js';
test('a selected image survives removal of the temporary source; failed and invented references are excluded',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'diary-picture-'));try{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLZkAAAAASUVORK5CYII=','base64'),hash=createHash('sha256').update(bytes).digest('hex'),id='sha256:'+hash,dir=path.join(home,'censhu-inner-life');
 const obj=path.join(home,'attachments/v1/objects',hash.slice(0,2),hash);fs.mkdirSync(path.dirname(obj),{recursive:true});fs.writeFileSync(obj,bytes);
 const images=new SeenImages(),event={type:'tool/result',data:{message:{isError:true,toolCallId:'c',content:[{type:'image',attachment:{attachmentId:id,mediaType:'image/png',bytes:bytes.length,width:1,height:1}}]}}};images.observe('s',event);assert.equal(images.catalog().length,0);
 event.data.message.isError=false;images.observe('s',event);const selected=images.select([{id:'made-up',caption:'无'},{id:'latest',caption:'想留的画面'},{id,caption:'重复'}]);assert.equal(selected.length,1);assert.equal(preserveDiaryImages(dir,selected).length,1);fs.unlinkSync(obj);assert.equal(preserveDiaryImages(dir,selected).length,1);assert.deepEqual(fs.readFileSync(path.join(dir,'diary-images',hash)),bytes);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
