import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUnits,demo } from './legacy-units.mjs';
test('legacy eşleme: dokuz sınıf, belge yolu otoritesi, sıfır mutasyon',()=>{
    const before=JSON.stringify(demo),rows=analyzeUnits(demo);
    assert.deepEqual(rows.map(x=>x.classification),['already_identified','unique_candidate','ambiguous','inactive_candidate','unmatched','missing_id','already_identified','different_root','inactive_id']);
    assert.equal(rows[0].candidates[0].unitId,'bt');assert.equal(rows[0].storedId,1);
    assert.equal(rows[2].candidates.length,2);assert.equal(rows[6].candidates[0].unitId,'42');
    assert.equal(rows.every(r=>r.automaticWrite===false),true);assert.equal(JSON.stringify(demo),before);
});
