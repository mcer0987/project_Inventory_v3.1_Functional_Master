import { doc, collection, query, where, getDocFromServer, getDocs, getCountFromServer, runTransaction, serverTimestamp, onSnapshot, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import '../utils/ebys-document-schema.js';

const S = () => window.AppModules.EBYSDocumentSchema;
const root = () => window.AppEnv.COLLECTION_ROOT;
const uid = () => { const id = window.userAuth?.uid; if (!id) throw new Error('Oturum açmalısınız.'); return id; };
const ref = (col, id) => doc(fireDb, root(), col, 'items', id);
export const EBYS_COLLECTION_REGISTRY = Object.freeze(['ebysDocuments', 'ebysDrafts', 'ebysVersions', 'ebysRegistrationIds', 'ebysOperations', 'ebysEvents']);
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
    const payloadDigest = await S().digest({ id, ...data, expectedRevision: input.expectedRevision ?? null });
    return runTransaction(fireDb, async tx => {
        const [op, old, draft, unit] = await Promise.all([tx.get(ref('ebysOperations', operationId)), tx.get(ref('ebysDocuments', id)),
            tx.get(ref('ebysDrafts', id)), tx.get(ref('units', data.unitId))]);
        const result = replay(op, 'saveDraft', payloadDigest); if (result) return result;
        if (!unit.exists() || unit.data().active === false) throw new Error('Aktif bir birim seçin.');
        const previous = old.exists() ? old.data() : null;
        if (previous) {
            check(previous, input.expectedRevision);
            if (!['draft', 'registered'].includes(previous.state)) throw new Error('Dondurulan evrak düzenlenemez.');
            if (previous.kind !== data.kind || previous.organizationCode !== data.organizationCode) throw new Error('Evrak yönü ve kurum kodu sabittir.');
        }
        const next = { ...(previous || {}), id, ownerUid, kind: data.kind, unitId: data.unitId, organizationCode: data.organizationCode,
            state: previous?.state || 'draft', currentVersionId: '', versionNo: 0, registrationNo: previous?.registrationNo || '',
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
        const next = { ...head, state: 'in_review', currentVersionId: versionId, versionNo: 1, revision: head.revision + 1, lastOperationId: operationId, updatedAt: serverTimestamp() };
        tx.set(ref('ebysVersions', versionId), { id: versionId, processId: versionId, documentId, ownerUid: head.ownerUid, versionNo: 1, schemaVersion: 1,
            content: draft.content, metadataSnapshot: draft.metadata, attachments: [], attachmentMode: 'none', contentDigest, createdAt: serverTimestamp() });
        tx.set(ref('ebysDocuments', documentId), next);
        const output = { documentId, versionId, revision: next.revision };
        log(tx, next, operationId, 'freezeVersion', payloadDigest, output); return output;
    });
}

export async function registerDocument({ documentId, expectedRevision, operationId = S().uuid() }) {
    const payloadDigest = await S().digest({ documentId, expectedRevision });
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            return await runTransaction(fireDb, async tx => {
                const [op, snapshot] = await Promise.all([tx.get(ref('ebysOperations', operationId)), tx.get(ref('ebysDocuments', documentId))]);
                const result = replay(op, 'registerDocument', payloadDigest); if (result) return result;
                const head = snapshot.data(); check(head, expectedRevision);
                if (head.registrationNo) return { documentId, registrationNo: head.registrationNo, revision: head.revision };
                if (!['draft', 'in_review'].includes(head.state)) throw new Error('Evrak kayda uygun değil.');
                const number = S().registrationNo(head.organizationCode);
                if ((await tx.get(ref('ebysRegistrationIds', number))).exists()) throw new Error('registration-collision');
                const next = { ...head, registrationNo: number, state: head.state === 'draft' ? 'registered' : head.state,
                    revision: head.revision + 1, lastOperationId: operationId, updatedAt: serverTimestamp() };
                tx.set(ref('ebysRegistrationIds', number), { id: number, documentId, ownerUid: head.ownerUid, operationId, createdAt: serverTimestamp() });
                tx.set(ref('ebysDocuments', documentId), next);
                const output = { documentId, registrationNo: number, revision: next.revision };
                log(tx, next, operationId, 'registerDocument', payloadDigest, output); return output;
            });
        } catch (error) { if (error.message !== 'registration-collision' || attempt === 4) throw error; }
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
export function listDocuments(onData, onError, cursor = null, kind = 'incoming') {
    const conditions = window.isDbAdmin?.() ? [] : [where('ownerUid', '==', uid())];
    // Tek alan sırası: sahip sorgusu için bileşik indeks gerektirmemek amacıyla owner ekranı ayrı sade sorgudur.
    const constraints = conditions.length ? [...conditions, limit(50)] : [where('kind', '==', kind), orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)];
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
    const ownerUid = uid(), data = {};
    for (const name of EBYS_COLLECTION_REGISTRY) {
        const snapshot = await getDocs(query(collection(fireDb, root(), name, 'items'), where('ownerUid', '==', ownerUid)));
        data[name] = snapshot.docs.map(d => d.data());
    }
    if (ownerUid !== uid()) throw new Error('Oturum değişti; yedeği yeniden alın.');
    return { schemaVersion: 1, root: root(), ownerUid, exportedAt: new Date().toISOString(), consistency: 'sequential-reads', attachmentMode: 'none', data };
}
window.AppModules = window.AppModules || {};
window.AppModules.EBYSDocuments = { saveDraft, freezeVersion, registerDocument, readDocument, listDocuments, countDocuments, exportOwnDocuments };
