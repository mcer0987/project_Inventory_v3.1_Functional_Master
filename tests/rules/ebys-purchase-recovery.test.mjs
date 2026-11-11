import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { captureRecovery, restoreRecovery } from '../../tools/ebys-local-recovery.mjs';
import { sdk, root, uuid, ref, financeRef, contextDb, actor, input, fx, seed, route, plain } from './helpers/ebys-purchase-harness.mjs';

const project = 'demo-ebys-h4-recovery-source', targetProject = 'demo-ebys-h4-recovery-target';
const rules = readFileSync('firestore.rules', 'utf8');
let env;
before(async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8180');
    env = await initializeTestEnvironment({ projectId: project, firestore: { rules } });
});
beforeEach(async () => seed(env));
after(async () => env?.cleanup());

async function draftAndFreeze(owner, fields = {}, register = false) {
    const draft = await owner.save({ ...input(), ...fields });
    const saved = register ? await owner.documents.registerDocument({
        documentId: draft.documentId, expectedRevision: draft.revision
    }) : draft;
    return owner.freeze({ documentId: draft.documentId, expectedRevision: saved.revision });
}
async function decide(who, versionId, expectedRevision, result = 'approved', fxPreview = fx) {
    return actor(env, who).processes.decideTask({ processId: versionId, expectedRevision, result, fxPreview,
        reason: result === 'approved' ? '' : 'Düzeltme' });
}
const denied = promise => assert.rejects(promise, { code: 'permission-denied' });

test('H4 satın alma görünümü ve önizleme açık V ile sınırlı, boş finans ve ret ayrı', async () => {
    const owner = actor(env, 'owner');
    const draft = await owner.save(input());
    const draftView = await owner.view({ purchaseOrderId: draft.documentId });
    assert.equal(draftView.mode, 'draft');
    assert.equal(draftView.draft.purchaseSnapshot.butce, 120000);
    await denied(actor(env, 'stranger').view({ purchaseOrderId: draft.documentId }));
    const { versionId } = await owner.freeze({ documentId: draft.documentId, expectedRevision: draft.revision });
    await owner.processes.startProcess({ documentId: draft.documentId, versionId, route: [{ ...route(['a'])[0], kind: 'approval' }] });
    const key = { purchaseOrderId: draft.documentId, versionId };
    const approver = actor(env, 'a');
    const visible = await approver.view(key);
    assert.equal(visible.mode, 'version');
    assert.equal(visible.finance, null);
    assert.equal(visible.version.content, input().content);
    assert.equal(approver.metrics.reads.length, 2);
    assert.ok(approver.metrics.reads.every(path => path.includes(versionId)));
    await denied(actor(env, 'admin').view(key));
    await assert.rejects(approver.view({ ...key, purchaseOrderId: uuid() }));
    const preview = await approver.preview(key);
    assert.equal(preview.reportingTotalTRY, 2317.23);
    assert.deepEqual(plain(preview.rateSource), fx);
    await env.withSecurityRulesDisabled(ctx => sdk.deleteDoc(ref(ctx.firestore(), 'system_config', 'ebys_rates')));
    await assert.rejects(decide('a', versionId, 1), { code: 'purchase-rates-unavailable' });
    assert.equal((await approver.view(key)).finance, null);
    assert.equal((await owner.processes.getProcess(versionId)).revision, 1);
    await env.withSecurityRulesDisabled(ctx => sdk.setDoc(ref(ctx.firestore(), 'system_config', 'ebys_rates'), fx));
    await decide('a', versionId, 1, 'approved', preview.rateSource);
    assert.equal((await approver.view(key)).finance.actorUid, 'a');
});

