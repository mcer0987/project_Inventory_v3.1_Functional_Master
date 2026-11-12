import { doc, collection, query, where, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
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
        const next = { id: data.code, code: data.code, title: data.title, active: data.active, revision: (old?.revision || 0) + 1,
            createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor };
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
        tx.set(ref('ebysLetterTemplateRevisions', C().revisionId(id, currentRevision)), { id: C().revisionId(id, currentRevision), templateId: id,
            revision: currentRevision, ...data, createdAt: serverTimestamp(), createdBy: actor });
        const next = { id, name: data.name, active: old ? old.active !== false : true, currentRevision, revision: (old?.revision || 0) + 1,
            createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor };
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

window.AppModules = window.AppModules || {};
window.AppModules.EBYSCatalog = { loadCatalog, getTemplateRevision, listTemplateRevisions, listProfileRevisions,
    saveProfile, saveFilePlan, setFilePlanActive, saveTemplate, setTemplateActive };
export { loadCatalog, getTemplateRevision, listTemplateRevisions, listProfileRevisions, saveProfile, saveFilePlan, setFilePlanActive, saveTemplate, setTemplateActive };
