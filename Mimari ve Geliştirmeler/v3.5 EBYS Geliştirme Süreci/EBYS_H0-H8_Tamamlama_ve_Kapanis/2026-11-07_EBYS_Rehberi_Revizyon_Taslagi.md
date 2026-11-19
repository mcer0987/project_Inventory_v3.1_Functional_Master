# EBYS Rehberi — sade kullanım metni taslağı

Tarih: 7 Kasım 2026, 18 Kasım 2026'da İP-9 ile güncellendi. H0–H8 kapsamı tamamlandı (bkz. `2026-11-18_EBYS_H8_Birlesik_Kabul_ve_Kurtarma_Walkthrough.md`); bu metin artık **gerçekleşmiş ve çalışan** ürünü anlatır, planlanan/gelecek özellik yoktur. Her bölüm gerçek ekran, sekme ve düğme adlarıyla hizalanmıştır; düğme adları yine de her yayın öncesi gerçek arayüzle tekrar eşleştirilmelidir (ekran metinleri zamanla değişebilir).

## Anlatım düzeni

Her bölümde önce tek cümle amaç, ardından ekran yolu ve kısa adımlar bulunur. Ayrıntılar “Nasıl kullanırım?” düğmesiyle açılır. Teknik kimlik, koleksiyon, transaction ve token anlatımları son kullanıcı metnine girmez. Mevcut görseller ve örnek akış korunur; örneklerin gerçek işlem yapmadığı görünür yazılır. İP-9 ölçütü: interaktiflik yalnız gerçekten işlevselse eklenir — işlevsel olmayacaksa hiç eklenmez (bkz. Aşama 5/6 simülasyonları, aşağıda).

## 1. Birim ve personel — mevcut (H3-A/H3-B tamamlandı)

**Bu bölüm ne için?** Evrakın hangi birime ait olduğunu ve işi kimin yapacağını doğru seçmenizi sağlar.

**Personel için:** Formdaki ilgili birimi listeden seçin. Birim yoksa yeni bir ad yazarak geçmeyin; yöneticinizden ortak Birim Yönetimi ekranına eklemesini isteyin.

**Yönetici için:**

1. Ortak birim ekranından birimi ekleyin veya mevcut kaydı düzenleyin.
2. Personel kaydında bu birimi seçin.
3. Personelin aktif olduğunu ve giriş hesabının açıldığını kontrol edin.
4. Havale tanımında önce icra birimini, sonra o birimdeki uygun personeli seçin.

**Sonuç:** Birim ve personel uygun seçim listelerinde görünür. Yeni birim eklemek, o birime otomatik icra sorumlusu atamaz; havale tanımı ayrıca kaydedilir. Birimin veya personelin adı sonradan değişse de kayıt bağlantısı (kalıcı kimlik) korunur; eski evrakın üzerinde o tarihteki birim/personel adı kalır.

**Personel görünmüyorsa:** Aktiflik, giriş hesabı ve seçilen birime bağlılık kontrol edilmelidir. Daha önce bir evrakı onaylamış olması şart değildir.

## 2. Satın alma talebi ve revizyon — mevcut, evrak bağı aynı talep üzerinden

**Bu bölüm ne için?** Alınmasını istediğiniz mal veya hizmetleri, ayırmak istediğiniz ödeneği ve bu talebe bağlı resmi evrakı tek akışta ilerletirsiniz.

**Nereden?** Satın Alma Talepleri (EBYS) → Yeni Talep.

1. İlgili birimi ve talep konusunu seçin/yazın. Aynı adı taşıyan birimler varsa yanındaki kodu ve bağlı olduğu birimi kontrol edin.
2. Her mal veya hizmeti ayrı kalem olarak ekleyin: miktar, birim fiyat, para birimi (TRY/USD/EUR karışık olabilir) ve vergi. Kalem toplamına ve ödenek önerisine bakın; daha yüksek ödenek istiyorsanız tutarı ve gerekçesini yazın.
3. Talebi kaydedin; bağlı evrakını aynı talebin içinden açıp metni ve teklifi kontrol edip bir kez onaya gönderin (dondurun).
4. Sıranız geldiğinde size açılan sürümü inceleyin. İlk olumlu kararda döviz kuru belgeye sabitlenir; sonraki kur güncellemeleri bu talebin TL karşılığını etkilemez.
5. İade gelirse gerekçeye göre **aynı talebe** yeni bir sürüm hazırlarsınız — talep kimliği değişmez, önceki sürümün metni, birim adı ve kesinleşmiş tutarı geçmişte korunur.
6. Son onaydan sonra açılan icra görevinden işin durumunu izleyin.

