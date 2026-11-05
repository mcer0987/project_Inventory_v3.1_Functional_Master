# EBYS Aşama 6 — P2 kapanış denetimi

**Tarih:** 5 Kasım 2026. **Dal:** `feat/v3.4-ebys-asama-6`. **Taban:** `8350f917b653bc98c245c4415b2f7d67acb68c67`.

## 1. Karar: KESİN GO

Önceki bağımsız denetimin iki P2 koşulu kapandı. Bu karar incelenen yerel Aşama 6 çalışma ağacının teknik kabulüdür; canlı deploy gerçekleştirildiği anlamına gelmez.

## 2. A6-01: KAPANDI

`src/services/ebys-execution-service.js` içindeki `matchesCompletion`, completed durumu, complete eylemi, atanan UID, gerçek aktör UID, beklenen revizyon + 1 ve sonuç/kanıt/stok payload eşitliğini birlikte doğruluyor. Transaction hatasında `getDocFromServer` ile sabit iş yolundan taze okuma yapılıyor; oturum UID ve ortam kökü değişmişse kurtarma başarısı üretilmiyor. Okuma hatası veya eşleşmezlikte asıl hata korunuyor.

Gerçek emülatör testinde iki eşzamanlı aynı kapanış çağrısı da `ok: true` döndü; sonuçlar bir yeni başarı ve bir `alreadyCompleted` başarısı oldu. İş revizyonu bir arttı, tek complete olayı ve tek bildirim oluştu. Commit sonrası yanıt hatası da taze okumayla kurtarıldı. Farklı sonuç, kanıt, stok referansı, revizyon ve aktör için sahte başarı reddedildi.

`firestore.rules` SHA-256 değeri önceki bağımsız denetim kanıtıyla birebir aynı: düzeltme için güvenlik kuralları gevşetilmedi.

## 3. A6-02: KAPANDI

`src/services/ebys-document-service.js` siciline beş koleksiyon eklendi. İşler owner/assignee, bildirimler recipient sorgularıyla sunucudan çekiliyor. Admin için dışa aktarılan işlerin politika ve stok bağı referansları tekil okunuyor; olaylar aynı iş kimlikleriyle sınırlanıyor. Personel çıktısında admin kapsamları boş dizi ve `excluded / admin-required` manifestosu taşıyor. Çıktı tüm kurumun sınırsız admin yedeği olarak değerlendirilmemelidir; manifestoda belirtilen kişisel/yetkili kapsam geçerlidir.

Kapalı evrakın başlık–iş–olay–stok bağı–bildirim zinciri admin testinde dışa aktarıldı; ilgisiz başka iş/bildirim dahil edilmedi. Personelin yalnız kendi iş ve bildirim kapsamını aldığı, admin koleksiyonlarının kapsam dışı gösterildiği doğrulandı. Genel okuma izni eklenmedi.

## 4. Regresyon, diff ve merge/commit onayı

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| `npm run test:unit` | 290 geçti, 0 hata | `scratch/asama6-p2-audit-unit.log` |
| `npm run test:rules` | 274 geçti, 0 hata | `scratch/asama6-p2-audit-rules.log` |
| Eşzamanlı kapanış / sahte başarı / yedek kapsamı | Üç ek kabul testi geçti | Aynı Rules logu, A6-01/A6-02 satırları |
| `npm run lint:xss` | İzinsiz ifade 0 | `scratch/asama6-p2-audit-xss.log` |

Önceki denetimin kaynak hashlerine göre yalnız `src/services/ebys-execution-service.js`, `src/services/ebys-document-service.js` ve `tests/rules/ebys-processes.test.mjs` değişmiş. Diğer denetlenmiş uygulama kaynakları, Rules ve indexler aynı. P2 düzeltme farkında kapsam dışı değişiklik görülmedi. HEAD'e göre daha geniş görünen diff, henüz commit edilmemiş önceki Aşama 6 uygulamasını da içerir.

**Merge/Commit Onayı: VERİLDİ — incelenen Aşama 6 kapsamı için.** Bu denetimde uygulama/test kaynakları değiştirilmedi, commit/merge/deploy yapılmadı.

Kaynak ve log SHA-256 kayıtları: `audits/test-baselines/2026-11-05_EBYS_Asama_6_P2_Kapanis_Kanit.json`.
