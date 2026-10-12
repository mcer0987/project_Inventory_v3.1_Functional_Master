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

    // [WHY] (Faz 5 · K2 · INV-07): Tam eşleşme ("durum === 'pasif'") "Tükendi / Pasif" gibi bileşik durum metinlerini
    //       yakalamıyordu (computeStockPatch bu metni STOCK_AUTO_EMPTY olarak yazar); o ürünler "Sadece Aktifler"
    //       filtresinde görünmeye devam ediyordu.
    // [HOW]: Alt dize eşleşmesi ("pasif" geçen her durum metni pasif sayılır). table-engine.js da aynı fonksiyonu
    //        (satır/kart stil işaretlemesi ve patchDOMForCollection'ın filtre-uyumlu gizleme kararı için) kullanır —
    //        tek kaynak, iki yerde ayrı ayrı tanım kalmasın.
    window.isPassiveStatus = function (status) {
        return String(status || "").trim().toLocaleLowerCase("tr-TR").includes("pasif");
    };

    // [WHY]: window.data.b1 verisini değiştirmeden (mutation yapmadan) sadece görünüm ve arama için pasifleri elemeyi sağlar.
    // [HOW]: getProcessedData tarafından çağrılır. Filtre Sadece Aktifler ise 'pasif' durumlu olanları eler. Ürünlerin __index koruması aynen kalır.
    window.getFilteredB1Data = function (depo, dataArray) {
        if (depo !== "b1" || !dataArray || !Array.isArray(dataArray)) {
            return dataArray || [];
        }

        const filterEl = document.getElementById("b1StatusFilter");
        const filterVal = filterEl ? filterEl.value : "active"; // Varsayılan: Sadece Aktifler

        if (filterVal === "all") {
            return dataArray;
        }

        return dataArray.filter(item => {
            const passive = window.isPassiveStatus(item.durumu || item.status);
            if (filterVal === "active") {
                // Sadece Aktifler: Durumu 'pasif' olmayan her şey
                return !passive;
            } else if (filterVal === "passive") {
                // Sadece Pasifler: Sadece durumu 'pasif' olanlar
                return passive;
            }
            return true;
        });
    };
})();