**Sonuç:** Talep, bağlı evrakı ve tek onay rotası üzerinden ilerler. Son onay işi sorumluya iletir; evrak kapanana kadar iş icradadır (bkz. bölüm 6.5 "İcra nedir?").

**Kur eksikse:** Yönetici kur, tarih ve kaynak bilgisini Operasyon Merkezi'nden tamamlamalıdır. Rastgele kur girerek ilerlemeyin; kur eksikken verilecek ilk olumlu karar reddedilir.

**Takılırsanız:** Birim listede yoksa yöneticinizden Birim Yönetimi'ni kontrol etmesini isteyin. İcra görevi açılamıyorsa havale sorumlusunu kontrol ettirin.

## 3. Evrak hazırlama — yönetici yolu ve personelin kendi çalışma alanı

**Bu bölüm ne için?** Gelen yazıyı kaydetmek, giden yazı hazırlamak veya kurum içinde yazışmak için kullanılır.

**Personel için (`index.html` → "Evraklarım (EBYS)"):** Kendi gelen, giden ve iç yazışma taslaklarınızı "Evrak Kayıt Defteri" bölümünde **Yeni evrak** ile hazırlar, metni dondurup onay rotası başlatır ve **Evrak kopyasını indir** ile kendi evraklarınızın kişisel kopyasını alırsınız.

**Yönetici için:** Talepler ve Süreçler → Evrak Kayıt Defteri.

1. Gelen Evrak, Giden Evrak veya İç Yazışmalar defterini seçin.
2. Yeni taslağı açın. Birim, konu, muhatap ve evrak metnini doldurun. Kurum künyesi tanımlıysa yeni taslak bu künyeyi otomatik kopyalar (bkz. bölüm 13); dosya planı veya üst yazı şablonu seçebilirsiniz.
3. Hazırlığa sonra devam edecekseniz Taslağı Kaydet seçeneğini kullanın.
4. Kayıt numarası gerekiyorsa Kesin kayıt numarası al seçeneğini kullanın.
5. Metin hazır olduğunda Onaya sun / Dondur seçeneğini kullanın.

**Sonuç:** Dondurduğunuz metin değişmez. Bu işlem tek başına onay rotasını başlatmaz; sonraki bölümden onaylayacak kişileri seçmeniz gerekir. Evrak numarası alınması dış kurum onayı anlamına gelmez.

## 4. Onay rotasını başlatma — Aşama 5

**Bu bölüm ne için?** Hazır evrakı kimin, hangi sırayla inceleyeceğini belirlersiniz.

**Nereden?** İlgili evrak → Süreç durumu veya Onay rotası / Süreç.

1. Evrakın dondurulmuş sürümünü kontrol edin.
2. Onaylayacak kişileri sırayla seçin. Evrakın yazarı kendi onay rotasına atanmaz.
3. Adımları kontrol edip Süreci başlat seçeneğini kullanın.
4. “Aktif” durumunu ve sıradaki kişiyi görün.

**Sonuç:** İlk kişiye görev gider. Sonraki kişiler sıraları gelince görevlerini görür.

**Pencereyi kapatırsanız:** Süreç devam eder. Kapat düğmesi süreci geri çekmez. Geri çekme ayrı bir işlemdir ve gerekçe ister.

**Örnek rota:** Paraf → Onay → Olur bir örnektir; her evrakın mutlaka bu üç adımı izlemesi gerekmez. Buradaki kararlar kurum içi kararlardır, nitelikli e-imza değildir.

