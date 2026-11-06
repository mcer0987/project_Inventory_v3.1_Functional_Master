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
function api(uid, transform = (_ref, value) => value, wrapTransaction = run => run(), cryptoProvider = webcrypto) {
    const window = { userAuth: { uid }, AppEnv: { COLLECTION_ROOT: root }, AppModules: {}, isDbAdmin: () => uid === 'owner' };
    const context = vm.createContext({
        window, console, TextEncoder, crypto: cryptoProvider, fireDb: ctx(uid), ...sdk,
        where: (field, operator, value) => sdk.where(field, operator, plain(value)),
        updateDoc: (path, data) => sdk.updateDoc(path, plain(data)),
        runTransaction: (db, callback) => wrapTransaction(() => sdk.runTransaction(db, tx => callback({
            get: path => tx.get(path),
            update: (path, value) => { const next = transform(path, value); if (next) tx.update(path, plain(next)); },
            set: (path, value) => { const next = transform(path, value); if (next) tx.set(path, plain(next)); }
        })))
    });
    const sources = ['src/utils/ebys-document-schema.js', 'src/utils/ebys-process-schema.js', 'src/services/ebys-document-service.js',
        'src/utils/ebys-verification-schema.js', 'src/services/ebys-verification-service.js',
        'src/services/ebys-execution-service.js', 'src/services/ebys-process-service.js'];
    for (const source of sources) {
        const code = readFileSync(source, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
        vm.runInContext(source.endsWith('ebys-verification-schema.js') ? code : '{' + code + '}', context);
    }
    return { ...window.AppModules.EBYSProcesses, execution: window.AppModules.EBYSExecution, verification: window.AppModules.EBYSVerification, documents: window.AppModules.EBYSDocuments };
}
const start=async(route=['a','b','a'])=>api('owner').startProcess({documentId:'doc',versionId:id,route:route.map(personnelId=>({personnelId,kind:'approval',dueHours:72})),operationId:webcrypto.randomUUID()});
const decide=(uid,revision,result='approved',reason='')=>api(uid).decideTask({processId:id,expectedRevision:revision,result,reason,operationId:webcrypto.randomUUID()});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-ebys-processes',firestore:{rules:readFileSync('firestore.rules','utf8')}})});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();id=webcrypto.randomUUID();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await sdk.setDoc(ref(db,'ebysDocuments','doc'),{id:'doc',ownerUid:'owner',currentVersionId:id,kind:'internal',unitId:'unit',state:'in_review',revision:2,versionNo:1});await sdk.setDoc(ref(db,'ebysVersions',id),{id,documentId:'doc',ownerUid:'owner',content:'Sabit sürüm'});await sdk.setDoc(ref(db,'accessGate','staff'),{staffAccessEnabled:true});await sdk.setDoc(ref(db,'units','unit'),{id:'unit',name:'İcra',active:true});await sdk.setDoc(ref(db,'ebysExecutionPolicies','internal'),{kind:'internal',unitId:'unit',personnelId:'c',assigneeUid:'c',dueHours:72});for(const who of ['a','b','c']){await sdk.setDoc(ref(db,'personel',who),{id:who,uid:who,name:who,unitId:'unit',pri:`${who}.test`,active:true});await sdk.setDoc(ref(db,'staffAccounts',who),{personelId:who,pri:`${who}.test`});}})});
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
 const people=['b','c','d','e','f','g'];await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const who of people){await sdk.setDoc(ref(db,'personel',who),{id:who,uid:who,name:who,unitId:'unit',pri:who+'.test',active:true});await sdk.setDoc(ref(db,'staffAccounts',who),{personelId:who,pri:who+'.test'});}await sdk.updateDoc(ref(db,'ebysDocuments','doc'),{ownerUid:'a'});await sdk.updateDoc(ref(db,'ebysVersions',id),{ownerUid:'a'});});
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

