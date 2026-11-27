// v3.4 EBYS H6b · Kurum künyesi, dosya planı ve üst yazı şablonları — gerçek servisler (vm) + firestore.rules (emülatör).
// Değişmezlik: tanım değişse/pasife alınsa da taslağın kopyası ve dondurulmuş sürüm aynı kalır.
// Usage: npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
sdk.setLogLevel('silent');

let env;
const root = 'inventory_demo';
const ref = (store, col, id) => sdk.doc(store, root, col, 'items', id);
const ctx = uid => env.authenticatedContext(uid, { email: uid === 'owner' ? 'admin@medipol.local' : `${uid}.test@staff.medipol.local`,
    firebase: { sign_in_provider: 'password' } }).firestore();
function plain(v) {
    if (Array.isArray(v)) return Array.from(v, plain);
    if (v && v.constructor?.name === 'Object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    return v;
}
const strip = file => readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export \{[^}]*\};?\r?\n/gm, '').replace(/export /g, '');
function services(uid, admin, transform = (r, v) => v, overrides = {}) {
    const store = ctx(uid);
    const window = { AppModules: {}, AppEnv: { COLLECTION_ROOT: root }, userAuth: { uid }, isDbAdmin: () => admin };
    // İki servis aynı üst düzey adları (root, ref, uid) kullandığından ayrı bağlamda, ortak window ile yüklenir.
    const context = () => vm.createContext({ window, crypto: webcrypto, TextEncoder, console, fireDb: store, ...sdk, ...overrides,
        runTransaction: (d, fn) => sdk.runTransaction(d, tx => fn({ get: r => tx.get(r), set: (r, v) => tx.set(r, plain(transform(r, v))) })) });
    const schemas = context();
    for (const f of ['src/utils/ebys-document-schema.js', 'src/utils/ebys-catalog-schema.js']) vm.runInContext(readFileSync(f, 'utf8'), schemas);
    vm.runInContext(strip('src/services/ebys-catalog-service.js'), context());
    vm.runInContext(strip('src/services/ebys-document-service.js'), context());
    return { store, catalog: window.AppModules.EBYSCatalog, docs: window.AppModules.EBYSDocuments, schema: window.AppModules.EBYSDocumentSchema };
}
const profile = { name: 'Medipol Üniversitesi', code: 'MED', address: 'Kavacık, Beykoz / İstanbul', phone: '0216 000 00 00', email: 'evrak@medipol.edu.tr', web: '' };
const draftInput = (extra = {}) => ({ id: webcrypto.randomUUID(), operationId: webcrypto.randomUUID(), kind: 'internal', unitId: 'unit',
    organizationCode: 'MED', expectedRevision: 0, content: 'Gereğini rica ederim.',
    metadata: { subject: 'Üst yazı', correspondent: 'Rektörlük', date: '2026-11-12', filePlanCode: '100', confidentiality: 'Normal',
        distribution: '', externalRegistrationNo: '' }, ...extra });

before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-ebys-catalog', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => env?.cleanup());
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
        const db = c.firestore();
        await sdk.setDoc(ref(db, 'units', 'unit'), { id: 'unit', name: 'Test', active: true });
        await sdk.setDoc(ref(db, 'accessGate', 'staff'), { staffAccessEnabled: true });
        await sdk.setDoc(ref(db, 'personel', 'a'), { id: 'a', uid: 'a', name: 'a', unitId: 'unit', pri: 'a.test', active: true });
        await sdk.setDoc(ref(db, 'staffAccounts', 'a'), { personelId: 'a', pri: 'a.test' });
        await sdk.setDoc(ref(db, 'personel', 'b'), { id: 'b', uid: 'b', name: 'b', unitId: 'unit', pri: 'b.test', active: true });
        await sdk.setDoc(ref(db, 'staffAccounts', 'b'), { personelId: 'b', pri: 'b.test' });
    });
});

