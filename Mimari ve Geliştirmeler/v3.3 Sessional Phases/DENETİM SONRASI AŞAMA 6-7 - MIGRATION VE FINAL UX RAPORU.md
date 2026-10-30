# Denetim Sonrası Aşama 6-7 — Migration ve Final UX Raporu

**Tarih:** 28 Ekim 2026
**Dal:** `feat/phase-7-logging-and-ux` (yerel; commit ve deploy YOK)
**Kaynak:** [Proje v3.3 için Denetim Raporu](../v3.3%20Sessional%20Phases/Proje%20v3.3%20i%C3%A7in%20Denetim%20Raporu.md) — Aşama 6 ve Aşama 7
**Önceki:** [Aşama 4-5 — WMS Entegrasyonu ve UX](./DENET%C4%B0M%20SONRASI%20A%C5%9EAMA%204-5%20-%20WMS%20ENTEGRASYONU%20VE%20UX%20RAPORU.md)
**Mimari kısıt:** Firebase Spark planı — Cloud Functions YOK. Çözüm: Firestore Client SDK (`getDocsFromServer`, `writeBatch`) + `firestore.rules`.

Bu, Aşama 0'dan beri süren denetim-sonrası çalışmanın **son paketi**. Üç iş yapıldı: (1) Excel içe aktarımda yeni "Havuz"
operasyonel kuralı, (2) Aşama 6 veri geçişi — raf sayaçlarını gerçek stokla uzlaştıran tek seferlik bir araç, (3) Aşama 7
son regresyon. `firestore.rules` bu pakette DEĞİŞMEDİ — mevcut kural (Aşama 2) zaten yeterliydi.

## 1. Özet

| İş | Durum |
|---|---|
| Excel içe aktarma: katalogda olmayan raf → Havuz (reddetmez) | **Tamamlandı** |
| WMS: "Havuz" sekmesi (her iki depo, tek ekranda) | **Tamamlandı** |
| Aşama 6: "Sistem Raf Sayaçlarını Eşitle (Sync)" aracı | **Tamamlandı** |
| Aşama 7: son regresyon | **Tamamlandı — bkz. §5** |

## 2. Excel İçe Aktarımında "Havuz" Kuralı

**Önceki davranış:** `StockImport.buildStockRecords` dosyadaki raf metnini hiç denetlemeden (`raf: v.raf || ''`)
doğrudan kanonik kayda yazıyordu — raf kataloğuyla hiçbir ilişkisi yoktu.

**Yeni davranış (`src/utils/stock-import.js`):**
- `buildStockRecords`'a yeni, **isteğe bağlı** bir bağımlılık eklendi: `knownShelfCodes` (bu depoya ait raf kataloğunun
  kanonik kodlarının `Set`'i).
- **Verilmediyse** (`undefined`): eski davranış aynen sürer (ham metin yazılır) — geriye dönük uyumluluk, testler
  etkilenmez.
