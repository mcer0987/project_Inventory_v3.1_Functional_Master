const PAGE_SIZE = 8;
let currentPurchasePage = 1;

// =========================
// GLOBAL PURCHASE STATE
// =========================
window.purchaseState = {
    page: 1,
    pageSize: 8,
    search: "",
    isAdmin: false
};

// DATA INIT
window.data = window.data || {};
window.data.purchaseOrders = window.data.purchaseOrders || [];
window.data.serviceRecords = window.data.serviceRecords || [];
// 3.9b: servis kaydı depoya dönüşte silinmez, kapanır (kapandi: true) — panel ve sayaçlar yalnız açık kayıtları sayar.
const _openServices = () => (window.data.serviceRecords || []).filter(r => r && r.kapandi !== true);
const _findService = id => (window.data.serviceRecords || []).find(r => r && String(r.id) === String(id));
const _deviceIdOf = r => [r.sn, r.envanterNo].find(v => v && v !== '-' && !String(v).includes(',')) || '';


// -----------------------------
// DOSYA SEÇİMİ İŞLEYİCİSİ
// -----------------------------
window.handlePurchaseFileChange = function (input) {
    const list = document.getElementById('purFileList');
    if (!list) return;

    list.innerHTML = "";
    if (input.files && input.files.length > 0) {
        Array.from(input.files).forEach(file => {
            const tag = document.createElement('div');
            tag.className = 'file-tag-slim';
            tag.innerHTML = `<i class="fas fa-file"></i> ${escapeHtml(file.name)}`;
            list.appendChild(tag);
        });
    }
};
// -----------------------------
// DATA INIT
// -----------------------------
if (!window.data) window.data = {};
if (!window.data.purchaseOrders) window.data.purchaseOrders = [];

// [WHY]: Geri çek / iptal / düzenle / sil / ek sil işlemlerinde kim olduğuna bakılmıyordu; herhangi bir oturum başkasının
//        talebini geri çekebiliyor, iptal edebiliyor veya ekini silebiliyordu; görüntüleme modunda da ek silme açıktı (EBYS-12).
//        İşlemler canlı nesneyi değiştirip kayıt sonucuna bakmadan "başarılı" diyordu; başarısız kayıt yarım hal bırakıyordu.
// [HOW]: Yalnız talebi açan kişi (kod veya ad) ya da Firebase admin oturumu. Değişiklikten önce kopya alınır, başarısız
//        kayıtta geri döndürülür; yazma tek doküman ve birleştirmesiz (upsertItem: eski workflow alt alanları kalmaz, DATA-14).
const _normP = s => String(s || '').trim().toLocaleLowerCase('tr-TR');
function _isPurchaseOwner(item) {
    const me = typeof window.getActiveUser === 'function' ? window.getActiveUser() : window.currentUser;
    if (!me || !item) return false;
    // Faz 4B · J9: sahiplik uid'si varsa önce o (Auth kimliği; ad/id yedekleri eski kayıtlar için)
    if (item.createdByUid && window.userAuth && String(item.createdByUid) === String(window.userAuth.uid)) return true;
    // Faz 4B · J8: oturum giriş kodunu taşımaz; yeni talepler createdBy = personel id, eski talepler (createdBy = kod) ad ile eşleşir
    const by = item.createdBy && item.createdBy !== 'unknown' ? String(item.createdBy) : null;
    if (by && [me.id, me.code].some(v => v != null && v !== '' && String(v) === by)) return true;
    const owner = _normP(item.createdByName || item.talepEden);
    return !!owner && owner === _normP(me.name);
}
function _canManagePurchase(item) {
    return (typeof window.isDbAdmin === 'function' && window.isDbAdmin()) || _isPurchaseOwner(item);
}
window.canManagePurchase = _canManagePurchase;
function _denyManage() {
    if (typeof showAppAlert === 'function') showAppAlert('Bu talep üzerinde işlem yetkiniz yok (yalnız talebi açan kişi veya yönetici).', 'error');
}
function _snapshotPurchase(item) {
    const copy = JSON.parse(JSON.stringify(item));
    return () => { Object.keys(item).forEach(k => delete item[k]); Object.assign(item, copy); };
}
async function _savePurchase(item, undo) {
    const res = await window.writeOk(window.upsertItem('purchaseOrders', item));
    if (res === false && undo) undo();
    return res !== false;
}
const _findPurchase = id => (window.data.purchaseOrders || []).find(x => String(x.id) === String(id));

// EBYS-14: yükleme hatasında "eklersiz (yalnız yüklenenlerle) devam et / iptal" sorusu. null = iptal.
async function _uploadOrAsk(files) {
    try {
        return await window.uploadFiles(files);
    } catch (err) {
        if (err.name !== 'UploadError') throw err;
        const rest = err.uploaded.length ? ` Yüklenebilen ${err.uploaded.length} dosya eklenecek.` : ' Hiçbir dosya eklenmeyecek.';
        const ok = typeof showCustomConfirm === 'function'
            ? await showCustomConfirm('Dosya Yüklenemedi', `${err.message}.${rest} Talep eksik eklerle kaydedilsin mi? (Hayır: hiçbir şey kaydedilmez)`)
            : window.confirm(err.message + '. Eklersiz devam edilsin mi?');
        return ok === true ? err.uploaded : null;
    }
}