## 5. Evrakı inceleme ve karar verme — Aşama 5

**Nereden?** Bana Gelen Onaylar → Evrak görevlerim.

1. Aktif görevi bulun ve Görevdeki sürümü aç seçeneğiyle metni okuyun.
2. Görev / Karar bölümünü açın.
3. Uygunsa Onayla; düzeltme gerekiyorsa gerekçenizi yazıp Yazara iade et; uygun değilse gerekçenizi yazıp Reddet seçeneğini kullanın.
4. İşlem sonucunu ve görev kartının yeni durumunu kontrol edin.

**Sonuç:** Onay sıradaki kişiye geçer. Son onaydan sonra işi yapacak sorumluya icra görevi açılır. Evrak bu anda henüz iş tamamlandı anlamında kapanmış değildir (bkz. bölüm 6.5).

**“Havale tanımı yok” uyarısı:** Sistem işi kime vereceğini bilmiyor. Yönetici, evrakın türü ve bağlı birimi için havale sorumlusunu tanımlamalıdır. Sonra aynı onay yeniden denenebilir.

## 6. İade, red, geçmiş sürüm ve vekâlet — Aşama 5

**Yazara iade/red geldiyse:** Bana Gelen Onaylar → Geri dönen evraklarım bölümünden gerekçeyi okuyun. Yeni sürüm oluşturup gerekli düzeltmeyi yapın; yeni sürümü dondurup tekrar rotaya gönderin. Önceki kararlar yeni metne verilmiş onay sayılmaz.

**Karar geçmişi:** Karar verdiğim sürümü aç seçeneği o zamanki metni gösterir. Yeni metni ancak yeni sürümde size görev geldiğinde görebilirsiniz. Aktif görev ve geçmiş kararın iki ayrı kart olması bu nedenle normaldir.

**Güncel görev:** Yeni metni Aktif görev kartındaki **Görevdeki sürümü aç** ile inceleyin. Durum kontrolü başarısız olursa **Durumu yeniden kontrol et** düğmesi görünür.

**Vekâlet:** Yönetici, aktif görevin Süreç durumu ekranındaki Süreli vekâlet / yeniden atama alanını kullanır. Kişi, bitiş tarihi ve gerekçe girerek görevi devreder. Bu işlem rotaya yeni bir onay adımı eklemez; mevcut adımı geçici olarak başka kişiye verir.

**Süre dolarsa:** Otomatik olarak başka bir onay adımı açıldığını varsaymayın; yönetici görev durumunu kontrol etmelidir. Kurum genelindeki tüm görevler için toplu izin vekâleti bu ekranın kapsamı değildir.

## 6.5. Kavram: Onay/İmza ile İcra farkı; Havale nedir? (İP-9)

Rehberde (Aşama 6) standart kullanıcı için açıkça tanımlanır, burada da aynı dille özetlenir:

- **Onay/imza**, evrakın içeriğini uygun bulduğunuzu gösterir.
- **İcra**, onaylanan işin gerçekte yapılmasıdır — ürünün teslim edilmesi ya da talep edilen işlemin tamamlanması gibi. Evrak, icra bitmeden kapanmaz.
- **Havale**, son onaydan sonra işi kimin yürüteceğinin belirlenmesidir: yönetim işi ilgili birime veya sorumluya yönlendirir. Standart kullanıcı olarak yalnız bu seçimin sonucunu — size atanan işi — görürsünüz; havale tanımının kendisini (birim/sorumlu eşleştirmesi) yalnız yönetici yapar.

## 7. Havale sorumlusunu belirleme — Aşama 6, yönetici

**Bu bölüm ne için?** Son onaydan sonra işi hangi birim ve kişinin yapacağını önceden belirlersiniz.

**Nereden?** Yönetici → Talepler ve Süreçler → İcra Takibi → Havale tanımları.

1. Evrak türünü ve evrakın bağlı birimini seçin.
2. İşi yapacak icra birimini seçin.
3. O birimdeki uygun personeli ve hedef süreyi seçin.
4. Havale Tanımını Kaydet seçeneğini kullanın; kaydedildi bilgisini kontrol edin.

