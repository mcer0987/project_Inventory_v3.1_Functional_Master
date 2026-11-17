// [WHY]: H5 — satın alma formu hâlâ yalnız eski 'workflow' motoruna yazıyordu; Aşama 1-4'te tamamlanan
//        EBYS süreç/evrak servisleri (ebys-document-service.js, ebys-process-service.js) hiçbir UI'dan
//        çağrılmıyordu. Eski tek ürünlü/çok kalemli talepler bu dosyayla bozulmadan aynı formda kalır;
//        yalnız "EBYS süreciyle gönder" seçildiğinde yeni servis zincirine bağlanır.
// [HOW]: Mevcut satın alma modalındaki aynı alanlar (#purUnit, #purName, #purDesc, kalem editörü) okunur;
//        createPurchaseDocument → freezePurchaseVersion → EBYSProcessUI.open() zincirlenir. Çifte işlem
//        koruması ebys-documents-ui.js'teki 'busy' kilidiyle aynı kalıptır (buton grubu disable/finally).
import { createPurchaseDocument, savePurchaseDraft, freezePurchaseVersion } from '../services/ebys-document-service.js';
import '../services/ebys-process-service.js';
import '../utils/ebys-document-schema.js';

// [WHY]: #purUnit'in value'su birim adıdır (legacy akış bunu bekler); isme göre arama aynı adlı iki birimde
//        yanlış birime havale riski taşır. [HOW]: Seçili <option>'ın data-unit-id'si (ID bazlı, bkz.
//        purchase-servises.js _fillNamedSelect) önceliklidir; yoksa (ör. ID'siz eski birim) isme düşülür.
function resolveUnitId(selectedOption, unitName) {
    const datasetId = selectedOption?.dataset?.unitId;
    if (datasetId) return datasetId;
    const unit = (window.data?.units || []).find(u => (u.name || u.birimAdi) === unitName && u.active !== false);
    if (!unit?.id) throw new Error('Seçili birim EBYS süreci için tanımlı değil (kalıcı ID yok). Tanımlar ekranında birim kaydını kontrol edin.');
    return String(unit.id);
}

// [WHY]: A-5 — Evrak oluşup dondurma düştüğünde tekrar tıklama yeni işlem kimliğiyle ikinci bir talep yaratıyordu.
//        A-2 — İade/red/geri çekme sonrası bağlı evrak yalnız satın alma taslak komutuyla yeni sürüme açılabilir.
// [HOW]: draftTarget, formun yazacağı son bilinen taslak başıdır (yeni talepte null). pendingSubmission aynı içerikteki
//        tekrar denemede aynı saveOpId/freezeOpId'yi ve kaydedilmiş taslak sonucunu tutar: kayıt tamamsa doğrudan
//        dondurmaya geçilir. İçerik değişirse yeni işlem kimlikleri alınır ama kaydedilmiş taslak güncellenir (yeni talep açılmaz).
let draftTarget = null, pendingSubmission = null;
const docSchema = () => window.AppModules.EBYSDocumentSchema;

function clearPending() {
    draftTarget = null;
    pendingSubmission = null;
    const status = document.getElementById('purEbysStatus');
    if (status) { status.hidden = true; status.textContent = ''; }
}

async function organizationCodeForNew() {
    const cat = await Promise.resolve(window.AppModules.EBYSCatalog?.loadCatalog()).catch(() => null);
    return cat?.profile?.code || 'MED';
}

async function submitPurchaseViaEbys({ unitSelect, unitName, subject, items, butce, budgetMode }) {
    const unitId = resolveUnitId(unitSelect?.selectedOptions?.[0], unitName);
    const content = docSchema().canonical({ unitId, subject, items, butce, budgetMode });
    if (!pendingSubmission || pendingSubmission.content !== content) {
        // İmza = içerik + bağlanılan taslak başı (documentId/expectedRevision). Hedef, deneme başında sabitlenir;
        // draftTarget yalnız başarılı kayıtta (saved dolar) ya da yeni düzenleme açılınca (pending sıfırlanır) değişir.
        pendingSubmission = { content, target: draftTarget ? { ...draftTarget } : null,
            saveOpId: crypto.randomUUID(), freezeOpId: crypto.randomUUID(), saved: null };
    }
    const pending = pendingSubmission;
    if (!pending.saved) {
        const target = pending.target, today = new Date().toISOString().slice(0, 10);
        const metadata = { ...(target?.metadataBase || {}), subject, correspondent: unitName, date: today,
            filePlanCode: 'PURCHASE_REQUEST', confidentiality: 'Normal' };
        const common = { unitId, content: `Satın alma talebi: ${subject}`, metadata, items, butce, budgetMode, operationId: pending.saveOpId };
        const saved = target
            ? await savePurchaseDraft({ ...common, id: target.id, expectedRevision: target.expectedRevision, reopen: target.reopen,
                organizationCode: target.organizationCode })
            : await createPurchaseDocument({ ...common, organizationCode: pending.organizationCode ||= await organizationCodeForNew() });
        pending.saved = saved;
        draftTarget = { id: saved.documentId, expectedRevision: saved.revision, reopen: false, metadataBase: target?.metadataBase || {},
            organizationCode: target?.organizationCode || pending.organizationCode };
    }
    return freezePurchaseVersion({ documentId: pending.saved.documentId, expectedRevision: pending.saved.revision, operationId: pending.freezeOpId });
}

