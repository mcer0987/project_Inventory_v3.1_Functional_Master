// v3.4 EBYS H8 · Birleşik kabul: H6b katalog + dövizli satın alma + H7 yazışma + QR/arşiv + kişisel kopya + kurtarma provası.
// Gerçek servisler (vm) + firestore.rules (emülatör 127.0.0.1:8180). Ölçüm: scratch/ebys-h8-evidence/recovery-measurements.json
// Usage: npm run test:rules
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { captureRecovery, restoreRecovery, recoveryCollections } from '../../tools/ebys-local-recovery.mjs';
import { sdk, root, uuid, ref, contextDb, actor, input, fx, seed, route, plain } from './helpers/ebys-purchase-harness.mjs';

const project = 'demo-ebys-h8-source', targetProject = 'demo-ebys-h8-target';
const rules = readFileSync('firestore.rules', 'utf8');
const catalogCollections = ['ebysOrganizations', 'ebysOrganizationRevisions', 'ebysFilePlans', 'ebysLetterTemplates', 'ebysLetterTemplateRevisions'];
const profile = { name: 'Medipol Üniversitesi', code: 'MED', address: 'Kavacık, Beykoz / İstanbul', phone: '0216 000 00 00',
    email: 'evrak@medipol.edu.tr', web: '' };
const meta = extra => ({ subject: 'Konu', correspondent: 'Sağlık Bakanlığı', date: '2026-11-10', filePlanCode: '100',
    filePlanTitle: 'İdari İşler', confidentiality: 'Normal', distribution: '', externalRegistrationNo: '', ...extra });
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });
let env;
before(async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
    env = await initializeTestEnvironment({ projectId: project, firestore: { rules } });
});
after(async () => env?.cleanup());

// Spark ölçümü: senaryo başına servis okumaları (tekil + transaction + sorgu sonucu) ve kesinleşen yazmalar.
const scenarios = new Map();
let current;
const use = name => {
    if (!scenarios.has(name)) scenarios.set(name, { actors: [], extraReads: 0, extraWrites: 0 });
    current = scenarios.get(name);
};
const who = (testEnv, uid) => {
    const a = actor(testEnv, uid);
    current.actors.push(a);
    return a;
};
function sparkSummary() {
    return Object.fromEntries([...scenarios].map(([name, s]) => {
        const reads = s.actors.reduce((n, a) => n + a.metrics.reads.length +
            a.metrics.queries.reduce((q, size) => q + Math.max(1, size), 0), 0) + s.extraReads;
        const writes = s.actors.reduce((n, a) => n + a.metrics.committed.length, 0) + s.extraWrites;
        const transactions = s.actors.reduce((n, a) => n + a.metrics.attempts, 0);
        return [name, { reads, writes, transactions }];
    }));
}

