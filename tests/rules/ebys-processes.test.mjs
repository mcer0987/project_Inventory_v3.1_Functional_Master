import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
sdk.setLogLevel('silent');let env,id;const root='inventory_demo';
const ref=(db,c,key)=>sdk.doc(db,root,c,'items',key);
const ctx=uid=>env.authenticatedContext(uid,{email:uid==='owner'?'admin@medipol.local':`${uid}.test@staff.medipol.local`,firebase:{sign_in_provider:'password'}}).firestore();
const plain=v=>Array.isArray(v)?Array.from(v,plain):v&&v.constructor?.name==='Object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])):v;
function api(uid, transform=(r,v)=>v){const window={userAuth:{uid},AppEnv:{COLLECTION_ROOT:root},AppModules:{},isDbAdmin:()=>uid==='owner'};const c=vm.createContext({window,console,TextEncoder,crypto:webcrypto,fireDb:ctx(uid),...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,t=>fn({get:r=>t.get(r),set:(r,v)=>{const next=transform(r,v);if(next)t.set(r,plain(next));}}))});for(const p of ['src/utils/ebys-document-schema.js','src/utils/ebys-process-schema.js','src/services/ebys-document-service.js','src/services/ebys-process-service.js'])vm.runInContext('{'+readFileSync(p,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'}',c);return {...window.AppModules.EBYSProcesses,documents:window.AppModules.EBYSDocuments};}
const start=async(route=['a','b','a'])=>api('owner').startProcess({documentId:'doc',versionId:id,route:route.map(personnelId=>({personnelId,kind:'approval',dueHours:72})),operationId:webcrypto.randomUUID()});
const decide=(uid,revision,result='approved',reason='')=>api(uid).decideTask({processId:id,expectedRevision:revision,result,reason,operationId:webcrypto.randomUUID()});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-ebys-processes',firestore:{rules:readFileSync('firestore.rules','utf8')}})});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();id=webcrypto.randomUUID();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await sdk.setDoc(ref(db,'ebysDocuments','doc'),{id:'doc',ownerUid:'owner',currentVersionId:id,state:'in_review',revision:2,versionNo:1});await sdk.setDoc(ref(db,'ebysVersions',id),{id,documentId:'doc',ownerUid:'owner',content:'Sabit sürüm'});await sdk.setDoc(ref(db,'accessGate','staff'),{staffAccessEnabled:true});for(const who of ['a','b','c']){await sdk.setDoc(ref(db,'personel',who),{id:who,uid:who,name:who,pri:`${who}.test`,active:true});await sdk.setDoc(ref(db,'staffAccounts',who),{personelId:who,pri:`${who}.test`});}})});
test('sıralı süreçte yalnız aktif görev okunur, aynı kişinin iki kararı korunur',async()=>{await start();await assertSucceeds(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));await assertFails(sdk.getDoc(ref(ctx('b'),'ebysVersions',id)));assert.equal((await sdk.getDoc(ref(ctx('owner'),'ebysTasks',`${id}__b`))).exists(),false);await decide('a',1);await assertSucceeds(sdk.getDoc(ref(ctx('b'),'ebysVersions',id)));await assertSucceeds(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));await decide('b',2);await decide('a',3);const t=(await sdk.getDoc(ref(ctx('a'),'ebysTasks',`${id}__a`))).data();assert.deepEqual(Object.keys(t.decisionsByStep),['0','2']);assert.equal((await api('owner').getProcess(id)).state,'completed');});
test('gerekçeli iade içerik erişimini kapatır; geri çekme karar üretmez',async()=>{await start(['a']);await assert.rejects(decide('a',1,'returned',''),/gerekçe/);await decide('a',1,'returned','Düzeltme gerekli');await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));assert.equal((await api('owner').getProcess(id)).state,'returned');});
test('yazar aktif süreci geri çeker, bekleyen görev ve erişim kapanır',async()=>{await start(['a']);await api('owner').withdrawProcess({processId:id,expectedRevision:1,reason:'Geri al',operationId:webcrypto.randomUUID()});await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));assert.equal((await sdk.getDoc(ref(ctx('a'),'ebysTasks',`${id}__a`))).data().hasDecision,false);});
test('vekâlet tek atama üzerinden çalışır; gerçek aktör ve temsil edilen kişi ayrıdır',async()=>{await start(['a']);await api('owner').delegateTask({processId:id,expectedRevision:1,personnelId:'c',reason:'İzin vekâleti',validUntil:new Date(Date.now()+86400000).toISOString(),operationId:webcrypto.randomUUID()});await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));await assertSucceeds(sdk.getDoc(ref(ctx('c'),'ebysVersions',id)));await decide('c',2);const t=(await sdk.getDoc(ref(ctx('c'),'ebysTasks',`${id}__c`))).data();assert.equal(t.decisionsByStep['0'].principalUid,'a');assert.equal(t.decisionsByStep['0'].actorUid,'c');});
test('süresi dolmuş vekil okuyamaz/karar veremez; personel kendisine vekâlet tanımlayamaz',async()=>{await start(['a']);await assert.rejects(api('a').delegateTask({}),/yönetici/);await env.withSecurityRulesDisabled(c=>sdk.updateDoc(ref(c.firestore(),'ebysTasks',`${id}__a`),{validUntil:sdk.Timestamp.fromMillis(1)}));await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));await assert.rejects(decide('a',1));});
test('sahte geçmiş/görev, süreç atlama ve kararı olaydan ayırma reddedilir',async()=>{await start(['a','b']);await assertFails(sdk.setDoc(ref(ctx('b'),'ebysTasks',`${id}__b`),{assigneeUid:'b',processId:id,hasDecision:true}));await assertFails(sdk.updateDoc(ref(ctx('a'),'ebysTasks',`${id}__a`),{hasDecision:true,decisionsByStep:{0:{result:'approved'}}}));await assertFails(sdk.updateDoc(ref(ctx('a'),'ebysProcesses',id),{currentStep:1,activeAssigneeUid:'b',revision:2,updatedAt:sdk.serverTimestamp()}));await decide('a',1);await assertFails(sdk.updateDoc(ref(ctx('a'),'ebysTasks',`${id}__a`),{'decisionsByStep.0.reason':'Sahte'}));});
test('aynı operationId ile çift karar tek sonuçtur; bayat revizyon reddedilir',async()=>{await start(['a','b']);const input={processId:id,expectedRevision:1,result:'approved',reason:'',operationId:webcrypto.randomUUID()};const [a,b]=await Promise.all([api('a').decideTask(input),api('a').decideTask(input)]);assert.deepEqual(plain(a),plain(b));await assert.rejects(decide('a',1));assert.equal((await api('owner').getProcess(id)).revision,2);});