- **Verildiyse:** dosyadaki raf `Schema.normShelfCode` ile kanonikleştirilir.
  - Katalogda VARSA: kanonik kod yazılır (ham yazım farkları — büyük/küçük harf, boşluk — WMS'in kanonik koduna iner).
  - Katalogda YOKSA (ya da katalog boşsa): satır **reddedilmez**; `raf: ''` (rafsız/Havuz) yazılır, yalnız bir
    **uyarı** (`warnings`, hata değil) eklenir: `Satır N: raf "X" tanımlı değil (WMS kataloğunda yok); ürün Havuz'a
    (rafsız) alındı.` Dosyanın geri kalanı etkilenmez; mevcut "tek hatalı satır → hiçbir şey yazılmaz" kuralı yalnız
    GERÇEK hatalar (boş ürün adı, geçersiz adet, vb.) için geçerliliğini sürdürür.
- `script.js`'teki `importExcel`, `window.data.shelves`'ten bu depoya ait kanonik kodları (`new Set(...)`) kurup geçirir.
  Katalog o an boşsa (çoğu raf için şu anki gerçeklik) Set boş olur — **her** raf değeri Havuz'a düşer; bu, kullanıcının
  "Canlıda manuel raf ataması yapacağım" planıyla bilinçli olarak uyumludur.
- Uyarılar zaten içe aktarma ONAY diyaloğunda (`showCustomConfirm`) admin'e gösteriliyordu — ek bir UI değişikliği
  gerekmedi.

**Doğrulama:** 5 yeni birim testi (`tests/unit/stock-import.test.mjs`) + GERÇEK `importExcel` UI akışını süren mevcut
tarayıcı senaryosu (`p5AuditAtomicImport`) bir katalog kaydı (R-9) ve bir kataloglanmamış raf (R-4) ile güncellendi:
R-4 Havuz'a düşer ve onay metninde "Havuz" + `"R-4"` geçtiği doğrulanır; R-9 korunur.

## 3. WMS: "Havuz" Sekmesi

**İstek:** "shelf-matrix-depots içinde havuz seçeneği" — admin, rafsız/stok dışı ürünleri depo depo gezinmeden görsün.

**Çözüm (`src/modules/admin/shelf-matrix.js`):** Depo seçicisine üçüncü bir düğme eklendi: **🗂️ Havuz**. Bu GERÇEK bir
depo DEĞİLDİR — `activeDepot` değeri `'havuz'` olduğunda `collectPoolShelves()` çağrılır:
- Her iki depo için `collectShelves(depot)`'un ZATEN hesapladığı "Rafı Tanımsız" kovasını (key: `UNASSIGNED_SHELF`)
  yeniden kullanır — **yeni bir** gruplama/sayma mantığı icat edilmedi.
- İki kart üretir: "B1 Havuzu" ve "B2 Havuzu" (boş olsalar bile her zaman gösterilir — admin "B2'de hiç yok" bilsin).
- Her kart KENDİ depo etiketini taşır (`shelf.depot`); `makeShelfCard` artık `data-depot` için önce `shelf.depot`'a,
  yoksa `activeDepot`'a bakar — bu sayede "İncele" düğmesi doğru depoyla `openDrawer(depot, UNASSIGNED_SHELF)`'i açar
  (AYNI, zaten test edilmiş çekmece/taşıma akışı — P2-07'nin odak-koruma düzeltmesi dahil, değişmeden çalışır).
- Metrikler (`makeMetricsHtml`) Havuz modunda özel bir özet gösterir: toplam havuz ürünü + depo başına kırılım.

**Kapsam sınırı (bilinçli):** "Havuz" sekmesi, iki depoyu TEK bir çekmecede BİRLEŞTİRMEZ (her kart kendi depo
çekmecesini açar) — ürünü taşıma düğmesinin hangi depoya ait olduğunu bilmesi gerektiği için (aynı anda iki depoyu
karıştıran tek bir liste, "taşı" eylemini belirsizleştirirdi). Kullanıcının asıl isteği ("depo depo gezinmeden görme")
bu şekilde tam karşılanıyor; iki depoyu TEK çekmecede birleştirmek istenirse bu ayrı, daha büyük bir iştir.

## 4. Aşama 6 — Veri Geçişi: "Sistem Raf Sayaçlarını Eşitle (Sync)"

### 4.1 Neden gerekli

Aşama 2/4'teki `runStockOps`/`runProductSave`/`runTransfer` yalnız **kendilerinden SONRAKİ** stok değişikliklerinde
`usedSlots`'u doğru tutar. Bundan ÖNCE yazılmış veri (P1-02 öncesi) ve kataloğa SONRADAN eklenen eski raflar için
sayaç gerçek durumu yansıtmayabilir (kayma). Bu, o kaymayı kapatan **tek seferlik, geçici** bir araçtır — kalıcı bir
günlük işlem değildir (WMS sekmesinde amber/"dikkat" tonunda, gündelik eylemlerden görsel olarak ayrı bir düğme).

### 4.2 Tasarım — "hepsi ya da hiçbiri" DEĞİL

Görev tarifinin açık isteği: *"Rafı olmayan veya kapasiteyi aşan durumlarda ... uyarı bassın ama işlemi
durdurmasın."* Bu yüzden motor (`StockLedger.planShelfSync` / `runShelfSync`, `src/services/stock-ledger.js`) ÖNCEKİ
Aşama 2/4 motorlarından (transaction, "ya hepsi ya hiçbiri") kasıtlı olarak FARKLIDIR: **her raf bağımsız düzeltilir.**

1. B1, B2 ve raf kataloğu **sunucudan taze** okunur (`getDocsFromServer` — bir transaction değildir, sorgu
   transaction içinde yapılamaz zaten).
2. Her depo için `Schema.slotUsageByShelf(items)` gerçek doluluğu hesaplar (`{kanonikKod: sayı}`).
   - **İnce nokta:** bu fonksiyon yalnız İŞGAL EDEN kodları döner — tamamen boşalmış bir raf (0 ürün) hiç anahtar
     olarak geçmez. Bu yüzden "düzeltilecek kodlar" kümesi yalnız gerçek sayımdan değil, kataloğun KENDİ kodlarıyla
     da BİRLEŞTİRİLİR; aksi halde boşalmış ama hâlâ eski `usedSlots` değerini taşıyan bir raf hiç düzeltilmezdi.
3. Üç bağımsız sonuç listesi:
   - **`updated`**: sayım farklı ama kapasite içinde → `usedSlots` düzeltilir.
   - **`capacityRaised`**: gerçek sayım kayıtlı KAPASİTEYİ aşıyor → kapasite **gerçek sayıma yükseltilir** (aşağıda
     neden) ve ayrı bir listede raporlanır (admin incelemeli, otomatik düşürme yok — veri kaybı riski sıfır).
   - **`unregistered`**: ürünlerin taşıdığı raf kodu katalogda HİÇ yok → yalnız raporlanır, hiçbir yere yazılmaz.
   - **`pool`**: rafsız ürün sayısı (B1/B2/toplam) — herhangi bir raf belgesine yazılmaz, yalnız bilgi amaçlı.
4. Düzeltmeler 450'lik parçalar hâlinde `writeBatch` ile yazılır (`atomic-writer.js`'teki `LIMITS.maxOps` ile aynı pay).

**Neden kapasite "yükseltiliyor" (düşürülmüyor)?** `firestore.rules`'taki (Aşama 2) raf güncelleme kuralı,
`usedSlots`'un yalnız `capacity` sınırı İÇİNDE artabileceğini şart koşar — bu, P1-02'nin GÜNLÜK işlemlerdeki
(transfer, ürün düzenleme) kapasite zorlamasının AYNI sunucu-taraflı korumasıdır. Sync bu korumayı GEVŞETMEDEN (kural
değişmedi) geçmiş kaymayı yazabilmek için, kapasiteyi aşan tek durumda kapasiteyi GERÇEK sayıma yükseltir — bu,
"ürünleri kaybetmeden/silmeden kaydı doğru yap, sonra admin karar versin" ilkesidir. Admin isterse WMS'ten bu rafın
kapasitesini daha sonra YENİDEN küçültebilir (ürünleri başka rafa taşıdıktan sonra).

### 4.3 Kullanıcı arayüzü

WMS başlığına amber tonunda, "📌 geçici araç" görünümünde bir düğme eklendi: **"🔄 Sistem Raf Sayaçlarını Eşitle
(Sync)"**. Akış: onay sorusu (`showCustomConfirm`) → `window.syncShelfCounters()` → sonuç özeti (yeni bir
`createDialog` + `DialogStack` tabanlı diyalog: kaç raf güncellendi, kapasitesi yükseltilenler listesi, katalog dışı
raflar listesi, havuzdaki ürün sayısı) → WMS haritası yeniden çizilir.

