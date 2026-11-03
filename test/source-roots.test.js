import test from 'node:test';
import assert from 'node:assert/strict';
import {markDependencies,evidenceHash} from '../lib/source-roots.js';
test('a correction invalidates indirect citations without discrediting an unrelated fact',()=>{
 const trait={id:'trait:1',evidence:[{id:'thought:1'}]},thought={id:'thought:1',evidence:[{id:'memory:1',text:'旧依据'}]},other={id:'other',evidence:[{id:'memory:2',text:'别的依据'}]};
 let saves=0;const part={record:{items:[trait,other,thought]},save(){saves++}};
 const receipt={phase:'done',revokedHash:evidenceHash('旧依据')};
 markDependencies([part],[receipt]);markDependencies([part],[receipt]);
 assert.equal(trait.needsEvidenceReview,true);assert.equal(thought.needsEvidenceReview,true);assert.equal(other.needsEvidenceReview,undefined);assert.equal(saves,1);
});

test('two providers must both withdraw a shared source before it becomes disputed',()=>{
 const row={id:'trait',evidence:[{text:'shared',sources:['memory:openviking','memory:engram_search']}]};
 const part={record:{items:[row]},save(){}};
 const receipt={phase:'done',scoped:true,revokedHash:evidenceHash('shared'),backend:'openviking'};
 markDependencies([part],[receipt]);assert.equal(row.needsEvidenceReview,undefined);
 markDependencies([part],[receipt,{...receipt,backend:'engram'}]);assert.equal(row.needsEvidenceReview,true);
});
test('same-provider copies and revisions are independent',()=>{
 const text='记得的内容',h=evidenceHash(text);
 const records=['A','B'].map(id=>({provider:'openviking',scope:'user',id,version:'v1',versionKind:'native',contentHash:h}));
 const row={id:'derived',evidence:[{text,sources:['memory:openviking'],records}]},part={record:{items:[row]},save(){}};
 const r={phase:'done',scoped:true,backend:'openviking',scope:'user',recordId:'A',revokedHash:h,version:'v1'};
 markDependencies([part],[r]);assert.ok(!row.needsEvidenceReview);assert.ok(records[0].withdrawnAt);assert.ok(!records[1].withdrawnAt);
 markDependencies([part],[r,{...r,recordId:'B',version:'v0'}]);assert.ok(!row.needsEvidenceReview);
 markDependencies([part],[r,{...r,recordId:'B'}]);assert.ok(row.needsEvidenceReview);
});
