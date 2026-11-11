import { doc, collection, query, where, getDocFromServer, getDocsFromServer, getCountFromServer, runTransaction, serverTimestamp, onSnapshot, orderBy, limit, startAfter, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import '../utils/ebys-document-schema.js';
import '../utils/ebys-purchase-schema.js';

const S = () => window.AppModules.EBYSDocumentSchema;
const purchase = () => window.AppModules.EBYSPurchaseSchema;
const root = () => window.AppEnv.COLLECTION_ROOT;
const uid = () => { const id = window.userAuth?.uid; if (!id) throw new Error('Oturum açmalısınız.'); return id; };
const ref = (col, id) => doc(fireDb, root(), col, 'items', id);
const ownerCollections = ['ebysDocuments', 'ebysDrafts', 'ebysVersions', 'ebysRegistrationIds', 'ebysOperations', 'ebysEvents',
    'ebysProcesses', 'ebysTasks', 'ebysProcessOperations', 'ebysProcessEvents', 'ebysRouteTemplates'];
const executionAdminScopes = Object.freeze({
    ebysExecutionPolicies: 'current-policies-referenced-by-exported-jobs',
    ebysExecutionEvents: 'events-for-exported-jobs',
    ebysExecutionStockLinks: 'stock-links-referenced-by-exported-jobs'
});
export const EBYS_COLLECTION_REGISTRY = Object.freeze([
    ...ownerCollections, 'ebysExecutionJobs', 'ebysNotifications', ...Object.keys(executionAdminScopes),
    'ebysVerifications', 'ebysVerificationTokens'
]);
const EXPORT_DOCUMENT_LIMIT = 500;
const EXPORT_REQUEST_LIMIT = 400;
const check = (head, expected) => {
    if (!head || head.ownerUid !== uid()) throw new Error('Evrakın yazarı değilsiniz.');
    if (!Number.isInteger(expected) || head.revision !== expected) throw new Error('Evrak değişti; yeniden açın.');
};
const log = (tx, head, operationId, command, payloadDigest, result) => {
    tx.set(ref('ebysOperations', operationId), { id: operationId, documentId: head.id, ownerUid: head.ownerUid, command,
        payloadDigest, result, revision: head.revision, createdAt: serverTimestamp() });
    tx.set(ref('ebysEvents', operationId), { id: operationId, documentId: head.id, ownerUid: head.ownerUid,
        operationId, type: command, revision: head.revision, createdAt: serverTimestamp() });
};
const replay = (snapshot, command, payloadDigest) => {
    if (!snapshot.exists()) return null;
    const old = snapshot.data();
    if (old.ownerUid !== uid() || old.command !== command || old.payloadDigest !== payloadDigest) throw new Error('İşlem kimliği farklı içerikle kullanılmış.');
    return old.result;
};

function purchaseSession() {
    const ownerUid = uid(), collectionRoot = root();
    const assertCurrent = () => {
        if (window.userAuth?.uid !== ownerUid || root() !== collectionRoot) throw new Error('Oturum veya ortam değişti.');
    };
    return { ownerUid, root: collectionRoot, assertCurrent };
}

async function runPurchaseCommand(session, operationId, command, payloadDigest, callback) {
    if (typeof operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)) {
        throw new Error('İşlem kimliği geçersiz.');
    }
    const op = doc(fireDb, session.root, 'ebysOperations', 'items', operationId);
    try {
        const result = await runTransaction(fireDb, async tx => {
            session.assertCurrent();
            const saved = await tx.get(op);
            session.assertCurrent();
            const old = replay(saved, command, payloadDigest);
            if (old) return old;
            const result = await callback(tx);
            session.assertCurrent();
            return result;
        }, { maxAttempts: 3 });
        session.assertCurrent();
        return result;
    } catch (error) {
        session.assertCurrent();
        // Yalnız aynı komut gerçekten yazılmışsa yarış veya kayıp yanıt telafi edilir.
        try {
            const saved = await getDocFromServer(op);
            session.assertCurrent();
            const result = replay(saved, command, payloadDigest);
            if (result) return result;
        } catch { /* Asıl hata korunur. */ }
        session.assertCurrent();
        throw error;
    }
}

export const saveDraft = input => saveDocumentDraft(input);
export const createPurchaseDocument = input => saveDocumentDraft(input, 'create');
export const savePurchaseDraft = input => saveDocumentDraft(input, 'update');

