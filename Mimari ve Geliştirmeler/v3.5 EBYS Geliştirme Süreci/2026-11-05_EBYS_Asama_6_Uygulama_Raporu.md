# v3.4 EBYS Aşama 6 Uygulama ve Denetim Hazırlık Raporu

**Tarih** 5 Kasım 2026  
**Dal** `feat/v3.4-ebys-asama-6`  
**Taban** `8350f91`  
**Durum** Aşama 6 kodu yerel çalışma dizininde denetime hazır. Commit, bağımsız denetim ve yayın bekleniyor. Aşağıdaki birim kayıtları mevcut Birim Ekleme servisiyle canlı kataloğa yazıldı.

## Uygulanan akış

1. **Havale.** Yönetici **Talepler ve Süreçler → İcra Takibi → Havale Tanımları** üzerinden evrak türünü, evrakın bağlı birimini, icra birimini, aktif sorumluyu ve hedef süreyi seçer. Kaynak ve hedef birimler ortak `units` koleksiyonundan gelir. Önce tür ve kaynak birim birlikte eşleştirilir. Özel kayıt yoksa yöneticinin kaydettiği tür varsayılanı uygulanır. Eşleşen tanım geçersizse son onay geri alınır ve kullanıcıya tanımın kapsamı belirtilir.
2. **Son onay.** Evrak `internally_approved` olur ve aynı işlem sabit sürüm için tek `ebysExecutionJobs/items/{processId}` kaydını açar. İş, kaynak birimi ve uygulanan politika anahtarını saklar. Atanan kişi **Görevlerim → İcra İşlerim** üzerinden sabit sürümü açar ve işi kabul eder.
3. **Onay reddi ve iadesi.** Gerekçeli red veya iade yazarın **Bana Gelen Onaylar → Geri dönen evraklarım** kuyruğuna gelir. Bu kuyruk evrakın güncel başlığını sorgular. Yazar gerekçeyi açabilir ve yeni sürüm hazırlayabilir. Yeni taslak açıldığında eski sürümün kartı bu kuyruktan çıkar. Bu kararlar icra işi açmaz.
4. **İcra iadesi ve süre.** Sorumlunun gerekçeli iadesi, işi sunucu zamanıyla `returned` durumuna alır ve icra kaynaklı sürüm erişimini kapatır. İade **Havale Bekleyen İadeler** kuyruğunda en eskiden başlayarak görünür. Yönetimde geçen süre ve ilk hedef ayrı gösterilir. Yeniden havale yeni sorumluya ayrı hedef verir. İlk hedef korunur, yönetimde geçen süre iade zamanı ile yeniden havale olayından izlenebilir.
5. **Stok kanıtı.** Yönetici defterdeki stok işlemini açıp gerekçeyle ilgili icra işine bağlar. Bağ tekildir ve değiştirilemez. Firestore Rules kapanıştan önce hem aynı kökteki stok hareketinin hem de bu işe ait doğrulanmış bağlantının varlığını kontrol eder. İcra işlemleri stok yazmaz. Stok referansı kullanılan kapanışlarda bu bağ zorunludur.
6. **Kapanış.** Sorumlu sonuç ve kanıtla işi tamamlar. Aynı işlem işi `completed`, evrakı `closed` yapar ve evrak sahibine tek kapanış bildirimi üretir. Sahip bildirimi **Görevlerim → Evrak Bildirimlerim** bölümünde görür. Yönetici daha sonra evrakı arşivleyebilir. E-posta gönderim niyeti `deferred` olarak tutulur.

## Canlı ortak birim kataloğu

`lifeserver_master/units/items` altında 12 yeni aktif birim doğrulandı. İşlem öncesindeki üç kayıt korundu ve toplam 15 birim okundu. Birim kodları uygulama içi tanımlardır. Personel bağları ve havale sorumluları yönetici tarafından belirlenecek.

| Kod | Birim |
| --- | --- |
| REK | Rektörlük |
| GENSEK | Genel Sekreterlik |
| YAZI | Yazı İşleri |
| IMIDB | İdari ve Mali İşler Daire Başkanlığı |
| TIP | Tıp Fakültesi |
| UTIP | Uluslararası Tıp Fakültesi |
| DHF | Diş Hekimliği Fakültesi |
| ECZ | Eczacılık Fakültesi |
| SBF | Sağlık Bilimleri Fakültesi |
| MDBF | Mühendislik ve Doğa Bilimleri Fakültesi |
| IYBF | İşletme ve Yönetim Bilimleri Fakültesi |
| HUK | Hukuk Fakültesi |

