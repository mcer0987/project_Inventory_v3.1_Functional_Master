# H0 teslim kontrolü

8 Kasım 2026. Karar: **Q0 geliştirmesine geçiş uygun; yayın kabulü değildir.**

Ana klasörde `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91` üzerinde henüz commit edilmemiş teslim incelendi. Gerçek diff 7 dosyada +259/−9. Servis/şema/Rules/UI değişiklikleri, yeni testlerin içeriği, walkthrough ve ham sonuç günlükleri karşılaştırıldı. Bu kontrol turunda test takımları yeniden çalıştırılmadı.

- Normal görev sunucu başlangıcı + en fazla 7776000 saniye ile sınırlı. Göreli süre ve mutlak bitiş birlikte kullanılamıyor.
- Vekâlet göreli süre yazamıyor; açık tarih ve 90 günlük üst sınırı korunuyor.
- Eski mutlak süreli görevlerin okuma yolu korunmuş. Doğrudan süre uzatma yeni izin almıyor.
- Saat kaydırma yalnız test VM'sinde; gerçek servis iş mantığını regex ile değiştirme yok. Süre fixture'ları dışındaki kanıtlanan eylemler Rules açıkken çalışıyor.
- Günlükler: tam Rules 354/354, birim 327/327; XSS raporu temiz. Hedefli H0 bütçe taramasında eşleşme yok. Tam Rules takımındaki bütün negatif retlerin bütçe nedeninden bağımsız olduğu iddia edilemez; walkthrough bunu doğru ayırıyor.
- Ek sunucu, koleksiyon, SDK okuma/yazma eklenmemiş. Rehber değişikliği kapsamla uyumlu.

Sınırlar: görsel/klavye UAT yapılmamış; gerçek kota ölçülmemiş. UI süresi cihaz saatine bağlı. Saf testteki tam bitiş karşılaştırması Rules'un tam o nanosaniyede çalıştırıldığına kanıt değildir. Eski Rules'a doğrudan dönüş göreli süreli kayıtlarla uyumsuzdur. Eski sekmeler yenilenmelidir.

Q0 aynı çalışma ağacındaki H0 değişikliklerini koruyarak başlamalı. H0 commit edilmediği için Q0 başlangıç diff'i/özeti ayrıca kaydedilmeli; Q0 raporu H0 satırlarını kendi değişikliği gibi saymamalı. Commit/deploy yapılmadı.