// [BUGFIX] Bug 4: Full modal state reset before opening for a new request.
// [WHY]: openPurchaseDetail() mutates form fields, disables inputs, changes purSaveBtn.onclick,
//        and stores dataset.editId. Without a reset, clicking "New Request" re-opens a filled form
//        that would UPDATE an existing record instead of CREATING a new one.
// [HOW]: Mirror the cleanup logic in closePurchaseModal() — re-enable inputs, clear form,
//        delete editId, restore purSaveBtn.onclick to savePurchaseRequest, then populate fresh values.
window.openNewPurchaseModal = function () {
    const modal = document.getElementById('purchaseModal');
    if (!modal) return;

    const form = document.getElementById('purchaseForm');
    const saveBtn = document.getElementById('purSaveBtn');
    const title = document.getElementById('purModalTitle');
    const filesDiv = document.getElementById('purUploadedFilesList');
    const wfDiv = document.getElementById('purWorkflowSection');
    const fileArea = document.getElementById('purFileInputArea');
    const rejectBtn = document.getElementById('purRejectBtn');

    // 1. Re-enable all fields (may have been disabled by openPurchaseDetail 'view' mode)
    if (form) {
        form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = false; });
        form.reset();
        delete form.dataset.editId;
        delete form.dataset.purchaseRecordId;
        form.onsubmit = (e) => window.savePurchaseRequest(e);
    }

    // 2. Reset save button to "New Request" state
    if (saveBtn) {
        saveBtn.style.display = 'block';
        saveBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i> Talebi Kaydet';
        saveBtn.classList.remove('btn-success');
        saveBtn.classList.add('btn-modern-save');
        // [CRITICAL] Override any lingering onclick from openPurchaseDetail's "Onayla" binding
        saveBtn.onclick = null;
    }

    // 3. Reset title
    if (title) title.innerHTML = '<i class="fas fa-file-invoice me-2"></i> Yeni Satın Alma Talebi';

    // 4. Hide injected sections
    if (filesDiv) { filesDiv.style.display = 'none'; filesDiv.innerHTML = ''; }
    if (wfDiv) { wfDiv.style.display = 'none'; wfDiv.innerHTML = ''; }
    if (fileArea) fileArea.style.display = 'block';
    if (rejectBtn) { rejectBtn.style.display = 'none'; rejectBtn.onclick = null; }
    const printBtn = document.getElementById('purPrintBtn');
    if (printBtn) printBtn.style.display = 'none';
    _resetPurchaseFileInputs();

    // 5. Populate fresh auto-generated values
    const now = new Date();
    const docCode =
        `SAT-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const elDoc = document.getElementById('purDocName');
    const elDate = document.getElementById('purDate');
    const elUser = document.getElementById('purUser');
    if (elDoc) elDoc.value = docCode;
    if (elDate) elDate.value = now.toLocaleDateString('tr-TR');
    if (elUser) elUser.value = _purchaseRequester().name || "Bilinmeyen Kullanıcı";

    fillPurchaseSelects();
    window.AppModules.PurchaseItemsUI.open();

    modal.style.display = "block";
};

// [WHY]: Talep eden, yeni talepte ölü initEBYSModal'daki sabit "Muhammed CER" yedeğine düşebiliyor; kayıtta ise elle
//        değiştirilebilen form alanından okunuyordu (EBYS-06).
// [HOW]: Talep eden her zaman oturumdaki aktif kullanıcıdır (getActiveUser → currentUser); form alanı yalnız gösterimdir.
// Faz 4B · J8: createdBy artık personel id'si — giriş kodu herkesin okuduğu satın alma belgesine yazılmaz (J9 uid ekler).
function _purchaseRequester() {
    const u = (typeof window.getActiveUser === 'function' ? window.getActiveUser() : null) || window.currentUser || {};
    // J11 · P1 #7: ad kuralların staffName'i ile aynı kaynaktan (name → adSoyad → ad, kırpılmış)
    return { name: (window.Ownership && window.Ownership.selfName()) || String(u.name || '').trim(), id: String(u.id || '').trim() };
}

// -----------------------------
// SELECT DOLDUR
// -----------------------------
// [WHY]: "Belge / Ürün Türü" yalnız modal açılırken bir kez dolduruluyordu; türler (veya birimler) modal açıkken ya da
//        henüz tanımlanmamışken gelirse liste boş kalıyor, zorunlu alan yüzünden form ilerlemiyordu. Adlar kaçışsız basılıyordu.
// [HOW]: Liste ${COLLECTION_ROOT}/productTypes/items (window.data.productTypes) ve units'ten; tekil, sıralı, kaçışlı.
//        Mevcut seçim korunur; boşsa nereden tanımlanacağı yazılır. Modal açıkken snapshot gelince yeniden doldurulur (dosya sonu).
function _fillNamedSelect(select, items, placeholder, emptyText) {
    if (!select) return;
    const current = select.value;
    const names = [...new Set(items.map(x => String((x && typeof x === 'object' ? (x.name || x.birimAdi) : x) || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'tr'));
    select.innerHTML = (names.length ? `<option value="">${escapeHtml(placeholder)}</option>` : `<option value="">${escapeHtml(emptyText)}</option>`) +
        names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (!current) return;
    if (!names.includes(current)) select.add(new Option(current, current));
    select.value = current;
}

function fillPurchaseSelects() {
    _fillNamedSelect(document.getElementById('purUnit'), (window.data.units || []).filter(u => u?.active !== false),
        'Birim Seçiniz', 'Tanımlı birim yok — Tanımlar › Birimler');
    const select = document.getElementById('purType');
    if (!select) return;
    const recordId = document.getElementById('purchaseForm')?.dataset.purchaseRecordId;
    const opened = recordId ? _findPurchase(recordId) : null;
    if (opened && !opened.documentTypeCode) {
        select.replaceChildren(new Option('Eski kayıt — belge türü belirtilmemiş', 'LEGACY_UNCLASSIFIED'));
        return;
    }
    const code = window.AppModules.EBYSDocumentTypes.purchaseCode;
    select.replaceChildren(new Option(window.AppModules.EBYSDocumentTypes.byCode(code).name, code));
    select.value = code;
}

// -----------------------------
// KAYDET
// -----------------------------
// [WHY]: Faz 4 · J1 (M3) — Rules v2 personelin satın alma metinlerinde etiket benzeri "<" ifadesini reddeder; ret dosyalar
//        yüklendikten sonra genel hata olarak düşerdi. [HOW]: Kural denetlenen form alanları yüklemeden ÖNCE kontrol edilir.
function _purchaseTextBlocked() {
    const v = id => document.getElementById(id)?.value || '';
    return typeof window.guardTagLike === 'function' && window.guardTagLike({ 'Ürün / Hizmet': v('purName'), 'Açıklama': v('purDesc') });
}

window.savePurchaseRequest = async function (e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (_purchaseTextBlocked()) return false;
    let purchaseLines;
    try { purchaseLines = window.AppModules.PurchaseItemsUI.read(); }
    catch (error) { if (typeof showAppAlert === 'function') showAppAlert(error.message, 'warning'); return false; }
    let budget;
    try { budget = window.AppModules.PurchaseItemsUI.readBudget(); }
    catch (error) { if (typeof showAppAlert === 'function') showAppAlert(error.message, 'warning'); return false; }
    console.log("🚀 savePurchaseRequest tetiklendi...");

    const fileInput = document.getElementById("purchaseFile");
    let uploadedFiles = [];

    try {
        if (fileInput?.files?.length) {
            console.log(`📂 ${fileInput.files.length} adet dosya yükleniyor...`);
            uploadedFiles = await _uploadOrAsk(fileInput.files);
            if (uploadedFiles === null) { if (typeof showAppAlert === 'function') showAppAlert('Talep kaydedilmedi.', 'info'); return false; }
            console.log("✅ Dosya yükleme tamamlandı.");
        }

        const requester = _purchaseRequester();
        if (!requester.name) {
            if (typeof showAppAlert === 'function') showAppAlert('Talep oluşturmak için giriş yapmalısınız.', 'error');
            return false;
        }
        const newRequest = {
            id: Date.now(),
            evrakNo: document.getElementById('purDocName')?.value || "",
            tarih: document.getElementById('purDate')?.value || "",
            talepEden: requester.name,
            urun: document.getElementById('purName')?.value || "",
            // Legacy özet alanı ilk kalemi temsil eder; yeni parasal kaynak items/totals'tır.
            adet: purchaseLines.items[0].quantity,
            butce: budget.amount,
            budgetMode: budget.mode,
            budgetEstimateRates: budget.estimateRates,
            items: purchaseLines.items,
            totals: purchaseLines.totals,
            documentTypeCode: document.getElementById('purType')?.value || window.AppModules.EBYSDocumentTypes.purchaseCode,
            birim: document.getElementById('purUnit')?.value || "",
            tur: purchaseLines.items[0].category,
            oncelik: document.getElementById('purPriority')?.value || "Normal",
            aciklama: document.getElementById('purDesc')?.value || "",
            createdBy: requester.id || "unknown",
            createdByName: requester.name,
            // Faz 4B · J9: sahiplik uid'si yalnız Auth'tan (personelin kendi hesabı); ilk yazımdan sonra değişmez
            ...(window.Ownership.selfUid() ? { createdByUid: window.Ownership.selfUid() } : {}),
            durum: "Onay Bekliyor",
            createdAt: Date.now(),
            files: uploadedFiles.map(f => ({
                name: f.name,
                url: f.url,
                uploadedAt: new Date().toLocaleString('tr-TR'),
                uploadedBy: window.currentUser?.name || 'Bilinmeyen'
            })),
            akis: [
                {
                    islem: "Talep Oluşturuldu",
                    yapan: requester.name,
                    uid: window.userAuth?.uid || '',   // J11.5: kurallar sahibin kaydında request.auth.uid ile eşler
                    tarih: new Date().toLocaleString('tr-TR')
                }
            ],
            workflow: { started: false, currentStep: 0, steps: [] }
        };

        console.log("💾 Veritabanına kaydediliyor...");
        // Tek doküman eklenir (H2); başarısızsa "oluşturuldu" denmez.
        if (!(await window.writeOk(window.appendItem('purchaseOrders', newRequest)))) {
            if (typeof showAppAlert === 'function') showAppAlert("Talep kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.", "error");
            return false;
        }
        console.log("✅ Kayıt başarılı.");

        document.getElementById('purchaseModal').style.display = "none";
        document.getElementById('purchaseForm').reset();

        if (window.renderPurchaseModule) window.renderPurchaseModule();
        if (typeof showAppAlert === 'function') showAppAlert("Talep başarıyla oluşturuldu", "success");

    } catch (err) {
        console.error("❌ savePurchaseRequest Hatası:", err);
        alert("Talep kaydedilemedi: " + err.message);
    }

    return false;
};

// DURUM BADGE PAGE CHANGE
window.changePurchasePage = function (dir) {
    const total = (window.data.purchaseOrders || []).length;
    const maxPage = Math.ceil(total / PAGE_SIZE);

    // purchaseState içindeki page değerini güncelliyoruz
    window.purchaseState.page += dir;

    if (window.purchaseState.page < 1) window.purchaseState.page = 1;
    if (window.purchaseState.page > maxPage) window.purchaseState.page = maxPage;

    window.renderPurchaseModule();
};

// DURUM BADGE HELPER - EBYS State Machine Uyumlu
function getStatusBadge(item) {
    if (!item.workflow) return `<span class="badge-soft badge-secondary"><i class="fas fa-file-draft me-1"></i>DRAFT</span>`;

    const currentState = item.workflow.currentState;

    // 0. İptal Durumu
    if (currentState === window.WorkflowEngine?.states?.CANCELLED || item.durum === "İptal Edildi") {
        return `<span class="badge-soft bg-danger text-white"><i class="fas fa-times-circle me-1"></i> İptal Edildi</span>`;
    }

    // 1. Başlangıç durumu
    if (!item.workflow.started) {
        return `<span class="badge-soft badge-secondary"><i class="fas fa-file-alt me-1"></i> Başlatılmadı</span>`;
    }

    // 2. Tamamlanmış durumlar
    if (currentState === window.WorkflowEngine?.states?.COMPLETED || item.durum === "Onaylandı") {
        return `<span class="badge-soft bg-success text-white"><i class="fas fa-check-circle me-1"></i> Onaylandı</span>`;
    }

    // 3. Aktif state'ler
    const steps = item.workflow?.steps || [];
    const currentStep = item.workflow?.currentStep || 0;
    const step = steps[currentStep];
    // [WHY]: Faz 4 · J2 (SEC-01) — adım kişisi personelin yazabildiği purchaseOrders.workflow.steps[] içinde; rozet admin'de
    //        satın alma ve servis tablolarına basılıyordu (tıklamasız XSS). [HOW]: Ham alan burada kaçırılır; çağıranlar rozetin
    //        kendisini (birleştirilmiş HTML) tekrar kaçırmaz (M7).
    return `<span class="badge-soft bg-warning text-dark"><i class="fas fa-clock me-1"></i> ${escapeHtml(step?.user || "Sorumlu")} Bekliyor</span>`;
}

// KPI (Sayaçlar) → Dinamik + Minimal + Canlı
window.renderPurchaseStats = function () {
    const orders = window.data.purchaseOrders || [];
    const services = window.data.serviceRecords || [];

    // Filtrelemeleri güvenli yapalım
    const pending = orders.filter(x => x.durum === "Onay Bekliyor").length;
    const completed = orders.filter(x => x.durum === "Onaylandı").length;
    const inService = services.filter(r => r && r.kapandi !== true).length; // kapanmış (depoya dönmüş) kayıtlar sayılmaz

    const elPending = document.getElementById("totalPendingPurchase");
    const elCompleted = document.getElementById("totalCompletedAction");
    const elService = document.getElementById("totalInService");

    if (elPending) elPending.innerText = pending;
    if (elCompleted) elCompleted.innerText = completed;
    if (elService) elService.innerText = inService;

    // Faz 3: "Satın Alma Talepleri" başlığındaki rozet — onay bekleyen sipariş varsa görünür
    const badge = document.getElementById('purchasePendingBadge');
    if (badge) {
        badge.textContent = `${pending} onay bekliyor`;
        badge.hidden = pending === 0;
    }
};

// renderServicesModule içindeki tablo çizim kısmında düzeltme:
// window.data.purchaseOrders zaten bir dizi (array) olduğu için Object.values'a gerek yok.
const pData = Array.isArray(window.data.purchaseOrders) ? window.data.purchaseOrders : [];
window.renderPurchaseModule = function (options = {}) {

    // Options: { showAll: true/false, isAdmin: true/false }
    const showAllRequests = options.showAll || false;
    const isAdminMode = options.isAdmin || false;

    // Panel modunu belirle
    if (showAllRequests || isAdminMode || window.location.pathname.includes('admin')) {
        window.isAdminPanel = true;
    } else {
        window.isAdminPanel = false;
    }

    const tbody = document.getElementById('purchaseTableBody');
    if (!tbody) return;

    let data = Array.isArray(window.data.purchaseOrders)
        ? window.data.purchaseOrders
        : (window.data.purchaseOrders ? Object.values(window.data.purchaseOrders) : []);

    // --------------------------------------------------
    // 🔍 SEARCH (ilk filtre)
    // --------------------------------------------------
    const search = document
        .getElementById("purchaseSearch")?.value
        ?.toLocaleLowerCase('tr-TR') || "";

    if (search) {
        data = data.filter(item =>
            item.evrakNo?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.urun?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.talepEden?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.birim?.toLocaleLowerCase('tr-TR').includes(search)
        );
    }

    // --------------------------------------------------
    // 👤 PERSONEL PANELİ FİLTRE
    // (kendi talepleri + onay bekleyenler - onaylananlar dahil)
    // --------------------------------------------------
    if (!window.isAdminPanel) {
        const currentMe = (window.currentUser?.name || "").trim().toLocaleLowerCase('tr-TR');
        // Faz 4B · J8: oturum kodu taşımaz — kendi talebi: createdBy = personel id (yeni) ya da talep eden adı (kodla açılmış eski talepler)
        const currentId = String(window.currentUser?.id || "");

        data = data.filter(item => {
            const itemCreatedBy = String(item.createdBy || "");
            const ownerName = String(item.createdByName || item.talepEden || "").trim().toLocaleLowerCase('tr-TR');
            const myUid = window.userAuth && !window.userAuth.isAnonymous ? String(window.userAuth.uid) : '';
            const ownRequest = (!!myUid && String(item.createdByUid || '') === myUid) || (!!currentId && itemCreatedBy === currentId) || (!!currentMe && ownerName === currentMe);

            // Onay bekleyen kontrolü
            let waitingApproval = false;
            if (item.workflow?.started && !item.workflow.finished) {
                const steps = item.workflow?.steps || [];
                const currentStep = item.workflow?.currentStep || 0;
                const currentStepIndex = Math.min(currentStep, Math.max(0, steps.length - 1));
                const step = steps[currentStepIndex];
                const stepUser = (step?.user || "").trim().toLocaleLowerCase('tr-TR');
                const mine = step?.userUid ? (!!myUid && String(step.userUid) === myUid) : stepUser === currentMe;   // J10: uid öncelikli
                if (mine && step.status !== 'approved') {
                    waitingApproval = true;
                }
            }

            // Kullanıcı kendi talebi veya onay bekleyen bir talep ise göster
            const shouldShow = ownRequest || waitingApproval;
            if (item.evrakNo?.includes('8146')) {
                console.log(`🧐 [DEBUG] 8146 Talebi Kontrolü: ownRequest=${ownRequest}, waitingApproval=${waitingApproval}`);
            }
            return shouldShow;
        });
        console.log(`✅ Filtre Sonrası Talep Sayısı: ${data.length}`);
    }

    // --------------------------------------------------
    // 🔥 UX SIRALAMA (en kritik)
    // aktif > başlamamış > onaylandı > reddedildi
    // --------------------------------------------------
    data.sort((a, b) => {

        const getPriority = (item) => {
            let rowClass = "";
            if (item.durum === "Reddedildi") rowClass = "row-rejected";
            if (item.durum === "Onaylandı") rowClass = "row-approved";

            if (item.workflow?.started) return 0;
            return 1;
        };

        return getPriority(a) - getPriority(b)
            || (b.createdAt - a.createdAt);
    });

    // --------------------------------------------------
    // 📄 PAGINATION (EN SON!)
    // --------------------------------------------------
    window.purchasePage = window.purchasePage || 1;

    const start = (window.purchasePage - 1) * PAGE_SIZE;
    const pagedData = data.slice(start, start + PAGE_SIZE);

    // --------------------------------------------------
    // 🧾 TABLE RENDER
    // --------------------------------------------------
    tbody.innerHTML =
        pagedData.length > 0
            ? pagedData.map(item => {
                try {
                    const durumHTML = getStatusBadge(item);
                    const isCancelled = item.durum === "İptal Edildi";
                    const isStarted = item.workflow?.started === true;

                    return `
                    <tr class="align-middle ${isCancelled ? 'passive-row' : ''}">
                        <td>
                            <div style="font-weight:700; color:var(--color-primary); font-size:13px; font-family:monospace;">${escapeHtml(item.evrakNo || "-")}</div>
                        </td>
                        <td>
                            <div style="font-size:12px; color:#64748b; font-weight:500;">${escapeHtml(item.tarih || "-")}</div>
                        </td>
                        <td>
                            <div style="font-size:13px; font-weight:600; color:#1e293b;">${escapeHtml(item.talepEden || item.createdByName || "-")}</div>
                            <small class="text-muted" style="font-size:10px;">EBYS Birimi</small>
                        </td>
                        <td>
                            <div style="font-size:13px; font-weight:600; color:var(--color-primary);">${escapeHtml(item.urun || "-")}</div>
                            <div style="font-size:11px; color:#94a3b8; font-weight:500; margin-top:2px;">
                                <i class="fas fa-building me-1"></i> ${escapeHtml(item.birim || "Genel")}
                            </div>
                        </td>
                        <td>${durumHTML}</td>
                        <td class="text-end">
                            <div class="d-flex justify-content-end gap-1">
                                <!-- Görüntüle -->
                                <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'view')" class="btn-action btn-passive" title="Görüntüle">
                                    <i class="fas fa-eye fa-xs"></i>
                                </button>
            
                                ${window.isAdminPanel ? `
                                    <!-- Düzenle (Admin için her zaman açık) -->
                                    <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'edit')" 
                                            class="btn-action btn-edit" 
                                            title="Düzenle">
                                        <i class="fas fa-edit fa-xs"></i>
                                    </button>
                                    
                                    ${!isStarted ? `
                                        <!-- Akışı Başlat -->
                                        <button onclick="window.startWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Başlat">
                                            <i class="fas fa-play fa-xs"></i>
                                        </button>
                                    ` : `
                                        <!-- Akışı Görüntüle -->
                                        <button onclick="window.viewWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Görüntüle">
                                            <i class="fas fa-stream fa-xs"></i>
                                        </button>
                                    `}
                                    
                                    ${!isCancelled ? `
                                        <!-- [BUGFIX] Admin Geri Çek / İptal (cancelPurchaseRequest) butonu -->
                                        <button onclick="window.cancelPurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="${isStarted ? 'Geri Çek (Taslağa Al)' : 'Talebi İptal Et'}">
                                            <i class="fas fa-ban fa-xs"></i>
                                        </button>
                                    ` : ''}

                                    <!-- Sil -->
                                    <button onclick="window.deletePurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="Sil">
                                        <i class="fas fa-trash-alt fa-xs"></i>
                                    </button>
                                ` : `
                                    ${!isCancelled ? `
                                        <!-- Düzenle -->
                                        <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'edit')" 
                                                class="btn-action btn-edit" 
                                                ${isStarted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} 
                                                title="${isStarted ? 'Süreç başladığı için düzenlenemez' : 'Düzenle'}">
                                            <i class="fas fa-edit fa-xs"></i>
                                        </button>
                    
                                        ${!isStarted ? `
                                            <!-- Akışı Başlat -->
                                            <button onclick="window.startWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Başlat">
                                                <i class="fas fa-play fa-xs"></i>
                                            </button>
                                        ` : `
                                            <!-- Akışı Görüntüle -->
                                            <button onclick="window.viewWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Görüntüle">
                                                <i class="fas fa-stream fa-xs"></i>
                                            </button>
                                        `}
                                        
                                        <!-- İptal Et / Geri Çek -->
                                        <button onclick="window.cancelPurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="${isStarted ? 'Geri Çek (Taslağa Al)' : 'Talebi İptal Et'}">
                                            <i class="fas fa-ban fa-xs"></i>
                                        </button>
                                    ` : ''}
                                `}
                            </div>
                        </td>
                    </tr>
                    `;
                } catch (err) {
                    console.error("❌ Satır render hatası:", err, item);
                    return `<tr><td colspan="6" style="color:red; font-size:10px;">Veri hatası (ID: ${escapeHtml(item.id)})</td></tr>`;
                }
            }).join("")
            : `
            <tr>
                <td colspan="6" class="text-center">
                    Kayıt yok
                </td>
            </tr>
            `;

    // --------------------------------------------------
    // 📊 STATS (null check ekledik)
    // --------------------------------------------------
    if (typeof renderPurchaseStats === "function") {
        renderPurchaseStats();
    }

    // --------------------------------------------------
    // 🔢 PAGINATION UI (sonradan bağlayacağız)
    // --------------------------------------------------
    if (typeof renderPurchasePagination === "function") {
        renderPurchasePagination(data.length);
    }
};


window.renderServicesModule = function () {
    const pBody = document.getElementById('purchaseTableBody');
    const sBody = document.getElementById('serviceTableBody');

    // 1. Satın Alma Tablosu (Soldaki)
    if (pBody) {
        const pData = window.data.purchaseOrders ? Object.values(window.data.purchaseOrders) : [];

        pBody.innerHTML = pData.length > 0 ? pData.map(item => {
            const isStarted = item.workflow?.started === true;
            const isCancelled = item.durum === 'İptal Edildi';
            const durumHTML = getStatusBadge(item);
            
            // Reddedildi durumu için hafif arka plan
            const isReddedildi = item.durum === 'Reddedildi';
            const rowStyle = isReddedildi ? 'style="background-color: #fff5f5;"' : '';

            return `
                <tr ${rowStyle} class="align-middle ${isCancelled ? 'passive-row' : ''}">
                    <td>
                        <div style="font-weight:700; color:var(--color-primary); font-size:13px; font-family:monospace;">${escapeHtml(item.evrakNo || "-")}</div>
                    </td>
                    <td>
                        <div style="font-size:12px; color:#64748b; font-weight:500;">${escapeHtml(item.tarih || "-")}</div>
                    </td>
                    <td>
                        <div style="font-size:13px; font-weight:600; color:#1e293b;">${escapeHtml(item.talepEden || item.createdByName || "-")}</div>
                        <small class="text-muted" style="font-size:10px;">EBYS Birimi</small>
                    </td>
                    <td>
                        <div style="font-size:13px; font-weight:600; color:var(--color-primary);">${escapeHtml(item.urun || "-")}</div>
                        <div style="font-size:11px; color:#94a3b8; font-weight:500; margin-top:2px;">
                            <i class="fas fa-building me-1"></i> ${escapeHtml(item.birim || "Genel")}
                        </div>
                    </td>
                    <td>${durumHTML}</td>
                    <td class="text-end">
                        <div class="d-flex justify-content-end gap-1">
                            <!-- Görüntüle -->
                            <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'view')" class="btn-action btn-passive" title="Görüntüle">
                                <i class="fas fa-eye fa-xs"></i>
                            </button>
        
                            ${window.isAdminPanel ? `
                                <!-- Düzenle (Admin için her zaman açık) -->
                                <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'edit')" 
                                        class="btn-action btn-edit" 
                                        title="Düzenle">
                                    <i class="fas fa-edit fa-xs"></i>
                                </button>
                                
                                ${!isStarted ? `
                                    <!-- Akışı Başlat -->
                                    <button onclick="window.startWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Başlat">
                                        <i class="fas fa-play fa-xs"></i>
                                    </button>
                                ` : `
                                    <!-- Akışı Görüntüle -->
                                    <button onclick="window.viewWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Görüntüle">
                                        <i class="fas fa-stream fa-xs"></i>
                                    </button>
                                `}
                                
                                ${!isCancelled ? `
                                    <!-- [BUGFIX] Admin Geri Çek / İptal (cancelPurchaseRequest) butonu -->
                                    <button onclick="window.cancelPurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="${isStarted ? 'Geri Çek (Taslağa Al)' : 'Talebi İptal Et'}">
                                        <i class="fas fa-ban fa-xs"></i>
                                    </button>
                                ` : ''}

                                <!-- Sil -->
                                <button onclick="window.deletePurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="Sil">
                                    <i class="fas fa-trash-alt fa-xs"></i>
                                </button>
                            ` : `
                                ${!isCancelled ? `
                                    <!-- Düzenle -->
                                    <button onclick="window.openPurchaseDetail(${jsArg(item.id)}, 'edit')" 
                                            class="btn-action btn-edit" 
                                            ${isStarted ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} 
                                            title="${isStarted ? 'Süreç başladığı için düzenlenemez' : 'Düzenle'}">
                                        <i class="fas fa-edit fa-xs"></i>
                                    </button>
                
                                    ${!isStarted ? `
                                        <!-- Akışı Başlat -->
                                        <button onclick="window.startWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Başlat">
                                            <i class="fas fa-play fa-xs"></i>
                                        </button>
                                    ` : `
                                        <!-- Akışı Görüntüle -->
                                        <button onclick="window.viewWorkflow(${jsArg(String(item.id))})" class="btn-action btn-buy" title="Akışı Görüntüle">
                                            <i class="fas fa-stream fa-xs"></i>
                                        </button>
                                    `}
                                    
                                    <!-- İptal Et / Geri Çek -->
                                    <button onclick="window.cancelPurchaseRequest(${jsArg(String(item.id))})" class="btn-action btn-danger" title="${isStarted ? 'Geri Çek (Taslağa Al)' : 'Talebi İptal Et'}">
                                        <i class="fas fa-ban fa-xs"></i>
                                    </button>
                                ` : ''}
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('') : '<tr><td colspan="6" class="text-center text-muted p-4">Bekleyen talep yok.</td></tr>';
    }

    // 2. Servis & Dış Sevk Tablosu (Sağdaki)
    if (sBody) {
        const sData = _openServices();

        const _statusStyle = (durum) => {
            const map = {
                'Servis Sürecinde Bekliyor': { bg: '#fff3cd', color: '#048578' },
                'Serviste / Yolda': { bg: '#fff3cd', color: '#856404' },
                'Tamir Tamamlandı': { bg: '#d1e7dd', color: '#0a3622' },
                'Parça Bekleniyor': { bg: '#ffe0b2', color: '#7c3200' },
                'Dış Birimde': { bg: '#cfe2ff', color: '#0a367a' },
                'İptal / Hurda': { bg: '#f8d7da', color: '#58151c' },
            };
            return map[durum] || { bg: '#fff3cd', color: '#856404' };
        };

        sBody.innerHTML = sData.length > 0 ? sData.map(item => {
            const sc = _statusStyle(item.durum);
            return `
            <tr>
                <td>
                    <div class="fw-bold text-dark">${escapeHtml(item.urunAciklama || 'İsimsiz Ürün')}</div>
                    <small class="text-muted">${escapeHtml(item.marka || '')}${escapeHtml(item.sn && item.sn !== '-' ? ' — SN: ' + item.sn : '')}${escapeHtml(item.envanterNo && item.envanterNo !== '-' ? ' — Env: ' + item.envanterNo : '')}${item.adet > 1 ? ` — ${escapeHtml(item.adet)} adet` : ''}</small>
                    ${item.sevkTarihi ? `<div style="font-size:10px;color:#aaa;margin-top:2px;">📅 ${escapeHtml(item.sevkTarihi)}</div>` : ''}
                </td>
                <td>
                    <div style="font-size:10px;color:#888;margin-bottom:3px;">🏢 ${escapeHtml(item.hedef || '-')}</div>
                    <span style="background:${escapeHtml(sc.bg)};color:${escapeHtml(sc.color)};padding:2px 10px;border-radius:20px;font-size:10px;font-weight:600;white-space:nowrap;">
                        ${escapeHtml(item.durum || 'Serviste')}
                    </span>
                </td>
                <td class="text-end" style="white-space:nowrap;">
                    <button onclick="window.viewServiceItem(${jsArg(item.id)})"
                            class="btn btn-sm btn-outline-secondary"
                            title="Görüntüle" style="margin-right:3px;">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button onclick="window.updateServiceStatus(${jsArg(item.id)})"
                            class="btn btn-sm btn-outline-warning"
                            title="Durum Güncelle" style="margin-right:3px;">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button onclick="window.receiveFromService(${jsArg(item.id)})"
                            class="btn btn-sm btn-outline-success"
                            title="Depoya Geri Al">
                        <i class="fas fa-warehouse"></i>
                    </button>
                    ${_deviceIdOf(item) ? `<button onclick="window.DeviceIds.showHistory(${jsArg(_deviceIdOf(item))})" class="btn btn-sm btn-outline-info" title="Cihaz geçmişi (servisler dahil)" style="margin-left:3px;"><i class="fas fa-history"></i></button>` : ''}
                </td>
            </tr>
        `;
        }).join('') : '<tr><td colspan="3" class="text-center text-muted">Şu an serviste ürün yok.</td></tr>';
    }

    // Sayaç Güncellemeleri
    // [WHY]: "BEKLEYEN" kartı burada TÜM satın alma siparişlerinin sayısıyla eziliyordu; renderPurchaseStats aynı kartı
    //        "Onay Bekliyor" sayısıyla dolduruyor, hangisi son çalışırsa o görünüyordu.
    // [HOW]: Kartları tek kaynak (renderPurchaseStats) doldurur.
    if (typeof window.renderPurchaseStats === 'function') window.renderPurchaseStats();
};

// 3. Servisten Geri Al
// [WHY]: Servis kaydı silme ve ürünü depoya geri yazma ayrı iki kayıttı; personel oturumunda b1/b2 yazması reddedilirken
//        servis kaydı silinebildiği için ürün iki yerden de kayboluyordu (EBYS-21). Ürün dizi sonuna yeni kayıt olarak
//        ekleniyor (aynı id'li kayıt yeniden oluşunca birleşme belirsizdi) ve durumu koşulsuz "Kullanıma Hazır" yapılıyordu.
//        (3.9b) Kayıt dönüşte silindiği için aynı cihaz yeniden servise gittiğinde önceki servisler görünmüyordu.
// [HOW]: Tek transaction (runStockOps): ürün kaydı artık yoksa orijinal verisiyle yeniden oluşturulur, hâlâ varsa adedi eklenir
//        (sevk artık yalnız seçilen adedi taşır; kayıttaki adet, eski kayıtlarda orijinal satırın adedi); servis kaydı AYNI
//        transaction'da silinmeden kapatılır (kapandi, "Depoya Döndü", dönüş tarihi/deposu, geçmişe satır) — ya ikisi ya hiçbiri.
//        Yalnız yönetici. Servisten dönen ürünün durumu yeniden oluşturmada "Kullanıma Hazır" (onarıldı) olur.
window.receiveFromService = async function (serviceId) {
    const record = _findService(serviceId);
    if (!record) { if (typeof showAppAlert === 'function') showAppAlert('Servis kaydı bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    if (record.kapandi === true) { if (typeof showAppAlert === 'function') showAppAlert('Bu servis kaydı zaten kapanmış (cihaz depoya dönmüş).', 'info'); return; }
    const targetRepo = ['b1', 'b2'].includes(record.kaynakDepo) ? record.kaynakDepo : 'b1';

    const base = record.originalData ? { ...record.originalData } : {
        ürün: record.urunAciklama || record.urun,
        tür: record.urunTuru || "Servis Çıkışlı",
        adet: record.adet || 1,
        sn: record.sn || "-"
    };
    const qty = parseInt(record.adet ?? base.adet ?? base.qty ?? 1, 10) || 1;
    const productId = base.id != null && base.id !== '' ? String(base.id)
        : (record.productId != null && record.productId !== '' ? String(record.productId) : `${targetRepo}_${window.makeId()}`);
    const statusField = targetRepo === 'b2' ? 'status' : 'durumu';
    const recovered = {
        ...base, id: productId, adet: qty,
        [statusField]: 'Kullanıma Hazır',
        açıklama: "Servisten Döndü: " + (record.not || ""),
    };
    delete recovered.sn; delete recovered.envanterNo;   // cihaz kimliği stok satırına değil hareket kayıtlarına aittir

    const ok = typeof showCustomConfirm === 'function'
        ? await showCustomConfirm('Depoya Geri Al', `"${recovered.ürün || '-'}" (${qty} adet) ${targetRepo.toUpperCase()} deposuna geri alınacak; servis kaydı kapanır ve cihaz geçmişinde kalır. Onaylıyor musunuz?`)
        : window.confirm('Ürün depoya geri alınsın mı?');
    if (ok !== true) return;

    const now = typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toLocaleString('tr-TR');
    const yapan = window.currentUser?.name || window.getActiveUser?.()?.name || 'Admin';
    let res;
    try {
        res = await window.runStockOps({
            stock: [{ col: targetRepo, id: productId, delta: qty, createIfMissing: recovered }],
            writes: [{ op: 'update', col: 'serviceRecords', id: record.id, fields: {
                kapandi: true, durum: 'Depoya Döndü', donusTarihi: now, donusDepo: targetRepo,
                gecmis: [...(Array.isArray(record.gecmis) ? record.gecmis : []), { ts: Date.now(), tarih: now, durum: 'Depoya Döndü', not: `${targetRepo.toUpperCase()} deposuna geri alındı`, yapan }],
            } }]
        }, { forbiddenMessage: 'Servisten depoya geri alma yalnızca sistem yöneticisi tarafından yapılabilir.' });
    } catch (e) {
        if (typeof showAppAlert === 'function') showAppAlert(`Ürün depoya geri alınamadı; servis kaydı yerinde bırakıldı. ${e.message || ''}`, 'error');
        return;
    }
    const s0 = res.stock[0];
    if (typeof window.renderPurchaseModule === 'function') window.renderPurchaseModule();
    if (typeof window.renderTable === 'function') window.renderTable(targetRepo);
    if (typeof showAppAlert === 'function') showAppAlert(s0.created ? `Ürün ${targetRepo.toUpperCase()} deposuna geri alındı.` : `Ürün ${targetRepo.toUpperCase()} deposundaki kaydına eklendi (stok ${s0.before} → ${s0.after}).`, "success");
    renderServicesModule();
};

// ─────────────────────────────────────────────────────────────
// SERVİS KAYDI GÖRÜNTÜLE (Salt Okunur Modal)
// ─────────────────────────────────────────────────────────────
window.viewServiceItem = function (serviceId) {
    const record = _findService(serviceId);
    if (!record) return;

    // Modal yoksa oluştur
    let modal = document.getElementById('serviceViewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'serviceViewModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);justify-content:center;align-items:center;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:28px 32px;width:500px;max-width:95vw;max-height:85vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
                <button onclick="document.getElementById('serviceViewModal').style.display='none'"
                    style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#aaa;line-height:1;">&times;</button>
                <div id="serviceViewContent"></div>
            </div>`;
        document.body.appendChild(modal);
    }

    const dem = record.isDemirbas === true || record.isDemirbas === 'true';
    const orig = record.originalData || {};

    const _fieldHtml = (label, value) => `
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px;">
            <label style="display:block;font-size:10px;color:#999;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;margin-bottom:3px;">${escapeHtml(label)}</label>
            <span style="font-size:13px;color:#2c3e50;font-weight:500;">${escapeHtml(value)}</span>
        </div>`;

    const statusColors = {
        'Servis Sürecinde Bekliyor': { bg: '#fff3cd', color: '#048578' },
        'Serviste / Yolda': { bg: '#fff3cd', color: '#856404' },
        'Tamir Tamamlandı': { bg: '#d1e7dd', color: '#0a3622' },
        'Parça Bekleniyor': { bg: '#ffe0b2', color: '#7c3200' },
        'Dış Birimde': { bg: '#cfe2ff', color: '#0a367a' },
        'İptal / Hurda': { bg: '#f8d7da', color: '#58151c' },
    };
    const sc = statusColors[record.durum] || { bg: '#fff3cd', color: '#856404' };

    document.getElementById('serviceViewContent').innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
            <div style="width:44px;height:44px;background:#3498db;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-tools" style="color:white;font-size:17px;"></i>
            </div>
            <div>
                <h3 style="margin:0;font-size:16px;color:#1a1a2e;font-weight:700;">${escapeHtml(record.urunAciklama || 'İsimsiz Ürün')}</h3>
                <small style="color:#888;">${escapeHtml(record.marka || '')}${escapeHtml(record.sn ? ' — SN: ' + record.sn : '')}</small>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            ${_fieldHtml('Hedef / Gönderilen', record.hedef || '-')}
            ${_fieldHtml('Kaynak Depo', (record.kaynakDepo || '-').toUpperCase())}
            ${_fieldHtml('Sevk Tarihi', record.sevkTarihi || '-')}
            ${_fieldHtml('Demirbaş', dem ? '✅ Evet' : '❌ Hayır')}
            ${_fieldHtml('Marka', record.marka || '-')}
            ${_fieldHtml('Seri No', record.sn || '-')}
            ${_fieldHtml('Envanter No', record.envanterNo || '-')}
            ${_fieldHtml('Adet', record.adet ?? orig.adet ?? '-')}
        </div>

        <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:12px;">
            <label style="font-size:10px;color:#999;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Güncel Durum</label>
            <div style="margin-top:6px;">
                <span style="background:${escapeHtml(sc.bg)};color:${escapeHtml(sc.color)};padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">
                    ${escapeHtml(record.durum || 'Serviste')}
                </span>
            </div>
        </div>

        ${record.not ? `
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:12px;">
            <label style="font-size:10px;color:#999;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Sevk Notu</label>
            <p style="margin:6px 0 0;color:#333;font-size:13px;">${escapeHtml(record.not)}</p>
        </div>` : ''}

        ${Array.isArray(record.gecmis) && record.gecmis.length ? `
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:12px;">
            <label style="font-size:10px;color:#999;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Durum Geçmişi</label>
            ${record.gecmis.map(g => `<div style="margin-top:6px;color:#333;font-size:12px;">• ${escapeHtml(g.tarih || '-')} — <b>${escapeHtml(g.durum || '-')}</b>${g.not ? ' · ' + escapeHtml(g.not) : ''}${g.yapan ? ' · ' + escapeHtml(g.yapan) : ''}</div>`).join('')}
        </div>` : ''}

        ${_deviceIdOf(record) ? `<button type="button" onclick="window.DeviceIds.showHistory(${jsArg(_deviceIdOf(record))})" style="margin-bottom:12px;padding:8px 14px;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">🕘 Cihaz geçmişi (servisler dahil)</button>` : ''}

        ${orig.açıklama ? `
        <div style="background:#f8f9fa;border-radius:8px;padding:12px;">
            <label style="font-size:10px;color:#999;text-transform:uppercase;font-weight:600;letter-spacing:0.5px;">Orijinal Açıklama</label>
            <p style="margin:6px 0 0;color:#333;font-size:13px;">${escapeHtml(orig.açıklama)}</p>
        </div>` : ''}
    `;

    modal.style.display = 'flex';
};

// ─────────────────────────────────────────────────────────────
// SERVİS DURUM GÜNCELLE
// ─────────────────────────────────────────────────────────────
window.updateServiceStatus = function (serviceId) {
    if (!window.requireDbAdmin('Servis durumu güncelleme')) return;   // Faz 4 · J1 (M5): serviceRecords yalnız admin
    const record = _findService(serviceId);
    if (!record) return;

    // Modal yoksa oluştur
    let modal = document.getElementById('serviceStatusModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'serviceStatusModal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);justify-content:center;align-items:center;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:14px;padding:28px 32px;width:400px;max-width:95vw;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
                <button onclick="document.getElementById('serviceStatusModal').style.display='none'"
                    style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#aaa;line-height:1;">&times;</button>
                <h3 style="margin:0 0 4px;font-size:16px;color:#1a1a2e;font-weight:700;">Durum Güncelle</h3>
                <p id="svcStatusProdName" style="margin:0 0 20px;color:#888;font-size:13px;"></p>

                <label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px;">Yeni Durum</label>
                <select id="svcStatusSelect"
                    style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:16px;outline:none;">
                    <option value="Servis Sürecinde Bekliyor">Servis Sürecinde Bekliyor</option>
                    <option value="Serviste / Yolda">Serviste / Yolda</option>
                    <option value="Tamir Tamamlandı">Tamir Tamamlandı</option>
                    <option value="Parça Bekleniyor">Parça Bekleniyor</option>
                    <option value="Dış Birimde">Dış Birimde</option>
                    <option value="İptal / Hurda">İptal / Hurda</option>
                </select>

                <label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px;">Not (opsiyonel)</label>
                <textarea id="svcStatusNote" rows="3"
                    placeholder="Durumla ilgili not..."
                    style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:20px;"></textarea>

                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="document.getElementById('serviceStatusModal').style.display='none'"
                        style="padding:9px 20px;border:1.5px solid #ddd;background:white;border-radius:8px;cursor:pointer;font-size:13px;">İptal</button>
                    <button id="svcStatusSaveBtn"
                        style="padding:9px 20px;background:#3498db;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Kaydet</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    // Mevcut değerleri yerleştir
    document.getElementById('svcStatusProdName').innerText = record.urunAciklama || 'İsimsiz Ürün';
    document.getElementById('svcStatusNote').value = '';
    const select = document.getElementById('svcStatusSelect');
    [...select.options].forEach(opt => { opt.selected = opt.value === record.durum; });

    // Kaydet butonu
    document.getElementById('svcStatusSaveBtn').onclick = async function () {
        const newStatus = document.getElementById('svcStatusSelect').value;
        const note = document.getElementById('svcStatusNote').value.trim();

        // [WHY] (3.9b): Durum bellekte değiştirilip TÜM servis koleksiyonu yazılıyordu (DATA-01); notlar tek alana ekleniyor,
        //        ne zaman hangi duruma geçtiği kaybolup gidiyordu.
        // [HOW]: Yalnız bu kayıt güncellenir; her değişiklik tarihli bir geçmiş satırı (gecmis) olarak eklenir.
        const current = _findService(serviceId);
        if (!current) { if (typeof showAppAlert === 'function') showAppAlert('Servis kaydı bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        const now = typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toLocaleString('tr-TR');
        const yapan = window.currentUser?.name || window.getActiveUser?.()?.name || '-';
        const fields = {
            durum: newStatus,
            gecmis: [...(Array.isArray(current.gecmis) ? current.gecmis : []), { ts: Date.now(), tarih: now, durum: newStatus, not: note, yapan }],
            ...(note ? { not: current.not ? current.not + ' | ' + note : note } : {}),
        };
        if (!(await window.writeOk(window.updateItem('serviceRecords', current.id, fields)))) {
            if (typeof showAppAlert === 'function') showAppAlert('Durum kaydedilemedi.', 'error');
            return;
        }
        document.getElementById('serviceStatusModal').style.display = 'none';
        if (typeof renderServicesModule === 'function') renderServicesModule();
        if (typeof showAppAlert === 'function') showAppAlert('Durum güncellendi.', 'success');
    };

    modal.style.display = 'flex';
};

// Veriyi 8'erli bölmek için basit bir logic:
function renderPurchaseTable(data) {
    const start = (currentPurchasePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const paginatedData = data.slice(start, end);

    const tbody = document.getElementById('purchaseTableBody');
    // Satın Alma Talepleri JS Render Örneği
    tbody.innerHTML = paginatedData.map(item => `
        <tr>
            <td><strong>${escapeHtml(item.evrakNo || '-')}</strong></td>
            <td><span class="text-muted">${escapeHtml(item.tarih || '-')}</span></td>
            <td>${escapeHtml(item.talepEden || '-')}</td>
            <td>${escapeHtml(item.urun || '-')}</td>
            <td>
                <span class="badge-soft bg-soft-warning">
                    ${escapeHtml(item.durum || 'Bekliyor')}
                </span>
            </td>
            <td class="text-end">
                <button class="action-btn">Detay</button>
                <button class="action-btn">Akış</button>
            </td>
        </tr>
    `).join('');

    renderPaginationControls(data.length, 'purchasePagination');
}

function renderPaginationControls(totalItems, containerId) {
    const pageCount = Math.ceil(totalItems / PAGE_SIZE);
    let html = '';
    for (let i = 1; i <= pageCount; i++) {
        html += `<button class="${i === currentPurchasePage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    }
    document.getElementById(containerId).innerHTML = html;
}