test('son onay işi atomik açar; tekrarlanan onay tek iş bırakır ve yalnız atanmış kişi sürümü alır', async () => {
    await start(['a']);
    const input = { processId: id, expectedRevision: 1, result: 'approved', operationId: webcrypto.randomUUID() };
    const broken = api('a', (r, v) => r.path.includes('/ebysExecutionJobs/') ? null : v);
    await assert.rejects(broken.decideTask(input));
    assert.equal((await api('owner').getProcess(id)).state, 'active');
    await assertFails(sdk.getDoc(ref(ctx('c'), 'ebysVersions', id)));

    const [first, retry] = await Promise.all([api('a').decideTask(input), api('a').decideTask(input)]);
    assert.deepEqual(plain(first), plain(retry));
    const job = ref(ctx('c'), 'ebysExecutionJobs', id);
    assert.equal((await sdk.getDoc(job)).data().state, 'pending_acceptance');
    await assertFails(sdk.getDoc(ref(ctx('b'), 'ebysExecutionJobs', id)));
    await assertFails(sdk.getDoc(ref(ctx('b'), 'ebysVersions', id)));
    await assertSucceeds(sdk.getDoc(ref(ctx('c'), 'ebysVersions', id)));
    await assertFails(sdk.getDocs(sdk.collection(ctx('c'), root, 'ebysExecutionJobs', 'items')));
    await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(ctx('c'), root, 'ebysExecutionJobs', 'items'), sdk.where('assigneeUid', '==', 'c'))));
    await assertFails(sdk.updateDoc(job, { assigneeUid: 'b' }));
});

test('icra iadesi sürüm erişimini kapatır, yeniden havale geçmişi korur ve yalnız tam kapanış bildirim üretir', async () => {
    await start(['a']);
    await decide('a', 1);
    const c = api('c').execution;
    const admin = api('owner').execution;
    const b = api('b').execution;
    await assert.rejects(c.returnExecutionJob(id, 1, 'Hazır değil'));
    await c.acceptExecutionJob(id, 1);
    const initial = (await sdk.getDoc(ref(ctx('owner'), 'ebysExecutionJobs', id))).data();
    await c.returnExecutionJob(id, 2, 'Birimde işlenemedi');
    const returnedQuery = sdk.query(sdk.collection(ctx('owner'), root, 'ebysExecutionJobs', 'items'),
        sdk.where('state', '==', 'returned'), sdk.orderBy('returnedAt', 'asc'));
    const returned = (await sdk.getDocs(returnedQuery)).docs[0].data();
    assert.ok(returned.returnedAt);
    assert.equal(returned.originalDueAt.toMillis(), initial.dueAt.toMillis());
    await assertFails(sdk.getDoc(ref(ctx('c'), 'ebysVersions', id)));
    await admin.reassignExecutionJob(id, 3, { unitId: 'unit', personnelId: 'b', dueHours: 2, note: 'İlgili personele havale' });
    assert.equal((await sdk.getDocs(returnedQuery)).size, 0);
    const reassigned = (await sdk.getDoc(ref(ctx('owner'), 'ebysExecutionJobs', id))).data();
    assert.equal(reassigned.originalDueAt.toMillis(), initial.dueAt.toMillis());
    assert.equal(reassigned.returnedAt, null);
    assert.ok(reassigned.dueAt.toMillis() < reassigned.originalDueAt.toMillis());
    await assertSucceeds(sdk.getDoc(ref(ctx('b'), 'ebysVersions', id)));
    await assertFails(sdk.getDoc(ref(ctx('c'), 'ebysExecutionJobs', id)));
    await b.acceptExecutionJob(id, 4);
    const result = { note: 'Evrak işlendi', evidenceRef: 'Teslim tutanağı 34', stockOperationId: '' };
    const broken = api('b', (r, v) => r.path.includes('/ebysNotifications/') ? null : v).execution;
    await assert.rejects(broken.completeExecutionJob(id, 5, result));
    await assert.rejects(b.completeExecutionJob(id, 5, { ...result, stockOperationId: 'invented123' }));
    await assertFails(sdk.updateDoc(ref(ctx('b'), 'ebysDocuments', 'doc'), { state: 'closed', revision: 4, updatedAt: sdk.serverTimestamp() }));
    const historyBefore = await admin.readExecutionHistory(id);
    assert.deepEqual(plain(historyBefore.map(x => x.action)), ['accept', 'reassign', 'return', 'accept']);
    assert.equal(historyBefore[1].returnedAt.toMillis(), returned.returnedAt.toMillis());

    await b.completeExecutionJob(id, 5, result);
    await b.completeExecutionJob(id, 5, result);
    await assertFails(sdk.getDoc(ref(ctx('b'), 'ebysVersions', id)));
    const notification = ref(ctx('owner'), 'ebysNotifications', id);
    assert.equal((await sdk.getDoc(notification)).data().emailState, 'deferred');
    await assertFails(sdk.getDoc(ref(ctx('b'), 'ebysNotifications', id)));
    await assertFails(sdk.updateDoc(notification, { emailState: 'sent' }));
    await admin.markNotificationRead(id);
    assert.ok((await sdk.getDoc(notification)).data().readAt);
    assert.equal((await admin.readExecutionHead('doc')).state, 'closed');
    await admin.archiveExecutionDocument(id);
    assert.equal((await admin.readExecutionHead('doc')).state, 'archived');
    assert.equal((await sdk.getDocs(sdk.collection(ctx('owner'), root, 'stockOperations', 'items'))).size, 0);
});