test('H4 aynı komutun kayıp yanıtı geri okunur, oturum/kök değişimi veya başka payload başarı sayılmaz', async () => {
    const id = uuid(), operationId = uuid(), payload = { ...input(), id, operationId };
    const owner = actor(env, 'owner', { lostResponse: true });
    const created = await owner.save(payload);
    assert.equal(created.documentId, id);
    assert.equal(owner.metrics.committed.length, 5);
    assert.equal(owner.metrics.reads.filter(path => path.endsWith(operationId)).length, 2);
    await assert.rejects(owner.save({ ...payload, content: 'Başka içerik' }), /farklı içerik/);
    const otherId = uuid();
    const moved = actor(env, 'owner', { onRead: (path, window) => {
        if (path.path.includes('/units/')) window.AppEnv.COLLECTION_ROOT = 'lifeserver_master';
    } });
    await assert.rejects(moved.save({ ...input(), id: otherId }), /Oturum veya ortam değişti/);
    assert.equal(moved.metrics.committed.length, 0);
    await env.withSecurityRulesDisabled(async ctx => {
        for (const name of ['purchaseOrders', 'ebysDocuments', 'ebysDrafts']) {
            assert.equal((await sdk.getDoc(ref(ctx.firestore(), name, otherId))).exists(), false);
        }
    });
    const saveMetrics = structuredClone(owner.metrics);
    const freezeId = uuid();
    const frozen = await owner.freeze({ documentId: id, expectedRevision: 1, operationId: freezeId });
    const freezeReplay = actor(env, 'owner');
    assert.deepEqual(await freezeReplay.freeze({ documentId: id, expectedRevision: 1, operationId: freezeId }), frozen);
    assert.equal(freezeReplay.metrics.reads.length, 1);
    assert.equal(freezeReplay.metrics.writes.length, 0);
    const normal = actor(env, 'owner');
    await normal.processes.startProcess({ documentId: id, versionId: frozen.versionId, route: route(['a']) });
    const lost = actor(env, 'a', { lostResponse: true });
    const decision = { processId: frozen.versionId, expectedRevision: 1, result: 'approved', fxPreview: fx, operationId: uuid() };
    const completed = await lost.processes.decideTask(decision);
    assert.equal(completed.revision, 2);
    assert.equal(lost.metrics.committed.length, 7);
    assert.deepEqual(plain(await actor(env, 'a').processes.decideTask(decision)), plain(completed));
    assert.equal((await normal.view({ purchaseOrderId: id, versionId: frozen.versionId })).finance.operationId, decision.operationId);
    mkdirSync('scratch/ebys-h4-evidence', { recursive: true });
    writeFileSync('scratch/ebys-h4-evidence/retry-measurements.json', JSON.stringify({
        saveLostAndMismatch: saveMetrics, freezeReplay: freezeReplay.metrics, decisionLost: lost.metrics
    }, null, 2));
});

test('H4 legacy kalemsiz ve kalemli görünüm, aynı UUID üzerinde sonradan bağ kurmayı engeller', async () => {
    const owner = actor(env, 'owner'), id = uuid(), itemId = uuid();
    await env.withSecurityRulesDisabled(async ctx => {
        await sdk.setDoc(ref(ctx.firestore(), 'purchaseOrders', id), { id, createdByUid: 'owner', urun: 'Eski ürün', adet: 1, workflow: {} });
        await sdk.setDoc(ref(ctx.firestore(), 'purchaseOrders', itemId), { id: itemId, createdByUid: 'owner',
            engineVersion: 'legacy', items: input().items, workflow: {} });
    });
    const legacy = await owner.view({ purchaseOrderId: id });
    assert.equal(legacy.engine, 'legacy');
    assert.equal(legacy.items[0].taxRate, null);
    assert.equal((await owner.view({ purchaseOrderId: itemId })).items.length, 3);
    await assert.rejects(owner.save({ ...input(), id }), /kimliği kullanılıyor/);
    assert.equal((await sdk.getDoc(ref(owner.db, 'ebysDocuments', id))).exists(), false);
    assert.equal((await sdk.getDoc(ref(owner.db, 'purchaseOrders', id))).data().urun, 'Eski ürün');
});