// [WHY]: Hiç açılmayan #editRequestModal için closeEditModal/editRequest ve form dinleyicisi kaldırıldı; aynı ad ürün türü modalının kapanmasını engelliyordu (ADM-03).

window.viewRequest = function (id) {
    const item = _findPurchase(id);
    if (!item) return;

    // Modalı Görüntüleme Modunda Doldur
    document.getElementById("purDocName").value = item.evrakNo || "";
    document.getElementById("purDate").value = item.tarih || "-";
    document.getElementById("purUser").value = item.personel || "-";
    document.getElementById("purName").value = item.urun || "";
    document.getElementById("purBudget").value = item.butce || "0";
    window.AppModules.PurchaseItemsUI.open(item, true);
    document.getElementById("purPriority").value = item.oncelik || "Normal";
    document.getElementById("purDesc").value = item.aciklama || "";

    // Selectbox'ları doldur (Eğer admin panelinde seçenekler yüklü değilse metin olarak ekle)
    const unitSelect = document.getElementById("purUnit");
    unitSelect.innerHTML = `<option>${escapeHtml(item.birim)}</option>`;

    const typeSelect = document.getElementById("purType");
    const documentType = window.AppModules.EBYSDocumentTypes.byCode(item.documentTypeCode);
    typeSelect.replaceChildren(new Option(documentType?.name || 'Eski kayıt — belge türü belirtilmemiş', item.documentTypeCode || 'LEGACY_UNCLASSIFIED'));

    // Görüntüleme modunda inputları kilitle
    const inputs = document.querySelectorAll("#purchaseForm .modern-input");
    inputs.forEach(input => input.disabled = true);

    // Kaydet butonunu gizle, modalı aç
    document.querySelector(".btn-modern-save").style.display = "none";
    document.getElementById("purchaseModal").style.display = "block";
};