async function saveDocumentDraft(input, mode) {
    const session = mode ? purchaseSession() : null, ownerUid = session?.ownerUid ?? uid();
    const data = S().normalize(mode ? { ...input, kind: 'internal' } : input);
    if (mode) {
        if (typeof input.unitId !== 'string' || input.unitId.length > 128 ||
            purchase().normalizeLegacyId(input.unitId).kind !== 'valid') throw new Error('Birim yolu geçersiz.');
        data.unitId = input.unitId;
        if (input.reopen !== undefined && typeof input.reopen !== 'boolean') throw new Error('Taslak açma seçimi geçersiz.');
        if (mode === 'create' && (input.reopen || input.expectedRevision != null)) throw new Error('Yeni talep önceki revizyona bağlanamaz.');
        if (mode === 'update' && !input.id) throw new Error('Satın alma talebi gerekli.');
    }
    const operationId = input.operationId || S().uuid(), id = input.id || operationId;
    const proposal = mode ? purchase().normalizePurchaseSnapshot(id, {
        purchaseOrderId: id, documentTypeCode: 'PURCHASE_REQUEST', items: input.items, butce: input.butce,
        budgetMode: input.budgetMode, calculationVersion: 1
    }) : null;
    const payloadDigest = await S().digest({ id, ...data, ...(mode ? { mode, purchaseSnapshot: proposal } : {}),
        expectedRevision: input.expectedRevision ?? null, reopen: input.reopen === true });

    const save = async (tx, old, draft, unit, marker) => {
        if (!unit.exists() || unit.data().active === false) throw new Error('Aktif bir birim seçin.');
        const previous = old.exists() ? old.data() : null;
        const context = mode ? { root: session.root, purchaseOrderId: id, ownerUid } : null;
        if (mode === 'create' && (previous || draft.exists() || marker.exists())) throw new Error('Bu talep kimliği kullanılıyor.');
        if (mode === 'update') {
            if (!previous || !draft.exists() || !marker.exists()) throw new Error('Bağlı talep bulunamadı.');
            purchase().validatePurchaseLinks(context, {
                marker: { root: session.root, pathId: marker.id, data: marker.data() },
                document: { root: session.root, pathId: old.id, data: previous }
            });
            if (draft.data().ownerUid !== ownerUid || draft.data().documentId !== id ||
                draft.data().revision !== marker.data().revision || draft.data().purchaseSnapshot?.purchaseOrderId !== id) {
                throw new Error('Satın alma taslağının bağı geçersiz.');
            }
        }
        if (previous) {
            check(previous, input.expectedRevision);
            if (!mode && Object.hasOwn(previous, 'purchaseOrderId')) throw new Error('Bağlı talebi satın alma taslak komutuyla düzenleyin.');
            if (input.reopen) {
                const p = await tx.get(ref('ebysProcesses', previous.currentVersionId));
                if (!p.exists() || !['returned','rejected','withdrawn'].includes(p.data().state)) throw new Error('Yalnız iade, red veya geri çekme sonrası yeni sürüm hazırlanabilir.');
            } else if (!['draft', 'registered'].includes(previous.state)) throw new Error('Dondurulan evrak düzenlenemez.');
            if (previous.kind !== data.kind || previous.organizationCode !== data.organizationCode) throw new Error('Evrak yönü ve kurum kodu sabittir.');
        }
        session?.assertCurrent();
        const next = { ...(previous || {}), id, ownerUid, kind: data.kind, unitId: data.unitId, organizationCode: data.organizationCode,
            ...(mode ? { purchaseOrderId: id } : {}),
            state: input.reopen ? 'draft' : previous?.state || 'draft', currentVersionId: '', versionNo: previous?.versionNo || 0, registrationNo: previous?.registrationNo || '',
            revision: (previous?.revision || 0) + 1, lastOperationId: operationId,
            createdAt: previous?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
        if (mode) {
            const selected = { root: session.root, pathId: unit.id, data: unit.data() };
            tx.set(ref('purchaseOrders', id), purchase().createPurchaseMarker(context, { unit: selected, revision: next.revision,
                createdAt: marker.data()?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() }));
        }
        tx.set(ref('ebysDocuments', id), next);
        tx.set(ref('ebysDrafts', id), { id, documentId: id, ownerUid, revision: next.revision, content: data.content, metadata: data.metadata,
            ...(mode ? { purchaseSnapshot: proposal } : {}), attachments: [], attachmentMode: 'none', updatedAt: serverTimestamp() });
        const output = { documentId: id, revision: next.revision };
        log(tx, next, operationId, 'saveDraft', payloadDigest, output);
        return output;
    };

    const readDraftInputs = tx => [tx.get(ref('ebysDocuments', id)), tx.get(ref('ebysDrafts', id)), tx.get(ref('units', data.unitId))];
    if (mode) return runPurchaseCommand(session, operationId, 'saveDraft', payloadDigest, async tx => {
        const [old, draft, unit, marker] = await Promise.all([...readDraftInputs(tx), tx.get(ref('purchaseOrders', id))]);
        session.assertCurrent();
        return save(tx, old, draft, unit, marker);
    });
    return runTransaction(fireDb, async tx => {
        const [op, old, draft, unit] = await Promise.all([tx.get(ref('ebysOperations', operationId)), ...readDraftInputs(tx)]);
        const result = replay(op, 'saveDraft', payloadDigest);
        return result || save(tx, old, draft, unit);
    });
}

export async function freezePurchaseVersion({ documentId, expectedRevision, operationId = S().uuid() }) {
    const session = purchaseSession(), versionId = S().uuid();
    const context = { root: session.root, ownerUid: session.ownerUid, purchaseOrderId: documentId, versionId };
    purchase().financePath(context);
    const payloadDigest = await S().digest({ mode: 'purchase', documentId, expectedRevision });
    return runPurchaseCommand(session, operationId, 'freezeVersion', payloadDigest, async tx => {
        const [headSnap, draftSnap] = await Promise.all([tx.get(ref('ebysDocuments', documentId)), tx.get(ref('ebysDrafts', documentId))]);
        session.assertCurrent();
        const head = headSnap.data(), draft = draftSnap.data();
        check(head, expectedRevision);
        if (head.purchaseOrderId !== documentId || head.kind !== 'internal' || !['draft', 'registered'].includes(head.state) ||
            !draft || draft.documentId !== documentId || draft.ownerUid !== session.ownerUid || draft.revision > head.revision) {
            throw new Error('Bağlı satın alma taslağı dondurulamaz.');
        }
        const unit = await tx.get(ref('units', head.unitId));
        if (!unit.exists()) throw new Error('Aktif bir birim seçin.');
        const unitSnapshot = purchase().createUnitSnapshot(session.root,
            { root: session.root, pathId: unit.id, data: unit.data() }, head.organizationCode);
        const version = { id: versionId, processId: versionId, documentId, ownerUid: session.ownerUid,
            versionNo: head.versionNo + 1, schemaVersion: 2, content: draft.content, metadataSnapshot: draft.metadata,
            purchaseSnapshot: draft.purchaseSnapshot, unitSnapshot, attachments: draft.attachments, attachmentMode: draft.attachmentMode };
        const contentDigest = await purchase().digestPurchaseVersion(context, { root: session.root, pathId: versionId, data: version });
        session.assertCurrent();
        return writeFrozenVersion(tx, head, version, contentDigest, operationId, payloadDigest);
    });
}

function writeFrozenVersion(tx, head, version, contentDigest, operationId, payloadDigest) {
    const documentId = head.id, versionId = version.id;
    const next = { ...head, state: 'in_review', currentVersionId: versionId, versionNo: version.versionNo,
        revision: head.revision + 1, lastOperationId: operationId, updatedAt: serverTimestamp() };
    tx.set(ref('ebysVersions', versionId), { ...version, contentDigest, createdAt: serverTimestamp() });
    tx.set(ref('ebysDocuments', documentId), next);
    const output = { documentId, versionId, revision: next.revision };
    log(tx, next, operationId, 'freezeVersion', payloadDigest, output);
    return output;
}

export async function getPurchaseView({ purchaseOrderId, versionId }) {
    const session = purchaseSession();
    const read = async (col, id) => {
        const snap = await getDocFromServer(doc(fireDb, session.root, col, 'items', id));
        session.assertCurrent();
        return snap;
    };
    if (versionId !== undefined) {
        const context = { root: session.root, purchaseOrderId, versionId };
        const path = purchase().financePath(context);
        const version = await read('ebysVersions', versionId), data = version.data();
        if (!data) throw new Error('Satın alma sürümü bulunamadı.');
        const scoped = { ...context, ownerUid: data.ownerUid };
        const linked = { root: session.root, pathId: version.id, data };
        if (await purchase().digestPurchaseVersion(scoped, linked) !== data.contentDigest) throw new Error('Satın alma sürüm özeti uyuşmuyor.');
        session.assertCurrent();
        const financial = await getDocFromServer(doc(fireDb, path));
        session.assertCurrent();
        return { engine: 'ebys-v1', mode: 'version', purchaseOrderId, version: data,
            finance: financial.exists() ? purchase().normalizeFinance(scoped, linked, financial.data()) : null };
    }
    const id = purchase().normalizeLegacyId(purchaseOrderId);
    if (id.kind !== 'valid') throw new Error('Satın alma talep yolu geçersiz.');
    const marker = await read('purchaseOrders', id.id);
    if (!marker.exists()) return null;
    const result = purchase().readPurchase({ root: session.root, pathId: marker.id, ownerUid: session.ownerUid }, marker.data());
    if (result.engine === 'legacy') return { ...result, mode: 'legacy' };
    const [head, draft] = await Promise.all([read('ebysDocuments', marker.id), read('ebysDrafts', marker.id)]);
    const context = { root: session.root, purchaseOrderId: marker.id, ownerUid: session.ownerUid };
    purchase().validatePurchaseLinks(context, { marker: { root: session.root, pathId: marker.id, data: marker.data() },
        document: { root: session.root, pathId: head.id, data: head.data() } });
    const content = draft.data();
    if (!content || content.ownerUid !== session.ownerUid || content.documentId !== marker.id ||
        content.revision !== result.marker.revision || content.purchaseSnapshot?.purchaseOrderId !== marker.id) {
        throw new Error('Bağlı satın alma taslağı bulunamadı veya değişti.');
    }
    if (!['draft', 'registered'].includes(head.data().state)) throw new Error('Sabit satın alma görünümü için sürümü seçin.');
    return { ...result, mode: 'draft', head: head.data(), draft: content };
}


export async function freezeVersion({ documentId, expectedRevision, operationId = S().uuid() }) {
    const before = await getDocFromServer(ref('ebysDrafts', documentId));
    if (!before.exists()) throw new Error('Taslak bulunamadı.');
    const source = before.data();
    const contentDigest = await S().digest({ content: source.content, metadata: source.metadata, attachments: source.attachments });
    const payloadDigest = await S().digest({ documentId, expectedRevision, contentDigest });
    const versionId = S().uuid();
    return runTransaction(fireDb, async tx => {
        const [op, headSnap, draftSnap] = await Promise.all([tx.get(ref('ebysOperations', operationId)), tx.get(ref('ebysDocuments', documentId)), tx.get(ref('ebysDrafts', documentId))]);
        const result = replay(op, 'freezeVersion', payloadDigest); if (result) return result;
        const head = headSnap.data(), draft = draftSnap.data(); check(head, expectedRevision);
        if (Object.hasOwn(head, 'purchaseOrderId')) throw new Error('Bağlı talebi satın alma dondurma komutuyla sürüme alın.');
        if (!['draft', 'registered'].includes(head.state) || !draft || draft.revision !== source.revision) throw new Error('Taslak değişti veya zaten donduruldu; yeniden açın.');
        const version = { id: versionId, processId: versionId, documentId, ownerUid: head.ownerUid, versionNo: head.versionNo + 1, schemaVersion: 1,
            content: draft.content, metadataSnapshot: draft.metadata, attachments: [], attachmentMode: 'none' };
        return writeFrozenVersion(tx, head, version, contentDigest, operationId, payloadDigest);
    });
}

export async function registerDocument({ documentId, expectedRevision, operationId = S().uuid() }) {
    const payloadDigest = await S().digest({ documentId, expectedRevision });
    for (let attempt = 0; attempt < 5; attempt++) {
        let candidateDenied = false;
        try {
            return await runTransaction(fireDb, async tx => {
                const [op, snapshot] = await Promise.all([tx.get(ref('ebysOperations', operationId)), tx.get(ref('ebysDocuments', documentId))]);
                const result = replay(op, 'registerDocument', payloadDigest); if (result) return result;
                const head = snapshot.data(); check(head, expectedRevision);
                if (head.registrationNo) return { documentId, registrationNo: head.registrationNo, revision: head.revision };
                if (!['draft', 'in_review'].includes(head.state)) throw new Error('Evrak kayda uygun değil.');
                const number = S().registrationNo(head.organizationCode);
                let reservation;
                try { reservation = await tx.get(ref('ebysRegistrationIds', number)); }
                catch (error) { candidateDenied = error.code === 'permission-denied'; throw error; }
                if (reservation.exists()) throw new Error('registration-collision');
                const next = { ...head, registrationNo: number, state: head.state === 'draft' ? 'registered' : head.state,
                    revision: head.revision + 1, lastOperationId: operationId, updatedAt: serverTimestamp() };
                tx.set(ref('ebysRegistrationIds', number), { id: number, documentId, ownerUid: head.ownerUid, operationId, createdAt: serverTimestamp() });
                tx.set(ref('ebysDocuments', documentId), next);
                const output = { documentId, registrationNo: number, revision: next.revision };
                log(tx, next, operationId, 'registerDocument', payloadDigest, output); return output;
            });
        } catch (error) {
            if (candidateDenied && attempt < 4) {
                // Yalnız aday rezervasyonun get reddi: Rules eksik adayı üyeye açar,
                // başka yazarın dolu rezervasyonunu kapatır. Kendi evrakını sunucudan
                // tekrar okuyamayan aktörün gerçek yetki reddi yeniden denenmez.
                const proof = await getDocFromServer(ref('ebysDocuments', documentId));
                check(proof.data(), expectedRevision);
                continue;
            }
            if (error.message !== 'registration-collision' || attempt === 4) throw error;
        }
    }
}
export async function readDocument(id) {
    const actor = uid();
    const head = await getDocFromServer(ref('ebysDocuments', id)); if (!head.exists()) throw new Error('Evrak bulunamadı.');
    const data = head.data();
    const body = await getDocFromServer(ref(data.currentVersionId ? 'ebysVersions' : 'ebysDrafts', data.currentVersionId || id));
    if (actor !== uid()) throw new Error('Oturum değişti; evrakı yeniden açın.');
    return { head: data, body: body.data() };
}
export async function reopenDraft({documentId,expectedRevision,operationId}) {
    const {head,body} = await readDocument(documentId);
    return saveDraft({id:documentId,expectedRevision,operationId,reopen:true,kind:head.kind,unitId:head.unitId,organizationCode:head.organizationCode,content:body.content,metadata:body.metadataSnapshot || body.metadata});
}
export function listDocuments(onData, onError, cursor = null, kind = 'incoming') {
    const conditions = window.isDbAdmin?.() ? [] : [where('ownerUid', '==', uid())];
    // Yön, sahip ve zaman sırası için bileşik indeksler firestore.indexes.json içindedir.
    const constraints = [...conditions, where('kind', '==', kind), orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)];
    return onSnapshot(query(collection(fireDb, root(), 'ebysDocuments', 'items'), ...constraints), snap => onData(snap.docs.map(d => ({ ...d.data(), _cursor: d }))), onError);
}
export async function countDocuments() {
    const actor = uid(), scope = window.isDbAdmin?.() ? [] : [where('ownerUid', '==', actor)];
    const source = collection(fireDb, root(), 'ebysDocuments', 'items');
    const counts = await Promise.all([null, 'draft', 'registered', 'in_review'].map(state =>
        getCountFromServer(query(source, ...scope, ...(state ? [where('state', '==', state)] : [])))));
    if (actor !== uid()) throw new Error('Oturum değişti.');
    return Object.fromEntries(['total', 'draft', 'registered', 'in_review'].map((key, i) => [key, counts[i].data().count]));
}

