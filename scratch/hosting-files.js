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

// Beklenen: iki sayfa + 404, kök CSS/JS, src/ altındaki JS, pdf-fonts/ (Faz 5 · K1: tembel yüklenen Roboto + OFL lisansı).
// (Docker beyaz listesiyle aynı küme.)
const expected = f => /^(index|admin|404)\.html$/.test(f) || /^[^/]+\.(css|js)$/.test(f) || /^src\/.+\.js$/.test(f)
    || /^pdf-fonts\/(Roboto-[A-Za-z]+\.js|OFL\.txt)$/.test(f);
// [WHY]: Faz 5 kapanışı — desen tek başına "fazladan meşru görünen" bir dosyayı (ör. kökte unutulan bir .js dökümü) yakalamaz.
// [HOW]: Toplam sayı da sabitlenir; uygulamaya dosya eklenip çıkarıldığında bu sayı bilinçli olarak güncellenir.
//        52 = Faz 5 öncesi 47 + P0-P1 (atomic-writer.js, stock-import.js) 2 + pdf-fonts 3.
//        53 = + Faz 4B · J7 src/services/staff-provisioning.js.
//        54 = + Faz 4B · J7.5 src/utils/staff-code-registry.js.
//        55 = + Faz 4B · J9 src/utils/ownership.js (code-hash.js GPT-6 kararıyla iptal edildi).
const EXPECTED_COUNT = 55;
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