// [WHY]: Yükleme başarısız olunca (Storage/CORS/plan) her dosya için sahte bir 'data:…simulated_…' eki üretilip talebe
//        gerçek ek gibi yazılıyordu (EBYS-14); ek indirilemiyor ama kayıtta var görünüyordu.
// [HOW]: Her dosya ayrı yüklenir; yalnız gerçekten yüklenenler döner. En az biri başarısızsa UploadError fırlatılır
//        (err.uploaded = başarılı olanlar, err.failed = başarısız dosya adları); çağıran kullanıcıya sorar.
window.uploadFiles = async function (files) {
    const filesToUpload = Array.from(files || []);
    if (!filesToUpload.length) return [];

    let storageApi, storage;
    try {
        storageApi = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        storage = storageApi.getStorage();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const uploadError = new Error(`Dosya depolama başlatılamadı: ${detail}`);
        uploadError.name = 'UploadError';
        uploadError.uploaded = [];
        uploadError.failed = filesToUpload.map(file => file.name);
        throw uploadError;
    }

    const uploaded = [], failed = [];
    let lastError = null;
    for (const file of filesToUpload) {
        try {
            const fileRef = storageApi.ref(storage, "purchaseFiles/" + Date.now() + "_" + file.name);
            await storageApi.uploadBytes(fileRef, file);
            uploaded.push({ name: file.name, url: await storageApi.getDownloadURL(fileRef) });
        } catch (error) {
            console.error('❌ Dosya yüklenemedi:', file.name, error);
            failed.push(file.name);
            lastError = error;
        }
    }
    if (failed.length) {
        const err = new Error(`${failed.length} dosya yüklenemedi: ${failed.join(', ')}${lastError ? ' (' + (lastError.code || lastError.message) + ')' : ''}`);
        err.name = 'UploadError';
        err.uploaded = uploaded;
        err.failed = failed;
        throw err;
    }
    return uploaded;
}

