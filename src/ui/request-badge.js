// [WHY]: feat/envanter-talep-iade · Faz 3 — yeni envanter talebi geldiğinde yönetici "Talep ve Süreçler" tablosuna gitmeden
//        göremiyordu; karttaki sayaç (pendingRequestCount) yalnız o sekme açıkken görünüyordu.
// [HOW]: admin üst çubuğunda görev rozetiyle (admin-nav-todo-badge) aynı bileşen: bekleyen envanter talebi + (Faz 4'ten
//        itibaren) bekleyen iade talebi sayısı. Taslak ve işlenmiş talepler sayılmaz. Veri her güncellendiğinde
//        (onInventoryDataUpdated) yeniden sayılır; sayı ARTTIĞINDA kısa nabız animasyonu ve ekran okuyucuya duyuru.
//        Tıklama / Enter: Talep ve Süreçler sekmesi açılır, "Bekleyen Envanter Talepleri" kartına kaydırılır.
(function () {
    const DONE = ['APPROVED', 'ONAYLANDI', 'REJECTED', 'REDDEDİLDİ', 'COMPLETED', 'TESLİM ALINDI', 'TESLIM ALINDI', 'DRAFT', 'TASLAK'];

    // Saf sayım (birim testli): admin "Bekleyen Envanter Talepleri" tablosunun bekleyen kuralıyla aynı.
    function countPending(requests, returnRequests) {
        const req = (Array.isArray(requests) ? requests : [])
            .filter(r => r && !DONE.includes(String(r.durum || '').trim().toLocaleUpperCase('tr-TR'))).length;
        const ret = (Array.isArray(returnRequests) ? returnRequests : [])
            .filter(r => r && String(r.durum || '') === 'Beklemede').length;
        return { requests: req, returns: ret, total: req + ret };
    }

    let last = null;
    function update() {
        const box = document.getElementById('admin-nav-request-badge');
        const countEl = document.getElementById('admin-nav-request-count');
        if (!box || !countEl) return;
        const c = countPending(window.data && window.data.requests, window.data && window.data.returnRequests);
        const label = c.total === 0 ? 'Bekleyen envanter talebi yok'
            : [c.requests ? `${c.requests} envanter talebi` : '', c.returns ? `${c.returns} iade talebi` : ''].filter(Boolean).join(' · ') + ' bekliyor';
        countEl.textContent = c.total > 99 ? '99+' : String(c.total);
        countEl.classList.toggle('badge-hidden', c.total === 0);
        box.classList.toggle('is-passive', c.total === 0);
        box.classList.toggle('has-tasks', c.total > 0);
        box.title = label;
        box.setAttribute('aria-label', `Bekleyen envanter talepleri: ${c.total}. ${label}`);
        if (last !== null && c.total > last) {
            box.classList.remove('request-badge-pulse');
            void box.offsetWidth;   // animasyonu yeniden başlat
            box.classList.add('request-badge-pulse');
            const live = document.getElementById('adminRequestBadgeLive');
            if (live) live.textContent = `Yeni talep geldi. ${label}.`;
        }
        last = c.total;
    }

    function goToPending() {
        if (typeof window.showAdminTab === 'function') window.showAdminTab('purchaseTab');
        setTimeout(() => {
            const card = document.getElementById('pendingRequestsCard');
            if (!card) return;
            card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
            card.setAttribute('tabindex', '-1');
            card.focus({ preventScroll: true });
        }, 60);
    }

    window.addEventListener('onInventoryDataUpdated', e => {
        const col = e && e.detail && e.detail.collection;
        if (!col || col === 'requests' || col === 'returnRequests') update();
    });
    document.addEventListener('DOMContentLoaded', update);

    window.RequestBadge = Object.freeze({ update, goToPending, countPending });
})();