test('eksik veya pasif icra sorumlusu son onayı engeller; yönetici geçerli tanım yapabilir', async () => {
    await env.withSecurityRulesDisabled(c => sdk.deleteDoc(ref(c.firestore(), 'ebysExecutionPolicies', 'internal')));
    await start(['a']);
    await assert.rejects(decide('a', 1), /havale tanımı/);
    await assert.rejects(api('a').execution.saveExecutionPolicy('internal', '', { unitId: 'unit', personnelId: 'a', dueHours: 1 }));
    await api('owner').execution.saveExecutionPolicy('internal', '', { unitId: 'unit', personnelId: 'c', dueHours: 1 });
    await env.withSecurityRulesDisabled(c => sdk.updateDoc(ref(c.firestore(), 'personel', 'c'), { active: false }));
    await assert.rejects(decide('a', 1), /aktif/);
    await api('owner').execution.saveExecutionPolicy('internal', '', { unitId: 'unit', personnelId: 'b', dueHours: 1 });
    await decide('a', 1);
    assert.equal((await sdk.getDoc(ref(ctx('b'), 'ebysExecutionJobs', id))).data().assigneeUid, 'b');
});

test('birime özel havale tür varsayılanından önce gelir; geçersiz özel tanım varsayılana düşmez', async () => {
    const admin = api('owner').execution;
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await sdk.setDoc(ref(db, 'units', 'faculty'), { id: 'faculty', name: 'Fakülte', active: true });
        await sdk.updateDoc(ref(db, 'ebysDocuments', 'doc'), { unitId: 'faculty' });
    });
    await admin.saveExecutionPolicy('internal', 'faculty', { unitId: 'unit', personnelId: 'b', dueHours: 8 });
    await start(['a']);
    const forged = api('a', (r, value) => r.path.includes('/ebysExecutionJobs/')
        ? { ...value, assigneeUid: 'c', personnelId: 'c', policyId: 'internal' } : value);
    await assert.rejects(forged.decideTask({ processId: id, expectedRevision: 1, result: 'approved' }));
    await env.withSecurityRulesDisabled(context => sdk.updateDoc(ref(context.firestore(), 'personel', 'b'), { active: false }));
    await assert.rejects(decide('a', 1), /Birime özel havale/);
    assert.equal((await api('owner').getProcess(id)).state, 'active');
    await env.withSecurityRulesDisabled(context => sdk.updateDoc(ref(context.firestore(), 'personel', 'b'), { active: true }));
    await decide('a', 1);
    const job = (await sdk.getDoc(ref(ctx('owner'), 'ebysExecutionJobs', id))).data();
    assert.equal(job.policyId, 'internal__faculty');
    assert.equal(job.sourceUnitId, 'faculty');
    assert.equal(job.assigneeUid, 'b');
});

