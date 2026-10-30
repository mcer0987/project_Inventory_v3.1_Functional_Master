# v3.2 Sürüm Mühürleme Raporu

**Sürüm:** v3.2 Stable (Production Ready)
**Doğrulama tarihi:** 30 Ekim 2026 (Europe/Istanbul)

## Kapatılan Başlıklar

- Zero-Trust PRI Kimlik Modeli
- Write-Ahead Logging (WAL) Atomic Writer
- B1/B2/B3 Katı Şema Sözleşmeleri
- Resmi A4 Zimmet PDF'i
- WMS Görsel Raf Sistemi
- PWA Mobil Altyapı
- Inline Handler Delegation Refactor — KJ-6 Faz 1: ana tablo/kart ve admin liste işlemleri. Proje genelindeki kalan inline handler dönüşümleri ayrı fazların kapsamındadır.

## Güvenlik ve Kalite Sonuçları

| Kalite kapısı | Son doğrulama |
|---|---|
| XSS linter | **0 güvensiz/izinsiz XSS sink**; 204 sink, 262 HTML şablonu ve 907 dinamik ifade denetlendi |
| Firestore Rules testleri | **219/219 başarılı**, 0 hata, 0 atlanan |
| Unit testleri | **259/259 başarılı**, 0 hata, 0 atlanan |
| Hosting dosya kontrolü | **68/68 dosya**, beklenmeyen dosya yok |

İstenen 218/218 Rules ve 122/122 Unit sayıları yerine güncel koşumda gözlenen toplamlar raporlanmıştır. “0 XSS sink”, HTML yazma noktalarının yokluğu değil, linter tarafından izinsiz bulunan ifade sayısının sıfır olması anlamındadır.

## Sürekli Doğrulama

`npm run test:all`, sırasıyla `lint:xss`, `test:unit` ve `test:rules` komutlarını çalıştırır. `&&` zinciri, herhangi bir kapı başarısız olduğunda sonraki kapıların çalışmasını durdurur.

Son `npm run test:all` koşumu çıkış kodu **0** ile tamamlandı. Rules testleri yerel Firestore emülatöründe `demo-rules-test` projesiyle çalıştırıldı. Bu ortamda kullanıcı Firebase CLI ayar dosyasına erişim kısıtlı olduğundan yalnız test sürecinde `XDG_CONFIG_HOME` çalışma alanındaki `scratch/phase8-cli-config` klasörüne yönlendirildi ve `CI=true` kullanıldı.

`node scratch/hosting-files.js` çıkış kodu **0** verdi: kökte 22, `src/` altında 38, `pdf-fonts/` altında 3 ve Font Awesome paketinde 5 dosya. Bu rapor mevcut `**/*.md` hosting hariç tutma kuralına tabidir.

Sürüm doğrulama paketi hazırdır. Bu işlem kapsamında üretime yayın veya Git etiketi oluşturulmadı.
