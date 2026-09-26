// 1. EN ÜSTE İTHALATLAR GELMELİ
import { fireDb } from '../../services/firebase-handler.js';
import { getFirestore, updateDoc, setDoc, collection, onSnapshot, addDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── 🚨 KRİTİK STOK FİLTRE VE YARDIMCI FONKSİYONLAR ──
window.currentCriticalFilter = 'all';

// CHART INSTANCE'LARI (Memory Leak Engellemek İçin)
let demirbasChartInstance = null;
let statsChartInstance = null;

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
            confirmBtn.onclick = () => {
                overlay.style.display = 'none';
                resolve(true);
            };
            cancelBtn.onclick = () => {
                overlay.style.display = 'none';
                resolve(false);
            };
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
    expectedCollections: ["b1", "b2", "b3", "requests", "purchaseOrders", "serviceRecords", "settings"],
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

window.bulkAddB2Items = async function (itemsArray) {
    if (!Array.isArray(itemsArray)) {
        console.error("Hata: Veri bir dizi (array) olmalıdır.");
        return;
    }

    if (!window.data.b2) {
        window.data.b2 = [];
    }

    // Yeni verileri hazırla
    const formattedItems = itemsArray.map(item => ({
        id: item.id || 'b2-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
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

    // Mevcut listeye ekle
    window.data.b2 = [...window.data.b2, ...formattedItems];

    try {
        await window.saveData(window.data);
        if (typeof showAppAlert === 'function') {
            showAppAlert(`${formattedItems.length} ürün başarıyla B2 deposuna eklendi.`);
        } else {
            alert(`${formattedItems.length} ürün eklendi.`);
        }
        if (typeof window.renderTable === 'function') window.renderTable('b2');
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

    const allRequests = window.data.requests || [];
    tableBody.innerHTML = '';
    let pendingCount = 0;

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
        const isPending = !isApproved && !isRejected && !isCompleted;

        if (isPending) pendingCount++;

        let badgeHTML = '';
        if (isApproved) {
            badgeHTML = `<span class="p-badge p-badge-success" style="background:#d1fae5; color:#065f46; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-check-circle"></i> ONAYLANDI
                         </span>`;
        } else if (isRejected) {
            badgeHTML = `<span class="p-badge p-badge-danger" style="background:#fee2e2; color:#991b1b; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-times-circle"></i> REDDEDİLDİ
                         </span>`;
        } else if (isCompleted) {
            badgeHTML = `<span class="p-badge p-badge-completed" style="background: var(--badge-completed-bg); color: var(--badge-completed-text); border: 1px solid var(--badge-completed-border); padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600;">
                            <i class="fas fa-check-double"></i> TESLİM ALINDI
                         </span>`;
        } else {
            badgeHTML = `<span class="p-badge p-badge-waiting">
                            <i class="fas fa-clock"></i> BEKLEMEDE
                         </span>`;
        }

        tableBody.innerHTML += `
            <tr class="align-middle">
                <td class="ps-3">
                    <div style="font-size: 11px; color: #94a3b8; font-weight: 500;">${req.tarih || '-'}</div>
                </td>
                <td>
                    <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${req.personel || '-'}</div>
                </td>
                <td>
                    <div style="font-weight: 600; font-size: 14px; color: #0f172a;">${req.ürün || '-'}</div>
                    <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                        <i class="fas fa-layer-group me-1"></i> ${req.adet || 1} Adet
                    </div>
                </td>
                <td class="text-center">
                    ${badgeHTML}
                </td>
                <td class="text-end pe-3">
                    <div class="d-flex justify-content-end gap-2">
                        ${isPending ? `
                            <button onclick="window.confirmRequest(${index})" class="p-btn-icon play" title="Onayla">
                                <i class="fas fa-check"></i>
                            </button>
                            <button onclick="window.rejectRequest(${index})" class="p-btn-icon delete" title="Reddet">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : `
                            <button onclick="window.deleteRequest(${index})" class="p-btn-icon delete" title="Kayıttan Sil">
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

    if (allRequests.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-5">✅ Talep bulunmuyor.</td></tr>';
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

// Ürün Türlerini (Ayarlar Dökümanını) Ayrı Dinle
import { onSnapshot as onDocSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

onDocSnapshot(doc(window.fireDb, "settings", "productTypes"), (docSnap) => {
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Dökümanın içindeki 'list' dizisini alıyoruz
        window.data.productTypes = data.list || [];

        console.log("⚡ Ürün türleri güncellendi:", window.data.productTypes);

        if (window.renderProductTypesTable) window.renderProductTypesTable();
        if (window.updateProductTypeDropdowns) window.updateProductTypeDropdowns();
        if (typeof window.renderExitCharts === 'function') window.renderExitCharts();

        // ✅ Ayarlar yüklendi olarak işaretle
        if (window.LoadingCoordinator) {
            window.LoadingCoordinator.markLoaded("settings");
        }
    }
}, (err) => {
    if (err.code === "permission-denied") {
        console.warn("⏳ [Güvenlik] Firebase yetki onayı bekleniyor (productTypes)...");
    } else {
        console.error("Dinleme hatası (productTypes):", err);
    }
});

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

    const types = window.getActiveProductTypes();
    if (listBody) listBody.innerHTML = '';
    if (defListBody) defListBody.innerHTML = '';

    types.forEach((type) => {
        // Firebase ID'si yoksa veya null ise atla
        if (!type.id) return;

        const isDemirbas = type.isDemirbas === true || type.isDemirbas === "true";
        const typeNameForJS = type.name.replace(/'/g, "\\'");

        // --- ESKİ TABLO (3 Sütunlu) ---
        if (listBody) {
            listBody.innerHTML += `
                <tr class="align-middle">
                    <td class="ps-3" style="width: 40%;">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-tag me-2 text-primary opacity-75"></i>
                            <span class="fw-bold text-dark">${type.name}</span>
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
                            <button onclick="editProductType('${type.id}', '${typeNameForJS}', ${isDemirbas})" class="btn-action btn-buy shadow-sm" title="Düzenle">
                                <i class="fa-solid fa-arrows-rotate"></i>
                            </button>
                            <button onclick="deleteProductType('${type.id}')" class="btn-action btn-passive shadow-sm" title="Sil">
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
                            <span class="fw-bold text-dark">${type.name}</span>
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
                            <button onclick="editProductType('${type.id}', '${typeNameForJS}', ${isDemirbas})" class="btn-action btn-buy shadow-sm" title="Düzenle">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteProductType('${type.id}')" class="btn-action btn-passive shadow-sm" title="Sil">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });

    if (types.length === 0) {
        listBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted p-4">Tanımlı ürün türü bulunamadı.</td></tr>';
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
window.closeEditModal = function () {
    const modal = document.getElementById('editProductTypeModal');
    if (modal) modal.style.display = 'none';
};

// --- 1. YENİ TÜR EKLEME ---
window.addNewProductType = async function () {
    const nameInput = document.getElementById('newProductType');
    const isDemirbasCheck = document.getElementById('isDemirbasCheck');
    const name = nameInput.value.trim();
    const isDemirbas = isDemirbasCheck.checked;

    if (!name) {
        showAppAlert("Tür adı giriniz", "warning");
        return;
    }

    try {
        const { collection, addDoc } = window.FirebaseModules;

        // Doğrudan "productTypes" koleksiyonuna ekliyoruz!
        await addDoc(collection(window.fireDb, "productTypes"), {
            name: name,
            isDemirbas: isDemirbas,
            createdAt: Date.now()
        });

        // Formu temizle
        nameInput.value = '';
        isDemirbasCheck.checked = false;

        showAppAlert("Yeni tür başarıyla eklendi.", "success");
        // Not: Tabloyu ve dropdown'ı yenilemeye gerek yok, script.js'deki onSnapshot tetiklenecek!
    } catch (err) {
        console.error("❌ Ekleme hatası:", err);
        showAppAlert("Tür eklenirken bir hata oluştu.", "danger");
    }
};

// --- TANIMLAR SEKMESİ İÇİN YENİ TÜR EKLEME ---
/**
 * Bu fonksiyon teknik olarak window.addNewProductType ile aynı işlevi görür.
 * Ancak "Tanımlar" sekmesindeki yeni modern arayüze ait input ID'lerini (defNewProductType, defIsDemirbasCheck) 
 * kullandığı için ayrıştırılmıştır. Veri tabanı (Firebase) tarafında aynı koleksiyonu günceller.
 */
window.defAddNewProductType = async function () {
    const nameInput = document.getElementById('defNewProductType');
    const isDemirbasCheck = document.getElementById('defIsDemirbasCheck');
    const name = nameInput.value.trim();
    const isDemirbas = isDemirbasCheck.checked;

    if (!name) {
        showAppAlert("Tür adı giriniz", "warning");
        return;
    }

    try {
        const { collection, addDoc } = window.FirebaseModules;

        await addDoc(collection(window.fireDb, "productTypes"), {
            name: name,
            isDemirbas: isDemirbas,
            createdAt: Date.now()
        });

        // Formu temizle
        nameInput.value = '';
        isDemirbasCheck.checked = false;

        showAppAlert("Yeni tür başarıyla eklendi.", "success");
    } catch (err) {
        console.error("❌ Ekleme hatası:", err);
        showAppAlert("Tür eklenirken bir hata oluştu.", "danger");
    }
};

// --- 2. GÜNCELLEME (DEĞİŞİKLİKLERİ KAYDET) ---
window.saveProductTypeUpdate = async function () {
    const idInput = document.getElementById('editTypeId'); // Firebase Doc ID burada
    const nameInput = document.getElementById('editTypeName');
    const checkInput = document.getElementById('editIsDemirbas');

    if (!idInput || !nameInput) return;

    const docId = idInput.value;
    const newName = nameInput.value.trim();
    const newIsDemirbas = checkInput.checked;

    if (!newName) {
        showAppAlert("Tür adı boş olamaz!", "danger");
        return;
    }

    try {
        const { doc, updateDoc } = window.FirebaseModules;
        const firestoreDb = window.fireDb;

        // Sadece ilgili dökümanı güncelliyoruz
        const typeDocRef = doc(firestoreDb, "productTypes", docId);
        await updateDoc(typeDocRef, {
            name: newName,
            isDemirbas: newIsDemirbas
        });

        // 🔥 ürünlerde eski type adını güncelle
        const oldName = window.cachedEditingTypeName;

        if (oldName && oldName !== newName) {
            await window.syncProductTypesToProducts(oldName, newName);
        }

        // 🔥 UI'yı anında yenile
        await window.forceProductTypeSync();

        closeEditModal();
        showAppAlert("Ürün türü güncellendi.", "success");
    } catch (error) {
        console.error("❌ Kayıt hatası:", error);
        showAppAlert("Güncelleme başarısız.", "danger");
    }
};

// --- 3. SİLME İŞLEMİ ---
window.deleteProductType = async function (docId) {
    if (!confirm("Bu ürün türünü silmek istediğinize emin misiniz?")) return;

    try {
        const { doc, deleteDoc } = window.FirebaseModules;

        // ID'sine göre doğrudan dökümanı siliyoruz
        const typeDocRef = doc(window.fireDb, "productTypes", docId);
        await deleteDoc(typeDocRef);

        showAppAlert("Ürün türü silindi.", "danger");
    } catch (error) {
        console.error("❌ Silme hatası:", error);
    }
};

// Yeni bir ürün türü yaratmak. Bu isimde ürün var mı?" diye kontrol eder (mükerrer kayıt engelleme).
window.saveNewProductType = async function () {
    const nameInput = document.getElementById('newTypeName');
    const isDemirbasInput = document.getElementById('newTypeIsDemirbas');
    const name = nameInput.value.trim();
    const isDemirbas = isDemirbasInput.checked;

    if (!name) {
        if (typeof showAppAlert === 'function') showAppAlert("Lütfen bir ürün türü adı girin.", "warning");
        return;
    }

    const currentTypes = window.getActiveProductTypes();
    if (currentTypes.find(t => t.name.toLowerCase() === name.toLowerCase())) {
        if (typeof showAppAlert === 'function') showAppAlert("Bu ürün türü zaten mevcut!", "warning");
        return;
    }

    currentTypes.push({ name: name, isDemirbas: isDemirbas });

    // Firebase'e kaydet (firebase-handler'daki methoduna göre)
    if (typeof window.firebaseOperations !== 'undefined' && window.firebaseOperations.updateData) {
        await window.firebaseOperations.updateData('productTypes', currentTypes);
    } else {
        window.data.productTypes = currentTypes;
    }

    if (typeof showAppAlert === 'function') showAppAlert(`"${name}" başarıyla eklendi!`, "success");
    nameInput.value = '';
    isDemirbasInput.checked = false;

    renderProductTypesTable();
};

window.checkExitIsDemirbas = function (exit) {
    if (!exit) return false;

    const typeName = (exit.urunTuru || exit.tür || exit.productType || "").trim();
    const productName = (exit.urunAciklama || exit.ürün || exit.product || "").trim();
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
        const urunTuru = exit.urunTuru || exit.tür || exit.productType || "Bilinmeyen Tür";
        const adet = parseInt(exit.adet || exit.sarfAdet) || 1;

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
            const ageMs = Date.now() - parseInt(latestExitId);

            // Son 15 saniyede yapılmış bir sarf çıkışı ise animasyonu tetikle
            if (isLatestConsumable && ageMs < 15000) {
                highlightCategory = (latestExit.urunTuru || latestExit.tür || latestExit.productType || "").trim();
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
                        <div class="fw-bold text-truncate" title="${item.ürün || item.name}">${item.ürün || item.name}</div>
                        <small class="text-muted d-block">${item.depo} | ${item.rafNo || '-'}</small>
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
                            <button class="btn-action btn-passive" onclick="deleteType('${item.name}')" title="Pasif Yap"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`);
        }
    });

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

    // 1. Ürünleri Gruplandır (Demirbaşlar için Tür+Durum, Sarflar için sadece İsim)
    tumUrunler.forEach(item => {
        // [FİLTRE] Pasif ürünleri saymıyoruz (Eski kayıtlar veya depoda olmayanlar)
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
                    <div class="fw-bold text-truncate" title="${data.name}">${data.name}</div>
                    <small class="text-muted d-block">${data.location}</small>
                </td>
                <td class="text-center">
                    <span class="fw-bold ${data.mevcut <= 1 ? 'text-danger' : 'text-dark'}">${data.mevcut}</span>
                    <span class="text-muted small">/ ${data.limit}</span>
                </td>
                <td><div class="d-grid"><div class="${statusClass}">${statusText}</div></div></td>
                <td class="text-end">
                    <div class="action-buttons">
                        <button class="btn-action btn-buy" title="Satın Al"><i class="fas fa-shopping-cart"></i></button>
                        <button class="btn-action btn-mail" title="Bildirim Gönder"><i class="fas fa-envelope"></i></button>
                        <button class="btn-action btn-passive" title="Pasif Yap"><i class="fas fa-eye-slash"></i></button>
                        <button class="btn-action btn-danger" onclick="window.deleteCriticalGroup('${data.key}')" title="Ürünü Sil"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    }

    // Nihai render
    tableBody.innerHTML = rows.length
        ? rows.join('')
        : '<tr><td colspan="4" class="text-center p-4 text-muted">Stoklar ideal seviyede.</td></tr>';
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

    if (onay) {
        // Sort indices descending to avoid shifting issues during splicing
        const b1Indices = group.items.filter(i => i.key === 'b1').map(i => i.originalIndex).sort((a, b) => b - a);
        const b2Indices = group.items.filter(i => i.key === 'b2').map(i => i.originalIndex).sort((a, b) => b - a);

        b1Indices.forEach(idx => {
            if (window.data.b1) window.data.b1.splice(idx, 1);
        });
        b2Indices.forEach(idx => {
            if (window.data.b2) window.data.b2.splice(idx, 1);
        });

        // Save to Firebase
        if (typeof window.saveData === 'function') {
            await window.saveData(window.data);
            showAppAlert("Ürün(ler) depodan başarıyla silindi.", "success");
        }
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
                if (typeof window.renderAdminRequestTable === 'function') window.renderAdminRequestTable();
                if (typeof window.renderExitCharts === 'function') window.renderExitCharts();
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
            }, 0);
        });
    }

    // 💡 CONTEXTUAL TIP — Admin sekme değiştiğinde ipucu göster
    if (typeof window.TipManager === 'object' && typeof window.TipManager.showTipForTab === 'function') {
        window.TipManager.showTipForTab(tabId);
    }
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
            select.innerHTML += `<option value="${name}" data-is-demirbas="${isDemirbas}">
                ${name} (${label})
            </option>`;
        });

        // Önceki seçimi geri yükle
        select.value = currentVal;
    });
};

window.syncProductTypesToProducts = function (oldName, newName) {

    ['b1', 'b2'].forEach(depo => {

        (window.data?.[depo] || []).forEach(item => {

            if (item.tür === oldName) item.tür = newName;
            if (item.type === oldName) item.type = newName;
            if (item.prodType === oldName) item.prodType = newName;

        });

    });

    console.log(`✔ Tür güncellendi: ${oldName} → ${newName}`);
};

// "Özel Takip" Dashboard'u
window.renderCustomWatchDashboard = function () {
    const table = document.querySelector('#customWatchTable');
    if (!table) return;
    const container = table.parentElement;
    if (!container) return;

    const watchedItems = [];

    ['b1', 'b2'].forEach(depo => {
        (window.data?.[depo] || []).forEach(item => {
            if (item.isWatched) watchedItems.push(item);
        });
    });

    container.innerHTML = `
        <div id="watchCardsContainer" class="watch-grid">
            ${watchedItems.length === 0
            ? '<div class="empty-state">İzlenen ürün bulunamadı.</div>'
            : ''
        }
        </div>
    `;

    const cardContainer = document.getElementById('watchCardsContainer');

    let html = "";

    watchedItems.forEach(item => {

        const qty = parseInt(item.adet) || 0;
        const limit = parseInt(item.limit) || 5;
        const percent = Math.min((qty / (limit * 2)) * 100, 100);
        const isLow = qty <= limit;
        const statusColor = isLow ? '#e74c3c' : '#2ecc71';

        html += `
        <div class="watch-card" onclick="openWatchDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">

            <div class="watch-header">
                <div class="title">${item.ürün}</div>
                <div class="qty ${isLow ? 'danger' : 'success'}">${qty}</div>
            </div>

            <div class="meta">
                📦 ${item.depo || 'B1'} | 🏷 ${item.marka || '-'}
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
                    <span onclick="event.stopPropagation(); requestPurchase(${JSON.stringify(item).replace(/"/g, '&quot;')})">📦 Talep Et</span>
                    <span onclick="event.stopPropagation(); addToOrderList(${JSON.stringify(item).replace(/"/g, '&quot;')})">🛒 Sipariş</span>
                </div>
                ` : ''
            }

        </div>
        `;
    });

    cardContainer.innerHTML = html;
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
    try {
        const user = localStorage.getItem("activeUser");
        if (user) updateNavbarUI(JSON.parse(user));
    } catch (e) {
        console.warn('⚠️ [admin-dashboard] activeUser parse hatası:', e.message);
    }
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
        localStorage.removeItem('admin_auth');
        const lockModal = document.getElementById('adminLockModal');
        if (lockModal) lockModal.style.display = 'flex';
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
        if (unitName) {
            unitSelect.innerHTML += `<option value="${unitName}">${unitName}</option>`;
        }
    });

    if (id && window.data.locations && window.data.locations[id]) {
        const loc = window.data.locations[id];
        title.innerHTML = '<i class="fas fa-edit text-info me-2"></i> Mahali Düzenle';
        document.getElementById('loc_code').value = loc.code || '';
        document.getElementById('loc_unit').value = loc.unit || '';
        document.getElementById('loc_campus').value = loc.campus || '';
        document.getElementById('loc_corridor').value = loc.corridor || '';

        if (loc.persons && Array.isArray(loc.persons)) {
            loc.persons.forEach(p => window.addPersonToLocation(p));
        }
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

    const allPersonel = window.data.personel || [];
    const filtered = allPersonel.filter(p => p.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'))).slice(0, 5);

    if (filtered.length > 0) {
        resultsDiv.innerHTML = filtered.map(p => {
            // Personel verisinde birim hangi isimle tutuluyor olabilirse hepsini dene
            const pUnit = p.birim || p.unit || p.department || p.bolum || p.departman || p.birimAdi || '';
            return `
                <div class="p-2 search-item-hover" style="cursor:pointer; border-bottom:1px solid #eee;" onclick="window.addPersonToLocation({name:'${p.name}', unit:'${pUnit}'})">
                    <strong>${p.name}</strong> ${pUnit ? `<small class="text-muted">(${pUnit})</small>` : ''}
                </div>
            `;
        }).join('');
        resultsDiv.style.display = 'block';
    } else {
        resultsDiv.style.display = 'none';
    }
};

window.addPersonToLocation = function (person) {
    if (window.locationSelectedPersons.find(p => p.name === person.name)) return;

    window.locationSelectedPersons.push(person);
    const container = document.getElementById('loc_selectedPersons');

    const badge = document.createElement('span');
    badge.className = 'badge bg-light text-dark border d-flex align-items-center gap-2 p-2';
    badge.innerHTML = `${person.name} <i class="fas fa-times text-danger" style="cursor:pointer;" onclick="window.removePersonFromLocation('${person.name}')"></i>`;
    container.appendChild(badge);

    document.getElementById('loc_personSearch').value = '';
    document.getElementById('loc_personResults').style.display = 'none';
};

window.removePersonFromLocation = function (name) {
    window.locationSelectedPersons = window.locationSelectedPersons.filter(p => p.name !== name);
    const container = document.getElementById('loc_selectedPersons');
    container.innerHTML = '';
    window.locationSelectedPersons.forEach(p => window.addPersonToLocation(p));
};

window.saveLocation = async function (e) {
    if (e) e.preventDefault();

    const id = document.getElementById('loc_id').value;
    const newLoc = {
        id: id || 'loc_' + Date.now(),
        code: document.getElementById('loc_code').value,
        unit: document.getElementById('loc_unit').value,
        campus: document.getElementById('loc_campus').value,
        corridor: document.getElementById('loc_corridor').value,
        persons: window.locationSelectedPersons,
        updatedAt: Date.now(),
        createdAt: id ? (window.data.locations?.find(l => l.id === id)?.createdAt || Date.now()) : Date.now()
    };

    if (!window.data.locations) window.data.locations = [];

    if (id) {
        const idx = window.data.locations.findIndex(l => l.id === id);
        if (idx !== -1) window.data.locations[idx] = newLoc;
    } else {
        window.data.locations.push(newLoc);
    }

    try {
        await window.saveData('locations', window.data.locations);
        showAppAlert(id ? "Mahal güncellendi." : "Yeni mahal eklendi.", "success");
        window.closeLocationModal();
    } catch (err) {
        console.error("Mahal kaydetme hatası:", err);
        showAppAlert("Hata oluştu!", "danger");
    }
};

window.deleteLocation = async function (id) {
    if (!confirm("Bu mahali silmek istediğinize emin misiniz?")) return;

    try {
        window.data.locations = window.data.locations.filter(l => l.id !== id);
        await window.saveData('locations', window.data.locations);
        showAppAlert("Mahal silindi.", "info");
    } catch (err) {
        console.error("Mahal silme hatası:", err);
    }
};

window.renderLocationsTable = function () {
    const body = document.getElementById('locationTableBody');
    if (!body) return;

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
            <td class="fw-bold text-dark">${loc.code || '-'}</td>
            <td>${loc.unit || '-'}</td>
            <td>
                <span class="badge bg-soft-primary text-primary">${loc.campus || '-'}</span>
                <small class="text-muted ms-1">${loc.corridor || '-'} Koridoru</small>
            </td>
            <td>
                <div class="person-tag-container" title="${persons.map(p => p.name).join(', ')}">
                    ${visiblePersons.map(p => `<span class="badge bg-light text-dark border-0 person-tag">${p.name}</span>`).join('')}
                    ${hasMore ? `
                        <div class="person-tag-more">
                            +${moreCount}
                            <div class="person-popover">
                                ${persons.map(p => `<div class="popover-item">${p.name}</div>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${persons.length === 0 ? '<span class="text-muted small">Atanmamış</span>' : ''}
                </div>
            </td>
            <td class="text-end">
                <div class="d-flex justify-content-end gap-2">
                    <button onclick="window.openLocationModal('${loc.id}')" class="p-btn-icon play" title="Düzenle">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="window.deleteLocation('${loc.id}')" class="p-btn-icon delete" title="Sil">
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

// [DECOMMISSIONED] Launchpad modülü askıya alındı. Bu fonksiyon artık no-op.
window.updateAdminLaunchpadButtonsVisibility = function () {
    // No-op
};

// Trigger it immediately on script execution
if (typeof window.updateAdminLaunchpadButtonsVisibility === 'function') {
    window.updateAdminLaunchpadButtonsVisibility();
}