test('altı adımlı rota ve aynı kişiye ardışık görev, bütçe içinde tek revizyonla ilerler',async()=>{
 await start(['a','a','b','c','a','c']);for(const [i,uid] of ['a','a','b','c','a','c'].entries())await decide(uid,i+1);
 const p=await api('owner').getProcess(id);assert.equal(p.state,'completed');const head=(await sdk.getDoc(ref(ctx('owner'),'ebysDocuments','doc'))).data();assert.equal(head.state,'internally_approved');
 const t=(await sdk.getDoc(ref(ctx('a'),'ebysTasks',id+'__a'))).data();assert.deepEqual(Object.keys(t.decisionsByStep),['0','1','4']);
});
test('red sonrası gerçek yeni sürüm eski kararı/metni korur, yeni sürüme geçmiş yetki taşınmaz',async()=>{
 const own=api('owner'),documentId=webcrypto.randomUUID();await env.withSecurityRulesDisabled(c=>sdk.setDoc(ref(c.firestore(),'units','unit'),{id:'unit',name:'Test',active:true}));
 const value={id:documentId,expectedRevision:0,kind:'internal',unitId:'unit',organizationCode:'MED',content:'İlk metin',metadata:{subject:'Test',correspondent:'Kurum',date:'2026-11-03',filePlanCode:'934',confidentiality:'Normal',distribution:'',externalRegistrationNo:''}};
 await own.documents.saveDraft(value);const first=await own.documents.freezeVersion({documentId,expectedRevision:1});id=first.versionId;
 await own.startProcess({documentId,versionId:id,route:[{personnelId:'a',kind:'paraf',dueHours:72}]});await decide('a',1,'rejected','Düzeltme gerekli');
 const old=(await sdk.getDoc(ref(ctx('owner'),'ebysVersions',id))).data();const head=(await own.documents.readDocument(documentId)).head;
 const reopen={documentId,expectedRevision:head.revision,operationId:webcrypto.randomUUID()};await own.documents.reopenDraft(reopen);await own.documents.reopenDraft(reopen);const reopened=(await own.documents.readDocument(documentId)).head;
 await own.documents.saveDraft({...value,expectedRevision:reopened.revision,content:'Düzeltilmiş metin'});const changed=(await own.documents.readDocument(documentId)).head;
 const next=await own.documents.freezeVersion({documentId,expectedRevision:changed.revision});assert.notEqual(next.versionId,id);
 assert.deepEqual((await sdk.getDoc(ref(ctx('owner'),'ebysVersions',id))).data(),old);await assertSucceeds(sdk.getDoc(ref(ctx('a'),'ebysVersions',id)));await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',next.versionId)));
 assert.equal((await sdk.getDoc(ref(ctx('owner'),'ebysVersions',next.versionId))).data().versionNo,2);
 await own.startProcess({documentId,versionId:next.versionId,route:[{personnelId:'b',kind:'consent',dueHours:72}]});await assertSucceeds(sdk.getDoc(ref(ctx('b'),'ebysVersions',next.versionId)));await assertFails(sdk.getDoc(ref(ctx('a'),'ebysVersions',next.versionId)));
});
test('kişisel sorgular UID ile sınırlıdır; geniş görev/içerik sorgusu ve başka kök reddedilir',async()=>{
 await start(['a','b']);await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(ctx('a'),root,'ebysTasks','items'),sdk.where('assigneeUid','==','a'),sdk.orderBy('updatedAt','desc'),sdk.limit(50))));
 await assertFails(sdk.getDocs(sdk.collection(ctx('a'),root,'ebysTasks','items')));await assertFails(sdk.getDocs(sdk.collection(ctx('a'),root,'ebysVersions','items')));
 await assertFails(sdk.getDoc(sdk.doc(ctx('a'),'inventory_prod','ebysVersions','items',id)));
 await assertFails(sdk.updateDoc(ref(ctx('owner'),'ebysProcesses',id),{routeSnapshot:[{assigneeUid:'c'}]}));
});
test('pasif veya UID bağı olmayan kişi ilk/yeni görevi alamaz, operation anahtarı içerik değiştiremez',async()=>{
 await env.withSecurityRulesDisabled(c=>sdk.updateDoc(ref(c.firestore(),'personel','b'),{active:false}));await assert.rejects(start(['b']),/Pasif/);await start(['a']);
 const input={processId:id,expectedRevision:1,result:'approved',reason:'',operationId:webcrypto.randomUUID()};await api('a').decideTask(input);await assert.rejects(api('a').decideTask({...input,result:'rejected',reason:'Başka karar'}),/farklı içerikle/);
});

