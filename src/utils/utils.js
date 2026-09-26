/**
 * utils.js — Medipol Envanter Takip Sistemi
 * ==========================================
 * v3.1 ESM Modüler Mimari — Phase 1: Yardımcı Fonksiyonlar
 *
 * [WHY]: getTurkiyeSaati, getTurkiyeTarihi ve tsToTurkiye fonksiyonları
 *        script.js içinde (L23-L36) tanımlanmış ve 5+ farklı dosyada
 *        tekrar tekrar çağrılmaktadır. Bu fonksiyonlar hiçbir DOM
 *        manipülasyonu veya Firebase bağımlılığı içermez; saf hesaplama
 *        mantığına sahiptir. ESM ilkelerine göre "Utility Layer" ayrı
 *        bir modüle konulmalıdır.
 * [HOW]: Her fonksiyon hem `export const` ile ESM modüllerine açılır,
 *        hem de `window.xyz` ataması ile legacy (non-module) dosyaların
 *        (script.js, todo-module.js vb.) mevcut çağrı biçimlerinin
 *        çalışmaya devam etmesi garanti altına alınır.
 *        Bu yaklaşım COMPATIBILITY_BRIDGE kuralını karşılar.
 */

// [WHY]: IANA timezone sabiti modül düzeyinde bir kez tanımlanıyor.
// [HOW]: Herhangi bir fonksiyondan önce yüklenerek her çağrıda
//        yeniden tanımlanma maliyeti ortadan kalkar.
const TZ = 'Europe/Istanbul';

// ─────────────────────────────────────────────────────────────────────────────
// getTurkiyeSaati
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function getTurkiyeSaati
 * @returns {string} "12.05.2026 14:35:22" formatında Türkiye tarih+saati
 *
 * [WHY]: Farklı kullanıcı tarayıcıları veya sunucu ortamları farklı
 *        timezone'larda çalışabilir. Bu da kayıt tarihlerinin tutarsız
 *        görünmesine neden olur. Sistemin tüm zaman damgaları Europe/Istanbul
 *        bölgesine kilitlenmelidir.
 * [HOW]: toLocaleString'e timeZone seçeneği verilerek tarayıcının yerel
 *        ayarından bağımsız, her zaman Türkiye saatini döndürür.
 */
export const getTurkiyeSaati = function () {
    return new Date().toLocaleString('tr-TR', { timeZone: TZ });
};

// [COMPATIBILITY_BRIDGE]: script.js ve diğer legacy dosyaları
// window.getTurkiyeSaati() biçiminde çağırır. Bu atama silinmemelidir.
window.getTurkiyeSaati = getTurkiyeSaati;

// ─────────────────────────────────────────────────────────────────────────────
// getTurkiyeTarihi
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function getTurkiyeTarihi
 * @returns {string} "12.05.2026" formatında yalnızca tarih (saat bilgisi yok)
 *
 * [WHY]: Bazı form alanları ve raporlarda saat bilgisi gereksizdir,
 *        sadece tarih kısmı okunabilir formatta sunulmalıdır.
 * [HOW]: toLocaleDateString yalnızca tarih bileşenini döndürür.
 *        Saat bilgisi eklenmez; formatı kullanıcı dostu şekilde sunar.
 */
export const getTurkiyeTarihi = function () {
    return new Date().toLocaleDateString('tr-TR', { timeZone: TZ });
};

// [COMPATIBILITY_BRIDGE]: Legacy kullanımları için window bağlaması korunur.
window.getTurkiyeTarihi = getTurkiyeTarihi;

// ─────────────────────────────────────────────────────────────────────────────
// tsToTurkiye
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function tsToTurkiye
 * @param {number|string|null} timestamp - Firebase'den gelen Unix timestamp (ms)
 * @returns {string} Türkiye saat diliminde okunabilir tarih-saat stringi
 *
 * [WHY]: Firebase Firestore'dan gelen lastUpdate alanları Unix milisaniye
 *        timestamp'i olarak kaydedilir. Doğrudan gösterimde kullanıcı için
 *        anlamsız sayılar üretir. Tooltip ve tablo hücrelerinde okunabilir
 *        formata çevrilmesi gerekir.
 * [HOW]: null/undefined durumunda "Tarih bilgisi yok" fallback değeri
 *        döndürülür. Geçerli timestamp için new Date() ile milisaniyeden
 *        Date objesine çeviri yapılır, ardından Europe/Istanbul zone'unda
 *        formatlanır.
 */
export const tsToTurkiye = function (timestamp) {
    if (!timestamp) return 'Tarih bilgisi yok';
    return new Date(timestamp).toLocaleString('tr-TR', { timeZone: TZ });
};

// [COMPATIBILITY_BRIDGE]: renderTable, renderSearchResults ve tooltip
// sistemleri tsToTurkiye'yi doğrudan çağırmaktadır. window ataması
// bu çağrıların hata vermemesini garantiler.
window.tsToTurkiye = tsToTurkiye;

// ─────────────────────────────────────────────────────────────────────────────
// formatCurrency (Yardımcı — İleride kullanılmak üzere)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @function formatCurrency
 * @param {number} amount - Formatlanacak sayısal değer
 * @param {string} [currency='TRY'] - ISO 4217 para birimi kodu
 * @returns {string} "₺1.234,56" gibi biçimlendirilmiş para birimi stringi
 *
 * [WHY]: Satın alma modülü (purchase-servises.js) ve raporlarda fiyat
 *        gösterimi için merkezi bir format fonksiyonu gereklidir. Her
 *        modülün kendi format mantığını yazması tutarsızlığa yol açar.
 * [HOW]: Intl.NumberFormat standart Web API'si kullanılarak para birimi
 *        formatlaması yerelleştirilmiş biçimde yapılır. Bu sayede
 *        farklı para birimleri de kolayca desteklenebilir.
 */
export const formatCurrency = function (amount, currency = 'TRY') {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2
    }).format(amount);
};

window.formatCurrency = formatCurrency;

// ─────────────────────────────────────────────────────────────────────────────
// Module init log (Geliştirici doğrulama için)
// ─────────────────────────────────────────────────────────────────────────────
console.log('✅ [utils.js] Yardımcı fonksiyonlar yüklendi (getTurkiyeSaati, getTurkiyeTarihi, tsToTurkiye, formatCurrency).');