test('yönetici künye, plan ve şablon yazar; personel okur ama yazamaz; silme yok', async () => {
    const admin = services('owner', true);
    const p1 = await admin.catalog.saveProfile(profile);
    assert.equal(p1.revision, 1);
    await admin.catalog.saveFilePlan({ code: '100', title: 'İdari İşler' }, { create: true });
    const t1 = await admin.catalog.saveTemplate({ name: 'İzin Talebi', subject: 'İzin', content: 'İzin talebimi arz ederim.' });
    assert.equal(t1.currentRevision, 1);

    const staff = ctx('a');
    await assertSucceeds(sdk.getDoc(ref(staff, 'ebysOrganizations', 'primary')));
    await assertSucceeds(sdk.getDocs(sdk.collection(staff, root, 'ebysFilePlans', 'items')));
    await assertSucceeds(sdk.getDoc(ref(staff, 'ebysLetterTemplateRevisions', `${t1.id}_1`)));
    await assertFails(sdk.updateDoc(ref(staff, 'ebysOrganizations', 'primary'), { name: 'Sahte' }));
    await assertFails(sdk.setDoc(ref(staff, 'ebysFilePlans', '200'), { id: '200', code: '200', title: 'Mali', active: true, revision: 1,
        createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), updatedBy: 'a' }));
    await assert.rejects(services('a', true).catalog.saveFilePlan({ code: '200', title: 'Mali' }, { create: true }));
    await assertFails(sdk.getDoc(ref(env.unauthenticatedContext().firestore(), 'ebysOrganizations', 'primary')));

    const db = admin.store;
    for (const [col, id] of [['ebysOrganizations', 'primary'], ['ebysOrganizationRevisions', '1'], ['ebysFilePlans', '100'],
        ['ebysLetterTemplates', t1.id], ['ebysLetterTemplateRevisions', `${t1.id}_1`]]) await assertFails(sdk.deleteDoc(ref(db, col, id)));
    await assertFails(sdk.updateDoc(ref(db, 'ebysOrganizationRevisions', '1'), { profile: { ...profile, name: 'Geçmişi değiştir' } }));
    await assertFails(sdk.updateDoc(ref(db, 'ebysLetterTemplateRevisions', `${t1.id}_1`), { content: 'Geçmişi değiştir' }));
    // Künye revizyon kaydı olmadan doğrudan künye güncellemesi reddedilir (geçmiş atlanamaz).
    await assertFails(sdk.updateDoc(ref(db, 'ebysOrganizations', 'primary'), { name: 'Revizyonsuz', revision: 2,
        updatedAt: sdk.serverTimestamp(), updatedBy: 'owner' }));
    await assert.rejects(admin.catalog.saveProfile({ ...profile, code: 'M' }), /Kurum kodu/);
    await assert.rejects(admin.catalog.saveFilePlan({ code: '100', title: 'Tekrar' }, { create: true }), /zaten var/);
    await assert.rejects(admin.catalog.saveProfile(profile, { expectedRevision: 0 }), /değişmiş/);
});

