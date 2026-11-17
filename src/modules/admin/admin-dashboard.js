// 1. EN ÜSTE İTHALATLAR GELMELİ
import { fireDb, STOCK_AUTO_EMPTY } from '../../services/firebase-handler.js';
import { getFirestore, updateDoc, setDoc, collection, onSnapshot, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── 🚨 KRİTİK STOK FİLTRE VE YARDIMCI FONKSİYONLAR ──
window.currentCriticalFilter = 'all';

// CHART INSTANCE'LARI (Memory Leak Engellemek İçin)
let demirbasChartInstance = null;
let statsChartInstance = null;
let criticalStockGroupsByKey = new Map();

window.getCleanProductName = function (name) {
    if (!name) return "";
    // 1. Parantez veya köşeli parantez içini temizle: "YAZICI (WD45787249)" -> "YAZICI"
    let cleaned = name.replace(/\s*[\(\[].*?[\)\]]/g, '');

    // 2. Sondaki alfanumerik seri numaralarını kaldır (en az bir rakam ve bir harf içeren >= 4 karakterli son kelime)
    let words = cleaned.trim().split(/\s+/);
    if (words.length > 1) {
        let lastWord = words[words.length - 1];
        const isSerial = /[0-9]/.test(lastWord) && /[A-Z]/.test(lastWord) && lastWord.length >= 4;
        if (isSerial) {
            words.pop();
            cleaned = words.join(" ");
        }
    }
    return cleaned.trim();
};

window.customConfirmAlert = function (title, message) {
    const overlay = document.getElementById('customAlertOverlay');
    const confirmBtn = document.getElementById('alertConfirmBtn');
    const cancelBtn = document.getElementById('alertCancelBtn');
    if (overlay && confirmBtn && cancelBtn) {
        const titleEl = document.getElementById('alertTitle');
        const msgEl = document.getElementById('alertMessage');
        if (titleEl) titleEl.innerText = title;
        if (msgEl) msgEl.innerText = message;
        overlay.style.display = 'flex';
        return new Promise((resolve) => {
            // [WHY]/[HOW]: KJ-6 — tekrar açılışta bindActions çözümleyicileri yeniler, dinleyici çoğalmaz.
            confirmBtn.dataset.action = 'confirmDashboardAlert';
            cancelBtn.dataset.action = 'cancelDashboardAlert';
            window.bindActions(overlay, {
                confirmDashboardAlert: () => {
                    overlay.style.display = 'none';
                    resolve(true);
                },
                cancelDashboardAlert: () => {
                    overlay.style.display = 'none';
                    resolve(false);
                },
            });
        });
    }
    if (typeof window.showCustomConfirm === 'function') {
        try {
            return window.showCustomConfirm(title, message);
        } catch (e) {
            console.error("Error calling showCustomConfirm, falling back to native confirm", e);
        }
    }
    return Promise.resolve(confirm(title + "\n\n" + message));
};

window.cycleCriticalFilter = function () {
    const btn = document.getElementById('criticalToggleFilterBtn');
    if (!btn) return;

    if (window.currentCriticalFilter === 'all') {
        window.currentCriticalFilter = 'AZALDI';
        btn.innerText = 'Filtre: Azaldı ⚠️';
        btn.className = 'btn btn-sm btn-warning text-white fw-bold';
    } else if (window.currentCriticalFilter === 'AZALDI') {
        window.currentCriticalFilter = 'ÇOK KRİTİK';
        btn.innerText = 'Filtre: Çok Kritik 🚨';
        btn.className = 'btn btn-sm btn-danger fw-bold';
    } else if (window.currentCriticalFilter === 'ÇOK KRİTİK') {
        window.currentCriticalFilter = 'TÜKENDİ';
        btn.innerText = 'Filtre: Tükendi 🚫';
        btn.className = 'btn btn-sm btn-dark fw-bold';
    } else {
        window.currentCriticalFilter = 'all';
        btn.innerText = 'Filtre: Tümü';
        btn.className = 'btn btn-sm btn-outline-secondary fw-bold';
    }

    if (typeof window.renderCriticalStockTable === 'function') {
        window.renderCriticalStockTable();
    }
};

// ── 🚀 LOADING COORDINATOR ──
window.LoadingCoordinator = {
    // [WHY]: "settings" hiç dinlenmeyen bir koleksiyondu; ekran her açılışta 4 sn zaman aşımını bekliyordu (ARC-04).
    expectedCollections: ["b1", "b2", "b3", "requests", "purchaseOrders", "serviceRecords", "productTypes"],
    loadedCollections: new Set(),
    isRevealed: false,

    markLoaded(col) {
        if (this.isRevealed) return;
        this.loadedCollections.add(col);
        // console.log(`📦 LoadingCoordinator: ${col} loaded (${this.loadedCollections.size}/${this.expectedCollections.length})`);
        this.checkReady();
    },

    checkReady() {
        if (this.isRevealed) return;
        const allLoaded = this.expectedCollections.every(c => this.loadedCollections.has(c));
        if (allLoaded) {
            // Verilerin DOM'a tam yerleşmesi için minik bir nefes al
            setTimeout(() => this.reveal(), 300);
        }
    },

    reveal() {
        if (this.isRevealed) return;
        this.isRevealed = true;

        console.log("✨ Admin Panel: Tüm veriler senkronize edildi, ekran açılıyor.");

        const loader = document.getElementById('admin-premium-loader');
        const contentElements = document.querySelectorAll('.admin-content-hidden');

        // Sayfa ilk açılışında chart instance cache'i temizle
        // (Sayfa yenilense de eski referanslar kalmaz)
        window._dashCharts = {};

        // 1. ÖNCE TABI GÖSTER (Render için alan aç)
        if (typeof window.showAdminTab === 'function') {
            window.showAdminTab('dashboard-content');
        }

        // 2. İÇERİĞİ GÖRÜNÜR YAP
        contentElements.forEach(el => {
            el.classList.add('admin-content-visible');
        });

        // 3. LOADER'I KALDIR
        if (loader) {
            loader.classList.add('loader-hidden');
            setTimeout(() => {
                loader.style.display = 'none';
            }, 800);
        }

        // 4. GRAFİKLERİ VE TABLOLARI TEKRAR TETİKLE (Tam görünürlükte)
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            if (typeof window.renderDashboardStats === 'function') window.renderDashboardStats();
            if (typeof window.renderCriticalStockTable === 'function') window.renderCriticalStockTable();
            if (typeof window.renderAdminRequestTable === 'function') window.renderAdminRequestTable();
        }, 800); // Reveal başladıktan 800ms sonra (Animasyon ortasında)
    }
};

// Emniyet: 4 saniye sonra zorla aç (Firebase boşsa veya gecikirse)
setTimeout(() => {
    if (window.LoadingCoordinator && !window.LoadingCoordinator.isRevealed) {
        console.warn("⚠️ Admin Panel: Yükleme zaman aşımına uğradı, zorla açılıyor.");
        window.LoadingCoordinator.reveal();
    }
}, 4000);

window.FirebaseModules = {
    doc,
    updateDoc,
    setDoc,
    addDoc,
    deleteDoc,
    collection,
    onSnapshot,
    fireDb
};

window.isAdminPanel = true;

// [WHY]: admin-dashboard.js must preserve Firebase firestore functions (doc, setDoc, getDoc) loaded by firebase-handler.js.
// [HOW]: Object spread is used to merge current window.fbFunctions with local collection and onSnapshot references.
window.fbFunctions = {
    ...window.fbFunctions,
    collection,
    onSnapshot
};

window.fireDb = fireDb;

if (!window.data) {
    window.data = {};
}

// Eğer 'fireDb' değişkeni başka bir yerde tanımlı değilse:
if (!window.fireDb) {
    window.fireDb = getFirestore();
}

let watchChartInstance = null; // Eski grafiği silmek için hafızada tutuyoruz

// [WHY]: Toplu ekleme bellekteki diziye ekleyip tüm veritabanını yazıyordu ve hata olsa da başarı gösterebiliyordu (ADM-07).
// [HOW]: Yeni kayıtlar tek atomik batch'te eklenir (applyItemOps: ya hepsi ya hiçbiri); id makeId ile.
window.bulkAddB2Items = async function (itemsArray) {
    if (!Array.isArray(itemsArray) || itemsArray.length === 0) {
        console.error("Hata: Veri boş olmayan bir dizi (array) olmalıdır.");
        return false;
    }

    // Yeni verileri hazırla
    const formattedItems = itemsArray.map(item => ({
        id: item.id || `b2_${window.makeId()}`,
        sütun: item.sütun || '-',
        raf: item.raf || '-',
        ürün: item.ürün || '-',
        marka: item.marka || '-',
        adet: parseInt(item.adet) || 1,
        durumu: item.durumu || 'Kullanıma Hazır',
        tür: item.tür || item.type || '-',
        açıklama: item.açıklama || '-',
        lastUpdate: Date.now()
    }));

    try {
        const res = await window.writeOk(window.applyItemOps(formattedItems.map(item => ({ op: 'set', col: 'b2', item, mustBeNew: true }))));
        if (res === false) {
            if (typeof showAppAlert === 'function') showAppAlert("Ürünler eklenemedi; hiçbir kayıt yazılmadı.", "error");
            return false;
        }
        if (typeof showAppAlert === 'function') {
            showAppAlert(`${formattedItems.length} ürün başarıyla B2 deposuna eklendi.`);
        } else {
            alert(`${formattedItems.length} ürün eklendi.`);
        }
        if (typeof window.renderTable === 'function') window.renderTable('b2');
        return res;
    } catch (e) {
        console.error("Bulk ekleme hatası:", e);
        if (typeof showAppAlert === 'function') {
            showAppAlert("Ürünler eklenirken bir hata oluştu.", "error");
        }
    }
};