// [WHY]: A-2 — Satın almaya bağlı evrak (iade/red/geri çekilmiş ya da dondurulmamış taslak) için kalemleri düzenleyip yeni
//        sürüm hazırlayacak bir arayüz yoktu; genel evrak formu bu kaydı reddeder.
// [HOW]: Başlık ve gövde (taslak veya son sürüm) okunur; satın alma modalı sıfırlanıp birim, konu, ödenek ve kalemlerle
//        doldurulur. Klasik kayıt düğmesi gizlenir; "EBYS süreciyle gönder" savePurchaseDraft (+reopen) → dondur → rota açar.
async function openForRevision(documentId, expectedVersionId = null) {
    const { head, body } = await window.AppModules.EBYSDocuments.readDocument(documentId);
    if (!Object.hasOwn(head, 'purchaseOrderId')) throw new Error('Bu evrak bir satın alma talebine bağlı değil.');
    if (expectedVersionId && head.currentVersionId !== expectedVersionId) throw new Error('Bu evrak için daha yeni bir sürüm hazırlanmış.');
    if (!['draft', 'registered', 'returned', 'rejected', 'withdrawn'].includes(head.state)) {
        if (!head.currentVersionId) throw new Error('Evrak düzenlemeye uygun değil.');
        return window.AppModules.EBYSProcessUI?.open(head.currentVersionId, head.id, head.ownerUid === window.userAuth?.uid);
    }
    if (head.ownerUid !== window.userAuth?.uid) throw new Error('Yalnız talebin yazarı yeni sürüm hazırlayabilir.');
    const snapshot = body?.purchaseSnapshot;
    if (!Array.isArray(snapshot?.items)) throw new Error('Satın alma kalemleri okunamadı.');
    window.openNewPurchaseModal();
    draftTarget = { id: head.id, expectedRevision: head.revision, reopen: !['draft', 'registered'].includes(head.state),
        metadataBase: body.metadataSnapshot || body.metadata || {}, organizationCode: head.organizationCode };
    pendingSubmission = null;
    const metadata = draftTarget.metadataBase;
    const title = document.getElementById('purModalTitle');
    if (title) title.textContent = 'EBYS Satın Alma — Yeni Sürüm / Taslak Düzenle';
    const saveBtn = document.getElementById('purSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';
    const set = (id, value) => { const field = document.getElementById(id); if (field) field.value = value ?? ''; };
    set('purDocName', head.registrationNo || `EBYS · ${head.id.slice(0, 8)}`);
    set('purName', metadata.subject);
    set('purBudget', snapshot.butce);
    const unitSelect = document.getElementById('purUnit');
    const option = [...(unitSelect?.options || [])].find(o => o.dataset.unitId === head.unitId);
    if (unitSelect) unitSelect.value = option ? option.value : '';
    window.AppModules.PurchaseItemsUI.open(snapshot, false);
    const status = document.getElementById('purEbysStatus');
    if (status) {
        status.hidden = false;
        status.textContent = (option ? '' : 'Önceki birim artık seçilemiyor; yeni birim seçin. ') +
            'Bu talep EBYS motorundadır. Gönderdiğinizde yeni sürüm dondurulur ve onay rotası yeniden seçilir.';
    }
}

let busy = false;
async function handleSubmitClick(button) {
    if (busy) return;
    const form = document.getElementById('purchaseForm');
    const status = document.getElementById('purEbysStatus');
    const unitSelect = document.getElementById('purUnit');
    const unitName = unitSelect?.value || '';
    const subject = document.getElementById('purName')?.value || '';
    if (!unitName || !subject) { form?.reportValidity(); return; }
    let purchaseLines, budget;
    try { purchaseLines = window.AppModules.PurchaseItemsUI.read(); }
    catch (error) { window.showAppAlert?.(error.message, 'warning'); return; }
    try { budget = window.AppModules.PurchaseItemsUI.readBudget(); }
    catch (error) { window.showAppAlert?.(error.message, 'warning'); return; }
    if (!purchaseLines) { window.showAppAlert?.('EBYS süreci yalnız çok kalemli kayıtları destekler; en az bir kalem ekleyin.', 'warning'); return; }

    busy = true;
    const group = [button, document.getElementById('purSaveBtn')].filter(Boolean);
    const disabled = group.map(b => b.disabled);
    group.forEach(b => b.disabled = true);
    const revising = !!draftTarget;
    if (status) { status.hidden = false; status.textContent = revising ? 'Yeni sürüm hazırlanıyor…' : 'Evrak oluşturuluyor…'; }
    try {
        const frozen = await submitPurchaseViaEbys({
            unitSelect, unitName, subject, items: purchaseLines.items, butce: budget.amount, budgetMode: budget.mode
        });
        clearPending();
        if (typeof window.closePurchaseModal === 'function') window.closePurchaseModal();
        else { document.getElementById('purchaseModal').style.display = 'none'; document.getElementById('purchaseForm')?.reset(); }
        window.renderPurchaseModule?.();
        window.showAppAlert?.(revising ? 'Yeni sürüm dondu. Onay rotasını yeniden seçin.' : 'Evrak oluşturuldu ve dondu. Onay rotasını şimdi seçin.', 'success');
        window.AppModules.EBYSProcessUI?.open(frozen.versionId, frozen.documentId, true);
    } catch (error) {
        if (status) status.textContent = error.message;
        window.showAppAlert?.(error.message, 'error');
    } finally {
        busy = false;
        group.forEach((b, i) => b.disabled = disabled[i]);
    }
}

window.AppModules = window.AppModules || {};
window.AppModules.EBYSPurchaseUI = { handleSubmitClick, openForRevision, clearPending };
