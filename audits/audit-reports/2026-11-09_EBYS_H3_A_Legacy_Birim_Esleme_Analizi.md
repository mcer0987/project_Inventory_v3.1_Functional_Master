# H3-A — Salt okunur legacy birim eşleme analizi

10 Kasım 2026. **Yalnız yerel demo fixture incelendi.** Gerçek kurum veya kullanıcının emülatöründeki veriler okunmadı/değiştirilmedi. Araç Firebase kullanmaz; JSON girdi → rapor çıktısı üretir.

Kaynak: `tests/prototypes/ebys-h3/legacy-units.mjs`; kanıt: `scratch/ebys-h3a-evidence/legacy-unit-analysis.json`. Çalıştırma: `node tests/prototypes/ebys-h3/legacy-units.mjs`. İsteğe bağlı yerel JSON yolu verilebilir; veritabanı bağlantısı veya yazma modu yoktur.

| Örnek | Girdi durumu | Sonuç | Yapılacak |
|---|---|---|---|
| 1 | `unitId=bt`, eski görünen ad; kaydın ID alanı sayısal | already_identified | Birim yolu esas; eski görünen adı değiştirme |
| 2 | Kimlik yok, büyük harf/boşluklu tek ad | unique_candidate | Yalnız aday öner; eski belgeyi otomatik yazma |
| 3 | İki fakültede aynı “Fakülte Sekreterliği” adı | ambiguous | Kod/üst birimle açık kullanıcı seçimi |
| 4 | Kimliksiz adın tek adayı pasif | inactive_candidate | Yeni talebe seçme; yönetici incelemesi |
| 5 | Ad yalnız başka kökte var | unmatched | Başka kökten ID ödünç alma |
| 6 | Açık ID silinmiş, ad başka aktif birimle eşleşiyor | missing_id | Ad üzerinden sessiz bağ değiştirme |
| 7 | Sayısal `unitId=42`, gerçek belge yolu `42` | already_identified | Yolu string olarak kullan; yeni kimlik üretme |
| 8 | Talebin kendisi başka kökte | different_root | Analiz kapsamı dışında |
| 9 | Mevcut açık ID pasif birime ait | inactive_id | Tarihsel bağ korunur; yeni seçim yapılmaz |

Dokuz örneğin hiçbirinde otomatik yazma yoktur. Birim nesnesindeki eski `id` alanı belge yolundan farklıysa rapor `pathId` kullanır. Ad normalleştirmesi yalnız aday araması içindir: Unicode NFKC, kırpma/boşluk birleştirme ve Türkçe küçük harf. Bu normalleştirme bir yetki veya tekillik kanıtı değildir.

Test `legacy eşleme: dokuz sınıf, belge yolu otoritesi, sıfır mutasyon`: çıktı sınıflarını, iki eşadlı adayı, sayısal ID'yi, yol otoritesini ve girdi nesnesinin değişmediğini doğrular. Tek test / dokuz fixture.

Yeni kayıtta ortak birim seçilir; eski kayıtta salt okunur görünüm bu raporu kullanabilir. Canlı tarama/backfill, tüm kurum kataloğunu sürüme kopyalama ve sadece adla otomatik eşleme H3-B kapsamı değildir.