window.renderAdminRequestTable = function () {
    const tableBody = document.getElementById('adminPendingRequestsBody');
    const countBadge = document.getElementById('pendingRequestCount');
    if (!tableBody) return;

    // [WHY]: KJ-6 — talep verisi çalıştırılabilir JS içinde taşınmaz.
    // [HOW]: bindActions en yakın eylemin dataset değerini mevcut işleve iletir.
    window.bindActions(tableBody, {
        confirmRequest: el => window.confirmRequest(el.dataset.id),
        rejectRequest: el => window.rejectRequest(el.dataset.id),
        deleteRequest: el => window.deleteRequest(el.dataset.id),
    });
    const esc = window.escapeHtml;
    // B-4: personelin gönderilmemiş taslakları listelenmez (yönetici üzerinde işlem yapamaz); yalnız sayısı bilgi satırında.
    const isDraftRequest = r => ['DRAFT', 'TASLAK'].includes(String((r && r.durum) || '').trim().toUpperCase());
    const everyRequest = window.data.requests || [];
    const allRequests = everyRequest.filter(r => !isDraftRequest(r));
    const draftNote = document.getElementById('adminDraftRequestNote');
    if (draftNote) {
        const drafts = everyRequest.length - allRequests.length;
        draftNote.textContent = drafts ? `Personelin gönderilmemiş ${drafts} taslak talebi var (listelenmez; gönderildiğinde burada görünür).` : '';
        draftNote.hidden = drafts === 0;
    }
    tableBody.innerHTML = '';
    let pendingCount = 0;
    const kpi = { approved: 0, completed: 0, rejected: 0 };   // kartın kendi göstergeleri (taslaklar zaten listede yok)

    allRequests.forEach((req, index) => {
        const rawDurum = req.durum || "BEKLEMEDE";
        const durumStr = rawDurum.toString().toUpperCase();

        // Başarı durumları (approved veya ONAYLANDI)
        const isApproved = durumStr === 'APPROVED' || durumStr === 'ONAYLANDI';
        // Red durumları (rejected veya REDDEDİLDİ)
        const isRejected = durumStr === 'REJECTED' || durumStr === 'REDDEDİLDİ';
        // Tamamlanma durumları (completed veya TESLİM ALINDI)
        const isCompleted = durumStr === 'COMPLETED' || durumStr === 'TESLİM ALINDI';
        // Bekleme durumları
        const isDraft = durumStr === 'DRAFT' || durumStr === 'TASLAK';
        // [WHY]: Geri çekilmiş (taslak) talepler 'Bekliyor' görünüp onaylanabiliyordu (ITSM-05).
        const isPending = !isApproved && !isRejected && !isCompleted && !isDraft;

        if (isPending) pendingCount++;
        if (isApproved) kpi.approved++;
        if (isCompleted) kpi.completed++;
        if (isRejected) kpi.rejected++;

        let badgeHTML = '';
        if (isApproved) {
            badgeHTML = `<span class="p-badge p-badge-success" style="background:#d1fae5; color:#065f46; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-check-circle"></i> ONAYLANDI
                         </span>`;
        } else if (isRejected) {
            badgeHTML = `<span class="p-badge p-badge-danger" style="background:#fee2e2; color:#991b1b; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-times-circle"></i> REDDEDİLDİ
                         </span>${req.redGerekcesi ? `<div class="req-reject-reason">${esc(req.redGerekcesi)}</div>` : ''}`;
        } else if (isCompleted) {
            badgeHTML = `<span class="p-badge p-badge-completed" style="background: var(--badge-completed-bg); color: var(--badge-completed-text); border: 1px solid var(--badge-completed-border); padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-check-double"></i> TESLİM ALINDI
                         </span>`;
        } else if (isDraft) {
            badgeHTML = `<span class="p-badge" style="background:#f1f5f9; color:#475569; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">TASLAK</span>`;
        } else {
            badgeHTML = `<span class="p-badge p-badge-waiting">
                            <i class="fas fa-clock"></i> BEKLEMEDE
                         </span>`;
        }

        tableBody.innerHTML += `
            <tr class="align-middle">
                <td class="ps-3">
                    <div style="font-size: 11px; color: var(--color-text-muted); font-weight: 500;">${esc(req.tarih || '-')}</div>
                </td>
                <td>
                    <div style="font-size: 14px; font-weight: 600; color: var(--color-text);">${esc(req.personel || '-')}</div>
                </td>
                <td>
                    <div style="font-weight: 600; font-size: 14px; color: var(--color-text);">${esc(req.ürün || '-')}</div>
                    <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">
                        <i class="fas fa-layer-group me-1"></i> ${esc(req.adet || 1)} Adet
                    </div>
                </td>
                <td class="text-center">
                    ${badgeHTML}
                </td>
                <td class="text-end pe-3">
                    <div class="d-flex justify-content-end gap-2" style="flex-wrap: wrap; row-gap: 6px;">
                        ${isPending ? `
                            <button data-action="confirmRequest" data-id="${escapeHtml(req.id)}" class="p-btn-icon play" title="Onayla">
                                <i class="fas fa-check"></i>
                            </button>
                            <button data-action="rejectRequest" data-id="${escapeHtml(req.id)}" class="p-btn-icon delete" title="Reddet">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : `
                            <button data-action="deleteRequest" data-id="${escapeHtml(req.id)}" class="p-btn-icon delete" title="Kayıttan Sil">
                                <i class="fas fa-trash"></i>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    });

    if (countBadge) {
        countBadge.innerText = pendingCount;
        countBadge.className = pendingCount > 0 ? "badge rounded-pill bg-danger shadow-sm" : "badge rounded-pill bg-secondary shadow-sm";
    }
    // Faz 3: kartın kendi göstergeleri — Bekleyen / Teslim Bekliyor (onaylı) / Teslim Alındı / Reddedilen
    [['reqKpiPending', pendingCount], ['reqKpiApproved', kpi.approved], ['reqKpiCompleted', kpi.completed], ['reqKpiRejected', kpi.rejected]]
        .forEach(([id, n]) => { const el = document.getElementById(id); if (el) el.textContent = String(n); });

    if (allRequests.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-5">✅ Talep bulunmuyor.</td></tr>';
    }
};

// Faz 6 · UI-01: Operasyon Merkezi — Hızlı Envanter Çıkış Masası.
// [WHY]: "Bekleyen Envanter Talepleri" Talep Ve Süreçler sekmesine taşınınca Operasyon Merkezi'nde
//        açılan alana, son çıkış hareketlerini özetleyen hafif bir masa eklendi (B3 hareket defterinden).
// [HOW]: Index tasarım diline uygun olarak tarih/personel ikonları ve .p-badge adet rozetiyle listeler.
window.renderQuickExitDesk = function () {
    const tableBody = document.getElementById('quickExitDeskBody');
    if (!tableBody) return;

    const esc = window.escapeHtml;
    const entries = (window.data.b3 || [])
        .map(e => window.Schema.normalizeB3(e))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 8);

    if (entries.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted p-4" style="background:var(--color-surface);"><i class="fas fa-inbox fa-2x mb-2 d-block opacity-25"></i>Henüz çıkış hareketi yok.</td></tr>';
        return;
    }

    tableBody.innerHTML = entries.map(n => `
        <tr style="border-bottom: 1px solid var(--color-border-light); transition: background 0.15s ease;">
            <td style="padding: 11px 16px; font-size: 12.5px; white-space: nowrap; color: var(--color-text-muted);">
                <i class="far fa-calendar-alt me-1 text-primary" style="opacity: 0.7;"></i>${esc(n.tarih || '-')}
            </td>
            <td style="padding: 11px 16px; font-size: 13px; font-weight: 600; color: var(--color-text);">
                <i class="far fa-user me-1 text-muted" style="font-size: 11px;"></i>${esc(n.alanKisi || '-')}
            </td>
            <td style="padding: 11px 16px; font-size: 13px; color: var(--color-text);">
                ${esc(n.urunAciklama || '-')}
            </td>
            <td class="text-end" style="padding: 11px 16px; white-space: nowrap;">
                <span class="p-badge" style="background: var(--color-primary-light, #eff6ff); color: var(--color-primary, #3b82f6); font-weight: 700; padding: 4px 10px; border-radius: 12px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;">
                    <i class="fas fa-cube" style="font-size: 10px;"></i> ${esc(n.adet || 1)}
                </span>
            </td>
        </tr>
    `).join('');
};

// [WHY]: Envanter çıkış modalı (#exitModal, ui-components.js) yalnız index.html'de var; admin panelinde
//        yeniden kurmak yerine tek tık ile operatör ekranına gönderip çıkışı doğrudan orada açıyoruz.
// [HOW]: sessionStorage bayrağı index.html'nin script.js açılışında okunur (bkz. script.js DOMContentLoaded).
window.quickExitToIndex = function () {
    try { sessionStorage.setItem('pendingQuickExit', '1'); } catch (e) { /* depolama kapalıysa sorun değil */ }
    window.location.href = 'index.html';
};

// [WHY]: "Toplu Çıkış / Sepet" hızlı çıkış masasının ikinci aksiyonu; sepet/çoklu seçim akışı henüz
//        tasarlanmadı (bkz. Faz 6 planı). Yanlış beklenti oluşturmamak için şimdilik net bir bilgi verir.
window.openBulkExitComingSoon = function () {
    if (typeof showAppAlert === 'function') {
        showAppAlert('📦 Toplu Çıkış / Sepet özelliği yakında eklenecektir.', 'info');
    } else {
        alert('Toplu Çıkış / Sepet özelliği yakında eklenecektir.');
    }
};

// 3. FİREBASE DİNLEYİCİSİ
// Hem envanteri hem de çıkışları/talepleri dinlemek için döngüye alıyoruz
// 3. FİREBASE DİNLEYİCİSİ (MEVCUT YAPI KORUNDU)
// Koleksiyon listesine "purchaseOrders" ve "serviceRecords" eklendi
// REDUNDANT LISTENER REMOVED:
// Önceden burada bulunan onSnapshot döngüsü (inventory, b3, vb. dinleyen) kaldırılmıştır.
// Artık tüm veriler firebase-handler.js içindeki tek bir noktadan dinlenmekte ve
// 'onInventoryDataUpdated' eventi ile UI güncellemeleri tetiklenmektedir (PubSub mimarisi).

// [WHY]: Kök settings/productTypes dinleyicisi kaldırıldı; ürün türleri firebase-handler üzerinden ${COLLECTION_ROOT}/productTypes/items'tan gelir (ADM-02).

// 1. ÜRÜN TÜRÜ KURALI (Sarf geçmiyorsa demirbaş say)
window.processIsDemirbas = function (item) {
    if (item.isDemirbas === true || item.isDemirbas === "true") return true;
    if (item.isDemirbas === false || item.isDemirbas === "false") return false;
    const urunAdi = (item.ürün || item.name || "").toLowerCase();
    if (urunAdi.includes("sarf")) return false;
    return true;
}

// 4. DEMİRBAŞ DETAY GRAFİĞİ (BAR)
window.renderDemirbasDetailChart = function (demirbasDetay) {
    let canvas = document.getElementById('demirbasChart');

    if (!canvas) {
        const card = document.querySelector('.card:nth-child(1)'); // 1. Kart
        if (card) {
            const wrapper = document.createElement('div');

            // --- KATLİAM GİBİ CSS SINIRLAMASI ---
            wrapper.style.height = '300px';
            wrapper.style.maxHeight = '300px'; // Maksimum yüksekliği kilitledik
            wrapper.style.overflow = 'hidden'; // Taşmaları gizle
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';

            canvas = document.createElement('canvas');
            canvas.id = 'demirbasChart';
            canvas.style.maxHeight = '100%'; // Canvas'ın dışarı fırlamasını engelle

            wrapper.appendChild(canvas);
            card.appendChild(wrapper);
        } else return;
    }

    if (typeof Chart === 'undefined') return;

    const labels = Object.keys(demirbasDetay);
    const values = Object.values(demirbasDetay);

    if (demirbasChartInstance) demirbasChartInstance.destroy();

    demirbasChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Adet',
                data: values,
                backgroundColor: '#3498db',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false // Bu ayar wrapper yüksekliğine itaat etmesini zorunlu kılar
        }
    });
}

// 5. ENVANTER DAĞILIMI GRAFİĞİ (PIE)
window.renderStatsChart = function (demirbas, sarf) {
    let canvas = document.getElementById('statsChart');

    if (!canvas) {
        const card = document.querySelector('.card:nth-child(2)'); // 2. Kart
        if (card) {
            // SONSUR UZAMAYI ENGELLEYEN KAPSAYICI (WRAPPER)
            const wrapper = document.createElement('div');
            wrapper.style.height = '280px'; // Yüksekliği burada kilitliyoruz
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';

            canvas = document.createElement('canvas');
            canvas.id = 'statsChart';

            wrapper.appendChild(canvas);
            card.appendChild(wrapper);
        } else return;
    }

    if (typeof Chart === 'undefined') return;

    if (statsChartInstance) statsChartInstance.destroy();

    statsChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Demirbaş', 'Sarf'],
            datasets: [{
                data: [demirbas, sarf],
                backgroundColor: ['#2ecc71', '#e67e22']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// admin-dashboard.js içinde tablo oluşturma kısmı
window.renderProductTypesTable = function () {
    const listBody = document.getElementById('productTypeTableBody');
    const defListBody = document.getElementById('adminDefProductTypeTableBody');

    // [WHY]: KJ-6 — iki tür tablosunda aynı delegasyon sözleşmesi kullanılır.
    // [HOW]: Boolean nitelik eski boolean argümana açık karşılaştırmayla dönüştürülür.
    for (const body of [listBody, defListBody]) window.bindActions(body, {
        editProductType: el => window.editProductType(el.dataset.id, el.dataset.name, el.dataset.demirbas === 'true'),
        deleteProductType: el => window.deleteProductType(el.dataset.id),
    });
    const types = window.getActiveProductTypes();
    if (listBody) listBody.innerHTML = '';
    if (defListBody) defListBody.innerHTML = '';

    types.forEach((type) => {
        // Firebase ID'si yoksa veya null ise atla
        if (!type.id) return;

        const isDemirbas = type.isDemirbas === true || type.isDemirbas === "true";

        // --- ESKİ TABLO (3 Sütunlu) ---
        if (listBody) {
            listBody.innerHTML += `
                <tr class="align-middle">
                    <td class="ps-3" style="width: 40%;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-tag me-2 text-primary opacity-75"></i>
                            <span class="fw-bold text-dark">${escapeHtml(type.name)}</span>
                        </div>
                    </td>
                    <td class="text-center" style="width: 30%;">
                        <span class="badge ${isDemirbas ? 'bg-danger' : 'bg-success'} text-white rounded-pill px-3 py-2" style="font-size: 0.7rem; font-weight: 600;">
                            <i class="fas ${isDemirbas ? 'fa-shield-alt' : 'fa-box'} me-1"></i>
                            ${isDemirbas ? 'DEMİRBAŞ' : 'SARF MALZEME'}
                        </span>
                    </td>
                    <td class="text-end pe-3">
                        <div class="action-buttons justify-content-end">
                            <button data-action="editProductType" data-id="${escapeHtml(String(type.id))}" data-name="${escapeHtml(String(type.name))}" data-demirbas="${isDemirbas}" class="btn-action btn-buy shadow-sm" title="Düzenle">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button data-action="deleteProductType" data-id="${escapeHtml(String(type.id))}" class="btn-action btn-passive shadow-sm" title="Sil">
                                <i class="fas fa-trash fa-xs"></i>
                            </button>
                        </div>
                    </td>                
                </tr>
            `;
        }

        // --- YENİ TABLO (4 Sütunlu: Tür, Kategori, Durum, İşlem) ---
        if (defListBody) {
            defListBody.innerHTML += `
                <tr class="align-middle">
                    <td class="ps-3">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-tag me-2 text-info opacity-75"></i>
                            <span class="fw-bold text-dark">${escapeHtml(type.name)}</span>
                        </div>
                    </td>
                    <td class="text-center">
                        <span class="badge ${isDemirbas ? 'bg-danger' : 'bg-success'} text-white rounded-pill px-3 py-1" style="font-size: 0.65rem;">
                            ${isDemirbas ? 'DEMİRBAŞ' : 'SARF MALZEME'}
                        </span>
                    </td>
                    <td class="text-center">
                        <!-- Durum sütunu isteğe bağlı olarak boş bırakıldı -->
                        <span class="text-muted small">—</span>
                    </td>
                    <td class="text-end pe-3">
                        <div class="action-buttons justify-content-end">
                            <button data-action="editProductType" data-id="${escapeHtml(String(type.id))}" data-name="${escapeHtml(String(type.name))}" data-demirbas="${isDemirbas}" class="btn-action btn-buy shadow-sm" title="Düzenle">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button data-action="deleteProductType" data-id="${escapeHtml(String(type.id))}" class="btn-action btn-passive shadow-sm" title="Sil">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });

    if (types.length === 0) {
        if (listBody) listBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted p-4">Tanımlı ürün türü bulunamadı.</td></tr>';
        if (defListBody) defListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted p-4">Tanımlı ürün türü bulunamadı.</td></tr>';
    }
};

