import { doc, setDoc, getDocs, collection, getDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// [WHY]: getFirestore() cagrisi uygulama yuklenme asamasinda (henuz initializeApp tamamlanmadan) 'No Firebase App' hatasi firlatiyordu.
// [HOW]: Bunun yerine firebase-handler.js icinde olusturulmus olan 'window.fireDb' nesnesini donduren bir yardimci tanimliyoruz.
const getFirestore = () => window.fireDb;

// [WHY]: Şablon dinleyicisi senkron motorunun dışındaydı: oturum açılmadan kaydolup permission-denied ile kalıcı olarak
//        kapanıyordu (EBYS-18; G1 bunu window.userAuth'u bekleyerek yamamıştı). Çıkış yapıp tekrar girince (signOut
//        dinleyiciyi öldürür) yeniden başlamıyordu ve yetki hatası yalnız konsola düşüyordu.
// [HOW]: Dinleyici firebase-handler'ın registerSyncListener kaydına verilir: startRealtimeSync onu oturum açıkken diğer
//        koleksiyonlarla birlikte başlatır, stopRealtimeSync kapatır, izin hatası ortak "bağlantı yetkisi yok" bandına düşer.
function subscribeWorkflowTemplates() {
    const activeRoot = window.AppEnv?.COLLECTION_ROOT || window.COLLECTION_ROOT || "lifeserver_master";
    return onSnapshot(collection(window.fireDb, activeRoot, "workflowTemplates", "items"), (snapshot) => {
        const fetchedTemplates = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        window.templates = fetchedTemplates;
        if (window.data) {
            window.data.workflowTemplates = fetchedTemplates;
        }

        console.log("📂 Sablonlar guncellendi:", window.templates);
        if (typeof window.renderTemplateList === "function") window.renderTemplateList();
    }, (err) => window.reportListenerError('workflowTemplates', err));
}
window.registerSyncListener('workflowTemplates', subscribeWorkflowTemplates);

// ✅ Değişkenleri window üzerinde sabitleyelim (Çakışmaları önlemek için)
window.currentEditingUnitId = window.currentEditingUnitId || null;
window.tempSelectedPersonnel = window.tempSelectedPersonnel || [];

const WorkflowState = window.WorkflowState = {
    tempManualSteps: [],
    tempTplSteps: [],
    tempTplAuth: [],
    isManualMode: true,
    selectedTemplateId: null,
    currentEditingTemplateId: null
};

// [WHY]: Buradaki sıfırlamasız openNewPurchaseModal/closePurchaseModal, purchase-servises.js'teki düzeltilmiş
//        sürümü eziyordu; "Yeni Talep" eski talebin üzerine yazabiliyordu (EBYS-01). Tek kaynak: purchase-servises.js.
// Ölü initEBYSModal / fillEBYSSelects de kaldırıldı: talep edeni sabit "Muhammed CER" yedeğiyle dolduruyordu (EBYS-06);
// form doldurma tek kaynaktan: purchase-servises.js openNewPurchaseModal + fillPurchaseSelects.

// [WHY]: Birim yönetimi bozuktu (EBYS-15): modal modül-yerel durumu, saveUnitData ise hiç atanmayan window.* durumunu okuyordu
//        (düzenleme ikinci birim oluşturuyor, personel kaydolmuyordu); personel araması sonuç çizmiyordu; deleteUnit(index)
//        id ile çağrılıyordu (yanlış birim ya da hiçbiri silinir); admin.html'de #unitModal yoktu (buton TypeError). addNewUnit
//        birimleri düz metin olarak yazıyordu (ölü kod, kaldırıldı).
// [HOW]: Tek durum nesnesi (unitEditor); modal işaretlemesi yalnız burada, yoksa enjekte edilir (iki sayfada aynı);
//        arama sonuçları çizilir ve tıklanarak seçilir; kaydet/sil id ile, yalnız 'units' yazılır ve sonuç kontrol edilir.
const unitEditor = { id: null, personnel: [], saving: false };
const _unitName = u => (u && typeof u === 'object') ? (u.name || u.birimAdi || '') : String(u || '');
const _personName = p => (p && (p.name || p.adSoyad || p.ad)) || '';
const _unitAlert = (msg, type) => { if (typeof showAppAlert === 'function') showAppAlert(msg, type); else alert(msg); };

function _ensureUnitModal() {
    if (document.getElementById('unitModal')) return;
    const modal = document.createElement('div');
    modal.id = 'unitModal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10500; align-items:flex-start; justify-content:center; overflow-y:auto;';
    // Renkler tema değişkenlerinden (style.css / dark-theme.css [data-theme="dark"]); sabit renk yok.
    modal.innerHTML = `
        <style>
            #unitModal .um-box { background:var(--color-surface,#fff); color:var(--color-text,#2c3e50); border:1px solid var(--color-border-light,transparent);
                width:500px; max-width:94vw; margin:50px auto; padding:20px; border-radius:8px; box-sizing:border-box; }
            #unitModal hr { border:none; border-top:1px solid var(--color-border,#bdc3c7); }
            #unitModal .um-input { width:100%; box-sizing:border-box; padding:8px; border-radius:6px; border:1px solid var(--color-border,#bdc3c7);
                background:var(--color-surface-alt,#f8f9fa); color:var(--color-text,#2c3e50); }
            #unitModal .um-input::placeholder, #unitModal .um-muted { color:var(--color-text-muted,#7f8c8d); }
            #unitModal .um-results { display:none; border:1px solid var(--color-border,#bdc3c7); border-top:none; max-height:180px; overflow-y:auto; background:var(--color-surface,#fff); }
            #unitModal .unit-personnel-option { padding:8px 10px; border-bottom:1px solid var(--color-border-light,#eef0f2); cursor:pointer; }
            #unitModal .unit-personnel-option:hover { background:var(--color-surface-alt,#f8f9fa); }
            #unitModal .unit-personnel-option.is-added { cursor:default; color:var(--color-text-muted,#7f8c8d); }
            #unitModal .unit-personnel-option.is-added:hover { background:none; }
            #unitModal .um-list { list-style:none; padding:0; margin:10px 0 0; max-height:150px; overflow-y:auto; }
            #unitModal .um-list li.um-chip { padding:5px 10px; background:var(--color-surface-alt,#f8f9fa); border-bottom:1px solid var(--color-border-light,#eef0f2);
                display:flex; justify-content:space-between; align-items:center; }
            #unitModal .um-remove { background:none; border:none; color:var(--color-danger,#e74c3c); cursor:pointer; font-size:16px; }
            #unitModal .um-cancel { padding:8px 15px; border:1px solid var(--color-border,#bdc3c7); background:transparent; color:var(--color-text,#2c3e50); border-radius:4px; cursor:pointer; }
            #unitModal .um-save { background:var(--color-success-dark,#27ae60); color:#fff; padding:8px 15px; border:none; border-radius:4px; cursor:pointer; }
        </style>
        <div class="um-box">
            <h3 id="unitModalTitle" style="margin-top:0;">Yeni Birim Tanımla</h3>
            <hr>
            <label for="unitNameInput">Birim Adı:</label>
            <input type="text" id="unitNameInput" class="um-input" placeholder="Örn: Bilgi İşlem" autocomplete="off" style="margin:4px 0 15px;">
            <label for="unitPersonnelSearch">Personel Ekle (Ara/Seç):</label>
            <input type="text" id="unitPersonnelSearch" class="um-input" placeholder="Personel adı yazın (en az 2 harf)..." autocomplete="off"
                oninput="window.searchPersonnelForUnit(this.value)" style="margin-top:4px;">
            <div id="unitPersonnelResults" class="um-results"></div>
            <div style="margin-top:20px;">
                <label><b>Atanan Personeller:</b></label>
                <ul id="unitSelectedPersonnel" class="um-list"></ul>
            </div>
            <div style="margin-top:20px; text-align:right;">
                <button type="button" class="um-cancel" onclick="window.closeUnitModal()">Vazgeç</button>
                <button type="button" id="unitSaveBtn" class="um-save" onclick="window.saveUnitData()">Kaydet</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

// --- MODAL KONTROLLERİ ---
window.openUnitModal = function (unitId = null) {
    _ensureUnitModal();
    const unit = unitId != null ? (window.data.units || []).find(u => u && typeof u === 'object' && String(u.id) === String(unitId)) : null;
    if (unitId != null && !unit) { _unitAlert('Birim bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }

    unitEditor.id = unit ? String(unit.id) : null;
    unitEditor.personnel = unit ? [...(unit.personnel || [])] : [];
    document.getElementById('unitModalTitle').innerText = unit ? 'Birimi Düzenle' : 'Yeni Birim Tanımla';
    document.getElementById('unitNameInput').value = unit ? _unitName(unit) : '';
    document.getElementById('unitPersonnelSearch').value = '';
    document.getElementById('unitPersonnelResults').style.display = 'none';
    window.renderSelectedPersonnel();
    document.getElementById('unitModal').style.display = 'flex';
    document.getElementById('unitNameInput').focus();
};

window.closeUnitModal = function () {
    const modal = document.getElementById('unitModal');
    if (modal) modal.style.display = 'none';
};

// --- PERSONEL ARAMA VE SEÇME ---
window.searchPersonnelForUnit = function (query) {
    const resultArea = document.getElementById('unitPersonnelResults');
    if (!resultArea) return;
    const term = String(query || '').toLocaleLowerCase('tr-TR').trim();
    if (term.length < 2) { resultArea.style.display = 'none'; resultArea.innerHTML = ''; return; }

    const chosen = new Set(unitEditor.personnel.map(n => n.toLocaleLowerCase('tr-TR')));
    const names = [...new Set([...(window.data?.personel || []), ...(window.data?.staff || [])].map(_personName).filter(Boolean))];
    const matches = names.filter(n => n.toLocaleLowerCase('tr-TR').includes(term)).slice(0, 10);

    resultArea.innerHTML = matches.length
        ? matches.map(n => {
            const already = chosen.has(n.toLocaleLowerCase('tr-TR'));
            return `<div class="unit-personnel-option${already ? ' is-added' : ''}" ${already ? '' : `onclick="window.addPersonnelToTempList(${jsArg(n)})"`}>
                ${escapeHtml(n)}${already ? ' (eklendi)' : ''}</div>`;
        }).join('')
        : '<div class="um-muted" style="padding:8px 10px;">Eşleşen personel bulunamadı.</div>';
    resultArea.style.display = 'block';
};

window.addPersonnelToTempList = function (name) {
    const n = String(name || '').trim();
    if (n && !unitEditor.personnel.some(x => x.toLocaleLowerCase('tr-TR') === n.toLocaleLowerCase('tr-TR'))) {
        unitEditor.personnel.push(n);
        window.renderSelectedPersonnel();
    }
    const search = document.getElementById('unitPersonnelSearch');
    if (search) { search.value = ''; search.focus(); }
    const results = document.getElementById('unitPersonnelResults');
    if (results) results.style.display = 'none';
};

window.removePersonnelFromTempList = function (index) {
    unitEditor.personnel.splice(index, 1);
    window.renderSelectedPersonnel();
};

window.renderSelectedPersonnel = function () {
    const list = document.getElementById('unitSelectedPersonnel');
    if (!list) return;
    list.innerHTML = unitEditor.personnel.map((name, index) => `
        <li class="um-chip">
            ${escapeHtml(name)}
            <button type="button" class="um-remove" onclick="window.removePersonnelFromTempList(${index})" title="Çıkar">&times;</button>
        </li>`).join('') || '<li><small class="um-muted">Henüz personel atanmadı.</small></li>';
};

// --- VERİ KAYDETME ---
window.saveUnitData = async function () {
    if (!window.requireDbAdmin('Birim kaydı')) return;   // Faz 4 · J1: units yalnız admin
    if (unitEditor.saving) return;
    const name = (document.getElementById('unitNameInput')?.value || '').trim();
    if (!name) { _unitAlert('Birim adı boş olamaz!', 'warning'); return; }

    const units = (window.data.units || []).filter(u => u && typeof u === 'object');
    const lower = name.toLocaleLowerCase('tr-TR');
    if (units.some(u => String(u.id) !== unitEditor.id && _unitName(u).trim().toLocaleLowerCase('tr-TR') === lower)) {
        _unitAlert(`"${name}" adında bir birim zaten var.`, 'warning');
        return;
    }

    const stamp = new Date().toLocaleString('tr-TR');
    let next;
    if (unitEditor.id) {
        if (!units.some(u => String(u.id) === unitEditor.id)) { _unitAlert('Düzenlenen birim bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        next = units.map(u => String(u.id) === unitEditor.id ? { ...u, name, personnel: [...unitEditor.personnel], updatedAt: stamp } : u);
    } else {
        next = [...units, { id: Date.now().toString(), name, personnel: [...unitEditor.personnel], updatedAt: stamp }];
    }

    unitEditor.saving = true;
    try {
        if (!(await window.writeOk(window.saveData('units', next)))) { _unitAlert('Birim kaydedilemedi. Yetkinizi ve bağlantınızı kontrol edin.', 'error'); return; }
        const wasEdit = !!unitEditor.id;
        window.closeUnitModal();
        window.renderUnitManagement();
        _unitAlert(wasEdit ? 'Birim güncellendi.' : 'Birim eklendi.', 'success');
    } finally {
        unitEditor.saving = false;
    }
};

window.deleteUnit = async function (unitId) {
    if (!window.requireDbAdmin('Birim silme')) return;
    const unit = (window.data.units || []).find(u => u && typeof u === 'object' && String(u.id) === String(unitId));
    if (!unit) { _unitAlert('Birim bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const ok = typeof showCustomConfirm === 'function'
        ? await showCustomConfirm('Birimi Sil', `"${_unitName(unit)}" birimi silinecek. Emin misiniz?`)
        : window.confirm('Bu birimi silmek istediğinize emin misiniz?');
    if (ok !== true) return;
    const next = (window.data.units || []).filter(u => !(u && typeof u === 'object' && String(u.id) === String(unitId)));
    if (!(await window.writeOk(window.saveData('units', next)))) { _unitAlert('Birim silinemedi.', 'error'); return; }
    window.renderUnitManagement();
    _unitAlert('Birim silindi.', 'info');
};

// --- TABLO RENDER ---
window.renderUnitManagement = function () {
    const container = document.getElementById('unitListArea');
    const defListContainer = document.getElementById('adminDefUnitTableBody');
    if (!container && !defListContainer) return;

    const units = window.data.units || [];

    if (container) {
        container.innerHTML = units.map(u => `
            <tr>
                <td><strong>${escapeHtml(u.name)}</strong></td>
                <td><small>${escapeHtml((u.personnel || []).join(', ') || 'Personel yok')}</small></td>
                <td style="text-align:right;">
                    <button onclick="window.openUnitModal(${jsArg(String(u.id))})" class="btn-edit" style="color:#2980b9; background:none; border:none; cursor:pointer; margin-right:10px;">
                        <i class="fas fa-edit"></i> Düzenle
                    </button>
                    <button onclick="window.deleteUnit(${jsArg(String(u.id))})" class="btn-delete" style="color:#c0392b; background:none; border:none; cursor:pointer;">
                        <i class="fas fa-trash"></i> Sil
                    </button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="3" style="text-align:center; padding:20px;">Henüz birim tanımlanmadı.</td></tr>';
    }

    if (defListContainer) {
        defListContainer.innerHTML = units.map(u => `
            <tr>
                <td><strong>${escapeHtml(u.name)}</strong></td>
                <td><span class="badge bg-light text-dark border">-</span></td>
                <td><small class="text-muted">${escapeHtml((u.personnel || []).join(', ') || 'Personel yok')}</small></td>
                <td class="text-end pe-3">
                    <div class="action-buttons justify-content-end">
                        <button onclick="window.openUnitModal(${jsArg(String(u.id))})" class="btn-action btn-buy shadow-sm" title="Düzenle">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </button>
                        <button onclick="window.deleteUnit(${jsArg(String(u.id))})" class="btn-action btn-passive shadow-sm" title="Sil">
                            <i class="fas fa-trash fa-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="4" class="text-center p-4">Henüz birim tanımlanmadı.</td></tr>';
    }
};

// [BUGFIX] Bug 2: Normalization helper for strict template authorization checking
const checkTemplateAuth = (tpl) => {
    const authList = tpl.auth || tpl.authorizedUsers || [];
    if (!Array.isArray(authList) || authList.length === 0) return true;
    const meName = (window.currentUser?.name || '').trim().toLowerCase();
    const meCode = String(window.currentUser?.code || window.currentUser?.id || '').trim();
    return authList.some(item => {
        if (!item) return false;
        if (typeof item === 'object') {
            const name = (item.name || '').trim().toLowerCase();
            const code = String(item.code || item.id || '').trim();
            return (meName && name === meName) || (meCode && code === meCode);
        }
        const str = String(item).trim().toLowerCase();
        // [BUGFIX] Bug 2: Fixed comparison - compare str to both meName and meCode
        return (meName && str === meName) || (meCode && str === meCode);
    });
};

// WORKFLOW OLUŞTURMA (Modal Açan Versiyon)
// [BUGFIX] Bug 2: Check both t.auth and t.authorizedUsers with checkTemplateAuth to enforce strict template authorization
window.startWorkflow = function (id) {
    const modal = document.getElementById('startWorkflowModal');
    if (!modal) return;

    document.getElementById('startWorkflowReqId').value = id;

    const tplDropdown = document.getElementById('tplSelectDropdown');
    if (tplDropdown) {
        const templates = window.data.workflowTemplates || [];

        const filtered = templates.filter(t => checkTemplateAuth(t));

        tplDropdown.innerHTML =
            '<option value="manual">-- Yeni Özel İş Akışı (Manuel) --</option>' +
            filtered.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');

        tplDropdown.value = 'manual';
    }

    // [BUGFIX] Bug 1: Complete WorkflowState reset to prevent state leak on withdraw/restart
    WorkflowState.tempManualSteps = [];
    WorkflowState.tempTplSteps = [];
    WorkflowState.tempTplAuth = [];
    WorkflowState.selectedTemplateId = null;
    WorkflowState.currentEditingTemplateId = null;
    WorkflowState.isManualMode = true;

    window.addManualStep();

    modal.style.display = 'block';
};

window.closeStartWorkflowModal = function () {
    const modal = document.getElementById('startWorkflowModal');
    if (modal) modal.style.display = 'none';
};

window.toggleWorkflowMethod = function (method) {

    if (method === 'manual') {
        WorkflowState.isManualMode = true;
        WorkflowState.selectedTemplateId = null;
        WorkflowState.currentEditingTemplateId = null;

        // [BUGFIX] Bug 1: Complete state reset when switching to manual mode
        WorkflowState.tempManualSteps = [];
        WorkflowState.tempTplSteps = [];
        WorkflowState.tempTplAuth = [];

        window.addManualStep();
        return;
    }

    // TEMPLATE SEÇİLDİ
    WorkflowState.isManualMode = false;
    WorkflowState.selectedTemplateId = method;

    const tpl = (window.data.workflowTemplates || []).find(x => x.id === method);

    // [BUGFIX] Bug 1: Reset template edit state when selecting a template
    WorkflowState.currentEditingTemplateId = null;

    if (tpl && tpl.steps) {
        WorkflowState.tempManualSteps = tpl.steps.map(s => ({
            user: s.user,
            tip: s.tip || 'Paraf',
            status: "pending",
            note: "",
            date: ""
        }));

        window.renderManualSteps();
    }
};

window.addStepToTemplate = function () {
    WorkflowState.tempTplSteps.push({
        user: "",
        tip: "Paraf",
        order: WorkflowState.tempTplSteps.length,
        status: "pending",
        note: "",
        date: ""
    });

    window.renderTemplateSteps();
};

window.removeManualStep = function (index) {
    WorkflowState.tempManualSteps.splice(index, 1);
    window.renderManualSteps();
};

window.renderManualSteps = function () {
    const container = document.getElementById('manualStepsContainer');
    if (!container) return;
    container.innerHTML = WorkflowState.tempManualSteps.map((step, index) => `
        <tr>
            <td class="text-center">
                <button class="btn-delete-row" onclick="window.removeManualStep(${index})" title="Adımı Sil">
                    <i class="fas fa-times"></i>
                </button>
            </td>
            <td>
                <div class="position-relative w-100">
                    <input type="text" class="form-control workflow-select-ghost w-100" placeholder="Personel arayın veya yazın..." value="${escapeHtml(step.user)}"
                           oninput="WorkflowState.tempManualSteps[${index}].user = this.value"
                           onkeyup="window.searchPersonnelForStart(this.value, ${index})" style="border:1px solid transparent;">
                    <div id="startManualResults_${index}" class="search-results-popover" style="display:none; position:absolute; width:100%; background:white; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.1); z-index:1000; max-height:200px; overflow-y:auto; top:100%;"></div>
                </div>
            </td>
            <td>
                <select class="form-select workflow-select-ghost w-100" onchange="WorkflowState.tempManualSteps[${index}].tip = this.value">
                    <option value="Paraf" ${escapeHtml(step.tip === 'Paraf' ? 'selected' : '')}>Paraf</option>
                    <option value="E-İmza & Mobil İmza" ${escapeHtml(step.tip === 'E-İmza & Mobil İmza' ? 'selected' : '')}>E-İmza & Mobil İmza</option>
                    <option value="Olur (Islak)" ${escapeHtml(step.tip === 'Olur (Islak)' ? 'selected' : '')}>Olur (Islak)</option>
                    <option value="Olur (E-İmza)" ${escapeHtml(step.tip === 'Olur (E-İmza)' ? 'selected' : '')}>Olur (E-İmza)</option>
                    <option value="Islak İmza" ${escapeHtml(step.tip === 'Islak İmza' ? 'selected' : '')}>Islak İmza</option>
                </select>
            </td>
            <td class="text-center">
                <div class="d-flex justify-content-center align-items-center gap-2">
                    <button class="btn-icon-action" title="Bilgi"><i class="fas fa-info-circle"></i></button>
                    <button class="btn-icon-action" style="cursor: grab;" title="Sürükle"><i class="fas fa-bars"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
};

window.searchPersonnelForStart = function (query, index) {
    // Mevcut dropdown'u temizle
    const existingDropdown = document.getElementById(`personnel_dropdown_${index}`);
    if (existingDropdown) {
        existingDropdown.remove();
    }

    if (!query || query.length < 2) {
        return;
    }

    const allP = window.data.personel || window.data.staff || [];
    console.log('🔍 Personel arama - Toplam personel sayısı:', allP.length);
    console.log('🔍 Aranan sorgu:', query);

    const filtered = allP.filter(p => {
        const name = (p.name || p.adSoyad || p.ad || "").toLocaleLowerCase('tr-TR');
        const searchQuery = query.toLocaleLowerCase('tr-TR');
        return name.includes(searchQuery);
    });

    console.log('🔍 Filtrelenen personel sayısı:', filtered.length);

    if (filtered.length === 0) {
        return;
    }

    // Input elementini bul
    const inputElement = document.querySelector(`input[onkeyup*="window.searchPersonnelForStart(this.value, ${index})"]`);
    if (!inputElement) {
        console.log('❌ Input element bulunamadı');
        return;
    }

    // Yeni dropdown oluştur - Compact tasarım
    const dropdown = document.createElement('div');
    dropdown.id = `personnel_dropdown_${index}`;
    dropdown.style.position = 'fixed';
    dropdown.style.zIndex = '99999';
    dropdown.style.background = 'var(--color-surface)';
    dropdown.style.border = '1px solid var(--color-border-light)';
    dropdown.style.borderRadius = '8px';
    dropdown.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
    dropdown.style.maxHeight = '200px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.minWidth = '250px';
    dropdown.style.marginTop = '2px';

    // Personel listesini ekle - Modern kart tasarımı
    dropdown.innerHTML = filtered.map((p, i) => {
        const name = p.name || p.adSoyad || p.ad || 'Bilinmeyen';
        const isFirst = i === 0;
        const isLast = i === filtered.length - 1;
        return `<div class="personnel-dropdown-item" 
                    style="padding:10px 12px; cursor:pointer; background:var(--color-surface); transition:all 0.2s ease; border-bottom:${isLast ? 'none' : '1px solid var(--color-surface-alt)'};"
                    onmouseover="this.style.background='var(--color-surface-alt)';" 
                    onmouseout="this.style.background='var(--color-surface)';"
                    data-action="selectPerson" data-step="${escapeHtml(index)}" data-name="${escapeHtml(name)}">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:32px; height:32px; border-radius:50%; background:var(--color-primary); display:flex; align-items:center; justify-content:center; color:white; font-weight:600; font-size:12px;">
                            ${escapeHtml(name.charAt(0).toUpperCase())}
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight:500; color:var(--color-text); font-size:13px; line-height:1.2;">${escapeHtml(name)}</div>
                        </div>
                    </div>
                </div>`;
    }).join('');
    // [WHY]: Faz 4 · J2 — personel adı onclick'e '…' içinde gömülüyordu ("’" kaçışı "&#39;" ve '"' ile aşılabiliyordu).
    // [HOW]: data-step + data-name (escapeHtml), tek dinleyici.
    window.bindActions(dropdown, { selectPerson: el => window.selectPersonForWorkflow(Number(el.dataset.step), el.dataset.name) });

    // Input'un pozisyonunu al
    const rect = inputElement.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.left = rect.left + 'px';

    // Body'ye ekle
    document.body.appendChild(dropdown);

    // Tıklama dışında kapatma
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target) && e.target !== inputElement) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 100);

    console.log('✅ Dropdown body\'ye eklendi - sonuç:', filtered.length, 'personel');
    console.log('📍 Dropdown pozisyonu:', { top: dropdown.style.top, left: dropdown.style.left });
};