test('H4 kişisel kopya ve demo kurtarma V1/V2 finansını, kapanışı ve kamusal QR kapsamını korur', async () => {
    const owner = actor(env, 'owner');
    const v1 = await draftAndFreeze(owner, {}, true), purchaseOrderId = v1.documentId;
    await owner.processes.startProcess({ documentId: purchaseOrderId, versionId: v1.versionId, route: route(['a', 'b', 'f']) });
    await decide('a', v1.versionId, 1);
    await decide('b', v1.versionId, 2, 'returned');
    const v1Quote = await actor(env, 'a').view({ purchaseOrderId, versionId: v1.versionId });
    const head = (await sdk.getDoc(ref(owner.db, 'ebysDocuments', purchaseOrderId))).data();
    const v2 = await draftAndFreeze(owner, { id: purchaseOrderId, reopen: true, expectedRevision: head.revision, content: 'V2 tarihsel metin' });
    await owner.processes.startProcess({ documentId: purchaseOrderId, versionId: v2.versionId, route: route(['b']) });
    const newFx = { ...fx, rates: { TRY: 1, USD: 37, EUR: 42 } };
    await sdk.setDoc(ref(contextDb(env, 'admin'), 'system_config', 'ebys_rates'), newFx);
    await decide('b', v2.versionId, 1, 'approved', newFx);
    const worker = actor(env, 'worker');
    await worker.execution.acceptExecutionJob(v2.versionId, 1);
    await worker.execution.completeExecutionJob(v2.versionId, 2, { note: 'Teslim edildi', evidenceRef: 'Tutanak' });
    const token = await owner.verification.issueVerification(purchaseOrderId);
    const pending = await draftAndFreeze(owner);
    const personal = await owner.documents.exportOwnDocuments();
    assert.equal(personal.schemaVersion, 3);
    assert.equal(personal.manifest.purpose, 'personal-copy');
    assert.equal(personal.manifest.purchases.referenced, 5);
    assert.equal(personal.manifest.purchases.included, 4);
    assert.equal(personal.manifest.purchases['not-created'], 1);
    assert.equal(personal.data.purchaseFinanceVersions.length, 2);
    assert.ok(personal.data.purchaseFinanceVersions.every(row => row.path.includes('/versions/')));
    assert.ok(personal.manifest.purchases.entries.every(row => row.engineVersion === 'ebys-v1' && row.schemaVersion === 2));
    const unrelated = await actor(env, 'admin').documents.exportOwnDocuments();
    assert.equal(unrelated.manifest.purchases, undefined);
    const failedRead = actor(env, 'owner', { onRead: path => {
        if (path.path.endsWith('/versions/' + pending.versionId)) {
            throw Object.assign(new Error('Yetki reddi'), { code: 'permission-denied' });
        }
    } });
    const partial = await failedRead.documents.exportOwnDocuments();
    assert.equal(partial.manifest.purchases.denied, 1);
    assert.equal(partial.manifest.collections.purchaseFinanceVersions.status, 'partial');

    const source = { host: process.env.FIRESTORE_EMULATOR_HOST, project, root, quiescent: true };
    const target = { ...source, project: targetProject };
    const { bundle, stats } = await captureRecovery(source);
    assert.equal(bundle.format, 'ebys-emulator-recovery-v2');
    assert.equal(bundle.counts.purchaseOrders, 2);
    assert.equal(bundle.counts.purchaseFinance, 2);
    assert.equal(bundle.purchaseManifest.notCreated, 1);
    const targetEnv = await initializeTestEnvironment({ projectId: targetProject, firestore: { rules } });
    try {
        const preview = await restoreRecovery(target, bundle);
        assert.equal(preview.stats.documentsWritten, 0);
        const schema = { window: {} };
        runInNewContext(readFileSync('src/utils/ebys-document-schema.js', 'utf8'), schema);
        const canonical = schema.window.AppModules.EBYSDocumentSchema.canonical;
        const invalid = [
            draft => { draft.rows = draft.rows.filter(row => row.collection !== 'purchaseFinance' || row.id !== v1.versionId); },
            draft => {
                draft.rows = draft.rows.filter(row => !(row.collection === 'purchaseFinance' && row.id === v1.versionId) &&
                    !(row.collection === 'ebysTasks' && row.id === v1.versionId + '__a'));
            },
            draft => { draft.rows.find(row => row.collection === 'purchaseFinance').path = root + '/purchaseFinance/items/' + purchaseOrderId; },
            draft => { draft.rows.find(row => row.collection === 'purchaseFinance').fields.operationId = { stringValue: uuid() }; },
            draft => { draft.rows.find(row => row.collection === 'ebysVersions').fields.content = { stringValue: 'Değiştirilmiş metin' }; },
            draft => { draft.rows.find(row => row.collection === 'purchaseOrders').fields.createdByUid = { stringValue: 'other' }; }
        ];
        for (const mutate of invalid) {
            const { digest: ignored, ...draft } = structuredClone(bundle);
            mutate(draft);
            const digest = createHash('sha256').update(canonical(draft)).digest('hex');
            await assert.rejects(restoreRecovery({ ...target, apply: true }, { ...draft, digest }));
        }
        const restored = await restoreRecovery({ ...target, apply: true }, bundle);
        assert.equal(restored.stats.documentsWritten, bundle.rows.length);
        const old = await actor(targetEnv, 'a').view({ purchaseOrderId, versionId: v1.versionId });
        assert.equal(old.version.content, v1Quote.version.content);
        assert.equal(old.finance.reportingTotalTRY, v1Quote.finance.reportingTotalTRY);
        await denied(actor(targetEnv, 'a').view({ purchaseOrderId, versionId: v2.versionId }));
        await denied(actor(targetEnv, 'f').view({ purchaseOrderId, versionId: v1.versionId }));
        await denied(actor(targetEnv, 'admin').view({ purchaseOrderId, versionId: v2.versionId }));
        const later = await actor(targetEnv, 'b').view({ purchaseOrderId, versionId: v2.versionId });
        assert.equal(later.version.content, 'V2 tarihsel metin');
        assert.equal(later.finance.exchangeRate.USD, 37);
        const restoredOwner = contextDb(targetEnv, 'owner');
        assert.equal((await sdk.getDoc(ref(restoredOwner, 'ebysDocuments', purchaseOrderId))).data().state, 'closed');
        assert.equal((await sdk.getDoc(ref(restoredOwner, 'ebysExecutionJobs', v2.versionId))).data().state, 'completed');
        assert.equal((await sdk.getDoc(financeRef(restoredOwner, pending.documentId, pending.versionId))).exists(), false);
        const anon = targetEnv.unauthenticatedContext().firestore();
        const qr = (await sdk.getDoc(ref(anon, 'ebysVerifications', token))).data();
        assert.deepEqual(Object.keys(qr).sort(), ['contentDigest', 'registeredAt', 'registrationNo', 'status', 'subjectSummary']);
        assert.equal(qr.contentDigest, later.version.contentDigest);
        await denied(sdk.getDoc(financeRef(anon, purchaseOrderId, v2.versionId)));
        await denied(sdk.getDoc(ref(anon, 'ebysVersions', v2.versionId)));
        await assert.rejects(restoreRecovery({ ...target, apply: true }, bundle), /Hedef dolu/);
        mkdirSync('scratch/ebys-h4-evidence', { recursive: true });
        writeFileSync('scratch/ebys-h4-evidence/recovery-measurements.json', JSON.stringify({
            documents: bundle.rows.length, capture: stats, preview: preview.stats, restore: restored.stats,
            purchaseManifest: bundle.purchaseManifest, personalReads: personal.manifest.reads
        }, null, 2));
    } finally { await targetEnv.cleanup(); }
});
