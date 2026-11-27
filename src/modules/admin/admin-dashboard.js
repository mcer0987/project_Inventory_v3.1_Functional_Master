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
            try { if (typeof window.renderDashboardStats === 'function') window.renderDashboardStats(); } catch (e) { console.error('[reveal] renderDashboardStats:', e); }
            try { if (typeof window.renderCriticalStockTable === 'function') window.renderCriticalStockTable(); } catch (e) { console.error('[reveal] renderCriticalStockTable:', e); }
            try { if (typeof window.renderOpsRadarBadges === 'function') window.renderOpsRadarBadges(); } catch (e) { console.error('[reveal] renderOpsRadarBadges:', e); }
            try { if (typeof window.renderAdminRequestTable === 'function') window.renderAdminRequestTable(); } catch (e) { console.error('[reveal] renderAdminRequestTable:', e); }
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

// ── UX-1 · ORTAK GRAFİK YARDIMCILARI ─────────────────────────────────────────
// [WHY]: Dört analitik grafik (stok barı + 3 doughnut) aynı görsel dili ve tema duyarlılığını paylaşır.
// [HOW]: Renkler çizim anında (scriptable/plugin) okunur; tema değişince yalnız update() yeterlidir.
//        Tüm DOM düğümleri createElement + textContent ile kurulur (innerHTML yok).
function chartTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
        dark,
        text: v('--color-text', dark ? '#e2e8f0' : '#1e293b'),
        muted: v('--color-text-muted', dark ? '#94a3b8' : '#64748b'),
        surface: v('--color-surface', dark ? '#1e293b' : '#ffffff'),
        grid: dark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.16)',
        barFrom: dark ? 'rgba(96, 165, 250, 0.30)' : 'rgba(52, 152, 219, 0.35)',
        barTo: dark ? '#60a5fa' : '#2d7dd2',
    };
}

const CHART_PALETTES = {
    stock: ['#2ecc71', '#e67e22', '#3498db', '#e74c3c', '#9b59b6', '#1abc9c', '#f1c40f', '#34495e'],
    exitDemirbas: ['#e74c3c', '#c0392b', '#d35400', '#f39c12', '#e67e22'],
    exitSarf: ['#2ecc71', '#27ae60', '#3498db', '#2980b9', '#1abc9c'],
};

function paletteColors(base, count) {
    const colors = base.slice(0, count);
    for (let i = base.length; i < count; i++) colors.push(`hsl(${(i * 47) % 360}, 62%, 52%)`);
    return colors;
}

const fmtPct = value => `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;
const domEl = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
};

// Lejanttan gizlenen dilimler tuval kimliğine göre saklanır; grafik yeniden kurulsa da seçim korunur.
const hiddenSlices = {};

// Doughnut ortasına görünür dilimlerin toplam adedini ve alt etiketi çizer (DOM'a dokunmaz).
const donutCenterPlugin = {
    id: 'donutCenter',
    afterDraw(chart) {
        const opts = chart.$donut; // renderDonut her çizimde güncel merkez verisini buraya yazar
        const arc = chart.getDatasetMeta(0)?.data?.[0];
        const area = chart.chartArea;
        if (!arc || !area || !opts) return;
        const inner = arc.innerRadius || 0;
        if (inner < 24) return;
        const t = chartTheme();
        const total = opts.empty ? 0 : opts.values.reduce((s, val, i) => s + (chart.getDataVisibility(i) ? val : 0), 0);
        const big = Math.max(16, Math.min(34, inner * 0.55));
        const small = Math.max(10, Math.min(13, big * 0.42));
        const cx = (area.left + area.right) / 2, cy = (area.top + area.bottom) / 2;
        const { ctx } = chart;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = t.text;
        ctx.font = `700 ${big}px ${Chart.defaults.font.family}`;
        ctx.fillText(total.toLocaleString('tr-TR'), cx, cy - small * 0.7);
        ctx.fillStyle = t.muted;
        ctx.font = `600 ${small}px ${Chart.defaults.font.family}`;
        ctx.fillText(opts.empty ? 'Veri yok' : opts.caption, cx, cy + big * 0.6);
        ctx.restore();
    }
};

// Canvas'ı [grafik | lejant] yerleşimine bir kez taşır; lejant kabını döndürür.
function mountDonutLayout(canvas) {
    let wrap = canvas.closest('.dash-donut');
    if (!wrap) {
        const parent = canvas.parentElement;
        wrap = domEl('div', 'dash-donut');
        const box = domEl('div', 'dash-donut-canvas');
        const legend = domEl('div', 'dash-donut-legend');
        legend.setAttribute('role', 'group');
        legend.setAttribute('aria-label', 'Grafik göstergesi');
        parent.insertBefore(wrap, canvas);
        box.append(canvas);
        wrap.append(box, legend);
        parent.classList.add('dash-donut-host');
    }
    return wrap.querySelector('.dash-donut-legend');
}

// Renk göstergeli, adet + % oranlı, tıklayınca dilimi gizleyen/gösteren ve vurgulayan özel lejant.
function paintDonutLegend(chart, legend, labels, values, colors, hidden, empty, focusIndex) {
    legend.replaceChildren();
    if (empty) {
        legend.append(domEl('p', 'dash-legend-empty', 'Henüz kayıt yok'));
        return;
    }
    const visibleTotal = values.reduce((s, val, i) => s + (hidden.has(labels[i]) ? 0 : val), 0);
    const highlight = index => {
        if (!chart.getDataVisibility(index)) return;
        const active = [{ datasetIndex: 0, index }];
        chart.setActiveElements(active);
        chart.tooltip?.setActiveElements(active, { x: 0, y: 0 });
        chart.update('none');
    };
    const clearHighlight = () => {
        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chart.update('none');
    };
    labels.forEach((label, i) => {
        const isHidden = hidden.has(label);
        const pct = !isHidden && visibleTotal > 0 ? (values[i] / visibleTotal) * 100 : null;
        const item = domEl('button', 'dash-legend-item' + (isHidden ? ' is-hidden' : ''));
        item.type = 'button';
        item.setAttribute('aria-pressed', String(!isHidden));
        item.setAttribute('aria-label', `${label}: ${values[i]} adet${pct != null ? `, ${fmtPct(pct)}` : ', gizli'}. Dilimi gizlemek veya göstermek için basın.`);
        item.title = `${label}: ${values[i]} adet`;
        const dot = domEl('span', 'dash-legend-dot');
        dot.style.backgroundColor = colors[i];
        item.append(dot, domEl('span', 'dash-legend-name', label), domEl('span', 'dash-legend-val', values[i]),
            domEl('span', 'dash-legend-pct', pct != null ? fmtPct(pct) : '—'));
        item.addEventListener('click', () => {
            if (hidden.has(label)) hidden.delete(label); else hidden.add(label);
            chart.toggleDataVisibility(i);
            chart.update();
            paintDonutLegend(chart, legend, labels, values, colors, hidden, empty, i);
        });
        item.addEventListener('mouseenter', () => highlight(i));
        item.addEventListener('focus', () => highlight(i));
        item.addEventListener('mouseleave', clearHighlight);
        item.addEventListener('blur', clearHighlight);
        legend.append(item);
    });
    if (focusIndex != null) legend.children[focusIndex]?.focus();
}

// Üç doughnut grafiğinin ortak çizimi. Grafik varsa yerinde güncellenir (flicker yok), yoksa kurulur.
function renderDonut({ canvasId, labels, values, palette, offsets, caption = 'Adet' }) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    const empty = !labels.length;
    const L = empty ? ['Veri yok'] : labels;
    const V = empty ? [1] : values;
    const colors = empty ? ['rgba(148, 163, 184, 0.35)'] : paletteColors(palette, L.length);
    const legend = mountDonutLayout(canvas);
    const t = chartTheme();
    const hidden = hiddenSlices[canvasId] || (hiddenSlices[canvasId] = new Set());
    for (const name of [...hidden]) if (!L.includes(name)) hidden.delete(name);

    const dataset = {
        data: V, backgroundColor: colors, borderColor: t.surface, borderWidth: 2, hoverOffset: 6,
        offset: offsets || L.map(() => 0),
    };
    const center = { values: empty ? [] : values, caption, empty };
    const tooltipLabel = ctx => {
        if (empty) return '';
        const total = ctx.dataset.data.reduce((s, val, i) => s + (ctx.chart.getDataVisibility(i) ? val : 0), 0);
        const pct = total > 0 ? ` (${fmtPct((ctx.raw / total) * 100)})` : '';
        return ` ${ctx.label}: ${ctx.raw} Adet${pct}`;
    };

    let chart = Chart.getChart(canvas);
    if (chart && chart.config.type !== 'doughnut') { chart.destroy(); chart = null; }
    if (chart) {
        chart.data.labels = L;
        Object.assign(chart.data.datasets[0], dataset);
        chart.options.plugins.tooltip.enabled = !empty;
    } else {
        chart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: L, datasets: [dataset] },
            plugins: [donutCenterPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                layout: { padding: 18 }, // offset (dışarı çıkan dilim) ve hoverOffset kırpılmasın
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: !empty, callbacks: { label: tooltipLabel } },
                },
            },
        });
    }
    chart.$donut = center;
    L.forEach((name, i) => {
        const wantVisible = empty || !hidden.has(name);
        if (chart.getDataVisibility(i) !== wantVisible) chart.toggleDataVisibility(i);
    });
    chart.update('none');
    paintDonutLegend(chart, legend, L, V, colors, hidden, empty, null);
    return chart;
}

// Kayıtları (adet toplamı ile) tür veya model adına göre gruplar; çoktan aza sıralar.
function groupStockBy(items, mode) {
    const map = new Map();
    items.forEach(item => {
        const raw = mode === 'model' ? item.ürün : (item.tür || item.type);
        const label = window.getCleanProductName(String(raw || '').trim()) || (mode === 'model' ? 'İsimsiz' : 'Türsüz');
        const key = label.toLocaleUpperCase('tr-TR');
        const row = map.get(key) || { label, value: 0 };
        row.value += parseInt(item.adet) || 0;
        map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'tr'));
}

// Çubuk ucuna adet yazar.
const barValuePlugin = {
    id: 'barValueLabels',
    afterDatasetsDraw(chart) {
        const t = chartTheme();
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = t.text;
        ctx.font = `700 11px ${Chart.defaults.font.family}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const value = chart.data.datasets[0].data[i];
            if (value == null || chart.data.labels[i] === 'Veri Yok') return;
            ctx.fillText(String(value), bar.x + 6, bar.y);
        });
        ctx.restore();
    }
};