**Sonuç:** Uygun evrak son onayı aldığında sorumluya iş açılır. Tanımı kaydetmek tek başına henüz onaylanmamış evraka icra işi açmaz.

**Birim seçmeden tür varsayılanı kullanırsanız:** Birime özel tanım bulunmayan o türdeki evraklar bu sorumluya yönelir. Bu seçimi ancak gerçekten ortak sorumlu istiyorsanız kullanın.

## 8. İcra işini kabul etme veya iade — Aşama 6, sorumlu

**Bu bölüm ne için?** Onaylanmış evraktaki işi teslim alır, yapar ve sonucu kaydedersiniz.

**Nereden?** Görevlerim → İcra İşlerim.

1. Kabul bekleyen işi açıp evrakı okuyun.
2. İş size aitse Kabul Et seçeneğini kullanın.
3. Başarı mesajından sonra işi İcrada durumunda görün.
4. İş sizin görev alanınızda değilse gerekçenizi yazıp İade Et seçeneğini kullanın.

**Sonuç:** Kabul ettiğiniz iş sizde devam eder. İade edilen iş yeniden havale için yönetime gider; sessizce kaybolmaz.

**Yönetici için:** Yeni onaylanan iş genel İcra Takibi tablosunda Kabul bekliyor olarak görünür. Havale Bekleyen İadeler yalnız iade edilmiş işler içindir; yeni işin bu listede olmaması normaldir.

**Rehberde deneyin:** EBYS Rehberi → İcra ve Kapanış sekmesindeki "Örnek icra simülasyonu" bu üç durumu (Kabul bekliyor → İcrada → Tamamlandı, alternatif dal: İade edildi) gerçek düğme adlarıyla deneyimletir (İP-9, 9c).

## 9. İade edilen işi yeniden havale — Aşama 6, yönetici

**Nereden?** İcra Takibi → Havale Bekleyen İadeler.

1. İade gerekçesini okuyun ve iş ayrıntısını açın.
2. Yeniden Havale Et alanında doğru birimi ve sorumluyu seçin.
3. Süreyi ve havale gerekçesini girip kaydedin.
4. İşin yeni sorumluda Kabul bekliyor durumuna geçtiğini kontrol edin.

**Sonuç:** Yeni sorumlu işi teslim alabilir. Önceki iade ve bekleme bilgileri geçmişte kalır.

**Yalnız bir personel görünüyorsa:** Liste seçilen birimdeki uygun personelleri gösterir. Diğer kişinin ortak personel kaydındaki birim ve giriş hesabı kontrol edilmelidir.

## 10. İşi tamamlama ve stok referansı — Aşama 6

1. İşi gerçekten tamamladıktan sonra ayrıntısını açın.
2. Ne yaptığınızı İşlem sonucu alanına yazın.
3. Tutanak, teslim veya yazışma kaydını Kanıt referansı alanına girin.
4. İş için yönetimin bağladığı gerçek bir stok işlemi varsa onun numarasını kullanın. Stok hareketi olmayan işte isteğe bağlı stok alanı boş bırakılabilir.
5. Tamamla seçeneğini kullanın; başarı mesajını ve Tamamlandı durumunu kontrol edin.

**Sonuç:** Evrak kapanır. Belge sahibi Görevlerim → Evrak Bildirimlerim bölümünde kapanış bilgisini görür. Haricî e-posta gönderilmez.

**Stok kaydı bulunamadıysa:** Rastgele bir numara yazmayın. Yönetici gerçek stok işlemini bu işe bağlamalıdır. İş gerçekte stok işlemi gerektiriyorsa alanı boşaltmak eksik işlemi tamamlamaz. Evrakı onaylamak veya icrayı kapatmak kendiliğinden stok üretmez.

## 11. QR ile doğrulama — Aşama 7

**Bu bölüm ne için?** Bir belgenin kurum içindeki kayıt ve durum bilgisini kontrol etmeyi sağlar.

