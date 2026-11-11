# H3-A implementation plan

9 Kasım 2026. Başlangıç dalı `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91`; H0/Q0/H1/H2 yerel değişiklikleri korunur. Bu belge prototip kodundan önce yazılmıştır. Başlangıç kopyaları, diff ve SHA-256 listesi `scratch/ebys-h3a-evidence/` altında.

## Amaç ve teslim sınırı

Çalışan legacy satın almanın birim adından kalıcı kimliğe geçişini, yeni EBYS talebinin tek evraka bağlanmasını ve ilk onayda sürüm başına mali kesinleştirmeyi tasarlamak. Tasarım tam mevcut Rules üzerinde izole aday yamayla sınanacak. Ürün dosyaları ve kurallar değişmeyecek; canlı/migrasyon/commit/deploy yok. H3-B yalnız incelenmiş kimlik/şema uygulaması olarak ayrı teslimdir.

## Çalışma sırası

1. Mevcut satın alma, genel yazma yolu, EBYS şema/Rules, birim/personel ve kurtarma sınırlarını belgeye kaynak satırlarıyla işle.
2. Veri ve komut sözleşmesini yaz: eski/yeni kayıt örnekleri, yol kimliği, sahiplik, sürüm, motor, ilk onay, revizyon ve korunan tarihsel alanlar. Mevcut `birim` görüntüsünü koru; aynı adla otomatik eşleme yapma.
3. Normalleştirme/eşleme için salt okunur demo analizi; canlıya erişmeden sınıflandırma kanıtı.
4. Tam Rules kopyasını hash kontrollü yama ile aday kurala dönüştüren araç ve bağımsız demo koşucu. Yeni talepler tek motorlu; eski genel allow dalları yeni yolu atlayamaz.
5. Üç kalem/altı adım, ilk=son onay, iade/yeni sürüm, vekâlet, çapraz kimlik, eski overwrite ve eşzamanlı tekrar testleri. Eski satın alma ve envanter testlerini adayla birlikte çalıştır.
6. Gerçek SDK okuma/yazma ölçümü, Rules sınırı/hata incelemesi. Gerekirse aynı güvenliği koruyarak prototipi daralt; başarısız bütçeyi güvenlik kanıtı diye sunma.
7. Son kurallar değişmemişken mevcut birim/Rules/XSS/Hosting kontrolleri; hash karşılaştırması, walkthrough, rehber taslağı ve H3-B görev sınırı.

## İlk sözleşme tercihleri — prototip sonucuyla kesinleştirilecek

- Yeni talepler UUID yoluyla, `engineVersion: ebys-v1`, mevcut ortak `unitId` ve uyumluluk için `birim` metniyle oluşturulur. Eski sayısal ID/ad kayıtları legacy kalır; isim eşleşmesi rapor önerisidir.
- Talep ve ana evrak aynı UUID'yi kullanır; yeni yolda `purchaseOrderId == documentId`. Ayrı rezervasyon koleksiyonu gerekmez. Karşılıklı create-only bağ aynı transaction'da doğrulanır. Eski belgeyi ele geçirerek bağlama yasaktır.
- Dondurulan teklif sürümü değişmez. İlk olumlu karar (rotanın ilk adımı paraf/onay/olur olabilir) aynı transaction'da ayrı, sürüm başına mali kesinleştirme kaydı oluşturur. İade/red bunu oluşturmaz. Kur dondurma anına taşınmaz.
- Mevcut `purchaseFinance` legacy yolunun tekil anahtarı değişmeden kalır. Yeni mali yol için çakışmasız sürüm anahtarı ve şema/erişim ayrımı değerlendirilir; sonuç sözleşmede gerekçelendirilir.
- Yeni talebin karar kaynağı yalnız EBYS sürecidir. Legacy alanlardan yetki veya sonuç türetilmez. Motor silme/değiştirme ve eski tam overwrite yönetici dahil reddedilir.
- Tarihsel küçük birim/künye verisi dondurma anında kaynakla ilişkilendirilir; kurum sicili henüz yoksa serbest kurum kodu doğrulanmış sicil diye sunulmaz.

## Yetki ve bütçe

Owner taslak içeriğini; aktif görevli yalnız atandığı sürümü; geçmiş karar sahibi karar verdiği sürümü; icracı aktif icra işinin sürümünü okur. Mali okuma aynı sürüm erişimine tabidir. Yabancı/gelecek görevli ve sadece admin olan kişi için içerik genişletmesi yok. Açık sayfa dışında dinleyici/arka plan yazımı eklenmez.

Tahmini ek yük: talep/ana evrak bağında +1 belge yazımı; ilk onayda +1 değişmez finans kaydı. Dondurmada ek birim kaynağı okuması gerekebilir. Bunlar ilk tahmindir; komut başına gerçek ölçümle değiştirilecektir. Genel Firestore günlük ücretsiz kotasının tüm modüllerle ortak olduğu kabul edilir. Tam ifade sayısı ölçülemezse yalnız geçen uç testler ve yapısal erişim hesabı raporlanır.

Geri dönüş, yeni EBYS talebi açmayı kapatmakla sınırlı; mevcut yeni işlerin okunması/bitirilmesi korunacak. Eski Rules'a dönerek motor korumalarını kaldırmak çözüm değil. Prototip Rules yazımı yalnız ayrı demo emülatörde; elle kullanılan emülatöre veya canlı veriye dokunulmaz.

## Kullanıcı kabulü ve rehber

H3-A'da yeni kullanıcı ekranı yok. Rehber taslağı ortak birim seçimini, aynı adları ayırt etmeyi, ödenek/kalem toplamını ve ilk onayda sabit kuru 3–5 basit adımda anlatacak; henüz uygulanmamış olarak işaretlenecek. H3-B/H4/H5 gerçek form ve erişim kabulü bu prototipin yerine geçmez.

## Teslim notu — 10 Kasım 2026

Plan uygulandı. 20 prototip testi, tam aday Rules ile 357 regresyon, özgün ürün Rules'uyla 357 test ve 339 birim testi geçti. XSS/Hosting/diff temiz; 350 kaynak dosyası başlangıçla aynı. Nihai kararlar ayrı Veri ve Servis Sözleşmesi'nde, başarısız adayların gerekçeleri ve bütçe kanıtları Walkthrough'dadır. Mevcut finansın altına sürüm yolu seçildi; ilave üst koleksiyon açılmadı. H3-B promptu yalnız saf kimlik/şema hazırlığıyla sınırlandırıldı.