// Ürün türü Düzenle
window.editProductType = function (id, name, isDemirbas) {
    const modal = document.getElementById('editProductTypeModal');
    const idInput = document.getElementById('editTypeId'); // Artık burada Firebase ID tutulacak
    const nameInput = document.getElementById('editTypeName');
    const checkInput = document.getElementById('editIsDemirbas');

    if (modal && idInput && nameInput && checkInput) {
        idInput.value = id; // Gerçek ID'yi yerleştir
        nameInput.value = name;
        checkInput.checked = isDemirbas;

        modal.style.display = 'flex';
    }

    window.cachedEditingTypeName = name;
};

// 2. Modalı Kapat
// [WHY]: Aynı adlı closeEditModal purchase-servises'te ölü bir modal için tanımlıydı ve bunu eziyordu; ürün türü modalı
//        hiç kapanmıyor, açık overlay sayfayı ve zaman aşımını kilitliyordu (ADM-03).
window.closeProductTypeModal = function () {
    const modal = document.getElementById('editProductTypeModal');
    if (modal) modal.style.display = 'none';
};

// [WHY]: Ürün türleri kök 'productTypes' koleksiyonuna yazılıyordu; kurallar reddediyor, arayüz ise
//        ${COLLECTION_ROOT}/productTypes/items'ı okuduğu için değişiklik görünmüyordu (ADM-02, RULE-03).
// [HOW]: Tüm işlemler aktif ortamın productTypes/items yoluna, açık id ile yapılır (id listeye veriyle birlikte gelir).
const _productTypeDoc = (id) => {
    const { doc } = window.FirebaseModules;
    return doc(window.fireDb, window.AppEnv.COLLECTION_ROOT, 'productTypes', 'items', String(id));
};