test('terminal karar başlık güncellemesi olmadan yazılamaz; süreç/görev/olay atomik kalır',async()=>{
 await start(['a']);const broken=api('a',(r,v)=>r.path.includes('/ebysDocuments/')?null:v);
 await assert.rejects(broken.decideTask({processId:id,expectedRevision:1,result:'approved',reason:'',operationId:webcrypto.randomUUID()}));
 assert.equal((await api('owner').getProcess(id)).state,'active');assert.equal((await sdk.getDoc(ref(ctx('a'),'ebysTasks',id+'__a'))).data().hasDecision,false);
});

test('bağsız hesap atanamaz; personel yazar altı farklı UID ile bütçe içinde süreç başlatır',async()=>{
 await env.withSecurityRulesDisabled(c=>sdk.deleteDoc(ref(c.firestore(),'staffAccounts','b')));await assert.rejects(start(['b']));
 const people=['b','c','d','e','f','g'];await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const who of people){await sdk.setDoc(ref(db,'personel',who),{id:who,uid:who,name:who,pri:who+'.test',active:true});await sdk.setDoc(ref(db,'staffAccounts',who),{personelId:who,pri:who+'.test'});}await sdk.updateDoc(ref(db,'ebysDocuments','doc'),{ownerUid:'a'});await sdk.updateDoc(ref(db,'ebysVersions',id),{ownerUid:'a'});});
 await api('a').startProcess({documentId:'doc',versionId:id,route:people.map(personnelId=>({personnelId,kind:'approval',dueHours:72}))});
 for(const [i,who]of people.entries())await decide(who,i+1);assert.equal((await api('a').getProcess(id)).state,'completed');
 const templateId=await api('owner').createRouteTemplate({name:'Altı imzacı',route:people.map(personnelId=>({personnelId,kind:'approval'}))});id=webcrypto.randomUUID();
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await sdk.updateDoc(ref(db,'ebysDocuments','doc'),{currentVersionId:id,state:'in_review'});await sdk.setDoc(ref(db,'ebysVersions',id),{id,documentId:'doc',ownerUid:'a',content:'Şablon sürümü'});});
 await api('a').startProcess({documentId:'doc',versionId:id,templateId});for(const [i,who]of people.entries())await decide(who,i+1);
 assert.equal((await api('a').getProcess(id)).state,'completed');

});

