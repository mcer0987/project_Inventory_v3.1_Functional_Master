# Faz 3 · Tur H4 Walkthrough (şema sözleşmesi, zimmet servisi, demirbaş kimliği ve servis geçmişi)

> **Tarih:** 29.09.2026 · **Branch:** `refactor/phase-3-data-layer` (H3'ün üstünde; henüz merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** `medipol-inventory-v3` · testler yalnız `inventory_demo` · canlı `lifeserver_master` ve eski `inventory_v2`'ye dokunulmadı
> **Kapsam:** Plan 3.6 + 3.7 + 3.9 (3.9 sahibinin 29.09 talimatıyla H4'e alındı) · saha notları 29.09 #1, #2, #3
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. b1/b2/b3 yazmaları admin oturumu istediği için gerçek Firestore'da sahibi tarafından elle doğrulanmalı (aşağıda).

## Saha notları → neden → çözüm
| # | Not | Kök neden | Çözüm |
|---|---|---|---|
| 1 | Muhammed CER'e admin'den 2 kalem zimmet verildi, Kişi Envanterim boş | Ekran yalnız "teslim alındı" durumundaki talepleri tarıyordu; admin'in doğrudan zimmetleri (`b3` + `assignments`) hiç okunmuyordu (ITSM-04). Büyük/küçük harf zaten duyarsızdı, neden bu değildi | 3.7 zimmet servisi: Kişi Envanterim ve admin Zimmet ekranı aynı listeden; kişi önce **personel id** ile, yoksa Türkçe güvenli adla eşleşir |
| 2 | B3'te Ürün Türü "-", Raf No "TALEP"; "neden ikinci kez?" | b3 dört yerde dört biçimde yazılıyordu. Talep onayı stok kalemi seçilmeden yapılınca Raf No'ya bilerek "TALEP" yazıyordu; tür kayda hiç yazılmıyor, o an depodaki üründen aranıyordu (ürün B2'ye taşınınca bulunamadı). Tur 2.5'te yalnız okuyucu yamanmıştı; yazanlar farklı biçimde yazmaya devam etti ve bunu yakalayan test yoktu | 3.6: tek kurucu (`buildB3Entry`, tür/raf/depo **yazma anında** kayda), tek okuyucu (`normalizeB3`), **sözleşme testi** (yazan her yol aynı 27 alanı üretmek zorunda), VIP "Şema Göçü" |
| 3 | Aynı cihaz yeniden servise gidince geçmiş görünür mü? Demirbaşta SN zorunlu mu? | Hayır: servis kaydı dönüşte **siliniyordu**. SN yalnız çıkış formunda (sarf dahil herkese) isteniyordu; sepette tek alan, zimmette isteğe bağlı, sevkte hiç yok. Sevk satırın **tamamını** götürüyordu (37 adetten 1 cihaz → 37'si) | 3.9: demirbaşta cihaz başına Seri No / Envanter No (en az biri), cihaz başına kayıt, aktif kimlik ikinci kez verilemez; servis kaydı kapanır ama silinmez; birleşik cihaz geçmişi; sevkte yalnız seçilen adet |

## Talimatla çelişen / düzeltilen noktalar (bildirim)
1. **"Muhammed Cer / CER harf duyarlılığı"**: mevcut kod adları küçük harfe çevirerek karşılaştırıyordu, yani bu sorunun nedeni değildi. Neden, ekranın okuduğu kaynaktı (#1). Yine de eşleşme artık id ile yapılıyor; id'siz eski kayıtlarda Türkçe güvenli ad karşılaştırması var (İ/ı, fazla boşluk).
2. **"Onaydan gelen kayıtta `tur` alanına 'TALEP' yazılıyor, kolonlar kayıyor"**: "TALEP" tür alanına değil **Raf No** alanına (`shelfNo`) bilerek yazılıyordu; kolon kayması yoktu. Tür boşluğunun nedeni, türün kayda yazılmayıp o an depoda aranmasıydı. Çözüm talimattaki gibi kanonik şema.
3. **Depolar arası (B1↔B2) sevkte kimlik/kısmi adet uygulanmadı**, karar bekliyor (aşağıda). Talimattaki "sevk (iç/dış/servis)" ifadesinin **dış birim (kampüs) ve servis** kısmı uygulandı.

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `ca86567` | 3.6 · DATA-08, INV-08, ZIM-06 | `schema.js` sözleşmesi: `B3_KEYS` (sema 2), `buildB3Entry`, `normalizeB3`, `toCanonicalB3`, `validateB3`, `normName`, `isDemirbas` (tek kural; zimmet listesi de bunu kullanır, Pasif/Hurda önerilmez), `normalizeStock`, `normalizeRequest` |
| `1ffe7e2` | 3.6 | Yazan 4 yol tek kurucuya, okuyan 9 yer normalizer'a (tablo, Excel, B3 PDF, zimmet PDF'i, dashboard grafikleri, zimmet ekranı, iade, cihaz geçmişi, silme onayı). Sözleşme testi |
| `5588f52` | 3.7 · ITSM-04, ITSM-06 | `assignment-service.js`: Kişi Envanterim, Taleplerim, talep sahipliği ve admin Zimmet ekranı tek kaynaktan; yeni taleplerde `personelId`, erişim kodu artık talebe kopyalanmıyor |
| `8cab33c` | 3.6 · karar 4 | VIP **Şema Göçü (B3)**: önizleme → onay → b3 yedeği (JSON) indirilir → 400'lük atomik parçalar; tekrar çalıştırmak güvenli |
| `9b31341` | 3.9a · ZIM-06 | Demirbaş kimlik kuralı: tekil çıkış, sepet, admin zimmeti, talep onayı; cihaz başına kayıt (adet 1) |
| `b627d43` | 3.9b-d · INV-06 (kısmi) | Servis/dış sevkte seçilen adet + kimlik + cihaz başına servis kaydı; dönüşte kayıt kapanır (silinmez); tarihli durum geçmişi; birleşik cihaz geçmişi (iki sayfada) |

## 3.6 — B3 kanonik şeması
Alanlar: `id, sema(2), tip ('cikis'|'zimmet'), kaynakDepo ('b1'|'b2'|'stok-disi'), productId, requestId, rafNo, sutun, urunTuru, urunAciklama, marka, adet, sn, envanterNo, not, alanKisi, personelId, tarih, ts, isDemirbas, talepTuru, oncelik, iadeTarihi, iadeEdildi, iadeEdildiTarihi, iadeDepo, onaylayan`

| Eski alan | Kanonik |
|---|---|
| `shelfNo` | `rafNo` ("TALEP" → `kaynakDepo: 'stok-disi'`, ekranda **Stok dışı**) |
| `productType` (onay/zimmet kayıtlarında ürün **adı**) | `urunAciklama` |
| — (kayıtta yoktu) | `urunTuru`, `sutun`, `marka` (yazma anında üründen) |
| `sarfAdet` / `note` / `date` / `person` / `sourceRepo` / `approvedBy` | `adet` / `not` / `tarih` / `alanKisi` / `kaynakDepo` / `onaylayan` |

- **Neden bir daha olmayacak:** `b3WriteContract` testi b3'e yazan her yolu çalıştırır ve kaydın sözleşmeyi geçtiğini, anahtar kümesinin birebir aynı olduğunu doğrular. Yeni bir özellik farklı biçimde yazarsa test kırılır.
- **Göç (VIP → Şema Göçü (B3)):** Ekranlar eski kayıtları göç olmadan da doğru gösterir. Göç, tür/raf bilgisini kayda kalıcı yazar ve eski alan adlarını kaldırır. Karşılığı olmayan alanlar (`description` vb.) korunur. Zimmet kayıtlarına, ad tek bir personele denk geliyorsa `personelId` eklenir. Sözleşmeyi geçemeyen kayda dokunulmaz (konsola listelenir).
- **Göçte testin yakaladığı hata:** deposu kayıtta yazmayan eski bir çıkış kaydı "stok dışı" işaretleniyordu; ikinci çalıştırmada rafı "-" olacaktı. Hiç çalıştırılmadan düzeltildi (bilinmeyen depo `null` kalır, raf korunur).
- Demo önizlemesi (salt okunur): 7 kaydın 7'si dönüştürülebilir; 4'üne tür, 5 zimmete `personelId` eklenecek, 1 "TALEP" → Stok dışı; sözleşme dışı kayıt 0.

## 3.7 — Zimmet servisi
- `getAssignments()`: b3 zimmet hareketleri + b3 ikizi olmayan eski onaylı/teslim alınmış talepler, zamana göre.
- `matchesPerson()`: `personelId` → eski talepte personel kodu → Türkçe güvenli ad.
- **Kişi Envanterim** = kişinin iade edilmemiş ve teslim alınmış zimmetleri. Talepten gelen zimmet, önceki gibi "Teslim Aldım" sonrası görünür. **Değişen:** iade edilen kalem artık listeden düşer; admin'in doğrudan zimmeti görünür.
- **Bilinen sınır:** `personelId` taşımayan eski kayıtlar, adları aynı olan iki farklı kişiye de görünür (adlar birebir aynıysa ayırt edilemez). Göç, adı tek kişiye denk gelen kayıtlara id ekler.

## 3.9 — Demirbaş kimliği ve servis geçmişi
- **Kural (sahibinin kararı):** Seri No ve Envanter No ayrı alanlar; demirbaşta her cihaz için **en az biri zorunlu**. Karşılaştırma boşluk ve harf duyarsız.
- **Cihaz başına kayıt:** 2 adetlik demirbaş çıkışı/zimmeti B3'te ve Zimmet ekranında **2 satır** olur (adet 1). Her biri ayrı iade edilir, servise gider, izlenir. Talep, ona bağlı son cihaz iade edilince "iade edildi" olur.
- **Tekrar kullanım engeli:** iade edilmemiş bir zimmette ya da açık bir servis kaydında olan kimlik yeniden verilemez. İade edilen cihaz tekrar verilebilir.
- **Ekranlar:**
  - Tekil çıkış: demirbaşta serbest "SN / BioPro / Itsm" alanı gizlenir; ITSM/BioPro numarası Not'a yazılabilir.
  - Sepet: demirbaş kalemin altında kimlik satırları var; ortak alan yalnız sarf kalem varsa zorunlu, demirbaş kalemlerin notuna "Ref:" olarak eklenir.
  - Admin zimmeti: tek SN kutusu yerine adet kadar satır.
  - Talep onayı: seçilen stok kalemi demirbaşsa talep adedi kadar satır. Stok dışı onayda talep edilen ad bir demirbaş türüyse de istenir; değilse önceki gibi isteğe bağlı.
- **Servis / dış birim sevki:**
  - Adet alanı var: demirbaşta varsayılan 1, sarfta tüm stok. Yalnız o kadar düşer, satır silinmez.
  - Demirbaşta cihaz başına kimlikli servis kaydı açılır.
  - Sevk ekranı ürünün ve girilen kimliklerin önceki servis kayıtlarını listeler.
- **Dönüş:** kayıt "Depoya Döndü" olarak kapanır (stok iadesiyle aynı transaction). Panelden ve sayaçtan düşer, geçmişte kalır. Durum güncellemeleri tarihli geçmiş satırı olarak yazılır.
- **Cihaz Geçmişi** (admin Zimmet ekranı "Geçmiş", servis paneli 🕘): zimmet, iade, çıkış, servise/dış birime sevk, durum değişiklikleri, depoya dönüş; zaman sırasıyla, Seri No veya Envanter No ile.

## Karar gereken
1. **Depolar arası (B1↔B2) sevk:** bugün satırın tamamı taşınıyor ve stok satırı cihaz kimliği tutmuyor (37 adetlik satır için 37 kimlik istemek anlamsız olur). Öneri: B1↔B2 bir **konum değişikliği** olarak kalsın (organizasyondan çıkış değil). Cihaz bazlı stok takibi gerekiyorsa ayrı bir alt plan (hareket defteri + kısmi taşıma) Faz 5'e alınsın.
2. **"Hurda / Atık" hedefi:** sevk listesinde duruyor ama zaten çalışmıyordu ("Geçersiz hedef"); değiştirilmedi. Öneri: Faz 5'te kimlik zorunlu bir hurdaya ayırma akışı.

## Kanıt
Yeni senaryolar (`scratch/flow-tests.js`):
| Senaryo | Doğrulanan |
|---|---|
| `schemaContract` | Ekran görüntüsündeki 4 satırın eski biçimleri doğru okunur (TALEP → Stok dışı, B2'ye taşınan ürünün türü bulunur); göç dönüşümü sözleşmeyi geçer, idempotent, görünümü değiştirmez; Türkçe ad eşleşmesi; tek demirbaş kuralı |
| `b3WriteContract` | 5 yazma yolu (tekil çıkış, sepet, stoklu/stoksuz onay, admin zimmeti): 0 sözleşme hatası, birebir aynı anahtar kümesi |
| `h4AssignmentService` | Saha senaryosu (2 doğrudan zimmet görünür); iade/çıkış/teslim alınmamış görünmez; aynı adlı başka kişi id ile ayrılır; eski kodla eşleşme; yeni talepte `personelId` var, erişim kodu yok; admin ekranı aynı kaynak |
| `h4SchemaMigration` | Demo önizlemesi; onay → yedek → yazma sırası; 900 kayıt → 400+400+100; sözleşme dışına dokunulmaz; tekrar çalıştırma 0; personel reddedilir |
| `h4DeviceIds` | Çıkış/sepet/zimmette satır sayısı = adet; eksik, tekrar, zimmette ve serviste olan kimlik reddedilir; iade sonrası serbest; sarf etkilenmez; cihaz başına kayıt |
| `h4ServiceHistory` | Sevk −1 (satır silinmez), cihaz başına kayıt, eksik/serviste kimlik ve stok üstü adet reddi, sarf tek kayıt; dönüş kaydı kapatır; kapalı kayda ikinci dönüş reddi; durum güncellemesi tek doküman; birleşik geçmiş (zimmet → iade → sevk → durum → dönüş) |
| `h4ServicePanel` | Panel yalnız açık kayıtlar (kapanmış gizli, `kapandi` alanı olmayan eski kayıt açık sayılır), sayaç, geçmiş düğmesi, durum geçmişi görünümü |
| `requestApprovalStock`, `h3Assignments` (uyarlandı) | Demirbaş onayında 2 kimlik satırı, boşken ret, cihaz başına kayıt; zimmet 2+1 adet → 3 kayıt; dönüşte kayıt kapanır |

Tam suite: **30/30 senaryo, pageerror 0** (7 yeni, 3 uyarlandı) · smoke: **index + admin: pageerror 0, "Veri Çekildi" 13/13** (admin tek console.error = favicon 404; `scratch/baseline/2026-09-29T08-27-40_p3-h4`) · `inventory_demo` test artığı: **0** `__flowtest__` kaydı; demo verisi değişmedi (b3 7 kayıt, hiçbiri göç edilmedi)

## Sahibinin elle doğrulaması (localhost, admin)
1. **Kişi Envanterim:** Muhammed CER hesabıyla gir → admin'den verilen iki kalem görünür. Birini admin'de "Zimmetten Düş" → listeden düşer.
2. **B3 tablosu:** stok seçmeden bir talep onayla → Raf No "Stok dışı". Stoktan onayla → Ürün Türü dolu. Ürünü başka depoya sevk et → satır değişmez.
3. **Şema Göçü (önce demo):** VIP → "Şema Göçü (B3)" → önizleme sayıları → onayla → `b3-yedek-inventory_demo-….json` iner → tablo aynı görünür. İkinci kez çalıştır → "zaten yeni şemada".
4. **Demirbaş çıkışı:** demirbaş bir üründen 2 adet çıkış → 2 kimlik satırı; birini boş bırak → uyarı; ikisini de doldur → B3'te 2 satır.
5. **Aynı cihaz iki kişiye:** bir SN ile zimmet ver, aynı SN ile ikinci zimmet ya da çıkış dene → "şu an … üzerinde zimmetli".
6. **Sepet:** bir demirbaş (2 adet) + bir sarf kalem; sarf için "SN / BioPro / Itsm" boşken uyarı.
7. **Servis:** 1 cihazı Teknik Servis'e sevk et (Seri No gir) → depoda adet 1 azalır (satır kalır). Durumu "Parça Bekleniyor" yap → "Depoya Geri Al" → adet geri gelir, panelden düşer. Aynı cihazı tekrar sevk etmeye başla → sevk ekranında önceki servis kaydı listelenir; 🕘 geçmişte sevk, durum ve dönüş görünür.
8. **Canlı:** bu branch deploy edildikten sonra canlıda VIP → Şema Göçü (karar 4). Önce yedek dosyasını sakla.

## Bilinen / sonraki
- B1↔B2 sevk ve Hurda/Atık: yukarıdaki "Karar gereken".
- Stok dışı onayda demirbaş tespiti yalnız "talep edilen ad bir tür adı mı" kuralıyla yapılır; talep formunda tür seçimi yok (Faz 5 adayı).
- Zimmet PDF'i (5.1) ve TODO modülünün bellekte değiştirip kaydetmesi (Faz 5) değişmedi.