// [WHY]: archiveOldRequests onaylanan/reddedilen talepleri purchaseOrders'dan siliyor, dinlenmeyen ve kaydedilmeyen 'archive'
//        koleksiyonuna "taşıyordu" (saveData listesinde yok → sessiz no-op): çağrılırsa talepler kalıcı olarak kaybolurdu (DATA-10).
//        Hiçbir yerden çağrılmıyordu; Karar K12 verilene kadar kaldırıldı.

// ─────────────────────────────────────────────────────────────
// TALEP DETAY MODAL — GÖRÜNTÜLE / DÜZENLE
// ─────────────────────────────────────────────────────────────
window.openPurchaseDetail = function (id, mode) {
    const item = _findPurchase(id);
    if (!item) return;
    if (mode === 'edit' && (item.workflow?.started === true || item.exchangeRate)) {
        if (typeof showAppAlert === 'function') showAppAlert('Mali anlık görüntüsü olan talep düzenlenemez. Değişiklik için yeni talep açın.', 'warning');
        mode = 'view';
    }

    const modal = document.getElementById('purchaseModal');
    const form = document.getElementById('purchaseForm');
    const saveBtn = document.getElementById('purSaveBtn');
    const title = document.getElementById('purModalTitle');
    if (!modal) return;
    if (form) form.dataset.purchaseRecordId = String(id);

    // Başlık
    if (title) {
        title.innerHTML = mode === 'view'
            ? '<i class="fas fa-file-alt me-2"></i> Talep Detayı'
            : '<i class="fas fa-edit me-2"></i> Talebi Düzenle';
    }

    // Alanları doldur
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('purDocName', item.evrakNo);
    set('purDate', item.tarih);
    set('purUser', item.talepEden || item.createdByName);
    set('purName', item.urun);
    set('purBudget', item.butce);
    set('purDesc', item.aciklama);
    window.AppModules.PurchaseItemsUI.open(item, mode === 'view');
    let printBtn = document.getElementById('purPrintBtn');
    const footer = modal.querySelector('.modal-footer-compact, .modern-modal-footer, .modal-footer');
    if (!printBtn && footer) {
        printBtn = document.createElement('button');
        printBtn.id = 'purPrintBtn'; printBtn.type = 'button';
        printBtn.className = 'btn btn-outline-secondary';
        printBtn.textContent = 'Yazdır'; footer.prepend(printBtn);
    }
    if (printBtn) { printBtn.style.display = ''; printBtn.onclick = () => window.AppModules.PurchaseItemsUI.print(item); }

    // Select'leri doldur sonra seç
    fillPurchaseSelects();
    setTimeout(() => {
        const sel = (selId, val) => {
            const el = document.getElementById(selId);
            if (!el) return;
            // Kayıttaki değer artık tanımlı değilse (silinmiş tür/birim) kaybolmasın diye seçenek olarak eklenir.
            if (val && ![...el.options].some(o => o.value === val)) el.add(new Option(val, val));
            [...el.options].forEach(o => { o.selected = o.value === val; });
        };
        sel('purUnit', item.birim);
        if (!item.documentTypeCode) {
            const type = document.getElementById('purType');
            if (type) type.replaceChildren(new Option('Eski kayıt — belge türü belirtilmemiş', 'LEGACY_UNCLASSIFIED'));
        } else sel('purType', item.documentTypeCode);
        sel('purPriority', item.oncelik || 'Normal');
    }, 60);

    // Dosya input alanı
    const fileArea = document.getElementById('purFileInputArea');
    const fileInput = document.getElementById('purchaseFile');

    // Mevcut dosya listesi + akış geçmişi bölümleri
    const filesDiv = document.getElementById('purUploadedFilesList');
    const workflowDiv = document.getElementById('purWorkflowSection');

    if (mode === 'view') {
        // Alanları kilitle
        form.querySelectorAll('input:not([type="file"]), select, textarea')
            .forEach(el => { el.disabled = true; });
        if (fileArea) fileArea.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';

        // Mevcut dosyalar
        if (filesDiv) {
            filesDiv.style.display = 'block';
            filesDiv.innerHTML = _purFilesHTML(item, false); // EBYS-12: görüntüleme modunda ek silinmez
        }
        // Akış geçmişi
        if (workflowDiv) {
            workflowDiv.style.display = 'block';
            workflowDiv.innerHTML = _purWorkflowHTML(item);
        }

        // Form submit engelle
        form.onsubmit = (e) => e.preventDefault();

        // --- ONAY/RED AKSİYONLARI ---
        const me = window.currentUser?.name;
        const isTurn = item.workflow?.started && !item.workflow?.finished &&
            item.workflow.steps[item.workflow.currentStep]?.user === me;

        if (isTurn) {
            if (saveBtn) {
                saveBtn.style.display = 'block';
                saveBtn.classList.remove('btn-modern-save');
                saveBtn.classList.add('btn-success');
                saveBtn.innerHTML = '<i class="fas fa-check me-2"></i> Onayla';
                saveBtn.onclick = (e) => { e.preventDefault(); window.approveStep(item.id); };
            }
            // Red butonu ekle (footer'da iptal yanına)
            const footer = modal.querySelector('.modern-modal-footer');
            if (footer) {
                let rejectBtn = document.getElementById('purRejectBtn');
                if (!rejectBtn) {
                    rejectBtn = document.createElement('button');
                    rejectBtn.id = 'purRejectBtn';
                    rejectBtn.className = 'btn btn-danger shadow-sm ms-2';
                    rejectBtn.style.padding = '10px 25px';
                    rejectBtn.style.borderRadius = '10px';
                    rejectBtn.innerHTML = '<i class="fas fa-times me-2"></i> Reddet';
                    footer.insertBefore(rejectBtn, footer.firstChild);
                }
                rejectBtn.style.display = 'block';
                rejectBtn.onclick = (e) => { e.preventDefault(); window.rejectStep(item.id); };
            }
        } else {
            const rejectBtn = document.getElementById('purRejectBtn');
            if (rejectBtn) { rejectBtn.style.display = 'none'; rejectBtn.onclick = null; }
            if (saveBtn) saveBtn.onclick = null;
        }

    } else { // edit
        form.querySelectorAll('input:not([readonly]):not([type="file"]), select, textarea')
            .forEach(el => { el.disabled = false; });
        if (!Array.isArray(item.items)) document.getElementById('purItemsEditor')?.querySelectorAll('input, select, button')
            .forEach(el => { el.disabled = true; });
        if (fileArea) fileArea.style.display = 'block';
        if (fileInput) fileInput.value = '';
        if (saveBtn) {
            saveBtn.style.display = 'block';
            saveBtn.innerHTML = '<i class="fas fa-save me-2"></i> Değişiklikleri Kaydet';
            // [WHY]: Görüntüleme modunda bağlanan "Onayla" onclick'i düzenlemede kalıyor, kayıt yerine onay veriyordu (EBYS-02).
            saveBtn.onclick = null;
            saveBtn.classList.remove('btn-success');
            saveBtn.classList.add('btn-modern-save');
        }
        const staleRejectBtn = document.getElementById('purRejectBtn');
        if (staleRejectBtn) { staleRejectBtn.style.display = 'none'; staleRejectBtn.onclick = null; }

        // Mevcut dosyaları göster (silinebilir)
        if (filesDiv) {
            filesDiv.style.display = 'block';
            filesDiv.innerHTML = _purFilesHTML(item, _canManagePurchase(item) && !item.workflow?.started);
        }
        if (workflowDiv) {
            workflowDiv.style.display = 'block';
            workflowDiv.innerHTML = _purWorkflowHTML(item);
        }
        // Form submit → güncelle
        form.onsubmit = (e) => window.updatePurchaseRequest(e, id);
    }

    modal.style.display = 'block';
};