test('rota şablonu create-only kalır; süreçte kimlik/revizyon ve rota snapshotı sabittir',async()=>{
 const own=api('owner'),templateId=await own.createRouteTemplate({name:'Onay ve olur',route:[{personnelId:'a',kind:'paraf'},{personnelId:'b',kind:'consent'}]});
 const template=(await own.listRouteTemplates()).find(t=>t.id===templateId);assert.equal(template.revision,1);
 await assertFails(sdk.updateDoc(ref(ctx('owner'),'ebysRouteTemplates',templateId),{name:'Değiştir'}));await assert.rejects(api('a').createRouteTemplate({}),/yönetici/);
 await own.startProcess({documentId:'doc',versionId:id,templateId});const p=await own.getProcess(id);assert.equal(p.templateId,templateId);assert.deepEqual(plain(p.routeSnapshot),plain(template.routeSnapshot));
 await decide('a',1);await decide('b',2);assert.equal((await own.getProcess(id)).state,'completed');
});

test('rotası henüz başlatılmamış dondurulmuş evrakta süreç durumu null döner',async()=>{
 assert.equal(await api('owner').getProcess(id),null);
 await env.withSecurityRulesDisabled(async c=>{await sdk.updateDoc(ref(c.firestore(),'ebysDocuments','doc'),{ownerUid:'a'});await sdk.updateDoc(ref(c.firestore(),'ebysVersions',id),{ownerUid:'a'});});
 assert.equal(await api('a').getProcess(id),null);
});
test('gelecek imzacının süreç okuma reddi boş süreç sayılmaz ve bağlamı korunur',async()=>{
 await start(['a','b']);await assert.rejects(api('b').getProcess(id),e=>e.code==='permission-denied'&&e.message.includes('inventory_demo')&&e.cause?.code==='permission-denied');
});

test('paraf sonrası iade ve ikinci sürüm: eski içerik korunur, yeni sürüm yalnız yeni atamayla açılır',async()=>{
 const own=api('owner'),documentId=webcrypto.randomUUID();await env.withSecurityRulesDisabled(c=>sdk.setDoc(ref(c.firestore(),'units','unit'),{id:'unit',name:'Test',active:true}));
 const value={id:documentId,expectedRevision:0,kind:'internal',unitId:'unit',organizationCode:'MED',content:'Eski sürüm içeriği',metadata:{subject:'İlk evrak',correspondent:'Kurum',date:'2026-11-03',filePlanCode:'934',confidentiality:'Normal',distribution:'',externalRegistrationNo:''}};
 await own.documents.saveDraft(value);const first=await own.documents.freezeVersion({documentId,expectedRevision:1});id=first.versionId;
 await own.startProcess({documentId,versionId:id,route:[{personnelId:'a',kind:'paraf'},{personnelId:'b',kind:'approval'}]});await decide('a',1);await decide('b',2,'returned','Düzeltiniz');
 assert.equal((await api('a').getVersion(id)).content,'Eski sürüm içeriği');await assert.rejects(api('b').getVersion(id),e=>e.code==='permission-denied'&&!e.message.includes("false for 'get'"));
 const head=(await own.documents.readDocument(documentId)).head;await own.documents.reopenDraft({documentId,expectedRevision:head.revision});const draft=(await own.documents.readDocument(documentId)).head;
 await own.documents.saveDraft({...value,content:'Yeni sürüm içeriği',metadata:{...value.metadata,subject:'Düzeltilmiş evrak'},expectedRevision:draft.revision});const changed=(await own.documents.readDocument(documentId)).head;const second=await own.documents.freezeVersion({documentId,expectedRevision:changed.revision});
 await assert.rejects(api('a').getVersion(second.versionId),e=>e.code==='permission-denied');
 const task=(await sdk.getDoc(ref(ctx('a'),'ebysTasks',id+'__a'))).data();
 let stop;try{const context=await new Promise((resolve,reject)=>{stop=api('a').watchTaskContext(task,v=>{if(v.available&&v.state==='returned')resolve(v)},reject)});assert.equal(context.versionNo,1);assert.equal(context.subject,'İlk evrak');assert.equal(context.versionId,id);}finally{stop?.();}
 const oldId=id;id=second.versionId;await own.startProcess({documentId,versionId:id,route:[{personnelId:'b',kind:'approval'},{personnelId:'a',kind:'paraf'}]});await assert.rejects(api('a').getVersion(id),e=>e.code==='permission-denied');await decide('b',1);
 assert.equal((await api('a').getVersion(id)).content,'Yeni sürüm içeriği');assert.equal((await api('a').getVersion(oldId)).content,'Eski sürüm içeriği');
});
