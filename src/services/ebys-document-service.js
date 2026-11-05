import { doc, collection, query, where, getDocFromServer, getDocsFromServer, getCountFromServer, runTransaction, serverTimestamp, onSnapshot, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import '../utils/ebys-document-schema.js';

const S = () => window.AppModules.EBYSDocumentSchema;
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
    ...ownerCollections, 'ebysExecutionJobs', 'ebysNotifications', ...Object.keys(executionAdminScopes)
]);
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

export async function saveDraft(input) {
    const data = S().normalize(input), ownerUid = uid();
    const operationId = input.operationId || S().uuid(), id = input.id || operationId;
    const payloadDigest = await S().digest({ id, ...data, expectedRevision: input.expectedRevision ?? null, reopen: input.reopen === true });
    return runTransaction(fireDb, async tx => {
        const [op, old, draft, unit] = await Promise.all([tx.get(ref('ebysOperations', operationId)), tx.get(ref('ebysDocuments', id)),
            tx.get(ref('ebysDrafts', id)), tx.get(ref('units', data.unitId))]);
        const result = replay(op, 'saveDraft', payloadDigest); if (result) return result;
        if (!unit.exists() || unit.data().active === false) throw new Error('Aktif bir birim seçin.');
        const previous = old.exists() ? old.data() : null;
        if (previous) {
            check(previous, input.expectedRevision);
            if (input.reopen) {
                const p = await tx.get(ref('ebysProcesses',previous.currentVersionId));
                if (!p.exists() || !['returned','rejected','withdrawn'].includes(p.data().state)) throw new Error('Yalnız iade, red veya geri çekme sonrası yeni sürüm hazırlanabilir.');
            } else if (!['draft', 'registered'].includes(previous.state)) throw new Error('Dondurulan evrak düzenlenemez.');
            if (previous.kind !== data.kind || previous.organizationCode !== data.organizationCode) throw new Error('Evrak yönü ve kurum kodu sabittir.');
        }
        const next = { ...(previous || {}), id, ownerUid, kind: data.kind, unitId: data.unitId, organizationCode: data.organizationCode,
            state: input.reopen ? 'draft' : previous?.state || 'draft', currentVersionId: '', versionNo: previous?.versionNo || 0, registrationNo: previous?.registrationNo || '',
            revision: (previous?.revision || 0) + 1, lastOperationId: operationId,
            createdAt: previous?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
        tx.set(ref('ebysDocuments', id), next);
        tx.set(ref('ebysDrafts', id), { id, documentId: id, ownerUid, revision: next.revision, content: data.content, metadata: data.metadata,
            attachments: [], attachmentMode: 'none', updatedAt: serverTimestamp() });
        const output = { documentId: id, revision: next.revision };
        log(tx, next, operationId, 'saveDraft', payloadDigest, output);
        return output;
    });
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
        if (!['draft', 'registered'].includes(head.state) || !draft || draft.revision !== source.revision) throw new Error('Taslak değişti veya zaten donduruldu; yeniden açın.');
        const next = { ...head, state: 'in_review', currentVersionId: versionId, versionNo: head.versionNo+1, revision: head.revision + 1, lastOperationId: operationId, updatedAt: serverTimestamp() };
        tx.set(ref('ebysVersions', versionId), { id: versionId, processId: versionId, documentId, ownerUid: head.ownerUid, versionNo: next.versionNo, schemaVersion: 1,
            content: draft.content, metadataSnapshot: draft.metadata, attachments: [], attachmentMode: 'none', contentDigest, createdAt: serverTimestamp() });
        tx.set(ref('ebysDocuments', documentId), next);
        const output = { documentId, versionId, revision: next.revision };
        log(tx, next, operationId, 'freezeVersion', payloadDigest, output); return output;
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
export async function exportOwnDocuments() {
    const ownerUid = uid(), exportRoot = root(), startedAt = new Date().toISOString();
    const isAdmin = window.isDbAdmin?.() === true;
    const data = {}, collections = {};
    const assertSession = () => {
        if (window.userAuth?.uid !== ownerUid || root() !== exportRoot) throw new Error('Oturum veya ortam değişti; yedeği yeniden alın.');
    };
    const read = async (name, condition) => {
        assertSession();
        return (await getDocsFromServer(query(collection(fireDb, exportRoot, name, 'items'), condition))).docs;
    };
    const add = (name, rows, scope, details = {}) => {
        data[name] = rows;
        collections[name] = { status: 'included', scope, count: rows.length, ...details };
    };
    const identified = d => ({ ...d.data(), id: d.id });

    for (const name of ownerCollections) {
        const docs = await read(name, where('ownerUid', '==', ownerUid));
        add(name, docs.map(d => d.data()), 'owner');
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
                assertSession();
                const snap = await getDocFromServer(doc(fireDb, exportRoot, name, 'items', id));
                if (snap.exists()) rows.push(identified(snap));
                else missingReferences.push(id);
            }
            add(name, rows, executionAdminScopes[name], { referenceCount: ids.size, missingReferences });
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

    assertSession();
    const exportedAt = new Date().toISOString();
    return {
        schemaVersion: 1, root: exportRoot, ownerUid, exportedAt, consistency: 'sequential-reads', attachmentMode: 'none', data,
        manifest: { version: 1, role: isAdmin ? 'admin' : 'member', startedAt, finishedAt: exportedAt, collections }
    };
}
window.AppModules = window.AppModules || {};
window.AppModules.EBYSDocuments = { saveDraft, freezeVersion, registerDocument, readDocument, listDocuments, countDocuments, exportOwnDocuments, reopenDraft };
