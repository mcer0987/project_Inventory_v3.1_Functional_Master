// [WHY]: v3.4 EBYS H7 · Gelen–cevap bağı (D2), gelen evrak mükerrer anahtarı (D3) ve giden evrak manuel gönderim
//        kayıtları (D4) mevcut evrak/sürüm transaction'larını şişirmeden kendi atomik işlemlerinde yürütülür.
// [HOW]: Her koleksiyon create-only sözleşmesiyle yazılır; tekrar denemelerde sabit kimliklerle (replyDocumentId,
//        sha256 anahtarı, operationId) idempotent sonuç döndürülür. Okumalar yalnız ilgili pencere/alan tetiklendiğinde
//        tekil sorgularla yapılır (Spark uyumu: sürekli dinleyici yok).
import { doc, collection, query, where, limit, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import '../utils/ebys-document-schema.js';
import '../utils/ebys-correspondence-schema.js';

const S = () => window.AppModules.EBYSCorrespondenceSchema;
const D = () => window.AppModules.EBYSDocumentSchema;
const root = () => window.AppEnv.COLLECTION_ROOT;
const uid = () => {
    const id = window.userAuth?.uid;
    if (!id) throw new Error('Oturum açmalısınız.');
    return id;
};
const ref = (col, id) => doc(fireDb, root(), col, 'items', id);

function session() {
    const actorUid = uid(), collectionRoot = root();
    const assertCurrent = () => {
        if (window.userAuth?.uid !== actorUid || root() !== collectionRoot) {
            throw new Error('Oturum veya ortam değişti.');
        }
    };
    return { actorUid, root: collectionRoot, assertCurrent };
}

function timestampMillis(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    return 0;
}

// [WHY]: D2 — Gelen evraka yazılan cevabın bağı ayrı transaction'da kurulur; başarısız olursa aynı cevap kimliğiyle
//        güvenle tekrar denenebilir.
// [HOW]: Hedef gelen evrakın kayıt numaralı ve dondurulmuş (currentVersionId dolu) olduğu doğrulanır; özet doğrudan
//        hedef sürümün metadataSnapshot alanından üretilir.
export async function createReplyLink({ replyDocumentId, replyToDocumentId }) {
    const s = session();
    if (!replyDocumentId || !replyToDocumentId || replyDocumentId === replyToDocumentId) {
        throw new Error('Cevap ve hedef gelen evrak kimlikleri geçersiz.');
    }
    const linkRef = doc(fireDb, s.root, 'ebysReplyLinks', 'items', replyDocumentId);
    const replyRef = doc(fireDb, s.root, 'ebysDocuments', 'items', replyDocumentId);
    const targetRef = doc(fireDb, s.root, 'ebysDocuments', 'items', replyToDocumentId);

    const run = () => runTransaction(fireDb, async tx => {
        s.assertCurrent();
        const [existingSnap, replySnap, targetSnap] = await Promise.all([
            tx.get(linkRef),
            tx.get(replyRef),
            tx.get(targetRef)
        ]);
        s.assertCurrent();
        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (existing.replyToDocumentId === replyToDocumentId && existing.replyOwnerUid === s.actorUid) {
                return existing;
            }
            throw new Error('Bu evrak başka bir gelen evraka zaten bağlanmış.');
        }
        if (!replySnap.exists()) throw new Error('Cevap evrakı bulunamadı.');
        const replyHead = replySnap.data();
        if (replyHead.ownerUid !== s.actorUid || !['outgoing', 'internal'].includes(replyHead.kind) || !['draft', 'registered'].includes(replyHead.state)) {
            throw new Error('Cevap bağı yalnız kendi giden/iç yazışma taslağınız veya kayıtlı evrakınız için kurulabilir.');
        }
        if (!targetSnap.exists()) throw new Error('Hedef gelen evrak bulunamadı.');
        const targetHead = targetSnap.data();
        if (targetHead.kind !== 'incoming' || !targetHead.registrationNo || !targetHead.currentVersionId) {
            throw new Error('Cevap bağlamak için hedef gelen evrakın kesin kayıt numarası almış ve dondurulmuş olması gerekir.');
        }
        const versionSnap = await tx.get(doc(fireDb, s.root, 'ebysVersions', 'items', targetHead.currentVersionId));
        s.assertCurrent();
        if (!versionSnap.exists()) throw new Error('Hedef gelen evrakın dondurulmuş sürümü bulunamadı.');
        const meta = versionSnap.data().metadataSnapshot || {};
        const replyToSummary = S().normalizeReplySummary({
            registrationNo: targetHead.registrationNo,
            externalRegistrationNo: meta.externalRegistrationNo || '',
            date: meta.date,
            correspondent: meta.correspondent,
            subject: meta.subject
        });
        const link = S().normalizeReplyLink({
            replyDocumentId,
            replyToDocumentId,
            replyToVersionId: targetHead.currentVersionId,
            replyOwnerUid: s.actorUid,
            replyToOwnerUid: targetHead.ownerUid,
            replyToSummary
        });
        tx.set(linkRef, { ...link, createdAt: serverTimestamp() });
        return link;
    });

    try {
        const result = await run();
        s.assertCurrent();
        return result;
    } catch (error) {
        s.assertCurrent();
        try {
            const saved = await getDocFromServer(linkRef);
            s.assertCurrent();
            if (saved.exists() && saved.data().replyToDocumentId === replyToDocumentId && saved.data().replyOwnerUid === s.actorUid) {
                return saved.data();
            }
        } catch { /* Asıl hata korunur. */ }
        throw error;
    }
}

