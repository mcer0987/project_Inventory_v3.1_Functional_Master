# Q0 Implementation Plan

8 Kasım 2026. Üretim değişikliğinden önce hazırlanmıştır. Dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91`; H0 başlangıcı `scratch/ebys-q0-evidence/baseline.patch`, dosya kopyaları ve SHA256 listesiyle korundu. AGENTS.md ve Q0 görev/bağlam belgeleri incelendi. H0 raporları değiştirilmez.

## Karar

Yeni görev özeti alanı/Rules/indeks eklemeyeceğiz. Eski ve yeni görevler aynı açık kullanıcı isteğiyle konu, sabit sürüm ve süreç durumunu alacak. Kartta görev durumu ve evrak kimliği mevcut alanlardan; konu/sürüm numarası için açık ayrıntı düğmesi. Okunan durumun o ana ait olduğu belirtilecek. İçerik modalı daima görevin versionId'sini kullanacak; liste yetki kanıtı olmayacak. Gizli genel cache yok.

Görünür görev kuyruğu tek cursor+limit(50) aboneliği; kart başına süreç dinleyicisi ve tam sürüm okuması sıfır. Eski 50 sınırı korunur: 25'e değiştirmek ek sayfa yükleme davranışı gerektirecek, Q0 kazancı kart alt aboneliklerini kaldırmaktan gelir. Geçmiş kartlarında yeni sürüme yönlendirme yok. Ayrıntı bir süreç + bir sürüm okuması, yalnız istek anında; modal kapalı/oturum değişmiş/geç çizimse yanıt atılır. Sürekli ayrıntı aboneliği eklenmez.

Kuyruklar görünür üst sekmeye ve oturum yaşam döngüsüne bağlanır. Sekmenin style/class değişimi MutationObserver ile izlenir; polling yok. Sayfa gizlendiğinde de temizlenir. Abonelik hatasında kartlar ve açık içerik temizlenir. Geç gelen callback'ler generation ve UID ile reddedilir.

Defter sayacı ilk görünür açılışta bir kez (4 aggregate sorgu); snapshot tekrarları/sayfalama/tür değişimi sayacı yenilemez. Açık “Toplamları yenile” düğmesi, kapsam ve son yükleme açıklaması; bilinmeyen değer `—`. Gizlenince/oturum kapanınca sayaç geçersizleştirilir. Aynı anda yinelenen yenileme birleştirilir. Sayfa içi arama açık etiketlenir. Liste hatası eski satırları temizler.

## Yetki ve bütçe

Rules, servis kararları, H0 süre hesabı ve izinler korunur. Yazar/görevli/geçmiş imzacı aynı kaynak yollarıyla okur; yetki reddi içerik göstermez. Yeni alan/collection/yazma yok. N kart için eski liste: 1+N listener, N süreç ilk snapshot'ı ve N sürüm okuması (aktif+geçmiş çift kart ayrıca büyür); yeni: 1 listener, sıfır kart alt okuması. Liste snapshot belgeleri bu hesaptan ayrı. Defter S snapshot için aggregate 4S → ilk açılışta4, her açık yenilemede4. Rules bağımlı okumaları ve fatura/kota ölçümü yapılmadan sıfır maliyet denmeyecek.

## Kanıt ve geri dönüş

Gerçek UI modüllerini yerel headless Chrome'da kontrollü SDK sınırıyla çalıştır: 1/25/50 kart, tekrar snapshot, hata, boş liste, sayfalama, aç/kapat, gizli sekme, logout ve geç promise; sayaç ilk yükleme/yenileme. Başlangıç kopyalarıyla aynı ölçüm düzeneğini çalıştır. Bu çağrı sayımı yetki kanıtı değildir; tam demo Rules takımı H0 ve envanteri doğrular. Tam birim/Rules/XSS komutları yeni kodda çalışır. Tarayıcı fixture kontrolü gerçek Auth/emülatör uçtan uca UAT'tan ayrılır. Rehbere yalnız ayrıntı ve toplam yenileme adımı eklenir.

Geri dönüş Q0 dosya farklarını başlangıç kopyalarıyla karşılaştırarak yapılabilir; H0'ı içeren dosya komple HEAD'e döndürülmez. Yeni veri şeması olmadığı için göç yok. Commit/push/deploy/canlı veri değişikliği ve H1 kapsam dışıdır.

## Q0-R1 / Q0-R2 kapanış planı — 8 Kasım

Başlangıç kapanış diff'i ve üç dosyanın kopyaları `scratch/ebys-q0-closure-evidence/` altında saklanır. İnceleme betiği değiştirilmeden önce yeniden çalıştırılır. Yalnız iki UI dosyası ve kalıcı Chrome testleri değişir; Rules/servis/H0 değişmez.

Abonelik duraklatma, panelden ayrılma ve oturum/yetki kaybı ayrılır. Tarayıcı gizlenince liste aboneliği kesilir, açık form DOM'da yalnız bellekte korunur, işlemler kilitlenir. Dönüşte açık süreç formu için süreç revizyonu ve sabit sürüm erişimi yeniden doğrulanır. Aynı görev geçerliyse not aynen kalır; görev değişmiş veya gerçek erişim reddedilmişse eski form kaldırılır. Ağ hatasında not korunarak tekrar kontrol düğmesi sunulur; otomatik karar/kayıt yok. Modal sahipliği kuyruk/servis bazında izlenir; ilgisiz kuyruğun temizliği başka formu kaldırmaz. Oturum nesli ortak, kuyruk nesli yereldir.

Defter yalnız görünür panel+görünür belge+geçerli oturumda tek abonelik tutar. Görünürlük olayları idempotenttir. Gizlenme bekleyen liste/sayaç yanıtını geçersizleştirir; tamamlanmış sayaç sonucu bellekte kalır, bekleyen sonucu kaybolmuş sayaç bilinmeyen kalır ve yalnız açık yenilemeyle alınır. Böylece her geri dönüşte dört yeni sorgu yoktur. Açık editörde yazılmamış metin korunur; mevcut kaydın erişim/revizyonu dönüşte kontrol edilir. Panelden ayrılma, logout ve gerçek yetki reddi yalnız ilgili modal sahiplerini temizler.

Kalıcı testler gerçek karar ve evrak formlarında metin koruma, 1→0→1 dinleyici, sayaç sabitliği, iki kuyruk/modal izolasyonu, gizli logout/UID değişimi, dönüşte izin reddi ve geç cevapları kapsar. Chrome için CHROME_EXECUTABLE_PATH / CHROME_PATH, mevcut yaygın kurulumlar ve Puppeteer varsayılanı kullanılır; bulunamazsa test başarısız olur, skip yok. Önce/sonra ve tam testler ayrı kapanış günlüklerine yazılır. Gerçek ürün UAT ve kontrollü fixture birbirinden ayrılır.
