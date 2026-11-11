# EBYS H1 uygulama planı

9 Kasım 2026. A tarayıcı kabulünün iki sürüm yolu tamamlandı. H1 başlangıç diff'i ve etkilenecek dosyalar kanıt klasörüne kaydedilir.

1. Kişisel export'un mevcut rol filtrelerini koru. Üst sınırı olan okumalar, oturum ve kök kontrolü, değişen başlık/süreç algılaması ve kayıtlı okuma sayıları ekle. Yalnız yetkili başlıkların tokenlarıyla kamusal projeksiyonu oku. Özel rezervasyon manifestoda hariç kalır. Timestamp alanları saniye ve nanosaniye olarak ayrıştırılabilen biçimde saklanır.
2. Kurum provası için ayrı Node aracı. Yalnız açık loopback adresi, demo proje ve inventory_demo kökü. Durgun kaynakta iki sınırlı tarama, Firestore REST türleriyle paket, açık kapsam ve SHA-256. Kurum hesapları, dosya baytları ve stok hareketleri kapsam dışı. Bağlam kayıtları mevcut birim/personel/hesap eşlemeleri ve erişim kilididir.
3. Yazmadan önce paket, kimlikler, ilişkiler, sürüm özeti, QR rezervasyonu ve durum tutarlılığı doğrulansın. Varsayılan önizleme. Dolu hedef reddedilir. Sınır içindeki boş hedefe yalnız açık uygulama komutuyla tek create-only commit. Son tarama ile doğrula. Başarısız veya belirsiz sonuç açıkça raporlanır.
4. Demo kaynak ve ayrı boş demo hedefte geçerli, iptal ve arşiv QR, geçmiş sürüm ve rol erişimi sınansın. Bozuk paket, yanlış hedef ve çakışma yazma öncesinde engellensin. Birim, Rules ve XSS koşularını son kodda kaydet. Rehberde kişisel dosya ile kurumsal kurtarma kapsamını açıkla.