// Personel seçimi için ayrı fonksiyon
window.selectPersonForWorkflow = function (index, name) {
    console.log('✅ Personel seçildi:', name, 'index:', index);
    WorkflowState.tempManualSteps[index].user = name;
    window.renderManualSteps();

    // Body'deki dropdown'u kaldır
    const dropdown = document.getElementById(`personnel_dropdown_${index}`);
    if (dropdown) {
        dropdown.remove();
    }
};

// [BUGFIX] Bug 1 & Bug 2: Enforce authorization check & use targeted save to avoid permission-denied
// [WHY]: Boş (veya listeden seçilmeden yazılmış, state'e hiç düşmeyen) onaylayıcıyla akış başlatılabiliyordu; kimsenin
//        sırası gelmeyen adım akışı sonsuza dek takılı bırakıyordu. Şablon modunda ekranda düzenlenen adımlar yok sayılıp
//        şablonun kendi adımları kullanılıyordu (EBYS-09).
// [HOW]: Yazılan ad state'e anında yazılır. Başlatmadan önce ekrandaki her adımın onaylayıcısı dolu ve personel listesinde
//        kayıtlı olmalı (ad kayıtlı biçimine çevrilir); şablon modunda da ekrandaki adımlar (sırayla şablon meta verisiyle) kullanılır.
function _resolveWorkflowSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return { error: 'En az bir onay adımı ekleyin.' };
    if (steps.length > 10) return { error: 'Bir akışta en fazla 10 onay adımı olabilir.' };   // J10: kurallarla aynı sınır
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const known = new Map([...(window.data.personel || []), ...(window.data.staff || [])]
        .map(p => String(p?.name || p?.adSoyad || '').trim()).filter(Boolean).map(n => [norm(n), n]));
    const resolved = [];
    for (let i = 0; i < steps.length; i++) {
        const typed = String(steps[i].user || '').trim();
        if (!typed) return { error: `${i + 1}. adımın onaylayıcısı boş.` };
        const name = known.get(norm(typed));
        if (!name) return { error: `${i + 1}. adım: "${typed}" personel listesinde yok. Listeden seçin.` };
        resolved.push({ ...steps[i], user: name, tip: steps[i].tip || 'Paraf' });
    }
    return { steps: resolved };
}

window.confirmStartWorkflow = async function () {

    const id = document.getElementById('startWorkflowReqId').value;
    const req = window.data.purchaseOrders.find(x => String(x.id) === String(id));
    if (!req) return;

    const checked = _resolveWorkflowSteps(WorkflowState.tempManualSteps);
    if (checked.error) {
        if (typeof showAppAlert === 'function') showAppAlert(checked.error, 'warning'); else alert(checked.error);
        return;
    }
    // [WHY]: Talebi açan kişi kendini onay adımına ekleyebiliyordu; akış başlıyor, sıra ona gelince self-approval engeli
    //        ("Kendi satın alma taleplerinizi onaylayamazsınız") onayı reddediyor ve akış o adımda kalıcı olarak takılıyordu.
    // [HOW]: Engel akış başlarken uygulanır: talep sahibi onaylayıcı olamaz (akışı kim başlatırsa başlatsın).
    const requesterName = _normName(req.createdByName || req.talepEden);
    const selfStep = requesterName ? checked.steps.findIndex(s => _normName(s.user) === requesterName) : -1;
    if (selfStep !== -1) {
        const msg = `${selfStep + 1}. adım: "${checked.steps[selfStep].user}" bu talebi açan kişi; kendi talebini onaylayamaz. Başka bir onaylayıcı seçin.`;
        if (typeof showAppAlert === 'function') showAppAlert(msg, 'warning'); else alert(msg);
        return;
    }
    const startKey = 'start_' + String(req.id);
    _beginMutation(startKey, req);

    // 🔥 MANUEL MOD
    if (WorkflowState.isManualMode) {

        const prevHist = req.workflow?.history && Array.isArray(req.workflow.history) ? req.workflow.history : [];
        req.workflow = {
            id: 'workflow_' + Date.now(),
            started: true,
            currentStep: 0,
            finished: false,
            currentState: window.WorkflowEngine.states.INITIATION,
            steps: checked.steps.map(s => ({
                user: s.user,
                userUid: window.Ownership.uidForPersonName(s.user),   // J9: onaylayıcının Auth uid'si (yoksa null)
                tip: s.tip,
                status: "pending",
                note: "",
                date: ""
            })),
            history: [
                ...prevHist,
                {
                    action: 'create',
                    actor: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'system',
                    uid: window.userAuth?.uid || '',   // J11.5: kurallar sahibin kaydında request.auth.uid ile eşler
                    timestamp: new Date().toISOString(),
                    to: window.WorkflowEngine.states.INITIATION
                }
            ]
        };

    } else {

        const tpl = (window.data.workflowTemplates || [])
            .find(t => t.id === WorkflowState.selectedTemplateId);

        if (!tpl) {
            alert("Şablon bulunamadı");
            return;
        }

        // [BUGFIX] Bug 2: Backend/State guard to ensure unauthorized users cannot bypass UI dropdown
        if (!checkTemplateAuth(tpl)) {
            alert("⛔ Bu iş akışı şablonunu kullanma yetkiniz bulunmamaktadır.");
            return;
        }

        // Ekranda düzenlenen adımlar kullanılır; aynı sıradaki şablon adımının meta verisi (paralel grup vb.) korunur.
        const tplSteps = tpl.steps || [];
        const newWf = window.createWorkflowFromTemplate({
            ...tpl,
            steps: checked.steps.map((s, i) => ({ ...(tplSteps[i] || {}), order: i, user: s.user, tip: s.tip }))
        });
        // [BUGFIX] Bug 1: Preserve prior history cleanly on restart after withdraw
        if (req.workflow?.history && Array.isArray(req.workflow.history)) {
            newWf.history = [...req.workflow.history, ...newWf.history];
        }
        req.workflow = newWf;
    }

    req.durum = "Onay Bekliyor";

    if (!req.akis) req.akis = [];
    req.akis.push({
        islem: "İş akışı başlatıldı",
        yapan: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name,
        uid: window.userAuth?.uid || '',   // J11.5
        tarih: new Date().toLocaleString('tr-TR')
    });

    // [BUGFIX] Bug 1: Targeted save only to purchaseOrders (Prevents global batch permission error)
    if (!(await window.writeOk(window.upsertItem('purchaseOrders', req)))) {
        _rollback(startKey);
        if (typeof showAppAlert === 'function') showAppAlert('İş akışı kaydedilemedi. Bağlantınızı kontrol edin.', 'error');
        return;
    }
    _endMutation(startKey);

    window.closeStartWorkflowModal();

    if (typeof refreshUI === "function") refreshUI();
    if (typeof showAppAlert === 'function') showAppAlert("İş akışı başlatıldı.", "success");
};