test('yeni evrak künyeyi kopyalar; künye sonradan değişse de taslak ve dondurulmuş sürüm aynı kalır', async () => {
    const admin = services('owner', true);
    await admin.catalog.saveProfile(profile);
    await admin.catalog.saveFilePlan({ code: '100', title: 'İdari İşler' }, { create: true });
    const author = services('a', false);
    const input = draftInput({ metadata: { ...draftInput().metadata, filePlanTitle: 'İdari İşler' } });
    const saved = await author.docs.saveDraft(input);
    const draft = (await sdk.getDoc(ref(author.store, 'ebysDrafts', input.id))).data();
    assert.deepEqual(draft.institutionSnapshot, { ...profile, revision: 1 });
    assert.equal(draft.metadata.filePlanTitle, 'İdari İşler');

    // Kurum kodu künyeden gelir; farklı kodla yeni evrak açılamaz.
    await assert.rejects(author.docs.saveDraft(draftInput({ organizationCode: 'XYZ' })), /künyesinden/);

    const frozen = await author.docs.freezeVersion({ documentId: input.id, expectedRevision: saved.revision });
    const before = (await sdk.getDoc(ref(author.store, 'ebysVersions', frozen.versionId))).data();
    assert.deepEqual(before.institutionSnapshot, { ...profile, revision: 1 });

    await admin.catalog.saveProfile({ ...profile, name: 'Yeni Ad', address: 'Yeni adres', code: 'MDP' }, { expectedRevision: 1 });
    await admin.catalog.setFilePlanActive('100', false, { expectedRevision: 1 });
    const after = (await sdk.getDoc(ref(author.store, 'ebysVersions', frozen.versionId))).data();
    assert.deepEqual(after, before, 'dondurulmuş sürüm künye/plan değişiminden etkilenmez');
    assert.equal((await sdk.getDoc(ref(admin.store, 'ebysOrganizationRevisions', '1'))).data().profile.name, profile.name);

    // Yeni evrak yeni künyeyi alır; eski künye kopyasıyla yeni taslak yazılamaz.
    const second = draftInput({ organizationCode: 'MDP' });
    await author.docs.saveDraft(second);
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDrafts', second.id))).data().institutionSnapshot.revision, 2);
    // İstemci eski künye kopyasını ya da kopyasız taslağı zorlasa kurallar reddeder (gerçek servis, yalnız yazılan değer değişir).
    const forge = snapshot => services('a', false, (r, v) => (r.path.includes('/ebysDrafts/') ? { ...v, institutionSnapshot: snapshot } : v));
    await assert.rejects(forge({ ...profile, revision: 1 }).docs.saveDraft(draftInput({ organizationCode: 'MDP' })));
    await assert.rejects(services('a', false, (r, v) => {
        if (!r.path.includes('/ebysDrafts/')) return v;
        const { institutionSnapshot, ...rest } = v; return rest;
    }).docs.saveDraft(draftInput({ organizationCode: 'MDP' })));
});

test('mevcut taslak künye kopyasını korur ve değiştiremez; künyesiz eski taslak çalışmaya devam eder', async () => {
    const author = services('a', false);
    const legacy = draftInput();
    const first = await author.docs.saveDraft(legacy);   // künye tanımlı değilken (eski davranış)
    const admin = services('owner', true);
    await admin.catalog.saveProfile(profile);
    const again = await author.docs.saveDraft({ ...legacy, operationId: webcrypto.randomUUID(), expectedRevision: first.revision, content: 'Düzeltildi' });
    const legacyDraft = (await sdk.getDoc(ref(author.store, 'ebysDrafts', legacy.id))).data();
    assert.equal(legacyDraft.content, 'Düzeltildi');
    assert.equal(legacyDraft.institutionSnapshot, undefined, 'eski taslağa sonradan künye eklenmez');
    assert.ok(again.revision > first.revision);

    const fresh = draftInput();
    const saved = await author.docs.saveDraft(fresh);
    await admin.catalog.saveProfile({ ...profile, name: 'Değişti' }, { expectedRevision: 1 });
    await author.docs.saveDraft({ ...fresh, operationId: webcrypto.randomUUID(), expectedRevision: saved.revision, content: 'İkinci kayıt' });
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDrafts', fresh.id))).data().institutionSnapshot.name, profile.name,
        'taslak açıldığı andaki künyeyi taşır');
});

