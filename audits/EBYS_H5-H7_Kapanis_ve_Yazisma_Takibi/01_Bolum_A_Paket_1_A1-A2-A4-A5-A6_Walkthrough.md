# Bölüm A · Paket 1 — A-1, A-2, A-4, A-5, A-6 kapanışı — Walkthrough

**Tarih:** 17 Kasım 2026 · **Dal:** `refactor/v3.7-script-soc-ayristirmasi` (HEAD `3f2b84f`) · **Durum:** Yerelde uygulandı, commit edilmedi.
**Kapsam:** H5 + H6a birleşik kabul kontrolünde bulunan A-1, A-2, A-4, A-5, A-6 pürüzleri ve `window.AppModules` ihraç eksikleri. **A-3 (personel evrak çalışma alanı) bu pakette yok.**

## İçindekiler

1. Talepler ve karşılıkları
2. Davranış
3. Güvenlik modeli
4. Değişen dosyalar
5. Testler
6. Yayın
7. Sınırlar
8. Yerel test adımları

## 1. Talepler ve karşılıkları

| Talep | Karşılık |
|---|---|
| Namespace ihraçları (Anayasa §2) | `EBYSProcesses` → `getPurchaseApprovalPreview`; `EBYSDocuments` → `createPurchaseDocument`, `savePurchaseDraft`, `freezePurchaseVersion`, `getPurchaseView`. |
| **A-1** Dövizli talepte ilk onay; kalemlerin görünmemesi | Onay penceresinde satın alma kalemleri, para birimi toplamları ve ödenek. İlk adımda kur önizlemesi (kur, tarih, kaynak, TL karşılığı). "Onayla" `fxPreview` gönderir. Önizleme hatasında yalnız "Onayla" kapanır. Kur değiştiyse önizleme tazelenir. "Görevdeki / Karar verdiğim sürümü aç" penceresinde de kalem tablosu. |
| **A-2** Bağlı satın alma evrakında yeni sürüm | `EBYSPurchaseUI.openForRevision(documentId)`. Süreç penceresindeki "Yeni sürüm hazırla" bağlı evrakta bu kipe gider. Gönderimde `savePurchaseDraft` (+`reopen`) → `freezePurchaseVersion` → onay rotası. |
| **A-4** Satın alma listesinde EBYS satırları | "EBYS Süreci" rozeti; evrak no / tarih / ürün yedek değerleri; eski motor düğmeleri gizli; tek düğme "EBYS Süreci / Görüntüle" (`window.openEbysPurchaseRow`). Üç tablo çizicisinin üçünde de uygulandı. |
| **A-5** Tekrar denemede yeni talep | Bekleyen gönderim içerik + bağlı taslak başıyla eşlenir; aynı içerikte aynı işlem kimlikleri kullanılır; kayıt tamamsa doğrudan dondurmaya geçilir. |
| **A-6** Sabit `'MED'` | Kurum kodu künyeden (`EBYSCatalog.loadCatalog().profile.code`), yoksa `'MED'`. |

## 2. Davranış

**Onay penceresi (A-1).** Aktif onaycı satın almaya bağlı bir süreç açtığında karar kutusunun üstünde "Satın alma kalemleri" tablosu görünür. İlk adımda ayrıca "Kur ve TL karşılığı" bölümü vardır: yalnız kullanılan dövizlerin kuru, kur tarihi ve kaynağı, TL karşılığı ve "Onayladığınızda bu kur talebe sabitlenir" notu. Tüm kalemler TRY ise "kur gerekmez" yazılır. Kurlar eksik/geçersizse hata mesajı görünür ve yalnız "Onayla" kapanır; "Reddet" ve "Yazara iade et" açık kalır. Onay anında kur değiştiyse (`purchase-rates-changed`) önizleme güncel kurla yeniden çizilir ve kullanıcı güncel tutarla yeniden karar verir.

**Yeni sürüm (A-2).** Yazar, iade/red/geri çekme sonrası süreç penceresinde "Yeni sürüm hazırla"ya bastığında satın alma formu "EBYS Satın Alma — Yeni Sürüm / Taslak Düzenle" başlığıyla açılır: birim, konu, ödenek ve kalemler son sürümden gelir; "Talebi Kaydet" gizlenir; durum satırı talebin EBYS motorunda olduğunu ve gönderimde onay rotasının yeniden seçileceğini söyler. Önceki birim artık seçilemiyorsa kullanıcıdan yeni birim seçmesi istenir. Dondurulmamış bir taslak (ör. A-5 öncesinden kalan yetim taslak) da aynı kipte açılır ve tamamlanabilir. Evrak hâlâ onaydaysa form yerine süreç penceresi açılır.

**Liste (A-4).** EBYS satırı "EBYS · ilk 8 karakter", son güncelleme tarihi ve "EBYS Satın Alma Evrakı" ile görünür; durum "EBYS Süreci". Tek düğme tıklandığında evrak başlığı sunucudan bir kez okunur: sürüm varsa süreç penceresi, yazarın dondurulmamış taslağıysa düzenleme kipi açılır; başkasının dondurulmamış taslağında bilgi mesajı çıkar.

**Tekrar deneme (A-5).** Evrak oluşup dondurma düşerse aynı içerikle yeniden basıldığında yeni talep açılmaz; kayıtlı taslak aynı dondurma işlem kimliğiyle dondurulur. İçerik değiştirilirse aynı taslak güncellenir (yeni talep açılmaz). Modal kapanınca veya yeni talep açılınca durum sıfırlanır; geride kalan taslak listedeki EBYS düğmesinden tamamlanabilir.