Satın Alma ve Bilgi Teknolojileri için mevcut kayıtlar kullanılır. Birim adları üniversitenin resmî kaynaklarından seçildi. [Fakülteler](https://www.medipol.edu.tr/akademik/fakulteler) · [Yazışma sistemi](https://www.medipol.edu.tr/sites/default/files/document/yazisma-sistemi.pdf) · [Satın alma ve idari süreçler](https://www.medipol.edu.tr/sites/default/files/document/butunlesik-kalite-yonetisim-sistemi-surec-hazirlik-esaslari-rehberi.pdf)

## Veri ve güvenlik sözleşmeleri

| Kayıt | İşlev |
| --- | --- |
| `ebysExecutionPolicies` | Tür ve kaynak birim başına politika. Tür anahtarı açık varsayılanı temsil eder. |
| `ebysExecutionJobs` | İş durumu, atanan UID, ilk ve güncel hedef, iade zamanı ve kapanış kanıtı. |
| `ebysExecutionEvents` | İş kimliği ve revizyonla bağlı, değiştirilemeyen olaylar. Yeniden havale olayı önceki iade zamanını korur. |
| `ebysExecutionStockLinks` | Aynı kökteki gerçek stok işleminden tek icra işine yönetici onaylı bağlantı. |
| `ebysNotifications` | Süreç başına tek kapanış bildirimi. Alıcı yalnız okunma zamanını yazabilir. |

Rules, aktif icra ve sürüm erişimini atanan UID’ye, bildirimi alıcı UID’ye bağlar. Son onay ve kapanıştaki zorunlu eş yazımlar `getAfter()` ile kontrol edilir. İadeler, yazarın geri dönen evrakları, kişisel bildirimler ve icra geçmişi için dört bileşik dizin eklendi. İcra işleri bu sürümden itibaren son onayı alan EBYS evrakları için açılır. Eski `purchaseOrders.workflow` talepleri mevcut satın alma akışıyla yürür.

## Değişen dosyalar

| Alan | Dosyalar |
| --- | --- |
| Servisler | `src/services/ebys-execution-service.js`, `src/services/ebys-process-service.js` |
| Arayüz | `admin.html`, `index.html`, `todo-module.js`, `src/ui/ebys-execution-ui.js`, `src/ui/ebys-documents-ui.js`, `src/ui/ebys-process-ui.js` |
| Şema, kurallar ve dizinler | `src/utils/ebys-document-schema.js`, `firestore.rules`, `firestore.indexes.json` |
| Test ve yayın kontrolü | `tests/rules/ebys-processes.test.mjs`, `scratch/ebys-stage5-ui.cjs`, `scratch/hosting-files.js` |

## Denetim kanıtı

| Kontrol | Sonuç |
| --- | --- |
| `npm run test:unit` | 290 geçti, 0 başarısız |
| `npm run test:rules` | 271 geçti, 0 başarısız |
| `npm run lint:xss` | 0 izinsiz ifade |
| Aşama 4–6 tarayıcı kontrolleri | Geçti. İade kuyruğu, süre alarmı, ortak birim seçimi ve stok doğrulama arayüzü sınandı. |
| Hosting dosya denetimi | 94 beklenen uygulama dosyası |

Rules senaryoları aynı onayın tekrarlanmasında tek iş oluştuğunu, geçersiz özel politikanın varsayılana düşmediğini, başka kullanıcının doğrudan SDK ile kabul ve kapanış yapamadığını, iade sonrası sürüm erişiminin kapandığını ve bildirimsiz kapanışın reddedildiğini kapsar. Stok senaryosu doğrulanmamış, başka köke ait ve başka işe bağlı referansları reddeder. Geçerli bağlantıyla kapanış yapılırken stok belgesi korunur. Altı adımlı EBYS akışı ve mevcut satın alma regresyonları emülatör limitleri içinde geçti.

Çalışma dizinindeki yerel kanıt dosyaları `scratch/execution-closure-final.log`, `scratch/execution-browser-evidence.log` ve `scratch/imu-live-unit-evidence.json`.

## Manuel kabul

1. Birim Yönetimi’nde yeni birimleri ve mevcut Satın Alma kaydını görün. Birimlere bağlı gerçek personel kayıtları hazır olduğunda, aynı evrak türü için iki farklı kaynak birime ayrı havale tanımı yapın.
2. Her birimden bir evrakı son onaya taşıyıp doğru sorumluların iş aldığını kontrol edin. Ayrı bir evrakta gerekçeli red veya iade verip yazarın kuyruğunu ve yeni sürüm adımını doğrulayın.
3. İcra işini kabul edin ve iade edin. Yönetici kuyruğundaki bekleme ve ilk hedefi kontrol edip yeniden havale edin.
4. Stok kullanılan bir icrada yöneticiyle defter kaydını doğrulayıp bağlayın. Sorumluyla kapatın ve evrak sahibinin tek bildirim aldığını kontrol edin.