test('pasif dosya planı yeni seçimde reddedilir; önceden seçilmiş plan korunur; sürüm yalnız katalogdaki planla yazılır', async () => {
    const admin = services('owner', true);
    await admin.catalog.saveFilePlan({ code: '100', title: 'İdari İşler' }, { create: true });
    await admin.catalog.saveFilePlan({ code: '200.01', title: 'Mali İşler' }, { create: true });
    const author = services('a', false);
    const input = draftInput({ metadata: { ...draftInput().metadata, filePlanCode: '100', filePlanTitle: 'İdari İşler' } });
    const saved = await author.docs.saveDraft(input);
    await admin.catalog.setFilePlanActive('100', false, { expectedRevision: 1 });
    // Aynı (artık pasif) planla taslak düzenlemeye devam eder.
    const kept = await author.docs.saveDraft({ ...input, operationId: webcrypto.randomUUID(), expectedRevision: saved.revision, content: 'Devam' });
    // Pasif plan başka bir evrakta yeni seçim olarak kullanılamaz.
    const other = draftInput({ metadata: { ...draftInput().metadata, filePlanCode: '100', filePlanTitle: 'İdari İşler' } });
    await assert.rejects(author.docs.saveDraft(other), /dosya planı/);
    // Plan adı tutmayan seçim reddedilir; aktif plana geçiş kabul edilir.
    await assert.rejects(author.docs.saveDraft({ ...input, operationId: webcrypto.randomUUID(), expectedRevision: kept.revision,
        metadata: { ...input.metadata, filePlanCode: '200.01', filePlanTitle: 'Sahte ad' } }), /dosya planı/);
    await author.docs.saveDraft({ ...input, operationId: webcrypto.randomUUID(), expectedRevision: kept.revision,
        metadata: { ...input.metadata, filePlanCode: '200.01', filePlanTitle: 'Mali İşler' } });
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDrafts', input.id))).data().metadata.filePlanCode, '200.01');
    // Pasif plan seçili taslak da dondurulabilir (seçim pasifleştirmeden önce yapıldı).
    const passive = draftInput({ metadata: { ...draftInput().metadata, filePlanCode: '200.01', filePlanTitle: 'Mali İşler' } });
    const p1 = await author.docs.saveDraft(passive);
    await admin.catalog.setFilePlanActive('200.01', false, { expectedRevision: 1 });
    await author.docs.freezeVersion({ documentId: passive.id, expectedRevision: p1.revision });

    // Servis atlatılıp katalogda olmayan plan adı taslağa yazılabilir (taslak kişiseldir) ama resmî sürüm yazılamaz.
    const forged = services('a', false, (r, v) => (r.path.includes('/ebysDrafts/') ? { ...v, metadata: { ...v.metadata, filePlanTitle: 'Uydurma plan' } } : v));
    const fx = draftInput();
    const fs1 = await forged.docs.saveDraft(fx);
    await assert.rejects(author.docs.freezeVersion({ documentId: fx.id, expectedRevision: fs1.revision }), /dosya planı/);
    // Servisin ön denetimi de atlanırsa kural reddeder (ecVersionPlanOk).
    const blind = services('a', false, undefined, { getDocFromServer: async r => (r.path.includes('/ebysFilePlans/')
        ? { exists: () => true, data: () => ({ title: 'Uydurma plan' }) } : sdk.getDocFromServer(r)) });
    await assert.rejects(blind.docs.freezeVersion({ documentId: fx.id, expectedRevision: fs1.revision }), /permission|PERMISSION/i);
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDocuments', fx.id))).data().currentVersionId, '');
    // Plan kodu sabittir: aynı kimlikle farklı kod yazılamaz.
    await assertFails(sdk.setDoc(ref(admin.store, 'ebysFilePlans', '300'), { id: '300', code: '301', title: 'X', active: true, revision: 1,
        createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), updatedBy: 'owner' }));
});