test('başka personelin icra kabulü ve kapanışı doğrudan SDK ile de reddedilir', async () => {
    await start(['a']);
    await decide('a', 1);
    const db = ctx('b'), path = ref(db, 'ebysExecutionJobs', id);
    const send = async (action, revision, from, to) => {
        const batch = sdk.writeBatch(db), eventId = id + '__' + revision;
        const closing = action === 'complete';
        const note = closing ? 'Yetkisiz kapanış' : '';
        batch.update(path, { state: to, revision, lastAction: action, lastActorUid: 'b', note,
            ...(closing ? { evidenceRef: 'Tutanak 1' } : {}), updatedAt: sdk.serverTimestamp() });
        batch.set(ref(db, 'ebysExecutionEvents', eventId), {
            id: eventId, processId: id, ownerUid: 'owner', revision, from, to, action,
            actorUid: 'b', previousAssigneeUid: 'c', assigneeUid: 'c', note, returnedAt: null, createdAt: sdk.serverTimestamp()
        });
        if (closing) {
            batch.update(ref(db, 'ebysDocuments', 'doc'), { state: 'closed', revision: 4, updatedAt: sdk.serverTimestamp() });
            batch.set(ref(db, 'ebysNotifications', id), { id, processId: id, documentId: 'doc', recipientUid: 'owner', eventId,
                type: 'execution_closed', emailState: 'deferred', readAt: null, createdAt: sdk.serverTimestamp() });
        }
        await assertFails(batch.commit());
    };
    await send('accept', 2, 'pending_acceptance', 'in_progress');
    await api('c').execution.acceptExecutionJob(id, 1);
    await send('complete', 3, 'in_progress', 'completed');
    assert.equal((await sdk.getDoc(ref(ctx('owner'), 'ebysExecutionJobs', id))).data().state, 'in_progress');
    assert.equal((await sdk.getDoc(ref(ctx('owner'), 'ebysDocuments', 'doc'))).data().state, 'internally_approved');
});

test('stok referansı aynı kökte, önceden doğrulanmış ve bu icra işine bağlı olmalıdır', async () => {
    const operationId = 'transfer_123', otherRootId = 'foreign_123', otherOperationId = 'otherjob_123', otherJobId = webcrypto.randomUUID();
    const operation = { id: operationId, kind: 'transfer', sourceCol: 'b1', targetCol: 'b2', qty: 1 };
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await sdk.setDoc(ref(db, 'stockOperations', operationId), operation);
        await sdk.setDoc(ref(db, 'stockOperations', otherOperationId), { ...operation, id: otherOperationId });
        await sdk.setDoc(ref(db, 'ebysExecutionJobs', otherJobId), { id: otherJobId, state: 'in_progress' });
        await sdk.setDoc(sdk.doc(db, 'lifeserver_master', 'stockOperations', 'items', otherRootId), { ...operation, id: otherRootId });
    });
    await start(['a']);
    await decide('a', 1);
    const admin = api('owner').execution, worker = api('c').execution;
    const result = { note: 'Teslim alındı', evidenceRef: 'Tutanak 52', stockOperationId: operationId };
    await worker.acceptExecutionJob(id, 1);
    await assert.rejects(worker.completeExecutionJob(id, 2, result));
    await assertFails(sdk.setDoc(ref(ctx('c'), 'ebysExecutionStockLinks', operationId), {
        operationId, processId: id, actorUid: 'c', note: 'Sahte ilişki', createdAt: sdk.serverTimestamp()
    }));
    await assertFails(sdk.setDoc(ref(ctx('owner'), 'ebysExecutionStockLinks', otherRootId), {
        operationId: otherRootId, processId: id, actorUid: 'owner', note: 'Başka kök', createdAt: sdk.serverTimestamp()
    }));
    await admin.linkExecutionStockOperation(otherJobId, otherOperationId, 'Başka evraka ait teslim');
    await assert.rejects(worker.completeExecutionJob(id, 2, { ...result, stockOperationId: otherOperationId }));
    await admin.linkExecutionStockOperation(id, operationId, 'Defterdeki teslim hareketi incelendi');
    const link = ref(ctx('owner'), 'ebysExecutionStockLinks', operationId);
    await assertFails(sdk.updateDoc(link, { processId: otherJobId }));
    await worker.completeExecutionJob(id, 2, result);
    assert.equal((await sdk.getDoc(ref(ctx('owner'), 'ebysExecutionJobs', id))).data().stockOperationId, operationId);
    assert.deepEqual((await sdk.getDoc(ref(ctx('owner'), 'stockOperations', operationId))).data(), operation);
});