### 4.4 Doğrulama

9 yeni birim testi (saf `planShelfSync`, Firestore'suz) + **9 yeni emülatör testi** (`runShelfSync`, GERÇEK
`firestore.rules` altında):

| Emülatör senaryosu | Sonuç |
|---|---|
| Varsayılan tohum zaten tutarlı | Hiçbir şey yazılmaz |
| Sayım kataloktan sapmış (kapasite içinde) | Gerçek Firestore belgesi düzeltilir |
| Üçüncü ürün eklenince (kapasite içinde kalarak) | `updated`, `capacityRaised` DEĞİL |
| **Kapasite GERÇEKTEN aşılmış** | **Kural reddetmeden** kapasite sayıma yükseltilir — Aşama 2'nin rule testiyle AYNI kısıtın bu yeni yazma yoluyla da doğru çalıştığının somut kanıtı |
| Tamamen boşalmış raf (gerçek 0, kayıtlı eski) | Düzeltilir (yukarıdaki "ince nokta") |
| Raf kodlu ürün var ama katalogda yok | `unregistered`, yazma yok, işlem durmaz |
| Rafsız (Havuz) ürünler | `pool`'da sayılır, hiçbir rafa yazılmaz |

## 5. Aşama 7 — Son Regresyon

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | **193/193** (14 yeni: 5 Havuz/içe aktarma + 9 planShelfSync) |
| `npm run test:ledger:emu` | **26/26** (9 yeni: `runShelfSync`) |
| `npm run test:rules` | **218/218** (değişmedi — `firestore.rules` bu pakette dokunulmadı) |
| `npm run lint:xss` | 50 dosya, 907 ifade, 0 izinsiz |
| `test:atomic:emu` / `test:ownership:emu` / `test:staff:emu` | 5/5 · 22/22 · 15/15 (değişmedi) |
| `node --check` (tüm değişen JS) | Temiz |
| `git diff --check` | Temiz (yalnız CRLF bildirimi) |
| Tarayıcı akışları (emülatör, 56 senaryo) | 50 çalıştı, 47 geçti — bkz. §5.1 |

