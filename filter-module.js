// ============================================================================
// B1 DEPO DURUM FİLTRESİ MODÜLÜ (filter-module.js)
// [WHY]: script.js dosyasını şişirmeden, B1 deposundaki pasif ürünleri süzmek,
//        arama sonuçlarından dışlamak ve istendiğinde sadece pasifleri listelemek.
// [HOW]: Orijinal window.data.b1 dizisini ASLA bozmaz (Zararsız State Yönetimi).
//        script.js içindeki veri işleyicileri tarafından çağrılan window.getFilteredB1Data()
//        ile çalışır ve dropdown (b1StatusFilter) değiştiğinde listeyi tazeler.
// ============================================================================

(function () {
    // [WHY]: Sayfa yüklendiğinde ya da dinamik arayüz elemanları oluştuğunda filtre dinleyicisini bağlamak.
    // [HOW]: DOMContentLoaded veya hemen çalıştırılarak #b1StatusFilter elemanı dinlenir, değişimde renderTable/renderMobileCards tetiklenir.
    function initFilterListener() {
        const statusFilter = document.getElementById("b1StatusFilter");
        if (statusFilter && !statusFilter.dataset.listenerAttached) {
            statusFilter.dataset.listenerAttached = "true";
            statusFilter.addEventListener("change", () => {
                const activeTab = document.querySelector(".tab-content.active");
                const depo = activeTab ? activeTab.id : "b1";

                if (window._cardViewActive && window._cardViewActive[depo]) {
                    if (typeof window.renderMobileCards === "function") {
                        window.renderMobileCards(depo);
                    }
                } else {
                    if (typeof window.renderTable === "function") {
                        window.renderTable(depo, false);
                    }
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initFilterListener);
    } else {
        initFilterListener();
    }

    // [WHY] (Faz 5 · K2 · INV-07 + v3.8 UX-Fix): Tam eşleşme ("durum === 'pasif'") ve yalnız "pasif" araması,
    //       stok 0'a düştüğünde computeStockPatch'in yazdığı "Tükendi" kayıtlarını yakalamıyordu; B1'de
    //       "Sadece Pasifler" filtresi boş kalıyor, B2'de 0 adetli cihazlar aktif listede bekliyordu.
    // [HOW]: Durum metninde "pasif", "tükendi"/"tukendi", "stok dışı"/"stok disi" geçiyorsa VEYA nesnenin adedi ≤ 0 ise
    //        pasif / tükenmiş kabul edilir. B1 üç modlu filtreyi (`active`/`passive`/`all`), B2 aktif stok filtresini uygular.
    window.isPassiveStatus = function (status, item) {
        const norm = String(status || "").trim().toLocaleLowerCase("tr-TR");
        if (norm.includes("pasif") || norm.includes("tükendi") || norm.includes("tukendi")
            || norm.includes("stok dışı") || norm.includes("stok disi")) {
            return true;
        }
        if (item && typeof item === "object") {
            const rawQty = item.adet !== undefined ? item.adet : (item.qty !== undefined ? item.qty : item.quantity);
            if (rawQty !== undefined && rawQty !== null && rawQty !== "") {
                const n = Number(rawQty);
                if (Number.isFinite(n) && n <= 0) return true;
            }
        }
        return false;
    };

    // [WHY]: window.data.b1/b2 verilerini değiştirmeden (mutation yapmadan) görünüm ve aramada aktif/pasif süzme sağlar.
    // [HOW]: getProcessedData tarafından çağrılır. B1'de #b1StatusFilter ('active'|'passive'|'all') uygulanır;
    //        B2'de stok adedi 0 ('Tükendi') veya 'Pasif' cihazlar ana aktif listeden çıkarılır. __index korunur.
    window.getFilteredB1Data = function (depo, dataArray) {
        if (!dataArray || !Array.isArray(dataArray)) {
            return [];
        }
        if (depo === "b2") {
            return dataArray.filter(item => !window.isPassiveStatus(item.durumu || item.status, item));
        }
        if (depo !== "b1") {
            return dataArray;
        }

        const filterEl = document.getElementById("b1StatusFilter");
        const filterVal = filterEl ? filterEl.value : "active"; // Varsayılan: Sadece Aktifler

        if (filterVal === "all") {
            return dataArray;
        }

        return dataArray.filter(item => {
            const passive = window.isPassiveStatus(item.durumu || item.status, item);
            if (filterVal === "active") {
                return !passive;
            } else if (filterVal === "passive") {
                return passive;
            }
            return true;
        });
    };
})();