1. Evrak yazarı olarak kapanmış ve kayıt numarası alınmış evrakı açın.
2. Doğrulama QR'ı oluştur seçeneğini kullanın.
3. Çıktı önizleme bölümünden QR'ı görüntüleyin.
4. QR'ı açıp evrak numarası ve durum bilgisini kontrol edin.

**Sonuç:** Bağlantıyı bilen kişi sınırlı doğrulama bilgilerini görür. Tam metin, ekler ve karar geçmişi bu sayfada açılmaz.

**Düğme yoksa:** Evrakın yazarı olduğunuzu, kesin numarasını ve kapandığını kontrol edin. QR zaten oluşturulmuşsa çıktı önizlemesini açın.

**Görünür uyarı:** Bu belge kurum içi teyit amaçlıdır; nitelikli e-imza veya e-Devlet resmî onayı yerine geçmez.

## 12. Arşiv ve belge kopyası — Aşama 7/H1

**Yönetici:** Kapanmış evrakı arşivleme işlemiyle Arşivde durumuna alır. Arşivlemek belgeyi silmek veya üzerindeki bilgileri değiştirmek değildir.

**Belge sahibi:** **Evrak kopyasını indir** ile kendi evraklarınızı ve yetkili olduğunuz ilgili kayıtları alabilirsiniz. Dosyayı kurumunuzun izin verdiği güvenli yerde saklayın.

**Kapsam:** Kişisel dosyada dahil edilen ve eksik kalan kayıtlar belirtilir. Kurum künyesi, dosya planı ve üst yazı şablonu tanımları kişisel kopyaya dahil edilmez (bunlar kurumsal tanımlardır; evrağınız zaten o tanımın kopyasını taşır). Kurum kurtarma paketi ayrı hazırlanır ve yetkili operatör tarafından kullanılır.

**Evrak toplamları:** Bir evrakın yeni sürümü toplamı artırmaz. **Toplamları yenile** ile güncel sayıları ve son kontrol saatini görün.

## 13. Kurum künyesi, dosya planı ve üst yazı şablonları — H6b

**Bu bölüm ne için?** Kurum adı/adresi, resmi dosya planı ve hazır üst yazı metinlerini tek yerden tanımlarsınız; evraklar bunları yazıldıkları andaki haliyle kopyalar.

**Nereden?** Yönetici → Tanımlar → **Kurum Künyesi** / **Dosya Planı** / **Üst Yazı Şablonları**.

1. Kurum Künyesi sekmesinde kurum adı, kurum kodu, adres ve iletişim bilgilerini girip kaydedin.
2. Dosya Planı sekmesinde yeni bir plan kodu ve adı ekleyin ya da pasifleştirin (silme yok).
3. Üst Yazı Şablonları sekmesinde yeni bir şablon adı ve metni girin; var olan bir şablonu güncellediğinizde bu yeni bir sürüm olarak kaydedilir, eski sürüm değişmez.

**Sonuç:** Yeni evraklar bu güncel künye/plan/şablonu kopyalar. Künye veya plan sonradan değişse ya da pasife alınsa da daha önce dondurulmuş evraklar ve başlatılmış onay süreçleri aynı kalır.

**Personel için:** Evrak formunda dosya planını ve (varsa) hazır üst yazı şablonunu listeden seçersiniz; şablonu seçtiğinizde metin otomatik doldurulur ve istediğiniz gibi düzenleyebilirsiniz.

## 14. Gelen evraka cevap, mükerrer uyarısı ve manuel gönderim — H7

**Bu bölüm ne için?** Kurum dışından gelen bir yazıya resmi cevap hazırlamanızı, aynı yazının iki kez kaydedilmesini önlemenizi ve giden evrakın fiilen nasıl gönderildiğini (elden, posta, KEP vb.) kayıt altına almanızı sağlar.

**Gelen evraka cevap hazırlama:**

1. Kesin kayıt numarası almış ve dondurulmuş bir gelen evrakı açın.
2. **Cevap yazısı hazırla** düğmesini kullanın; açılan giden evrak taslağının metnine, hedef evrakın tarihi/sayısı/muhatabıyla biçimlendirilmiş bir **"İlgi:"** satırı otomatik eklenir.
3. Taslağı normal şekilde tamamlayıp dondurup onaya gönderin. Gelen evrakın penceresinde bu cevabı **"İlgi (Bağlı Gelen Evrak)"** bölümünden görebilirsiniz.

