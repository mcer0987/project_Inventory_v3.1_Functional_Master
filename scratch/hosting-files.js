// [WHY]: Faz 4 · J6 (deploy runbook) — `firebase deploy --only hosting` git'teki dosyaları değil DİSKTEKİ klasörü yükler;
//        firebase.json "ignore" listesine uymayan her dosya (yerel log, yedek, not) herkese açık yayınlanır (Faz 0'daki
//        backup/functions sızıntısı böyle olmuştu).
// [HOW]: firebase-tools'un kullandığı eşleştiriciyle (minimatch, dot:true) yayınlanacak dosyaları listeler; beklenen uygulama
//        dosyaları dışında bir şey varsa çıkış kodu 1. Deploy'dan hemen önce çalıştırılır (runbook Adım 0).
// Usage: node scratch/hosting-files.js
const fs = require('fs');
const path = require('path');
const mm = require('minimatch');
const match = mm.minimatch || mm;

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const ignore = cfg.hosting.ignore || [];
const isIgnored = (rel, dir) => ignore.some(g => match(rel, g, { dot: true }) || (dir && match(rel + '/x', g, { dot: true })));

const files = [];
(function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (isIgnored(r, e.isDirectory())) continue;
        if (e.isDirectory()) walk(path.join(abs, e.name), r); else files.push(r);
    }
})(ROOT, '');

// Beklenen: iki sayfa + 404, kök CSS/JS, kök manifest.json (PWA — index/admin.html'de <link rel="manifest">), src/
// altındaki JS/CSS (WMS'in shelf-matrix.css'i — admin.html'de <link> ile), pdf-fonts/ (Faz 5 · K1: tembel yüklenen
// Roboto + OFL lisansı). (Docker beyaz listesiyle aynı küme.)
// Yerel Font Awesome paketi iki sayfada da kullanılır; yalnız bu beş dosya yayınlanabilir.
const iconAssets = new Set([
    'assets/fontawesome/css/all.min.css',
    'assets/fontawesome/webfonts/fa-brands-400.woff2',
    'assets/fontawesome/webfonts/fa-regular-400.woff2',
    'assets/fontawesome/webfonts/fa-solid-900.woff2',
    'assets/fontawesome/webfonts/fa-v4compatibility.woff2',
]);
const expected = f => /^(index|admin|404|verify)\.html$/.test(f) || /^[^/]+\.(css|js)$/.test(f) || /^manifest\.json$/.test(f)
    || /^src\/.+\.(js|css)$/.test(f) || /^pdf-fonts\/(Roboto-[A-Za-z]+\.js|OFL\.txt)$/.test(f) || iconAssets.has(f)
    || ['release-journal/index.html', 'release-journal/journal.js', 'release-journal/style.css'].includes(f);
// [WHY]: Faz 5 kapanışı — desen tek başına "fazladan meşru görünen" bir dosyayı (ör. kökte unutulan bir .js dökümü) yakalamaz.
// [HOW]: Toplam sayı da sabitlenir; uygulamaya dosya eklenip çıkarıldığında bu sayı bilinçli olarak güncellenir.
//        52 = Faz 5 öncesi 47 + P0-P1 (atomic-writer.js, stock-import.js) 2 + pdf-fonts 3.
//        53 = + Faz 4B · J7 src/services/staff-provisioning.js.
//        54 = + Faz 4B · J7.5 src/utils/staff-code-registry.js.
//        55 = + Faz 4B · J9 src/utils/ownership.js (code-hash.js GPT-6 kararıyla iptal edildi).
//        53 = - Faz 7 ölü kod temizliği: db.js ve src/services/data-loader.js silindi.
//        63 = + v3.3 Aşama 0-5 (Denetim sonrası) 10 yeni dosya: kökte manifest.json (PWA), login-redesign.css,
//             mobile-responsive.css; src/ altında shelf-matrix.js + .css, stock-ledger.js, mobile-nav-enhancements.js,
//             admin-quick-unlock.js, dialog-stack.js, shelf-capacity.js. (Global-Architecture.md ve "Mimari ve
//             Geliştirmeler/" zaten firebase.json "ignore"da, bu sayıma girmez.)
//        68 = + yerel Font Awesome CSS ve webfont paketi (5 dosya).
// EBYS Aşama 2: üç yeni uygulama dosyası; Aşama 3: para hesabı, kalem editörü ve yazdırma CSS'i;
// UAT düzeltmesi: belge türü kataloğu ve Tanımlar görünümü.
// Operasyon Merkezi: ortak EBYS kur ayarı servisi.
// Aşama 4: evrak şeması, servis, arayüz ve stil (4 dosya).
// Manuel çıkış modülü/şeması (2) ve admin panelinden bağlı Gelişim Günlüğü (3).
// Aşama 5: süreç şeması/servisi/arayüzü ve legacy özel sorgu adaptörü (4).
// EBYS Rehberi: tanıtım modalı ve stili (2).
// EBYS Aşama 6: icra ve bildirim servisi ile arayüzü (2).
// EBYS Aşama 7: açık doğrulama sayfası, iki servis/arayüz modülü ve iki yardımcı (5).
// Personel (BT ekibi) çıkışı: çıkış politikası, alan kişi seçici, depo salt-okunur / sağ tık koruması (3).
// feat/envanter-talep-iade · Faz 3: admin bekleyen talep rozeti (1). Faz 4: iade talebi şeması (1). Faz 5: iade arayüzü (1).
// Faz 6: iade tutanağı PDF (pdf-generator.js'e eklendi, yeni dosya yok) ve Zimmet ve İade Rehberi modalı + stili (2).
// v3.6 · İP-2: Envanter No değişimi saf modülü ve Operasyon Merkezi kartı (2).
const EXPECTED_COUNT = 110;
const unexpected = files.filter(f => !expected(f));
console.log(`Yayınlanacak dosya: ${files.length} (kök: ${files.filter(f => !f.includes('/')).length}, src/: ${files.filter(f => f.startsWith('src/')).length}, pdf-fonts/: ${files.filter(f => f.startsWith('pdf-fonts/')).length}) · beklenen: ${EXPECTED_COUNT}`);
if (unexpected.length) {
    console.log('✖ Beklenmeyen dosyalar (firebase.json "ignore"a ekleyin ya da silin):\n  ' + unexpected.join('\n  '));
    process.exit(1);
}
if (files.length !== EXPECTED_COUNT) {
    console.log(`✖ Dosya sayısı ${files.length}, beklenen ${EXPECTED_COUNT}. Bilinçli bir ekleme/çıkarma ise EXPECTED_COUNT'u güncelleyin.`);
    process.exit(1);
}
console.log('✔ Yalnız uygulama dosyaları yayınlanacak.');
