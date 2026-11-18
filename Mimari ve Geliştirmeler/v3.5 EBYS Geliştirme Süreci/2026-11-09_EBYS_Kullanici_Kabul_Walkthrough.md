# EBYS kullanıcı kabulü walkthrough

9 Kasım 2026. A kabul matrisi demo ortamında geçti. Bildirilen ilk oturumdaki eski metin yeniden üretilemedi. İki kayıt yolunda da sürüm bağı ve açılan metin doğrulandı. H1 bu sonuçtan sonra başlatıldı.

| İddia | Önce | Sonra ve kanıt |
|---|---|---|
| U1. Yeniden kontrol düğmesi | Kullanıcı ilk açılışta gördüğünü bildirdi. | Admin ve personel CSS ile ilk açılışta gizli ve odaklanamaz. Kontrollü bağlantı hatasında görünür, başarılı tekrarda gizlenir. |
| U2. KPI yerleşimi | KPI defter bölümünün içindeydi. | Özet defterin hemen önündeki kardeş bölüm. 390 px koyu temada kart ızgarası yatay taşmıyor. |
| U3. Sürüm ayrımı | Kullanıcı yeni aktif görevde eski metni gördüğünü bildirdi. | Doğrudan dondurma ve kaydet–yeniden aç–dondur yolları geçti. Taslak, başlık, süreç, görev, V2 metni ve çıktı eşleşiyor. Yeni aktif görev V2/B, geçmiş karar V1/A açıyor. V1 kaydı özetiyle birlikte aynı. V2 sırası gelmeyen kişinin isteği `permission-denied`. |
| U4. Toplam geri bildirimi | Aynı sayı geldiğinde işlem sonucu belirsizdi. | Yükleniyor, hata ve son başarılı kontrol gösteriliyor. Bir evrak iki sürümde de 1. İkinci evrakla yenileme 1→2. Snapshot veya sekme dönüşü başına yeni toplam sorgusu eklenmedi. |

Kanıtlar `scratch/ebys-kabul-evidence/browser-acceptance.log`, `browser.mjs` ve `kpi-dark-390.png` altında. Q0 sayaç ve dinleyici regresyonları birim testlerinde geçti.

Gerçek admin/personel HTML ve CSS, EBYS formu, süreç UI ve servisleri kullanıldı. Uygulamanın genel açılış/oturum kabuğu izole test köprüsüyle değiştirildi. Auth parola oturumları ve Firestore istekleri ayrı demo emülatörde çalıştı. Rules test başlangıcında yüklendi ve V2 erken erişim reddi doğrulandı. Köprü yerel SDK 12.19.0 ve ürünün long-poll ayarını kullandı. Kurumsal onay penceresi kabul yanıtı ve U1 geçici hata kontrollü verildi. Önceki koşularda test köprüsü kurulumu, dar ekran ızgarası, ağ taşıma biçimi ve bekleme koşullarındaki sorunlar ayrı günlüklerde duruyor. Son koşu çıkış kodu 0.

U3 için içerik yazma ve Rules kodu aynı kaldı. Rehber yeni görevdeki metin, geçmiş kararın sabit sürümü, yeniden kontrol düğmesi ve sürümün evrak sayısına etkisini açıklıyor.