async function _createProductType(nameInput, isDemirbasCheck) {
    const name = nameInput.value.trim();
    const isDemirbas = isDemirbasCheck.checked;
    if (!name) { showAppAlert("Tür adı giriniz", "warning"); return; }

    const exists = (window.data.productTypes || []).some(t =>
        String(t.name || '').trim().toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'));
    if (exists) { showAppAlert("Bu ürün türü zaten mevcut!", "warning"); return; }

    try {
        const { setDoc } = window.FirebaseModules;
        const id = `pt_${Date.now()}`;
        await setDoc(_productTypeDoc(id), { id, name, isDemirbas, createdAt: Date.now() });
        nameInput.value = '';
        isDemirbasCheck.checked = false;
        showAppAlert("Yeni tür başarıyla eklendi.", "success");
    } catch (err) {
        console.error("❌ Ekleme hatası:", err);
        showAppAlert("Tür eklenirken bir hata oluştu.", "error");
    }
}

// --- 1. YENİ TÜR EKLEME ---
window.addNewProductType = function () {
    return _createProductType(document.getElementById('newProductType'), document.getElementById('isDemirbasCheck'));
};

// --- TANIMLAR SEKMESİ İÇİN YENİ TÜR EKLEME (farklı input id'leri, aynı veri yolu) ---
window.defAddNewProductType = function () {
    return _createProductType(document.getElementById('defNewProductType'), document.getElementById('defIsDemirbasCheck'));
};

// --- 2. GÜNCELLEME (DEĞİŞİKLİKLERİ KAYDET) ---
window.saveProductTypeUpdate = async function () {
    const idInput = document.getElementById('editTypeId');
    const nameInput = document.getElementById('editTypeName');
    const checkInput = document.getElementById('editIsDemirbas');
    if (!idInput || !nameInput) return;

    const docId = idInput.value;
    const newName = nameInput.value.trim();
    const newIsDemirbas = checkInput.checked;
    if (!newName) { showAppAlert("Tür adı boş olamaz!", "error"); return; }

    let definitionSaved = false;
    try {
        const oldName = window.cachedEditingTypeName;
        // İki depo da tanım yazılmadan önce doğrulanır; eski alias alanları salt-okunur kalır.
        const plan = oldName && oldName !== newName ? _planProductTypeRename(oldName, newName) : [];
        const { updateDoc } = window.FirebaseModules;
        await updateDoc(_productTypeDoc(docId), { name: newName, isDemirbas: newIsDemirbas });
        definitionSaved = true;

        const synced = await window.syncProductTypesToProducts(oldName, newName, plan);
        if (!synced.ok) {
            showAppAlert(`Tür tanımı kaydedildi. Tamamlanan depolar: ${synced.saved.join(', ') || 'yok'}. ` +
                `Tamamlanamayan depolar: ${synced.failed.join(', ')}. Bu depolarda kısmi yazma olabilir; ürünleri kontrol edin.`, 'warning');
            return;
        }

        window.forceProductTypeSync();
        window.closeProductTypeModal();
        showAppAlert("Ürün türü güncellendi.", "success");
    } catch (error) {
        console.error("❌ Kayıt hatası:", error);
        showAppAlert(definitionSaved
            ? 'Tür tanımı kaydedildi ancak işlem tamamlanamadı. Ürünlerdeki tür adlarını kontrol edin.'
            : `Tür tanımı kaydedilemedi; ürün güncellemesi başlatılmadı. ${error.message || ''}`, "error");
    }
};

// --- 3. SİLME İŞLEMİ ---
window.deleteProductType = async function (docId) {
    const type = (window.data.productTypes || []).find(t => String(t.id) === String(docId));
    const onay = await showCustomConfirm('Ürün Türünü Sil', `"${type ? type.name : docId}" ürün türü silinecek. Onaylıyor musunuz?`);
    if (!onay) return;

    try {
        const { deleteDoc } = window.FirebaseModules;
        await deleteDoc(_productTypeDoc(docId));
        showAppAlert("Ürün türü silindi.", "success");
    } catch (error) {
        console.error("❌ Silme hatası:", error);
        showAppAlert("Ürün türü silinemedi.", "error");
    }
};

window.checkExitIsDemirbas = function (exit) {
    if (!exit) return false;

    // Kanonik görünüm (3.6): eski onay/zimmet kayıtlarında productType ürün ADIDIR; tür olarak okunmamalı.
    const n = window.Schema.normalizeB3(exit);
    const typeName = n.urunTuru === '-' ? '' : n.urunTuru;
    const productName = n.urunAciklama === '-' ? '' : n.urunAciklama;
    const textToSearch = `${typeName} ${productName}`.toLowerCase();

    // 1. ÖNCELİK: Kelime Bazlı Heuristic Eşleşme (Süper Güvenli / Ezici Kural)
    const sarfKeywords = ["sarf", "kablo", "toner", "pil", "kartuş", "şerit", "mürekkep", "bant", "etiket", "kalem", "kağıt", "temizlik", "adaptör", "konnektör", "fiş", "priz", "usb", "patch", "mause", "mouse", "klavye"];
    const demirbasKeywords = ["monitör", "monitor", "pc", "bilgisayar", "yazıcı", "yazici", "telefon", "projeksiyon", "dect", "cihaz", "kasa", "donanım", "donanim", "demirbaş", "demirbas", "laptop", "tablet", "switch", "router", "modem", "sunucu", "server", "ups", "kamera", "tv", "televizyon", "tarayıcı", "tarayici", "bileşen", "bilesen", "çevre", "cevre", "uzakatim", "uzakatım", "xıd", "xid"];

    let hasSarf = false;
    for (const kw of sarfKeywords) {
        if (textToSearch.includes(kw)) {
            hasSarf = true;
            break;
        }
    }

    let hasDemirbas = false;
    for (const kw of demirbasKeywords) {
        if (textToSearch.includes(kw)) {
            hasDemirbas = true;
            break;
        }
    }

    if (hasDemirbas && !hasSarf) return true;
    if (hasSarf) return false;

    // 2. ÖNCELİK: Ürün Türü eşleşmesi (Admin tanımları)
    if (typeName) {
        const activeTypes = typeof window.getActiveProductTypes === 'function' ? window.getActiveProductTypes() : [];
        const typeMatch = activeTypes.find(t => (t.name || "").trim().toLowerCase() === typeName.toLowerCase());
        if (typeMatch) {
            return typeMatch.isDemirbas === true || typeMatch.isDemirbas === "true";
        }
    }

    // 3. ÖNCELİK: Ürün Açıklaması / Adı üzerinden tür eşleşmesi (Kısmi eşleşme - Fallback)
    if (productName) {
        const activeTypes = typeof window.getActiveProductTypes === 'function' ? window.getActiveProductTypes() : [];
        const typeMatch = activeTypes.find(t => {
            const tName = (t.name || "").trim().toLowerCase();
            return tName && productName.toLowerCase().includes(tName);
        });
        if (typeMatch) {
            return typeMatch.isDemirbas === true || typeMatch.isDemirbas === "true";
        }
    }

    // 4. ÖNCELİK: exit objesi üzerindeki doğrudan isDemirbas bayrağı
    if (exit.isDemirbas !== undefined && exit.isDemirbas !== null) {
        return exit.isDemirbas === true || exit.isDemirbas === "true";
    }

    return true; // Varsayılan olarak demirbaş
};

// --- GRAFİK ÇİZİMİ (CHART.JS) ---

let demirbasExitChart = null;
let sarfExitChart = null;

window.renderExitCharts = function () {
    // PM NOTU: requests (talepler) yerine b3 (çıkışlar) loglanmalı ki doğru veriye baktığımızdan emin olalım.
    console.log("📊 Grafik Çizimi Başlıyor. Veri kaynağı hazır ve render ediliyor...");

    const demirbasCounts = {};
    const sarfCounts = {};

    // 1. MEVCUT GRAFİKLERİ BUL VE YOK ET (Çakışmayı önlemek için)
    const existingDemirbas = Chart.getChart("exitDemirbasChart");
    if (existingDemirbas) existingDemirbas.destroy();

    const existingSarf = Chart.getChart("exitSarfChart");
    if (existingSarf) existingSarf.destroy();

    // 2. VERİ KAYNAĞINI AL
    const exits = window.data.b3 || window.data.exits || [];

    // 3. VERİLERİ OKU VE AYRIŞTIR (Kritik Bölge)
    exits.forEach(exit => {
        const n = window.Schema.normalizeB3(exit);
        const urunTuru = n.urunTuru !== '-' ? n.urunTuru : "Bilinmeyen Tür";
        const adet = n.adet || 1;

        // En güncel tanıma göre demirbaş kontrolü yapıyoruz.
        const isDemirbas = window.checkExitIsDemirbas(exit);

        // console.log(`🔍 İşlenen Çıkış: ${urunTuru} | Adet: ${adet} | Demirbaş mı?: ${isDemirbas}`);

        // Verileri sepetlere at
        if (isDemirbas) {
            demirbasCounts[urunTuru] = (demirbasCounts[urunTuru] || 0) + adet;
        } else {
            sarfCounts[urunTuru] = (sarfCounts[urunTuru] || 0) + adet;
        }
    });

    // 3b. Animasyon & Vurgu Tespiti
    let highlightCategory = null;
    let shouldAnimate = false;

    if (exits.length > 0) {
        const latestExit = exits[0];
        const latestExitId = latestExit ? latestExit.id : null;

        if (latestExitId && window._lastExitAnimatedId !== latestExitId) {
            const isLatestConsumable = !window.checkExitIsDemirbas(latestExit);
            // makeId (µs) id'leri ms sanılınca yaş negatif çıkıp her çizimde animasyon tetikleniyordu.
            const ageMs = Date.now() - window.Schema.normalizeB3(latestExit).ts;

            // Son 15 saniyede yapılmış bir sarf çıkışı ise animasyonu tetikle
            if (isLatestConsumable && ageMs < 15000) {
                highlightCategory = window.Schema.normalizeB3(latestExit).urunTuru;
                shouldAnimate = true;
                window._lastExitAnimatedId = latestExitId; // Bir daha oynatma
            }
        }
    }

    // Artık kullanılmayan referansları da temizle
    if (demirbasExitChart) demirbasExitChart.destroy();
    if (sarfExitChart) sarfExitChart.destroy();

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right' } }
    };

    // 4. DEMİRBAŞ GRAFİĞİNİ ÇİZ
    const ctxDemirbas = document.getElementById('exitDemirbasChart');
    if (ctxDemirbas) {
        const hasDemirbasData = Object.keys(demirbasCounts).length > 0;

        demirbasExitChart = new Chart(ctxDemirbas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: hasDemirbasData ? Object.keys(demirbasCounts) : ['Çıkış Yok'],
                datasets: [{
                    data: hasDemirbasData ? Object.values(demirbasCounts) : [1],
                    backgroundColor: ['#e74c3c', '#c0392b', '#d35400', '#f39c12', '#e67e22'],
                    borderWidth: 2
                }]
            },
            options: commonOptions
        });
    }

    // 5. SARF GRAFİĞİNİ ÇİZ
    const ctxSarf = document.getElementById('exitSarfChart');
    if (ctxSarf) {
        const hasSarfData = Object.keys(sarfCounts).length > 0;
        const labels = hasSarfData ? Object.keys(sarfCounts) : ['Çıkış Yok'];
        const values = hasSarfData ? Object.values(sarfCounts) : [1];

        // Son çıkışı yapılan sarf kategorisini öne çıkartmak için offset ekleme
        const offsets = labels.map(() => 0);
        if (highlightCategory) {
            const highlightIndex = labels.findIndex(lbl => lbl.toLowerCase() === highlightCategory.toLowerCase());
            if (highlightIndex !== -1) {
                offsets[highlightIndex] = 15; // 15px dışarı çıkar
            }
        }

        sarfExitChart = new Chart(ctxSarf.getContext('2d'), {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: ['#2ecc71', '#27ae60', '#3498db', '#2980b9', '#1abc9c'],
                    borderWidth: 2,
                    offset: offsets
                }]
            },
            options: commonOptions
        });

        // Çıkış yapıldıysa kartın etrafında hafifçe yeşil/turkuaz pulse glow efekti oluştur
        const cardElement = ctxSarf.closest('.card');
        if (cardElement && shouldAnimate) {
            cardElement.classList.remove('sarf-pulse-glow');
            void cardElement.offsetWidth; // browser reflow tetikle
            cardElement.classList.add('sarf-pulse-glow');
            setTimeout(() => {
                cardElement.classList.remove('sarf-pulse-glow');
            }, 6000);
        }
    }
};

/*
window.renderCriticalStockTable = function () {
    const tableBody = document.querySelector('#criticalStockTable tbody');
    if (!tableBody) return;

    const b1 = Object.values(window.data.b1 || {}).map(item => ({ ...item, depo: 'B1', key: 'b1' }));
    const b2 = Object.values(window.data.b2 || {}).map(item => ({ ...item, depo: 'B2', key: 'b2' }));
    const tumUrunler = [...b1, ...b2];

    // String array olarak biriktir — innerHTML+= DÖNGÜSÜ KULLANMA
    // (Her += tam DOM reparse + reflow üretir, N ürün = N×reflow)
    const rows = [];

    tumUrunler.forEach((item) => {
        const mevcut = parseInt(item.adet) || 0;
        const limit = parseInt(item.limit) || 3;

        if (mevcut <= limit) {
            let statusClass, statusText;

            if (mevcut === 0) {
                statusText = "TÜKENDİ";
                statusClass = "status-badge status-danger";
            } else if (mevcut === 1) {
                statusText = "ÇOK KRİTİK";
                statusClass = "status-badge status-critical";
            } else {
                statusText = "AZALDI";
                statusClass = "status-badge status-warning";
            }

            rows.push(`
                <tr class="align-middle">
                    <td>
                        <div class="fw-bold text-truncate" title="${escapeHtml(item.ürün || item.name)}">${escapeHtml(item.ürün || item.name)}</div>
                        <small class="text-muted d-block">${escapeHtml(item.depo)} | ${escapeHtml(item.rafNo || '-')}</small>
                    </td>
                    <td class="text-center">
                        <span class="fw-bold ${mevcut <= 1 ? 'text-danger' : 'text-dark'}">${mevcut}</span>
                        <span class="text-muted small">/ ${limit}</span>
                    </td>
                    <td><div class="d-grid"><div class="${statusClass}">${statusText}</div></div></td>
                    <td class="text-end">
                        <div class="action-buttons">
                            <button class="btn-action btn-buy" title="Satın Al"><i class="fas fa-shopping-cart"></i></button>
                            <button class="btn-action btn-mail" title="Bildirim Gönder"><i class="fas fa-envelope"></i></button>
                            <button class="btn-action btn-passive" data-action="deleteType" data-name="${escapeHtml(String(item.name))}" title="Pasif Yap"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`);
        }
    });

    window.bindActions(tableBody, { deleteType: el => window.deleteType(el.dataset.name) });
    // TEK DOM ataması — 1×reflow
    tableBody.innerHTML = rows.length
        ? rows.join('')
        : '<tr><td colspan="4" class="text-center p-4 text-muted">Stoklar ideal seviyede.</td></tr>';
};
*/

