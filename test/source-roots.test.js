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