test('red ve iade yazara aktif evrak kuyruğunda görünür, icra işi açılmaz', async () => {
    const owner = ctx('b');
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await sdk.updateDoc(ref(db, 'ebysDocuments', 'doc'), { ownerUid: 'b' });
        await sdk.updateDoc(ref(db, 'ebysVersions', id), { ownerUid: 'b' });
    });
    const returnedDocs = sdk.query(sdk.collection(owner, root, 'ebysDocuments', 'items'),
        sdk.where('ownerUid', '==', 'b'), sdk.where('state', 'in', ['returned', 'rejected', 'withdrawn']), sdk.orderBy('updatedAt', 'desc'));
    for (const status of ['returned', 'rejected']) {
        if (status === 'rejected') {
            id = webcrypto.randomUUID();
            await env.withSecurityRulesDisabled(async context => {
                const db = context.firestore();
                await sdk.updateDoc(ref(db, 'ebysDocuments', 'doc'), { currentVersionId: id, state: 'in_review' });
                await sdk.setDoc(ref(db, 'ebysVersions', id), { id, documentId: 'doc', ownerUid: 'b' });
            });
        }
        await api('b').startProcess({ documentId: 'doc', versionId: id, route: [{ personnelId: 'a', kind: 'approval', dueHours: 72 }] });
        await decide('a', 1, status, 'Düzeltme bekleniyor');
        const heads = await sdk.getDocs(returnedDocs);
        assert.equal(heads.size, 1);
        assert.equal(heads.docs[0].data().state, status);
        assert.equal((await api('b').getProcess(id)).lastReason, 'Düzeltme bekleniyor');
        assert.equal((await sdk.getDocs(sdk.collection(ctx('owner'), root, 'ebysExecutionJobs', 'items'))).size, 0);
    }
});

test('A6-01 iki eşzamanlı kapanış çağrısı başarılı döner, tek kapanış olayı ve bildirim yazılır', async () => {
    await start(['a']);
    await decide('a', 1);
    const first = api('c').execution, second = api('c').execution;
    await first.acceptExecutionJob(id, 1);
    const payload = { note: 'Evrak işlendi', evidenceRef: 'Teslim tutanağı 34' };
    const results = await Promise.all([
        first.completeExecutionJob(id, 2, payload), second.completeExecutionJob(id, 2, payload)
    ]);
    assert.ok(results.every(result => result.ok === true));
    assert.deepEqual(results.map(result => result.alreadyCompleted).sort(), [false, true]);
    const owner = ctx('owner');
    assert.equal((await sdk.getDoc(ref(owner, 'ebysExecutionJobs', id))).data().revision, 3);
    const history = await api('owner').execution.readExecutionHistory(id);
    assert.equal(history.filter(event => event.action === 'complete').length, 1);
    const notifications = sdk.query(sdk.collection(owner, root, 'ebysNotifications', 'items'), sdk.where('recipientUid', '==', 'owner'));
    assert.deepEqual((await sdk.getDocs(notifications)).docs.map(doc => doc.id), [id]);
});

