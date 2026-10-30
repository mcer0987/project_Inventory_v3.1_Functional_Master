# KJ-6 — Faz 1: Inline Handler → Event Delegation

Tarih: 30 Ekim 2026 (Europe/Istanbul). Dal: `feat/phase-7-logging-and-ux`.
Başlangıç HEAD: `4f515c37f5d0a4c81eba9dbe78b2dc619b6d0a19`.

Kod uygulandı; aşağıdaki otomatik kontroller geçti. Tam uygulama/Firestore uçtan uca regresyonu yapılmadı. Git index yazımı `.git/index.lock: Permission denied` ile engellendiği için bu çalışma için commit oluşmadı. Başlangıçta bulunan diğer çalışma alanı değişiklikleri korunmuştur.

## Kapsam ve davranış

Mevcut `src/utils/html.js` içindeki `bindActions(container, handlers)` değişmeden kullanıldı. Bu yardımcı `event.target.closest('[data-action]')` ile iç ikon tıklamalarını da çözer; parametreler dönen öğenin `dataset` alanından alınır.

34 aktif HTML olay niteliği kaldırıldı: table-engine 7, admin-dashboard 11, ui-components 16. Ayrıca üç `.onclick` ataması delegasyona taşındı (yükle butonu ve onay/iptal butonları). Yorum içindeki eski kritik stok örneğinin bir inline çağrısı da aynı sözleşmeye uyarlandı; bu örnek çalıştırılmıyor. Bunlar kaynak şablonu sayılarıdır; render edilen ürün sayısıyla çoğalan DOM düğümlerinin sayısı değildir. Proje genelindeki 403 kaydın tamamının dönüşümü bu fazın kapsamı değildir.

Ürün işlemleri güncel sürümde tablo satırına gömülü değildir; satır/kart seçimi ardından `ui-components.js` içindeki FAB ve mobil alt menüde üretilir. Bu nedenle ilgili iki render bloğu da değiştirildi. Artır/azalt, düzenle (`openProductModal('edit', id, depo)`), kopyala, sevk, takip ve silme çağrıları aynı argüman sırasını kullanır. Masaüstünde artır/azalt ve takip seçimi korur; düzenle/kopyala/sevk/sil seçimi temizler. Mobilde bütün tekil işlemlerden sonra alt menü kapanır. Mevcut çağrılara `await` eklenmedi; kapatma sırası korundu. Toplu silmede ID dizisi HTML kaçışlı JSON veri niteliğinden okunur.

Tablo tooltip hover davranışı mouseover/mouseout ile satır sınırında delege edildi; hücreler arasında geçiş tooltip'i yeniden açmaz. Mobil bilgi ikonuna tıklamak satır seçimini değiştirmez. Kart checkbox'ı satır seçimini açmaz. Kart arama render'ında `_cardFabListenerAttached` sıfırlaması kaldırıldı; aynı container üzerinde arama tekrarlarında seçim dinleyicisi birikmez.

Aktif kritik stok `deleteCriticalGroup` ve takip kartları `watchDetail/watchPurchase/watchOrder` daha önce `bindActions` kullanıyordu; mevcut davranışları korundu. İşlevsiz satın alma/bildirim/pasif düğmelerine yeni iş mantığı eklenmedi.

## Güncellenen satırlar

Satırlar çalışma sonundaki dosyalara aittir. Tam üretim kodu farkı `KJ-6-degisiklikler.diff` dosyasındadır; başlangıçta zaten bulunan ui-components konsol-log silme değişikliği bu farktan çıkarılmıştır.