// Mevcut dosyalar HTML yardımcısı
function _purFilesHTML(item, canDelete) {
    const files = item.files || [];
    if (files.length === 0 && !canDelete) return '';

    const header = `
        <hr style="margin:14px 0 10px;">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">
            <i class="fas fa-paperclip me-1"></i> Ekler (${files.length})
        </div>`;

    if (files.length === 0) return header + '<p style="color:#aaa;font-size:12px;margin:0;">Henüz dosya eklenmedi.</p>';

    const rows = files.map((f, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
            <i class="fas fa-file-alt" style="color:#94a3b8;flex-shrink:0;"></i>
            <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <small style="color:#cbd5e1;flex-shrink:0;">${escapeHtml(f.uploadedAt || '')}</small>
            <a href="${escapeHtml(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer"
               style="padding:3px 9px;font-size:11px;border:1px solid #cbd5e1;border-radius:5px;color:#475569;text-decoration:none;">
                <i class="fas fa-download"></i>
            </a>
            ${canDelete ? `
            <button onclick="window.deleteRequestFile(${jsArg(item.id)}, ${i}, ${jsArg(f.url || f.name || '')})"
                style="padding:3px 9px;font-size:11px;border:1px solid #fca5a5;border-radius:5px;background:none;color:#ef4444;cursor:pointer;">
                <i class="fas fa-trash"></i>
            </button>` : ''}
        </div>`).join('');

    return header + rows;
}

// [BUGFIX] Bug 4: Chronological sorting via regex-first parsing & scrollable compact UI container with toggle
window.togglePurWorkflowLogs = function (btn) {
    const container = btn.previousElementSibling;
    if (!container) return;
    const hiddenRows = container.querySelectorAll('.pur-log-hidden');
    const isShowingAll = btn.getAttribute('data-shown') === 'true';
    if (isShowingAll) {
        hiddenRows.forEach(el => el.style.display = 'none');
        btn.setAttribute('data-shown', 'false');
        btn.innerHTML = `<i class="fas fa-chevron-down me-1"></i> Tümünü Gör (${hiddenRows.length} adım daha)`;
    } else {
        hiddenRows.forEach(el => el.style.display = 'flex');
        btn.setAttribute('data-shown', 'true');
        btn.innerHTML = `<i class="fas fa-chevron-up me-1"></i> Daralt`;
    }
};

// [BUGFIX] Bug 4: Enhanced timestamp parsing with robust fallback chain
// [WHY]: Mixed timestamp formats (ISO, tr-TR, Unix ms) cause incorrect sorting and missing logs.
// [HOW]: Use a multi-strategy parser that tries ISO → tr-TR → Unix timestamp, with consistent fallback.
function _purWorkflowHTML(item) {
    const ebysHistory = item.workflow?.history || [];
    const oldAkis = item.akis || [];

    // [BUGFIX] Bug 4: Chronological timestamp parser with fallback chain
    // Priority: ISO string → tr-TR DD.MM.YYYY → Unix timestamp → fallback
    const parseRawDate = (str, fallbackMs) => {
        if (str === null || str === undefined) return fallbackMs || Date.now();
        if (typeof str === 'number') return str;
        
        const strVal = String(str).trim();
        
        // Try ISO 8601 format first (e.g., 2024-01-15T10:30:00.000Z)
        if (strVal.includes('T') && strVal.includes('Z')) {
            const isoDate = new Date(strVal);
            if (!isNaN(isoDate.getTime())) return isoDate.getTime();
        }
        
        // Try tr-TR format: DD.MM.YYYY HH:mm:ss or DD/MM/YYYY HH:mm:ss
        const trTRMatch = strVal.match(/(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})[^\d]*(\d{1,2})[:\s](\d{1,2})(?::(\d{1,2}))?/);
        if (trTRMatch) {
            const [, day, month, year, hour, minute, second] = trTRMatch;
            const date = new Date(year, parseInt(month, 10) - 1, day, parseInt(hour, 10), parseInt(minute, 10), second ? parseInt(second, 10) : 0);
            if (!isNaN(date.getTime())) return date.getTime();
        }
        
        // Try Unix timestamp (milliseconds)
        const unixTime = parseInt(strVal, 10);
        if (!isNaN(unixTime) && unixTime > 1000000000000) {
            return unixTime;
        }
        
        // Final fallback to Date constructor
        const parsed = new Date(strVal);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
        
        return fallbackMs || Date.now();
    };

    // [BUGFIX] Bug 4: Ensure every step transition is logged
    // Merge EBYS history and legacy akis, normalizing both to a unified log format
    const allLogs = [
        ...ebysHistory.map((h, idx) => ({
            tarih: new Date(h.timestamp).toLocaleString('tr-TR'),
            yapan: h.actor || 'Sistem',
            islem: `${h.action === 'transition' ? '🔄 State Geçişi' :
                h.action === 'checkpoint' ? '📍 Checkpoint' :
                    h.action === 'rollback' ? '🔙 Rollback' :
                        h.action === 'create' ? '📋 Oluşturuldu' :
                            h.action === 'withdraw' ? '⏸️ Geri Çekildi' :
                                h.action === 'approve' ? '✅ Onaylandı' :
                                    h.action === 'reject' ? '❌ Reddedildi' : '📝 İşlem'}: ${h.note || ''}`,
            not: h.metadata?.checkpointReason || h.metadata?.reason || '',
            type: 'ebys',
            rawDate: parseRawDate(h.timestamp, Date.now() - idx),
            source: 'ebys_history'
        })),
        ...oldAkis.map((a, idx) => ({
            ...a,
            // [BUGFIX] Bug 4: Fix potential duplicate 'note' field
            not: a.not || a.note || '',
            type: 'legacy',
            rawDate: parseRawDate(a.tarih, Date.now() - idx),
            source: 'legacy_akis'
        }))
    ].sort((a, b) => b.rawDate - a.rawDate);

    if (allLogs.length === 0) return '';

    // [WHY]: Tüm renkler sabit hex'ti (#f8fafc, #94a3b8, #1e293b, vb.); koyu temada modal koyu zemine döndüğünde
    //        özellikle "islem" metni (#1e293b, açık zemin için tasarlanmış neredeyse siyah bir ton) okunamıyordu.
    // [HOW]: Aynı görsel değerleri karşılayan tema değişkenleriyle birebir değiştirildi (fonksiyon/mantık aynı kaldı).
    // [BUGFIX] Bug 4: Fixed hidden row count - show first 3 logs, hide rest (total - 3)
    const visibleCount = 3;
    const rows = allLogs.map((a, idx) => `
        <div class="${idx >= visibleCount ? 'pur-log-hidden' : ''}" style="display:${idx >= visibleCount ? 'none' : 'flex'};flex-direction:column;padding:8px 0;border-bottom:1px solid var(--color-border-light);font-size:12px;">
            <div style="display:flex;gap:10px;">
                <span style="color:var(--color-text-hint);min-width:130px;flex-shrink:0;">${escapeHtml(a.tarih || '')}</span>
                <span style="color:var(--color-text-muted);min-width:90px;flex-shrink:0;font-weight:600;">${escapeHtml(a.yapan || '')}</span>
                <span style="color:var(--color-text);">${escapeHtml(a.islem || '')}</span>
                ${a.type === 'ebys' ? '<span style="background:var(--color-info-light);color:var(--color-info);padding:2px 6px;border-radius:4px;font-size:10px;margin-left:8px;">EBYS</span>' : ''}
            </div>
            ${a.not ? `<div style="margin-top:4px;padding:6px 10px;background:var(--color-surface-alt);border-radius:6px;color:var(--color-text-muted);font-style:italic;font-size:11px;">
                💬 ${escapeHtml(a.not)}
            </div>` : ''}
        </div>`).join('');

    // [BUGFIX] Bug 4c: max-height ve overflow-y:auto ile kompakt UI kısıtlaması, varsayılan son 3 adım ve Tümünü Gör butonu
    const remainingCount = allLogs.length - visibleCount;
    const toggleBtn = allLogs.length > visibleCount ? `
        <button type="button" class="btn btn-sm btn-link text-primary p-0 mt-2" data-shown="false" onclick="window.togglePurWorkflowLogs(this)" style="font-size:11px;text-decoration:none;font-weight:600;">
            <i class="fas fa-chevron-down me-1"></i> Tümünü Gör (${remainingCount > 0 ? remainingCount : allLogs.length - visibleCount} adım daha)
        </button>` : '';

    return `
        <hr style="margin:14px 0 10px;">
        <div style="font-size:12px;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">
            <i class="fas fa-history me-1"></i> Süreç Geçmişi (${allLogs.length} kayıt)
        </div>
        <div style="max-height: 220px; overflow-y: auto; padding-right: 4px; border: 1px solid var(--color-border-light); border-radius: 8px;">
            ${rows}
        </div>
        ${toggleBtn}`;
}

// ─────────────────────────────────────────────────────────────
// TALEP GÜNCELLE (edit modunda kaydet)
// ─────────────────────────────────────────────────────────────
window.updatePurchaseRequest = async function (e, id) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (_purchaseTextBlocked()) return;

    const item = _findPurchase(id);
    if (!item) { if (typeof showAppAlert === 'function') showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    if (!_canManagePurchase(item)) { _denyManage(); return; }
    // Faz 4B · J10: akış başladıktan sonra talebin içeriği değiştirilemez (kurallar reddeder; onaylanan içerik sabit kalmalı)
    if (item.workflow?.started === true || item.exchangeRate) {
        if (typeof showAppAlert === 'function') showAppAlert('Mali anlık görüntüsü olan veya akışı süren talep düzenlenemez. Değişiklik için yeni talep açın.', 'warning');
        return;
    }
    const undo = _snapshotPurchase(item);
    let purchaseLines;
    try { purchaseLines = Array.isArray(item.items) ? window.AppModules.PurchaseItemsUI.read() : null; }
    catch (error) { if (typeof showAppAlert === 'function') showAppAlert(error.message, 'warning'); return; }
    let budget = null;
    if (purchaseLines) {
        try { budget = window.AppModules.PurchaseItemsUI.readBudget(); }
        catch (error) { if (typeof showAppAlert === 'function') showAppAlert(error.message, 'warning'); return; }
    }

    // Yeni dosya yükleme
    const fileInput = document.getElementById('purchaseFile');
    if (fileInput?.files?.length) {
        const newFiles = await _uploadOrAsk(fileInput.files);
        if (newFiles === null) { undo(); if (typeof showAppAlert === 'function') showAppAlert('Değişiklikler kaydedilmedi.', 'info'); return; }
        {
            const mapped = newFiles.map(f => ({
                name: f.name, url: f.url,
                uploadedAt: new Date().toLocaleString('tr-TR'),
                uploadedBy: window.currentUser?.name || 'Bilinmeyen'
            }));
            if (!item.files) item.files = [];
            item.files.push(...mapped);
        }
    }

    // Alanları güncelle
    item.urun = document.getElementById('purName')?.value || item.urun;
    item.adet = purchaseLines ? purchaseLines.items[0].quantity : item.adet;
    item.birim = document.getElementById('purUnit')?.value || item.birim;
    if (purchaseLines) item.tur = purchaseLines.items[0].category;
    item.butce = budget ? budget.amount : (Number(document.getElementById('purBudget')?.value) || item.butce);
    if (budget) { item.budgetMode = budget.mode; item.budgetEstimateRates = budget.estimateRates; }
    if (purchaseLines) { item.items = purchaseLines.items; item.totals = purchaseLines.totals; }
    item.oncelik = document.getElementById('purPriority')?.value || item.oncelik;
    item.aciklama = document.getElementById('purDesc')?.value || item.aciklama;

    // Log
    if (!item.akis) item.akis = [];
    item.akis.push({
        islem: 'Talep güncellendi',
        yapan: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'Kullanıcı',
        uid: window.userAuth?.uid || '',   // J11.5
        tarih: new Date().toLocaleString('tr-TR')
    });

    try {
        if (!(await _savePurchase(item, undo))) {
            if (typeof showAppAlert === 'function') showAppAlert('Talep güncellenemedi; değişiklikler geri alındı.', 'error');
            return;
        }
        window.closePurchaseModal();
        if (typeof renderPurchaseModule === 'function') renderPurchaseModule();
        if (typeof showAppAlert === 'function') showAppAlert('Talep başarıyla güncellendi.', 'success');
    } catch (err) {
        undo();
        console.error('Güncelleme hatası:', err);
        if (typeof showAppAlert === 'function') showAppAlert('Kayıt hatası oluştu!', 'error');
    }
};

// ─────────────────────────────────────────────────────────────
// GERİ ÇEK / DURDUR — Personel akışı durdurur, taslak moduna alır
// ─────────────────────────────────────────────────────────────
// [BUGFIX] Bug 1: Complete workflow state reset & targeted save on withdraw
// withdrawWorkflow, cancelPurchaseRequest'in başlamış akış dalının çağıranı olmayan bir kopyasıydı; ayrışmasın diye oraya yönlendirir.
window.withdrawWorkflow = id => window.cancelPurchaseRequest(id);

// ─────────────────────────────────────────────────────────────
// DOSYA SİL — Admin, showCustomConfirm ile sorar
// ─────────────────────────────────────────────────────────────
window.deleteRequestFile = async function (requestId, fileIndex, fileRef) {
    const onay = await showCustomConfirm(
        'Dosyayı Sil',
        'Bu dosya kalıcı olarak silinecektir. Emin misiniz?'
    );
    if (!onay) return;

    const item = _findPurchase(requestId);
    if (!item || !item.files) return;
    if (!_canManagePurchase(item)) { _denyManage(); return; }
    if (item.workflow?.started) { if (typeof showAppAlert === 'function') showAppAlert('Akış devam ederken ek silinemez.', 'warning'); return; }
    // Dosya, gösterildiği andaki indeks yerine url/ad ile bulunur (liste bu arada değişmiş olabilir).
    const pos = fileRef ? item.files.findIndex(f => (f.url || f.name) === fileRef) : fileIndex;
    if (pos < 0 || !item.files[pos]) { if (typeof showAppAlert === 'function') showAppAlert('Dosya bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    const undo = _snapshotPurchase(item);

    item.files.splice(pos, 1);

    if (!item.akis) item.akis = [];
    item.akis.push({
        islem: 'Ek dosya silindi',
        yapan: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'Admin',
        uid: window.userAuth?.uid || '',   // J11.5
        tarih: new Date().toLocaleString('tr-TR')
    });

    if (!(await _savePurchase(item, undo))) { if (typeof showAppAlert === 'function') showAppAlert('Dosya silinemedi.', 'error'); return; }

    // Modal açıksa dosya listesini yerinde güncelle
    const filesDiv = document.getElementById('purUploadedFilesList');
    if (filesDiv && filesDiv.style.display !== 'none') {
        filesDiv.innerHTML = _purFilesHTML(item, true);
    }
    if (typeof showAppAlert === 'function') showAppAlert('Dosya silindi. (Depolamadaki dosyanın kendisi silinmez.)', 'success');
};

// ─────────────────────────────────────────────────────────────
// TALEBİ SİL — Sadece Admin, showCustomConfirm ile sorar
// ─────────────────────────────────────────────────────────────
window.deletePurchaseRequest = async function (id) {
    const item = _findPurchase(id);
    if (!item) return;
    // [WHY]: Faz 4 · J1 (M1) — Rules v2'de satın alma silme yalnız admin'e ait; sahibine tanınan "akışı başlamamışsa sil"
    //        izni kuralla çelişiyordu (kayıt reddedilirdi). Personel talebini iptal edebilir (cancelPurchaseRequest).
    if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
        if (typeof showAppAlert === 'function') showAppAlert('🔒 Talep silme yöneticiye aittir; talebinizi "İptal Et" ile geri çekebilirsiniz.', 'error');
        return;
    }

    const onay = await showCustomConfirm(
        'Talebi Kalıcı Sil',
        `"${item.urun || item.evrakNo}" talebi kalıcı olarak silinecektir. Bu işlem geri alınamaz. Onaylıyor musunuz?`
    );
    if (!onay) return;

    if (!(await window.writeOk(window.removeItem('purchaseOrders', item.id)))) { if (typeof showAppAlert === 'function') showAppAlert('Talep silinemedi.', 'error'); return; }
    if (typeof renderPurchaseModule === 'function') renderPurchaseModule();
    if (typeof showAppAlert === 'function') showAppAlert('Talep silindi.', 'success');
};

// ─────────────────────────────────────────────────────────────
// TALEBİ İPTAL ET — Kullanıcı talebi pasife çeker, silmez.
// ─────────────────────────────────────────────────────────────
// [BUGFIX] Bug 1: Complete reset & correct 'Taslak' status when withdrawing started workflow
window.cancelPurchaseRequest = async function (id) {
    const item = _findPurchase(id);
    if (!item) return;
    if (!_canManagePurchase(item)) { _denyManage(); return; }

    const isStarted = item.workflow?.started === true;

    if (isStarted) {
        const onay = await showCustomConfirm(
            'Talebi Geri Çek',
            `"${item.urun || item.evrakNo}" talebini geri çekip taslak moduna almak istediğinize emin misiniz?`
        );
        if (!onay) return;
        const undo = _snapshotPurchase(item);

        item.durum = 'Taslak';
        const prevHistory = item.workflow?.history || [];
        const prevAkis = item.akis || [];

        item.workflow = {
            id: item.workflow?.id || ('workflow_' + Date.now()),
            started: false,
            finished: false,
            currentStep: 0,
            currentState: window.WorkflowEngine?.states?.INITIATION || 'initiation',
            status: 'draft',
            steps: [],
            history: [
                ...prevHistory,
                {
                    action: 'withdraw',
                    actor: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'Kullanıcı',
                    uid: window.userAuth?.uid || '',   // J11.5
                    timestamp: new Date().toISOString(),
                    from: item.workflow?.currentState || 'active',
                    to: window.WorkflowEngine?.states?.INITIATION || 'initiation',
                    note: 'Talep geri çekildi (Taslak moduna alındı)'
                }
            ]
        };

        item.akis = [
            ...prevAkis,
            {
                islem: 'Talep Geri Çekildi (Taslak Moduna Alındı)',
                yapan: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'Kullanıcı',
                uid: window.userAuth?.uid || '',   // J11.5
                tarih: new Date().toLocaleString('tr-TR')
            }
        ];

        // Tek doküman, birleştirmesiz: eski workflow alt alanları (finished, suspendedAt…) Firestore'da kalmaz (DATA-14).
        if (!(await _savePurchase(item, undo))) { if (typeof showAppAlert === 'function') showAppAlert('Talep geri çekilemedi; değişiklik geri alındı.', 'error'); return; }

        if (typeof refreshUI === 'function') {
            refreshUI();
        } else if (typeof renderPurchaseModule === 'function') {
            renderPurchaseModule();
        }

        if (typeof showAppAlert === 'function') showAppAlert('Talep geri çekildi (Taslak moduna alındı).', 'info');
    } else {
        const onay = await showCustomConfirm(
            'Talebi Kalıcı Olarak İptal Et',
            `"${item.urun || item.evrakNo}" talebini tamamen iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
        );
        if (!onay) return;
        const undo = _snapshotPurchase(item);

        item.durum = 'İptal Edildi';
        if (item.workflow) {
            item.workflow.started = false;
            item.workflow.finished = true;
            item.workflow.currentState = window.WorkflowEngine?.states?.CANCELLED || 'cancelled';
            if (Array.isArray(item.workflow.steps)) {
                item.workflow.steps.forEach(step => { step.status = 'cancelled'; });
            }
        }

        if (!item.akis) item.akis = [];
        item.akis.push({
            islem: 'Talep İptal Edildi',
            yapan: (window.Ownership && window.Ownership.selfName()) || window.currentUser?.name || 'Kullanıcı',
            uid: window.userAuth?.uid || '',   // J11.5
            tarih: new Date().toLocaleString('tr-TR')
        });

        if (!(await _savePurchase(item, undo))) { if (typeof showAppAlert === 'function') showAppAlert('Talep iptal edilemedi; değişiklik geri alındı.', 'error'); return; }

        if (typeof refreshUI === 'function') refreshUI();
        if (typeof showAppAlert === 'function') showAppAlert('Talep iptal edildi.', 'success');
    }
};