test('A6-01 transaction reddi yalnız taze okunan aynı aktör, revizyon ve kapanış verisiyle başarı sayılır', async () => {
    await start(['a']);
    await decide('a', 1);
    await api('c').execution.acceptExecutionJob(id, 1);
    const denied = new sdk.FirestoreError('permission-denied', 'Transaction yanıtı reddedildi.');
    const identity = (_path, value) => value;
    const lostReply = api('c', identity, async run => { await run(); throw denied; }).execution;
    const payload = { note: 'Evrak işlendi', evidenceRef: 'Tutanak 34' };
    assert.deepEqual(plain(await lostReply.completeExecutionJob(id, 2, payload)), { ok: true, alreadyCompleted: true });

    const deniedTransaction = async () => { throw denied; };
    const sameActor = api('c', identity, deniedTransaction).execution;
    assert.deepEqual(plain(await sameActor.completeExecutionJob(id, 2, payload)), { ok: true, alreadyCompleted: true });
    for (const changed of [{ note: 'Başka sonuç' }, { evidenceRef: 'Başka kanıt' }, { stockOperationId: 'transfer_123' }]) {
        await assert.rejects(sameActor.completeExecutionJob(id, 2, { ...payload, ...changed }), error => error === denied);
    }
    await assert.rejects(sameActor.completeExecutionJob(id, 1, payload), error => error === denied);
    await assert.rejects(api('owner', identity, deniedTransaction).execution.completeExecutionJob(id, 2, payload), error => error === denied);
    await assert.rejects(api('b', identity, deniedTransaction).execution.completeExecutionJob(id, 2, payload), error => error === denied);
});

test('A6-02 kapalı evrak yedeği yetkili Aşama 6 ilişkilerini ve kapsam manifestosunu içerir', async () => {
    const operationId = 'backup_transfer_123', foreign = webcrypto.randomUUID();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await sdk.setDoc(ref(db, 'stockOperations', operationId), { id: operationId, kind: 'transfer' });
        await sdk.setDoc(ref(db, 'ebysExecutionJobs', foreign), { id: foreign, ownerUid: 'b', assigneeUid: 'b' });
        await sdk.setDoc(ref(db, 'ebysExecutionEvents', foreign), { processId: foreign, action: 'complete' });
        await sdk.setDoc(ref(db, 'ebysNotifications', foreign), { id: foreign, recipientUid: 'b' });
    });
    await start(['a']);
    await decide('a', 1);
    const worker = api('c'), admin = api('owner');
    await worker.execution.acceptExecutionJob(id, 1);
    await admin.execution.linkExecutionStockOperation(id, operationId, 'Teslim kanıtı doğrulandı');
    await worker.execution.completeExecutionJob(id, 2, { note: 'Teslim tamamlandı', evidenceRef: 'Tutanak 34', stockOperationId: operationId });

    const backup = plain(await admin.documents.exportOwnDocuments());
    assert.equal(backup.data.ebysDocuments[0].state, 'closed');
    assert.deepEqual(backup.data.ebysExecutionJobs.map(job => job.id), [id]);
    assert.deepEqual(backup.data.ebysExecutionPolicies.map(policy => policy.id), ['internal']);
    assert.equal(backup.data.ebysExecutionEvents.filter(event => event.processId === id).length, 2);
    assert.equal(backup.data.ebysExecutionEvents.length, 2);
    assert.equal(backup.data.ebysExecutionStockLinks[0].processId, id);
    assert.equal(backup.data.ebysExecutionStockLinks[0].id, operationId);
    assert.deepEqual(backup.data.ebysNotifications.map(notification => notification.id), [id]);
    assert.equal(backup.manifest.role, 'admin');
    assert.deepEqual(backup.manifest.collections.ebysExecutionStockLinks, {
        status: 'included', scope: 'stock-links-referenced-by-exported-jobs', count: 1, referenceCount: 1, missingReferences: []
    });

    const member = plain(await worker.documents.exportOwnDocuments());
    assert.equal(member.manifest.role, 'member');
    assert.deepEqual(member.data.ebysExecutionJobs.map(job => job.id), [id]);
    assert.deepEqual(member.data.ebysNotifications, []);
    assert.deepEqual(member.manifest.collections.ebysExecutionJobs, { status: 'included', scope: 'owner-or-assignee', count: 1 });
    for (const name of ['ebysExecutionPolicies', 'ebysExecutionEvents', 'ebysExecutionStockLinks']) {
        assert.deepEqual(member.data[name], []);
        assert.equal(member.manifest.collections[name].status, 'excluded');
        assert.equal(member.manifest.collections[name].reason, 'admin-required');
    }
    assert.deepEqual(plain((await api('b').documents.exportOwnDocuments()).data.ebysNotifications).map(notification => notification.id), [foreign]);
});