// ORTAK YENİLEME FONKSİYONU (Admin ve Satın Alma sayfasında hata almamak için)
function refreshUI() {
    console.log("🔄 UI Refreshing...");
    if (typeof renderAdminDashboard === "function") renderAdminDashboard();
    if (typeof renderAdminRequestTable === "function") renderAdminRequestTable();
    if (typeof renderServicesModule === "function") renderServicesModule();

    if (typeof renderPurchaseModule === "function") {
        // Admin panelinde tüm talepleri göster, kullanıcı panelinde sadece kendi talepleri
        const isAdmin = window.location.pathname.includes('admin') || window.isAdminPanel;
        renderPurchaseModule({ showAll: isAdmin, isAdmin: isAdmin });
    }

    if (typeof renderMyApprovals === "function") renderMyApprovals();

    // EBYS Takip listesi varsa onu da yenile
    if (typeof window.renderEBYSList === "function") window.renderEBYSList();
}
window.refreshUI = refreshUI;

window.viewWorkflow = async function (id) {
    const item = (window.data.purchaseOrders || []).find(x => String(x.id) === String(id));
    if (!item || !item.workflow) return;

    // Veri düzeltme - currentStep değerini status'dan yeniden hesapla ve kaydet
    await window.fixWorkflowCurrentStep(item, true);

    const modal = document.getElementById("workflowModal");
    const body = document.getElementById("workflowBody");
    const me = window.currentUser?.name;
    if (!modal || !body) return;

    // [BUGFIX] Bug 5: Use CSS variables instead of hardcoded light mode values for dark theme support
    // Akıllı Durum Sistemi - EBYS State Machine Uyumlu
    function getWorkflowStatus(item) {
        const currentState = item.workflow?.currentState;
        const isStarted = item.workflow?.started;
        const steps = item.workflow?.steps || [];

        if (!isStarted) {
            return { text: 'Başlatılmadı', bg: 'var(--color-surface-alt)', color: 'var(--color-text-muted)', icon: 'fa-circle' };
        }

        // Tüm adımlar onaylandı mı kontrol et (status-based)
        const allApproved = steps.length > 0 && steps.every(step => step.status === 'approved');

        // KRİTİK: Sadece hem durum tamamlandıysa HEM DE tüm adımlar onaylandıysa Tamamlandı göster
        if (allApproved && (currentState === window.WorkflowEngine?.states?.COMPLETED || item.workflow?.finished)) {
            return { text: 'Tamamlandı', bg: 'var(--color-success-light)', color: 'var(--color-success)', icon: 'fa-check-circle' };
        }

        // Eğer state completed ama adımlar bitmediyse "Onay Bekliyor" göster (Self-healing UI)
        if (currentState === window.WorkflowEngine?.states?.COMPLETED && !allApproved) {
            return { text: 'Durum Onarılıyor...', bg: 'var(--color-warning-light)', color: 'var(--color-warning)', icon: 'fa-sync fa-spin' };
        }

        if (currentState === window.WorkflowEngine?.states?.CANCELLED) {
            return { text: 'Reddedildi', bg: 'var(--color-danger-light)', color: 'var(--color-danger)', icon: 'fa-times-circle' };
        }

        if (currentState === window.WorkflowEngine?.states?.SUSPENDED) {
            return { text: 'Askıya Alındı', bg: 'var(--color-warning-light)', color: 'var(--color-warning)', icon: 'fa-pause-circle' };
        }

        // Diğer tüm durumlar "Onay Bekliyor"
        return { text: 'Onay Bekliyor', bg: 'var(--color-primary-light)', color: 'var(--color-primary)', icon: 'fa-clock' };
    }

    const ds = getWorkflowStatus(item);

    // Adım meta - Status-based kontrol
    // [WHY]: Bir adım reddedilince onu izleyen TÜM adımlar (o adımın kendisi dahil, currentStep'e kadar olanlar) kırmızı
    //        "Reddedildi" gösteriliyordu — Süreç Geçmişi'nde 1. ve 2. adımın gerçekten onaylandığı görülse bile (statüsü
    //        'approved'), akış iptal olduğu an ekranda hepsi reddedilmiş gibi boyanıyordu. Fonksiyonel olarak doğruydu
    //        (akış durdu), ama kimin onayladığını görsel olarak yanlış anlatıyordu.
    //        Ayrıca rozet (pill) arka planı ve yazı rengi AYNI değişkene ayarlanmıştı (background:m.border, color:m.color
    //        ile ikisi de örn. var(--color-success)) — metin arka planla aynı renk olduğu için hiçbir temada okunmuyordu.
    // [HOW]: Kırmızı yalnız fiilen reddedilen adımda (step.status === 'rejected'). Onaylanan adım her zaman yeşil kalır.
    //        İptal edilen bir akışta reddedilen adımdan sonra sırası hiç gelmemiş adımlar (durumu hâlâ 'pending') nötr
    //        "Değerlendirilmedi" rozetiyle gösterilir. Rozet artık --badge-*-bg/--badge-*-text çiftlerini kullanır (arka
    //        plan ile metin farklı tonlar); bu çiftler hem açık hem koyu temada tanımlı.
    function stepMeta(step, stepIndex, item) {
        const stepStatus = step.status || 'pending';
        const currentStepIndex = item.workflow?.currentStep || 0;
        const isCurrentStep = currentStepIndex === stepIndex;
        const isPastStep = currentStepIndex > stepIndex;
        const isCancelled = item.workflow?.currentState === window.WorkflowEngine?.states?.CANCELLED;
        const isFinished = !!item.workflow?.finished;

        const isRejected = stepStatus === 'rejected';
        const isApproved = stepStatus === 'approved' || (isPastStep && !isCancelled && !isFinished);
        // Akış bitmiş/iptal olmuş ama bu adım ne onaylanmış ne reddedilmiş: sırası hiç gelmedi.
        const isMoot = !isRejected && !isApproved && (isCancelled || isFinished);
        const isPending = stepStatus === 'pending' || stepStatus === 'waiting';

        if (isRejected) return { icon: '❌', bg: 'var(--color-danger-light)', border: 'var(--color-danger)', color: 'var(--color-danger)', badgeBg: 'var(--badge-rejected-bg)', badgeText: 'var(--badge-rejected-text)', label: 'Reddedildi' };
        if (isApproved) return { icon: '✅', bg: 'var(--color-success-light)', border: 'var(--color-success)', color: 'var(--color-success)', badgeBg: 'var(--badge-approved-bg)', badgeText: 'var(--badge-approved-text)', label: 'Onaylandı' };
        if (isMoot) return { icon: '⛔', bg: 'var(--color-surface-alt)', border: 'var(--color-border-light)', color: 'var(--color-text-muted)', badgeBg: 'var(--color-surface-alt)', badgeText: 'var(--color-text-muted)', label: 'Değerlendirilmedi' };
        if (isCurrentStep && isPending) return { icon: '⏳', bg: 'var(--color-primary-light)', border: 'var(--color-primary)', color: 'var(--color-primary)', badgeBg: 'var(--badge-pending-bg)', badgeText: 'var(--badge-pending-text)', label: 'Bekliyor' };

        return { icon: '⭕', bg: 'var(--color-surface-alt)', border: 'var(--color-border-light)', color: 'var(--color-text-muted)', badgeBg: 'var(--color-surface-alt)', badgeText: 'var(--color-text-muted)', label: 'Sırada' };
    }

    const steps = item.workflow.steps || [];

    // Tamamlanan adımları status'dan say
    const completedSteps = steps.filter(step => step.status === 'approved').length;

    const stepsHTML = steps.map((step, i) => {
        const m = stepMeta(step, i, item);
        const tipLabel = step.tip || "Onay";
        const canAct = m.label === 'Bekliyor' && step.user === me;
        const connector = i < steps.length - 1
            ? `<div style="width:2px;flex:1;min-height:18px;background:var(--color-border-light);margin:4px 0;"></div>` : '';

        return `
        <div style="display:flex;gap:12px;margin-bottom:4px;">
            <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:38px;">
                <div style="width:38px;height:38px;border-radius:50%;background:${escapeHtml(m.bg)};border:2px solid ${escapeHtml(m.border)};
                            display:flex;align-items:center;justify-content:center;font-size:17px;">${escapeHtml(m.icon)}</div>
                ${connector}
            </div>
            <div style="flex:1;background:${escapeHtml(m.bg)};border:1px solid ${escapeHtml(m.border)};border-radius:10px;padding:11px 14px;
                        margin-bottom:${i < steps.length - 1 ? '4px' : '0'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div>
                        <div style="font-size:10px;font-weight:700;color:${escapeHtml(m.color)};text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(tipLabel)}</div>
                        <div style="font-size:14px;font-weight:700;color:var(--color-text);margin:3px 0;">${escapeHtml(step.user || '—')}</div>
                        <span style="font-size:11px;font-weight:600;background:${escapeHtml(m.badgeBg)};color:${escapeHtml(m.badgeText)};padding:2px 10px;border-radius:20px;">${escapeHtml(m.label)}</span>
                    </div>
                    ${canAct ? `
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button onclick="window.approveStep(${jsArg(id)})"
                            style="padding:6px 14px;background:var(--color-success);color:var(--color-text-white);border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;">
                            <i class="fas fa-check"></i> Onayla
                        </button>
                        <button onclick="window.rejectStep(${jsArg(id)})"
                            style="padding:6px 14px;background:var(--color-danger);color:var(--color-text-white);border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;">
                            <i class="fas fa-times"></i> Reddet
                        </button>
                    </div>` : ''}
                </div>
                ${step.note ? `<div style="margin-top:8px;padding:7px 10px;background:var(--color-surface-alt);border:1px solid var(--color-border-light);border-radius:6px;font-size:12px;color:var(--color-text-muted);font-style:italic;">💬 "${escapeHtml(step.note)}"</div>` : ''}
                ${step.date ? `<div style="margin-top:5px;font-size:10px;color:var(--color-text-hint);text-align:right;"><i class="fas fa-clock" style="margin-right:3px;"></i>${escapeHtml(step.date)}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    // Süreç Geçmişi - Hem eski akis hem EBYS history birleştir
    const logHTML = (item.akis || []).length > 0 ? `
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--color-border-light);">
            <div style="font-size:11px;font-weight:700;color:var(--color-text-hint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">
                <i class="fas fa-history me-1"></i> Süreç Geçmişi
            </div>
            ${[...item.akis].reverse().map(a => `
            <div style="display:flex;flex-direction:column;gap:2px;padding:5px 0;border-bottom:1px solid var(--color-border-light);font-size:11px;">
                <div style="display:flex;gap:8px;">
                    <span style="color:var(--color-text-hint);min-width:120px;flex-shrink:0;">${escapeHtml(a.tarih || '')}</span>
                    <span style="color:var(--color-text-muted);min-width:80px;flex-shrink:0;font-weight:600;">${escapeHtml(a.yapan || '')}</span>
                    <span style="color:var(--color-text);">${escapeHtml(a.islem || '')}</span>
                </div>
                ${a.not ? `<div style="margin-left:128px; color:var(--color-text-muted); font-style:italic;">💬 "${escapeHtml(a.not)}"</div>` : ''}
                ${a.note ? `<div style="margin-left:128px; color:var(--color-text-muted); font-style:italic;">💬 "${escapeHtml(a.note)}"</div>` : ''}
            </div>`).join('')}
        </div>` : '';

    body.innerHTML = `
        <div style="background:${escapeHtml(ds.bg)};border-radius:10px;padding:13px 16px;margin-bottom:18px;display:flex;align-items:center;gap:12px;">
            <i class="fas ${escapeHtml(ds.icon)}" style="font-size:22px;color:${escapeHtml(ds.color)};flex-shrink:0;"></i>
            <div style="flex:1;min-width:0;">
                <div style="font-size:15px;font-weight:700;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.urun || '—')}</div>
                <div style="font-size:11px;color:var(--color-text-hint);margin-top:2px;">${escapeHtml(item.evrakNo || '')} · ${escapeHtml(item.talepEden || item.createdByName || '')} · ${escapeHtml(item.tarih || '')}</div>
            </div>
            <span style="background:${escapeHtml(ds.color)};color:var(--color-text-white);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;flex-shrink:0;white-space:nowrap;">${escapeHtml(ds.text)}</span>
        </div>
        ${steps.length > 0 ? `
        <div style="font-size:11px;font-weight:700;color:var(--color-text-hint);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;">
            <i class="fas fa-stream me-1"></i> Onay Akışı · ${completedSteps}/${steps.length} tamamlandı
        </div>` : `
        <div style="text-align:center;padding:28px 0;color:var(--color-text-hint);">
            <i class="fas fa-sitemap" style="font-size:28px;display:block;margin-bottom:10px;"></i>
            Henüz iş akışı adımı tanımlanmamış.
        </div>`}
        ${stepsHTML}
        ${logHTML}
    `;
    modal.style.display = "block";
};

window.closeWorkflowModal = function () {
    document.getElementById("workflowModal").style.display = "none";
}

// Veri düzeltme fonksiyonu - currentStep değerini status'dan yeniden hesapla
// [BUGFIX] Bug 5: Made async to support await for targeted save
// [WHY]: viewWorkflow her açılışta bu fonksiyonu saveToDB=true ile çağırıyor ve tüm purchaseOrders'ı yazıyordu (DATA-14).
// [HOW]: Değişiklik olup olmadığı döndürülür; saveToDB yalnız değişiklik varsa ve yalnız bu talebi yazar (upsertItem).
window.fixWorkflowCurrentStep = async function (item, saveToDB = false) {
    if (!item.workflow || !item.workflow.steps) return false;

    const before = JSON.stringify([item.workflow.currentStep, item.workflow.currentState, item.workflow.finished, item.durum]);
    const steps = item.workflow.steps;

    // Tamamlanan adımları status'dan say
    let actualCurrentStep = 0;
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].status === 'approved') {
            actualCurrentStep = i + 1;
        } else {
            break;
        }
    }

    // Eğer currentStep yanlışsa düzelt
    if (item.workflow.currentStep !== actualCurrentStep) {
        console.log(`🔧 currentStep düzeltildi (${item.evrakNo}): ${item.workflow.currentStep} -> ${actualCurrentStep}`);
        item.workflow.currentStep = actualCurrentStep;
    }

    // Eğer tüm adımlar tamamlandıysa finished flag'ini ayarla
    if (actualCurrentStep >= steps.length && steps.length > 0) {
        item.workflow.finished = true;
        if (!item.workflow.currentState || item.workflow.currentState !== window.WorkflowEngine?.states?.COMPLETED) {
            item.workflow.currentState = window.WorkflowEngine?.states?.COMPLETED;
        }
        if (item.durum !== "Onaylandı") {
            item.durum = "Onaylandı";
        }
    } else {
        // 🔥 KRİTİK DÜZELTME: Adımlar bitmemiş ama state COMPLETED kalmışsa iyileştir
        if (item.workflow.currentState === window.WorkflowEngine?.states?.COMPLETED) {
            console.log(`🔧 Durum Düzeltme (${item.evrakNo}): State COMPLETED -> INITIATION (Adımlar henüz bitmemiş)`);
            item.workflow.currentState = window.WorkflowEngine?.states?.INITIATION;
            item.workflow.finished = false;
            if (item.durum === "Onaylandı") item.durum = "Onay Bekliyor";
        }
    }

    const changed = before !== JSON.stringify([item.workflow.currentStep, item.workflow.currentState, item.workflow.finished, item.durum]);
    const canRepair = typeof window.isDbAdmin === 'function' && window.isDbAdmin();   // J10: personel onarım yazamaz (kurallar)
    if (changed && saveToDB && canRepair && typeof window.upsertItem === 'function') {
        // Görüntüleme sırasında onarım yazılamazsa (çevrimdışı, yetki) pencere yine açılır; sonuç yalnız loglanır.
        if (!(await window.writeOk(window.upsertItem('purchaseOrders', item)))) console.warn('⚠️ Akış onarımı kaydedilemedi:', item.id);
    }
    return changed;
};

