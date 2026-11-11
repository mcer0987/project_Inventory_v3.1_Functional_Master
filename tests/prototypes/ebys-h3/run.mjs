import {spawnSync} from 'node:child_process';
import {openSync,closeSync,copyFileSync,writeFileSync} from 'node:fs';
import {buildRules} from './build-rules.mjs';
if(!/^127\.0\.0\.1:8283$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Yalnız ayrı 8283 demo emülatöründe çalışır.');
buildRules();const results=[];
for(const [label,args] of [
    ['prototype-final',['--test','--test-reporter=spec','tests/prototypes/ebys-h3/prototype.test.mjs','tests/prototypes/ebys-h3/legacy-units.test.mjs']],
    ['candidate-regression',['--import','./tests/prototypes/ebys-h3/candidate-loader.mjs','--test','--test-reporter=spec','tests/rules/*.test.mjs']]
]) {
    const file='scratch/ebys-h3a-evidence/'+label+'.log',fd=openSync(file,'w');
    const out=spawnSync(process.execPath,args,{stdio:['ignore',fd,fd],env:process.env});closeSync(fd);
    results.push({label,exitCode:out.status,error:out.error?.message??null});console.log(label,JSON.stringify(results.at(-1)));
    copyFileSync('firestore-debug.log','scratch/ebys-h3a-evidence/'+label+'-emulator.log');
    writeFileSync('scratch/ebys-h3a-evidence/run-results.json',JSON.stringify(results,null,2));
    if(out.status!==0)process.exit(out.status||1);
}