**Mükerrer (tekrar) kayıt uyarısı:** Gelen evrak formunda muhatap, dış evrak sayısı ve tarihi girdiğinizde sistem aynı üçlüyle önceden kayıt olup olmadığını kontrol eder. Varsa kayıt numarası, birim ve tarih gösterilir (içerik/konu/kişi bilgisi gösterilmez) ve **"Mükerrer olabileceğini kontrol ettim, yine de kaydet"** onay kutusunu işaretlemeden kayıt tamamlanmaz. Bu bir uyarıdır, engel değildir.

**Manuel gönderim kaydı:** Kesin kayıt numarası almış ve kurum içi onayı tamamlanmış bir giden evrakın penceresinde **Gönderim Takibi** bölümü açılır. Gönderim kanalını (Elden teslim, Posta/PTT, Kurye/Kargo, KEP — manuel beyan, E-posta — manuel beyan, Diğer), gönderim tarihini, dış referans/takip numarasını ve varsa notu girip **Gönderimi kaydet** seçeneğini kullanın. Yanlış girilen bir kayıt silinmez; gerekçeli bir **Düzeltme Beyanı** olarak yeni bir kayıt eklenir. Bu kayıt sistemin kendisinin e-posta veya KEP göndermesi anlamına gelmez; yalnız sizin fiilen yaptığınız gönderimin beyanıdır.

**Defterde arama ve filtreleme:** Evrak Kayıt Defteri'nde **Evrak durumu** ve **Evrak birimi** açılır listeleri ile tam **EBYS-...** kayıt numarası araması sunucudan, kayıtların tamamı üzerinde çalışır (yalnız açık sayfadaki 50 kayıtla sınırlı değildir). "Bu sayfada evrak numarası ara" kutusu ise yalnız o an ekrandaki sayfayı süzer; konu veya tam metin araması desteklenmez.

## Yayın öncesi içerik kontrolü

- Anlatılan her yol ve düğme gerçek ekranla eşleşiyor mu?
- Kullanıcı bir adımı tamamlayınca ne göreceğini biliyor mu?
- İade/red/geri çekme ve icra iadesi birbirinden ayırt ediliyor mu?
- Onay/imza ile icra farkı ve "havale" kavramı en az bir yerde açıkça tanımlanıyor mu?
- Her interaktif öğe (rehberdeki simülasyonlar dahil) gerçekten işlevsel mi? İşlevsel değilse rehberde yer almamalı (İP-9 ölçütü).
- Yönetici ve personel yalnız kendilerine uygun yönergeleri kolayca bulabiliyor mu?
- Yardım klavyeyle açılıyor/kapanıyor, dar ekranda ve koyu temada okunuyor mu?
- Rehber görüntülemek ek veritabanı veya model çağrısı oluşturmuyor mu?

Bu kontroller paketin walkthrough belgesinde sonuçlarıyla yer alır; yalnız metin taslağının varlığı testin geçtiği anlamına gelmez.

## H2/H7 ekran kullanımı (defter filtreleri)

Satın alma talebini Satın Alma ekranından, gelen ve giden evrakı veya iç yazışmayı ilgili Evrak Kayıt Defteri sekmesinden açın. Kurum içi onay tamamlandığında işin durumunu İcra Takibi bölümünden izleyin. **Evrak durumu**, **Evrak birimi** ve tam kayıt numarası (**EBYS-...**) filtreleri sunucudan, kayıtların tamamı üzerinde sorgulanır; yalnız kısmi/serbest metin araması açık sayfadaki en fazla 50 kayıtla sınırlıdır ve konu/tam metin araması desteklenmez (H7 D5). Güncel toplamlar için Toplamları yenile seçeneğini kullanın. Yeni sürüm aynı evraka aittir. Karar geçmişi karar verdiğiniz sürümü açar.
