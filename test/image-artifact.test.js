import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {imageArtifact,verifyImageArtifact} from '../lib/image-artifact.js';
test('matches the original generated PNG and detects replacement or loss',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'generated-artifact-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'state/generated-images');fs.mkdirSync(dir,{recursive:true});const id=randomUUID(),file=path.join(dir,id+'.image');
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=','base64');fs.writeFileSync(file,bytes);
 const hash=createHash('sha256').update(bytes).digest('hex'),res={content:[{type:'text',text:'artifactHash='+hash+'；captureId='+id}]};
 const ref=imageArtifact({name:'mcp__snowluma__qq_generate_image'},res);assert.equal(verifyImageArtifact(ref,root),true);
 assert.equal(imageArtifact({name:'read'},res),undefined);fs.appendFileSync(file,'x');assert.equal(verifyImageArtifact(ref,root),false);
 fs.unlinkSync(file);assert.equal(verifyImageArtifact(ref,root),false);
});