// Tüm workflow verilerini düzeltme fonksiyonu
// [WHY]: Bu göç ilk purchaseOrders snapshot'ında her ziyaretçide (anonim dahil) çalışıp yazıyordu (DATA-14).
// [HOW]: Yalnız Firebase admin oturumunda çalışır; yalnız değişen talepler yazılır (saveData v2 fark yazması).
window.fixAllWorkflowData = async function () {
    if (!window.data.purchaseOrders) return 0;
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) return 0;

    let fixedCount = 0;
    window.data.purchaseOrders.forEach(item => {
        if (item.workflow) {
            const oldCurrentStep = item.workflow.currentStep;
            const oldState = item.workflow.currentState;
            window.fixWorkflowCurrentStep(item, false);
            if (item.workflow.currentStep !== oldCurrentStep || item.workflow.currentState !== oldState) {
                fixedCount++;
                console.log(`🔧 Düzeltildi: ${item.evrakNo} - ${oldCurrentStep} -> ${item.workflow.currentStep}`);
            }
        }
    });

    if (fixedCount > 0) {
        console.log(`🎯 Toplam ${fixedCount} workflow kaydı düzeltildi, kaydediliyor...`);
        // [FIX]: Tüm veritabanını yollamak yerine sadece ilgili tabloyu akıllı saveData overload'u ile gönderiyoruz
        if (!(await window.writeOk(window.saveData('purchaseOrders', window.data.purchaseOrders)))) { console.error('❌ Akış göçü kaydedilemedi'); return 0; }
        console.log(`✅ Veritabanına kaydedildi`);
    } else {
        console.log(`✅ Düzeltilecek kayıt bulunamadı`);
    }

    return fixedCount;
};

// ✅ DATA SANITIZATION SERVICE (Background Migration)
// [WHY]: Veri bozuklukları UI Render döngüsünde değil, sistem ilk yüklenirken arka planda 1 kez çözülmelidir.
// [HOW]: firebase-handler.js veriyi çekip PubSub event'i yayınladığında bu listener devreye girer.
window.addEventListener('onInventoryDataUpdated', (e) => {
    if (e.detail && e.detail.collection === 'purchaseOrders') {
        if (window._workflowMigrationDone) return; // Sonsuz loop engeli
        console.log('🛡️ Data Sanitization Service: Workflow verileri arka planda analiz ediliyor...');
        window.fixAllWorkflowData().then(() => {
            window._workflowMigrationDone = true;
        });
    }
});

// [WHY]: Adım sahibi kontrolü yoktu; bayat "Onayla" butonu veya liste butonu başkasının adımını onun adına onaylıyordu,
//        çift tıklama iki adımı birden geçiriyordu (EBYS-02).
// [HOW]: Yalnız mevcut adımın sahibi (normalize ad) veya Firebase admin oturumu işlem yapabilir; talep başına işlem kilidi.
const _workflowActionsInFlight = new Set();
const _normName = s => String(s || '').trim().toLocaleLowerCase('tr-TR');

// [WHY]: Onay/red/durdurma talebi canlı window.data nesnesi üzerinde değiştiriyor (adım "approved", durum, akis), sonra
//        geçiş veya kayıt başarısız olursa nesne yarı değişmiş kalıyordu (EBYS-17). saveData v2 fark yazdığı için bu yarım
//        hal, sonraki herhangi bir purchaseOrders kaydında sessizce kalıcı hale gelirdi (maskeleme çifti). Id'siz eski
//        akışlarda geçiş getWorkflow(undefined) ile başka bir talebin akışını değiştirebiliyordu.
// [HOW]: Değişiklikten önce talebin tam kopyası alınır; hata veya başarısız kayıtta talep kopyaya geri döndürülür.
//        Akışın id'si yoksa talebe bağlı kalıcı bir id verilir ('workflow_' + talep id).
const _rollbacks = new Map();
function _ensureWorkflowId(item) {
    if (item && item.workflow && !item.workflow.id) item.workflow.id = 'workflow_' + item.id;
}
function _beginMutation(key, item) {
    _ensureWorkflowId(item);
    const copy = JSON.parse(JSON.stringify(item));
    _rollbacks.set(key, () => { Object.keys(item).forEach(k => delete item[k]); Object.assign(item, copy); });
}
function _rollback(key) {
    const fn = _rollbacks.get(key);
    _rollbacks.delete(key);
    if (fn) { fn(); console.warn('↩️ [EBYS] Talep değişiklikleri geri alındı:', key); }
}
function _endMutation(key) { _rollbacks.delete(key); }

function _canActOnCurrentStep(item) {
    const wf = item && item.workflow;
    // Durdurulmuş (askıya alınmış) akışta sıradaki kişi onay/red veremez (EBYS-13 çifti).
    if (!wf || wf.finished || wf.started === false || wf.currentState === 'suspended') return false;
    const step = (wf.steps || [])[wf.currentStep || 0];
    if (!step) return false;
    if (typeof window.isDbAdmin === 'function' && window.isDbAdmin()) return true;
    // Faz 4B · J10: kurallar onaylayıcıyı adıyla değil Auth uid'siyle tanır (steps[currentStep].userUid). Onaylayıcı hesabı
    //               tanımsız adımı yalnız yönetici onaylar. Talep sahibinin kendi adımı burada değil guardSelfApproval'da durur
    //               (J4: engel + 'blocked' denetim kaydı); kurallar da sahibin onayını reddeder.
    const u = window.userAuth;
    return !!(u && !u.isAnonymous && step.userUid && String(step.userUid) === String(u.uid));
}

function _denyStepAction(item) {
    const wf = item && item.workflow;
    const step = wf && (wf.steps || [])[wf.currentStep || 0];
    const msg = step && !step.userUid && !(typeof window.isDbAdmin === 'function' && window.isDbAdmin())
        ? 'Bu adımın onaylayıcısının giriş hesabı tanımlı değil; adımı yönetici onaylamalı (ya da şablon / akış yeniden başlatılmalı).'
        : 'Bu adım için işlem yetkiniz yok (sıra sizde değil veya akış tamamlandı).';
    if (typeof showAppAlert === 'function') showAppAlert(msg, 'error');
}

