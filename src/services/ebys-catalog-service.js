import { doc, collection, query, where, getDocFromServer, getDocsFromServer, runTransaction, deleteDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import '../utils/ebys-catalog-schema.js';

// [WHY]: v3.4 EBYS H6b · Kurum künyesi, dosya planı ve üst yazı şablonu tanımları. Yönetici yazar, personel okur
//        (firestore.rules ec* blokları). Silme yoktur: pasifleştirme ve yeni sürüm vardır; evrak tanımın kopyasını taşır.
// [HOW]: Her yazma tek transaction'dır; güncel kayıt okunur, beklenen revizyon tutmazsa reddedilir (bayat ekran üzerine
//        yazamaz). Künyenin her revizyonu ve şablonun her sürümü ayrı, değiştirilemez kayıt olarak saklanır.
const C = () => window.AppModules.EBYSCatalogSchema;
const root = () => window.AppEnv.COLLECTION_ROOT;
const ref = (col, id) => doc(fireDb, root(), col, 'items', String(id));
const uid = () => { const id = window.userAuth?.uid; if (!id) throw new Error('Oturum açmalısınız.'); return id; };
const admin = () => { if (!window.isDbAdmin?.()) throw new Error('Bu işlem yönetici yetkisi gerektirir.'); };
const stale = (old, expected, label) => {
    if (expected !== undefined && (old?.revision || 0) !== expected) throw new Error(`${label} başka bir oturumda değişmiş; ekranı yenileyip yeniden deneyin.`);
};
const rows = snap => snap.docs.map(d => d.data());

// Personel ve yönetici: evrak formu ve Tanımlar ekranı için güncel katalog (sunucudan; önbellekteki eski künye kullanılmaz).
async function loadCatalog() {
    uid();
    const [profile, plans, templates] = await Promise.all([
        getDocFromServer(ref('ebysOrganizations', C().PROFILE_ID)),
        getDocsFromServer(collection(fireDb, root(), 'ebysFilePlans', 'items')),
        getDocsFromServer(collection(fireDb, root(), 'ebysLetterTemplates', 'items')),
    ]);
    return { profile: profile.exists() ? profile.data() : null, filePlans: rows(plans), templates: rows(templates) };
}
async function getTemplateRevision(templateId, revision) {
    const snap = await getDocFromServer(ref('ebysLetterTemplateRevisions', C().revisionId(templateId, revision)));
    if (!snap.exists()) throw new Error('Şablon sürümü bulunamadı.');
    return snap.data();
}
async function listTemplateRevisions(templateId) {
    const snap = await getDocsFromServer(query(collection(fireDb, root(), 'ebysLetterTemplateRevisions', 'items'), where('templateId', '==', String(templateId))));
    return rows(snap).sort((a, b) => b.revision - a.revision);
}
async function listProfileRevisions() {
    return rows(await getDocsFromServer(collection(fireDb, root(), 'ebysOrganizationRevisions', 'items'))).sort((a, b) => b.revision - a.revision);
}

async function saveProfile(input, { expectedRevision } = {}) {
    admin();
    const actor = uid(), data = C().normalizeProfile(input);
    return runTransaction(fireDb, async tx => {
        const snap = await tx.get(ref('ebysOrganizations', C().PROFILE_ID));
        const old = snap.exists() ? snap.data() : null;
        stale(old, expectedRevision, 'Kurum künyesi');
        const revision = (old?.revision || 0) + 1;
        const next = { id: C().PROFILE_ID, ...data, revision, updatedAt: serverTimestamp(), updatedBy: actor };
        tx.set(ref('ebysOrganizations', C().PROFILE_ID), next);
        // Künye geçmişi: her revizyon ayrı ve değiştirilemez kayıttır (hangi evrakın hangi künyeyi aldığı izlenebilir).
        tx.set(ref('ebysOrganizationRevisions', String(revision)), { id: String(revision), revision, profile: data, createdAt: serverTimestamp(), createdBy: actor });
        return { ...next, updatedAt: null };
    });
}

async function saveFilePlan(input, { expectedRevision, create = false } = {}) {
    admin();
    const actor = uid(), data = C().normalizeFilePlan(input);
    return runTransaction(fireDb, async tx => {
        const snap = await tx.get(ref('ebysFilePlans', data.code));
        if (create && snap.exists()) throw new Error(`"${data.code}" kodlu dosya planı zaten var.`);
        if (!create && !snap.exists()) throw new Error('Dosya planı bulunamadı.');
        const old = snap.exists() ? snap.data() : null;
        stale(old, expectedRevision, 'Dosya planı');
        const next = {
            id: data.code, code: data.code, title: data.title, active: data.active, revision: (old?.revision || 0) + 1,
            createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor
        };
        tx.set(ref('ebysFilePlans', data.code), next);
        return { ...next, createdAt: null, updatedAt: null };
    });
}
async function setFilePlanActive(code, enabled, { expectedRevision } = {}) {
    admin();
    const snap = await getDocFromServer(ref('ebysFilePlans', C().planCode(code)));
    if (!snap.exists()) throw new Error('Dosya planı bulunamadı.');
    return saveFilePlan({ ...snap.data(), active: !!enabled }, { expectedRevision });
}

// Kaydetme = yeni sürüm. Eski sürümler silinmez ve değişmez; o sürümle başlatılmış evraklar aynı metni taşımaya devam eder.
async function saveTemplate(input, { expectedRevision } = {}) {
    admin();
    const actor = uid(), data = C().normalizeTemplate(input);
    const id = input.id ? String(input.id) : crypto.randomUUID();
    return runTransaction(fireDb, async tx => {
        const snap = await tx.get(ref('ebysLetterTemplates', id));
        if (input.id && !snap.exists()) throw new Error('Şablon bulunamadı.');
        const old = snap.exists() ? snap.data() : null;
        stale(old, expectedRevision, 'Şablon');
        const currentRevision = (old?.currentRevision || 0) + 1;
        tx.set(ref('ebysLetterTemplateRevisions', C().revisionId(id, currentRevision)), {
            id: C().revisionId(id, currentRevision), templateId: id,
            revision: currentRevision, ...data, createdAt: serverTimestamp(), createdBy: actor
        });
        const next = {
            id, name: data.name, active: old ? old.active !== false : true, currentRevision, revision: (old?.revision || 0) + 1,
            createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor
        };
        tx.set(ref('ebysLetterTemplates', id), next);
        return { ...next, createdAt: null, updatedAt: null };
    });
}
async function setTemplateActive(id, enabled, { expectedRevision } = {}) {
    admin();
    const actor = uid();
    return runTransaction(fireDb, async tx => {
        const snap = await tx.get(ref('ebysLetterTemplates', id));
        if (!snap.exists()) throw new Error('Şablon bulunamadı.');
        const old = snap.data();
        stale(old, expectedRevision, 'Şablon');
        const next = { ...old, active: !!enabled, revision: (old.revision || 0) + 1, updatedAt: serverTimestamp(), updatedBy: actor };
        tx.set(ref('ebysLetterTemplates', id), next);
        return { ...next, createdAt: null, updatedAt: null };
    });
}

// [WHY]: v3.7 İP-11 · Kullanıcının yalnızca kendi kişisel üst yazı şablonlarını sunucudan listeler.
// [HOW]: ownerUid == actor sorgusu firestore.rules personalTemplateAccessOk list kuralıyla tam uyumludur; ad sırasıyla döner.
async function listMyPersonalTemplates() {
    const actor = uid();
    const snap = await getDocsFromServer(query(collection(fireDb, root(), 'ebysPersonalTemplates', 'items'), where('ownerUid', '==', actor)));
    return rows(snap).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
}

// [WHY]: v3.7 İP-11 · Personelin sık kullandığı üst yazı taslağını kendi kişisel şablonu olarak kaydetmesi veya güncellemesi.
// [HOW]: normalizePersonalTemplate ile doğrular; tek transaction içinde ownerUid ve createdAt değerlerini koruyarak yazar.
async function savePersonalTemplate(input) {
    const actor = uid(), data = C().normalizePersonalTemplate(input);
    const id = input && input.id ? String(input.id).trim() : crypto.randomUUID();
    if (!id) throw new Error('Kişisel şablon kimliği geçersiz.');
    return runTransaction(fireDb, async tx => {
        const target = ref('ebysPersonalTemplates', id);
        const snap = await tx.get(target);
        if (input && input.id && !snap.exists()) throw new Error('Kişisel şablon bulunamadı.');
        const old = snap.exists() ? snap.data() : null;
        if (old && old.ownerUid !== actor) throw new Error('Bu kişisel şablon size ait değil.');
        const next = {
            id, ownerUid: old ? old.ownerUid : actor, ...data,
            createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(),
        };
        tx.set(target, next);
        return { ...next, createdAt: null, updatedAt: null };
    });
}

// [WHY]: v3.7 İP-11 · Kullanıcının kendi kişisel üst yazı şablonunu kalıcı olarak silmesi.
// [HOW]: Oturum ve kimlik doğrulamasından sonra belgeyi siler; sahiplik sunucu tarafında personalTemplateAccessOk ile zorlanır.
async function deletePersonalTemplate(id) {
    uid();
    const targetId = String(id ?? '').trim();
    if (!targetId) throw new Error('Silinecek kişisel şablon kimliği gerekli.');
    await deleteDoc(ref('ebysPersonalTemplates', targetId));
    return { id: targetId, deleted: true };
}

// [WHY]: v3.8 VP-4 · Yönetici vekâleten kişisel şablon erişimi tanımlama (süreli, gerekçeli ve atomik denetim kayıtlı).
// [HOW]: Tek transaction içinde ebysDelegations/items/pt_{ownerUid} ve auditLogs/items/{auditId} birlikte yazılır.
async function grantPersonalTemplateDelegation(input) {
    admin();
    const actor = uid();
    const norm = C().normalizeDelegation(input);
    if (norm.ownerUid === actor) throw new Error('Kendi hesabınız için vekâlet tanımlayamazsınız.');
    const auditId = crypto.randomUUID();
    const expiresAt = Timestamp.fromMillis(Date.now() + norm.durationMs);
    return runTransaction(fireDb, async tx => {
        const target = ref('ebysDelegations', norm.id);
        const snap = await tx.get(target);
        const old = snap.exists() ? snap.data() : null;
        const next = {
            id: norm.id,
            ownerUid: norm.ownerUid,
            delegateUid: actor,
            scope: C().DELEGATION_SCOPE,
            reason: norm.reason,
            expiresAt,
            revoked: false,
            auditId,
            createdAt: old?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: actor,
        };
        tx.set(target, next);
        tx.set(ref('auditLogs', auditId), {
            id: auditId,
            type: 'ebys-vekalet-verildi',
            refCol: 'ebysDelegations',
            refId: norm.id,
            item: `Kişisel Şablon Vekâleti (${norm.ownerUid})`,
            actorName: window.getActiveUser?.()?.name || 'Yönetici',
            uid: actor,
            result: 'approved',
            reason: norm.reason,
            ts: serverTimestamp(),
        });
        return { ...next, createdAt: null, updatedAt: null };
    });
}

// [WHY]: v3.8 VP-4 · Aktif kişisel şablon vekâletini sonlandırma (silme yoktur; iz kalması için revoked:true + auditLogs yazılır).
// [HOW]: Mevcut vekâlet belgesini okuyup expiresAt ve createdAt alanlarını koruyarak revoked:true ve yeni auditId ile mühürler.
async function revokePersonalTemplateDelegation(input) {
    admin();
    const actor = uid();
    const ownerUid = String(input?.ownerUid ?? input ?? '').trim();
    const id = C().delegationId(ownerUid);
    const reason = String(input?.reason || 'Vekâlet yönetici tarafından sonlandırıldı.').trim();
    if (reason.length < 5 || /<[a-zA-Z/!?]/.test(reason)) throw new Error('İptal gerekçesi en az 5 karakter ve etiketsiz olmalıdır.');
    const auditId = crypto.randomUUID();
    return runTransaction(fireDb, async tx => {
        const target = ref('ebysDelegations', id);
        const snap = await tx.get(target);
        if (!snap.exists()) throw new Error('Sonlandırılacak vekâlet kaydı bulunamadı.');
        const old = snap.data();
        const next = {
            id,
            ownerUid: old.ownerUid,
            delegateUid: actor,
            scope: C().DELEGATION_SCOPE,
            reason: reason.slice(0, 240),
            expiresAt: old.expiresAt,
            revoked: true,
            auditId,
            createdAt: old.createdAt,
            updatedAt: serverTimestamp(),
            createdBy: actor,
        };
        tx.set(target, next);
        tx.set(ref('auditLogs', auditId), {
            id: auditId,
            type: 'ebys-vekalet-iptal',
            refCol: 'ebysDelegations',
            refId: id,
            item: `Kişisel Şablon Vekâlet İptali (${old.ownerUid})`,
            actorName: window.getActiveUser?.()?.name || 'Yönetici',
            uid: actor,
            result: 'approved',
            reason: reason.slice(0, 240),
            ts: serverTimestamp(),
        });
        return { ...next, createdAt: null, updatedAt: null };
    });
}

// [WHY]: v3.8 VP-4 · Yöneticinin tanımlı kişisel şablon vekâletlerini veya personelin kendi hesabındaki aktif vekâleti görmesi.
// [HOW]: Yönetici tüm ebysDelegations koleksiyonunu, personel yalnız kendi deterministik pt_{uid} belgesini okur.
async function listPersonalTemplateDelegations() {
    admin();
    uid();
    const snap = await getDocsFromServer(collection(fireDb, root(), 'ebysDelegations', 'items'));
    return rows(snap).sort((a, b) => String(a.ownerUid || '').localeCompare(String(b.ownerUid || ''), 'tr'));
}
async function getMyPersonalTemplateDelegation() {
    const actor = uid();
    const snap = await getDocFromServer(ref('ebysDelegations', C().delegationId(actor)));
    if (!snap.exists()) return null;
    const data = snap.data();
    return C().isDelegationActive(data) ? data : null;
}
async function listDelegatedPersonalTemplates(ownerUid) {
    admin();
    uid();
    const targetOwner = String(ownerUid ?? '').trim();
    if (!targetOwner) throw new Error('Hedef personel kullanıcı kimliği (UID) gerekli.');
    const snap = await getDocsFromServer(query(collection(fireDb, root(), 'ebysPersonalTemplates', 'items'), where('ownerUid', '==', targetOwner)));
    return rows(snap).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
}

window.AppModules = window.AppModules || {};
window.AppModules.EBYSCatalog = {
    loadCatalog, getTemplateRevision, listTemplateRevisions, listProfileRevisions,
    saveProfile, saveFilePlan, setFilePlanActive, saveTemplate, setTemplateActive,
    listMyPersonalTemplates, savePersonalTemplate, deletePersonalTemplate,
    grantPersonalTemplateDelegation, revokePersonalTemplateDelegation,
    listPersonalTemplateDelegations, getMyPersonalTemplateDelegation, listDelegatedPersonalTemplates
};
export {
    loadCatalog, getTemplateRevision, listTemplateRevisions, listProfileRevisions, saveProfile, saveFilePlan, setFilePlanActive, saveTemplate, setTemplateActive,
    listMyPersonalTemplates, savePersonalTemplate, deletePersonalTemplate,
    grantPersonalTemplateDelegation, revokePersonalTemplateDelegation,
    listPersonalTemplateDelegations, getMyPersonalTemplateDelegation, listDelegatedPersonalTemplates
};
