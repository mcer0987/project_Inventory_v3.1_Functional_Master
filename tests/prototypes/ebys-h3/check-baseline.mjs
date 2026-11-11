import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const rows=JSON.parse(readFileSync('scratch/ebys-h3a-evidence/baseline-hashes.json','utf8').replace(/^\uFEFF/,''));
const changed=[];
for(const row of rows){const actual=createHash('sha256').update(readFileSync(row.path)).digest('hex');if(actual!==row.sha256)changed.push({path:row.path,expected:row.sha256,actual});}
const result={checked:rows.length,changed,passed:changed.length===0};
writeFileSync('scratch/ebys-h3a-evidence/baseline-verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
