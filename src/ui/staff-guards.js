// [WHY]: v3.4 · BT ekibi (personel hesabı) çıkış ekranını kullanırken B1/B2 depoları onlar için yalnız görüntülenebilir olmalı.
//        Depo çubuğundaki (.uab-bar) düğmeler personelde tıklanınca ayrı ayrı "yetkiniz yok" hatası veriyor ya da hiçbir şey
//        söylemeden (Excel) çalışıyordu. Ayrıca depo ekranında sağ tık menüsü ve geliştirici araçları kısayolları açıktı.
// [HOW]: 1) Oturum yönetici değilse <body> 'staff-readonly' sınıfı alır (görsel olarak pasif düğmeler + "Yalnız görüntüleme"
//           rozeti). Asıl engel tıklama anında, yakalama (capture) aşamasında yapılır: yönetici değilse .uab-bar içindeki her
//           etkileşim durdurulur ve tek bir açıklayıcı uyarı gösterilir. Sunucu tarafı zaten kurallarla kapalıdır.
//        2) Bu sayfada (index.html) herkes için sağ tık menüsü ve geliştirici araçları / kaynak görüntüleme kısayolları
//           (F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U, Cmd+Option+I/J/C/U) engellenir. Not: tarayıcı menüsünden açılan
//           geliştirici araçlarını hiçbir web sayfası engelleyemez; verinin asıl koruması Firestore kurallarıdır.
(function () {
    const READONLY_MESSAGE = '🔒 Depolar personel için yalnız görüntülenebilir. Sarf malzeme çıkışı için "Envanter Takibi" sekmesindeki "Envanter Çıkışı Yap" düğmesini kullanın.';
    const isAdmin = () => typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const loggedIn = () => document.body && document.body.classList.contains('logged-in');

    function refresh() {
        if (!document.body) return;
        const readonly = loggedIn() && !isAdmin();
        document.body.classList.toggle('staff-readonly', readonly);
        document.querySelectorAll('.uab-bar .uab-btn, .uab-bar .uab-checkbox-wrap, .uab-bar input').forEach(el => {
            if (readonly) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
        });
    }

    let lastNotice = 0;
    function notify(message) {
        if (Date.now() - lastNotice < 1500) return;   // tek tık birden fazla olay üretir (label → input); tek uyarı yeter
        lastNotice = Date.now();
        if (typeof window.showAppAlert === 'function') window.showAppAlert(message, 'warning');
    }

    function guardDepotBar(e) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target || !target.closest('.uab-bar') || isAdmin()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        notify(READONLY_MESSAGE);
    }
    ['click', 'change', 'keydown'].forEach(type => document.addEventListener(type, e => {
        if (type === 'keydown' && !['Enter', ' '].includes(e.key)) return;
        guardDepotBar(e);
    }, true));

    // ─── Sağ tık ve geliştirici araçları kısayolları ──────────────────────────────────────────────────────
    function isInspectShortcut(e) {
        const key = String(e.key || '').toLowerCase();
        if (key === 'f12') return true;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return true;        // Windows/Linux, Firefox konsolu
        if (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(key)) return true;     // macOS
        if (mod && !e.shiftKey && !e.altKey && key === 'u') return true;                   // kaynağı görüntüle
        return false;
    }
    document.addEventListener('contextmenu', e => { e.preventDefault(); }, true);
    document.addEventListener('keydown', e => {
        if (!isInspectShortcut(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    ['onNavbarRendered', 'onAppLogout', 'onInventoryDataUpdated'].forEach(evt => window.addEventListener(evt, () => setTimeout(refresh, 0)));
    document.addEventListener('DOMContentLoaded', refresh);
    // 'logged-in' sınıfı giriş/çıkışta body'ye eklenir; aynı değerle toggle yeni değişiklik üretmez (döngü yok).
    if (document.body) new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    else document.addEventListener('DOMContentLoaded', () => new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] }));

    window.StaffGuards = Object.freeze({ refresh, isInspectShortcut, READONLY_MESSAGE });
})();