async function closedVerificationFixture() {
    const owner = api('owner');
    const documentId = webcrypto.randomUUID();
    const draft = await owner.documents.saveDraft({
        id: documentId, expectedRevision: 0, kind: 'internal', unitId: 'unit', organizationCode: 'MED',
        content: 'Gizli içerik ve kişisel veri', metadata: {
            subject: 'Kişiye özel konu', correspondent: 'Kişi adı', date: '2026-11-05',
            filePlanCode: '100', confidentiality: 'Gizli', distribution: '', externalRegistrationNo: ''
        }
    });
    const registration = await owner.documents.registerDocument({ documentId, expectedRevision: draft.revision });
    const version = await owner.documents.freezeVersion({ documentId, expectedRevision: registration.revision });
    id = version.versionId;
    await owner.startProcess({ documentId, versionId: id, route: [{ personnelId: 'a', kind: 'approval', dueHours: 72 }] });
    await decide('a', 1);
    const worker = api('c').execution;
    await worker.acceptExecutionJob(id, 1);
    await worker.completeExecutionJob(id, 2, { note: 'İşlendi', evidenceRef: 'Tutanak 34' });
    return { owner, documentId, registration };
}

test('A7 anonim doğrulama yalnız token ile beş alan döndürür ve arşiv olayı atomiktir', async () => {
    const { owner, documentId, registration } = await closedVerificationFixture();
    const [first, retry] = await Promise.all([
        owner.verification.issueVerification(documentId), api('owner').verification.issueVerification(documentId)
    ]);
    assert.match(first, /^[a-f0-9]{32}$/);
    assert.equal(first, retry);
    const anon = env.unauthenticatedContext().firestore();
    const publicRef = ref(anon, 'ebysVerifications', first);
    const record = (await sdk.getDoc(publicRef)).data();
    const source = await owner.documents.readDocument(documentId);
    assert.deepEqual(Object.keys(record).sort(), ['contentDigest','registeredAt','registrationNo','status','subjectSummary']);
    assert.equal(record.subjectSummary, 'Kurum içi yazışma');
    assert.equal(record.registrationNo, registration.registrationNo);
    assert.equal(record.contentDigest, source.body.contentDigest);
    assert.equal(record.status, 'valid');
    const base = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/demo-ebys-processes/databases/(default)/documents/' + root;
    const rest = await fetch(base + '/ebysVerifications/items/' + first);
    assert.equal(rest.status, 200);
    assert.deepEqual(Object.keys((await rest.json()).fields).sort(), Object.keys(record).sort());
    assert.equal((await fetch(base + '/ebysDocuments/items/' + documentId)).status, 403);
    await assertFails(sdk.getDocs(sdk.collection(anon, root, 'ebysVerifications', 'items')));
    await assertFails(sdk.getDoc(ref(anon, 'ebysDocuments', documentId)));
    await assertFails(sdk.getDoc(ref(anon, 'ebysVersions', id)));
    await assertFails(sdk.getDoc(ref(anon, 'ebysVerificationTokens', first)));
    await assertFails(sdk.getDoc(ref(ctx('owner'), 'ebysVerificationTokens', first)));
    await assertFails(sdk.updateDoc(ref(ctx('b'), 'ebysVerifications', first), { status: 'revoked' }));

    const eventRef = ref(ctx('owner'), 'ebysExecutionEvents', id + '__archive');
    const withoutEvent = api('owner', (ref, data) => ref.path.endsWith('__archive') ? null : data);
    await assert.rejects(withoutEvent.verification.archiveExecutionDocument(id));
    assert.equal((await sdk.getDoc(publicRef)).data().status, 'valid');
    const withoutProjection = api('owner', (ref, data) => ref.path.includes('/ebysVerifications/') ? null : data);
    await assert.rejects(withoutProjection.verification.archiveExecutionDocument(id));
    assert.equal((await sdk.getDoc(eventRef)).exists(), false);
    await assert.rejects(api('c').verification.archiveExecutionDocument(id));
    await owner.verification.archiveExecutionDocument(id);
    await owner.verification.archiveExecutionDocument(id);
    assert.equal((await sdk.getDoc(publicRef)).data().status, 'archived');
    const event = (await sdk.getDoc(eventRef)).data();
    assert.equal(event.action, 'archive');
    assert.equal(event.actorUid, 'owner');
    assert.equal(event.documentRevision, (await owner.documents.readDocument(documentId)).head.revision);
    await assertFails(sdk.deleteDoc(ref(ctx('owner'), 'ebysDocuments', documentId)));
    await assertFails(sdk.updateDoc(ref(ctx('owner'), 'ebysVersions', id), { content: 'Sahte sürüm' }));
    await assertFails(sdk.deleteDoc(eventRef));
    await assertFails(sdk.deleteDoc(ref(ctx('owner'), 'ebysVerifications', first)));
});

