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

    // [WHY]: Faz 4 · J1 (M3) — Rules v2 personel yazmalarında etiket benzeri "<harf", "</", "<!", "<?" içeren metni reddeder
    //        (firestore.rules noTag). Kural reddi kullanıcıya yalnız "kaydedilemedi" olarak döner; hangi alanın sorunlu olduğu görünmez.
    // [HOW]: Aynı desen istemcide; formlar kayıttan ÖNCE alan adıyla uyarır. "<5mm", "a < b" serbest (kuralla birebir).
    const TAG_LIKE = /<[a-zA-Z\/!?]/;

    function hasTagLike(value) {
        return typeof value === 'string' && TAG_LIKE.test(value);
    }

    // fields: { 'Alan etiketi': değer, … } → ilk sorunlu alanın etiketi ya da null
    function findTagLike(fields) {
        for (const [label, value] of Object.entries(fields || {})) if (hasTagLike(value)) return label;
        return null;
    }

    // Sorun varsa kullanıcıyı uyarır ve true döner (çağıran kaydı durdurur).
    function guardTagLike(fields) {
        const label = findTagLike(fields);
        if (!label) return false;
        const msg = `"${label}" alanında "<" ile başlayan etiket benzeri ifade kullanılamaz (ör. "<b>", "</"). "< 5" gibi kullanımlar serbesttir.`;
        if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, 'warning');
        return true;
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.Html = { escapeHtml, safeUrl, jsArg, hasTagLike, findTagLike, guardTagLike };
    window.escapeHtml = escapeHtml;
    window.safeUrl = safeUrl;
    window.jsArg = jsArg;
    window.hasTagLike = hasTagLike;
    window.guardTagLike = guardTagLike;
})();