test('H8 birleşik kabul: katalog, satın alma, yazışma, QR/arşiv, kişisel kopya ve kurtarma provası', async () => {
    await seed(env);
    await env.withSecurityRulesDisabled(async c => {
        for (const [kind, assignee] of [['incoming', 'e'], ['outgoing', 'f']]) {
            await sdk.setDoc(ref(c.firestore(), 'ebysExecutionPolicies', kind + '__unit'),
                { kind, sourceUnitId: 'unit', unitId: 'unit', personnelId: assignee, assigneeUid: assignee, dueHours: 72 });
        }
    });
    const read = async (uid, collection, id) => (await sdk.getDoc(ref(contextDb(env, uid), collection, id))).data();

    // ── 1 · H6b kurum kataloğu: künye v1, dosya planı 100, üst yazı şablonu v1 ──
    use('catalog');
    const admin = who(env, 'admin');
    assert.equal((await admin.catalog.saveProfile(profile)).revision, 1);
    await admin.catalog.saveFilePlan({ code: '100', title: 'İdari İşler' }, { create: true });
    const tpl = await admin.catalog.saveTemplate({ name: 'Cevap Üst Yazısı', subject: 'Bilgi', content: 'Gereğini bilgilerinize arz ederim.' });
    const tplRev = await who(env, 'd').catalog.getTemplateRevision(tpl.id, 1);
    const letterTemplate = { templateId: tpl.id, revision: 1, name: tplRev.name };
    await denied(sdk.setDoc(ref(contextDb(env, 'd'), 'ebysFilePlans', '200'), { id: '200', code: '200', title: 'Sahte', active: true,
        revision: 1, createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), updatedBy: 'd' }));

    // ── 2 · Satın alma → sıralı onay → kur kilidi → icra → QR → arşiv ──
    use('purchase');
    const owner = who(env, 'owner');
    const draft = await owner.save(input());
    const purchaseOrderId = draft.documentId;
    const registered = await owner.documents.registerDocument({ documentId: purchaseOrderId, expectedRevision: draft.revision });
    const { versionId: purchaseVersionId } = await owner.freeze({ documentId: purchaseOrderId, expectedRevision: registered.revision });
    const key = { purchaseOrderId, versionId: purchaseVersionId };
    await owner.processes.startProcess({ documentId: purchaseOrderId, versionId: purchaseVersionId, route: route(['a', 'b']) });
    const approver = who(env, 'a');
    const fxPreview = await approver.preview(key);
    assert.equal(fxPreview.reportingTotalTRY, 2317.23);
    await approver.processes.decideTask({ processId: purchaseVersionId, expectedRevision: 1, result: 'approved', fxPreview: fxPreview.rateSource, reason: '' });
    const locked = plain((await owner.view(key)).finance);
    assert.deepEqual(locked.exchangeRate, fx.rates);
    assert.equal(locked.actorUid, 'a');
    const newFx = { ...fx, rates: { TRY: 1, USD: 37, EUR: 42 } };
    await sdk.setDoc(ref(contextDb(env, 'admin'), 'system_config', 'ebys_rates'), newFx);
    current.extraWrites++;
    await who(env, 'b').processes.decideTask({ processId: purchaseVersionId, expectedRevision: 2, result: 'approved', fxPreview: newFx, reason: '' });
    assert.deepEqual(plain((await owner.view(key)).finance), locked, 'kur değişimi kilitli mali kaydı değiştirmez');
    const jobs = await sdk.getDocs(sdk.query(sdk.collection(contextDb(env, 'admin'), root, 'ebysExecutionJobs', 'items'),
        sdk.where('documentId', '==', purchaseOrderId)));
    assert.deepEqual(jobs.docs.map(job => [job.id, job.data().assigneeUid, job.data().state]), [[purchaseVersionId, 'worker', 'pending_acceptance']]);
    const worker = who(env, 'worker');
    await worker.execution.acceptExecutionJob(purchaseVersionId, 1);
    await worker.execution.completeExecutionJob(purchaseVersionId, 2, { note: 'Teslim alındı', evidenceRef: 'Tutanak 2026/88' });
    const purchaseToken = await owner.verification.issueVerification(purchaseOrderId);
    await who(env, 'admin').verification.archiveExecutionDocument(purchaseVersionId);
    assert.equal((await read('owner', 'ebysDocuments', purchaseOrderId)).state, 'archived');

    // ── 3 · Gelen evrak: şablon + plan + künye kopyası, kesin kayıt, mükerrer anahtarı, onay ve icra ──
    use('incoming');
    const d = who(env, 'd');
    const incomingId = uuid();
    const incomingMeta = meta({ subject: 'Laboratuvar envanter bilgisi talebi', externalRegistrationNo: 'E-12345/67' });
    assert.equal((await d.correspondence.checkIncomingDuplicate(incomingMeta)).duplicate, false);
    const inDraft = await d.documents.saveDraft({ id: incomingId, operationId: uuid(), expectedRevision: 0, kind: 'incoming', unitId: 'unit',
        organizationCode: 'MED', content: tplRev.content, metadata: incomingMeta, letterTemplate });
    assert.deepEqual((await read('d', 'ebysDrafts', incomingId)).institutionSnapshot, { ...profile, revision: 1 });
    const inReg = await d.documents.registerDocument({ documentId: incomingId, expectedRevision: inDraft.revision });
    const incomingKey = await d.correspondence.registerIncomingKey({ documentId: incomingId, unitId: 'unit',
        registrationNo: inReg.registrationNo, metadata: incomingMeta });
    assert.equal(incomingKey.status, 'registered');
    const { versionId: incomingVersionId } = await d.documents.freezeVersion({ documentId: incomingId, expectedRevision: inReg.revision });
    await d.processes.startProcess({ documentId: incomingId, versionId: incomingVersionId,
        route: [{ personnelId: 'a', kind: 'approval', dueHours: 72 }] });
    await who(env, 'a').processes.decideTask({ processId: incomingVersionId, expectedRevision: 1, result: 'approved', reason: '' });
    const inWorker = who(env, 'e');
    await inWorker.execution.acceptExecutionJob(incomingVersionId, 1);
    await inWorker.execution.completeExecutionJob(incomingVersionId, 2, { note: 'Birime havale edildi', evidenceRef: 'Zimmet 12' });
    assert.equal((await read('d', 'ebysDocuments', incomingId)).state, 'closed');

    // İkinci aktör aynı kurum + dış sayı + tarih (büyük/küçük harf ve noktalama farkıyla) mükerrer uyarısı alır, anahtarı ezemez.
    use('duplicate');
    const other = who(env, 'c');
    const variant = { correspondent: '  SAĞLIK BAKANLIĞI. ', externalRegistrationNo: 'e.12345-67', date: '2026-11-10' };
    const duplicate = plain(await other.correspondence.checkIncomingDuplicate(variant));
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.key, incomingKey.key);
    assert.deepEqual(Object.keys(duplicate.record).sort(), ['createdAt', 'documentId', 'id', 'registrationNo', 'unitId']);
    assert.equal(duplicate.record.documentId, incomingId);
    const otherId = uuid(), otherMeta = meta({ ...variant, subject: 'Aynı yazının ikinci kaydı' });
    const otherDraft = await other.documents.saveDraft({ id: otherId, operationId: uuid(), expectedRevision: 0, kind: 'incoming',
        unitId: 'unit', organizationCode: 'MED', content: 'Mükerrer gelen evrak.', metadata: otherMeta });
    const otherReg = await other.documents.registerDocument({ documentId: otherId, expectedRevision: otherDraft.revision });
    const taken = await other.correspondence.registerIncomingKey({ documentId: otherId, unitId: 'unit',
        registrationNo: otherReg.registrationNo, metadata: otherMeta });
    assert.equal(taken.status, 'already-taken');
    assert.equal(taken.key, incomingKey.key);
    await denied(sdk.setDoc(ref(contextDb(env, 'c'), 'ebysIncomingKeys', incomingKey.key), { id: incomingKey.key, documentId: otherId,
        ownerUid: 'c', unitId: 'unit', registrationNo: otherReg.registrationNo, createdAt: sdk.serverTimestamp() }));
    assert.equal((await read('c', 'ebysIncomingKeys', incomingKey.key)).documentId, incomingId);

    // Künye v2: yeni evrak yeni künyeyi alır; dondurulmuş gelen evrak ve künye geçmişi değişmez.
    use('catalog');
    const incomingVersion = await read('d', 'ebysVersions', incomingVersionId);
    assert.equal((await who(env, 'admin').catalog.saveProfile({ ...profile, address: 'Göztepe, Bağcılar / İstanbul' },
        { expectedRevision: 1 })).revision, 2);

    // ── 4 · Gelen evraka cevap: İlgi satırı, cevap bağı, onay, manuel gönderim (idempotent), kapanış ve QR ──
    use('reply-dispatch');
    const author = who(env, 'd');
    const summary = { registrationNo: inReg.registrationNo, externalRegistrationNo: incomingMeta.externalRegistrationNo,
        date: incomingMeta.date, correspondent: incomingMeta.correspondent, subject: incomingMeta.subject };
    const interest = author.window.AppModules.EBYSCorrespondenceSchema.formatInterestLine(summary);
    assert.match(interest, /^İlgi: 2026-11-10 tarihli ve E-12345\/67 sayılı yazınız/);
    const outgoingId = uuid();
    const outDraft = await author.documents.saveDraft({ id: outgoingId, operationId: uuid(), expectedRevision: 0, kind: 'outgoing',
        unitId: 'unit', organizationCode: 'MED', content: interest + '\n\n' + tplRev.content, letterTemplate,
        metadata: meta({ subject: 'Envanter bilgisi talebine cevap', date: '2026-11-12' }) });
    const link = plain(await author.correspondence.createReplyLink({ replyDocumentId: outgoingId, replyToDocumentId: incomingId }));
    assert.deepEqual(link.replyToSummary, summary);
    assert.equal(link.replyToVersionId, incomingVersionId);
    assert.equal(plain(await author.correspondence.createReplyLink({ replyDocumentId: outgoingId, replyToDocumentId: incomingId })).replyToVersionId,
        incomingVersionId);
    await assert.rejects(who(env, 'c').correspondence.createReplyLink({ replyDocumentId: otherId, replyToDocumentId: incomingId }));
    const outReg = await author.documents.registerDocument({ documentId: outgoingId, expectedRevision: outDraft.revision });
    const { versionId: outgoingVersionId } = await author.documents.freezeVersion({ documentId: outgoingId, expectedRevision: outReg.revision });
    const outgoingVersion = await read('d', 'ebysVersions', outgoingVersionId);
    assert.deepEqual([outgoingVersion.institutionSnapshot.revision, outgoingVersion.metadataSnapshot.filePlanTitle, outgoingVersion.letterTemplate],
        [2, 'İdari İşler', letterTemplate]);
    await author.processes.startProcess({ documentId: outgoingId, versionId: outgoingVersionId, route: route(['a', 'b']) });
    await who(env, 'a').processes.decideTask({ processId: outgoingVersionId, expectedRevision: 1, result: 'approved', reason: '' });
    await who(env, 'b').processes.decideTask({ processId: outgoingVersionId, expectedRevision: 2, result: 'approved', reason: '' });
    assert.equal((await read('d', 'ebysDocuments', outgoingId)).state, 'internally_approved');
    const dispatcher = who(env, 'f');
    const base = { documentId: outgoingId, versionId: outgoingVersionId, note: '', entryKind: 'initial' };
    const hand = { ...base, channel: 'hand', sentDate: daysAgo(2), externalRef: 'Teslim tutanağı 2026/41', operationId: uuid() };
    const first = plain(await dispatcher.correspondence.recordDispatch(hand));
    assert.equal(plain(await dispatcher.correspondence.recordDispatch(hand)).id, first.id, 'aynı operationId ikinci kayıt açmaz');
    await assert.rejects(dispatcher.correspondence.recordDispatch({ ...hand, externalRef: 'Başka tutanak' }), /farklı içerikle/);
    await assert.rejects(dispatcher.correspondence.recordDispatch({ ...hand, operationId: uuid(), sentDate: daysAgo(-2) }), /gelecekte/);
    const kep = { ...base, channel: 'kep', sentDate: daysAgo(1), externalRef: 'KEP-2026-0099', operationId: uuid() };
    await dispatcher.correspondence.recordDispatch(kep);
    await assert.rejects(author.correspondence.recordDispatch({ ...kep, entryKind: 'correction', operationId: uuid() }), /gerekçe/);
    await author.correspondence.recordDispatch({ ...kep, entryKind: 'correction', note: 'KEP alındı tarihi düzeltildi.', operationId: uuid() });
    const dispatches = plain(await author.correspondence.listDispatches(outgoingId));
    assert.equal(dispatches.length, 3);
    assert.deepEqual(dispatches.map(row => row.entryKind).sort(), ['correction', 'initial', 'initial']);
    const outWorker = who(env, 'f');
    await outWorker.execution.acceptExecutionJob(outgoingVersionId, 1);
    await outWorker.execution.completeExecutionJob(outgoingVersionId, 2, { note: 'Gönderildi', evidenceRef: 'KEP-2026-0099' });
    const outgoingToken = await author.verification.issueVerification(outgoingId);

    // Plan güncellemesi (pasife alma): dondurulmuş sürümler ve künye geçmişi aynı kalır.
    use('catalog');
    await who(env, 'admin').catalog.setFilePlanActive('100', false, { expectedRevision: 1 });
    assert.deepEqual(await read('d', 'ebysVersions', incomingVersionId), incomingVersion);
    assert.equal(incomingVersion.institutionSnapshot.revision, 1);
    assert.deepEqual((await read('d', 'ebysOrganizationRevisions', '1')).profile, profile);

    // ── 5 · Kişisel kopya: katalog dışlanır, H7 yetkili kapsamda, satın alma ve QR tam ──
    use('personal-copy');
    const authorCopy = plain(await who(env, 'd').documents.exportOwnDocuments());
    for (const name of recoveryCollections.filter(name => name.startsWith('ebys'))) {
        assert.ok(authorCopy.manifest.collections[name], 'manifestoda eksik koleksiyon: ' + name);
    }
    for (const name of catalogCollections) {
        assert.deepEqual(authorCopy.data[name], []);
        assert.deepEqual(authorCopy.manifest.collections[name],
            { status: 'excluded', scope: 'institutional-catalog', count: 0, reason: 'institutional-catalog-definition' });
    }
    assert.deepEqual(authorCopy.manifest.collections.ebysReplyLinks, { status: 'included', scope: 'reply-or-target-owner', count: 1 });
    assert.deepEqual(authorCopy.manifest.collections.ebysDispatches, { status: 'included', scope: 'owner-or-actor', count: 3 });
    assert.equal(authorCopy.manifest.collections.ebysIncomingKeys.status, 'excluded');
    assert.deepEqual(authorCopy.data.ebysVerifications.map(row => row.id), [outgoingToken]);
    const dispatcherCopy = plain(await who(env, 'f').documents.exportOwnDocuments());
    assert.equal(dispatcherCopy.manifest.collections.ebysDispatches.count, 2);
    assert.deepEqual(dispatcherCopy.data.ebysReplyLinks, []);
    const ownerCopy = plain(await who(env, 'owner').documents.exportOwnDocuments());
    assert.equal(ownerCopy.schemaVersion, 3);
    assert.deepEqual([ownerCopy.manifest.purchases.referenced, ownerCopy.manifest.purchases.included], [2, 2]);
    assert.equal(ownerCopy.data.purchaseFinanceVersions[0].data.exchangeRate.USD, 35);
    assert.deepEqual(ownerCopy.data.ebysVerifications.map(row => [row.id, row.status]), [[purchaseToken, 'archived']]);

    // ── 6 · Kurumsal kurtarma provası: yakalama, önizleme, bozuk paket reddi, geri yükleme ──
    const source = { host: process.env.FIRESTORE_EMULATOR_HOST, project, root, quiescent: true };
    const target = { ...source, project: targetProject };
    const { bundle, stats } = await captureRecovery(source);
    assert.equal(bundle.format, 'ebys-emulator-recovery-v2');
    assert.deepEqual(catalogCollections.map(name => bundle.counts[name]), [1, 2, 1, 1, 1]);
    assert.deepEqual(['ebysReplyLinks', 'ebysIncomingKeys', 'ebysDispatches'].map(name => bundle.counts[name]), [1, 1, 3]);
    assert.deepEqual([bundle.counts.purchaseOrders, bundle.counts.purchaseFinance], [1, 1]);
    const targetEnv = await initializeTestEnvironment({ projectId: targetProject, firestore: { rules } });
    try {
        await targetEnv.clearFirestore();
        const preview = await restoreRecovery(target, bundle);
        assert.equal(preview.applied, false);
        assert.equal(preview.stats.documentsWritten, 0);
        const schema = { window: {} };
        runInNewContext(readFileSync('src/utils/ebys-document-schema.js', 'utf8'), schema);
        const canonical = schema.window.AppModules.EBYSDocumentSchema.canonical;
        const row = (draft, collection, id) => draft.rows.find(r => r.collection === collection && (id === undefined || r.id === id));
        const fields = (r, name) => r.fields[name].mapValue.fields;
        const corrupt = [
            [draft => { draft.rows = draft.rows.filter(r => !(r.collection === 'ebysOrganizationRevisions' && r.id === '1')); },
                /Eksik paket ilişkisi: ebysOrganizationRevisions/],
            [draft => { fields(row(draft, 'ebysOrganizationRevisions', '2'), 'profile').address.stringValue = 'Sahte adres'; },
                /güncel künyeyle uyuşmuyor/],
            [draft => { fields(row(draft, 'ebysOrganizationRevisions', '1'), 'profile').name.stringValue = 'Sahte kurum'; },
                /künye kopyası revizyonla uyuşmuyor/],
            [draft => { draft.rows = draft.rows.filter(r => r.collection !== 'ebysLetterTemplateRevisions'); },
                /Eksik paket ilişkisi: ebysLetterTemplateRevisions/],
            [draft => {
                const p = row(draft, 'ebysFilePlans', '100').fields;
                p.revision.integerValue = '1';
                p.title.stringValue = 'Mali İşler';
            }, /dosya planı katalogla uyuşmuyor/],
            [draft => { fields(row(draft, 'ebysReplyLinks', outgoingId), 'replyToSummary').subject.stringValue = 'Tahrif edilmiş konu'; },
                /İlgi özeti/],
            [draft => { const r = row(draft, 'ebysIncomingKeys'); r.id = 'f'.repeat(64); r.fields.id.stringValue = r.id; },
                /üstverisinden üretilmemiş/],
            [draft => { row(draft, 'ebysDispatches', hand.operationId).fields.documentId.stringValue = incomingId; },
                /Gönderim kaydının evrakı/],
            [draft => {
                const r = row(draft, 'ebysDispatches', hand.operationId);
                r.fields.sentDate.stringValue = new Date(Date.parse(r.fields.createdAt.timestampValue) + 86400000).toISOString().slice(0, 10);
            }, /Gönderim kaydı geçersiz/]
        ];
        for (const [mutate, error] of corrupt) {
            const { digest: ignored, ...draft } = structuredClone(bundle);
            mutate(draft);
            const digest = createHash('sha256').update(canonical(draft)).digest('hex');
            await assert.rejects(restoreRecovery({ ...target, apply: true }, { ...draft, digest }), error);
        }
        const restored = await restoreRecovery({ ...target, apply: true }, bundle);
        assert.equal(restored.stats.documentsWritten, bundle.rows.length);

        use('restored-target');
        const restoredOwner = who(targetEnv, 'owner');
        const view = plain(await restoredOwner.view(key));
        assert.deepEqual(view.finance, locked);
        assert.equal(view.version.content, input().content);
        const restoredAuthor = who(targetEnv, 'd');
        const outgoingContext = plain(await restoredAuthor.correspondence.getReplyContext(outgoingId));
        assert.equal(outgoingContext.replyTo.replyToDocumentId, incomingId);
        assert.deepEqual(outgoingContext.replyTo.replyToSummary, summary);
        const incomingContext = plain(await restoredAuthor.correspondence.getReplyContext(incomingId));
        assert.deepEqual(incomingContext.replies.map(reply => reply.replyDocumentId), [outgoingId]);
        assert.equal((await restoredAuthor.correspondence.listDispatches(outgoingId)).length, 3);
        const restoredCatalog = plain(await restoredAuthor.catalog.loadCatalog());
        assert.deepEqual([restoredCatalog.profile.revision, restoredCatalog.filePlans[0].active, restoredCatalog.templates[0].currentRevision],
            [2, false, 1]);
        assert.equal((await who(targetEnv, 'c').correspondence.checkIncomingDuplicate(variant)).duplicate, true);
        const anon = targetEnv.unauthenticatedContext().firestore();
        for (const [token, status] of [[purchaseToken, 'archived'], [outgoingToken, 'valid']]) {
            const qr = (await sdk.getDoc(ref(anon, 'ebysVerifications', token))).data();
            assert.deepEqual(Object.keys(qr).sort(), ['contentDigest', 'registeredAt', 'registrationNo', 'status', 'subjectSummary']);
            assert.equal(qr.status, status);
            current.extraReads++;
        }
        await denied(sdk.getDoc(ref(anon, 'ebysReplyLinks', outgoingId)));
        await denied(sdk.getDoc(ref(anon, 'ebysDispatches', hand.operationId)));
        await assert.rejects(restoreRecovery({ ...target, apply: true }, bundle), /Hedef dolu/);

        const spark = sparkSummary();
        const serviceReads = Object.values(spark).reduce((n, s) => n + s.reads, 0);
        const serviceWrites = Object.values(spark).reduce((n, s) => n + s.writes, 0);
        const recoveryReads = stats.documentsRead + preview.stats.documentsRead + restored.stats.documentsRead;
        const totalReads = serviceReads + recoveryReads, totalWrites = serviceWrites + restored.stats.documentsWritten;
        mkdirSync('scratch/ebys-h8-evidence', { recursive: true });
        writeFileSync('scratch/ebys-h8-evidence/recovery-measurements.json', JSON.stringify({
            generatedAt: new Date().toISOString(), sourceProject: project, targetProject,
            documents: bundle.rows.length, maxDocuments: 300, bundleBytes: Buffer.byteLength(JSON.stringify(bundle)), counts: bundle.counts,
            capture: stats, preview: preview.stats, restore: restored.stats, purchaseManifest: bundle.purchaseManifest,
            personalCopyReads: { author: authorCopy.manifest.reads, dispatcher: dispatcherCopy.manifest.reads, purchaseOwner: ownerCopy.manifest.reads },
            scenarios: spark,
            spark: {
                dailyReadLimit: 50000, dailyWriteLimit: 20000, serviceReads, serviceWrites, recoveryReads,
                recoveryWrites: restored.stats.documentsWritten, totalReads, totalWrites,
                readSharePercent: Number((totalReads / 500).toFixed(2)), writeSharePercent: Number((totalWrites / 200).toFixed(2)),
                note: 'Rules get()/exists() okumaları emülatörde sayılmaz; üretimde bu değerlerin üstüne eklenir.'
            }
        }, null, 2) + '\n');
    } finally {
        await targetEnv.cleanup();
    }
});
