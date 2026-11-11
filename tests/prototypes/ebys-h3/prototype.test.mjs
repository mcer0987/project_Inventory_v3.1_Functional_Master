import { test,before,after,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { sdk,root,uuid,ref,financeRef,contextDb,actor,input,fx,seed,route } from './harness.mjs';
let env;const evidence=[];
const candidate=readFileSync('scratch/ebys-h3a-evidence/candidate.rules','utf8');
before(async()=>{
    if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8283')throw Error('Yalnız 8283 ayrı demo emülatörü kullanılabilir.');
    env=await initializeTestEnvironment({projectId:'demo-ebys-h3',firestore:{rules:candidate}});
});
beforeEach(async()=>seed(env));
after(async()=>{
    writeFileSync('scratch/ebys-h3a-evidence/measurements.json',JSON.stringify(evidence,null,2));
    const response=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/emulator/v1/projects/demo-ebys-h3:ruleCoverage');
    writeFileSync('scratch/ebys-h3a-evidence/coverage.json',await response.text());await env?.cleanup();
});
async function denied(promise){return assert.rejects(promise,error=>{
    assert.equal(error.code,'permission-denied');
    assert.doesNotMatch(error.message,/maximum of .*expressions|too many.*(?:access|call)|limit.*(?:exceed|reach)/i);
    return true;
});}
async function measure(label,a,command){a.reset();let outcome='success';try{return await command();}catch(error){outcome=error.code||error.message;throw error;}finally{evidence.push({label,outcome,...structuredClone(a.metrics),readCount:a.metrics.reads.length,writeCount:a.metrics.writes.length});}}
async function created(names=['a'],overrides={}){
    const owner=actor(env,'owner');const draft=await owner.save({...input(),...overrides});
    const frozen=await owner.freeze({documentId:draft.documentId,expectedRevision:draft.revision});
    await measure('start-'+names.length,owner,()=>owner.processes.startProcess({documentId:draft.documentId,versionId:frozen.versionId,route:route(names)}));
    return {owner,...draft,...frozen};
}
async function decide(id,who,revision,result='approved',extra={}){
    return actor(env,who).processes.decideTask({processId:id,expectedRevision:revision,result,reason:result==='approved'?'':'Gerekçeli işlem',fxPreview:fx,...extra});
}
test('H3 base kurallar yeni şemayı açmaz; aday aynı tabandan gelir',async()=>{
    const baseline=await initializeTestEnvironment({projectId:'demo-ebys-h3-base',firestore:{rules:readFileSync('firestore.rules','utf8')}});
    try{
        await seed(baseline);const payload={...input(),id:uuid(),operationId:uuid()};
        await denied(actor(baseline,'admin').save(payload));
        await actor(env,'admin').save(payload);
    }finally{await baseline.cleanup();}
});
test('H3 gerçek sahip, ortak birim, kayıt/dondurma ve küçük tarihsel künye',async()=>{
    const a=actor(env,'owner');const d=await measure('create',a,()=>a.save(input()));
    const registered=await a.documents.registerDocument({documentId:d.documentId,expectedRevision:d.revision});
    const v=await measure('freeze',a,()=>a.freeze({documentId:d.documentId,expectedRevision:registered.revision}));
    const version=(await sdk.getDoc(ref(a.db,'ebysVersions',v.versionId))).data();
    assert.equal(version.purchaseSnapshot.items.length,3);assert.equal(version.purchaseSnapshot.butce,120000);
    assert.equal(version.unitSnapshot.name,'Bilgi Teknolojileri');assert.equal(version.schemaVersion,2);
    await sdk.updateDoc(ref(contextDb(env,'admin'),'units','unit'),{name:'Yeni birim adı'});
    assert.equal((await sdk.getDoc(ref(a.db,'ebysVersions',v.versionId))).data().unitSnapshot.name,'Bilgi Teknolojileri');
    const pointer=(await sdk.getDoc(ref(a.db,'purchaseOrders',d.documentId))).data();assert.equal(pointer.birim,'Bilgi Teknolojileri');
    assert.equal(pointer.ebysDocumentId,d.documentId);assert.equal(Object.hasOwn(pointer,'items'),false);
});
test('H3 pasif/eksik/farklı kök birim; sahte ad ve başka owner bağları reddedilir',async()=>{
    const a=actor(env,'owner');
    await assert.rejects(a.save({...input(),unitId:'missing'}));
    await env.withSecurityRulesDisabled(async c=>{
        await sdk.setDoc(ref(c.firestore(),'units','foreign','lifeserver_master'),{id:'foreign',name:'Dış birim',active:true});
        await sdk.updateDoc(ref(c.firestore(),'units','unit'),{active:false});
    });
    await assert.rejects(a.save({...input(),unitId:'foreign'}));await assert.rejects(a.save(input()));
    await env.withSecurityRulesDisabled(c=>sdk.updateDoc(ref(c.firestore(),'units','unit'),{active:true}));
    await denied(actor(env,'owner',{transform:(p,d)=>p.path.includes('/purchaseOrders/')?{...d,birim:'Sahte ad'}:d}).save(input()));
    await denied(actor(env,'owner',{transform:(p,d)=>p.path.includes('/purchaseOrders/')?{...d,createdByUid:'stranger'}:d}).save(input()));
    await denied(actor(env,'owner',{transform:(p,d)=>p.path.includes('/ebysDocuments/')?{...d,purchaseOrderId:uuid()}:d}).save(input()));
});
test('H3 yarım bağ veya farklı yol ID atomik reddedilir; kayıt kalmaz',async()=>{
    for(const col of ['purchaseOrders','ebysDocuments']){
        const id=uuid();await denied(actor(env,'owner',{transform:(p,d)=>p.path.includes('/'+col+'/')?null:d}).save({...input(),id}));
        await env.withSecurityRulesDisabled(async c=>assert.equal((await sdk.getDoc(ref(c.firestore(),'purchaseOrders',id))).exists(),false));
    }
    await denied(actor(env,'owner',{transform:(p,d)=>p.path.includes('/purchaseOrders/')?{...d,id:'other'}:d}).save(input()));
});
test('H3 owner ve admin için eski overwrite/motor değişimi/silme kapalı',async()=>{
    const d=await actor(env,'owner').save(input());
    for(const who of ['owner','admin']){
        const db=contextDb(env,who),p=ref(db,'purchaseOrders',d.documentId);
        await denied(sdk.updateDoc(p,{engineVersion:'legacy'}));
        await denied(sdk.updateDoc(p,{engineVersion:sdk.deleteField()}));
        await denied(sdk.setDoc(p,{id:d.documentId,urun:'Eski istemci',workflow:{started:true}}));
        await denied(sdk.updateDoc(p,{workflow:{started:true,finished:true}}));await denied(sdk.deleteDoc(p));
    }
});
test('H3 tek adım ilk=son onay: finans + iş tek atomik işlem; yönetici içerik alamaz',async()=>{
    const d=await created();const a=actor(env,'a');
    await measure('first-and-final',a,()=>a.processes.decideTask({processId:d.versionId,expectedRevision:1,result:'approved',fxPreview:fx}));
    const f=(await sdk.getDoc(financeRef(a.db,d.documentId,d.versionId))).data();assert.equal(f.exchangeRate.USD,35);assert.equal(f.reportingTotalTRY,2317.23);
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysExecutionJobs',d.versionId))).data().state,'pending_acceptance');
    await denied(sdk.getDoc(financeRef(contextDb(env,'admin'),d.documentId,d.versionId)));
    await denied(sdk.getDoc(ref(contextDb(env,'admin'),'ebysVersions',d.versionId)));
    await denied(sdk.updateDoc(financeRef(a.db,d.documentId,d.versionId),{exchangeRate:{TRY:1,USD:99,EUR:99}}));
    await denied(sdk.getDocs(sdk.collection(a.db,root,'purchaseFinance','items',d.documentId,'versions')));
});
test('H3 altı adım; ilk/ara/son maliyet, gelecekteki görevli finansı okuyamaz',async()=>{
    const d=await created(['a','b','c','d','e','f']);
    for(const [i,who] of ['a','b','c','d','e','f'].entries()){
        const a=actor(env,who);await measure(i===0?'first-six':i===5?'last-six':'middle-six',a,()=>a.processes.decideTask({processId:d.versionId,expectedRevision:i+1,result:'approved',fxPreview:fx}));
        if(i===0)await denied(sdk.getDoc(financeRef(contextDb(env,'f'),d.documentId,d.versionId)));
    }
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysProcesses',d.versionId))).data().state,'completed');
});
test('H3 A-B-A-A; eski kararlar aynı görevde korunur',async()=>{
    const d=await created(['a','b','a','a']);for(const [i,who] of ['a','b','a','a'].entries())await decide(d.versionId,who,i+1);
    const t=(await sdk.getDoc(ref(contextDb(env,'a'),'ebysTasks',d.versionId+'__a'))).data();
    assert.deepEqual(Object.keys(t.decisionsByStep),['0','2','3']);
});
test('H3 finans/iş eksik, çapraz finans yolu, yanlış kur/digest tüm transactionı reddeder',async()=>{
    const d=await created();
    for(const mutate of [
        (p,v)=>p.path.includes('/versions/')?null:v,
        (p,v)=>p.path.includes('/ebysExecutionJobs/')?null:v,
        (p,v)=>p.path.includes('/versions/')?{...v,purchaseOrderId:uuid()}:v,
        (p,v)=>p.path.includes('/versions/')?{...v,contentDigest:'0'.repeat(64)}:v,
        (p,v)=>p.path.includes('/versions/')?{...v,exchangeRate:{TRY:1,USD:99,EUR:99}}:v
    ]){const a=actor(env,'a',{transform:mutate});await denied(measure('denied-first-and-final',a,()=>a.processes.decideTask({processId:d.versionId,expectedRevision:1,result:'approved',fxPreview:fx})));}
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysProcesses',d.versionId))).data().revision,1);
});
test('H3 onaydan önce kur değişirse yeni tutarı sessizce onaylamaz',async()=>{
    const d=await created();await sdk.setDoc(ref(contextDb(env,'admin'),'system_config','ebys_rates'),{...fx,rates:{TRY:1,USD:36,EUR:41}});
    await assert.rejects(decide(d.versionId,'a',1),/Kur değişti/);
    await denied(actor(env,'a',{transform:(p,v)=>p.path.includes('/versions/')?{...v,exchangeRate:fx.rates}:v}).processes.decideTask({processId:d.versionId,expectedRevision:1,result:'approved',fxPreview:{...fx,rates:{TRY:1,USD:36,EUR:41}}}));
});
test('H3 TRY yalnız kur ayarı istemez; red/iade finans üretmez',async()=>{
    await env.withSecurityRulesDisabled(c=>sdk.deleteDoc(ref(c.firestore(),'system_config','ebys_rates')));
    const d=await created(['a'],{items:input().items.map(x=>({...x,currency:'TRY'}))});await decide(d.versionId,'a',1);
    assert.equal((await sdk.getDoc(financeRef(d.owner.db,d.documentId,d.versionId))).data().exchangeRateSource,'TRY');
    for(const result of ['returned','rejected']){
        const x=await created();await decide(x.versionId,'a',1,result);
        assert.equal((await sdk.getDoc(financeRef(x.owner.db,x.documentId,x.versionId))).exists(),false);
    }
});
test('H3 iade yeni sürüm: ilk mali kayıt sabit; eski imzacı V2 fiyatını alamaz',async()=>{
    const d=await created(['a','b']);await decide(d.versionId,'a',1);await decide(d.versionId,'b',2,'returned');
    const f1=(await sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,d.versionId))).data();
    const head=(await sdk.getDoc(ref(d.owner.db,'ebysDocuments',d.documentId))).data();
    const draft=await d.owner.save({...input(),id:d.documentId,expectedRevision:head.revision,reopen:true,content:'YENİ METİN B'});
    const v2=await d.owner.freeze({documentId:d.documentId,expectedRevision:draft.revision});
    await d.owner.processes.startProcess({documentId:d.documentId,versionId:v2.versionId,route:route(['b'])});
    await denied(sdk.getDoc(ref(contextDb(env,'a'),'ebysVersions',v2.versionId)));
    await denied(sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,v2.versionId)));
    const newFx={...fx,rates:{TRY:1,USD:37,EUR:42}};await sdk.setDoc(ref(contextDb(env,'admin'),'system_config','ebys_rates'),newFx);
    await decide(v2.versionId,'b',1,'approved',{fxPreview:newFx});
    assert.deepEqual((await sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,d.versionId))).data(),f1);
    await denied(sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,v2.versionId)));
});
test('H3 vekil ilk karar ve finans aktörüdür; asıl görevli sırası olmadan okuyamaz',async()=>{
    const d=await created();await actor(env,'admin').processes.delegateTask({processId:d.versionId,expectedRevision:1,personnelId:'b',validUntil:new Date(Date.now()+3600000).toISOString(),reason:'İzin'});
    await decide(d.versionId,'b',2);
    assert.equal((await sdk.getDoc(financeRef(contextDb(env,'b'),d.documentId,d.versionId))).data().actorUid,'b');
    await denied(sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,d.versionId)));
});
test('H3 aynı operationId iki paralel karar tek sonuç; farklı payload aynı başarıyı alamaz',async()=>{
    const d=await created();const operationId=uuid(),payload={processId:d.versionId,expectedRevision:1,result:'approved',fxPreview:fx,operationId};
    const [one,two]=await Promise.all([actor(env,'a').processes.decideTask(payload),actor(env,'a').processes.decideTask(payload)]);
    assert.deepEqual(JSON.parse(JSON.stringify(one)),JSON.parse(JSON.stringify(two)));
    const a=actor(env,'a');await measure('decision-replay',a,()=>a.processes.decideTask(payload));assert.equal(a.metrics.writes.length,0);
    await assert.rejects(a.processes.decideTask({...payload,reason:'Başka payload'}),/farklı içerik/);
});
test('H3 aynı taslak iki çağrı tek bağ; stale revizyon ve dondurma yarışı güvenli',async()=>{
    const id=uuid(),operationId=uuid(),payload={...input(),id,operationId};
    const [a,b]=await Promise.all([actor(env,'owner').save(payload),actor(env,'owner').save(payload)]);assert.deepEqual(a,b);
    const repeated=actor(env,'owner');await measure('save-replay',repeated,()=>repeated.save(payload));
    const owner=actor(env,'owner');const results=await Promise.allSettled([owner.freeze({documentId:id,expectedRevision:1}),actor(env,'owner').save({...input(),id,expectedRevision:1,content:'Değişti'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    await assert.rejects(owner.save({...input(),id,expectedRevision:1}),/revizyon|Dondurulmuş/);
});
test('H3 havale yok/pasif sorumlu son onayı atomik durdurur',async()=>{
    const d=await created();await env.withSecurityRulesDisabled(c=>sdk.deleteDoc(ref(c.firestore(),'ebysExecutionPolicies','internal__unit')));
    await assert.rejects(decide(d.versionId,'a',1),/havale|Havale/);
    await env.withSecurityRulesDisabled(async c=>{
        await sdk.setDoc(ref(c.firestore(),'ebysExecutionPolicies','internal__unit'),{kind:'internal',sourceUnitId:'unit',unitId:'unit',personnelId:'worker',assigneeUid:'worker',dueHours:72});
        await sdk.updateDoc(ref(c.firestore(),'personel','worker'),{active:false});
    });
    await assert.rejects(decide(d.versionId,'a',1));
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysProcesses',d.versionId))).data().revision,1);
});
test('H3 icra kabul/iade/havale; sahte stok ve bildirimsiz kapanış reddi',async()=>{
    const d=await created();await decide(d.versionId,'a',1);const w=actor(env,'worker');
    await w.execution.acceptExecutionJob(d.versionId,1);
    await sdk.getDoc(financeRef(w.db,d.documentId,d.versionId));
    await w.execution.returnExecutionJob(d.versionId,2,'Başka birime teslim');
    await denied(sdk.getDoc(financeRef(w.db,d.documentId,d.versionId)));
    await actor(env,'admin').execution.reassignExecutionJob(d.versionId,3,{unitId:'unit',personnelId:'b',dueHours:24,note:'Sorumlu değişti'});
    const b=actor(env,'b');await b.execution.acceptExecutionJob(d.versionId,4);
    await denied(b.execution.completeExecutionJob(d.versionId,5,{note:'Teslim',evidenceRef:'Tutanak',stockOperationId:'SAHTE-STOK-001'}));
    await denied(actor(env,'b',{transform:(p,v)=>p.path.includes('/ebysNotifications/')?null:v}).execution.completeExecutionJob(d.versionId,5,{note:'Teslim',evidenceRef:'Tutanak'}));
    await measure('execution-complete',b,()=>b.execution.completeExecutionJob(d.versionId,5,{note:'Teslim',evidenceRef:'Tutanak'}));
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysDocuments',d.documentId))).data().state,'closed');
});
test('H3 taslak atlatma, sahte künye/sürüm ve bağımsız finans yazımı reddedilir',async()=>{
    for(const proposal of [p=>{delete p.items;return p;},p=>({...p,documentTypeCode:'OTHER'}),p=>({...p,items:[]})]){
        await denied(actor(env,'owner',{transform:(r,d)=>r.path.includes('/ebysDrafts/')?{...d,purchaseSnapshot:proposal(d.purchaseSnapshot)}:d}).save(input()));
    }
    const o=actor(env,'owner'),d=await o.save(input());
    await denied(sdk.updateDoc(ref(o.db,'ebysDrafts',d.documentId),{purchaseSnapshot:{purchaseOrderId:d.documentId},updatedAt:sdk.serverTimestamp()}));
    for(const mutate of [
        v=>({...v,unitSnapshot:{...v.unitSnapshot,name:'Başka kurum'}}),
        v=>({...v,purchaseSnapshot:{...v.purchaseSnapshot,butce:1}})
    ])await denied(actor(env,'owner',{transform:(r,v)=>r.path.includes('/ebysVersions/')?mutate(v):v}).freeze({documentId:d.documentId,expectedRevision:d.revision}));
    const v=await o.freeze({documentId:d.documentId,expectedRevision:d.revision});
    await o.processes.startProcess({documentId:d.documentId,versionId:v.versionId,route:route(['a'])});
    await denied(sdk.setDoc(financeRef(contextDb(env,'a'),d.documentId,v.versionId),{schemaVersion:2,purchaseOrderId:d.documentId,versionId:v.versionId,actorUid:'a',createdAt:sdk.serverTimestamp()}));
    await denied(actor(env,'a',{r:'lifeserver_master'}).processes.decideTask({processId:v.versionId,expectedRevision:1,result:'approved',fxPreview:fx}));
});
test('H3 geri çekme mali geçmişi korur; yeni görev ve icra üretmez',async()=>{
    const d=await created(['a','b']);await decide(d.versionId,'a',1);
    await d.owner.processes.withdrawProcess({processId:d.versionId,expectedRevision:2,reason:'Talep yeniden hazırlanacak'});
    assert.equal((await sdk.getDoc(ref(d.owner.db,'ebysProcesses',d.versionId))).data().state,'withdrawn');
    await sdk.getDoc(financeRef(contextDb(env,'a'),d.documentId,d.versionId));
    await denied(sdk.getDoc(financeRef(contextDb(env,'b'),d.documentId,d.versionId)));
    await env.withSecurityRulesDisabled(async c=>assert.equal((await sdk.getDoc(ref(c.firestore(),'ebysExecutionJobs',d.versionId))).exists(),false));
});
