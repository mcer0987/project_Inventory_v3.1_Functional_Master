// [WHY]: H5 — satın alma formu hâlâ yalnız eski 'workflow' motoruna yazıyordu; Aşama 1-4'te tamamlanan
//        EBYS süreç/evrak servisleri (ebys-document-service.js, ebys-process-service.js) hiçbir UI'dan
//        çağrılmıyordu. Eski tek ürünlü/çok kalemli talepler bu dosyayla bozulmadan aynı formda kalır;
//        yalnız "EBYS süreciyle gönder" seçildiğinde yeni servis zincirine bağlanır.
// [HOW]: Mevcut satın alma modalındaki aynı alanlar (#purUnit, #purName, #purDesc, kalem editörü) okunur;
//        createPurchaseDocument → freezePurchaseVersion → EBYSProcessUI.open() zincirlenir. Çifte işlem
//        koruması ebys-documents-ui.js'teki 'busy' kilidiyle aynı kalıptır (buton grubu disable/finally).
import { createPurchaseDocument, freezePurchaseVersion } from '../services/ebys-document-service.js';
import '../services/ebys-process-service.js';

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

async function submitPurchaseViaEbys({ unitSelect, unitName, subject, items, butce, budgetMode }) {
    const unitId = resolveUnitId(unitSelect?.selectedOptions?.[0], unitName);
    const today = new Date().toISOString().slice(0, 10);
    const created = await createPurchaseDocument({
        unitId, organizationCode: 'MED',
        content: `Satın alma talebi: ${subject}`,
        metadata: { subject, correspondent: unitName, date: today, filePlanCode: 'PURCHASE_REQUEST', confidentiality: 'Normal' },
        items, butce, budgetMode,
        operationId: crypto.randomUUID()
    });
    return freezePurchaseVersion({ documentId: created.documentId, expectedRevision: created.revision, operationId: crypto.randomUUID() });
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
    if (status) { status.hidden = false; status.textContent = 'Evrak oluşturuluyor…'; }
    try {
        const frozen = await submitPurchaseViaEbys({
            unitSelect, unitName, subject, items: purchaseLines.items, butce: budget.amount, budgetMode: budget.mode
        });
        document.getElementById('purchaseModal').style.display = 'none';
        document.getElementById('purchaseForm')?.reset();
        window.renderPurchaseModule?.();
        window.showAppAlert?.('Evrak oluşturuldu ve dondu. Onay rotasını şimdi seçin.', 'success');
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
window.AppModules.EBYSPurchaseUI = { handleSubmitClick };