## 3. Güvenlik modeli

- Rules'a dokunulmadı. Kur sabitleme, finans kaydı, yeniden açma ve işaretçi yazımı mevcut kurallarla denetlenmeye devam eder (`poVersionFinanceCreate`, `ebysHeadUpdate` yeniden açma dalı, `poMarkerWrite`).
- Satın alma yeniden açma yolu mevcut kural testlerinde kapsanıyor: `tests/rules/ebys-purchase.test.mjs:167`, `tests/rules/ebys-purchase-recovery.test.mjs:129`.
- Tekrar denemede aynı işlem kimliği ve aynı içerik, servisin `replay` kontrolünden geçer; farklı içerik aynı kimlikle reddedilir.
- Yeni çizimler `textContent` / `escapeHtml` / `jsArg` ile yapılır; `lint:xss` izinsiz 0.
- Liste satırı için `window.data` değiştirilmez; gösterim kopyası kullanılır (Anayasa §5).

## 4. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/services/ebys-process-service.js` | `EBYSProcesses` ihracına `getPurchaseApprovalPreview`. |
| `src/services/ebys-document-service.js` | `EBYSDocuments` ihracına dört satın alma fonksiyonu. |
| `src/ui/ebys-process-ui.js` | `purchaseLines`, `purchaseQuote` yardımcıları; karar kutusunda kalem + kur önizlemesi ve `fxPreview`; sürüm önizlemesinde kalem tablosu; bağlı evrakta "Yeni sürüm hazırla" → `openForRevision`. |
| `src/ui/ebys-purchase-ui.js` | `draftTarget` / `pendingSubmission`, `clearPending`, `organizationCodeForNew`, `openForRevision`; `submitPurchaseViaEbys` oluşturma/güncelleme/yeniden açma + idempotent dondurma; başarıda `closePurchaseModal`. |
| `src/services/purchase-servises.js` | `_isEbysPurchase`, `_ebysPurchaseDisplay`, `_ebysPurchaseActionsHtml`, `window.openEbysPurchaseRow`, `AppModules.EBYSPurchaseRows`; `getStatusBadge` EBYS rozeti; `renderPurchaseModule` ve `renderServicesModule` satırları; `openNewPurchaseModal`/`closePurchaseModal` içinde `clearPending`. |
| `src/modules/admin/admin-purchase-render.js` | **Görevde listelenen beş dosyaya ek.** Admin tablosu (`renderAdminDashboard`) aynı `purchaseTableBody`'yi çizdiği için A-4 burada da uygulandı (`EBYSPurchaseRows` üzerinden). |

## 5. Testler

| Komut | Sonuç |
|---|---|
| `npm run lint:xss` | 101 dosya · 1027 dinamik ifade · güvenli 1008 · izinli 19 · **izinsiz 0** |
| `npm run test:unit` | **395/395** geçti |
| Sözdizimi (`node --check`, 6 dosya) | Hepsi geçti |

`npm run test:rules` ve tarayıcı/emülatör testi bu pakette çalıştırılmadı (Rules değişmedi; çalışan emülatördeki kullanıcı verisine dokunulmadı).

## 6. Yayın

Yalnız istemci dosyaları değişti; Rules/indeks yayını gerekmez. Yeni dosya yok; `hosting-files.js` sayısı değişmez.

## 7. Sınırlar

- **A-3 açık:** `index.html`'de personelin kendi evrak defteri yok.
- İlk adımdan sonraki onaycılar kalemleri görür; sabitlenmiş kurla TL karşılığı (finans kaydı) bu pencerede henüz gösterilmez.
- Aynı adlı iki birimden ikincisi satın alma seçicisinde ID taşımadığı için yeni sürüm kipinde otomatik seçilemez; kullanıcıdan birim seçmesi istenir (mevcut `_fillNamedSelect` davranışı).
- Kur önizlemesi okunduktan sonra yönetici kuru değiştirirse onay reddedilir ve önizleme tazelenir; bu bilinçli davranıştır.

## 8. Yerel test adımları

1. Personel A: USD kalemli talep → "EBYS süreciyle gönder" → rota: B (Onay).
2. B: Bana Gelen Onaylar → Görev / Karar → kalem tablosu ve "Kur ve TL karşılığı" görünür → Onayla → başarılı; finans kaydı oluşur.
3. Kurları sil/boz → yeni talepte B'nin penceresinde hata mesajı, "Onayla" kapalı, "Yazara iade et" açık.
4. B iade eder → A: Geri dönen evraklarım → Gerekçe ve yeni sürüm → "Yeni sürüm hazırla" → form dolu açılır, "Talebi Kaydet" gizli → kalemi değiştir → gönder → v2 donar, rota penceresi açılır.
5. Dondurmayı ağ kesintisiyle düşür (DevTools offline) → aynı içerikle tekrar bas → listede tek EBYS satırı kalmalı.
6. Satın alma listesi (index ve admin): EBYS satırında "EBYS Süreci" rozeti ve tek düğme; eski düğmeler yok.
7. Kurum künyesinin kodunu değiştir → yeni EBYS talebinin evrak başlığındaki `organizationCode` yeni kod olur (kesin kayıt numarası alınırsa `EBYS-<kod>-…` ile başlar).
