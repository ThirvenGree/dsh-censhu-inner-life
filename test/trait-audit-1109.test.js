import test from 'node:test';import assert from 'node:assert/strict';
import {validateTraitAudit,auditableTrait,traitAuditPrompt} from '../lib/personality.js';
// 2026-11-09: traits are audited one descriptor at a time; the burden of proof is on the contradiction.
const DAY=86400000,NOW=Date.parse('2026-11-09T12:00:00+08:00');
const item=(id,extra={})=>({id,text:'原描述'+id,status:'established',expiresAt:NOW+40.5*DAY,...extra});
const evidence=[{id:'e1',origin:'memory'},{id:'e2',origin:'subjective-diary'},{id:'e3',origin:'self-proposal'}];
const verdict=(id,extra={})=>({id,descriptor:'慢热',verdict:'partially_outdated',contradictingEvidenceIds:['e1','e2'],revisedText:'新描述',reason:'r',...extra});
const run=(verdicts,items=[item('a'),item('b'),item('c')],nextDays=30)=>validateTraitAudit({verdicts,reason:'ok',nextDays},items,evidence,NOW);
test('an outdated descriptor becomes an ordinary candidate that keeps status and remaining life',()=>{
 const {changes,nextDays}=run([verdict('a')]);assert.equal(nextDays,30);assert.deepEqual(changes,[{id:'a',operation:'upsert',text:'新描述',reason:'r',status:'established',evidenceIds:['e1','e2'],validDays:41,reviewDays:30}]);
});
test('two independent contradictions are required; a self-proposal does not count',()=>{
 assert.equal(run([verdict('a',{contradictingEvidenceIds:['e1']})]).changes.length,0);assert.equal(run([verdict('a',{contradictingEvidenceIds:['e1','e3']})]).changes.length,0);assert.equal(run([verdict('a',{contradictingEvidenceIds:['e1','e1']})]).changes.length,0);assert.equal(run([verdict('a',{contradictingEvidenceIds:['e1','nope']})]).changes.length,0);
});
test('a clearly outdated trait with no replacement is withdrawn; a partial one must say what it becomes',()=>{
 assert.equal(run([verdict('a',{verdict:'clearly_outdated',revisedText:''})]).changes[0].operation,'remove');assert.equal(run([verdict('a',{revisedText:''})]).changes.length,0);assert.equal(run([verdict('a',{revisedText:'x'.repeat(241)})]).changes.length,0);
});
test('accurate traits stay, unknown ones are ignored, and at most two change at once',()=>{
 assert.equal(run([verdict('a',{verdict:'still_accurate'})]).changes.length,0);assert.equal(run([verdict('zzz')]).changes.length,0);assert.equal(run([verdict('a'),verdict('a')]).changes.length,1);assert.equal(run([verdict('a'),verdict('b'),verdict('c')]).changes.length,2);
});
test('only traits in effect are audited and the next look stays in range',()=>{
 assert.equal(auditableTrait(item('a',{status:'observing'})),false);assert.equal(auditableTrait(item('a',{needsEvidenceReview:true})),false);assert.equal(auditableTrait(item('a')),true);assert.equal(run([],undefined,1).nextDays,7);assert.equal(run([],undefined,500).nextDays,90);assert.throws(()=>validateTraitAudit({},[],[],NOW),/格式/);assert.match(traitAuditPrompt,/举证责任在矛盾的一方/);
});
