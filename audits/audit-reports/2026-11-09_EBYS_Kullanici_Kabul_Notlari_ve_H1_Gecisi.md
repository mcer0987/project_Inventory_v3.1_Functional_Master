# Kullanıcı kabul notları ve H1 başlangıç koşulu

9 Kasım 2026. Ana klasör: `C:/Users/med3pol/Documents/project_Inventory`; dal `feat/v3.4-ebys-tamamlama-h0`, HEAD `883da91`. H0/Q0 henüz commit edilmemiştir.

## Kapanış kontrolü

Q0-R1/R2 için son walkthrough, `scratch/ebys-q0-closure-evidence/after-review.json` ve son dosya hash'leri kontrol edildi. İki UI dosyası ve test dosyası kayıtlı hash'lerle aynı. Notun korunması ve gizli defter dinleyicisinin durması kanıtları mevcut. Son kapanış 339/339 birim, 354/354 Rules; kullanıcı da manuel kontrollerin başarılı olduğunu bildirdi. Kullanıcının son mesaja kopyaladığı 332/332 sonucu önceki Q0 teslimidir.

Bu tur tam testler veya gerçek ürün UAT yeniden çalıştırılmadı. Önceki Q0 teslim kontrolündeki R1/R2 açık durumunu son kapanış kanıtları giderir. Aşağıdakiler yeni kullanıcı kabul notlarıdır.

## U1 — Yeniden kontrol düğmesi

Kullanıcı normal açılışta “Durumu yeniden kontrol et” düğmesini görüyor. Süreç ve evrak UI'si bunu başlangıçta `hidden=true` yapıyor. `admin-add-style.css` içindeki `.btn { display: inline-flex; }` görünürlüğü etkileyebilecek bir kaynak; gerçek index/admin stil birleşimiyle doğrulanmalı. Bu tur computed-style testi yapılmadı, kesin kök neden henüz ilan edilmiyor.

Beklenen: ilk açılış ve başarılı kontrolde görünmez/klavye sırasına girmez; geçici kontrol hatasında açıklamayla görünür; başarılı tekrar sonrası kaybolur. Oturum/gerçek yetki kaybı tekrar düğmesiyle aşılmaz. Kapsamlı global CSS değişikliği yerine ilgili bileşeni koruyan düzeltme tercih edilir.

## U2 — KPI yerleşimi

Kullanıcının istediği düzen: EBYS göstergeleri `ebysDocumentRegistry` içinde değil, aynı admin sekmesi içinde onun üstünde kardeş bir özet bloğu olmalı. `kpi-container req-kpi-container` / Envanter talebi özeti örnek alınacak. Mevcut `ebysCount-*` ID'leri tekil korunmalı; yeni panel kopyası veya ikinci sayaç kaynağı oluşturulmamalı. Görünür kısa açıklama, yenileme ve kapsam bilgisi KPI grubuyla ilişkili yerleştirilmeli.

## U3 — İade sonrası sürüm içeriği

Kullanıcı v1 iç yazışmayı oluşturdu, onaycıdan iade etti, yöneticiyle yeni sürüm açıp gövdeyi değiştirdi; yine ilk metni gördüğünü bildiriyor. Hangi kartın/hangi sürümün açıldığı kesin değil.

- Eski sürüme karar verilmiş geçmiş kartında eski metin: beklenen.
- Yeni aktif görevin v2 içeriğinde eski metin: beklenmeyen, kapanmadan H1 uygulaması başlamamalı.
- Yalnız taslak açılması v2'nin dondurulup yeni rotaya gönderildiğini kanıtlamaz. İşlem adımları gerçek form üzerinden ayırt edilmeli.

Kaynakta `reopenDraft` eski içeriği taslağa kopyalıyor, `saveDraft` yeni gövdeyi taslağa yazıyor, `freezeVersion` taslak içeriğinden yeni immutable sürüm oluşturuyor; `readDocument` ana kaydın currentVersionId'sini kullanıyor. Kaynak incelemesi bu kullanıcı oturumunun doğru yazıldığını kanıtlamaz. Form verisi, kayıt/dondurma, süreç/görev versionId ve açılan kartın sürümü birlikte sınanmalı.

Kanıt senaryosu: v1 “İLK METİN A”; A paraf/onay verir, B iade eder; yazar v2 “YENİ METİN B” hazırlar/dondurur ve yeni rota başlatır. Yazarın güncel evrakı ve yeni görevli v2/B görür; geçmiş kararı olan A v1/A görür, sırası yoksa v2'yi göremez. İade eden B'nin iadesi önceki sürüme kalıcı karar erişimi yaratıyormuş gibi beklenti yazılmamalı. Eski sürüm ve digest değişmeden kalmalı.

## U4 — Toplamları yenile davranışı

Veri değişmediyse aynı sayı dönmesi normal. Tek evrakın v1→v2 geçişinde toplam evrak yine 1 olur; durum kartları değişebilir. Buton yalnız KPI sayılarını yeniden okur; evrak yaratmaz, sürüm oluşturmaz ve içerik yenileme düğmesi değildir.

Anlaşılabilirlik iyileştirmesi: “Toplamlar güncel”, son başarılı güncelleme zamanı, yüklenme/hata durumu ve kapsam belirtilecek. Aynı değer döndüğünde de işlem sonucunu kullanıcı görmeli. Kapsam kullanıcı rolü belli olduktan sonra doğru gösterilmeli; her snapshot'ta veya her tuşta otomatik dört toplam sorgusuna dönülmemeli. Yeniden sayımın ek Firestore okuması olduğu teknik raporda kalır, kullanıcı rehberinde kota anlatımı yapılmaz.

## H1 kararı

H1 promptu iki bölüm içerir: önce U1–U4 kabul notları, sonra yedek kapsamı/kurtarma. U3 çözülmez veya kanıtlanamazsa H1 veri kurtarma uygulamasına geçilmez; bulgu ve kalan ihtiyaç raporlanır. U1–U4 kanıtla kapatılırsa aynı görev H1'e devam edebilir. Commit/deploy ve canlı veri işlemi için izin verilmiş değildir.