/**
 * Yeni Geliştirilmiş Kritik Stok Takibi
 * Tüm ürünleri CİHAZ TÜRÜ + CİHAZ DURUMU bazında gruplandırır.
 * Eğer tür belirtilmemişse ÜRÜN ADI + DURUM bazında gruplar.
 */
window.renderCriticalStockTable = function () {
    const tableBody = document.querySelector('#criticalStockTable tbody');
    if (!tableBody) return;

    // Tüm depoları birleştir
    const b1 = Object.entries(window.data.b1 || {}).map(([idx, item]) => ({ ...item, depo: 'B1', key: 'b1', originalIndex: parseInt(idx) }));
    const b2 = Object.entries(window.data.b2 || {}).map(([idx, item]) => ({ ...item, depo: 'B2', key: 'b2', originalIndex: parseInt(idx) }));
    const tumUrunler = [...b1, ...b2];

    const rows = [];
    const groups = {}; // Gruplama anahtarı: "(Tür veya Ad) | Durum" veya sadece "Ad"
    criticalStockGroupsByKey = new Map();

    // 1. Ürünleri Gruplandır (Demirbaşlar için Tür+Durum, Sarflar için sadece İsim)
    tumUrunler.forEach(item => {
        // [FİLTRE] Pasif ürünleri saymıyoruz (Eski kayıtlar veya depoda olmayanlar)
        if (item.durumu === 'Pasif' || item.status === 'Pasif') return;
        // [WHY]: Demirbaş satırları tür+durum ile gruplanıyor; tek bir birim çıkış/sevk/zimmet/hurda ile adet 0'a
        //        inince computeStockPatch durumu otomatik 'Tükendi' yapıyor. Bu satır KENDİ başına ayrı bir grup
        //        oluşturup (mevcut her zaman 0) gerçekte stoklu bir ürünü yanlışlıkla "TÜKENDİ" diye alarma
        //        düşürüyordu — aynı türün başka durumdaki sağlam birimleri varken bile.
        // [HOW]: Otomatik "gitti" durumundaki satırlar toplamdan tamamen çıkarılır (zaten 0 katkıları vardı,
        //        yalnız kendi fantom grubunu oluşturmasınlar). Elle girilmiş "Arızalı" gibi durumlar etkilenmez.
        if (STOCK_AUTO_EMPTY.includes(item.durumu) || STOCK_AUTO_EMPTY.includes(item.status)) return;

        const type = (item.tür || item.type || item.prodType || "").trim();
        const name = (item.ürün || item.name || "İsimsiz").trim();
        const status = (item.durumu || item.status || "Kullanıma Hazır").trim();

        const isDemirbas = window.checkIsDemirbas(item);

        const cleanType = window.getCleanProductName(type);
        const cleanName = window.getCleanProductName(name);

        let key, displayName;
        if (isDemirbas) {
            const groupLabel = cleanType || cleanName;
            key = `demirbas_${groupLabel}_${status}`;
            displayName = `${groupLabel} (${status})`;
        } else {
            key = `sarf_${cleanName}`;
            displayName = cleanName;
        }

        if (!groups[key]) {
            groups[key] = {
                key: key,
                displayName: displayName,
                mainName: cleanName,
                typeName: isDemirbas ? cleanType : "",
                status: isDemirbas ? status : "",
                isDemirbas: isDemirbas,
                mevcut: 0,
                limit: 0,
                items: []
            };
        }

        const qty = parseInt(item.adet || item.qty || 0);
        groups[key].mevcut += qty;
        groups[key].items.push(item);

        // Limit olarak gruptaki ürünlerde tanımlı olan EN YÜKSEK limiti baz alıyoruz
        const itemLimit = parseInt(item.limit || 0);
        if (itemLimit > groups[key].limit) {
            groups[key].limit = itemLimit;
        }
    });

    // 2. Grupları Kontrol Et ve Tabloya Ekle
    Object.values(groups).forEach(group => {
        // Eğer limit hiç tanımlanmamışsa varsayılan 3 yapalım
        const finalLimit = group.limit > 0 ? group.limit : 3;

        if (group.mevcut <= finalLimit) {
            // Durumu belirle
            let statusText;
            if (group.mevcut === 0) {
                statusText = "TÜKENDİ";
            } else if (group.mevcut <= 1) {
                statusText = "ÇOK KRİTİK";
            } else {
                statusText = "AZALDI";
            }

            // [FİLTRE] Eğer filtre 'all' değilse ve statusText ile eşleşmiyorsa atla
            const currentFilter = window.currentCriticalFilter || 'all';
            if (currentFilter !== 'all' && statusText !== currentFilter) {
                return;
            }

            const models = [...new Set(group.items
                .map(item => String(item.ürün || item.name || '').trim())
                .filter(Boolean))];
            criticalStockGroupsByKey.set(group.key, group);

            // Konum bilgisini belirle
            let locationInfo = "";
            if (group.items.length === 1) {
                const item = group.items[0];
                locationInfo = `${item.depo} | ${item.rafNo || item.raf || item.shelf || '-'}`;
            } else {
                const depos = [...new Set(group.items.map(i => i.depo))];
                locationInfo = `${depos.join('/')} | Çeşitli Raflar`;
            }

            rows.push(generateCriticalRowHTML({
                key: group.key,
                name: group.displayName,
                models,
                mevcut: group.mevcut,
                limit: finalLimit,
                location: locationInfo
            }));
        }
    });

    // Satır HTML'i üreten yardımcı fonksiyon
    function generateCriticalRowHTML(data) {
        let statusClass, statusText;
        if (data.mevcut === 0) {
            statusText = "TÜKENDİ";
            statusClass = "status-badge status-danger";
        } else if (data.mevcut <= 1) {
            statusText = "ÇOK KRİTİK";
            statusClass = "status-badge status-critical";
        } else {
            statusText = "AZALDI";
            statusClass = "status-badge status-warning";
        }

        return `
            <tr class="align-middle">
                <td>
                    <div class="fw-bold text-truncate" title="${escapeHtml(data.name)}">${escapeHtml(data.name)}</div>
                    <small class="text-muted d-block" title="${escapeHtml(data.models.join(', '))}">
                        Model: ${escapeHtml(data.models.slice(0, 2).join(', ') || '-')}
                        ${data.models.length > 2 ? `+${data.models.length - 2} model` : ''}
                    </small>
                    <small class="text-muted d-block">${escapeHtml(data.location)}</small>
                </td>
                <td class="text-center">
                    <span class="fw-bold ${data.mevcut <= 1 ? 'text-danger' : 'text-dark'}">${escapeHtml(data.mevcut)}</span>
                    <span class="text-muted small">/ ${escapeHtml(data.limit)}</span>
                </td>
                <td class="text-center align-middle">
                    <span class="${statusClass /* xss-ok: üç sabit sınıf */} status-badge-compact">${statusText /* xss-ok: üç sabit metin */}</span>
                </td>
                <td class="text-end align-middle px-3">
                    <div class="action-buttons justify-content-end align-items-center flex-nowrap" style="gap: 5px;">
                        <button type="button" class="btn-action btn-buy" data-action="showCriticalProductInfo"
                            data-key="${escapeHtml(data.key)}" title="Ürün Bilgisi" aria-label="Ürün Bilgisi">
                            <i class="fas fa-circle-info"></i>
                        </button>
                        <button type="button" class="btn-action btn-buy" title="Satın Al" aria-label="Satın Al"><i class="fas fa-shopping-cart"></i></button>
                        <button type="button" class="btn-action btn-mail" title="Bildirim Gönder" aria-label="Bildirim Gönder"><i class="fas fa-envelope"></i></button>
                        <button type="button" class="btn-action btn-passive" title="Pasif Yap" aria-label="Pasif Yap"><i class="fas fa-eye-slash"></i></button>
                        <button type="button" class="btn-action btn-danger" data-action="deleteCriticalGroup" data-key="${escapeHtml(data.key)}" title="Ürünü Sil" aria-label="Ürünü Sil"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    }

    // Nihai render
    tableBody.innerHTML = rows.length
        ? rows.join('')
        : '<tr><td colspan="4" class="text-center p-4 text-muted">Stoklar ideal seviyede.</td></tr>';
    // [WHY]: Faz 4 · J2 — grup anahtarı (ürün/tür/durum adlarından) onclick'e kaçışsız gömülüyordu. [HOW]: data-key + delegation.
    window.bindActions(tableBody, {
        deleteCriticalGroup: el => window.deleteCriticalGroup(el.dataset.key),
        showCriticalProductInfo: el => window.showCriticalProductInfo(el.dataset.key),
    });
};

window.showCriticalProductInfo = function (groupKey) {
    const group = criticalStockGroupsByKey.get(groupKey);
    if (!group) {
        if (typeof window.showAppAlert === 'function') window.showAppAlert('Ürün grubu bulunamadı; kritik stok tablosunu yenileyip tekrar deneyin.', 'error');
        return;
    }

    let modal = document.getElementById('criticalStockProductInfoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'criticalStockProductInfoModal';
        modal.className = 'modern-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'criticalStockProductInfoTitle');
        modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:10001; background:rgba(15,23,42,.65); align-items:center; justify-content:center; padding:20px;';
        modal.innerHTML = `
            <section class="modern-modal-content" style="width:min(900px,96vw); max-height:90vh; overflow:auto; border-radius:16px;">
                <header class="modern-modal-header">
                    <h3 id="criticalStockProductInfoTitle" class="mb-0">Kritik Stok Ürün Bilgisi</h3>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="closeCriticalProductInfo"
                        aria-label="Kapat"><i class="fas fa-times"></i></button>
                </header>
                <div id="criticalStockProductInfoBody" class="p-3"></div>
            </section>`;
        document.body.appendChild(modal);
        window.bindActions(modal, {
            closeCriticalProductInfo: () => { modal.style.display = 'none'; },
        });
        modal.addEventListener('click', event => {
            if (event.target === modal) modal.style.display = 'none';
        });
    }

    const title = document.getElementById('criticalStockProductInfoTitle');
    const body = document.getElementById('criticalStockProductInfoBody');
    const esc = window.escapeHtml;
    if (title) title.textContent = `Ürün Bilgisi — ${group.displayName}`;
    if (body) {
        body.innerHTML = `
            <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                    <thead><tr>
                        <th>Model / Ürün</th><th>Marka</th><th>Envanter No</th><th>Depo / Raf</th>
                        <th>Adet</th><th>Durum</th><th>Açıklama</th>
                    </tr></thead>
                    <tbody>${group.items.map(item => `<tr>
                        <td>${esc(item.ürün || item.name || '-')}</td>
                        <td>${esc(item.marka || '-')}</td>
                        <td>${esc(item.envanterNo || '-')}</td>
                        <td>${esc(item.depo)} / ${esc(item.rafNo || item.raf || item.shelf || '-')}</td>
                        <td>${esc(item.adet ?? item.qty ?? 0)}</td>
                        <td>${esc(item.durumu || item.status || 'Kullanıma Hazır')}</td>
                        <td>${esc(item.açıklama || item.description || '-')}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
    }
    modal.style.display = 'flex';
};

window.deleteCriticalGroup = async function (groupKey) {
    const b1 = Object.entries(window.data.b1 || {}).map(([idx, item]) => ({ ...item, depo: 'B1', key: 'b1', originalIndex: parseInt(idx) }));
    const b2 = Object.entries(window.data.b2 || {}).map(([idx, item]) => ({ ...item, depo: 'B2', key: 'b2', originalIndex: parseInt(idx) }));
    const tumUrunler = [...b1, ...b2];

    const groups = {};
    tumUrunler.forEach(item => {
        if (item.durumu === 'Pasif' || item.status === 'Pasif') return;
        const type = (item.tür || item.type || item.prodType || "").trim();
        const name = (item.ürün || item.name || "İsimsiz").trim();
        const status = (item.durumu || item.status || "Kullanıma Hazır").trim();

        const isDemirbas = window.checkIsDemirbas(item);

        const cleanType = window.getCleanProductName(type);
        const cleanName = window.getCleanProductName(name);

        let key, displayName;
        if (isDemirbas) {
            const groupLabel = cleanType || cleanName;
            key = `demirbas_${groupLabel}_${status}`;
            displayName = `${groupLabel} (${status})`;
        } else {
            key = `sarf_${cleanName}`;
            displayName = cleanName;
        }

        if (!groups[key]) {
            groups[key] = { displayName, items: [] };
        }
        groups[key].items.push(item);
    });

    const group = groups[groupKey];
    if (!group) {
        showAppAlert("Grup bulunamadı!", "error");
        return;
    }

    const onay = await window.customConfirmAlert(
        "Kritik Stok Silme",
        `"${group.displayName}" grubundaki tüm ürünleri (${group.items.length} adet kayıt) depodan TAMAMEN silmek istediğinize emin misiniz?`
    );

    // [WHY]: Onay kutusu açıkken gelen bir snapshot indeksleri kaydırıyordu; silme yanlış ürünleri vurup tüm veritabanını
    //        yazıyordu (ADM-07, DATA-06). [HOW]: Grup ürünleri id ile silinir, B1+B2 tek atomik batch'te; sonuç kontrol edilir.
    if (onay) {
        // v3.6: rafı sayımdaki kayıt silinmez; atlananlar bildirilir.
        const locked = i => window.Schema?.isRowCountLocked?.((window.data[i.key] || []).find(x => x && String(x.id) === String(i.id)));
        const withId = group.items.filter(i => i.id != null && i.id !== '');
        const ops = withId.filter(i => !locked(i)).map(i => ({ op: 'delete', col: i.key, id: i.id }));
        const skipped = withId.length - ops.length;
        if (!ops.length) {
            showAppAlert("Bu gruptaki ürünlerin rafı sayımda; sayım bitince tekrar deneyin.", "warning");
            return;
        }
        if (!(await window.writeOk(window.applyItemOps(ops)))) {
            showAppAlert("Silme kaydedilemedi; hiçbir ürün silinmedi.", "error");
            return;
        }
        showAppAlert(`${ops.length} ürün depodan silindi.${skipped ? ` Rafı sayımda olan ${skipped} kayıt silinmedi.` : ''}`, "success");
    }
};

// Sidebar tıklama yönetimi
window.showAdminTab = function (tabId) {
    // 1. Tüm tabları gizle ve tüm menüleri pasif yap
    document.querySelectorAll('.admin-tab-content').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // 2. Aktif tabı göster + menü aktif yap (sürekli sünkron, çok hızlı)
    const target = document.getElementById(tabId);
    if (!target) return;
    target.style.display = 'block';
    target.classList.add('active'); // Opacity ve animasyon için gerekli

    const activeNav = document.querySelector(`.nav-item[onclick*="${tabId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // 3. Ağır render'ları defer et:
    //    Önce tarayıcı tab geçişini boyar (requestAnimationFrame),
    //    sonra bir görev sırası bekler (setTimeout 0), ardından render başlar.
    //    Bu sayede kullanıcı anında sekme’yi görür; donmuş his yapmúr.
    if (tabId === 'dashboard-content') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (typeof window.renderDashboardStats === 'function') window.renderDashboardStats();
                if (typeof window.renderCriticalStockTable === 'function') window.renderCriticalStockTable();
            }, 0);
        });
    } else if (tabId === 'productTypeSettings') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (typeof window.renderExitCharts === 'function') window.renderExitCharts();
                if (typeof window.renderQuickExitDesk === 'function') window.renderQuickExitDesk();
            }, 0);
        });
    } else if (tabId === 'definitionsTab') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (typeof window.renderLocationsTable === 'function') window.renderLocationsTable();
            }, 0);
        });
    } else if (tabId === 'todoTab') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (typeof window.renderTodoTab === 'function') window.renderTodoTab();
            }, 0);
        });
    } else if (tabId === 'purchaseTab') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (typeof window.renderServicesModule === 'function') window.renderServicesModule();
                if (typeof window.renderAdminRequestTable === 'function') window.renderAdminRequestTable();
            }, 0);
        });
    }

    // 💡 CONTEXTUAL TIP — Admin sekme değiştiğinde ipucu göster
    if (typeof window.TipManager === 'object' && typeof window.TipManager.showTipForTab === 'function') {
        window.TipManager.showTipForTab(tabId);
    }

    // Faz 5 · K3 (5.7 · ARC-07): merkezi kanca sicili — başka modüller showAdminTab'ı artık sarmalamıyor, buraya kaydoluyor.
    if (window.AppModules?.AdminTabs) window.AppModules.AdminTabs.dispatch(tabId);
};