test('A7 kamusal projeksiyona metin enjekte edilemez ve iptal aynı token üzerinde kalır', async () => {
    const { owner, documentId } = await closedVerificationFixture();
    const altered = api('owner', (ref, data) => ref.path.includes('/ebysVerifications/')
        ? { ...data, subjectSummary: 'Kişiye özel konu', documentId, content: 'Gizli metin' } : data);
    await assert.rejects(altered.verification.issueVerification(documentId));
    assert.equal((await owner.documents.readDocument(documentId)).head.verificationToken, undefined);
    const occupied = 'ab'.repeat(16);
    const collision = {
        registrationNo: 'EBYS-MED-261105-' + 'A'.repeat(32), registeredAt: sdk.Timestamp.fromMillis(1),
        subjectSummary: 'Kurum içi yazışma', status: 'valid', contentDigest: 'f'.repeat(64)
    };
    await env.withSecurityRulesDisabled(c => sdk.setDoc(ref(c.firestore(), 'ebysVerifications', occupied), collision));
    let attempts = 0;
    const generator = { getRandomValues: bytes => ++attempts === 1 ? bytes.fill(0xab) : webcrypto.getRandomValues(bytes) };
    const retrying = api('owner', undefined, undefined, generator);
    const token = await retrying.verification.issueVerification(documentId);
    assert.equal(attempts, 2);
    assert.notEqual(token, occupied);
    assert.deepEqual((await sdk.getDoc(ref(ctx('owner'), 'ebysVerifications', occupied))).data(), collision);
    const publicRef = ref(ctx('owner'), 'ebysVerifications', token);
    await assertFails(sdk.updateDoc(publicRef, { status: 'revoked' }));
    await owner.verification.revokeVerification(documentId);
    await owner.verification.archiveExecutionDocument(id);
    assert.equal(await owner.verification.issueVerification(documentId), token);
    assert.equal((await sdk.getDoc(publicRef)).data().status, 'revoked');
    await assertFails(sdk.updateDoc(publicRef, { status: 'valid' }));
    await assertFails(sdk.setDoc(ref(ctx('owner'), 'ebysVerifications', 'ab'.repeat(16)), {
        registrationNo: 'sahte', contentDigest: 'a'.repeat(64), status: 'valid'
    }));
});