// Canvas'ı kaydırılabilir kapsayıcı içindeki yüksekliği ayarlanabilir sarmalayıcıya bir kez taşır.
function mountHBarLayout(canvas) {
    let inner = canvas.closest('.dash-hbar-inner');
    if (!inner) {
        const host = canvas.parentElement;
        inner = domEl('div', 'dash-hbar-inner');
        host.insertBefore(inner, canvas);
        inner.append(canvas);
        host.classList.add('dash-hbar-host');
    }
    return inner;
}

function renderStockBar(rows) {
    const canvas = document.getElementById('dashDemirbasChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const inner = mountHBarLayout(canvas);
    const labels = rows.length ? rows.map(r => r.label) : ['Veri Yok'];
    const values = rows.length ? rows.map(r => r.value) : [0];
    // Etiketler üst üste binmesin: her kalem için sabit satır yüksekliği, kapsayıcı dikey kayar.
    inner.style.height = `${Math.max(240, labels.length * 32 + 48)}px`;

    let chart = Chart.getChart(canvas);
    if (chart && chart.options.indexAxis !== 'y') { chart.destroy(); chart = null; }
    if (chart) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = values;
        chart.update('none');
        chart.resize();
    } else {
        chart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Demirbaş',
                    data: values,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 22,
                    backgroundColor: ctx => {
                        const bar = ctx.element;
                        const t = chartTheme();
                        if (!bar || !Number.isFinite(bar.x) || !Number.isFinite(bar.base) || Math.abs(bar.x - bar.base) < 1) return t.barTo;
                        const g = ctx.chart.ctx.createLinearGradient(bar.base, 0, bar.x, 0);
                        g.addColorStop(0, t.barFrom);
                        g.addColorStop(1, t.barTo);
                        return g;
                    },
                }]
            },
            plugins: [barValuePlugin],
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 40 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.raw} Adet` } },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: () => chartTheme().grid },
                        border: { display: false },
                        ticks: { precision: 0, color: () => chartTheme().muted },
                    },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            autoSkip: false,
                            color: () => chartTheme().text,
                            font: { size: 11 },
                            callback(value) {
                                const label = this.getLabelForValue(value);
                                return label.length > 26 ? `${label.slice(0, 25)}…` : label;
                            },
                        },
                    },
                },
            },
        });
    }
    window._dashCharts = window._dashCharts || {};
    window._dashCharts.bar = chart;
}

// Tema (data-theme) değişince dört grafiği yeni renklerle yeniden çizer (dark-mode-toggle.js'e dokunmadan).
if (!window._chartThemeObserver && typeof MutationObserver !== 'undefined') {
    let themeTimer = null;
    window._chartThemeObserver = new MutationObserver(() => {
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => {
            try {
                if (typeof window.renderDashboardStats === 'function' && window.data) window.renderDashboardStats();
                if (typeof window.renderExitCharts === 'function' && window.data) window.renderExitCharts();
            } catch (err) {
                console.warn('Grafik tema yenilemesi atlandı:', err);
            }
        }, 60);
    });
    window._chartThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// --- GRAFİK ÇİZİMİ (CHART.JS) ---

let demirbasExitChart = null;
let sarfExitChart = null;

window.renderExitCharts = function () {
    // PM NOTU: requests (talepler) yerine b3 (çıkışlar) loglanmalı ki doğru veriye baktığımızdan emin olalım.
    console.log("📊 Grafik Çizimi Başlıyor. Veri kaynağı hazır ve render ediliyor...");

    const demirbasCounts = {};
    const sarfCounts = {};

    // 1. UX-1: Mevcut doughnut grafikler yok edilmez; renderDonut yerinde günceller (lejant seçimi korunur, flicker olmaz).

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

    // Sayıca çoktan aza sıralanmış [ad, adet] çiftleri (lejant ve dilimler aynı sırayı kullanır).
    const sortedEntries = counts => Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

    // 4. DEMİRBAŞ GRAFİĞİNİ ÇİZ (doughnut + merkez toplam + özel lejant)
    const demirbasEntries = sortedEntries(demirbasCounts);
    demirbasExitChart = renderDonut({
        canvasId: 'exitDemirbasChart',
        labels: demirbasEntries.map(([name]) => name),
        values: demirbasEntries.map(([, n]) => n),
        palette: CHART_PALETTES.exitDemirbas,
    }) || demirbasExitChart;

    // 5. SARF GRAFİĞİNİ ÇİZ
    const ctxSarf = document.getElementById('exitSarfChart');
    if (ctxSarf) {
        const sarfEntries = sortedEntries(sarfCounts);
        const labels = sarfEntries.map(([name]) => name);

        // Son çıkışı yapılan sarf kategorisini öne çıkartmak için offset ekleme
        const offsets = labels.map(() => 0);
        if (highlightCategory) {
            const highlightIndex = labels.findIndex(lbl => lbl.toLowerCase() === highlightCategory.toLowerCase());
            if (highlightIndex !== -1) {
                offsets[highlightIndex] = 15; // 15px dışarı çıkar
            }
        }

        sarfExitChart = renderDonut({
            canvasId: 'exitSarfChart',
            labels,
            values: sarfEntries.map(([, n]) => n),
            palette: CHART_PALETTES.exitSarf,
            offsets,
        }) || sarfExitChart;

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

        // UX-2: ürün adı 2 satıra kadar açılır (CSS line-clamp), modeller mikro çip olur, mevcut/limit bir doluluk barıyla vurgulanır.
        const modelChips = data.models.length
            ? data.models.slice(0, 2).map(model =>
                `<span class="bento-chip" title="${escapeHtml(model)}">${escapeHtml(model)}</span>`).join('')
            : '<span class="bento-chip is-muted">Model yok</span>';
        const moreChip = data.models.length > 2
            ? `<span class="bento-chip is-muted" title="${escapeHtml(data.models.slice(2).join(', '))}">+${data.models.length - 2} model</span>`
            : '';
        const pct = Math.max(0, Math.min(100, Math.round((data.mevcut / Math.max(1, data.limit)) * 100)));
        const meterTone = data.mevcut === 0 ? 'is-danger' : data.mevcut <= 1 ? 'is-critical' : 'is-warning';

        return `
            <tr class="align-middle">
                <td>
                    <div class="bento-title" title="${escapeHtml(data.name)}">${escapeHtml(data.name)}</div>
                    <div class="bento-chips" title="${escapeHtml(data.models.join(', '))}">
                        ${modelChips}${moreChip}
                        <span class="bento-chip is-location" title="Konum"><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeHtml(data.location)}</span>
                    </div>
                </td>
                <td class="text-center">
                    <div class="bento-stock">
                        <span class="bento-stock-line"><b class="bento-stock-now ${data.mevcut <= 1 ? 'is-low' : ''}">${escapeHtml(data.mevcut)}</b><span class="text-muted small"> / ${escapeHtml(data.limit)}</span></span>
                        <span class="stock-meter ${meterTone /* xss-ok: üç sabit sınıf */}" role="progressbar" aria-label="Limite göre stok doluluğu" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(pct)}"><i style="width: ${escapeHtml(pct)}%"></i></span>
                    </div>
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
                        <button type="button" class="btn-action btn-buy" data-action="buyCriticalGroup"
                            data-key="${escapeHtml(data.key)}" title="EBYS Satın Almaya Aktar" aria-label="EBYS Satın Almaya Aktar">
                            <i class="fas fa-shopping-cart"></i>
                        </button>
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
        buyCriticalGroup: el => {
            const group = criticalStockGroupsByKey.get(el.dataset.key);
            if (!group) return;
            const limit = group.limit > 0 ? group.limit : 3;
            window.requestPurchase({
                name: group.displayName,
                category: group.typeName || (group.isDemirbas ? 'Demirbaş' : 'Sarf Malzeme'),
                currentStock: group.mevcut,
                limit,
                suggestedOrderQty: Math.max(1, (limit * 2) - group.mevcut),
            });
        },
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
                    <button type="button" class="btn btn-sm btn-outline-secondary modal-close-btn" data-action="closeCriticalProductInfo"
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
                <table class="table table-hover align-middle mb-0 admin-bento-table">
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
        // [WHY]: Mobilde 7 sütun yan yana sıkışıp kelimeleri harf harf bölüyordu.
        // [HOW]: Sayfadaki diğer admin tablolarıyla aynı enhanceBentoTable ile hücreler data-bento/data-label alır; CSS 2 sütunlu karta çevirir.
        const infoTable = body.querySelector('table');
        if (infoTable) enhanceBentoTable(infoTable);
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
                try { if (typeof window.renderDashboardStats === 'function') window.renderDashboardStats(); } catch (e) { console.error('[showAdminTab] renderDashboardStats:', e); }
                try { if (typeof window.renderCriticalStockTable === 'function') window.renderCriticalStockTable(); } catch (e) { console.error('[showAdminTab] renderCriticalStockTable:', e); }
                try { if (typeof window.renderOpsRadarBadges === 'function') window.renderOpsRadarBadges(); } catch (e) { console.error('[showAdminTab] renderOpsRadarBadges:', e); }
            }, 0);
        });
    } else if (tabId === 'productTypeSettings') {
        requestAnimationFrame(() => {
            setTimeout(() => {
                try { if (typeof window.renderExitCharts === 'function') window.renderExitCharts(); } catch (e) { console.error('[showAdminTab] renderExitCharts:', e); }
                try { if (typeof window.renderQuickExitDesk === 'function') window.renderQuickExitDesk(); } catch (e) { console.error('[showAdminTab] renderQuickExitDesk:', e); }
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
window._dashBarGroup = 'type'; // UX-1: Bar chart gruplama modu ('type' = Tür Bazlı, 'model' = Model Bazlı)

/**
 * Bar grafiği (Demirbaş Stok Durumu) filtrelerini yönetir.
 */
window.setBarChartFilter = function (filter, btn) {
    window._dashBarFilter = filter;

    // UI Güncelleme: Yalnız depo grubu butonlarını güncelle
    const toggleGroup = btn.closest('[data-toggle-group]') || btn.closest('.chart-toggles');
    if (toggleGroup) {
        toggleGroup.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    window.renderDashboardStats();
};

/**
 * UX-1: Bar grafiğinin gruplama modunu (Tür Bazlı | Model Bazlı) değiştirir.
 */
window.setBarGroupMode = function (mode, btn) {
    window._dashBarGroup = mode === 'model' ? 'model' : 'type';

    const toggleGroup = btn.closest('[data-toggle-group]') || btn.closest('.chart-toggles');
    if (toggleGroup) {
        toggleGroup.querySelectorAll('.chart-toggle-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
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

    // UX-1: Tekil (adet=1) satırlar tek tek çubuk olmaz; seçili moda göre (Tür / Model) gruplanıp adetleri toplanır.
    const barItems = barSource.filter(item =>
        // Pasifleri grafiklerden hariç tut
        !(item.durumu === 'Pasif' || item.status === 'Pasif') && window._isDemirbasStrict(item));
    const barRows = groupStockBy(barItems, window._dashBarGroup);

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





    // ── 1. BAR GRAFİK: Demirbaş Stok Durumu (yatay, gruplu, kaydırılabilir) ──
    renderStockBar(barRows);

    // ── 2. DOUGHNUT: Envanter Dağılımı (merkez toplam + özel lejant) ─────────
    if (typeof renderCustomWatchDashboard === 'function') {
        renderCustomWatchDashboard();
    }

    window._dashCharts = window._dashCharts || {};
    const pieEntries = Object.entries(typeCounts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    window._dashCharts.pie = renderDonut({
        canvasId: 'dashSarfChart',
        labels: pieEntries.map(([name]) => name),
        values: pieEntries.map(([, n]) => n),
        palette: CHART_PALETTES.stock,
    }) || window._dashCharts.pie;

    // ── 3. BAŞLIKLARI VE ALT BAŞLIKLARI GÜNCELLE ─────────────────────────────
    const barCard = document.getElementById('dashDemirbasChart')?.closest('.card');
    const pieCard = document.getElementById('dashSarfChart')?.closest('.card');
    const scopeLabel = { b1: 'B1 deposu', b2: 'B2 deposu', all: 'tüm depolar' };

    if (barCard) {
        const h3 = barCard.querySelector('h3');
        if (h3) h3.innerText = '🛡️ Demirbaş Stok Durumu'; // Bar her zaman demirbaş
        const sub = document.getElementById('dashBarSub');
        if (sub) sub.textContent = `${window._dashBarGroup === 'model' ? 'Model' : 'Tür'} bazlı toplam adet · ${scopeLabel[window._dashBarFilter] || scopeLabel.all}`;
    }
    if (pieCard) {
        const h3 = pieCard.querySelector('h3');
        if (h3) h3.innerText = isSarfView ? '📦 Sarf Malzeme Dağılımı' : '🛡️ Demirbaş Dağılımı';
        const sub = document.getElementById('dashPieSub');
        if (sub) sub.textContent = `Tür bazlı toplam adet · ${isSarfView ? 'sarf malzemeler' : (scopeLabel[pieMode] || scopeLabel.all)}`;
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

// [WHY]: v3.8 · VP-2 — Özel İzleme ve Kritik Stok satırlarındaki "Satın Al" tetikleyicisi konsola yazmak yerine
//        EBYS satın alma penceresini ilgili ürün ve önerilen miktarla ön-doldurmalı (otomatik kaydetmez).
// [HOW]: Açık radar varsa önce kapatılır; BurnRate.buildPurchasePrefillPayload zarfı EBYSPurchaseUI.openPrefilled'e
//        verilir; modül henüz yüklenmediyse geriye uyumlu olarak window.openNewPurchaseModal açılır.
window.requestPurchase = function (item) {
    if (typeof window.closeOpsRadar === 'function') window.closeOpsRadar();
    const list = Array.isArray(item) ? item : (item ? [item] : []);
    const BR = window.AppModules && window.AppModules.BurnRate;
    const normalized = list.map(x => ({
        name: x.name || x.displayName || x.ürün || x.urun || '',
        category: x.category || x.tür || x.type || x.prodType || 'Sarf Malzeme',
        currentStock: Number(x.currentStock ?? x.mevcut ?? x.adet ?? x.qty ?? 0) || 0,
        limit: Number(x.limit || 3) || 3,
        dailyRate: Number(x.dailyRate || 0) || 0,
        daysRemaining: x.daysRemaining ?? null,
        suggestedOrderQty: Math.max(1, Math.round(Number(x.suggestedOrderQty) || Math.max(1, ((Number(x.limit) || 3) * 2) - (Number(x.currentStock ?? x.mevcut ?? x.adet ?? 0) || 0)))),
    })).filter(x => x.name);

    const maxItems = window.AppModules?.PurchaseMoney?.MAX_ITEMS || 3;
    const payload = BR && normalized.length
        ? BR.buildPurchasePrefillPayload(normalized, { maxItems })
        : {
            subject: normalized[0] ? `Kritik Stok Tedariği: ${normalized[0].name}` : '',
            description: '',
            priority: 'Hızlı',
            items: normalized.slice(0, maxItems).map(x => ({
                description: x.name, category: x.category, quantity: x.suggestedOrderQty,
                unit: 'Adet', unitPrice: '', currency: 'TRY', taxRate: 0,
            })),
        };

    if (window.AppModules?.EBYSPurchaseUI?.openPrefilled) {
        window.AppModules.EBYSPurchaseUI.openPrefilled(payload);
    } else if (typeof window.openNewPurchaseModal === 'function') {
        window.openNewPurchaseModal();
    }
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

// ── UX-2 · ADMIN BENTO TABLOLARI ─────────────────────────────────────────────
// [WHY]: ~17 admin tablosu dar ekranda yatay taşıyor veya okunmuyordu; satırları basan modüller beş farklı dosyada.
// [HOW]: Tek bir geliştirici hedef tablolara `admin-bento-table` sınıfını ekler, `thead th` metinlerinden her `td`'ye
//        `data-label` ve rol (`data-bento`) yazar. CSS (admin-add-style.css) ≤768px'te her `tr`'yi bento karta çevirir.
//        Renderer'lar tbody.innerHTML ile satırları yenileyince MutationObserver etiketleri tazeler.
//        Observer yalnız { childList, subtree } izler; geliştirici yalnız öznitelik/sınıf yazar → sonsuz döngü olmaz.
//        Satır içeriğine, data-action delegasyonlarına ve escapeHtml çıktılarına dokunulmaz (innerHTML yazılmaz).
const BENTO_TABLE_SELECTORS = [
    '#customWatchTable', '#criticalStockTable', '#tablePersonel', '#purchaseRequestTable',
    '#quickExitDeskBody', '#ebysDocumentRows', '[data-execution-rows]',
    '#adminPendingRequestsBody', '#adminReturnRequestsBody', '#serviceTableBody',
    '#templateTableBody', '#locationTableBody', '#adminDefProductTypeTableBody',
    '#adminDefUnitTableBody', '#adminDefTemplateTableBody', '#ebysDocumentTypesBody',
];
// Kart başlığı olacak sütun (ilk eşleşen); eşleşme yoksa ilk uygun hücre başlık olur.
const BENTO_TITLE_LABEL = /^(model|ürün|cihaz|evrak|kayıt|belge|şablon|tür adı|birim|ad soyad|mahal)/i;

function bentoHeaderLabels(table) {
    const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
    const labels = [];
    if (!headRow) return labels;
    [...headRow.cells].forEach(th => {
        const text = th.textContent.replace(/\s+/g, ' ').trim();
        for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text);
    });
    return labels;
}

function enhanceBentoTable(table) {
    const labels = bentoHeaderLabels(table);
    table.classList.add('admin-bento-table');
    if (!table.hasAttribute('role')) table.setAttribute('role', 'table');
    if (table.tHead && !table.tHead.hasAttribute('role')) table.tHead.setAttribute('role', 'rowgroup');
    [...(table.tHead?.rows[0]?.cells || [])].forEach(th => { if (!th.hasAttribute('role')) th.setAttribute('role', 'columnheader'); });

    [...table.tBodies].forEach(tbody => {
        if (!tbody.hasAttribute('role')) tbody.setAttribute('role', 'rowgroup');
        [...tbody.rows].forEach(row => {
            if (!row.hasAttribute('role')) row.setAttribute('role', 'row');
            const cells = [...row.cells];
            let col = 0;
            const info = cells.map(td => {
                const label = td.colSpan > 1 ? '' : (labels[col] || '');
                const norm = label.toLocaleLowerCase('tr-TR');
                col += td.colSpan || 1;
                let role = 'meta';
                if (td.colSpan > 1) role = 'empty';
                else if (td.querySelector('input[type="checkbox"]') && !td.textContent.trim()) role = 'select';
                else if (norm.includes('işlem') || td.querySelector('.action-buttons')) role = 'actions';
                else if (norm.includes('durum') || (td.children.length === 1 && td.firstElementChild.matches('.badge, .status-badge, [class*="badge"]') && td.textContent.trim() === td.firstElementChild.textContent.trim())) role = 'status';
                return { td, label, norm, role };
            });
            // Başlık hücresi: ürün/kayıt adı sütunu, yoksa ilk "meta" hücre.
            const titleCell = info.find(c => c.role === 'meta' && BENTO_TITLE_LABEL.test(c.norm)) || info.find(c => c.role === 'meta');
            if (titleCell) titleCell.role = 'title';
            info.forEach(({ td, label, role }) => {
                if (!td.hasAttribute('role')) td.setAttribute('role', 'cell');
                if (td.dataset.bento !== role) td.dataset.bento = role;
                if (label && td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
            });
            row.classList.toggle('bento-empty-row', info.length === 1 && info[0].role === 'empty');
        });
    });
}

function initAdminBentoTables() {
    const tables = new Set();
    BENTO_TABLE_SELECTORS.forEach(selector => document.querySelectorAll(selector).forEach(node => {
        const table = node.closest('table');
        if (table) tables.add(table);
    }));
    tables.forEach(table => {
        let queued = false;
        const run = () => { queued = false; enhanceBentoTable(table); };
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(run);
        }).observe(table, { childList: true, subtree: true });
        enhanceBentoTable(table);
    });
}
window.enhanceAdminBentoTables = initAdminBentoTables;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdminBentoTables, { once: true });
else initAdminBentoTables();

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// v3.8 · VP-1 — Operasyon Merkezi radarları: Aktif Zimmet & İade Radarı, Hurda & Servis Radarı
// [WHY]: İki "Yakında" kartı statik vizyon metni gösteriyordu; geciken iadeler ve kronik arızalı cihazlar yöneticinin
//        gözünden kaçıyordu.
// [HOW]: Hesap saf modülden (AppModules.AssetHealth); bu blok yalnız sayaç rozetlerini ve radar penceresini çizer.
//        Dinamik metin createElement/textContent ile basılır, olaylar bindActions (data-action) ile bağlanır.
// ─────────────────────────────────────────────────────────────────────────────────────────────
(function () {
    const AH = () => window.AppModules && window.AppModules.AssetHealth;
    const BR = () => window.AppModules && window.AppModules.BurnRate;
    let activeRadar = null;   // 'active_assignment' | 'scrap_service' | 'critical_stock' | 'ai_burn_rate' | null
    let burnWindowDays = 30;
    let burnStatusFilter = 'all';
    let burnQuery = '';
    const selectedCriticalKeys = new Set();

    function node(tag, cls, txt, attrs) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (txt != null) n.textContent = txt;
        if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v != null) n.setAttribute(k, v); });
        return n;
    }

    function readAssignments() {
        const h = AH(), A = window.AssignmentService;
        if (!h || !A) return null;
        return h.summarizeActiveAssignments(A.getAssignments(), Date.now());
    }
    function readService() {
        const h = AH(), d = window.data;
        if (!h || !d) return null;
        return h.analyzeServiceAndScrap(d.b1, d.b2, d.b3, d.serviceRecords);
    }
    function readBurnRate(winDays) {
        const b = BR(), d = window.data;
        if (!b || !d) return null;
        return b.analyzeBurnRate({
            b1: d.b1, b2: d.b2, b3: d.b3,
            productTypes: d.productTypes,
            windowDays: winDays || burnWindowDays,
            nowMs: Date.now(),
        });
    }
    function readCriticalOrders() {
        const b = BR(), d = window.data;
        if (!b || !d) return null;
        const br = readBurnRate(30);
        return b.buildCriticalOrderCandidates(br, { b1: d.b1, b2: d.b2, productTypes: d.productTypes });
    }

    // ── Kart rozetleri ──
    window.renderOpsRadarBadges = function () {
        const set = (id, text, tone) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = text;
            el.classList.remove('is-ok', 'is-warn', 'is-danger', 'is-loading');
            el.classList.add(tone);
        };
        try {
            const a = readAssignments();
            if (a) set('opsBadge-active_assignment', `${a.active} Aktif · ${a.overdue.length} Geciken İade`, a.overdue.length ? 'is-danger' : (a.dueSoon.length ? 'is-warn' : 'is-ok'));
            const s = readService();
            if (s) set('opsBadge-scrap_service', `${s.counts.inService} Serviste · ${s.counts.chronic} Kronik Risk`, s.counts.chronic ? 'is-danger' : (s.counts.inService ? 'is-warn' : 'is-ok'));
            const c = readCriticalOrders();
            if (c) set('opsBadge-critical_stock', `${c.counts.total} Kritik Stok · ${c.counts.outOfStock} Tükendi`, c.counts.outOfStock || c.counts.danger ? 'is-danger' : (c.counts.total ? 'is-warn' : 'is-ok'));
            const br = readBurnRate(30);
            if (br) {
                const hasAnyForecast = br.counts.critical + br.counts.warning + br.counts.safe > 0;
                const brText = hasAnyForecast
                    ? `${br.counts.critical} Kalem ≤14 Gün · ${br.counts.warning} Uyarı`
                    : `${br.counts.total} Sarf · Veri Birikiyor`;
                const brTone = br.counts.critical ? 'is-danger' : (br.counts.warning ? 'is-warn' : 'is-ok');
                set('opsBadge-ai_burn_rate', brText, brTone);
            }
        } catch (e) { console.error('[renderOpsRadarBadges]', e); }
    };

    // ── Pencere yapı taşları ──
    function chip(label, value, tone) {
        const c = node('div', 'ops-radar-chip' + (tone ? ' is-' + tone : ''));
        c.append(node('span', 'ops-radar-chip-value', String(value)), node('span', 'ops-radar-chip-label', label));
        return c;
    }
    function section(title, count, tone) {
        const h = node('h5', 'ops-radar-section-title');
        h.append(node('span', null, title), node('span', 'ops-radar-count' + (tone ? ' is-' + tone : ''), String(count)));
        return h;
    }
    function emptyNote(text) { return node('p', 'ops-radar-empty', text); }
    function cell(bento, label, content) {
        const td = node('td', null, null, { 'data-bento': bento, 'data-label': label });
        if (content instanceof Node) td.append(content); else if (content != null) td.textContent = content;
        return td;
    }
    function table(headers, rows) {
        const t = node('table', 'admin-bento-table ops-radar-table');
        const head = node('thead'), hr = node('tr');
        headers.forEach(h => hr.append(node('th', null, h)));
        head.append(hr);
        const tb = node('tbody');
        rows.forEach(r => tb.append(r));
        t.append(head, tb);
        const wrap = node('div', 'ops-radar-table-wrap');
        wrap.append(t);
        return wrap;
    }
    function badge(text, tone) { return node('span', 'ops-radar-pill is-' + tone, text); }
    function actionBtn(label, icon, action, data) {
        const b = node('button', 'ops-radar-btn', null, { type: 'button', 'data-action': action });
        Object.entries(data || {}).forEach(([k, v]) => b.setAttribute('data-' + k, v));
        b.append(node('i', 'fas ' + icon, null, { 'aria-hidden': 'true' }), document.createTextNode(' ' + label));
        return b;
    }
    const deviceIdOf = x => [x.sn, x.envanterNo].find(v => v && !String(v).includes(',')) || '';
    const idText = x => [x.sn ? 'SN: ' + x.sn : '', x.envanterNo ? 'Env: ' + x.envanterNo : ''].filter(Boolean).join(' · ') || '—';

    function assignmentRows(list, overdue) {
        return list.map(x => {
            const tr = node('tr');
            const title = node('div');
            title.append(node('strong', null, x.personel), node('div', 'ops-radar-sub', x.urun));
            const days = overdue ? `${Math.abs(x.daysLeft)} gün gecikti` : (x.daysLeft === 0 ? 'Bugün' : `${x.daysLeft} gün kaldı`);
            const act = node('div', 'action-buttons');
            const dev = deviceIdOf(x);
            if (dev) act.append(actionBtn('Geçmiş', 'fa-history', 'radar-history', { identity: dev }));
            act.append(actionBtn('İade Al', 'fa-undo', 'radar-return', { id: String(x.id), source: x.source }));
            tr.append(
                cell('title', 'Personel / Ürün', title),
                cell('meta', 'Cihaz', idText(x)),
                cell('meta', 'İade Tarihi', x.iadeTarihi),
                cell('status', 'Durum', badge(days, overdue ? 'danger' : 'warn')),
                cell('actions', 'İşlem', act));
            return tr;
        });
    }

    function buildAssignment(body, actions) {
        const s = readAssignments();
        if (!s) { body.append(emptyNote('Zimmet verisi henüz yüklenmedi.')); return; }
        const chips = node('div', 'ops-radar-chips');
        chips.append(chip('Aktif zimmet', s.active), chip('Teslim bekleyen', s.awaitingDelivery, s.awaitingDelivery ? 'warn' : ''),
            chip('Geciken iade', s.overdue.length, s.overdue.length ? 'danger' : 'ok'), chip(`${s.dueSoonDays} gün içinde`, s.dueSoon.length, s.dueSoon.length ? 'warn' : 'ok'));
        body.append(chips);
        const heads = ['Personel / Ürün', 'Cihaz', 'İade Tarihi', 'Durum', 'İşlem'];
        body.append(section('Geciken iadeler', s.overdue.length, s.overdue.length ? 'danger' : 'ok'));
        body.append(s.overdue.length ? table(heads, assignmentRows(s.overdue, true)) : emptyNote('Geciken iade yok.'));
        body.append(section(`Yaklaşan iadeler (${s.dueSoonDays} gün)`, s.dueSoon.length, s.dueSoon.length ? 'warn' : 'ok'));
        body.append(s.dueSoon.length ? table(heads, assignmentRows(s.dueSoon, false)) : emptyNote('Yaklaşan iade yok.'));
        actions.append(
            actionBtn('Zimmet Sekmesine Git (Geciken)', 'fa-arrow-right', 'radar-go-assign', { due: 'overdue' }),
            actionBtn('Zimmet Sekmesine Git (Yaklaşan)', 'fa-arrow-right', 'radar-go-assign', { due: 'dueSoon' }),
            actionBtn('Tüm Zimmetler', 'fa-list', 'radar-go-assign', { due: 'all' }));
    }

    function buildService(body, actions) {
        const s = readService();
        if (!s) { body.append(emptyNote('Servis verisi henüz yüklenmedi.')); return; }
        const chips = node('div', 'ops-radar-chips');
        chips.append(chip('Serviste', s.counts.inService, s.counts.inService ? 'warn' : 'ok'), chip('Kronik risk', s.counts.chronic, s.counts.chronic ? 'danger' : 'ok'), chip('Hurdaya ayrılan', s.counts.scrap));
        body.append(chips);

        body.append(section('Kronik arıza uyarısı (≥2 servis kaydı)', s.chronic.length, s.chronic.length ? 'danger' : 'ok'));
        if (s.chronic.length) {
            body.append(table(['Cihaz', 'Kimlik', 'Servis Sayısı', 'Son Sevk', 'İşlem'], s.chronic.map(c => {
                const tr = node('tr');
                const title = node('div');
                title.append(node('strong', null, c.urun), node('div', 'ops-radar-sub', c.openCount ? `${c.openCount} kayıt şu an serviste` : 'Şu an serviste değil'));
                const act = node('div', 'action-buttons');
                const dev = deviceIdOf(c);
                if (dev) act.append(actionBtn('Geçmiş', 'fa-history', 'radar-history', { identity: dev }));
                tr.append(cell('title', 'Cihaz', title), cell('meta', 'Kimlik', c.sn || c.envanterNo ? idText(c) : 'Ürün bazlı (SN/Env yok)'),
                    cell('status', 'Servis Sayısı', badge(`${c.count} kayıt`, 'danger')), cell('meta', 'Son Sevk', c.lastTarih || '—'), cell('actions', 'İşlem', act));
                return tr;
            })));
        } else body.append(emptyNote('Kronik arızalı cihaz tespit edilmedi.'));

        body.append(section('Şu an serviste', s.inService.length, s.inService.length ? 'warn' : 'ok'));
        if (s.inService.length) {
            body.append(table(['Cihaz', 'Kimlik', 'Hedef', 'Sevk Tarihi', 'Durum'], s.inService.map(r => {
                const tr = node('tr');
                const title = node('div');
                title.append(node('strong', null, r.urun));
                if (r.tur) title.append(node('div', 'ops-radar-sub', r.tur));
                const st = node('div', 'ops-radar-stack');
                st.append(badge(r.durum, 'warn'));
                if (r.chronic) st.append(badge(`Kronik Risk · ${r.serviceCount}. kayıt`, 'danger'));
                tr.append(cell('title', 'Cihaz', title), cell('meta', 'Kimlik', idText(r)), cell('meta', 'Hedef', r.hedef),
                    cell('meta', 'Sevk Tarihi', r.sevkTarihi || '—'), cell('status', 'Durum', st));
                return tr;
            })));
        } else body.append(emptyNote('Serviste cihaz yok.'));

        body.append(section('Hurda dökümü', s.scrap.length, ''));
        if (s.scrap.length) {
            body.append(table(['Ürün', 'Kimlik', 'Adet', 'Tarih', 'Not'], s.scrap.map(r => {
                const tr = node('tr');
                tr.append(cell('title', 'Ürün', node('strong', null, r.urun)), cell('meta', 'Kimlik', idText(r)), cell('meta', 'Adet', String(r.adet)),
                    cell('meta', 'Tarih', r.tarih || '—'), cell('meta', 'Not', r.not || '—'));
                return tr;
            })));
        } else body.append(emptyNote('Hurdaya ayrılmış kayıt yok.'));
        actions.append(actionBtn('Servis Sekmesine Git', 'fa-arrow-right', 'radar-go-service'));
    }

    const TREND_LABEL = { accelerating: 'Hızlanıyor ↗', steady: 'Sabit →', slowing: 'Yavaşlıyor ↘', insufficient: 'Yetersiz veri' };
    const CONF_LABEL = { high: 'Yüksek', medium: 'Orta', low: 'Düşük', insufficient: '—' };

    // [WHY]: VP-2 — Sarf malzemelerin günlük tüketim hızını (30/60/90 gün EWMA) ve tahmini tükenme gününü
    //        güvenli DOM düğümleriyle sunar; yetersiz veride uydurma gün göstermez.
    // [HOW]: Pencere/filtre değişiminde yalnızca modal gövdesi yeniden çizilir; her kalemden EBYS ön-doldurmaya geçilebilir.
    function buildBurnRate(body, actions) {
        const s = readBurnRate(burnWindowDays);
        if (!s) { body.append(emptyNote('Tüketim tahminleme motoru henüz yüklenmedi.')); return; }

        const chips = node('div', 'ops-radar-chips');
        chips.append(
            chip('≤14 Gün Kritik', s.counts.critical, s.counts.critical ? 'danger' : 'ok'),
            chip('≤30 Gün Uyarı', s.counts.warning, s.counts.warning ? 'warn' : ''),
            chip('Güvende (>30g)', s.counts.safe, 'ok'),
            chip('Yetersiz Veri', s.counts.insufficient)
        );
        body.append(chips);

        const toolbar = node('div', 'ops-radar-toolbar');
        const winGroup = node('div', 'ops-radar-seg', null, { role: 'group', 'aria-label': 'Analiz penceresi' });
        [30, 60, 90].forEach(days => {
            const b = node('button', 'ops-radar-seg-btn' + (burnWindowDays === days ? ' is-active' : ''), `${days} Gün`, {
                type: 'button', 'data-action': 'radar-br-window', 'data-window': String(days),
                'aria-pressed': String(burnWindowDays === days),
            });
            winGroup.append(b);
        });

        const filterGroup = node('div', 'ops-radar-seg', null, { role: 'group', 'aria-label': 'Durum filtresi' });
        [['all', 'Tümü'], ['critical', 'Kritik'], ['warning', 'Uyarı'], ['safe', 'Güvende'], ['insufficient', 'Yetersiz']].forEach(([val, lbl]) => {
            const b = node('button', 'ops-radar-seg-btn' + (burnStatusFilter === val ? ' is-active' : ''), lbl, {
                type: 'button', 'data-action': 'radar-br-filter', 'data-status': val,
                'aria-pressed': String(burnStatusFilter === val),
            });
            filterGroup.append(b);
        });

        const search = node('input', 'ops-radar-search', null, {
            type: 'search', placeholder: 'Sarf malzeme ara…', 'aria-label': 'Sarf malzeme ara',
            value: burnQuery, 'data-br-search': '1',
        });
        search.value = burnQuery;
        toolbar.append(winGroup, filterGroup, search);
        body.append(toolbar);

        const q = burnQuery.trim().toLocaleLowerCase('tr-TR');
        const filtered = s.items.filter(item => {
            if (burnStatusFilter !== 'all' && item.status !== burnStatusFilter) return false;
            if (q && !item.name.toLocaleLowerCase('tr-TR').includes(q) && !item.category.toLocaleLowerCase('tr-TR').includes(q)) return false;
            return true;
        });

        body.append(section(`Sarf tüketim tahminleri (${burnWindowDays} günlük pencere)`, filtered.length, s.counts.critical ? 'danger' : ''));
        if (filtered.length) {
            body.append(table(['Sarf Malzeme', 'Mevcut Stok', 'Tüketim Hızı', 'Tahmini Tükenme', 'İşlem'], filtered.map(item => {
                const tr = node('tr');
                const title = node('div');
                title.append(node('strong', null, item.name));
                const subParts = [item.category, item.depots.length ? item.depots.join('/') : 'Depo kaydı yok'];
                title.append(node('div', 'ops-radar-sub', subParts.join(' · ')));

                const stockCell = node('div');
                stockCell.append(node('strong', null, `${item.currentStock} adet`), node('div', 'ops-radar-sub', `Limit: ${item.minLimit}`));

                const rateCell = node('div');
                if (item.status === 'insufficient') {
                    rateCell.append(node('span', 'ops-radar-sub', `${item.totalConsumed} adet / ${item.activeDays} gün`));
                } else {
                    rateCell.append(
                        node('strong', null, `${item.dailyRate} / gün`),
                        node('div', 'ops-radar-sub', `~${item.monthlyRate}/ay · ${TREND_LABEL[item.trend] || ''}`)
                    );
                }

                const statusWrap = node('div', 'ops-radar-stack');
                if (item.status === 'insufficient') {
                    statusWrap.append(badge('Yetersiz veri (≥2 gün)', 'muted'));
                } else if (item.daysRemaining === 0) {
                    statusWrap.append(badge('Stok tükendi (0 gün)', 'danger'));
                } else if (item.status === 'critical') {
                    statusWrap.append(badge(`~${item.daysRemaining} günde tükenecek`, 'danger'));
                } else if (item.status === 'warning') {
                    statusWrap.append(badge(`~${item.daysRemaining} gün kaldı`, 'warn'));
                } else {
                    statusWrap.append(badge(`~${item.daysRemaining} gün güvende`, 'ok'));
                }
                if (item.status !== 'insufficient') {
                    statusWrap.append(node('span', 'ops-radar-sub', `Güven: ${CONF_LABEL[item.confidence]}`));
                }

                const act = node('div', 'action-buttons');
                const qtyHint = Math.max(1, item.suggestedOrderQty || 1);
                act.append(actionBtn(`EBYS Aktar (${qtyHint})`, 'fa-shopping-cart', 'radar-ebys-one', { source: 'burn', key: item.key }));

                tr.append(
                    cell('title', 'Sarf Malzeme', title),
                    cell('meta', 'Mevcut Stok', stockCell),
                    cell('meta', 'Tüketim Hızı', rateCell),
                    cell('status', 'Tahmini Tükenme', statusWrap),
                    cell('actions', 'İşlem', act)
                );
                return tr;
            })));
        } else {
            body.append(emptyNote(s.items.length ? 'Seçili filtrede eşleşen sarf malzeme yok.' : 'Analiz edilecek sarf malzeme veya B3 tüketim kaydı bulunamadı.'));
        }

        actions.append(
            actionBtn('Kritik Sipariş İhtiyacına Geç', 'fa-triangle-exclamation', 'radar-switch', { radar: 'critical_stock' }),
            actionBtn('Satın Alma Sekmesine Git', 'fa-arrow-right', 'radar-go-service')
        );
    }

    // [WHY]: VP-2 — Minimum stok altı ve ≤14 günde tükenecek kalemlerden tekil veya en fazla 3 kalemlik toplu EBYS
    //        satın alma talebini ön-doldurarak yönetici onayına sunar.
    // [HOW]: PurchaseMoney.MAX_ITEMS (3) seçici sınırı zorlanır; otomatik submit yapılmaz.
    function buildCriticalStock(body, actions) {
        const c = readCriticalOrders();
        if (!c) { body.append(emptyNote('Kritik sipariş analizi henüz yüklenmedi.')); return; }

        const maxItems = window.AppModules?.PurchaseMoney?.MAX_ITEMS || (BR()?.MAX_PURCHASE_ITEMS || 3);
        const validKeys = new Set(c.items.map(x => x.key));
        [...selectedCriticalKeys].forEach(k => { if (!validKeys.has(k)) selectedCriticalKeys.delete(k); });

        const chips = node('div', 'ops-radar-chips');
        chips.append(
            chip('Kritik Aday', c.counts.total, c.counts.total ? 'danger' : 'ok'),
            chip('Tükendi (0)', c.counts.outOfStock, c.counts.outOfStock ? 'danger' : 'ok'),
            chip('Proaktif ≤14 Gün', c.counts.burnOnly, c.counts.burnOnly ? 'warn' : ''),
            chip(`EBYS Seçimi (Max ${maxItems})`, `${selectedCriticalKeys.size} / ${maxItems}`, selectedCriticalKeys.size ? 'warn' : '')
        );
        body.append(chips);

        body.append(node('p', 'ops-radar-note', `EBYS satın alma pilot kuralı gereği tek talepte en fazla ${maxItems} kalem aktarılabilir. Aktarım formu ön-doldurur; birim ve fiyatları girip siz onaylamadan kayıt oluşturulmaz.`));

        body.append(section('Sipariş önerilen kritik kalemler', c.items.length, c.items.length ? 'danger' : 'ok'));
        if (c.items.length) {
            body.append(table(['Seç', 'Ürün / Kategori', 'Stok / Limit', 'Durum', 'Öneri', 'İşlem'], c.items.map(item => {
                const tr = node('tr', selectedCriticalKeys.has(item.key) ? 'is-selected' : '');
                const checked = selectedCriticalKeys.has(item.key);
                const limitReached = selectedCriticalKeys.size >= maxItems && !checked;

                const cb = node('input', 'ops-radar-check', null, {
                    type: 'checkbox', 'data-crit-key': item.key,
                    'aria-label': `${item.name} kalemini EBYS talebine seç`,
                });
                cb.checked = checked;
                cb.disabled = limitReached;

                const title = node('div');
                title.append(node('strong', null, item.name));
                const sub = [item.category, item.depots.length ? item.depots.join('/') : ''].filter(Boolean).join(' · ');
                if (sub) title.append(node('div', 'ops-radar-sub', sub));

                const stockCell = node('div');
                stockCell.append(node('strong', null, `${item.currentStock} / ${item.limit}`));
                if (item.dailyRate > 0) stockCell.append(node('div', 'ops-radar-sub', `${item.dailyRate}/gün`));

                const act = node('div', 'action-buttons');
                act.append(actionBtn('EBYS Satın Almaya Aktar', 'fa-shopping-cart', 'radar-ebys-one', { source: 'critical', key: item.key }));

                tr.append(
                    cell('select', 'Seç', cb),
                    cell('title', 'Ürün / Kategori', title),
                    cell('meta', 'Stok / Limit', stockCell),
                    cell('status', 'Durum', badge(item.reason, item.severity)),
                    cell('meta', 'Önerilen Sipariş', `${item.suggestedOrderQty} Adet`),
                    cell('actions', 'İşlem', act)
                );
                return tr;
            })));
        } else {
            body.append(emptyNote('Minimum limit altında veya 14 gün içinde tükenecek kritik kalem bulunmuyor.'));
        }

        const bulkBtn = actionBtn(`Seçilenlerle EBYS Talebi Başlat (${selectedCriticalKeys.size}/${maxItems})`, 'fa-file-invoice', 'radar-ebys-bulk');
        bulkBtn.classList.add('ops-radar-btn-primary');
        if (selectedCriticalKeys.size === 0) bulkBtn.disabled = true;
        actions.append(bulkBtn);

        if (c.items.length > 0 && selectedCriticalKeys.size < Math.min(maxItems, c.items.length)) {
            actions.append(actionBtn(`İlk ${Math.min(maxItems, c.items.length)} Acil Kalemi Seç`, 'fa-check-double', 'radar-crit-top'));
        }
        if (selectedCriticalKeys.size > 0) {
            actions.append(actionBtn('Seçimi Temizle', 'fa-eraser', 'radar-crit-clear'));
        }
        actions.append(actionBtn('Tüketim Tahminleme Motoru', 'fa-brain', 'radar-switch', { radar: 'ai_burn_rate' }));
    }

    function launchEbysPrefill(candidates) {
        const b = BR();
        if (!b || !candidates.length) return;
        const maxItems = window.AppModules?.PurchaseMoney?.MAX_ITEMS || b.MAX_PURCHASE_ITEMS || 3;
        const payload = b.buildPurchasePrefillPayload(candidates, { maxItems });
        window.closeOpsRadar();
        if (window.AppModules?.EBYSPurchaseUI?.openPrefilled) {
            window.AppModules.EBYSPurchaseUI.openPrefilled(payload);
        } else if (typeof window.openNewPurchaseModal === 'function') {
            window.openNewPurchaseModal();
        }
    }

    const RADARS = {
        active_assignment: {
            icon: 'fa-right-left', title: 'Aktif Zimmet & İade Radarı', build: buildAssignment,
            intro: 'Personelin üzerindeki aktif zimmetleri ve iade tarihi geçen ya da yaklaşan cihazları tek ekranda görürsünüz; iadeyi buradan başlatabilir veya zimmet listesini filtreli açabilirsiniz.',
            help: ['Aktif zimmet: teslim alınmış ve henüz iade edilmemiş kalemlerdir; teslim bekleyenler ayrıca sayılır.',
                'Geciken iade: planlanan iade tarihi (günün sonu) geçmiş zimmetlerdir. Yaklaşan: iadesi 7 gün içinde olanlardır.',
                '"İade Al", zimmet ekranındaki "Zimmetten Düş" ile aynı işlemi başlatır; zimmeti kapatır ve işlemden önce onay ister.',
                'Yalnızca iade tarihi girilmiş (geçici) zimmetler geciken ya da yaklaşan sayılır.'],
        },
        scrap_service: {
            icon: 'fa-satellite-dish', title: 'Hurda & Servis Radarı', build: buildService,
            intro: 'Servisteki cihazları, tekrar tekrar arızalanan (kronik riskli) seri numaralarını ve hurdaya ayrılan donanımı görürsünüz; böylece onarım yerine değişim kararını daha erken verebilirsiniz.',
            help: ['Kronik risk: aynı cihaz (seri no, yoksa envanter no; demirbaşta ikisi de yoksa ürün) için en az 2 servis kaydı bulunmasıdır.',
                'Servis kayıtları depoya dönüşte silinmeyip kapatıldığı için eski arızalar da sayılır; ancak kayıt silme uygulaması kaldırılmadan önce silinmiş eski servis kayıtları görünmez, bu cihazların geçmiş arıza sayısı eksik olabilir.',
                'Sarf malzemeler kronik cihaz sayımına girmez.',
                'Hurda dökümü, hurdaya ayırma işleminde yazılan hareket kayıtlarından oluşur.'],
        },
        critical_stock: {
            icon: 'fa-triangle-exclamation', title: 'Kritik Sipariş İhtiyacı', build: buildCriticalStock,
            intro: 'Minimum stok limitinin altına düşen ürünlerle 14 gün içinde tükeneceği öngörülen sarf malzemelerini tek listede görür, seçtiğiniz kalemlerle tek tıkla EBYS satın alma taslağı hazırlayabilirsiniz.',
            help: ['Bu liste, minimum stok eşiği altındaki tüm aktif kayıtlar ile Tüketim Tahminleme Motorunun ≤14 gün kritik işaretlediği sarf malzemelerini birleştirir.',
                'Tek bir EBYS satın alma talebinde pilot sınır gereği en fazla 3 kalem seçilebilir.',
                '"EBYS Satın Almaya Aktar" veya "Seçilenlerle EBYS Talebi Başlat" düğmesi formu ön-doldurarak açar; birim, belge türü ve fiyatları kontrol edip siz göndermedikçe kayıt açılmaz.'],
        },
        ai_burn_rate: {
            icon: 'fa-brain', title: '🧠 AI Sarf Tüketim & Tahminleme Motoru', build: buildBurnRate,
            intro: 'B3 çıkış geçmişinizi analiz ederek sarf malzemelerin günlük tüketim hızını ve tahmini tükenme gününü hesaplar; hızlı tükenen kalemleri erkenden yakalamanızı sağlar.',
            help: ['Hesaplama tamamen tarayıcınız içinde deterministik zaman serisi (30/60/90 günlük pencere + son döneme ağırlık veren EWMA) ile yapılır; dış bir yapay zeka servisine veri gönderilmez.',
                'Yanlış alarmı önlemek için seçili pencerede en az 2 farklı günde tüketim kaydı olmayan kalemlerde gün tahmini üretilmez ("Yetersiz veri" olarak işaretlenir).',
                'Demirbaş zimmetleri, hurda ve iade edilmiş hareketler sarf tüketim hesabına katılmaz.'],
        },
    };

    function paint(def) {
        const body = document.getElementById('opsRadarBody'), actions = document.getElementById('opsRadarActions');
        if (!body || !actions) return;
        body.replaceChildren();
        actions.replaceChildren();
        def.build(body, actions);
    }

    window.openOpsRadar = function (kind) {
        const def = RADARS[kind], modal = document.getElementById('opsRadarModal');
        if (!def || !modal) return;
        activeRadar = kind;
        document.getElementById('opsRadarIcon').className = 'fas ' + def.icon;
        document.getElementById('opsRadarTitle').textContent = def.title;
        document.getElementById('opsRadarIntro').textContent = def.intro;
        const help = document.getElementById('opsRadarHelp');
        help.replaceChildren(...def.help.map(t => node('p', null, t)));
        help.hidden = true;
        document.getElementById('opsRadarInfoBtn').setAttribute('aria-expanded', 'false');
        paint(def);
        modal.hidden = false;
        modal.classList.add('show');
        document.getElementById('opsRadarClose').focus();
    };

    window.closeOpsRadar = function () {
        const modal = document.getElementById('opsRadarModal');
        if (!modal) return;
        const kind = activeRadar;
        activeRadar = null;
        modal.classList.remove('show');
        modal.hidden = true;
        const card = kind && document.querySelector(`[data-action="radar-open"][data-radar="${kind}"]`);
        if (card) card.focus();
    };

    // Canlı veri geldiğinde açık pencere yerinde yenilenir: odak ve kaydırma konumu korunur.
    window.refreshOpsRadar = function () {
        const def = activeRadar && RADARS[activeRadar];
        if (!def) return;
        const panel = document.querySelector('#opsRadarModal .ops-radar-panel');
        const top = panel ? panel.scrollTop : 0;
        paint(def);
        if (panel) panel.scrollTop = top;
    };

    function goTab(tabId) {
        window.closeOpsRadar();
        if (typeof window.showAdminTab === 'function') window.showAdminTab(tabId);
    }

    function wire() {
        const modal = document.getElementById('opsRadarModal');
        const row = document.getElementById('futureWidgetRow');
        if (!modal || !row || modal.__opsWired) return;
        modal.__opsWired = true;
        const open = (el) => window.openOpsRadar(el.dataset.radar);
        window.bindActions(row, { 'radar-open': open });
        row.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const el = e.target.closest('[data-action="radar-open"]');
            if (el) { e.preventDefault(); open(el); }
        });
        window.bindActions(modal, {
            'radar-close': () => window.closeOpsRadar(),
            'radar-backdrop': (el, e) => { if (e.target === el) window.closeOpsRadar(); },
            'radar-info': (el) => {
                const help = document.getElementById('opsRadarHelp');
                help.hidden = !help.hidden;
                el.setAttribute('aria-expanded', String(!help.hidden));
            },
            'radar-history': (el) => {
                const m = window.inventoryManagementModule;
                if (m && el.dataset.identity) m.showDeviceHistory(el.dataset.identity);
            },
            'radar-return': (el) => {
                const m = window.inventoryManagementModule;
                if (m) m.removeAssignment(el.dataset.id, el.dataset.source);   // kendi onay penceresini açar
            },
            'radar-go-assign': (el) => {
                goTab('inventoryManagementTab');
                const m = window.inventoryManagementModule;
                if (m && typeof m.focusDue === 'function') m.focusDue(el.dataset.due);
            },
            'radar-go-service': () => goTab('purchaseTab'),
            'radar-switch': (el) => { if (el.dataset.radar) window.openOpsRadar(el.dataset.radar); },
            'radar-br-window': (el) => {
                const w = Number(el.dataset.window);
                if ([30, 60, 90].includes(w)) { burnWindowDays = w; window.refreshOpsRadar(); }
            },
            'radar-br-filter': (el) => {
                if (el.dataset.status) { burnStatusFilter = el.dataset.status; window.refreshOpsRadar(); }
            },
            'radar-ebys-one': (el) => {
                const src = el.dataset.source, key = el.dataset.key;
                if (src === 'burn') {
                    const br = readBurnRate(burnWindowDays);
                    const hit = br && br.items.find(x => x.key === key);
                    if (hit) launchEbysPrefill([{ ...hit, limit: hit.minLimit }]);
                } else {
                    const crit = readCriticalOrders();
                    const hit = crit && crit.items.find(x => x.key === key);
                    if (hit) launchEbysPrefill([hit]);
                }
            },
            'radar-ebys-bulk': () => {
                const crit = readCriticalOrders();
                if (!crit) return;
                const picked = crit.items.filter(x => selectedCriticalKeys.has(x.key));
                if (!picked.length) return;
                selectedCriticalKeys.clear();
                launchEbysPrefill(picked);
            },
            'radar-crit-top': () => {
                const crit = readCriticalOrders();
                if (!crit) return;
                const maxItems = window.AppModules?.PurchaseMoney?.MAX_ITEMS || (BR()?.MAX_PURCHASE_ITEMS || 3);
                selectedCriticalKeys.clear();
                crit.items.slice(0, maxItems).forEach(x => selectedCriticalKeys.add(x.key));
                window.refreshOpsRadar();
            },
            'radar-crit-clear': () => {
                selectedCriticalKeys.clear();
                window.refreshOpsRadar();
            },
        });
        modal.addEventListener('change', (e) => {
            const cb = e.target.closest('input[data-crit-key]');
            if (!cb) return;
            const key = cb.dataset.critKey;
            const maxItems = window.AppModules?.PurchaseMoney?.MAX_ITEMS || (BR()?.MAX_PURCHASE_ITEMS || 3);
            if (cb.checked) {
                if (selectedCriticalKeys.size < maxItems) selectedCriticalKeys.add(key);
                else cb.checked = false;
            } else {
                selectedCriticalKeys.delete(key);
            }
            window.refreshOpsRadar();
        });
        modal.addEventListener('input', (e) => {
            const inp = e.target.closest('input[data-br-search]');
            if (!inp) return;
            const pos = inp.selectionStart;
            burnQuery = inp.value;
            window.refreshOpsRadar();
            const fresh = modal.querySelector('input[data-br-search]');
            if (fresh) { fresh.focus(); if (pos != null) fresh.setSelectionRange(pos, pos); }
        });
        modal.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeRadar) { e.stopPropagation(); window.closeOpsRadar(); } });
    }

    // Rozetler ve pencere bağları: DOM hazır olduğunda, sonra admin-router (veri olayı) ve showAdminTab (pano açılışı) çağrılarıyla yenilenir.
    const boot = () => { wire(); window.renderOpsRadarBadges(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