// --- DASHBOARD GRAFİKLERİ ---
// Chart instance'ları burada saklanır.
// destroy()+new Chart() yerine data güncelleme kullanılır → sıfır flicker.
// ── 🚀 DASHBOARD FILTER LOGIC ────────────────────────────────
window._dashBarFilter = 'all'; // Bar chart depo filtresi (b1, b2, all)
window._dashPieFilter = 'all'; // Pie chart görünüm filtresi (b1, b2, all, sarf)

/**
 * Bar grafiği (Demirbaş Stok Durumu) filtrelerini yönetir.
 */
window.setBarChartFilter = function (filter, btn) {
    window._dashBarFilter = filter;

    // UI Güncelleme: Sadece Bar chart kartındaki butonları güncelle
    const toggleGroup = btn.closest('.chart-toggles');
    if (toggleGroup) {
        toggleGroup.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    window.renderDashboardStats();
};

/**
 * Pasta grafiği (Envanter Dağılımı) filtrelerini yönetir.
 */
window.setPieChartFilter = function (filter, btn) {
    window._dashPieFilter = filter;

    // UI Güncelleme: Sadece Pie chart kartındaki butonları güncelle
    const toggleGroup = btn.closest('.chart-toggles');
    if (toggleGroup) {
        toggleGroup.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    window.renderDashboardStats();
};

// Ürün sınıflandırmasını kullanıcı isteğine ve kategori tanımlarına göre kesinleştiriyoruz.
window._isDemirbasStrict = function (item) {
    // 1. ÖNCELİK: Ürünün kendi üzerindeki 'isDemirbas' bayrağı (Edit modalından işaretlenen)
    if (item.isDemirbas === true || item.isDemirbas === "true") return true;
    if (item.isDemirbas === false || item.isDemirbas === "false") return false;

    // 2. ÖNCELİK: Ürünün türü/kategorisi bazında genel tanım (Ürün Türleri listesindeki tanım)
    // Resimdeki 'Monitör' demirbaş, 'Toner' sarf tanımlarını burada kontrol ediyoruz.
    const itemType = (item.tür || item.type || "").trim();
    if (window.data && window.data.productTypes) {
        const typeDef = window.data.productTypes.find(t => t.name === itemType);
        if (typeDef) {
            return (typeDef.isDemirbas === true || typeDef.isDemirbas === "true");
        }
    }

    // 3. VARSAYILAN: Eğer hiçbir tanım bulunamazsa, güvenlik için sarf kabul edilebilir.
    return false;
};

window.renderDashboardStats = function () {
    const b1 = Object.values(window.data.b1 || {});
    const b2 = Object.values(window.data.b2 || {});
    const allItems = [...b1, ...b2];

    // 1. BAR CHART: Bağımsız depo filtresine bakar ve sadece KESİN DEMİRBAŞLARI listeler.
    let barSource = (window._dashBarFilter === 'b1') ? b1 :
        (window._dashBarFilter === 'b2') ? b2 : allItems;

    const productNames = [];
    const productValues = [];

    barSource.forEach(item => {
        // Pasifleri grafiklerden hariç tut
        if (item.durumu === 'Pasif' || item.status === 'Pasif') return;

        if (window._isDemirbasStrict(item)) {
            productNames.push(item.ürün || "İsimsiz");
            productValues.push(parseInt(item.adet) || 0);
        }
    });

    // 2. PIE CHART: Moduna göre Demirbaş veya Sarf dağılımını gösterir.
    const pieMode = window._dashPieFilter;
    const isSarfView = (pieMode === 'sarf');
    const typeCounts = {};

    let pieSourceItems = allItems;
    if (pieMode === 'b1') pieSourceItems = b1;
    else if (pieMode === 'b2') pieSourceItems = b2;

    pieSourceItems.forEach(item => {
        // Pasifleri grafiklerden hariç tut
        if (item.durumu === 'Pasif' || item.status === 'Pasif') return;

        const isActuallyDemirbas = window._isDemirbasStrict(item);

        // Etiketleri normalleştiriyoruz (Büyük Harf) -> 'Toner' ve 'TONER' birleşsin.
        let label = (item.tür || item.type || (isActuallyDemirbas ? "DEMİRBAŞ" : "SARF MALZEME")).trim().toUpperCase();

        // Filtreleme: Sarf görünümünde demirbaş olmayanlar, diğerlerinde demirbaşlar.
        if (isSarfView) {
            if (!isActuallyDemirbas) {
                typeCounts[label] = (typeCounts[label] || 0) + (parseInt(item.adet) || 0);
            }
        } else {
            if (isActuallyDemirbas) {
                typeCounts[label] = (typeCounts[label] || 0) + (parseInt(item.adet) || 0);
            }
        }
    });





    // ── 1. BAR GRAFİK: Demirbaş Stok Durumu ──────────────────────────────────
    const ctxBar = document.getElementById('dashDemirbasChart');
    if (ctxBar) {
        const labels = productNames.length ? productNames : ['Veri Yok'];
        const values = productValues.length ? productValues : [0];

        if (window._dashCharts.bar) {
            window._dashCharts.bar.data.labels = labels;
            window._dashCharts.bar.data.datasets[0].data = values;
            window._dashCharts.bar.data.datasets[0].label = 'Demirbaş';
            window._dashCharts.bar.update('none');
        } else {
            window._dashCharts.bar = new Chart(ctxBar.getContext('2d'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Demirbaş',
                        data: values,
                        backgroundColor: '#3498db',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: { beginAtZero: true, grid: { display: false } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }

    // ── 2. PIE GRAFİK: Envanter Dağılımı ─────────────────────────────────────
    if (typeof renderCustomWatchDashboard === 'function') {
        renderCustomWatchDashboard();
    }

    const ctxPie = document.getElementById('dashSarfChart');
    if (ctxPie) {
        const labels = Object.keys(typeCounts).length ? Object.keys(typeCounts) : ['Veri Yok'];
        const values = Object.values(typeCounts).length ? Object.values(typeCounts) : [0];

        if (window._dashCharts.pie) {
            window._dashCharts.pie.data.labels = labels;
            window._dashCharts.pie.data.datasets[0].data = values;
            window._dashCharts.pie.update('none');
        } else {
            window._dashCharts.pie = new Chart(ctxPie.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: [
                            '#2ecc71', '#e67e22', '#3498db', '#e74c3c',
                            '#9b59b6', '#1abc9c', '#f1c40f', '#34495e'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                boxWidth: 12,
                                padding: 15,
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    return ` ${label}: ${value} Adet`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // ── 3. BAŞLIKLARI GÜNCELLE ───────────────────────────────────────────────
    const barCard = document.getElementById('dashDemirbasChart')?.closest('.card');
    const pieCard = document.getElementById('dashSarfChart')?.closest('.card');

    if (barCard) {
        const h3 = barCard.querySelector('h3');
        if (h3) h3.innerText = '🛡️ Demirbaş Stok Durumu'; // Bar her zaman demirbaş
    }
    if (pieCard) {
        const h3 = pieCard.querySelector('h3');
        if (h3) h3.innerText = isSarfView ? '📦 Sarf Malzeme Dağılımı' : '🛡️ Demirbaş Dağılımı';
    }
};





window.updateProductTypeDropdowns = function () {
    const dropdowns = document.querySelectorAll('#prodType');
    // Yukarıda düzelttiğimiz dinamik fonksiyonu çağırıyor
    const types = window.getActiveProductTypes();

    dropdowns.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">Tür Seçiniz...</option>';

        types.forEach(type => {
            const name = type.name || "İsimsiz";
            // Hem true/false hem de "true"/"false" (string) durumlarını yakalar
            const isDemirbas = (type.isDemirbas === true || type.isDemirbas === "true");
            const label = isDemirbas ? 'Demirbaş' : 'Sarf';

            // Senin orijinal yapın:
            select.innerHTML += `<option value="${escapeHtml(name)}" data-is-demirbas="${isDemirbas}">
                ${escapeHtml(name)} (${label})
            </option>`;
        });

        // Önceki seçimi geri yükle
        select.value = currentVal;
    });
};

// [WHY]: Ad değişikliği b1/b2 ürünlerinde yalnız bellekte yapılıyordu; kaydedilmediği için snapshot ile geri geliyordu (ADM-02).
function _planProductTypeRename(oldName, newName) {
    const S = window.Schema;
    const plan = [];
    for (const depo of ['b1', 'b2']) {
        const validate = depo === 'b1' ? S.validateB1 : S.validateB2;
        let changed = false;
        const items = (window.data?.[depo] || []).map(item => {
            if ((item.tür || item.type || item.prodType || '') !== oldName) return item;
            changed = true;
            const next = { ...item, tür: newName };
            const { checked, frozen } = S.legacyStockPatch(depo, item, next);
            const errors = validate(item).length ? validate(checked, { partial: true }) : validate(next);
            if (frozen.length || errors.length) {
                const error = new Error(`${depo}/${item.id}: ${errors.concat(frozen.map(f => `eski alan değiştirilemez: ${f.key}`)).join('; ')}`);
                error.code = 'schema-violation';
                throw error;
            }
            return next;
        });
        if (changed) plan.push({ depo, items });
    }
    return plan;
}

window.syncProductTypesToProducts = async function (oldName, newName, plan = _planProductTypeRename(oldName, newName)) {
    const saved = [], failed = [];
    for (const { depo, items } of plan) {
        try {
            const result = await window.saveData(depo, items);
            (result === false ? failed : saved).push(depo);
        } catch (error) {
            failed.push(depo);
            console.error(`Tür adı ${depo} deposunda kaydedilemedi:`, error);
        }
    }
    return { ok: failed.length === 0, saved, failed };
};

// "Özel Takip" Dashboard'u
// [WHY] (Faz 5 · K3 · ADM-05): Kart tasarımı için `table.parentElement.innerHTML` yazılıyordu; tablonun EBEVEYNİ
//        tabloyu da İÇERDİĞİ için bu, #customWatchTable'ın kendisini DOM'dan siliyordu. İlk çizimden sonra
//        `querySelector('#customWatchTable')` hep null dönüyor, fonksiyon ikinci çağrıdan itibaren `if (!table) return`
//        ile sessizce hiçbir şey yapmadan çıkıyordu — panel renderDashboardStats her tetiklendiğinde (her b1/b2
//        güncellemesinde) bir daha asla yenilenmiyordu.
// [HOW]: Tabloyu SİLMEK yerine yalnız bir kez gizle (display:none) ve kart konteynerini tablonun kendi ebeveyninin
//        İÇİNE, tablonun yanına (sibling) kalıcı bir karkas olarak ekle. Sonraki her çağrı yalnız bu konteynerin
//        içeriğini değiştirir; DOM iskeleti (tablo dahil) bir daha asla silinmez.
window.renderCustomWatchDashboard = function () {
    const table = document.querySelector('#customWatchTable');
    if (!table) return;

    let cardContainer = document.getElementById('watchCardsContainer');
    if (!cardContainer) {
        table.style.display = 'none';
        cardContainer = document.createElement('div');
        cardContainer.id = 'watchCardsContainer';
        cardContainer.className = 'watch-grid';
        table.insertAdjacentElement('afterend', cardContainer);
    }

    const watchedItems = [];

    // Faz 4 · J2: kart depo bilgisini de taşır (bugüne kadar her kart "B1" gösteriyordu) — eylemler data-depo + data-id ile.
    ['b1', 'b2'].forEach(depo => {
        (window.data?.[depo] || []).forEach(item => {
            if (item.isWatched) watchedItems.push({ ...item, __depo: depo });
        });
    });

    if (watchedItems.length === 0) {
        cardContainer.innerHTML = '<div class="empty-state">İzlenen ürün bulunamadı.</div>';
        return;
    }

    let html = "";

    watchedItems.forEach(item => {

        const qty = parseInt(item.adet) || 0;
        const limit = parseInt(item.limit) || 5;
        const percent = Math.min((qty / (limit * 2)) * 100, 100);
        const isLow = qty <= limit;
        const statusColor = isLow ? '#e74c3c' : '#2ecc71';

        // [WHY]: Faz 4 · J2 — kaydın tamamı JSON olarak onclick'e gömülüyordu; yalnız '"' kaçırıldığı için "&quot;" içeren bir
        //        alan JS dizgesinden çıkabiliyordu. [HOW]: data-depo + data-id; eylem kaydı id ile window.data'dan çözer.
        const ref = `data-depo="${escapeHtml(item.__depo)}" data-id="${escapeHtml(item.id ?? '')}"`;
        html += `
        <div class="watch-card" data-action="watchDetail" ${ref /* xss-ok: escapeHtml ile kurulmuş nitelikler */}>

            <div class="watch-header">
                <div class="title">${escapeHtml(item.ürün)}</div>
                <div class="qty ${isLow ? 'danger' : 'success'}">${qty}</div>
            </div>

            <div class="meta">
                📦 ${escapeHtml(String(item.__depo).toUpperCase())} | 🏷 ${escapeHtml(item.marka || '-')}
            </div>

            <div class="progress-bar">
                <div style="width:${percent}%; background:${statusColor}"></div>
            </div>

            <div class="watch-footer">
                <span>Kritik: ${limit}</span>
                
                <span class="status ${isLow ? 'danger' : 'ok'}">
                    ${isLow ? '⚠ Stok Az' : '✔ Yeterli'}
                </span>
            </div>

            ${isLow ? `
                <div class="quick-actions">
                    <span data-action="watchPurchase" ${ref /* xss-ok: escapeHtml ile kurulmuş nitelikler */}>📦 Talep Et</span>
                    <span data-action="watchOrder" ${ref /* xss-ok: escapeHtml ile kurulmuş nitelikler */}>🛒 Sipariş</span>
                </div>
                ` : ''
            }

        </div>
        `;
    });

    cardContainer.innerHTML = html;
    // İç içe eylemde yalnız en içteki çalışır (eski event.stopPropagation davranışı).
    const watched = el => window.findItem(el.dataset.depo, el.dataset.id);
    window.bindActions(cardContainer, {
        watchDetail: el => window.openWatchDetail(watched(el)),
        watchPurchase: el => window.requestPurchase(watched(el)),
        watchOrder: el => window.addToOrderList(watched(el)),
    });
};

// Grafik çizme fonksiyonu
function drawWatchChart(labels, data) {
    const ctx = document.getElementById('customWatchChart');
    if (!ctx) return;

    if (window.watchChartInstance) {
        window.watchChartInstance.destroy();
    }

    window.watchChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stok Miktarı',
                data: data,
                backgroundColor: '#3498db',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });
}

// 🧠 3. YENİ FEATURE MİMARİSİ (EKLENECEKLER)
window.openWatchDetail = function (item) {
    console.log("DETAIL:", item);
};

window.requestPurchase = function (item) {
    console.log("PURCHASE REQUEST:", item);
};

window.addToOrderList = function (item) {
    console.log("ORDER LIST:", item);
};

window.forceProductTypeSync = function () {

    window.updateProductTypeDropdowns?.();

    window.renderTable?.('b1');
    window.renderTable?.('b2');

    console.log("✔ Product type UI sync");
};

// Admin paneli yüklendiğinde listeyi hazırla
window.onload = function () {
    if (typeof renderProductTypesTable === 'function') {
        renderProductTypesTable();
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const user = window.getActiveUser();
    if (user && typeof updateNavbarUI === 'function') updateNavbarUI(user);
    startAdminStatusTimer();
});

// 🕒 ADMIN STATUS TIMER
window.lastSyncTimestamp = Date.now();

function startAdminStatusTimer() {
    const timeNode = document.getElementById('liveTime');
    const dateNode = document.getElementById('liveDate');
    const syncTimeNode = document.getElementById('lastSyncTime');

    const updateUI = () => {
        // Türkiye Saati (UTC+3)
        const now = new Date();
        const tzOptions = { timeZone: 'Europe/Istanbul' };

        if (timeNode) {
            timeNode.textContent = now.toLocaleTimeString('tr-TR', {
                timeZone: 'Europe/Istanbul',
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }

        if (dateNode) {
            const opts = {
                timeZone: 'Europe/Istanbul',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            };
            dateNode.textContent = now.toLocaleDateString('tr-TR', opts).toUpperCase();
        }

        if (syncTimeNode && window.lastSyncTimestamp) {
            const diff = Math.floor((Date.now() - window.lastSyncTimestamp) / 1000);
            syncTimeNode.textContent = diff < 60 ? 'Just now' : Math.floor(diff / 60) + 'm ago';
        }
    };

    updateUI();
    setInterval(updateUI, 1000);
}

window.updateSyncStatus = function () {
    window.lastSyncTimestamp = Date.now();
    const dot = document.getElementById('syncIndicator');
    if (dot) { dot.classList.remove('online'); void dot.offsetWidth; dot.classList.add('online'); }
};

window.adminLogout = async function () {
    const onay = await showCustomConfirm('Güvenli Çıkış', 'Admin oturumunu kilitlemek istediğinize emin misiniz?');
    if (onay) {
        // [WHY]: Faz 4 · J3 (T3) — yalnız vize siliniyor, kilit kartı açılıyordu; Firebase admin oturumu kartın arkasında
        //        (ve kalıcı oturumda) geçerli kalıyordu. Tek yol: clearSession → await signOut → onAppLogout → kilit kartı.
        await window.SecurityConfig.endAdminSession('lock');
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// ⚙️ MAHAL (LOCATION) YÖNETİMİ
// ─────────────────────────────────────────────────────────────────────────────

window.locationSelectedPersons = [];

window.openLocationModal = function (id = null) {
    const modal = document.getElementById('locationModal');
    const title = document.getElementById('locationModalTitle');
    const form = document.getElementById('locationForm');

    form.reset();
    document.getElementById('loc_id').value = id || '';
    document.getElementById('loc_selectedPersons').innerHTML = '';
    window.locationSelectedPersons = [];

    // Birim dropdown'ını doldur (Sistemdeki birim tanımlarından çek)
    const unitSelect = document.getElementById('loc_unit');
    unitSelect.innerHTML = '<option value="">Birim Seçiniz...</option>';

    // window.data.units bir dizi olmalı (items field'ından gelen)
    const units = window.data.units || [];
    units.forEach(u => {
        const unitName = typeof u === 'object' ? (u.name || u.birimAdi) : u;
        if (unitName) unitSelect.add(new Option(unitName, unitName));
    });

    // [WHY]: Düzenleme window.data.locations[id] ile (dizi + id) aranıyordu: form boş açılıyor, kaydedince kayıt eziliyor ve
    //        atanmış kişiler kayboluyordu (ADM-04).
    // [HOW]: Kayıt id ile bulunur; kayıtlı birim listede yoksa seçenek olarak eklenir; kişiler rozet listesinden çizilir.
    const loc = id ? (window.data.locations || []).find(l => String(l.id) === String(id)) : null;
    if (id && !loc) {
        showAppAlert('Mahal bulunamadı; liste güncellenmiş olabilir.', 'error');
        return;
    }
    if (loc) {
        title.innerHTML = '<i class="fas fa-edit text-info me-2"></i> Mahali Düzenle';
        document.getElementById('loc_code').value = loc.code || '';
        if (loc.unit && ![...unitSelect.options].some(o => o.value === loc.unit)) unitSelect.add(new Option(loc.unit, loc.unit));
        document.getElementById('loc_unit').value = loc.unit || '';
        document.getElementById('loc_campus').value = loc.campus || '';
        document.getElementById('loc_corridor').value = loc.corridor || '';
        window.locationSelectedPersons = Array.isArray(loc.persons) ? loc.persons.map(p => ({ ...p })) : [];
        _renderLocationPersons();
    } else {
        title.innerHTML = '<i class="fas fa-map-marker-alt text-info me-2"></i> Yeni Mahal Tanımla';
    }

    modal.style.display = 'flex';
};

window.closeLocationModal = function () {
    document.getElementById('locationModal').style.display = 'none';
};

window.searchPersonnelForLocation = function (query) {
    const resultsDiv = document.getElementById('loc_personResults');
    if (!query || query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    window.bindActions(resultsDiv, {
        addLocationPerson: el => window.addPersonToLocation({ name: el.dataset.name, unit: el.dataset.unit }),
    });
    const allPersonel = window.data.personel || [];
    const filtered = allPersonel.filter(p => p.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'))).slice(0, 5);

    if (filtered.length > 0) {
        resultsDiv.innerHTML = filtered.map(p => {
            // Personel verisinde birim hangi isimle tutuluyor olabilirse hepsini dene
            const pUnit = p.birim || p.unit || p.department || p.bolum || p.departman || p.birimAdi || '';
            return `
                <div class="p-2 search-item-hover" style="cursor:pointer; border-bottom:1px solid #eee;" data-action="addLocationPerson" data-name="${escapeHtml(String(p.name))}" data-unit="${escapeHtml(String(pUnit))}">
                    <strong>${escapeHtml(p.name)}</strong> ${pUnit ? `<small class="text-muted">(${escapeHtml(pUnit)})</small>` : ''}
                </div>
            `;
        }).join('');
        resultsDiv.style.display = 'block';
    } else {
        resultsDiv.style.display = 'none';
    }
};

// [WHY]: Kişi çıkarınca rozetler addPersonToLocation ile yeniden çizilmeye çalışılıyordu; kişi zaten listede olduğu için
//        fonksiyon hemen dönüyor ve TÜM rozetler siliniyordu (ADM-04).
// [HOW]: Rozetler her zaman locationSelectedPersons dizisinden çizilir; ekle/çıkar yalnız diziyi değiştirir.
function _renderLocationPersons() {
    const container = document.getElementById('loc_selectedPersons');
    if (!container) return;
    window.bindActions(container, { removeLocationPerson: el => window.removePersonFromLocation(el.dataset.name) });
    container.innerHTML = window.locationSelectedPersons.map(p => `
        <span class="badge bg-light text-dark border d-flex align-items-center gap-2 p-2">${escapeHtml(p.name)}
            <i class="fas fa-times text-danger" style="cursor:pointer;" data-action="removeLocationPerson" data-name="${escapeHtml(String(p.name))}"></i></span>`).join('');
}

window.addPersonToLocation = function (person) {
    if (!person || !person.name) return;
    if (!window.locationSelectedPersons.some(p => p.name === person.name)) {
        window.locationSelectedPersons.push(person);
        _renderLocationPersons();
    }
    document.getElementById('loc_personSearch').value = '';
    document.getElementById('loc_personResults').style.display = 'none';
};

window.removePersonFromLocation = function (name) {
    window.locationSelectedPersons = window.locationSelectedPersons.filter(p => p.name !== name);
    _renderLocationPersons();
};

// [WHY]: Kayıt tam nesneyle değiştiriliyor (form dışı alanlar kayboluyor), düzenlenen kayıt bulunamazsa sessizce hiçbir şey
//        yazılmıyor, saveData sonucu kontrol edilmeden "güncellendi" deniyordu (ADM-04).
// [HOW]: Mevcut kayıt id ile bulunup {...mevcut, ...form} ile birleştirilir; yalnız 'locations' yazılır ve sonuç kontrol edilir.
window.saveLocation = async function (e) {
    if (e) e.preventDefault();

    const id = document.getElementById('loc_id').value;
    const locations = [...(window.data.locations || [])];
    const existing = id ? locations.find(l => String(l.id) === String(id)) : null;
    if (id && !existing) { showAppAlert('Düzenlenen mahal bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }

    const now = Date.now();
    const formFields = {
        code: document.getElementById('loc_code').value.trim(),
        unit: document.getElementById('loc_unit').value,
        campus: document.getElementById('loc_campus').value,
        corridor: document.getElementById('loc_corridor').value,
        persons: window.locationSelectedPersons.map(p => ({ ...p })),
        updatedAt: now
    };
    const next = existing
        ? locations.map(l => String(l.id) === String(id) ? { ...l, ...formFields, id: l.id } : l)
        : [...locations, { id: 'loc_' + now, ...formFields, createdAt: now }];

    if (!(await window.writeOk(window.saveData('locations', next)))) {
        showAppAlert('Mahal kaydedilemedi. Yetkinizi ve bağlantınızı kontrol edin.', 'error');
        return;
    }
    showAppAlert(existing ? "Mahal güncellendi." : "Yeni mahal eklendi.", "success");
    window.closeLocationModal();
    window.renderLocationsTable();
};

window.deleteLocation = async function (id) {
    if (!confirm("Bu mahali silmek istediğinize emin misiniz?")) return;
    const next = (window.data.locations || []).filter(l => String(l.id) !== String(id));
    if (!(await window.writeOk(window.saveData('locations', next)))) { showAppAlert('Mahal silinemedi.', 'error'); return; }
    window.renderLocationsTable();
    showAppAlert("Mahal silindi.", "info");
};

window.renderLocationsTable = function () {
    const body = document.getElementById('locationTableBody');
    if (!body) return;

    window.bindActions(body, {
        openLocationModal: el => window.openLocationModal(el.dataset.id),
        deleteLocation: el => window.deleteLocation(el.dataset.id),
    });
    const locArray = window.data.locations || [];

    // Kopya alıp sırala
    const sorted = [...locArray].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    body.innerHTML = sorted.map(loc => {
        const persons = loc.persons || [];
        const maxVisible = 2;
        const hasMore = persons.length > maxVisible;
        const visiblePersons = persons.slice(0, maxVisible);
        const moreCount = persons.length - maxVisible;

        return `
        <tr class="align-middle">
            <td class="fw-bold text-dark">${escapeHtml(loc.code || '-')}</td>
            <td>${escapeHtml(loc.unit || '-')}</td>
            <td>
                <span class="badge bg-soft-primary text-primary">${escapeHtml(loc.campus || '-')}</span>
                <small class="text-muted ms-1">${escapeHtml(loc.corridor || '-')} Koridoru</small>
            </td>
            <td>
                <div class="person-tag-container" title="${escapeHtml(persons.map(p => p.name).join(', '))}">
                    ${visiblePersons.map(p => `<span class="badge bg-light text-dark border-0 person-tag">${escapeHtml(p.name)}</span>`).join('')}
                    ${hasMore ? `
                        <div class="person-tag-more">
                            +${moreCount}
                            <div class="person-popover">
                                ${persons.map(p => `<div class="popover-item">${escapeHtml(p.name)}</div>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${persons.length === 0 ? '<span class="text-muted small">Atanmamış</span>' : ''}
                </div>
            </td>
            <td class="text-end">
                <div class="d-flex justify-content-end gap-2">
                    <button data-action="openLocationModal" data-id="${escapeHtml(String(loc.id))}" class="p-btn-icon play" title="Düzenle">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button data-action="deleteLocation" data-id="${escapeHtml(String(loc.id))}" class="p-btn-icon delete" title="Sil">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');

    if (sorted.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center p-5 text-muted">Henüz tanımlanmış bir mahal bulunmuyor.</td></tr>';
    }
};