// [WHY]: D2 — Evrak penceresi açıldığında hem bu evrakın bağlı olduğu gelen evrak hem de (gelen evraksa) buna yazılan
//        cevaplar tek seferde okunur.
// [HOW]: Firestore Rules list kısıtlarıyla uyumlu daraltılmış sorgular kullanılır; sürekli dinleyici açılmaz.
export async function getReplyContext(documentId, head = null) {
    const s = session();
    const resolvedHead = head || (await getDocFromServer(doc(fireDb, s.root, 'ebysDocuments', 'items', documentId))).data();
    s.assertCurrent();
    let replyTo = null;
    try {
        const linkSnap = await getDocFromServer(doc(fireDb, s.root, 'ebysReplyLinks', 'items', documentId));
        s.assertCurrent();
        if (linkSnap.exists()) replyTo = linkSnap.data();
    } catch (error) {
        if (error.code !== 'permission-denied') throw error;
    }

    const repliesMap = new Map();
    if (resolvedHead?.kind === 'incoming') {
        const col = collection(fireDb, s.root, 'ebysReplyLinks', 'items');
        const queries = [];
        if (window.isDbAdmin?.()) {
            queries.push(query(col, where('replyToDocumentId', '==', documentId), limit(50)));
        } else {
            if (resolvedHead.ownerUid === s.actorUid) {
                queries.push(query(col, where('replyToDocumentId', '==', documentId), where('replyToOwnerUid', '==', s.actorUid), limit(50)));
            }
            queries.push(query(col, where('replyToDocumentId', '==', documentId), where('replyOwnerUid', '==', s.actorUid), limit(50)));
            if (resolvedHead.currentVersionId) {
                queries.push(query(col, where('replyToDocumentId', '==', documentId), where('replyToVersionId', '==', resolvedHead.currentVersionId), limit(50)));
            }
        }
        for (const q of queries) {
            try {
                const snap = await getDocsFromServer(q);
                s.assertCurrent();
                for (const d of snap.docs) repliesMap.set(d.id, d.data());
            } catch (error) {
                if (error.code !== 'permission-denied') throw error;
            }
        }
    }
    const replies = [...repliesMap.values()].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
    return { replyTo, replies };
}

// [WHY]: D3 — Gelen evrak formunda muhatap, dış sayı ve tarih girildiğinde mükerrer kayıt olup olmadığı tek okumayla
//        kontrol edilir; içerik veya kişi sızdırılmaz.
// [HOW]: SHA-256 anahtarıyla ebysIncomingKeys/{key} tekil olarak okunur.
export async function checkIncomingDuplicate({ correspondent, externalRegistrationNo, date, excludeDocumentId = null }) {
    const s = session();
    const key = await S().incomingDuplicateKey({ correspondent, externalRegistrationNo, date });
    s.assertCurrent();
    if (!key) return { duplicate: false, key: null, record: null };
    const snap = await getDocFromServer(doc(fireDb, s.root, 'ebysIncomingKeys', 'items', key));
    s.assertCurrent();
    if (!snap.exists()) return { duplicate: false, key, record: null };
    const record = snap.data();
    if (excludeDocumentId && record.documentId === excludeDocumentId) {
        return { duplicate: false, key, record: null };
    }
    return {
        duplicate: true,
        key,
        record: {
            id: record.id,
            documentId: record.documentId,
            unitId: record.unitId,
            registrationNo: record.registrationNo,
            createdAt: record.createdAt
        }
    };
}

// [WHY]: D3 — Gelen evrak kesin kayıt numarası aldıktan sonra mükerrer anahtarı ayrı transaction'da yazılır; ilk yazan
//        kazanır ve daha önce alınmış anahtar evrakın kendi kaydını bozmaz.
// [HOW]: ebysIncomingKeys/{key} yoksa oluşturulur; başka evrak tarafından alınmışsa 'already-taken' durumu döndürülür.
export async function registerIncomingKey({ documentId, unitId, registrationNo, metadata }) {
    const s = session();
    const key = await S().incomingDuplicateKey(metadata || {});
    s.assertCurrent();
    if (!key) return { status: 'skipped', key: null };
    const keyRef = doc(fireDb, s.root, 'ebysIncomingKeys', 'items', key);
    return runTransaction(fireDb, async tx => {
        s.assertCurrent();
        const existing = await tx.get(keyRef);
        s.assertCurrent();
        if (existing.exists()) {
            const data = existing.data();
            return {
                status: data.documentId === documentId ? 'registered' : 'already-taken',
                key,
                existing: data
            };
        }
        const record = {
            id: key,
            documentId,
            ownerUid: s.actorUid,
            unitId,
            registrationNo,
            createdAt: serverTimestamp()
        };
        tx.set(keyRef, record);
        return { status: 'registered', key };
    });
}