test('şablon güncellemesi yeni sürümdür; pasife alma ve yeni sürüm başlatılmış evrakı bozmaz', async () => {
    const admin = services('owner', true);
    const t = await admin.catalog.saveTemplate({ name: 'Satın Alma Üst Yazısı', subject: 'Satın alma', content: 'Sürüm 1 metni.' });
    const author = services('a', false);
    const rev1 = await author.catalog.getTemplateRevision(t.id, 1);
    const input = draftInput({ content: rev1.content, letterTemplate: { templateId: t.id, revision: 1, name: rev1.name } });
    const saved = await author.docs.saveDraft(input);
    const frozen = await author.docs.freezeVersion({ documentId: input.id, expectedRevision: saved.revision });

    // Personel mevcut taslağına sonradan şablon uygular (güncelleme yolu) ve şablonu kaldırabilir.
    const later = draftInput();
    const l1 = await author.docs.saveDraft(later);
    const l2 = await author.docs.saveDraft({ ...later, operationId: webcrypto.randomUUID(), expectedRevision: l1.revision, content: rev1.content,
        letterTemplate: { templateId: t.id, revision: 1, name: rev1.name } });
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDrafts', later.id))).data().letterTemplate.revision, 1);
    await author.docs.saveDraft({ ...later, operationId: webcrypto.randomUUID(), expectedRevision: l2.revision, content: 'Serbest metin' });
    assert.equal((await sdk.getDoc(ref(author.store, 'ebysDrafts', later.id))).data().letterTemplate, undefined);
    const t2 = await admin.catalog.saveTemplate({ id: t.id, name: 'Satın Alma Üst Yazısı', subject: 'Satın alma', content: 'Sürüm 2 metni.' },
        { expectedRevision: t.revision });
    assert.equal(t2.currentRevision, 2);
    assert.equal((await author.catalog.getTemplateRevision(t.id, 1)).content, 'Sürüm 1 metni.', 'eski sürüm değişmez');
    assert.deepEqual((await author.catalog.listTemplateRevisions(t.id)).map(r => r.revision), [2, 1]);
    await admin.catalog.setTemplateActive(t.id, false, { expectedRevision: t2.revision });

    const version = (await sdk.getDoc(ref(author.store, 'ebysVersions', frozen.versionId))).data();
    assert.equal(version.content, 'Sürüm 1 metni.');
    assert.deepEqual(version.letterTemplate, { templateId: t.id, revision: 1, name: 'Satın Alma Üst Yazısı' });

    // Pasif şablon yeni evrakta kullanılamaz.
    await assert.rejects(author.docs.saveDraft(draftInput({ letterTemplate: { templateId: t.id, revision: 2, name: 'Satın Alma Üst Yazısı' } })), /şablon/);
    // Seçimden sonra pasife alınan şablonla hazırlanmış taslak dondurulabilir.
    // En ağır personel yolu: künye + katalog planı + şablon birlikte taslağa girer ve sürüme mühürlenir.
    await admin.catalog.saveProfile(profile);
    await admin.catalog.saveFilePlan({ code: '100', title: 'İdari İşler' }, { create: true });
    const pending = draftInput({ content: 'Sürüm 2 metni.', metadata: { ...draftInput().metadata, filePlanTitle: 'İdari İşler' } });
    await env.withSecurityRulesDisabled(c => sdk.updateDoc(ref(c.firestore(), 'ebysLetterTemplates', t.id), { active: true }));
    const pd = await author.docs.saveDraft({ ...pending, letterTemplate: { templateId: t.id, revision: 2, name: 'Satın Alma Üst Yazısı' } });
    await env.withSecurityRulesDisabled(c => sdk.updateDoc(ref(c.firestore(), 'ebysLetterTemplates', t.id), { active: false }));
    const pv = await author.docs.freezeVersion({ documentId: pending.id, expectedRevision: pd.revision });
    const sealed = (await sdk.getDoc(ref(author.store, 'ebysVersions', pv.versionId))).data();
    assert.deepEqual([sealed.institutionSnapshot.revision, sealed.metadataSnapshot.filePlanTitle, sealed.letterTemplate.revision], [1, 'İdari İşler', 2]);
    // Var olmayan şablon sürümüne bağlı taslak (servis atlatılarak yazılmış) resmî sürüme dönüşemez.
    const fake = draftInput();
    const fk = await services('a', false, (r, v) => (r.path.includes('/ebysDrafts/') ? { ...v, letterTemplate: { templateId: t.id, revision: 9, name: 'Uydurma' } } : v)).docs.saveDraft(fake);
    await assert.rejects(author.docs.freezeVersion({ documentId: fake.id, expectedRevision: fk.revision }), /şablon/);
    const blind = services('a', false, undefined, { getDocFromServer: async r => (r.path.includes('/ebysLetterTemplateRevisions/')
        ? { exists: () => true, data: () => ({ name: 'Uydurma' }) } : sdk.getDocFromServer(r)) });
    await assert.rejects(blind.docs.freezeVersion({ documentId: fake.id, expectedRevision: fk.revision }), /permission/i);
    // Sürüm atlanamaz ve var olan sürüm yeniden yazılamaz.
    await assertFails(sdk.setDoc(ref(admin.store, 'ebysLetterTemplateRevisions', `${t.id}_1`), { id: `${t.id}_1`, templateId: t.id, revision: 1,
        name: 'X', subject: '', content: 'Üzerine yaz', createdAt: sdk.serverTimestamp(), createdBy: 'owner' }));
    await assertFails(sdk.updateDoc(ref(admin.store, 'ebysLetterTemplates', t.id), { currentRevision: 5, revision: 4,
        updatedAt: sdk.serverTimestamp(), updatedBy: 'owner' }));
});

