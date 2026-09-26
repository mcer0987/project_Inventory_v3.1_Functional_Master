/**
 * utils/html.js — HTML güvenliği (klasik script, iki sayfada <head>'de Session Store'dan hemen sonra)
 */
// [WHY]: Anonim yazılabilen koleksiyonlardaki (requests, tasks, purchaseOrders, assignments, serviceRecords) metinler
//        innerHTML'e ham basılıyordu; bir talebe yazılan <img onerror=…> admin panelinde admin oturumuyla çalışıyordu (SEC-01).
// [HOW]: escapeHtml her dinamik değeri metne çevirir; safeUrl yalnız https: (ve aynı kaynak göreli) linklere izin verir.
(function () {
    const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"'`]/g, ch => MAP[ch]);
    }

    function safeUrl(url) {
        try {
            const u = new URL(String(url || ''), window.location.href);
            return u.protocol === 'https:' || u.origin === window.location.origin ? u.href : '#';
        } catch (e) {
            return '#';
        }
    }

    // onclick="f(${...})" gibi satır içi handler argümanları: tarayıcı entity'leri JS çalışmadan önce çözdüğü için
    // yalnız HTML kaçışı yetmez; değer JSON literal'i olarak yazılıp ayrıca HTML'e kaçırılır.
    function jsArg(value) {
        return escapeHtml(JSON.stringify(value === undefined ? null : value));
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.Html = { escapeHtml, safeUrl, jsArg };
    window.escapeHtml = escapeHtml;
    window.safeUrl = safeUrl;
    window.jsArg = jsArg;
})();