// [WHY]: D4 — Kurum içi onayı tamamlanmış ve kesin kayıt numarası almış giden evrakın dış gönderim beyanı append-only
//        olarak kaydedilir.
// [HOW]: normalizeDispatch ile tarih/kanal/not doğrulanır; operationId ile idempotent transaction yürütülür.
export async function recordDispatch(input) {
    const s = session();
    const normalized = S().normalizeDispatch(input);
    const operationId = input.operationId || D().uuid();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)) {
        throw new Error('Gönderim işlem kimliği geçersiz.');
    }
    const dispatchRef = doc(fireDb, s.root, 'ebysDispatches', 'items', operationId);
    const docRef = doc(fireDb, s.root, 'ebysDocuments', 'items', normalized.documentId);

    const samePayload = (saved, ownerUid) => saved.actorUid === s.actorUid &&
        saved.ownerUid === ownerUid &&
        saved.documentId === normalized.documentId &&
        saved.versionId === normalized.versionId &&
        saved.channel === normalized.channel &&
        saved.sentDate === normalized.sentDate &&
        saved.externalRef === normalized.externalRef &&
        saved.note === normalized.note &&
        saved.entryKind === normalized.entryKind;

    return runTransaction(fireDb, async tx => {
        s.assertCurrent();
        const [existingSnap, headSnap] = await Promise.all([tx.get(dispatchRef), tx.get(docRef)]);
        s.assertCurrent();
        if (!headSnap.exists()) throw new Error('Evrak bulunamadı.');
        const head = headSnap.data();
        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            if (!samePayload(existing, head.ownerUid)) {
                throw new Error('Gönderim işlem kimliği farklı içerikle kullanılmış.');
            }
            return existing;
        }
        if (head.kind !== 'outgoing' || !head.registrationNo || !['internally_approved', 'closed', 'archived'].includes(head.state)) {
            throw new Error('Gönderim kaydı yalnız kesin kayıt numaralı ve kurum içi onayı tamamlanmış giden evrak için girilebilir.');
        }
        if (head.currentVersionId !== normalized.versionId) {
            throw new Error('Gönderim kaydı yalnız evrakın güncel onaylı sürümüne bağlanabilir.');
        }
        const record = {
            id: operationId,
            ...normalized,
            ownerUid: head.ownerUid,
            actorUid: s.actorUid,
            createdAt: serverTimestamp()
        };
        tx.set(dispatchRef, record);
        return { id: operationId, ...normalized, ownerUid: head.ownerUid, actorUid: s.actorUid };
    });
}

// [WHY]: D4 — Giden evrak penceresinde gönderim geçmişini ek bileşik indeks üretmeden listeler.
// [HOW]: Eşitlik filtreleriyle çekilen kayıtlar istemci belleğinde createdAt azalan sırayla dizilir.
export async function listDispatches(documentId, head = null) {
    const s = session();
    const resolvedHead = head || (await getDocFromServer(doc(fireDb, s.root, 'ebysDocuments', 'items', documentId))).data();
    s.assertCurrent();
    if (!resolvedHead) return [];
    const col = collection(fireDb, s.root, 'ebysDispatches', 'items');
    const queries = [];
    if (window.isDbAdmin?.()) {
        queries.push(query(col, where('documentId', '==', documentId), limit(50)));
    } else if (resolvedHead.ownerUid === s.actorUid) {
        queries.push(query(col, where('documentId', '==', documentId), where('ownerUid', '==', s.actorUid), limit(50)));
    } else {
        if (resolvedHead.currentVersionId) {
            queries.push(query(col, where('documentId', '==', documentId), where('versionId', '==', resolvedHead.currentVersionId), limit(50)));
        }
        queries.push(query(col, where('documentId', '==', documentId), where('actorUid', '==', s.actorUid), limit(50)));
    }
    const items = new Map();
    for (const q of queries) {
        try {
            const snap = await getDocsFromServer(q);
            s.assertCurrent();
            for (const d of snap.docs) items.set(d.id, d.data());
        } catch (error) {
            if (error.code !== 'permission-denied') throw error;
        }
    }
    return [...items.values()].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
}

window.AppModules = window.AppModules || {};
window.AppModules.EBYSCorrespondence = {
    createReplyLink,
    getReplyContext,
    checkIncomingDuplicate,
    registerIncomingKey,
    recordDispatch,
    listDispatches
};