// ─────────────────────────────────────────────────────────────
// MODAL KAPAT — State temizle
// ─────────────────────────────────────────────────────────────
window.closePurchaseModal = function () {
    const modal = document.getElementById('purchaseModal');
    const form = document.getElementById('purchaseForm');
    const saveBtn = document.getElementById('purSaveBtn');
    const title = document.getElementById('purModalTitle');
    const filesDiv = document.getElementById('purUploadedFilesList');
    const wfDiv = document.getElementById('purWorkflowSection');
    const fileArea = document.getElementById('purFileInputArea');

    if (modal) modal.style.display = 'none';
    const printBtn = document.getElementById('purPrintBtn');
    if (printBtn) printBtn.style.display = 'none';

    // Alanları sıfırla
    if (form) {
        form.reset();
        form.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = false; });
        form.onsubmit = (e) => window.savePurchaseRequest(e);
        delete form.dataset.editId;
        delete form.dataset.purchaseRecordId;
    }

    // Dinamik bölümleri gizle
    if (filesDiv) { filesDiv.style.display = 'none'; filesDiv.innerHTML = ''; }
    if (wfDiv) { wfDiv.style.display = 'none'; wfDiv.innerHTML = ''; }
    if (fileArea) fileArea.style.display = 'block';
    if (saveBtn) {
        saveBtn.style.display = 'block';
        saveBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i> Talebi Kaydet';
    }
    if (title) title.innerHTML = '<i class="fas fa-file-invoice me-2"></i> Satın Alma Talebi';

    const rejectBtn = document.getElementById('purRejectBtn');
    if (rejectBtn) { rejectBtn.style.display = 'none'; rejectBtn.onclick = null; }
    _resetPurchaseFileInputs();

    if (saveBtn) {
        saveBtn.classList.remove('btn-success');
        saveBtn.classList.add('btn-modern-save');
        saveBtn.onclick = null; // updatePurchaseRequest'e form submit bakıyor zaten
    }
};

