import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
sdk.setLogLevel('silent');
let env, db, api, schema;
const root='inventory_demo', owner='author';
const ref=(col,id,store=db)=>sdk.doc(store,root,col,'items',id);
const input=()=>({id:webcrypto.randomUUID(),operationId:webcrypto.randomUUID(),kind:'incoming',unitId:'unit',organizationCode:'MED',expectedRevision:0,
    content:'Gereğinin yapılmasını rica ederim.',metadata:{subject:'Üst yazı',correspondent:'Kurum A',date:'2026-11-02',filePlanCode:'934',confidentiality:'Normal',distribution:'Birim A',externalRegistrationNo:'D-1'}});
function plain(v) { if(Array.isArray(v)) return Array.from(v,plain); if(v && v.constructor?.name==='Object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])); return v; }
function service(store=db, uid=owner, transform=v=>v) {
    const window={AppModules:{},AppEnv:{COLLECTION_ROOT:root},userAuth:{uid},isDbAdmin:()=>true};
    const context=vm.createContext({window,crypto:webcrypto,TextEncoder,console,fireDb:store,...sdk,
        runTransaction:(d,fn)=>sdk.runTransaction(d,tx=>fn({get:r=>tx.get(r),set:(r,v)=>tx.set(r,plain(transform(v)))}))});
    vm.runInContext(readFileSync('src/utils/ebys-document-schema.js','utf8'),context);
    const code=readFileSync('src/services/ebys-document-service.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
    vm.runInContext(code,context); return {api:window.AppModules.EBYSDocuments,schema:window.AppModules.EBYSDocumentSchema};
}
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-ebys-documents',firestore:{rules:readFileSync('firestore.rules','utf8')}});db=env.authenticatedContext(owner,{email:'admin@medipol.local',firebase:{sign_in_provider:'password'}}).firestore();});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{await sdk.setDoc(ref('units','unit',c.firestore()),{id:'unit',name:'Test',active:true});});({api,schema}=service());});
test('gerçek servis: taslak, kesin kayıt, dondurma; tekrar aynı sonucu döndürür ve geçmiş değişmez',async()=>{
    const data=input(), saved=await api.saveDraft(data);
    assert.deepEqual(plain(await api.saveDraft(data)),plain(saved));
    const regArgs={documentId:data.id,expectedRevision:saved.revision,operationId:webcrypto.randomUUID()};
    const registered=await api.registerDocument(regArgs);assert.match(registered.registrationNo,/^EBYS-MED-\d{6}-[A-F0-9]{32}$/);
    assert.deepEqual(plain(await api.registerDocument(regArgs)),plain(registered));
    const args={documentId:data.id,expectedRevision:registered.revision,operationId:webcrypto.randomUUID()};
    const frozen=await api.freezeVersion(args);assert.deepEqual(plain(await api.freezeVersion(args)),plain(frozen));
    const version=(await sdk.getDoc(ref('ebysVersions',frozen.versionId))).data();
    assert.equal(version.content,data.content);assert.equal(version.processId,frozen.versionId);
    assert.equal(version.contentDigest,await schema.digest({content:data.content,metadata:data.metadata,attachments:[]}));
    await assertFails(sdk.updateDoc(ref('ebysVersions',frozen.versionId),{content:'Değiştir'}));
    await assertFails(sdk.deleteDoc(ref('ebysVersions',frozen.versionId)));
    await assertFails(sdk.updateDoc(ref('ebysDrafts',data.id),{content:'Gizli değişiklik',updatedAt:sdk.serverTimestamp()}));
    await assertFails(sdk.updateDoc(ref('ebysRegistrationIds',registered.registrationNo),{documentId:webcrypto.randomUUID()}));
    await assertFails(sdk.deleteDoc(ref('ebysRegistrationIds',registered.registrationNo)));
    await assert.rejects(api.saveDraft({...data,operationId:webcrypto.randomUUID(),expectedRevision:frozen.revision}),/Dondurulan/);
    assert.equal((await sdk.getDocs(sdk.query(sdk.collection(db,root,'ebysOperations','items'),sdk.where('ownerUid','==',owner)))).size,3);
    const backup=await api.exportOwnDocuments();assert.equal(backup.data.ebysDocuments.length,1);assert.equal(backup.data.ebysVersions.length,1);assert.equal(backup.data.ebysEvents.length,3);
    assert.deepEqual(plain(await api.countDocuments()),{total:1,draft:0,registered:0,in_review:1});
});
test('dondurulmuş evraka sonradan numara alınır; sürüm içeriği değişmez',async()=>{
    const data=input();const a=await api.saveDraft(data);const b=await api.freezeVersion({documentId:data.id,expectedRevision:a.revision});
    const before=(await sdk.getDoc(ref('ebysVersions',b.versionId))).data();
    await api.registerDocument({documentId:data.id,expectedRevision:b.revision});
    assert.deepEqual((await sdk.getDoc(ref('ebysVersions',b.versionId))).data(),before);
});
test('başka yazar ve anonim içerik okuyamaz; admin başlık listesi içerik yetkisi vermez',async()=>{
    const data=input();const a=await api.saveDraft(data);const b=await api.freezeVersion({documentId:data.id,expectedRevision:a.revision});
    const other=env.authenticatedContext('other',{email:'admin@medipol.local',firebase:{sign_in_provider:'password'}}).firestore();
    await assertSucceeds(sdk.getDoc(ref('ebysDocuments',data.id,other)));
    for(const colId of [['ebysDrafts',data.id],['ebysVersions',b.versionId]]){await assertFails(sdk.getDoc(ref(...colId,other)));await assertFails(sdk.getDoc(ref(...colId,env.unauthenticatedContext().firestore())));}
    await assertFails(sdk.updateDoc(ref('ebysDocuments',data.id,other),{ownerUid:'other'}));
    await assertFails(sdk.getDocs(sdk.collection(other,root,'ebysVersions','items')));
});
test('bağımsız sahte kayıt/sürüm/günlük yazması ve revisionsuz taslak değişikliği reddedilir',async()=>{
    const data=input();await api.saveDraft(data);
    await assertFails(sdk.updateDoc(ref('ebysDrafts',data.id),{content:'İzinsiz yan yazma',updatedAt:sdk.serverTimestamp()}));
    await assertFails(sdk.updateDoc(ref('ebysDocuments',data.id),{state:'internally_approved',revision:2,updatedAt:sdk.serverTimestamp()}));
    await assertFails(sdk.setDoc(ref('ebysVersions',webcrypto.randomUUID()),{documentId:data.id,ownerUid:owner}));
    await assertFails(sdk.setDoc(ref('ebysRegistrationIds',schema.registrationNo('MED')),{documentId:data.id,ownerUid:owner,createdAt:sdk.serverTimestamp()}));
    await assertFails(sdk.setDoc(ref('ebysEvents',webcrypto.randomUUID()),{documentId:data.id,ownerUid:owner,createdAt:sdk.serverTimestamp()}));
    await assert.rejects(api.saveDraft({...data,operationId:webcrypto.randomUUID(),expectedRevision:0}),/değişti/);
    await assert.rejects(api.saveDraft({...data,content:'Farklı'}),/farklı içerikle/);
});
test('numara çakışması yeniden denenir; başka evrakın rezervasyonu ezilmez',async()=>{
    const a=input(), b=input();await api.saveDraft(a);await api.saveDraft(b);
    const first=await api.registerDocument({documentId:a.id,expectedRevision:1});
    const original=schema.registrationNo;let calls=0;
    // Şema dondurulduğundan testte yalnız üretici adaptörü değişir; gerçek servis transactionı korunur.
    const ctxService=service();const alternate={...ctxService.schema,registrationNo:code=>++calls===1?first.registrationNo:original(code)};
    // Servisin schema sağlayıcısı aynı window referansını okur; aşağıdaki ayrı VM fixture ile çakışmayı enjekte ederiz.
    const window={AppModules:{EBYSDocumentSchema:alternate},AppEnv:{COLLECTION_ROOT:root},userAuth:{uid:owner},isDbAdmin:()=>true};
    const c=vm.createContext({window,fireDb:db,console,...sdk,runTransaction:(d,fn)=>sdk.runTransaction(d,tx=>fn({get:r=>tx.get(r),set:(r,v)=>tx.set(r,plain(v))}))});
    vm.runInContext(readFileSync('src/services/ebys-document-service.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),c);
    const second=await window.AppModules.EBYSDocuments.registerDocument({documentId:b.id,expectedRevision:1});
    assert.notEqual(first.registrationNo,second.registrationNo);assert.equal(calls,2);
    assert.equal((await sdk.getDoc(ref('ebysRegistrationIds',first.registrationNo))).data().documentId,a.id);
});
test('taslaktan farklı içerikle sürüm üretilemez; başarısız dondurma atomik kalır',async()=>{
    const data=input();await api.saveDraft(data);
    const forged=service(db,owner,v=>v.schemaVersion?{...v,content:'Sonradan değiştirilen içerik'}:v).api;
    await assert.rejects(forged.freezeVersion({documentId:data.id,expectedRevision:1}));
    assert.equal((await sdk.getDoc(ref('ebysDocuments',data.id))).data().state,'draft');
    const normal=await api.freezeVersion({documentId:data.id,expectedRevision:1});
    assert.equal((await sdk.getDoc(ref('ebysVersions',normal.versionId))).data().content,data.content);
});
test('bağlı personel kendi taslağını kaydeder; başka kişinin içeriği, sahte yetki ve pasif birim reddedilir',async()=>{
    await env.withSecurityRulesDisabled(async c=>{
        const raw=c.firestore();await sdk.setDoc(ref('personel','p',raw),{id:'p',name:'Yazar',pri:'yazar.test',uid:'staff'});
        await sdk.setDoc(ref('staffAccounts','staff',raw),{personelId:'p',pri:'yazar.test'});
        await sdk.setDoc(ref('accessGate','staff',raw),{staffAccessEnabled:true});
    });
    const store=env.authenticatedContext('staff',{email:'yazar.test@staff.medipol.local',firebase:{sign_in_provider:'password'}}).firestore();
    const staffApi=service(store,'staff').api, data=input();await staffApi.saveDraft(data);
    await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(store,root,'ebysDrafts','items'),sdk.where('ownerUid','==','staff'))));
    await assertFails(sdk.getDoc(ref('ebysDrafts',data.id)));
    const frozen=await staffApi.freezeVersion({documentId:data.id,expectedRevision:1});
    await assertSucceeds(sdk.getDoc(ref('ebysVersions',frozen.versionId,store)));
    await assertFails(sdk.setDoc(ref('ebysTasks',`${frozen.versionId}__author`,store),{assigneeUid:owner,hasDecision:true}));
    await sdk.updateDoc(ref('units','unit'),{active:false});
    await assert.rejects(staffApi.saveDraft(input()),/Aktif bir birim/);
});
