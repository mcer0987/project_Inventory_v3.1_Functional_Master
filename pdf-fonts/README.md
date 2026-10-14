# pdf-fonts/

Roboto Regular/Bold (Google Fonts, SIL Open Font License 1.1 — bkz. `OFL.txt`), jsPDF'in resmi
font dönüştürücü deseniyle (`addFileToVFS` + `addFont`, `'addFonts'` olayına kayıt) tek dosyalık
base64 TTF modülleri olarak paketlenmiştir.

- **Neden:** jsPDF'in yerleşik Helvetica fontu Türkçe karakterleri (ş, ğ, ı, İ, ö, ü, ç) doğru basmaz.
- **Nasıl yüklenir:** `pdf-generator.js` bu dosyaları yalnız bir zimmet/çıkış tutanağı PDF'i üretilirken
  tembel (`<script>` enjeksiyonuyla) yükler — ilk sayfa açılışını şişirmez.
- **Kaynak:** `https://fonts.google.com/download/list?family=Roboto` (fonts.gstatic.com, statik
  Regular/Bold TTF, Latin Extended-A kapsar — Türkçe harfler dahil; `tests/unit/pdf-fonts.test.mjs`
  bunu otomatik doğrular).