| Dosya | Güncel satırlar | Değişiklik |
|---|---|---|
| `src/ui/table-engine.js` | 45–48, 91 | Tooltip veri niteliği ve inline olayların kaldırılması |
| aynı dosya | 114–120 | Daha fazla yükle delegasyonu |
| aynı dosya | 126–150 | Tbody tooltip ve kart eylem bağlama |
| aynı dosya | 271, 333 | Normal/arama tablosunda bağlama |
| aynı dosya | 384, 413–415, 476, 499 | Checkbox, tekrar bağlama koruması, grup aç/kapat |
| `src/modules/admin/admin-dashboard.js` | 41–53 | Onay/iptal delegasyonu |
| aynı dosya | 247–253, 317–324 | Talep onay/red/sil |
| aynı dosya | 506–511, 540–543, 573–576 | İki ürün türü tablosu; boolean argüman korunur |
| aynı dosya | 955, 962 | Yorum içindeki eski kritik stok örneği |
| aynı dosya | 1815–1817, 1826, 1843, 1846 | Mahal personel araması/rozet çıkarma |
| aynı dosya | 1909–1912, 1949–1952 | Mahal düzenle/sil |
| `src/ui/ui-components.js` | 55–75 | Ortak ürün eylemi bağlama ve kapatma sırası |
| aynı dosya | 786–787 | Mobil tooltip tıklamasını satır seçiminden ayırma |
| aynı dosya | 869–910 | FAB tekil/toplu düğmeler ve delegasyon |
| aynı dosya | 923–951 | Mobil alt menü düğmeleri ve delegasyon |
| `tests/unit/inline-delegation.test.mjs` | tüm dosya | 6 yeni davranış testi |
| `scratch/kj6-delegation-check.cjs` | tüm dosya | Veritabanından bağımsız gerçek Chromium DOM/CSP kontrolü |

## Güvenlik ve doğrulama

Yeni dinamik `data-*` değerleri `escapeHtml` ile kaçırılır; DOM üzerinden atanan dataset değerleri HTML ayrıştırıcısına verilmez. `data-demirbas` açık `=== 'true'` kontrolüyle boolean'a çevrilir. Veri çalıştırılabilir JS dizgesine birleştirilmez.

| Komut | Gözlenen sonuç | Kanıt |
|---|---|---|
| `npm run test:unit` | 259 test, 259 başarılı, 0 hata | `KJ-6-test-unit.txt` |
| `npm run lint:xss` | 50 dosya, 204 sink, 262 şablon, 907 ifade; izinsiz 0 | `KJ-6-lint-xss.txt` |
| `node scratch/kj6-delegation-check.cjs` | PASS, pageErrors=0 | `KJ-6-browser-check.txt` |
| `git diff --check` | Çıkış kodu 0; whitespace hatası yok | Çalışma sırasında terminalde doğrulandı |

Birim testleri masaüstü/mobil argüman ve kapatma sırasını, tek dinleyici/güncel handler kullanımını, özel karakterli toplu ID dizisini, bilinmeyen eylemi, hover sınırlarını ve checkbox davranışını doğrular.

Tarayıcı kontrolü Edge/Chromium üzerinde `script-src 'none'` CSP ile çalıştı. Üretim fonksiyonları AST ile seçilerek gerçek DOM'a yüklendi; servis/modal işlevleri argüman gözlemleyen taklitlerle değiştirildi. İç ikon tıklamaları, onay/iptal sonucunun tekrar açılışta yenilenmesi, talep/tür/mahal çağrıları, mobil kopyalama ve kapatma sırası, kart grup açma, tekrar aramada tek seçim çağrısı ve mobil tooltip'in seçim açmaması doğrulandı. `"`, `'`, `<img onerror=…>`, `&quot;` ve Unicode içeren değerler dataset üzerinden aynen geri geldi; enjekte edilmiş img/handler düğümü veya çalışan payload bulunmadı.

Bu sayfa kontrollü bir DOM fixture'ıdır; Firebase bağlantısı ve gerçek kayıt yazımı içermez. Dolayısıyla pageErrors=0 sonucu tam uygulama smoke baseline'ı ile karşılaştırma veya canlı modal/veritabanı akışının uçtan uca doğrulanması olarak sunulmaz. Başlangıçtaki Chrome başlatma zaman aşımından sonra Edge ile kontrol başarıyla tamamlandı. CSP yapılandırması değiştirilmedi, yayın yapılmadı.
