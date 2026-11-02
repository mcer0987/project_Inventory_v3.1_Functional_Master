import { doc, collection, getDocs, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';

const S = () => window.AppModules.EBYSDefinitionsSchema;
const ref = (col, id) => doc(fireDb, window.AppEnv.COLLECTION_ROOT, col, 'items', String(id));
const admin = () => { if (!window.isDbAdmin?.()) throw new Error('Bu işlem yönetici yetkisi gerektirir.'); };
// [WHY]: Birim düzenlemesi bütün koleksiyonu eski snapshot ile yeniden yazmamalıdır.
// [HOW]: Güncel hiyerarşi transaction'da okunur; eski alanlar korunur ve yalnız hedef doküman yazılır.
async function saveUnit(input) {
    admin();
    const id = input.id ? String(input.id) : crypto.randomUUID();
    const inventory = await getDocs(collection(fireDb, window.AppEnv.COLLECTION_ROOT, 'units', 'items'));
    return runTransaction(fireDb, async tx => {
        const snapshots = await Promise.all(inventory.docs.map(d => tx.get(d.ref)));
        const target = await tx.get(ref('units', id));
        const old = target.exists() ? target.data() : {};
        if (input.id && !target.exists()) throw new Error('Birim bulunamadı.');
        if (input.expectedRevision !== undefined && (old.revision || 0) !== input.expectedRevision) throw new Error('Birim değişmiş; yeniden açıp deneyin.');
        if (old.organizationId && old.organizationId !== String(input.organizationId || '').trim()) throw new Error('Kurum bağlantısı sabittir; birim taşıma ayrı geçiş gerektirir.');
        const personnelIds = [...new Set((input.personnelIds || []).map(String))];
        const people = await Promise.all(personnelIds.map(pid => tx.get(ref('personel', pid))));
        if (people.some(p => !p.exists())) throw new Error('Seçili personel bulunamadı.');
        if (people.some(p => p.data().active === false && !(old.personnelIds || []).map(String).includes(String(p.id))))
            throw new Error('Pasif personel yeni birime atanamaz.');
        const next = { ...old, id, name: String(input.name || '').trim(),
            parentUnitId: String(input.parentUnitId || ''), organizationId: String(input.organizationId || '').trim(),
            code: String(input.code || '').trim(), active: input.active !== false, personnelIds,
            // Eski adlar silinmez: geçmiş ekranlar aynı metinleri okumaya devam eder.
            personnel: [...new Set([...(old.personnel || []), ...people.map(p => S().nameOf(p.data()))])],
            revision: (old.revision || 0) + 1, updatedAt: new Date().toISOString() };
        S().validateUnit(next, snapshots.filter(d => d.exists()).map(d => d.data()), old);
        tx.set(ref('units', id), next);
        return next;
    });
}
// [WHY]: Personel ID/UID'si düzenleme veya pasifleştirmede değişmemelidir.
// [HOW]: Güncel kayda alan bazında patch; birim adı legacy görünüm için kopyalanır.
async function savePersonnel(input, fields, create = false) {
    admin();
    return runTransaction(fireDb, async tx => {
        const target = await tx.get(ref('personel', input.id));
        if (create === target.exists()) throw new Error(create ? 'Personel kimliği zaten var.' : 'Personel bulunamadı.');
        const old = target.exists() ? target.data() : input;
        if (!create && fields.expectedRevision !== undefined && (old.revision || 0) !== fields.expectedRevision) throw new Error('Personel değişmiş; yeniden açıp deneyin.');
        const unit = fields.unitId ? await tx.get(ref('units', fields.unitId)) : null;
        const patch = S().personnelPatch(old, fields, unit?.exists() ? [unit.data()] : []);
        const permitted = create ? input : { ...old, name: input.name ?? old.name, pri: input.pri ?? old.pri };
        const next = { ...permitted, ...patch, id: old.id, revision: (old.revision || 0) + 1 };
        tx.set(ref('personel', input.id), next);
        return next;
    });
}
async function setActive(col, id, enabled) {
    admin();
    if (!['units', 'personel'].includes(col)) throw new Error('Geçersiz tanım.');
    return runTransaction(fireDb, async tx => {
        const snapshot = await tx.get(ref(col, id));
        if (!snapshot.exists()) throw new Error('Kayıt bulunamadı.');
        tx.update(ref(col, id), { active: !!enabled, revision: (snapshot.data().revision || 0) + 1 });
    });
}
window.AppModules = window.AppModules || {};
window.AppModules.EBYSDefinitions = { saveUnit, savePersonnel, setActive };