// ✅ ENHANCED: State machine ile uyumlu onay sistemi
window.approveStep = async function (id) {
    const lockKey = String(id);
    if (_workflowActionsInFlight.has(lockKey)) return;
    _workflowActionsInFlight.add(lockKey);
    let guard = null;
    try {
        const item = window.data.purchaseOrders.find(x => String(x.id) === String(id));
        if (!item || !item.workflow) return;
        if (!_canActOnCurrentStep(item)) { _denyStepAction(item); return; }

        // [WHY]: Faz 4 · J4 (EBYS-04, M12) — kendi satın alma talebinin adımını onaylama kontrolü yalnız index'teki
        //        sarmalayıcıdaydı (admin.html'de ve doğrudan çağrıda yoktu). Personel → engel + 'blocked'; admin → parola.
        guard = await window.SecurityConfig.guardSelfApproval({
            kind: 'purchase', record: item, refCol: 'purchaseOrders',
            type: 'Satın Alma Onayı', item: item.urun || item.ürünAdi || item.baslik || item.evrakNo, qty: Number(item.adet || item.miktar) || 1
        });
        if (!guard.allowed) return;
        _beginMutation(lockKey, item);

        const actor = (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || "Bilinmeyen Kullanıcı";   // J11 · P1 #5: kurallar staffName ile karşılaştırır

        // 1. MEVCUT ADIMI SABİTLE (Hata buradaydı: geçişten önce indeksi almalıyız)
        const currentStepIndex = item.workflow.currentStep || 0;
        const steps = item.workflow.steps || [];
        const step = steps[currentStepIndex];

        if (currentStepIndex >= steps.length && steps.length > 0) {
            console.log('Tüm adımlar zaten onaylanmış');
            if (typeof showAppAlert === 'function') {
                showAppAlert('Tüm adımlar zaten onaylanmış.', 'warning');
            }
            return;
        }

        // 2. ADIMI ONAYLA
        if (step) {
            step.status = "approved";
            step.date = new Date().toLocaleString('tr-TR');
            step.actor = actor;
        }

        // 3. SONRAKİ STATE'İ BELİRLE
        let nextState;
        let currentState = item.workflow.currentState || window.WorkflowEngine.states.INITIATION;

        // 🔥 KRİTİK: Eğer mevcut state hatalı bir şekilde COMPLETED ise, onu geçici olarak INITIATION yap
        // ki transitionWorkflowState "completed -> completed" hatası vermesin.
        if (currentState === window.WorkflowEngine.states.COMPLETED && currentStepIndex < steps.length) {
            console.warn("⚠️ Hatalı COMPLETED state'i onarılıyor...");
            item.workflow.currentState = window.WorkflowEngine.states.INITIATION;
            currentState = window.WorkflowEngine.states.INITIATION;
        }

        // Eğer bu son adımsa direkt COMPLETED'a git
        if (currentStepIndex >= steps.length - 1) {
            nextState = window.WorkflowEngine.states.COMPLETED;
        } else {
            // Değilse state machine'e göre veya sıradaki tipe göre ilerle
            switch (currentState) {
                case window.WorkflowEngine.states.INITIATION:
                    nextState = window.WorkflowEngine.states.MANAGER_APPROVAL;
                    break;
                case window.WorkflowEngine.states.MANAGER_APPROVAL:
                    nextState = window.WorkflowEngine.states.HR_APPROVAL;
                    break;
                case window.WorkflowEngine.states.HR_APPROVAL:
                    nextState = window.WorkflowEngine.states.FINANCE_APPROVAL;
                    break;
                case window.WorkflowEngine.states.FINANCE_APPROVAL:
                    nextState = window.WorkflowEngine.states.DIRECTOR_APPROVAL;
                    break;
                case window.WorkflowEngine.states.DIRECTOR_APPROVAL:
                    nextState = window.WorkflowEngine.states.COMPLETED;
                    break;
                default:
                    // Özel akışlarda bir sonraki makul state'i seç
                    nextState = window.WorkflowEngine.states.MANAGER_APPROVAL;
                    break;
            }
        }

        // 4. STATE GEÇİŞİNİ YAP
        await window.transitionWorkflowState(
            item.workflow.id,
            nextState,
            actor,
            `${step?.tip || 'Adım'} onaylandı`,
            { persist: false }
        );

        // 5. İNDEKSİ GÜNCELLE VE SENKRONİZE ET
        item.workflow.currentStep = currentStepIndex + 1;

        if (item.workflow.currentStep >= steps.length || nextState === window.WorkflowEngine.states.COMPLETED) {
            item.workflow.finished = true;
            item.workflow.currentState = window.WorkflowEngine.states.COMPLETED;
            item.durum = "Onaylandı";
        } else {
            item.durum = "Onay Bekliyor";
        }

        // Veri tutarsızlıklarını son bir kez daha düzelt
        await window.fixWorkflowCurrentStep(item, false);

        // 6. GEÇMİŞİ GÜNCELLE
        const approvalTime = new Date().toLocaleString('tr-TR');
        if (!item.akis) item.akis = [];

        item.akis.push({
            islem: `✅ Onaylandı: ${step?.tip || 'Onay Adımı'}`,
            yapan: actor,
            uid: window.userAuth?.uid || '',   // J11 · P1 #5
            tarih: approvalTime,
            note: `Süreç: ${window.getStateLabel ? window.getStateLabel(nextState) : nextState}`
        });

        // 7. KAYDET VE KAPAT
        // [BUGFIX] Bug 3: Targeted save to purchaseOrders only.
        // [WHY]: window.saveData(window.data) attempts a batch write across ALL collections.
        //        Non-admin users have permission only on specific collections, so the batch fails.
        // [HOW]: We pass the collection name + its array directly so only purchaseOrders is written.
        // Snapshot dizisi değişmiş olabilir; değiştirilmiş talep güncel dizideki yerine konularak tek seferde yazılır.
        const saved = await window.writeOk(window.upsertItem('purchaseOrders', item));
        if (saved === false) _rollback(lockKey); else _endMutation(lockKey);
        await window.SecurityConfig.logSelfApproval(guard, saved !== false);
        guard = null;
        window.closeWorkflowModal();
        if (typeof window.closePurchaseModal === 'function') window.closePurchaseModal();

        // 8. TÜM UI'LARI YENİLE
        refreshUI();

        if (typeof showAppAlert === 'function') {
            if (saved === false) showAppAlert('Onay kaydedilemedi. Bağlantınızı kontrol edin.', 'error');
            else showAppAlert(`Onay başarıyla verildi.`, "success");
        }

    } catch (error) {
        console.error('Onay verilemedi:', error);
        if (typeof showAppAlert === 'function') {
            showAppAlert(`Onay hatası: ${error.message}`, "error");
        }
        _rollback(lockKey);
        if (guard && guard.allowed) await window.SecurityConfig.logSelfApproval(guard, false);
    } finally {
        _workflowActionsInFlight.delete(lockKey);
        _endMutation(lockKey);
    }
};

window.rejectStep = async function (id) {
    const lockKey = String(id);
    if (_workflowActionsInFlight.has(lockKey)) return;
    _workflowActionsInFlight.add(lockKey);
    try {
        const item = window.data.purchaseOrders.find(x => String(x.id) === String(id));
        if (!item || !item.workflow) return;
        if (!_canActOnCurrentStep(item)) { _denyStepAction(item); return; }
        // J10: personel kendi talebinin adımını reddedemez (kurallar da reddeder); sahibin yolu talebi geri çekmektir.
        if (!window.isDbAdmin() && item.createdByUid && window.userAuth && String(item.createdByUid) === String(window.userAuth.uid)) {
            if (typeof showAppAlert === 'function') showAppAlert('Kendi talebinizin adımında işlem yapamazsınız; talebi geri çekebilirsiniz.', 'error');
            return;
        }

        let note;
        while (true) {
            note = prompt("Lütfen RED nedenini belirtiniz (Zorunlu):");
            if (note === null) return;
            if (note.trim()) break;
            alert("Red nedeni boş bırakılamaz!");
        }

        const actor = (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || "Bilinmeyen Kullanıcı";   // J11 · P1 #5: kurallar staffName ile karşılaştırır
        _beginMutation(lockKey, item);

        // Mevcut adımı sabitle
        const currentStepIndex = item.workflow.currentStep || 0;
        const step = item.workflow.steps[currentStepIndex];

        // State machine ile cancelled state'ine geç
        await window.transitionWorkflowState(
            item.workflow.id,
            window.WorkflowEngine.states.CANCELLED,
            actor,
            `Reddedildi: ${note.trim()}`,
            { persist: false }
        );

        // Adımı ve durumu güncelle
        if (step) {
            step.status = "rejected";
            step.note = note.trim();
            step.date = new Date().toLocaleString('tr-TR');
            step.actor = actor;
        }

        item.durum = "Reddedildi";
        item.workflow.finished = true;
        item.workflow.currentState = window.WorkflowEngine.states.CANCELLED;

        // Eski akış sistemini de güncelle
        if (!item.akis) item.akis = [];
        const rejectionTime = new Date().toLocaleString('tr-TR');
        const myUid = window.userAuth?.uid || '';   // J11 · P1 #5: kurallar üç red kaydında da request.auth.uid ile eşler
        item.akis.push({
            islem: `❌ REDDEDİLDİ: ${step?.tip || 'Onay'}`,
            yapan: actor,
            uid: myUid,
            tarih: rejectionTime,
            not: note.trim()
        });

        // EBYS state geçişini de akis'e ekle
        if (item.workflow && item.workflow.history && item.workflow.history.length > 0) {
            const lastHistory = item.workflow.history[item.workflow.history.length - 1];
            if (lastHistory && lastHistory.action === 'transition') {
                item.akis.push({
                    islem: `🔄 State Geçişi: ${window.getStateLabel ? window.getStateLabel(lastHistory.to) : lastHistory.to}`,
                    yapan: lastHistory.actor || actor,
                    uid: myUid,
                    tarih: new Date(lastHistory.timestamp).toLocaleString('tr-TR'),
                    not: `Reddedildi: ${note.trim()}`
                });
            }
        }

        // [BUGFIX] Bug 4: Fixed duplicate 'note' field - now using 'stateNote' for state info
        // Modal'da gösterim için ekstra red kaydı
        item.akis.push({
            islem: `❌ Reddedildi: ${step?.tip || 'Onay Adımı'}`,
            yapan: actor,
            uid: myUid,
            tarih: rejectionTime,
            not: note.trim(),
            stateNote: `State: ${window.getStateLabel ? window.getStateLabel(window.WorkflowEngine.states.CANCELLED) : 'CANCELLED'}`
        });

        // Kaydet ve UI güncelle
        // [BUGFIX] Bug 3: Targeted save to purchaseOrders only.
        // [WHY]: Same permission issue as approveStep — non-admins can't overwrite the full DB snapshot.
        // [HOW]: Only the purchaseOrders collection is written, matching the collection-level Firestore rules.
        // Snapshot dizisi değişmiş olabilir; değiştirilmiş talep güncel dizideki yerine konularak tek seferde yazılır.
        const saved = await window.writeOk(window.upsertItem('purchaseOrders', item));
        if (saved === false) _rollback(lockKey); else _endMutation(lockKey);
        window.closeWorkflowModal();
        if (typeof window.closePurchaseModal === 'function') window.closePurchaseModal();

        if (typeof refreshUI === "function") refreshUI();
        if (typeof renderPurchaseModule === "function") renderPurchaseModule();
        if (typeof renderMyApprovals === "function") renderMyApprovals();

        if (typeof showAppAlert === 'function') {
            if (saved === false) showAppAlert('Red kaydedilemedi. Bağlantınızı kontrol edin.', 'error');
            else showAppAlert("Talep reddedildi.", "warning");
        }

    } catch (error) {
        console.error('Red işlemi yapılamadı:', error);
        if (typeof showAppAlert === 'function') {
            showAppAlert(`Red işlemi yapılamadı: ${error.message}`, "error");
        }
        _rollback(lockKey);
    } finally {
        _workflowActionsInFlight.delete(lockKey);
        _endMutation(lockKey);
    }
};

// [WHY]: stopWorkflow hiçbir zaman başarılı olamıyordu: geçiş tablosunda aktif durumlardan 'suspended'a geçiş yoktu; akis dizisi
//        olmayan talepte çöküyor, geçiş ayrıca tüm diziyi yazıyor ve sonuç kontrol edilmiyordu (EBYS-13).
// [HOW]: Yalnız Firebase admin oturumu durdurur; yalnız başlamış ve bitmemiş akış. Geçiş persist:false ile yapılır, talep
//        güncel dizideki yerine konularak tek seferde yazılır; hata "başarılı" gösterilmez. Durdurulan akışta adım sahibi
//        işlem yapamaz; talep "Durduruldu" olur ve admin tablosunda yeniden "Akışı Başlat" ile başlatılabilir (geçmiş korunur).
window.stopWorkflow = async function (id) {
    const lockKey = 'stop_' + String(id);
    if (_workflowActionsInFlight.has(lockKey)) return;
    _workflowActionsInFlight.add(lockKey);
    const notify = (msg, type) => { if (typeof showAppAlert === 'function') showAppAlert(msg, type); else alert(msg); };
    try {
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { notify('Akışı yalnız yönetici durdurabilir.', 'error'); return; }

        const find = () => (window.data.purchaseOrders || []).find(x => String(x.id) === String(id));
        const initial = find();
        if (!initial || !initial.workflow) { notify('Talep veya akış bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        if (!initial.workflow.started || initial.workflow.finished) { notify('Yalnız devam eden bir akış durdurulabilir.', 'warning'); return; }

        const ok = typeof showCustomConfirm === 'function'
            ? await showCustomConfirm('Akışı Durdur', 'Akış askıya alınacak; sıradaki onaylayıcı işlem yapamayacak. Daha sonra "Akışı Başlat" ile yeniden başlatılabilir. Devam edilsin mi?')
            : window.confirm('Akış durdurulsun mu?');
        if (ok !== true) return;

        // Onay kutusu açıkken snapshot gelmiş olabilir: güncel kayıt ve durum yeniden kontrol edilir
        const item = find();
        if (!item || !item.workflow || !item.workflow.started || item.workflow.finished) { notify('Akış bu arada değişti; işlem iptal edildi.', 'warning'); return; }

        const actor = window.currentUser?.name || "Yönetici";
        _beginMutation(lockKey, item);
        await window.transitionWorkflowState(item.workflow.id, window.WorkflowEngine.states.SUSPENDED, actor, "Akış askıya alındı", { persist: false });

        item.workflow.started = false;
        item.workflow.suspendedAt = new Date().toISOString();
        item.workflow.suspendedBy = actor;
        item.durum = "Durduruldu";
        if (!Array.isArray(item.akis)) item.akis = [];
        item.akis.push({ islem: "⏸️ Akış durduruldu", yapan: actor, tarih: new Date().toLocaleString('tr-TR') });

        const saved = await window.writeOk(window.upsertItem('purchaseOrders', item));
        if (saved === false) _rollback(lockKey); else _endMutation(lockKey);
        if (typeof refreshUI === "function") refreshUI();
        if (typeof renderPurchaseModule === "function") renderPurchaseModule();
        if (saved === false) notify('Akış durdurulamadı: kayıt yazılamadı.', 'error');
        else notify("Akış durduruldu (askıya alındı).", "info");
    } catch (error) {
        console.error('Akış durdurulamadı:', error);
        notify(`Akış durdurulamadı: ${error.message}`, "error");
        _rollback(lockKey);
    } finally {
        _workflowActionsInFlight.delete(lockKey);
        _endMutation(lockKey);
    }
};

// Bana Gelen Kayıtlar -- normalde ScriptProcessorNode.js'e eklense daha doğruydu ama ben burada edm tarafını saklamak istedim
window.renderMyApprovals = function () {
    console.log("🔍 renderMyApprovals tetiklendi");
    const container = document.getElementById("myApprovalsContainer");
    if (!container) {
        console.error("❌ Hata: 'myApprovalsContainer' bulunamadı!");
        return;
    }

    const rawUser = window.currentUser;
    console.log("👤 Aktif Kullanıcı (Raw):", rawUser);

    const me = (rawUser?.name || "").trim().toLocaleLowerCase('tr-TR');
    console.log("👤 Aktif Kullanıcı (Normalize):", me);

    if (!me) {
        console.warn("⚠️ Uyarı: Aktif kullanıcı ismi boş!");
        container.innerHTML = `<div class="alert alert-warning">Kullanıcı oturumu saptanamadı. Lütfen tekrar giriş yapın.</div>`;
        return;
    }

    const allOrders = window.data.purchaseOrders || [];
    console.log(`📦 Toplam Satın Alma Talebi Sayısı: ${allOrders.length}`);

    // Benim herhangi bir adımda olduğum TÜM aktif (başlamış ve iptal edilmemiş) talepler
    const myRelatedOrders = allOrders.filter(item => {
        if (!item.workflow || item.workflow.started !== true || item.durum === 'İptal Edildi') {
            return false;
        }
        const steps = item.workflow?.steps || [];
        const myUid = window.userAuth && !window.userAuth.isAnonymous ? String(window.userAuth.uid) : '';
        const isMatch = steps.some(s => {
            if (s.userUid) return !!myUid && String(s.userUid) === myUid;   // J10: hesabı tanımlı adım uid ile
            const stepUser = (s.user || "").trim().toLocaleLowerCase('tr-TR');
            return stepUser === me;
        });
        return isMatch;
    });

    console.log(`✅ Eşleşen Talep Sayısı: ${myRelatedOrders.length}`);

    if (myRelatedOrders.length === 0) {
        container.innerHTML = `<div class="p-5 text-center text-muted bg-light rounded-3">
            <i class="fas fa-inbox fa-3x mb-3 opacity-25"></i>
            <p>Henüz size yönlendirilmiş bir onay bulunmuyor.</p>
        </div>`;
        return;
    }

    try {
        // Tarihe göre sırala (en yeni üstte) - GG.AA.YYYY formatı için özel parse
        myRelatedOrders.sort((a, b) => {
            const parseDate = (d) => {
                if (!d) return 0;
                const parts = String(d).split('.');
                if (parts.length === 3) {
                    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                }
                return new Date(d).getTime();
            };
            return parseDate(b.tarih) - parseDate(a.tarih);
        });

        console.log("🛠️ Sıralama tamamlandı, HTML oluşturuluyor...");

        container.innerHTML = myRelatedOrders.map((item, idx) => {
            console.log(`Rendering item ${idx}:`, item.urun);
            const steps = item.workflow?.steps || [];
            const myStepIndex = steps.findIndex(s => (s.user || "").trim().toLocaleLowerCase('tr-TR') === me);

            if (myStepIndex === -1) {
                console.warn(`⚠️ Uyarı: '${item.urun}' içinde kullanıcı bulunamadı!`);
                return "";
            }

            const myStep = steps[myStepIndex];
            const isCurrent = item.workflow.started && !item.workflow.finished && item.workflow.currentStep === myStepIndex;

            let badgeClass = "bg-secondary";
            let statusText = "Sırada";

            // Status-based kontrol - workflowModal ile aynı mantık
            const allApproved = steps.length > 0 && steps.every(step => step.status === 'approved');

            if (myStep.status === 'approved') {
                badgeClass = "bg-success";
                statusText = "Onayladınız";
            } else if (myStep.status === 'rejected') {
                badgeClass = "bg-danger";
                statusText = "Reddettiniz";
            } else if (isCurrent) {
                badgeClass = "bg-warning text-dark";
                statusText = "Onayınız Bekleniyor";
            } else if (allApproved) {
                // Tüm adımlar onaylandıysa genel durum "Tamamlandı"
                badgeClass = "bg-success";
                statusText = "Tamamlandı";
            }

            return `
            <div class="approval-card ${isCurrent ? 'active-step' : ''} d-flex flex-column">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="approval-header-info">
                        <h5 class="fw-bold">${escapeHtml(item.urun || 'İsimsiz Talep')}</h5>
                        <span class="badge ${badgeClass}">${statusText}</span>
                    </div>
                    <div class="approval-id-badge">
                        #${escapeHtml(item.id)}
                    </div>
                </div>
                
                <div class="card-details">
                    <div class="detail-item">
                        <i class="fas fa-file-invoice" title="Evrak No"></i>
                        <span class="font-monospace fw-bold detail-value">${escapeHtml(item.evrakNo || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-user" title="Talep Eden"></i>
                        <span>${escapeHtml(item.talepEden || item.createdByName || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-building" title="Birim"></i>
                        <span>${escapeHtml(item.birim || '—')}</span>
                    </div>
                    <div class="detail-item">
                        <i class="fas fa-calendar-alt" title="Tarih"></i>
                        <span>${escapeHtml(item.tarih || '—')}</span>
                    </div>
                </div>

                <div class="d-flex flex-row justify-content-between align-items-center mt-auto pt-3" style="border-top: 1px dashed #e2e8f0; display: flex !important; flex-direction: row !important; gap: 8px;">
                    <button onclick="window.openPurchaseDetail(${jsArg(String(item.id))}, 'view')" class="btn-modern-card btn-detail" style="flex: 1; justify-content: center;">
                        <i class="fas fa-search-plus"></i> Detay
                    </button>
                    
                    ${isCurrent ? `
                        <button onclick="window.rejectStep(${jsArg(String(item.id))})" class="btn-modern-card btn-danger" style="flex: 1; justify-content: center;">
                            <i class="fas fa-times"></i> Reddet
                        </button>
                        <button onclick="window.approveStep(${jsArg(String(item.id))})" class="btn-modern-card btn-success" style="flex: 1; justify-content: center;">
                            <i class="fas fa-check"></i> Onayla
                        </button>
                    ` : `
                        <button onclick="window.viewWorkflow(${jsArg(String(item.id))})" class="btn-modern-card" style="flex: 2; justify-content: center; background: var(--color-primary-light); color: var(--color-primary);">
                            <i class="fas fa-history"></i> Akış Takibi
                        </button>
                    `}
                </div>
            </div>`;
        }).join('');

        console.log("✨ HTML container'a basıldı. Karakter sayısı:", container.innerHTML.length);
        if (container.innerHTML.length < 50) {
            console.warn("⚠️ Uyarı: Oluşturulan HTML çok kısa veya boş görünüyor!");
        }

    } catch (err) {
        console.error("❌ renderMyApprovals Loop Hatası:", err);
        container.innerHTML = `<div class="alert alert-danger">Liste yüklenirken bir hata oluştu: ${escapeHtml(err.message)}</div>`;
    }

    // Sayacı ve İstatistikleri güncelle
    const pendingCount = myRelatedOrders.filter(item => {
        const steps = item.workflow?.steps || [];
        const idx = steps.findIndex(s => (s.user || "").trim().toLocaleLowerCase('tr-TR') === me);
        return item.workflow.started && !item.workflow.finished && item.workflow.currentStep === idx;
    }).length;

    const countBadge = document.getElementById("myApprovalCount");
    const countText = document.getElementById("myApprovalCountText");
    const totalRelatedSpan = document.getElementById("totalMyRelatedRequests");

    if (totalRelatedSpan) {
        totalRelatedSpan.innerText = myRelatedOrders.length;
    }

    if (countBadge) {
        countBadge.style.display = pendingCount > 0 ? "flex" : "none";
        if (countText) {
            countText.innerText = `${pendingCount} Bekleyen Onay`;
        }
    }
    console.log(`📊 Bekleyen Onay Sayısı: ${pendingCount}, Toplam İlgili: ${myRelatedOrders.length}`);
};


// edm-workflow.js'nin EN ALTINA ekle

// --- İŞ AKIŞI ŞABLONLARI (WORKFLOW TEMPLATES) ---
window.openTemplateModal = function (id = null) {
    const modal = document.getElementById('templateModal');
    if (!modal) return;

    // Düzenleme ID'sini globale kaydediyoruz
    WorkflowState.currentEditingTemplateId = id;

    if (id) {
        // window.templates (Firestore'dan gelen canlı veri) üzerinden bul
        const tpl = (window.templates || []).find(x => String(x.id) === String(id));
        if (tpl) {
            const icon = '<i class="far fa-file-alt text-muted" style="font-size: 1rem;"></i> ';
            document.getElementById('templateModalTitle').innerHTML = icon + "Şablonu Düzenle";
            document.getElementById('tplName').value = tpl.name;
            WorkflowState.tempTplSteps = JSON.parse(JSON.stringify(tpl.steps || [])); // Deep copy
            WorkflowState.tempTplAuth = [...(tpl.auth || [])];
        }
    } else {
        const icon = '<i class="far fa-file-alt text-muted" style="font-size: 1rem;"></i> ';
        document.getElementById('templateModalTitle').innerHTML = icon + "Yeni Şablon Oluştur";
        document.getElementById('tplName').value = "";
        WorkflowState.tempTplSteps = [];
        WorkflowState.tempTplAuth = [];
        window.addStepToTemplate(); // İlk boş adımı ekle
    }

    window.renderTemplateSteps();
    window.renderTemplateAuth();
    modal.style.display = 'block';
};

window.closeTemplateModal = function () {
    const modal = document.getElementById('templateModal');
    if (modal) modal.style.display = 'none';
};


window.removeStepFromTemplate = function (index) {
    WorkflowState.tempTplSteps.splice(index, 1);
    window.renderTemplateSteps();
};

window.renderTemplateSteps = function () {
    const area = document.getElementById('templateStepsArea');
    const isLocked = !WorkflowState.isManualMode;
    if (!area) return;

    // ORDER FIX
    WorkflowState.tempTplSteps.forEach((s, i) => s.order = i);

    area.innerHTML = WorkflowState.tempTplSteps.map((step, index) => `
        <tr>
            <td class="text-center">
                <button type="button" class="btn-delete-row" style="color: #ef4444; font-size: 1rem;" onclick="window.removeStepFromTemplate(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </td>

            <td>
                <div class="position-relative w-100">
                    <input type="text"
                        class="form-control workflow-select-ghost w-100"
                        value="${escapeHtml(step.user || '')}"
                        placeholder="Personel..."
                        onkeyup="window.searchPersonnelForTemplate(this.value, 'step', ${index})">
                    
                    <div id="tplStepResults_${index}" class="search-results-popover"></div>
                </div>
            </td>

            <td>
                <select class="form-select workflow-select-ghost w-100"
                    onchange="WorkflowState.tempTplSteps[${index}].tip = this.value">

                    ${[
            "Paraf",
            "E-İmza & Mobil İmza",
            "Olur (Islak)",
            "Olur (E-İmza)",
            "Islak İmza"
        ].map(t => `
                        <option value="${escapeHtml(t)}" ${step.tip === t ? 'selected' : ''}>${escapeHtml(t)}</option>
                    `).join('')}
                </select>
            </td>

            <td class="text-center">
                <i class="fas fa-bars" style="cursor:grab;"></i>
            </td>
        </tr>
    `).join('');
};

window.searchPersonnelForTemplate = function (query, type, stepIndex = null) {
    const resultsId = type === 'auth' ? 'tplAuthResults' : `tplStepResults_${stepIndex}`;
    const resDiv = document.getElementById(resultsId);
    if (!resDiv) return;

    // [BUGFIX] Bug 2 (UI): Prevent search dropdown hover/blur glitch
    // [WHY]: The dropdown closes too fast on input blur, blocking mouse clicks from registering.
    // [HOW]: Track hover state on the dropdown container, and defer hiding on input blur
    //        using setTimeout, keeping it open if the user's cursor is currently inside.
    const inputEl = type === 'auth'
        ? document.getElementById('tplAuthSearch')
        : document.querySelector(`input[onkeyup*="window.searchPersonnelForTemplate(this.value, 'step', ${stepIndex})"]`);

    if (resDiv && !resDiv.dataset.hoverWired) {
        resDiv.dataset.hoverWired = "true";
        resDiv.dataset.isHovered = "false";

        resDiv.addEventListener('mouseenter', () => {
            resDiv.dataset.isHovered = "true";
        });

        resDiv.addEventListener('mouseleave', () => {
            resDiv.dataset.isHovered = "false";
            // If input is not focused anymore, we can close the dropdown safely
            if (document.activeElement !== inputEl) {
                resDiv.style.display = 'none';
            }
        });
    }

    if (inputEl && !inputEl.dataset.blurWired) {
        inputEl.dataset.blurWired = "true";
        inputEl.addEventListener('blur', () => {
            setTimeout(() => {
                if (resDiv.dataset.isHovered !== "true") {
                    resDiv.style.display = 'none';
                }
            }, 200);
        });
    }

    if (!query || query.length < 2) {
        resDiv.style.display = 'none';
        return;
    }

    const allP = window.data.personel || window.data.staff || [];
    const filtered = allP.filter(p => {
        const name = (p.adSoyad || p.ad || p.name || "").toLocaleLowerCase('tr-TR');
        return name.includes(query.toLocaleLowerCase('tr-TR'));
    });

    if (filtered.length > 0) {
        resDiv.innerHTML = filtered.map(p => {
            const name = p.adSoyad || p.ad || p.name || "İsimsiz";
            return `<div class="p-3 border-bottom search-item-modern" data-action="addPersonnel" data-name="${escapeHtml(name)}" data-type="${escapeHtml(type)}" data-step="${escapeHtml(stepIndex)}">
                <div class="d-flex align-items-center justify-content-between">
                    <div class="d-flex align-items-center gap-2">
                        <div class="avatar-mini shadow-sm">${escapeHtml(name.charAt(0))}</div>
                        <span class="fw-bold text-dark" style="font-size:0.85rem;">${escapeHtml(name)}</span>
                    </div>
                    <i class="fas fa-plus-circle text-primary opacity-50"></i>
                </div>
            </div>`;
        }).join('');
        // Faz 4 · J2: personel adı onclick'e kaçışsız gömülüyordu → data-* + tek dinleyici.
        window.bindActions(resDiv, {
            addPersonnel: el => window.addPersonnelToTemplate(el.dataset.name, el.dataset.type, el.dataset.step === '' ? undefined : Number(el.dataset.step)),
        });
        resDiv.style.display = 'block';
    } else {
        resDiv.innerHTML = '<div class="p-3 text-center text-danger fw-bold" style="font-size:0.8rem;"><i class="fas fa-exclamation-circle me-1"></i> Sonuç Bulunamadı</div>';
        resDiv.style.display = 'block';
    }
};

// =============================================================================
// PHASE 1: ENHANCED STATE MACHINE - EBYS SEVİYESİ WORKFLOW ENGINE
// =============================================================================

// Workflow state management - Tek state machine approach
window.WorkflowEngine = {
    // State tanımlamaları - EBYS seviyesi state'ler
    states: {
        INITIATION: 'initiation',
        MANAGER_APPROVAL: 'manager_approval',
        HR_APPROVAL: 'hr_approval',
        FINANCE_APPROVAL: 'finance_approval',
        DIRECTOR_APPROVAL: 'director_approval',
        COMPLETED: 'completed',
        CANCELLED: 'cancelled',
        SUSPENDED: 'suspended'
    },

    // State geçiş kuralları
    // [WHY]: Hiçbir aktif durumdan 'suspended'a geçiş yoktu; stopWorkflow her zaman 'Geçersiz state geçişi' ile düşüyordu (EBYS-13).
    transitions: {
        'initiation': ['manager_approval', 'completed', 'cancelled', 'suspended'],
        'manager_approval': ['hr_approval', 'finance_approval', 'completed', 'cancelled', 'initiation', 'suspended'],
        'hr_approval': ['finance_approval', 'director_approval', 'completed', 'cancelled', 'manager_approval', 'suspended'],
        'finance_approval': ['director_approval', 'completed', 'cancelled', 'manager_approval', 'suspended'],
        'director_approval': ['completed', 'cancelled', 'finance_approval', 'suspended'],
        'completed': ['initiation'],
        'cancelled': ['initiation'],
        'suspended': ['initiation', 'cancelled', 'manager_approval']
    },

    // Rol bazlı yetki matrisi
    permissions: {
        'admin': ['*'], // Full access
        'manager': ['initiation', 'manager_approval', 'view'],
        'hr': ['hr_approval', 'view'],
        'finance': ['finance_approval', 'view'],
        'director': ['director_approval', 'view']
    }
};

// Enhanced workflow instance creator - Backward compatibility ile
window.createWorkflowFromTemplate = function (tpl) {
    const workflowId = 'workflow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Parallel adımları işle
    const processedSteps = [];
    const parallelConfigs = [];
    let stepIndex = 0;

    (tpl.steps || []).forEach((s, originalIndex) => {
        if (s.parallelGroup) {
            // Parallel adım ise
            const existingConfig = parallelConfigs.find(pc => pc.groupId === s.parallelGroup);

            if (existingConfig) {
                // Mevcut parallel gruba ekle
                existingConfig.states.push({
                    state: window.WorkflowEngine.states[s.state?.toUpperCase()] || window.WorkflowEngine.states.MANAGER_APPROVAL,
                    actor: s.user,
                    requiredRole: s.requiredRole || 'manager',
                    note: s.note || '',
                    order: s.order
                });
            } else {
                // Yeni parallel grup oluştur
                const parallelConfig = {
                    groupId: s.parallelGroup,
                    type: s.parallelType || window.ParallelWorkflowEngine.PARALLEL_TYPES.AND,
                    states: [{
                        state: window.WorkflowEngine.states[s.state?.toUpperCase()] || window.WorkflowEngine.states.MANAGER_APPROVAL,
                        actor: s.user,
                        requiredRole: s.requiredRole || 'manager',
                        note: s.note || '',
                        order: s.order
                    }],
                    requiredApprovals: s.requiredApprovals || 1
                };
                parallelConfigs.push(parallelConfig);
            }
        } else {
            // Normal adım ise
            processedSteps.push({
                id: 'step_' + stepIndex++,
                user: s.user,
                userUid: window.Ownership ? window.Ownership.uidForPersonName(s.user) : null,   // J9: akış başlarken güncel personelden
                tip: s.tip,
                order: s.order,
                status: "pending",
                note: "",
                date: "",
                // Enhanced step properties
                state: window.WorkflowEngine.states[s.state?.toUpperCase()] || window.WorkflowEngine.states.MANAGER_APPROVAL,
                requiredRole: s.requiredRole || 'manager',
                parallelGroup: s.parallelGroup || null
            });
        }
    });

    return {
        // Yeni enhanced state machine fields
        id: workflowId,
        templateId: tpl.id || null,
        status: 'active', // active, completed, cancelled, suspended
        currentState: window.WorkflowEngine.states.INITIATION,

        // Backward compatibility - Eski sistem devam etsin
        started: true,
        currentStep: 0,
        finished: false,

        // Enhanced history tracking - Detaylı geçmiş
        history: [
            {
                id: 'hist_' + Date.now(),
                from: null,
                to: window.WorkflowEngine.states.INITIATION,
                actor: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'system',
                uid: window.userAuth?.uid || '',   // J11.5
                timestamp: new Date().toISOString(),
                action: 'create',
                note: 'Workflow başlatıldı',
                metadata: {
                    templateId: tpl.id,
                    templateName: tpl.name,
                    hasParallelSteps: parallelConfigs.length > 0
                }
            }
        ],

        // Parallel processing configurasyonları
        parallelConfigs: parallelConfigs,
        parallelStates: [], // Runtime'da doldurulacak
        parallelSteps: [], // Runtime'da doldurulacak

        // Permission matrix - Template bazlı yetkiler
        permissions: {
            ...window.WorkflowEngine.permissions,
            ...(tpl.permissions || {})
        },

        // Original steps - Backward compatibility
        steps: processedSteps,

        // Workflow metadata
        metadata: {
            createdAt: new Date().toISOString(),
            createdBy: window.currentUser?.name || 'system',
            templateName: tpl.name,
            version: '2.1', // Enhanced with parallel support
            hasParallelSteps: parallelConfigs.length > 0,
            parallelGroupsCount: parallelConfigs.length
        }
    };
};

// State transition engine - Tek state management
// options.persist=false: çağıran (approveStep/rejectStep) talebi tek seferde kaydeder. Ara kayıt, dönen snapshot'ın
// window.data.purchaseOrders'ı yenilemesine ve çağıranın sonraki değişikliklerinin bayat nesnede kaybolmasına yol açıyordu.
window.transitionWorkflowState = async function (workflowId, targetState, actor, note = '', options = {}) {
    const workflow = await window.getWorkflow(workflowId);
    if (!workflow) {
        throw new Error('Workflow bulunamadı: ' + workflowId);
    }

    // Permission check
    if (!window.hasWorkflowPermission(workflow, targetState, actor)) {
        throw new Error('Yetkisiz işlem: ' + actor + ' -> ' + targetState);
    }

    // State transition validation
    const validTransitions = window.WorkflowEngine.transitions[workflow.currentState] || [];
    if (!validTransitions.includes(targetState)) {
        throw new Error('Geçersiz state geçişi: ' + workflow.currentState + ' -> ' + targetState);
    }

    // Create transition record
    const transition = {
        id: 'trans_' + Date.now(),
        from: workflow.currentState,
        to: targetState,
        actor: actor,
        uid: window.userAuth?.uid || '',   // J11 · P1 #5: kurallar onay/red kaydında request.auth.uid ile eşler
        timestamp: new Date().toISOString(),
        action: 'transition',
        note: note,
        metadata: {
            userAgent: navigator.userAgent
        }
    };

    // Update workflow state
    workflow.currentState = targetState;
    workflow.history.push(transition);

    // Update backward compatibility fields
    window.updateBackwardCompatibility(workflow, targetState);

    // Save to Firebase (purchaseOrders); başarısızlık onayı "başarılı" gösterilmesin diye hata olarak yükselir
    if (options.persist !== false && !(await window.saveWorkflow(workflow))) {
        throw new Error('Akış durumu kaydedilemedi.');
    }

    // Trigger events
    window.onWorkflowStateChanged(workflow, transition);

    return transition;
};

// Permission check system
window.hasWorkflowPermission = function (workflow, state, actor) {
    const userRole = window.getUserRole(actor);
    const permissions = workflow.permissions || window.WorkflowEngine.permissions;

    // Admin full access
    if (permissions.admin?.includes('*') || userRole === 'admin') {
        return true;
    }

    // State bazlı yetki kontrolü
    const statePermissions = permissions[state] || [];
    return statePermissions.includes(userRole) || statePermissions.includes('*');
};

// Backward compatibility updater
window.updateBackwardCompatibility = function (workflow, newState) {
    // Eğer step-based bir akışsa ve currentStep zaten ilerlemişse müdahale etme
    const stateOrder = [
        window.WorkflowEngine.states.INITIATION,
        window.WorkflowEngine.states.MANAGER_APPROVAL,
        window.WorkflowEngine.states.HR_APPROVAL,
        window.WorkflowEngine.states.FINANCE_APPROVAL,
        window.WorkflowEngine.states.DIRECTOR_APPROVAL
    ];

    const newIdx = stateOrder.indexOf(newState);

    // Sadece mevcut indeks yeni indeksten küçükse veya geçersizse güncelle
    if (newIdx !== -1 && (workflow.currentStep === undefined || workflow.currentStep < newIdx)) {
        workflow.currentStep = newIdx;
    }

    workflow.finished = newState === window.WorkflowEngine.states.COMPLETED;
    workflow.started = true;
};

// Event handler for state changes
window.onWorkflowStateChanged = function (workflow, transition) {
    console.log('🔄 State değişti:', transition);

    // UI güncellemeleri
    if (typeof refreshUI === 'function') {
        refreshUI();
    }

    // Notification sistemi
    if (typeof showNotification === 'function') {
        showNotification(`Workflow state değişti: ${transition.from} → ${transition.to}`, 'info');
    }
};

// =============================================================================
// HELPER FUNCTIONS - WORKFLOW MANAGEMENT
// =============================================================================

// Kullanıcı rolünü getir - Phase 1 yetki sistemi için gerekli
window.getUserRole = function (username) {
    if (!username) return 'guest';

    // Personel listesinde rol bilgisini ara
    const personel = (window.data.personel || []).find(p =>
        (p.adSoyad || p.ad || p.name) === username
    );

    return personel?.role || personel?.rol || 'user'; // Default rol
};

// [WHY]: Akış kök 'workflows' koleksiyonunda da tutuluyordu; kurallar orayı reddettiği için her geçiş hata
//        verip purchaseOrders kaydı hiç yapılmıyordu (EBYS-16). Tek kaynak: ${COLLECTION_ROOT}/purchaseOrders içindeki item.workflow.
window.getWorkflow = async function (workflowId) {
    // EBYS-17: id'siz eski akışlarda getWorkflow(undefined) id'si olmayan İLK akışı (başka bir talebi) buluyordu.
    if (workflowId === undefined || workflowId === null || workflowId === '') return null;
    const purchaseOrder = (window.data.purchaseOrders || []).find(item => item.workflow?.id === workflowId);
    return purchaseOrder ? purchaseOrder.workflow : null;
};

window.saveWorkflow = async function (workflow) {
    const purchaseOrder = (window.data.purchaseOrders || []).find(item => item.workflow?.id === workflow.id);
    if (!purchaseOrder) {
        console.error('❌ Workflow kaydı: bağlı satın alma talebi bulunamadı:', workflow.id);
        return false;
    }
    purchaseOrder.workflow = workflow;
    const saved = await window.writeOk(window.upsertItem('purchaseOrders', purchaseOrder));
    if (saved === false) console.error('❌ Workflow kaydedilemedi:', workflow.id);
    return saved !== false;
};

// [WHY]: Her geçişte kullanıcının IP'si api.ipify.org'a sorulup herkesin okuyabildiği geçmişe yazılıyordu;
//        zaman aşımı yoktu ve ipify'ı engelleyen ağlarda onay takılıyordu (SEC-04). IP artık toplanmıyor.

// Workflow geçmişini formatla - UI için
window.formatWorkflowHistory = function (workflow) {
    const history = workflow.history || [];

    return history.map(entry => {
        const date = new Date(entry.timestamp);
        const formattedDate = date.toLocaleString('tr-TR');

        // State renkleri
        const stateColors = {
            'initiation': '#e3f2fd',
            'manager_approval': '#f3e5f5',
            'hr_approval': '#e8f5e8',
            'finance_approval': '#fff3e0',
            'director_approval': '#fce4ec',
            'completed': '#e8f5e8',
            'cancelled': '#ffebee'
        };

        return {
            ...entry,
            formattedDate: formattedDate,
            stateColor: stateColors[entry.to] || '#f5f5f5',
            stateLabel: window.getStateLabel(entry.to)
        };
    });
};

// State label'ını Türkçe olarak getir
window.getStateLabel = function (state) {
    const labels = {
        'initiation': 'Başlangıç',
        'manager_approval': 'Yönetici Onayı',
        'hr_approval': 'Paraf',
        'finance_approval': 'Finans Onayı',
        'director_approval': 'Direktör Onayı',
        'completed': 'Tamamlandı',
        'cancelled': 'İptal Edildi',
        'suspended': 'Askıya Alındı'
    };

    return labels[state] || state;
};

// Workflow durumunu kontrol et - Aktif mi, tamamlanmış mi?
window.getWorkflowStatus = function (workflow) {
    if (workflow.currentState === window.WorkflowEngine.states.COMPLETED) {
        return { status: 'completed', label: 'Tamamlandı', color: '#4caf50' };
    }

    if (workflow.currentState === window.WorkflowEngine.states.CANCELLED) {
        return { status: 'cancelled', label: 'İptal Edildi', color: '#f44336' };
    }

    if (workflow.currentState === window.WorkflowEngine.states.SUSPENDED) {
        return { status: 'suspended', label: 'Askıya Alındı', color: '#ff9800' };
    }

    return { status: 'active', label: 'Aktif', color: '#2196f3' };
};

// =============================================================================
// PHASE 2: PARALLEL PROCESSING ENGINE - EBYS SEVİYESİ PARALEL İMZALAR
// =============================================================================

// Parallel workflow engine - Aynı anda birden fazla onay
window.ParallelWorkflowEngine = {
    // Parallel state tipleri
    PARALLEL_TYPES: {
        AND: 'AND', // Tüm adımlar tamamlanmalı
        OR: 'OR',   // Herhangi bir adım tamamlanabilir
        MAJORITY: 'MAJORITY' // Çoğunluk tamamlanmalı
    },

    // Parallel state oluştur
    createParallelState: function (workflowId, config) {
        const parallelId = 'parallel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        return {
            id: parallelId,
            workflowId: workflowId,
            type: config.type || this.PARALLEL_TYPES.AND,
            states: config.states || [],
            requiredApprovals: config.requiredApprovals || config.states.length,
            currentApprovals: 0,
            status: 'active', // active, completed, cancelled
            createdAt: new Date().toISOString(),
            completedAt: null,
            approvals: [], // Kim ne zaman onayladı
            metadata: config.metadata || {}
        };
    },

    // Parallel adım çalıştır
    executeParallelStep: async function (workflow, parallelConfig) {
        const { type, states, requiredApprovals, parallelGroup } = parallelConfig;

        console.log(`🔄 Parallel adım başlatılıyor: ${type}`, { states, requiredApprovals });

        // Parallel state oluştur
        const parallelState = this.createParallelState(workflow.id, parallelConfig);

        // Workflow'a parallel state ekle
        if (!workflow.parallelStates) {
            workflow.parallelStates = [];
        }
        workflow.parallelStates.push(parallelState);

        // Her bir state için individual workflow adımları oluştur
        for (let i = 0; i < states.length; i++) {
            const stateConfig = states[i];

            // State geçişi yap
            await window.transitionWorkflowState(
                workflow.id,
                stateConfig.state,
                stateConfig.actor || window.currentUser?.name,
                `Parallel adım başlatıldı: ${window.getStateLabel(stateConfig.state)}`
            );

            // Adım detayını kaydet
            const stepDetail = {
                id: `parallel_step_${parallelState.id}_${i}`,
                parallelId: parallelState.id,
                state: stateConfig.state,
                actor: stateConfig.actor,
                requiredRole: stateConfig.requiredRole,
                status: 'pending',
                createdAt: new Date().toISOString(),
                completedAt: null,
                note: stateConfig.note || ''
            };

            // Workflow'a parallel step ekle
            if (!workflow.parallelSteps) {
                workflow.parallelSteps = [];
            }
            workflow.parallelSteps.push(stepDetail);
        }

        // Workflow'u kaydet
        await window.saveWorkflow(workflow);

        return parallelState;
    },

    // Parallel onay işle
    processParallelApproval: async function (workflowId, stepId, actor, note = '') {
        const workflow = await window.getWorkflow(workflowId);
        if (!workflow) {
            throw new Error('Workflow bulunamadı');
        }

        // Parallel step'i bul
        const step = workflow.parallelSteps?.find(s => s.id === stepId);
        if (!step) {
            throw new Error('Parallel step bulunamadı');
        }

        // Parallel state'i bul
        const parallelState = workflow.parallelStates?.find(p => p.id === step.parallelId);
        if (!parallelState) {
            throw new Error('Parallel state bulunamadı');
        }

        // Step'i tamamla
        step.status = 'approved';
        step.completedAt = new Date().toISOString();
        step.note = note;

        // Parallel state'e approval ekle
        parallelState.approvals.push({
            stepId: stepId,
            actor: actor,
            timestamp: new Date().toISOString(),
            note: note
        });

        parallelState.currentApprovals++;

        // Parallel state durumunu kontrol et
        const isCompleted = this.checkParallelCompletion(parallelState, workflow);

        if (isCompleted) {
            parallelState.status = 'completed';
            parallelState.completedAt = new Date().toISOString();

            // Sonraki state'e geç
            const nextState = this.getNextStateAfterParallel(workflow, parallelState);
            if (nextState) {
                await window.transitionWorkflowState(
                    workflow.id,
                    nextState,
                    actor,
                    `Parallel onay tamamlandı: ${parallelState.type}`
                );
            }
        }

        // Workflow'u kaydet
        await window.saveWorkflow(workflow);

        // Event tetikle
        window.onParallelStepCompleted(workflow, step, parallelState);

        return { step, parallelState, isCompleted };
    },

    // Parallel tamamlanma kontrolü
    checkParallelCompletion: function (parallelState, workflow) {
        const { type, requiredApprovals, currentApprovals } = parallelState;

        switch (type) {
            case this.PARALLEL_TYPES.AND:
                return currentApprovals >= requiredApprovals;

            case this.PARALLEL_TYPES.OR:
                return currentApprovals >= 1;

            case this.PARALLEL_TYPES.MAJORITY:
                const totalSteps = workflow.parallelSteps?.filter(s => s.parallelId === parallelState.id).length || 0;
                const majority = Math.ceil(totalSteps / 2);
                return currentApprovals >= majority;

            default:
                return currentApprovals >= requiredApprovals;
        }
    },

    // Parallel sonrası sonraki state'i bul
    getNextStateAfterParallel: function (workflow, completedParallelState) {
        // Workflow'un state geçiş kurallarına göre sonraki state'i bul
        const currentState = workflow.currentState;
        const validTransitions = window.WorkflowEngine.transitions[currentState] || [];

        // Basit ilerleme - bir sonraki state'e geç
        const stateOrder = [
            window.WorkflowEngine.states.INITIATION,
            window.WorkflowEngine.states.MANAGER_APPROVAL,
            window.WorkflowEngine.states.HR_APPROVAL,
            window.WorkflowEngine.states.FINANCE_APPROVAL,
            window.WorkflowEngine.states.DIRECTOR_APPROVAL,
            window.WorkflowEngine.states.COMPLETED
        ];

        const currentIndex = stateOrder.indexOf(currentState);
        return currentIndex < stateOrder.length - 1 ? stateOrder[currentIndex + 1] : null;
    },

    // Parallel durumu iptal et
    cancelParallelState: async function (workflowId, parallelId, actor, reason) {
        const workflow = await window.getWorkflow(workflowId);
        if (!workflow) return;

        const parallelState = workflow.parallelStates?.find(p => p.id === parallelId);
        if (!parallelState) return;

        parallelState.status = 'cancelled';
        parallelState.completedAt = new Date().toISOString();

        // İlişkili tüm step'leri iptal et
        workflow.parallelSteps?.forEach(step => {
            if (step.parallelId === parallelId && step.status === 'pending') {
                step.status = 'cancelled';
                step.completedAt = new Date().toISOString();
                step.note = `Parallel iptal: ${reason}`;
            }
        });

        // State geçişi yap
        await window.transitionWorkflowState(
            workflow.id,
            window.WorkflowEngine.states.CANCELLED,
            actor,
            `Parallel akış iptal edildi: ${reason}`
        );

        await window.saveWorkflow(workflow);

        return parallelState;
    }
};

// Parallel step tamamlandığında event handler
window.onParallelStepCompleted = function (workflow, step, parallelState) {
    console.log('✅ Parallel step tamamlandı:', {
        step: step.id,
        parallelState: parallelState.id,
        approvals: parallelState.currentApprovals,
        required: parallelState.requiredApprovals
    });

    // UI güncellemeleri
    if (typeof refreshUI === 'function') {
        refreshUI();
    }

    // Notification
    if (typeof showAppAlert === 'function') {
        const remaining = parallelState.requiredApprovals - parallelState.currentApprovals;
        if (remaining > 0) {
            showAppAlert(
                `Onay verildi. ${remaining} adet daha onay gerekiyor.`,
                'info'
            );
        } else {
            showAppAlert(
                'Parallel onay süreci tamamlandı!',
                'success'
            );
        }
    }
};

window.addPersonnelToTemplate = function (name, type, stepIndex) {
    if (type === 'auth') {
        if (!WorkflowState.tempTplAuth.includes(name)) WorkflowState.tempTplAuth.push(name);
        document.getElementById('tplAuthSearch').value = "";
        document.getElementById('tplAuthResults').style.display = 'none';
        window.renderTemplateAuth();
    } else {
        WorkflowState.tempTplSteps[stepIndex].user = name;
        document.getElementById(`tplStepResults_${stepIndex}`).style.display = 'none';
        window.renderTemplateSteps();
    }
};

window.renderTemplateAuth = function () {
    const list = document.getElementById('tplAuthList');
    if (!list) return;
    list.innerHTML = WorkflowState.tempTplAuth.map((name, index) => `
        <span class="personnel-tag-premium">
            <i class="fas fa-user-shield me-1"></i>
            <span>${escapeHtml(name)}</span>
            <i class="fas fa-times-circle ms-2 delete-icon" onclick="WorkflowState.tempTplAuth.splice(${index},1); window.renderTemplateAuth();"></i>
        </span>
    `).join('');
};

// ✅ ŞABLONLARI TABLOYA BASAN ANA FONKSİYON
window.renderTemplateList = function () {
    const tbody = document.getElementById('templateTableBody');
    const defTbody = document.getElementById('adminDefTemplateTableBody');
    if (!tbody && !defTbody) return;

    // window.templates dizisindeki verileri kullanıyoruz
    const templates = window.templates || [];
    const html = templates.length === 0
        ? '<tr><td colspan="4" class="text-center p-4 text-muted">Henüz şablon tanımlanmadı.</td></tr>'
        : templates.map(tpl => `
        <tr>
            <td><strong>${escapeHtml(tpl.name)}</strong></td>
            <td>
                <span class="badge bg-secondary" style="border-radius:12px; padding: 5px 12px;">
                    ${tpl.steps?.length || 0} Adım
                </span>
            </td>
            <td>
                <small class="text-muted">
                    ${escapeHtml((tpl.auth && tpl.auth.length > 0) ? tpl.auth.join(', ') : 'Herkes')}
                </small>
            </td>
            <td class="text-end pe-3">
                <div class="action-buttons justify-content-end">
                    <button onclick="window.openTemplateModal(${jsArg(String(tpl.id))})" 
                            class="btn-action btn-buy shadow-sm" title="Düzenle">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="window.deleteTemplate(${jsArg(String(tpl.id))})" 
                            class="btn-action btn-passive shadow-sm" title="Sil">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    if (tbody) tbody.innerHTML = html;
    if (defTbody) defTbody.innerHTML = html;
};

// [BUGFIX] Bug 2: saveTemplateData permission guard.
// [WHY]: The 'workflowTemplates' collection sits at the Firestore root. Only admin-level
//        users have write access. Non-admins receive an opaque permission-denied error.
// [HOW]: We add an early guard to check admin status before attempting the write, and
//        surface a descriptive alert instead of silently failing.
window.saveTemplateData = async function () {
    const nameInput = document.getElementById("tplName");
    const name = nameInput ? nameInput.value.trim() : "";

    if (!name) { alert("Şablon adı giriniz"); return; }
    if (!WorkflowState.tempTplSteps || WorkflowState.tempTplSteps.length === 0) {
        alert("En az 1 adım eklemelisiniz");
        return;
    }
    if (WorkflowState.tempTplSteps.length > 10) { alert("Bir şablonda en fazla 10 onay adımı olabilir."); return; }   // J10: kural sınırı

    // [BUGFIX] Bug 2: Admin guard — workflowTemplates is a root collection with admin-only write rules.
    // Faz 4 · J1: yetki localStorage bayrağıyla değil Firebase admin oturumuyla (bayrak elle yazılabiliyordu).
    const isAdmin = typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    if (!isAdmin) {
        if (typeof showAppAlert === 'function') {
            showAppAlert("⛔ Şablon kaydetme yetkisi yok. Yalnızca Admin kullanıcılar şablon oluşturabilir.", "error");
        } else {
            alert("⛔ Şablon kaydetme yetkisi yok. Yalnızca Admin kullanıcılar şablon oluşturabilir.");
        }
        return;
    }

    try {
        const db = getFirestore();
        // ID yoksa yeni oluştur, varsa mevcutu kullan (Düzenleme modu için)
        const id = WorkflowState.currentEditingTemplateId || "tpl_" + Date.now();

        // Faz 4B · J9: adım onaylayıcısının Auth uid'si (adı TEK bir personeli işaret ediyorsa); belirsiz / hesapsız / sistem → null
        const steps = WorkflowState.tempTplSteps.map(s => ({ ...s, userUid: window.Ownership.uidForPersonName(s.user) }));
        const unresolved = steps.filter(s => !s.userUid).length;
        if (unresolved && typeof showAppAlert === 'function') {
            showAppAlert(`Not: ${unresolved} adımın onaylayıcısı için giriş hesabı bulunamadı (hesap yok ya da ad birden fazla personelde). Şablon kaydedilir; bu adımlar hesapla eşleşmez.`, 'warning');
        }
        const templateData = {
            id: id,
            name: name,
            steps,
            auth: WorkflowState.tempTplAuth || [],
            createdAt: Date.now()
        };

        // 🔥 FIRESTORE SAVE: Bu işlem bittiğinde onSnapshot otomatik olarak tabloyu güncelleyecektir.
        // [BUGFIX]: Env-guard and Zero-Trust path alignment
        // [WHY]: Firestore rules deny writing to root collections. Workflow templates must reside under COLLECTION_ROOT/workflowTemplates/items.
        // [HOW]: Write to doc under window.AppEnv.COLLECTION_ROOT subcollection structure.
        const activeRoot = window.AppEnv?.COLLECTION_ROOT || window.COLLECTION_ROOT || "lifeserver_master";
        await setDoc(doc(db, activeRoot, "workflowTemplates", "items", id), templateData);

        console.log("✅ Şablon Firestore'a başarıyla gönderildi.");

        // Modal temizliği ve kapatma
        WorkflowState.currentEditingTemplateId = null;
        window.closeTemplateModal();

    } catch (err) {
        console.error("❌ Şablon kaydedilemedi:", err);
        // [BUGFIX] Bug 2: Surface permission-denied errors clearly.
        if (err.code === 'permission-denied') {
            if (typeof showAppAlert === 'function') {
                showAppAlert("⛔ Firestore Erişim Reddedildi: Admin oturumunuz süresi dolmuş olabilir. Çıkış yapıp tekrar giriş yapın.", "error");
            } else {
                alert("⛔ Firestore Erişim Reddedildi: Admin oturumunuz süresi dolmuş olabilir.");
            }
        } else {
            alert("Kaydetme hatası: " + err.message);
        }
    }
};

window.renderWorkflowTemplates = function () {
    // Bu fonksiyon renderTemplateList ile aynı işi yapacak şekilde güncellendi
    window.renderTemplateList();
};

window.deleteWorkflowTemplate = async function (id) {
    if (!window.requireDbAdmin('Şablon silme')) return;   // Faz 4 · J1: workflowTemplates yalnız admin
    if (!confirm("Bu şablonu silmek istediğinize emin misiniz?")) return;

    try {
        const db = getFirestore();
        const activeRoot = window.AppEnv?.COLLECTION_ROOT || window.COLLECTION_ROOT || "lifeserver_master";

        // [BUGFIX]: Delete template directly from COLLECTION_ROOT subcollection to prevent permission error
        await deleteDoc(doc(db, activeRoot, "workflowTemplates", "items", id));

        if (typeof showAppAlert === 'function') {
            showAppAlert("Şablon başarıyla silindi.", "success");
        }
    } catch (err) {
        console.error("❌ Şablon silinemedi:", err);
        alert("Silme hatası: " + err.message);
    }
};
window.deleteTemplate = window.deleteWorkflowTemplate;

// Faz 5 · K3 (5.7 · ARC-07): showAdminTab'ı sarmalayan eski monkey-patch kaldırıldı; merkezi kanca siciline
// (AppModules.AdminTabs, script.js) kaydolunuyor — admin tab değişince render tetiklenir.
window.AppModules.AdminTabs.onShow('workflowTemplatesTab', () => window.renderWorkflowTemplates());
// 👉 modal içinde step’leri göster
window.previewTemplate = function (templateId) {
    const tpl = window.data.workflowTemplates.find(t => t.id === templateId);
    if (!tpl) return;

    window.tempTplSteps = tpl.steps.map(s => ({
        ...s
    }));

    window.renderTemplateSteps();
};

window.handleWorkflowSelection = function (value) {

    if (value === "manual") {
        WorkflowState.isManualMode = true;
        WorkflowState.tempManualSteps = [];
        renderManualSteps();
        renderWorkflowPreview([]);
        return;
    }

    const tpl = window.templates.find(t => t.id === value);
    if (!tpl) return;

    WorkflowState.isManualMode = false;

    WorkflowState.tempManualSteps = JSON.parse(JSON.stringify(tpl.steps));

    renderManualSteps();

    // 🔥 TEMPLATE ADI
    const label = document.getElementById("selectedTemplateName");
    if (label) label.innerText = "Seçili Şablon: " + tpl.name;

    // 🔥 PREVIEW
    renderWorkflowPreview(tpl.steps);
};

window.addManualStep = function () {
    WorkflowState.tempManualSteps.push({
        user: "",
        tip: "Paraf",
        status: "pending",
        note: "",
        date: ""
    });

    window.renderManualSteps();
};
// PREVIEW RENDER FONKSİYONU
window.renderWorkflowPreview = function (steps) {

    const container = document.getElementById("workflowPreview");
    if (!container) return;

    if (!steps || !steps.length) {
        container.innerHTML = "<i>Adım yok</i>";
        return;
    }

    container.innerHTML = steps.map((s, i) => `
        <div style="padding:4px 0; color:var(--color-text);">
            <b>${i + 1}.</b> ${escapeHtml(s.user || "-")}
            <span style="color:var(--color-text-muted);">(${escapeHtml(s.type || "onay")})</span>
        </div>
    `).join("");
};

// =============================================================================
// PHASE 3: ROLLBACK & AUDIT MECHANISM - EBYS SEVİYESİ GERİ ALMA
// =============================================================================

// Rollback manager - Workflow'u önceki durumlara geri al
window.WorkflowRollbackManager = {
    // Checkpoint oluştur - Workflow snapshot
    createCheckpoint: async function (workflowId, reason, actor) {
        const workflow = await window.getWorkflow(workflowId);
        if (!workflow) {
            throw new Error('Workflow bulunamadı');
        }

        const checkpoint = {
            id: 'checkpoint_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            workflowId: workflowId,
            timestamp: new Date().toISOString(),
            actor: actor || window.currentUser?.name || 'system',
            reason: reason || 'Manual checkpoint',

            // Workflow snapshot - Deep copy
            snapshot: JSON.parse(JSON.stringify({
                currentState: workflow.currentState,
                currentStep: workflow.currentStep,
                finished: workflow.finished,
                status: workflow.status,
                steps: workflow.steps,
                parallelStates: workflow.parallelStates,
                parallelSteps: workflow.parallelSteps,
                history: workflow.history
            })),

            // Metadata
            metadata: {
                userAgent: navigator.userAgent,
                stateLabel: window.getStateLabel(workflow.currentState),
                stepCount: workflow.steps?.length || 0,
                hasParallelSteps: (workflow.parallelStates?.length || 0) > 0
            }
        };

        // Checkpoint'i workflow'a ekle
        if (!workflow.checkpoints) {
            workflow.checkpoints = [];
        }
        workflow.checkpoints.push(checkpoint);

        // History'e checkpoint kaydı ekle
        workflow.history.push({
            id: 'hist_' + Date.now(),
            from: workflow.currentState,
            to: workflow.currentState, // Same state - checkpoint
            actor: actor,
            timestamp: checkpoint.timestamp,
            action: 'checkpoint',
            note: `Checkpoint oluşturuldu: ${reason}`,
            metadata: {
                checkpointId: checkpoint.id,
                reason: reason
            }
        });

        // Workflow'u kaydet
        await window.saveWorkflow(workflow);

        console.log('✅ Checkpoint oluşturuldu:', checkpoint.id);
        return checkpoint;
    },

    // Workflow'u rollback yap
    rollback: async function (workflowId, targetCheckpointId, reason, actor) {
        const workflow = await window.getWorkflow(workflowId);
        if (!workflow) {
            throw new Error('Workflow bulunamadı');
        }

        // Checkpoint'i bul
        const checkpoint = workflow.checkpoints?.find(cp => cp.id === targetCheckpointId);
        if (!checkpoint) {
            throw new Error('Checkpoint bulunamadı: ' + targetCheckpointId);
        }

        // Permission check
        if (!window.hasWorkflowPermission(workflow, workflow.currentState, actor)) {
            throw new Error('Rollback yetkisiz: ' + actor);
        }

        // Rollback record oluştur
        const rollbackRecord = {
            id: 'rollback_' + Date.now(),
            from: workflow.currentState,
            to: checkpoint.snapshot.currentState,
            actor: actor || window.currentUser?.name || 'system',
            timestamp: new Date().toISOString(),
            action: 'rollback',
            note: `Rollback: ${reason}`,
            metadata: {
                checkpointId: targetCheckpointId,
                checkpointReason: checkpoint.reason,
                checkpointTimestamp: checkpoint.timestamp,
                userAgent: navigator.userAgent
            }
        };

        // Workflow state'ini checkpoint'e geri al
        const previousState = workflow.currentState;
        Object.assign(workflow, checkpoint.snapshot);

        // Yeni ID'leri koru
        workflow.id = workflowId;
        workflow.templateId = workflow.templateId;

        // History'e rollback kaydı ekle
        workflow.history.push(rollbackRecord);

        // Checkpoint'e rollback metadata ekle
        checkpoint.rollbackCount = (checkpoint.rollbackCount || 0) + 1;
        checkpoint.lastRollbackAt = rollbackRecord.timestamp;
        checkpoint.lastRollbackBy = actor;

        // Workflow'u kaydet
        await window.saveWorkflow(workflow);

        // Event tetikle
        window.onWorkflowRollback(workflow, rollbackRecord, checkpoint);

        console.log('🔄 Rollback yapıldı:', {
            from: previousState,
            to: checkpoint.snapshot.currentState,
            checkpointId: targetCheckpointId
        });

        return { workflow, rollbackRecord, checkpoint };
    }
};

// Rollback event handler
window.onWorkflowRollback = function (workflow, rollbackRecord, checkpoint) {
    console.log('🔄 Workflow rollback yapıldı:', {
        from: rollbackRecord.from,
        to: rollbackRecord.to,
        checkpointId: checkpoint.id,
        actor: rollbackRecord.actor
    });

    // UI güncellemeleri
    if (typeof refreshUI === 'function') {
        refreshUI();
    }

    // Notification
    if (typeof showAppAlert === 'function') {
        showAppAlert(
            `Workflow rollback yapıldı: ${window.getStateLabel(rollbackRecord.from)} → ${window.getStateLabel(rollbackRecord.to)}`,
            'warning'
        );
    }
};

// [BRIDGE] AppModules namespace setup - Ensures functions are accessible via window.AppModules.Workflow
// This provides a fallback path for bridge functions in script.js
window.AppModules = window.AppModules || {};
window.AppModules.Workflow = window.AppModules.Workflow || {
    viewWorkflow: typeof viewWorkflow === 'function' ? viewWorkflow : null,
    openTemplateModal: typeof openTemplateModal === 'function' ? openTemplateModal : null,
    startWorkflow: typeof startWorkflow === 'function' ? startWorkflow : null,
    confirmStartWorkflow: typeof confirmStartWorkflow === 'function' ? confirmStartWorkflow : null,
    approveStep: typeof approveStep === 'function' ? approveStep : null,
    rejectStep: typeof rejectStep === 'function' ? rejectStep : null,
    withdrawWorkflow: typeof withdrawWorkflow === 'function' ? withdrawWorkflow : null,
    stopWorkflow: typeof stopWorkflow === 'function' ? stopWorkflow : null
};