// Seçilmiş dosya listesi ve input'u bir önceki talepten taşınmasın (EBYS-01).
function _resetPurchaseFileInputs() {
    const fileList = document.getElementById('purFileList');
    const fileInput = document.getElementById('purchaseFile');
    if (fileList) fileList.innerHTML = '';
    if (fileInput) fileInput.value = '';
}

window.refreshPurchaseModule = function () {
    window.state = {
        purchasePage: window.purchasePage || 1,
        search: document.getElementById("purchaseSearch")?.value || ""
    };

    const data = getFilteredPurchaseData(window.data.purchaseOrders, window.state);

    renderPurchaseTable(data);
    renderStats(data);
    renderPagination(data.length);
};

// [BUGFIX] Bug 6: Wire renderServicesModule to the PubSub data event.
// [WHY]: The KPI counter correctly shows 9 items (populated from window.data.serviceRecords
//        via renderPurchaseStats), but serviceTableBody stays empty because renderServicesModule
//        is only called on tab-click (showAdminTab → purchaseTab). If the user is already on
//        the tab when Firebase data arrives, no re-render is triggered.
// [HOW]: Listen for the 'onInventoryDataUpdated' CustomEvent (fired by firebase-handler.js
//        startRealtimeSync for every snapshot). When serviceRecords or purchaseOrders change,
//        call renderServicesModule() so the table always reflects live data.
window.addEventListener('onInventoryDataUpdated', function (e) {
    const { collection } = e.detail || {};
    if (collection === 'serviceRecords' || collection === 'purchaseOrders') {
        if (typeof window.renderServicesModule === 'function') {
            window.renderServicesModule();
        }
        if (typeof window.renderPurchaseStats === 'function') {
            window.renderPurchaseStats();
        }
    }
    // Modal açıkken tanımlanan tür/birim anında listeye gelsin (görüntüleme modunda kilitli alanlara dokunulmaz).
    if (collection === 'productTypes' || collection === 'units') {
        const modal = document.getElementById('purchaseModal');
        const typeSel = document.getElementById('purType');
        if (modal && modal.style.display !== 'none' && typeSel && !typeSel.disabled) fillPurchaseSelects();
    }
});