### 5.1 Tarayıcı akışları — aynı 3 bilinen/ilgisiz hata, aynı imza

`p5AuditAtomicImport` (Excel içe aktarmayı GERÇEK UI'dan süren, bu paketin Havuz değişikliğiyle güncellenen senaryo)
dahil **47/50** geçti. Aşama 4-5'te tespit edilen aynı 3 senaryo (`j3SessionVisa`, `j4SelfApproval`,
`j6PostLogoutRelogin`) aynı "Navigation timeout" / "adminForceLogout is not a function" hatasıyla, aynı noktada
başarısız oldu; sonrasında test koşucusu aynı puppeteer çökmesiyle durdu (kalan 6 senaryo yine doğrulanamadı). Bu,
senin de onayladığın gibi `auth-engine.js`'teki başka, bana ait olmayan bir çalışmadan kalma — bu pakette hiçbir
şey değiştirmedim ve imza (hangi senaryo, hangi hata, hangi sırada) BİREBİR aynı kaldı.

## 6. Açık kalanlar ve sınırlar (dürüst not)

1. **Sync, geçmişi "doğru" yapar ama geleceği GARANTİ ETMEZ.** Çalıştırıldığı AN için doğrudur; ondan sonraki her
   yazma zaten Aşama 4'ün `runStockOps`/`runProductSave` muhasebesinden geçtiği için drift bir daha BİRİKMEMELİDİR
   — ama katalog dışı (unregistered) raflarda hâlâ sayaç tutulmuyor (bilinçli, Aşama 4-5 raporunun 1. notu).
2. **Kapasite otomatik yükseltme kalıcıdır, geçici değildir.** Sync bir rafın kapasitesini yükselttiğinde bu,
   admin WMS'ten bilinçli olarak küçültene kadar KALICI bir kapasite değeridir (ürün taşımadan düşürülemez — kural).
3. **"Havuz" sekmesi iki depoyu birleştirmez**, yalnız HIZLI ERİŞİM sağlar (bkz. §3). Ürünleri havuzdan rafa atama
   hâlâ her depo için AYRI AYRI, WMS'in "Rafı değiştir" düğmesiyle yapılır (Aşama 4'ün `runStockTransferTransaction`
   yoluyla, kapasite yine transaction içinde denetlenir).
4. **Excel içe aktarma kuralı, katalog BOŞSA agresif davranır** (her raf Havuz'a düşer) — bu, senin onayladığın,
   BİLİNÇLİ bir tercihtir (manuel raf ataması planın için).
5. **`scratch/hosting-files.js`'in beklenen dosya sayısı** yine güncel değil (bu pakette yeni bir uygulama dosyası
   eklenmedi — yalnız mevcut dosyalar değişti — ama Aşama 4-5'teki `dialog-stack.js` eklentisi hâlâ sayıma
   yansıtılmamıştı); deploy öncesi bilinçli güncellenmeli.

## 7. Değişen / eklenen dosyalar (bu paket)

- **Değişen:** `src/utils/stock-import.js`, `script.js`, `src/services/stock-ledger.js`,
  `src/services/firebase-handler.js`, `src/modules/admin/shelf-matrix.js`, `src/modules/admin/shelf-matrix.css`,
  `admin.html`
- **Test:** `tests/unit/stock-import.test.mjs`, `tests/unit/stock-ledger.test.mjs`,
  `tests/integration/stock-ledger.emu.test.mjs`, `scratch/flow-tests.js`

## 8. Nihai durum — Aşama 0'dan 7'ye

| Aşama | Rapor | Durum |
|---|---|---|
| 0–1 | Yazma Haritası ve Raf Sözleşmesi | ✅ |
| 2–3 | Transaction ile Stok ve Kapasite Servisi | ✅ |
| 4–5 | WMS Entegrasyonu ve UX | ✅ |
| 6–7 | Migration ve Final UX (bu rapor) | ✅ |

Tüm paketler yerel dalda (`feat/phase-7-logging-and-ux`), commit/deploy edilmeden tamamlandı. Firebase Spark planı
kısıtı (Cloud Functions yok) hiçbir pakette ihlal edilmedi. Bağımsız denetim (Astra) ve `master`'a merge kararı
sana ait.