function exportValue(value) {
    if (value instanceof Timestamp) return { $firestoreTimestamp: [value.seconds, value.nanoseconds] };
    if (Array.isArray(value)) return value.map(exportValue);
    if (value?.constructor?.name === 'Object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exportValue(item)]));
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) return value;
    throw new Error('Evrak kopyasında desteklenmeyen bir alan türü var.');
}

export async function exportOwnDocuments() {
    const ownerUid = uid(), exportRoot = root(), startedAt = new Date().toISOString();
    const isAdmin = window.isDbAdmin?.() === true;
    const data = {}, collections = {};
    let requests = 0, documentsRead = 0;
    const assertSession = () => {
        if (window.userAuth?.uid !== ownerUid || root() !== exportRoot || (window.isDbAdmin?.() === true) !== isAdmin) {
            throw new Error('Oturum, yetki veya ortam değişti. Evrak kopyasını yeniden alın.');
        }
    };
    const startRead = () => {
        assertSession();
        if (requests >= EXPORT_REQUEST_LIMIT || documentsRead >= EXPORT_DOCUMENT_LIMIT) {
            throw new Error('Evrak kopyası işlem sınırına ulaştı. Dosya oluşturulmadı.');
        }
        requests++;
    };
    const read = async (name, condition) => {
        startRead();
        const remaining = EXPORT_DOCUMENT_LIMIT - documentsRead;
        const { docs } = await getDocsFromServer(query(collection(fireDb, exportRoot, name, 'items'), condition, limit(remaining + 1)));
        assertSession();
        if (docs.length > remaining) throw new Error('Evrak kopyası belge sınırını aşıyor. Dosya oluşturulmadı.');
        documentsRead += docs.length;
        return docs;
    };
    const readPath = async (...segments) => {
        startRead();
        const snapshot = await getDocFromServer(doc(fireDb, ...segments));
        assertSession();
        if (snapshot.exists()) documentsRead++;
        return snapshot;
    };
    const readOne = (name, id) => readPath(exportRoot, name, 'items', id);
    const add = (name, rows, scope, details = {}) => {
        data[name] = rows;
        collections[name] = { status: 'included', scope, count: rows.length, ...details };
    };
    const identified = d => ({ ...d.data(), id: d.id });

    for (const name of ownerCollections) {
        const docs = await read(name, where('ownerUid', '==', ownerUid));
        add(name, docs.map(identified), 'owner');
    }

    const ownJobs = await read('ebysExecutionJobs', where('ownerUid', '==', ownerUid));
    const assignedJobs = await read('ebysExecutionJobs', where('assigneeUid', '==', ownerUid));
    const jobs = [...new Map([...ownJobs, ...assignedJobs].map(d => [d.id, identified(d)])).values()];
    add('ebysExecutionJobs', jobs, 'owner-or-assignee');
    const notices = await read('ebysNotifications', where('recipientUid', '==', ownerUid));
    add('ebysNotifications', notices.map(identified), 'recipient');

    if (isAdmin) {
        // Politika ve stok bağı listelenemez. Yalnız dışa aktarılan işlerdeki doğrudan referanslar okunur.
        const readReferences = async (name, references) => {
            const ids = new Set(references.filter(Boolean)), rows = [], missingReferences = [];
            for (const id of ids) {
                const snap = await readOne(name, id);
                if (snap.exists()) rows.push(identified(snap));
                else missingReferences.push(id);
            }
            add(name, rows, executionAdminScopes[name], {
                status: missingReferences.length ? 'partial' : 'included', referenceCount: ids.size, missingReferences
            });
        };
        await readReferences('ebysExecutionPolicies', jobs.map(job => job.policyId));
        const events = [], processIds = jobs.map(job => job.id);
        for (let offset = 0; offset < processIds.length; offset += 20) {
            const docs = await read('ebysExecutionEvents', where('processId', 'in', processIds.slice(offset, offset + 20)));
            events.push(...docs.map(identified));
        }
        add('ebysExecutionEvents', events, executionAdminScopes.ebysExecutionEvents);
        await readReferences('ebysExecutionStockLinks', jobs.map(job => job.stockOperationId));
    } else {
        for (const [name, scope] of Object.entries(executionAdminScopes)) {
            add(name, [], scope, { status: 'excluded', reason: 'admin-required' });
        }
    }

    const verificationTokens = new Set(data.ebysDocuments.map(head => head.verificationToken).filter(Boolean));
    const verifications = [], missingReferences = [];
    for (const token of verificationTokens) {
        if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
            throw new Error('Evrakın doğrulama kaydı geçersiz. Dosya oluşturulmadı.');
        }
        const snapshot = await readOne('ebysVerifications', token);
        if (snapshot.exists()) verifications.push(identified(snapshot));
        else missingReferences.push(token);
    }
    add('ebysVerifications', verifications, 'public-projections-of-owned-documents', {
        status: missingReferences.length ? 'partial' : 'included',
        referenceCount: verificationTokens.size, missingReferences
    });
    add('ebysVerificationTokens', [], 'private-reservations', { status: 'excluded', reason: 'private-operator-only' });

    const purchaseEntries = [], markers = [], finances = [];
    const linkedHeads = new Map(data.ebysDocuments.filter(head => Object.hasOwn(head, 'purchaseOrderId')).map(head => [head.id, head]));
    const firstApprovedVersions = new Set(data.ebysTasks.filter(task => task.decisionsByStep?.['0']?.result === 'approved').map(task => task.versionId));
    const readLinked = async (path, missing) => {
        let snapshot, status;
        try {
            snapshot = await readPath(path);
            status = snapshot.exists() ? 'included' : missing;
        } catch (error) {
            assertSession();
            if (error.code !== 'permission-denied') throw error;
            status = 'denied';
        }
        purchaseEntries.push({ path, engineVersion: 'ebys-v1', schemaVersion: 2, status });
        return snapshot?.data();
    };
    for (const [id, head] of linkedHeads) {
        if (head.purchaseOrderId !== id) throw new Error('Satın alma evrak bağı geçersiz.');
        const path = [exportRoot, 'purchaseOrders', 'items', id].join('/');
        const marker = await readLinked(path, 'missing');
        if (marker) {
            const context = { root: exportRoot, purchaseOrderId: id, ownerUid };
            purchase().validatePurchaseLinks(context, { marker: { root: exportRoot, pathId: id, data: marker },
                document: { root: exportRoot, pathId: id, data: head } });
            markers.push({ path, data: marker });
        }
    }
    for (const v of data.ebysVersions) {
        if (v.schemaVersion !== 2) continue;
        if (!linkedHeads.has(v.documentId)) throw new Error('Satın alma sürümünün evrakı bulunamadı.');
        const context = { root: exportRoot, purchaseOrderId: v.documentId, versionId: v.id, ownerUid };
        const version = { root: exportRoot, pathId: v.id, data: v };
        if (await purchase().digestPurchaseVersion(context, version) !== v.contentDigest) throw new Error('Satın alma sürüm özeti uyuşmuyor.');
        const path = purchase().financePath(context);
        const financial = await readLinked(path, firstApprovedVersions.has(v.id) ? 'missing' : 'not-created');
        if (financial) finances.push({ path, data: purchase().normalizeFinance(context, version, financial) });
    }
    let purchaseManifest;
    if (purchaseEntries.length) {
        add('purchaseOrders', markers, 'owned-linked-documents', { status: markers.length === linkedHeads.size ? 'included' : 'partial' });
        const financeEntries = purchaseEntries.filter(entry => entry.path.includes('/purchaseFinance/'));
        add('purchaseFinanceVersions', finances, 'owned-frozen-version-references', {
            status: financeEntries.some(entry => ['missing', 'denied'].includes(entry.status)) ? 'partial' : 'included'
        });
        const totals = Object.fromEntries(['included', 'not-created', 'missing', 'denied'].map(status =>
            [status, purchaseEntries.filter(entry => entry.status === status).length]));
        purchaseManifest = { referenced: purchaseEntries.length, ...totals, entries: purchaseEntries };
    }


    for (const name of ['ebysDocuments', 'ebysProcesses']) {
        for (const record of data[name]) {
            const current = await readOne(name, record.id);
            if (!current.exists() || current.data().revision !== record.revision) {
                throw new Error('Evrak veya süreç kopyalama sırasında değişti. Evrak kopyasını yeniden alın.');
            }
        }
    }
    assertSession();
    const exportedAt = new Date().toISOString();
    return {
        schemaVersion: purchaseManifest ? 3 : 2, root: exportRoot, ownerUid, exportedAt, consistency: 'sequential-reads',
        attachmentMode: 'none', data: exportValue(data),
        manifest: {
            version: purchaseManifest ? 3 : 2, purpose: 'personal-copy', role: isAdmin ? 'admin' : 'member', startedAt, finishedAt: exportedAt,
            timestampEncoding: '$firestoreTimestamp:[seconds,nanoseconds]', recheckedRevisions: ['ebysDocuments', 'ebysProcesses'],
            excluded: ['firebase-auth', 'attachment-bytes', 'stock-operations'],
            reads: { requests, documents: documentsRead, requestLimit: EXPORT_REQUEST_LIMIT, documentLimit: EXPORT_DOCUMENT_LIMIT },
            collections, ...(purchaseManifest ? { purchases: purchaseManifest } : {})
        }
    };
}
window.AppModules = window.AppModules || {};
window.AppModules.EBYSDocuments = { saveDraft, freezeVersion, registerDocument, readDocument, listDocuments, countDocuments, exportOwnDocuments, reopenDraft };
