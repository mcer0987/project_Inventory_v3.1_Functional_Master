import { collection, doc, getDocFromServer, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import './ebys-verification-service.js';

const root = () => window.AppEnv.COLLECTION_ROOT;
const ref = (col, id) => doc(fireDb, root(), col, 'items', id);
const items = col => collection(fireDb, root(), col, 'items');
const uid = () => {
    if (!window.userAuth?.uid) throw new Error('Oturum gerekli.');
    return window.userAuth.uid;
};
const requireAdmin = () => {
    if (!window.isDbAdmin?.()) throw new Error('İcra yönetimi için yönetici yetkisi gerekli.');
};
const kinds = ['incoming', 'outgoing', 'internal'];
const policyKey = (kind, sourceUnitId) => sourceUnitId ? kind + '__' + sourceUnitId : kind;
const activeStates = ['pending_acceptance', 'in_progress'];

function stockId(value) {
    const id = String(value ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error('Stok işlem numarası geçersiz.');
    return id;
}

function requiredText(value, max, label) {
    const text = String(value ?? '').trim();
    if (!text || text.length > max || /<[a-z/!?]/i.test(text)) throw new Error(label + ' geçerli metin olmalıdır.');
    return text;
}

async function resolveTarget(tx, { unitId, personnelId, dueHours }) {
    const [unit, person] = await Promise.all([tx.get(ref('units', unitId)), tx.get(ref('personel', personnelId))]);
    const staff = person.data();
    if (!unit.exists() || unit.data().active === false || !staff?.uid || staff.active === false || staff.unitId !== unitId) {
        throw new Error('İcra için birime bağlı, aktif ve giriş hesabı olan bir sorumlu seçin.');
    }
    if (!Number.isInteger(dueHours) || dueHours < 1 || dueHours > 720) throw new Error('Hedef süre 1–720 saat olmalıdır.');
    return { unitId, personnelId, assigneeUid: staff.uid, dueHours };
}

// Son onay transaction'ının okuma evresinde çağrılır. İş yolunun kimliği sabit sürümle aynıdır.
export async function assignExecutionJob(tx, process, head) {
    if (!kinds.includes(head?.kind) || !head.unitId) throw new Error('Evrakın türü veya bağlı birimi eksik.');
    const scoped = await tx.get(ref('ebysExecutionPolicies', policyKey(head.kind, head.unitId)));
    const selected = scoped.exists() ? scoped : await tx.get(ref('ebysExecutionPolicies', head.kind));
    if (!selected.exists()) throw new Error('Evrakın bağlı birimi için havale tanımı veya açık bir tür varsayılanı yok.');
    const policy = selected.data();
    let target;
    try {
        target = await resolveTarget(tx, policy);
        if (target.assigneeUid !== policy.assigneeUid) throw new Error('Sorumlunun hesap bağı değişmiş.');
    } catch (error) {
        throw new Error((scoped.exists() ? 'Birime özel havale' : 'Tür varsayılanı') + ' tanımı geçersiz. ' + error.message);
    }
    const dueAt = Timestamp.fromMillis(Date.now() + target.dueHours * 3600000);
    return {
        ...target, id: process.id, processId: process.id, documentId: process.documentId,
        versionId: process.versionId, ownerUid: process.ownerUid, kind: head.kind, sourceUnitId: head.unitId, policyId: selected.id,
        state: 'pending_acceptance', revision: 1, dueAt, originalDueAt: dueAt, returnedAt: null,
        lastAction: 'assign', lastActorUid: uid(), note: '', evidenceRef: '', stockOperationId: '',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
}

function matchesCompletion(job, actor, revision, payload) {
    return job?.state === 'completed' && job.lastAction === 'complete'
        && job.assigneeUid === actor && job.lastActorUid === actor && job.revision === revision + 1
        && job.note === payload.note && job.evidenceRef === payload.evidenceRef && job.stockOperationId === payload.stockOperationId;
}

async function changeJob(id, expectedRevision, action, input = {}) {
    const actor = uid();
    return runTransaction(fireDb, async tx => {
        const jobRef = ref('ebysExecutionJobs', id);
        const job = (await tx.get(jobRef)).data();
        if (!job) throw new Error('İcra işi bulunamadı.');
        if (action === 'complete' && matchesCompletion(job, actor, expectedRevision, input)) {
            return { ok: true, alreadyCompleted: true };
        }
        if (job.revision !== expectedRevision) throw new Error('İcra işi değişti. Güncel kaydı yeniden açın.');
        if (action !== 'reassign' && job.assigneeUid !== actor) throw new Error('İcra işi size atanmış olmalıdır.');

        let state;
        let target = {};
        if (action === 'reassign') {
            requireAdmin();
            if (job.state === 'completed') throw new Error('Tamamlanan iş yeniden havale edilemez.');
            target = await resolveTarget(tx, input);
            if (job.state !== 'returned' && target.assigneeUid === job.assigneeUid) throw new Error('Farklı bir sorumlu seçin.');
            target.dueAt = Timestamp.fromMillis(Date.now() + target.dueHours * 3600000);
            state = 'pending_acceptance';
        } else if (action === 'accept' && job.state === 'pending_acceptance') {
            state = 'in_progress';
        } else if (action === 'return' && job.state === 'in_progress') {
            state = 'returned';
        } else if (action === 'complete' && job.state === 'in_progress') {
            state = 'completed';
        } else {
            throw new Error('Bu işlem işin mevcut durumunda kullanılamaz.');
        }

        const headRef = ref('ebysDocuments', job.documentId);
        const head = state === 'completed' ? (await tx.get(headRef)).data() : null;
        if (state === 'completed' && (head?.state !== 'internally_approved' || head.currentVersionId !== id)) {
            throw new Error('Evrak bu sürümde kapanışa uygun değil.');
        }
        const next = {
            ...job, ...target, state, revision: job.revision + 1, lastAction: action, lastActorUid: actor,
            returnedAt: state === 'returned' ? serverTimestamp() : null,
            note: input.note || '', evidenceRef: input.evidenceRef || '', stockOperationId: input.stockOperationId || '',
            updatedAt: serverTimestamp()
        };
        const eventId = id + '__' + next.revision;
        tx.set(jobRef, next);
        tx.set(ref('ebysExecutionEvents', eventId), {
            id: eventId, processId: id, ownerUid: job.ownerUid, revision: next.revision, from: job.state,
            to: state, action, actorUid: actor, previousAssigneeUid: job.assigneeUid, assigneeUid: next.assigneeUid,
            note: next.note, returnedAt: job.returnedAt || null, createdAt: serverTimestamp()
        });
        if (state === 'completed') {
            tx.update(headRef, { state: 'closed', revision: head.revision + 1, updatedAt: serverTimestamp() });
            tx.set(ref('ebysNotifications', id), {
                id, processId: id, documentId: job.documentId, recipientUid: job.ownerUid, eventId,
                type: 'execution_closed', emailState: 'deferred', readAt: null, createdAt: serverTimestamp()
            });
        }
        return action === 'complete' ? { ok: true, alreadyCompleted: false } : state;
    });
}

export const acceptExecutionJob = (id, revision) => changeJob(id, revision, 'accept');
export const returnExecutionJob = (id, revision, note) => changeJob(id, revision, 'return', { note: requiredText(note, 1000, 'İade gerekçesi') });
export const reassignExecutionJob = (id, revision, input) => changeJob(id, revision, 'reassign', { ...input, note: requiredText(input.note, 1000, 'Havale gerekçesi') });
export async function completeExecutionJob(id, revision, input) {
    const stockOperationId = String(input.stockOperationId ?? '').trim() ? stockId(input.stockOperationId) : '';
    const payload = {
        note: requiredText(input.note, 1000, 'İşlem sonucu'),
        evidenceRef: requiredText(input.evidenceRef, 240, 'İşlem kanıtı referansı'),
        stockOperationId
    };
    const actor = uid(), scope = root(), jobRef = ref('ebysExecutionJobs', id);
    const sameSession = () => window.userAuth?.uid === actor && root() === scope;
    try {
        return await changeJob(id, revision, 'complete', payload);
    } catch (error) {
        let saved;
        try {
            if (sameSession()) saved = (await getDocFromServer(jobRef)).data();
        } catch { /* Doğrulama okunamazsa transaction hatası korunur. */ }
        if (sameSession() && matchesCompletion(saved, actor, revision, payload)) {
            return { ok: true, alreadyCompleted: true };
        }
        throw error;
    }
}
export const archiveExecutionDocument = id => window.AppModules.EBYSVerification.archiveExecutionDocument(id);

export async function saveExecutionPolicy(kind, sourceUnitId, input) {
    requireAdmin();
    if (!kinds.includes(kind) || typeof sourceUnitId !== 'string') throw new Error('Evrak türü veya kaynak birim geçersiz.');
    await runTransaction(fireDb, async tx => {
        if (sourceUnitId) {
            const source = (await tx.get(ref('units', sourceUnitId))).data();
            if (!source || source.active === false) throw new Error('Aktif bir evrak birimi seçin.');
        }
        const target = await resolveTarget(tx, input);
        tx.set(ref('ebysExecutionPolicies', policyKey(kind, sourceUnitId)), { ...target, kind, sourceUnitId, updatedAt: serverTimestamp() });
    });
}

export async function linkExecutionStockOperation(id, rawStockId, reason) {
    requireAdmin();
    const operationId = stockId(rawStockId), note = requiredText(reason, 240, 'Stok ilişkilendirme gerekçesi');
    return runTransaction(fireDb, async tx => {
        const linkRef = ref('ebysExecutionStockLinks', operationId);
        const [job, operation, link] = await Promise.all([
            tx.get(ref('ebysExecutionJobs', id)), tx.get(ref('stockOperations', operationId)), tx.get(linkRef)
        ]);
        if (!job.exists() || !activeStates.includes(job.data().state)) throw new Error('Aktif icra işi gerekli.');
        if (!operation.exists()) throw new Error('Stok işlem defterinde bu kayıt yok.');
        if (link.exists()) {
            if (link.data().processId !== id) throw new Error('Bu stok işlemi başka bir evraka bağlı.');
            return;
        }
        tx.set(linkRef, { operationId, processId: id, actorUid: uid(), note, createdAt: serverTimestamp() });
    });
}

export async function readStockOperation(rawStockId) {
    requireAdmin();
    const record = await getDocFromServer(ref('stockOperations', stockId(rawStockId)));
    if (!record.exists()) throw new Error('Stok işlem defterinde bu kayıt yok.');
    return record.data();
}

function watch(col, constraints, onData, onError) {
    return onSnapshot(query(items(col), ...constraints), snap => onData(snap.docs.map(d => ({ ...d.data(), cursor: d }))), onError);
}

export function watchExecutionJobs(admin, cursor, onData, onError) {
    const scoped = admin ? [] : [where('assigneeUid', '==', uid())];
    return watch('ebysExecutionJobs', [...scoped, orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)], onData, onError);
}
export function watchNotifications(cursor, onData, onError) {
    return watch('ebysNotifications', [where('recipientUid', '==', uid()), orderBy('createdAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)], onData, onError);
}
export function watchReturnedExecutionJobs(cursor, onData, onError) {
    requireAdmin();
    return watch('ebysExecutionJobs', [where('state', '==', 'returned'), orderBy('returnedAt', 'asc'),
        ...(cursor ? [startAfter(cursor)] : []), limit(50)], onData, onError);
}
export function readExecutionPolicy(kind, sourceUnitId) {
    requireAdmin();
    return getDocFromServer(ref('ebysExecutionPolicies', policyKey(kind, sourceUnitId))).then(s => s.data());
}
export async function readExecutionHistory(id) {
    requireAdmin();
    const snap = await getDocs(query(items('ebysExecutionEvents'), where('processId', '==', id), orderBy('revision', 'desc'), limit(50)));
    return snap.docs.map(d => d.data());
}
export const readExecutionHead = id => getDocFromServer(ref('ebysDocuments', id)).then(s => s.data());
export const markNotificationRead = id => updateDoc(ref('ebysNotifications', id), { readAt: serverTimestamp() });

window.AppModules = window.AppModules || {};
window.AppModules.EBYSExecution = {
    assignExecutionJob, acceptExecutionJob, returnExecutionJob, reassignExecutionJob, completeExecutionJob,
    archiveExecutionDocument, saveExecutionPolicy, watchExecutionJobs, watchReturnedExecutionJobs, readExecutionPolicy,
    linkExecutionStockOperation, readStockOperation,
    readExecutionHistory, readExecutionHead, watchNotifications, markNotificationRead
};