test('kişisel üst yazı şablonları (v3.7 İP-11): tam gizlilik (yönetici dahil erişemez) ve sahip CRUD', async () => {
    const staffA = services('a', false);
    const staffB = services('b', false);
    const admin = services('owner', true);

    // 1. Personel A kendi kişisel şablonunu oluşturur, listeler ve günceller.
    const created = await staffA.catalog.savePersonalTemplate({ name: 'Aylık Raporum', subject: 'Aylık Faaliyet', content: 'Aylık raporum ektedir.' });
    assert.equal(created.ownerUid, 'a');
    assert.equal(created.name, 'Aylık Raporum');

    const myList = await staffA.catalog.listMyPersonalTemplates();
    assert.equal(myList.length, 1);
    assert.equal(myList[0].id, created.id);

    const updated = await staffA.catalog.savePersonalTemplate({ id: created.id, name: 'Aylık Raporum v2', subject: '', content: 'Güncel metin.' });
    assert.equal(updated.name, 'Aylık Raporum v2');
    assert.equal((await sdk.getDoc(ref(staffA.store, 'ebysPersonalTemplates', created.id))).data().content, 'Güncel metin.');

    // 2. Başka personel (B) VE yönetici (owner) A'nın kişisel şablonunu okuyamaz, listeleyemez, değiştiremez, silemez.
    for (const outsider of [staffB, admin]) {
        await assertFails(sdk.getDoc(ref(outsider.store, 'ebysPersonalTemplates', created.id)));
        await assertFails(sdk.getDocs(sdk.collection(outsider.store, root, 'ebysPersonalTemplates', 'items')));
        await assertFails(sdk.getDocs(sdk.query(sdk.collection(outsider.store, root, 'ebysPersonalTemplates', 'items'), sdk.where('ownerUid', '==', 'a'))));
        await assertFails(sdk.updateDoc(ref(outsider.store, 'ebysPersonalTemplates', created.id), { name: 'Sızma', updatedAt: sdk.serverTimestamp() }));
        await assertFails(sdk.deleteDoc(ref(outsider.store, 'ebysPersonalTemplates', created.id)));
        // Başkası adına oluşturma girişimi reddedilir.
        await assertFails(sdk.setDoc(ref(outsider.store, 'ebysPersonalTemplates', webcrypto.randomUUID()), {
            id: webcrypto.randomUUID(), ownerUid: 'a', name: 'Sahte', subject: '', content: 'x',
            createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
        }));
    }

    // 3. Kendi listesi boş döner (B ve yönetici yalnız kendi şablonlarını listeleyebilir).
    assert.deepEqual(await staffB.catalog.listMyPersonalTemplates(), []);
    assert.deepEqual(await admin.catalog.listMyPersonalTemplates(), []);

    // 4. Sahip dahi ownerUid değiştiremez, ekstra alan ekleyemez veya createdAt tahrif edemez.
    await assertFails(sdk.updateDoc(ref(staffA.store, 'ebysPersonalTemplates', created.id), { ownerUid: 'b', updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.updateDoc(ref(staffA.store, 'ebysPersonalTemplates', created.id), { extra: 'yasak', updatedAt: sdk.serverTimestamp() }));
    await assertFails(sdk.updateDoc(ref(staffA.store, 'ebysPersonalTemplates', created.id), { createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() }));

    // 5. Kişisel şablon taslağa uygulandığında (letterTemplate olmadan) mevcut evrak akışı sıfır ek kural yüküyle çalışır.
    const draft = draftInput({ content: updated.content, metadata: { ...draftInput().metadata, subject: 'Kişisel konu' } });
    const savedDraft = await staffA.docs.saveDraft(draft);
    assert.equal((await sdk.getDoc(ref(staffA.store, 'ebysDrafts', draft.id))).data().letterTemplate, undefined);
    await staffA.docs.freezeVersion({ documentId: draft.id, expectedRevision: savedDraft.revision });

    // 6. Sahip kendi kişisel şablonunu silebilir.
    await staffA.catalog.deletePersonalTemplate(created.id);
    assert.deepEqual(await staffA.catalog.listMyPersonalTemplates(), []);
});

test('yönetici vekâleten kişisel şablon erişimi (v3.8 VP-4): denetimli/süreli salt-okunur erişim, iptal ve sınırlar', async () => {
    const staffA = services('a', false);
    const staffB = services('b', false);
    const admin = services('owner', true);

    const tpl = await staffA.catalog.savePersonalTemplate({
        name: 'İzin Dönemi Üst Yazısı',
        subject: 'Vekâleten Gönderim',
        content: 'Personel A yıllık izindeyken kullanılacak şablon.',
    });

    // 1. Vekâlet yokken yönetici A'nın şablonunu okuyamaz ve listeleyemez.
    await assertFails(sdk.getDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id)));
    await assert.rejects(admin.catalog.listDelegatedPersonalTemplates('a'));
    assert.equal(await staffA.catalog.getMyPersonalTemplateDelegation(), null);

    // 2. Kurallar: auditLogs kaydı olmadan, 7 günü aşan süreyle veya personel tarafından sahte vekâlet yazılamaz.
    const fakeAuditId = webcrypto.randomUUID();
    const validExp = sdk.Timestamp.fromMillis(Date.now() + 24 * 3600000);
    const tooLongExp = sdk.Timestamp.fromMillis(Date.now() + 8 * 24 * 3600000);
    await assertFails(sdk.setDoc(ref(admin.store, 'ebysDelegations', 'pt_a'), {
        id: 'pt_a', ownerUid: 'a', delegateUid: 'owner', scope: 'personalTemplates',
        reason: 'Denetim kaydı olmadan sızma denemesi', expiresAt: validExp, revoked: false,
        auditId: fakeAuditId, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), createdBy: 'owner',
    }));
    await assertFails(sdk.setDoc(ref(staffB.store, 'ebysDelegations', 'pt_a'), {
        id: 'pt_a', ownerUid: 'a', delegateUid: 'b', scope: 'personalTemplates',
        reason: 'Personel B sahte vekâlet denemesi', expiresAt: validExp, revoked: false,
        auditId: fakeAuditId, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), createdBy: 'b',
    }));
    // 7 günü aşan süre (denetim kaydı aynı batch'te yazılsa dahi) reddedilir.
    const overBatch = sdk.writeBatch(admin.store);
    const overAuditId = webcrypto.randomUUID();
    overBatch.set(ref(admin.store, 'ebysDelegations', 'pt_a'), {
        id: 'pt_a', ownerUid: 'a', delegateUid: 'owner', scope: 'personalTemplates',
        reason: '8 günlük aşırı süreli vekâlet', expiresAt: tooLongExp, revoked: false,
        auditId: overAuditId, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), createdBy: 'owner',
    });
    overBatch.set(ref(admin.store, 'auditLogs', overAuditId), {
        id: overAuditId, type: 'ebys-vekalet-verildi', refCol: 'ebysDelegations', refId: 'pt_a',
        item: 'Kişisel Şablon Vekâleti (a)', actorName: 'Yönetici', uid: 'owner', result: 'approved',
        reason: '8 günlük aşırı süreli vekâlet', ts: sdk.serverTimestamp(),
    });
    await assertFails(overBatch.commit());

    // 3. Yönetici geçerli, denetim kayıtlı vekâlet tanımlar → salt-okunur (get + list) erişim açılır.
    const granted = await admin.catalog.grantPersonalTemplateDelegation({
        ownerUid: 'a',
        reason: 'Yıllık izin süresince kurumsal yazışma sürekliliği',
        durationHours: 24,
    });
    assert.equal(granted.id, 'pt_a');
    assert.equal(granted.revoked, false);

    // Denetim kaydı gerçekten oluşmuş olmalı.
    const auditSnap = await sdk.getDoc(ref(admin.store, 'auditLogs', granted.auditId));
    assert.equal(auditSnap.exists(), true);
    assert.equal(auditSnap.data().type, 'ebys-vekalet-verildi');

    // Yönetici artık A'nın kişisel şablonlarını listeleyebilir ve tekil okuyabilir.
    const delegatedList = await admin.catalog.listDelegatedPersonalTemplates('a');
    assert.equal(delegatedList.length, 1);
    assert.equal(delegatedList[0].id, tpl.id);
    await assertSucceeds(sdk.getDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id)));

    // Ancak yönetici vekâletle dahi A'nın kişisel şablonunu değiştiremez, silemez veya A adına yeni şablon yaratamaz!
    await assertFails(sdk.updateDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id), {
        name: 'Yönetici Değiştirdi', updatedAt: sdk.serverTimestamp(),
    }));
    await assertFails(sdk.deleteDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id)));
    const forgedId = webcrypto.randomUUID();
    await assertFails(sdk.setDoc(ref(admin.store, 'ebysPersonalTemplates', forgedId), {
        id: forgedId, ownerUid: 'a', name: 'Sahte', subject: '', content: 'x',
        createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
    }));

    // 4. KVKK Şeffaflığı: Personel A kendi üzerindeki aktif vekâleti okuyabilir; Personel B okuyamaz ve A'nın şablonuna erişemez.
    const myDel = await staffA.catalog.getMyPersonalTemplateDelegation();
    assert.equal(myDel?.ownerUid, 'a');
    assert.equal(myDel?.reason, 'Yıllık izin süresince kurumsal yazışma sürekliliği');
    await assertFails(sdk.getDoc(ref(staffB.store, 'ebysDelegations', 'pt_a')));
    await assertFails(sdk.getDoc(ref(staffB.store, 'ebysPersonalTemplates', tpl.id)));

    // Vekâlet belgesi silinemez (iz korunur).
    await assertFails(sdk.deleteDoc(ref(admin.store, 'ebysDelegations', 'pt_a')));

    // 5. Yönetici vekâleti sonlandırdığında (revoked: true) okuma erişimi anında kapanır.
    const revoked = await admin.catalog.revokePersonalTemplateDelegation({
        ownerUid: 'a',
        reason: 'Personel izinden döndü, vekâlet sonlandırıldı.',
    });
    assert.equal(revoked.revoked, true);
    await assertFails(sdk.getDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id)));
    await assert.rejects(admin.catalog.listDelegatedPersonalTemplates('a'));
    assert.equal(await staffA.catalog.getMyPersonalTemplateDelegation(), null);

    // 6. Süresi dolmuş (expiresAt <= request.time) vekâlet, revoked:false kalsa dahi erişim vermez.
    await env.withSecurityRulesDisabled(c => sdk.updateDoc(ref(c.firestore(), 'ebysDelegations', 'pt_a'), {
        revoked: false,
        expiresAt: sdk.Timestamp.fromMillis(Date.now() - 60000),
    }));
    await assertFails(sdk.getDoc(ref(admin.store, 'ebysPersonalTemplates', tpl.id)));
    await assert.rejects(admin.catalog.listDelegatedPersonalTemplates('a'));
});
