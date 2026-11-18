# EBYS Aşama 3–7 Manuel Kabul Senaryosu

**Senaryo** Bir fakülte ihtiyacı için kalemli satın alma talebi, üst yazı, kurum içi onay, icra, doğrulama ve arşiv.  
**Ortam** Yerel Firebase Emülatörü, `inventory_demo` kökü, `feat/v3.4-ebys-asama-7` çalışma dizini.

Senaryo iki kayıt kullanır. **SAT-UAT** satın alma akışını sınar. **EVR-UAT** aynı ihtiyaca ilişkin ayrı bir EBYS üst yazısıdır ve Aşama 4–7 boyunca ilerler.

## 0. Hazırlık

VS Code’da `C:/Users/med3pol/Documents/project_Inventory/scratch/ebys-asama-6` klasörünü aç. Terminalde `git branch --show-current` çıktısı `feat/v3.4-ebys-asama-7` olmalı. Emülatörü bu klasördeki Firestore kurallarıyla çalıştır.

| Terminal | Komut |
| --- | --- |
| 1 | `npm run emu` |
| 2 | Emülatör hazır olunca `node scratch/emu-ensure-uat.mjs`, ardından `npm run serve` |

Tarayıcıda [personel girişini](http://127.0.0.1:5500/index.html?emu=1) aç. Konsolda `inventory_demo @ EMULATOR` ve Firebase giriş isteklerinde `127.0.0.1:9099` görünmeli. Yönetici için giriş ekranındaki **Yönetici Paneli** yolunu kullan. Hesapların birbirinin oturumunu etkilememesi için ayrı tarayıcı profilleri kullanabilir veya her rol değişiminde çıkış yapabilirsin.

| Rol | Emülatör hesabı | Yerel giriş kodu |
| --- | --- | --- |
| Yönetici ve EVR-UAT yazarı | `admin@medipol.local` | `emu-yonetici-0001` |
| Personel A ve SAT-UAT yazarı | `flow.personel` | `ftkod77` |
| Personel B ve onaycı | `flow.onaylayici` | `ftkod88` |

**Birim seçimi:** Test birimi listede yoksa EVR-UAT için kullandığın birimi (örneğin Bilgi Teknolojileri) kaynak birim olarak seç. İcra birimi, sorumlunun personel kaydında bağlı olduğu aktif birim olmalı.

**Ön koşul:** Yönetici **Talep ve Süreçler → İcra Takibi → Havale tanımları** bölümünde **İç yazışma** için kaynak birimi EVR-UAT evrakındaki **İlgili birim** ile aynı seçer. İcra birimi, seçilen sorumlunun bağlı olduğu aktif birimdir. Sorumlu **Flow Test Personel (A)** ve hedef **24 saat** olsun. Tanım eksikse son onay beklemede kalır. Tanımı kaydedip aynı son onayı tekrar deneyebilirsin.

## 1. Aşama 3 · Kalemli satın alma ve kurun dondurulması

1. Yönetici **Operasyon Merkezi → Satın Alma Tahmini Döviz Kurları** alanında USD **30**, EUR **35**, tarih olarak test gününü ve kaynak olarak `UAT sabit kuru` kaydeder.
2. Personel A **Satın Alma (EBYS)** altında **SAT-UAT · Fakülte laboratuvar ihtiyacı** talebini **Test** birimiyle oluşturur. Aşağıdaki kalemleri girer.

   | Kalem | Miktar | Birim fiyat | KDV | KDV dahil beklenen |
   | --- | ---: | ---: | ---: | ---: |
   | Kablo | 2 | 100 TRY | %20 | 240 TRY |
   | Adaptör | 3 | 10 USD | %10 | 33 USD |
   | Kurulum hizmeti | 1 | 20 EUR | %0 | 20 EUR |

3. **Beklenen:** Otomatik ödenek `1.930,00 TL` olur. Ödeneği elle `2.100,00 TL` yapıp kaydet. Ayrıntıda ve yazdırma önizlemesinde kalemleri, KDV dahil toplamları ve elle girilen ödeneği karşılaştır.
4. Talebin onay akışını başlatıp Personel B’yi ata. B **Bana Gelen Onaylar → Satın alma onayları** bölümünden onaylar.
5. Yönetici ortak kurları USD **40**, EUR **45** olarak değiştirir. **Beklenen:** SAT-UAT detayında ve çıktısında onay anındaki TL karşılığı `1.930,00 TL` kalır. Ödenek `2.100,00 TL` olarak görünür.

## 2. Aşama 4 · Üst yazı, kayıt numarası ve sabit sürüm

1. Yönetici **Talep ve Süreçler → Evrak Kayıt Defteri → İç Yazışmalar → Yeni evrak** yoluyla `EVR-UAT · Fakülte laboratuvar ihtiyacı` başlıklı bir üst yazı açar. Birim **Test**, kurum kodu **MED**, muhatap **Fakülte Sekreterliği**, dosya planı **100**, gizlilik **Normal** olsun. Gövdeye `UAT sürüm 1 — teslim süreci incelensin.` yaz.
2. Taslağı kaydet, listeden yeniden aç, **Kesin kayıt numarası al** ve sonra **Onaya sun / Dondur** işlemlerini yap. Evrak numarasını not al.
3. **Beklenen:** **Taslağı kaydet** başarıyla bitince pencere kapanır. **Kesin kayıt numarası al** ve **Onaya sun / Dondur** sonrasında güncel evrak penceresi açılır. Evrak **İç Yazışmalar** defterinde görünür. Dondurulduktan sonra gövde düzenlenemez. **Çıktı önizleme** kayıt numarasını ve sürüm 1 metnini gösterir.

## 3. Aşama 5 · Sıralı onay, gerekçeli iade ve red

1. Yönetici hesabıyla **Talep ve Süreçler → Evrak Kayıt Defteri → İç Yazışmalar** bölümüne dön. Dondurulmuş **EVR-UAT** satırının **İşlem** sütununda **Süreç durumu** düğmesine bas. Açılan pencerede imzacıları ekle ve **Süreci başlat** seç. İlk adım Personel A **Paraf**, son adım Personel B **Onay** olsun. B hesabında **Bana Gelen Onaylar → Evrak görevlerim** bölümünü A işlem yapmadan önce kontrol et.
2. **Beklenen:** B’nin aktif görev listesinde EVR-UAT henüz görünmez. A **Görevdeki sürümü aç** ile sürüm 1’i görür ve onaylar. Ardından B’nin aktif görevi görünür.
3. B **Yazara iade et** işlemini `Teslim bilgisi eklensin` gerekçesiyle yapar. **Beklenen:** Yazar evrakı **Bana Gelen Onaylar → Geri dönen evraklarım** bölümünde gerekçesiyle görür. İcra işi oluşmaz. A’nın karar geçmişi yalnız sürüm 1’i açar.
4. Yazar **Gerekçe ve yeni sürüm → Yeni sürüm hazırla** ile `UAT sürüm 2` metnini girer. Indexte açık editörden doğrudan **Onaya sun / Dondur**, ardından **Onay rotası / Süreç** seçebilir. Yalnız **Taslağı kaydet** seçilirse pencere kapanır ve taslağa Evrak Kayıt Defteri’nden dönülür. Yalnız B’ye tek adımlı rota başlatır. B `Birim bilgisi düzeltilsin` gerekçesiyle **Reddet** seçer. **Beklenen:** Evrak gerekçesiyle tekrar yazara döner. İcra işi oluşmaz.
5. Yazar `UAT sürüm 3 — teslim bilgisi tamamlandı.` metniyle yeni sürümü hazırlar ve dondurur. Yalnız B’ye tek adımlı rota açar. B son onayı verir. **Beklenen:** Evrak numarası korunur. Kurum içi onay tamamlanır ve A için tek icra işi açılır.

## 4. Aşama 6 · İcra, yeniden havale ve bildirim

1. Yönetici **İcra Takibi** tablosunda EVR-UAT işini **Kabul bekliyor** durumunda görür. B’nin kişisel **İcra İşlerim** listesinde bu iş henüz görünmez.
2. A **Görevlerim → İcra İşlerim → Görevi aç** üzerinden sürüm 3’ü açar ve **Kabul Et** seçer. Ardından `Teslimi diğer sorumlu yapacak` gerekçesiyle iade eder.
3. **Beklenen:** Yönetici işi **Havale Bekleyen İadeler** kuyruğunda görür. İlk hedef korunur. Yönetici **Yeniden Havale Et** ile işi B’ye aktarır. Yeni hedef ayrı görünür. A’nın eski paraf geçmişi sürüm 1’i açar. Sürüm 3 için icra erişimi sona erer.
4. B işi kabul eder. **Tamamla** formuna sonuç `Teslim edildi`, kanıt `UAT tutanak 001` ve stok işlem numarası `UAT-SAHte-001` girip dene. **Beklenen:** Kapanış reddedilir, iş **İcrada** kalır. Stok gerektirmeyen bu senaryoda stok alanını boşaltıp aynı sonuç ve kanıtla tamamla.
5. **Beklenen:** İş **Tamamlandı**, evrak **Kapandı** olur. Yazar **Görevlerim → Evrak Bildirimlerim** altında tek kapanış bildirimi görür. Bildirimden evrakı aç ve okundu olarak işaretle.
6. **İsteğe bağlı stoklu tur:** Ayrı bir aktif icra işinde yönetici, emülatördeki gerçek bir stok hareketini **İcra Takibi → Detay → Stok işlemini doğrula ve bağla** üzerinden o işe bağlar. Sorumlu aynı referansla kapanışı tamamlayabilir. Aynı referans başka bir icra işinde reddedilir.

## 5. Aşama 7 · QR, anonim doğrulama, arşiv ve iptal

1. Yazar kapalı EVR-UAT evrakını açar ve **Doğrulama QR’ı oluştur** seçer. **Çıktı önizleme** üzerinden QR ve bağlantıyı kontrol et. Yazdırma önizlemesinde QR görünmeli.
2. Bağlantıyı oturumsuz bir tarayıcı penceresinde **yerel adresi ve `?emu=1` parametresini koruyarak** aç. **Beklenen:** Evrak No, Kayıt Tarihi, Konu Özeti, **Geçerli** durumu ve 64 karakterli SHA-256 özeti görünür. Yasal uyarı görünür. Evrak gövdesi, kişi adı ve imza geçmişi ekranda yer almaz.
3. Adresin `#` sonrasını önce `yanlis`, sonra `00000000000000000000000000000000` yap. **Beklenen:** İlkinde anahtar geçersiz, ikincisinde kayıt bulunamadı mesajı gösterilir. Önceki belge bilgileri ekrandan temizlenir.
4. Yönetici **İcra Takibi → Detay → Arşivle** seçer. İlk doğrulama bağlantısını yenile. **Beklenen:** Aynı numara ve içerik özetiyle durum **Arşivde** olur. İcra geçmişinde tek arşivleme olayı vardır. Arşivlenen evrakın sabit sürümü düzenlemeye kapalıdır.
5. Yönetici aynı iş detayında **Doğrulamayı iptal et** seçer. **Beklenen:** Aynı bağlantı **İptal** durumunu gösterir. Evrak defterinde belge **Arşivde** kalır.

## Sonuç kaydı

Her aşama için **Geçti / Kaldı** yaz. Bir sapmada ekran yolu, test rolü, adım numarası, beklenen sonuç ve görülen sonucu kaydet. Gerekirse ekran görüntüsünde giriş kodunu ve QR bağlantısının anahtar bölümünü kapat.
