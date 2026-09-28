# Faz 2 · Kapanış Walkthrough (Tur 1 · Tur 2 · Tur 2.5 · Tur 3)

> **Tarih:** 28.09.2026 · **Branch:** `fix/phase-2-critical-flows` → `master` (`--no-ff`, bu rapor commit'inden hemen sonra)
> **Firebase:** `medipol-inventory-v3` · tüm yazma testleri yalnız `inventory_demo` · canlı koleksiyonlara (`inventory_v2`, kök `system_config`) dokunulmadı · VIP komutları (kill switch / force logout / mesaj) yazılmadı (kural 7.5)
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Tur 1–2.5'in admin oturumu gerektiren akışları sahibi tarafından sahada doğrulandı; Tur 3'ün admin adımları aşağıdaki listeyle elle doğrulanmalı.

## 1. Özet
| Tur | Kapsam | Commit | Kapatılan bulgular |
|---|---|---|---|
| Tur 1 (C1–C6) | ITSM talep akışı, envanter kart/kayıt, EBYS modal, XSS | 6 + 1 doküman | ITSM-01, ITSM-03, DATA-03, INV-03, DATA-04, INV-09, EBYS-01, EBYS-02, SEC-01 |
| Tur 2 (D1–D5) | EBYS geçişi, admin talep işlemleri, ortam ayrımı, zimmet, ürün türleri | 5 + 1 doküman | EBYS-16, SEC-04, ITSM-05, RULE-04, VIP-05, ZIM-01, ZIM-02, ZIM-03, ITSM-06, ADM-02, ADM-03 |
| Tur 2.5 (E1–E7) | Saha testi hotfix'leri | 7 + 1 test | ITSM-08 (K7-a), EBYS-15 + 5 saha bulgusu (aşağıda) |
| Tur 3 (F1–F8) | VIP güvenliği, mahal, EBYS eksikleri, tehlikeli ölü kod | 9 + 2 test | VIP-01, VIP-02, VIP-03 (K8-b), VIP-04, VIP-06, VIP-10 (K9-a), ADM-04, EBYS-06, EBYS-09, EBYS-13, DATA-10 |

**Toplam:** 27 kod commit'i + 3 ayrı test commit'i (E1–E3 testleri kendi commit'lerinde) + 3 doküman commit'i (bu rapor dahil) = 33; **33 katalog bulgusu** kapatıldı ve **5 saha bulgusu** giderildi.

## 2. Commit'ler

### Tur 1 — C1–C6 (ayrıntı: `Faz 2 Tur 1 Walkthrough.md`)
| Hash | Madde | Özet |
|---|---|---|
| `5f3bd63` | C1 · ITSM-01 | `saveRequest` yeniden yazıldı (ESM geçişinde kaybolmuştu) |
| `209610b` | C2 · ITSM-03 / DATA-03 | Personel talep işlemleri yalnız `requests` yazar |
| `398e41b` | C3 · INV-03 | Kart görünümü mobil/TV + çalışan görünüm düğmesi |
| `113b298` | C4 · DATA-04 (+INV-09) | `saveProduct` düzenlemede id, alanlar ve durumu korur |
| `b7c4c09` | C5 · EBYS-01 ⇄ EBYS-02 | Tek satın alma modalı kaynağı + adım sahibi kontrolü |
| `aeca218` | C6 · SEC-01 | `escapeHtml` / `safeUrl` / `jsArg`; anonim-yazılabilir tüm render'lar |
| `b87579c` | doküman | Tur 1 walkthrough |

### Tur 2 — D1–D5 (ayrıntı: `Faz 2 Tur 2 Walkthrough.md`)
| Hash | Madde | Özet |
|---|---|---|
| `56257b0` | D1 · EBYS-16 / SEC-04 | Akış yalnız `purchaseOrders` içinde; kök `workflows` ve ipify kaldırıldı |
| `4e3e31d` | D2 · ITSM-05 | Admin onay/red/sil id ile, kilitli, İptal = iptal |
| `6b59258` | D3 · RULE-04 / VIP-05 | `system_config` → `${ROOT}/system_config/items/*` |
| `6225b97` | D4 · ZIM-01/02/03 (+ITSM-06) | Atomik, id tabanlı zimmet ve iade |
| `f5ac94a` | D5 · ADM-02 / ADM-03 | Ürün türleri `${ROOT}/productTypes/items` + kapanan modal |
| `2cba6b0` | doküman | Tur 2 walkthrough |

### Tur 2.5 — saha testi hotfix'leri (E1–E7)
| Hash | Madde | Özet |
|---|---|---|
| `51ff835` | E1 · ITSM-08 (K7-a) | Talep onayında SN + B1/B2 stok kalemi seçimi; atomik düşüm; b3 kaydı ürüne bağlı (iade stoğa döner); hata olursa geri alma. `runStockTransaction` önceki/sonraki adedi döndürür, mesajlarda "stok X → Y" |
| `b8f032c` | E2 · EBYS-15 | Birim yönetimi: tek durum nesnesi, çalışan personel araması, id ile düzenle/sil, iki sayfada tek (enjekte) modal |
| `5ef3cb1` | E3 · saha | Satın alma "Belge / Ürün Türü" `productTypes`'tan canlı beslenir; boşken yönlendirir |
| `fe1af05` | E4 · saha | B3 tablosu iki b3 şemasını da okur (`normalizeB3Row`) |
| `18b2c0d` | E5 · saha | Çıkış formunda Raf No otomatik dolar |
| `49c853a` | E6 · saha | "Taleplerim"de Teslim Alım Tarihi sütunu |
| `c1b1780` | E7 · saha | Birim ve talep onay pencereleri dark temaya uyumlu |
| `b61b448` | test | Tur 2.5 revizyon senaryosu |

### Tur 3 — son temizlik (F1–F8)
| Hash | Madde | Özet |
|---|---|---|
| `2a688cd` | F1 · VIP-01 / VIP-02 (K10-a) | Tekerrür temizleyici: yalnız B1/B2 (b3 hariç); "N/A", "--", "bilinmiyor" vb. yer tutucu SN'ler boş sayılır; önizlemeli onay; onaydan **sonra** güncel diziden yeniden hesap; yalnız önizlenen **ve** hâlâ kopya olan kayıtlar id ile silinir; admin oturumu, kilit, doğru hata mesajı |
| `8934b07` | F1 düzeltme | Önizleme düz metin (etkin onay kutusu `textContent` kullanıyor; HTML tablo ham etiket olarak görünürdü) |
| `be73022` | F2 · VIP-04 ⇄ VIP-06 ⇄ VIP-03 (K8-b) | Kanca `window._initVipPanel()` çağırır; force logout `{targetId, issuedAt, nonce}` — taze (10 dk), tarayıcı başına bir kez, admin oturumu bağışık, kendini hedefleme reddi, eski düz alanlar silinir/yok sayılır; sahte 15 sn log'u kaldırıldı; God-Eye, radar ve aktivite paneli **DEMO** etiketli, rastgele değerler kaldırıldı, DEMO hedefe force logout reddedilir |
| `541f26d` | F3 · ADM-04 | Mahal id ile bulunur; rozetler listeden çizilir (kişi çıkarınca hepsi silinmiyor); `{...mevcut, ...form}` birleştirme, sonuç kontrolü; arama sonucunda birim adı kaçışlı |
| `40c34da` | F4 · EBYS-06 | Talep eden her zaman `getActiveUser()`; sabit "Muhammed CER" yedeğini içeren ölü `initEBYSModal` / `fillEBYSSelects` kaldırıldı |
| `fc53291` | F5 · EBYS-09 | Yazılan onaylayıcı state'e anında yazılır; boş veya personel listesinde olmayan onaylayıcıyla başlatma reddedilir; şablon modunda ekrandaki adımlar kullanılır; başlatma kaydı kontrol edilir |
| `c0bbeb1` | F6 · EBYS-13 | Aktif durumlardan `suspended`'a geçiş; `stopWorkflow` yalnız admin, onaylı, tek kayıt; durdurulan akışta adım sahibi işlem yapamaz; "Akışı Başlat" ile yeniden başlatılır (geçmiş korunur) |
| `aa08328` | F7 · DATA-10 (K12'ye kadar) | Talepleri kalıcı olarak kaybettirebilecek, çağrılmayan `archiveOldRequests` kaldırıldı |
| `d022c0c` | F8 · VIP-10 (K9-a) | `toggleLaunchpadGlobal`, VIP launchpad butonu, firebase-handler launchpad dinleyicisi (yerel kopya temizlenir), no-op görünürlük fonksiyonu ve ölü `launchpadBypassed` bayrağı kaldırıldı |
| `879f670` · `9b5998d` | test | `ebysStartStop`, `tur3AdminPanel` (gerçek onay kutusu dahil) |

## 3. Maskeleme çiftleri (Plan §6 — aynı commit'te ele alındı)
| Commit | Çift |
|---|---|
| `b7c4c09` | EBYS-01 ⇄ EBYS-02 |
| `56257b0` | EBYS-16 ⇄ onay sonrası snapshot yarışı |
| `4e3e31d` | ITSM-05 ⇄ self-approval sarmalayıcısı (indeks → id) |
| `6225b97` | ZIM-01/02/03 ⇄ ITSM-06 ikiz sayımı |
| `f5ac94a` | ADM-02 ⇄ `syncProductTypesToProducts` kaydetmeme |
| `be73022` | VIP-04 (panel ulaşılır) ⇄ VIP-06 (force logout döngüsü) ⇄ VIP-03 (sahte hedefler) |
| `fc53291` | EBYS-09 doğrulaması ⇄ şablon modunda yok sayılan ekran adımları (yanlış liste doğrulanmasın) |
| `c0bbeb1` | EBYS-13 durdurma ⇄ adım sahibi kontrolü (durdurulmuş akış onaylanmasın) |
| `51ff835` | ITSM-08 stok düşümü ⇄ iade akışı (talepten doğan zimmet artık stoğa bağlı, iade stoğa döner) |

## 4. Kanıt

### Otomatik akış testleri — `scratch/flow-tests.js` (12 senaryo, gerçek Firestore, `inventory_demo`)
Etiketli kayıtlar koşudan önce ve sonra silinir. Admin-only koleksiyonlara (b1/b2/b3/units/locations/system_config) anonim oturum yazamadığı için bu yazmalar kayıtlı stub'larla, `requests` / `purchaseOrders` gerçek yazmayla test edilir.

| Senaryo | Doğrulanan |
|---|---|
| `saveRequest`, `staffRequestActions` | Tur 1 ITSM akışları |
| `ebysApprovalGuard` | Stub'sız gerçek geçiş, adım sahibi, çift tık, ipify yok |
| `adminRequestActions` | Onay/red/sil id ile, İptal, çift tık, self-approval |
| `requestApprovalStock` | Ön seçim, yetersiz stok devre dışı, iptal, stok dışı onay, b3 hatasında onay+stok geri alma, transaction reddi |
| `unitManagement` | İki sayfada ekle / ara-seç / düzenle (tekrar yok) / sil |
| `purchaseTypeSelect` | Canlı tür listesi, seçim korunur, gerçek kayıtta `tur`; talep eden = aktif kullanıcı (form alanı "Muhammed CER" olsa bile) |
| `tur25Revisions` | B3 iki şema, Raf No, Teslim Alım Tarihi, dark tema renkleri |
| `ebysStartStop` | Boş/bilinmeyen onaylayıcı reddi, şablonda ekran adımları, admin dışı durdurma reddi, askıya alma, askıdayken onay yok, yeniden başlatma |
| `tur3AdminPanel` | Force logout alıcısı (bir kez / bayat / başka kullanıcı / admin bağışık / eski alan yok); temizleyici (gerçek onay kutusu metin, Vazgeç = yazma yok, B1:2·B2:1 önizleme, b3 hariç, yer tutucular birleşmez, onay sırasında silinen atlandı · eklenen silinmedi, çift tık tek koşu, yetki hatası doğru mesaj); VIP zinciri + DEMO etiketleri + DEMO/kendini hedefleme reddi + 16 sn'de 0 sahte log; launchpad yok; mahal id ile |
| `systemConfigScope` | Yollar `inventory_demo/system_config/items/*`, personel yazamaz |
| `xssAdminPanel` | **Tur 1 öncesi 27 çalışma + onclick id enjeksiyonu → 0 ve 0** |

Son tam koşu: **12/12**, `pageerror` 0, test artığı 0.

### Sistem sağlık metrikleri (`scratch/smoke-test.js`)
| Ölçüm | Faz 0 başlangıç (`baseline`) | Faz 2 kapanış (`p2-closing`) |
|---|---|---|
| index — pageerror / console.error | 0 / 0 | 0 / 0 |
| index — "Veri Çekildi" | 13 | 13 |
| index — çift yüklenen modül logu | 5 | **0** |
| index — iki URL'den yüklenen modül | 6 | **0** |
| admin — pageerror / console.error | 0 / 1 | 0 / 1 (yalnız `/favicon.ico` 404) |
| admin — "Veri Çekildi" | 26 (çift dinleyici) | **13** |
| admin — iki URL'den yüklenen modül | 1 | **0** |

### `inventory_demo` veri durumu
Her turdan sonra tüm koleksiyonlar okunup karşılaştırıldı: test kaydı kalmadı; sahibinin saha test verileri testlerden etkilenmedi.

## 5. Davranış değişiklikleri (kullanıcıya görünür)
- Talep onayı artık SN ile birlikte stok kalemi sorar ve stoğu düşer; "Stoktan düşmeden onayla" bilinçli seçimdir.
- Tekerrür temizleyici yalnız B1/B2'yi tarar, silmeden önce listeyi gösterir.
- God-Eye radarı ve kullanıcı aktivite paneli **DEMO**'dur (gerçek presence yok, K8-a orta vade). Arayüzden gerçek kullanıcıya force logout uygulanamaz (yalnız DEMO hedefler var); alıcı tarafı yeni komut biçimine hazırdır.
- Satın almada talep eden her zaman oturumdaki kişidir.
- Akış başlatırken her adımın onaylayıcısı personel listesinden olmalıdır; "Durdur" akışı askıya alır ("Durduruldu").
- VIP'teki "Launchpad: Askıda" butonu kaldırıldı.

## 6. Sahibinin elle doğrulaması (Tur 3, admin oturumu)
1. **VIP → Tekerrürleri Temizle:** önizleme listesi okunur; Vazgeç hiçbir şey silmez; `inventory_demo`'da bilinçli oluşturulan bir kopya Onayla ile silinir, diğer kayıtlar yerinde kalır.
2. **VIP paneli:** radar noktasına tıklayınca panel açılır, "· DEMO" görünür; Force Logout "DEMO radar noktası…" diyerek reddeder; terminale sahte God-Eye logu düşmez.
3. **Tanımlar → Mahal:** mevcut mahali düzenle (form dolu açılır), bir kişiyi çıkar (diğer rozetler kalır), kaydet.
4. **Satın alma:** yeni talepte "Talep Eden" oturumdaki kişi; akışı boş onaylayıcıyla başlatmayı dene (reddedilir); listeden seçerek başlat; admin tablosunda Durdur → "Durduruldu"; sıradaki kişi onaylayamaz; "Akışı Başlat" ile yeniden başlar.

## 7. Açık kalanlar (Faz 2 planında olup bu dalda ele alınmayanlar)
> **Karar (28.09.2026, sahibi):** Bu maddeler Faz 3 — Veri Katmanı Sağlamlaştırma'nın (saveData v2, tek-doküman API, atomik işlemler) doğal parçası olduğu için Faz 2 burada **kesin olarak kapatıldı**. Aşağıdakiler Faz 3'ün ilk önceliğidir.

Bu maddeler Tur 3 kapsamı dışında bırakıldı ve master'a açık olarak geçti:

| Bulgu | Plan | Durum |
|---|---|---|
| ITSM-07 | 2.1 | Personel ekle/düzenle hâlâ tam kayıt (`saveData(data)`), düzenleme id/alan kaybediyor |
| INV-02 (kalan) / DATA-06 | 2.2 | Çıkış (`saveExit`) ürünü hâlâ dizi indeksiyle çözüyor |
| INV-04 | 2.2 | Sepet çıkışı (`saveCartExit`) istemci tarafı stok + tam `saveData(window.data)` |
| DATA-01 (kısmi) | 2.2 / Faz 3 | FAB / Bottom Sheet / `deleteItem` / `toggleWatch` / toplu silme indeks tabanlı; `saveData` koleksiyonun tamamını yazıyor |
| EBYS-12 | 2.3 | Geri çek/iptal yetkisi (yalnız sahibi veya admin) |
| DATA-14 | 2.3 | `viewWorkflow` her açılışta kaydediyor; göç admin'e sınırlı değil |
| EBYS-14 | 2.3 | Başarısız dosya yüklemesinde sahte ek |
| ADM-07 | 2.4 | `bulkAddB2Items` / `deleteCriticalGroup` tam kayıt + indeks |
| VIP-07 | 2.5 | Kill switch buton durumu yüklemede okunmuyor |
| TODO-04 | 2.8 | Eksik alanlı TODO kartı |
| Kural savunma derinliği | 2.8 | Anonim-yazılabilir koleksiyonlarda `<` reddi (Emulator gerekli) |
| b3 kanonik şema | Faz 3 | İki b3 şeması sürüyor; E4 okuyucuyu birleştirdi, admin pano grafikleri yeni kayıtlarda türü ürün adı olarak görüyor |
| VIP-03 (orta vade) | K8-a | Gerçek presence/heartbeat |

## 8. Süreç notları
- **Karakter kodlaması (OPS-03 / VIP-09):** tüm düzenlemeler UTF-8 ve satır sonu (CRLF/LF) korunarak Node/Edit ile yapıldı; PowerShell `Set-Content` kullanılmadı. Git Bash'in `//` ile başlayan argümanları `/`'a çevirmesi iki kez yorum satırı bozdu; ikisi de sözdizimi kontrolünde yakalanıp düzeltildi, commit'lere girmedi.
- **Test boşluğu dersi:** F1'in ilk testi onay kutusunu stub'ladığı için önizlemenin ekranda ham HTML olarak görüneceğini yakalamadı; senaryo artık gerçek onay kutusunu da sürüyor.
- `master`'a merge: `git merge --no-ff fix/phase-2-critical-flows -m "feat(phase-2): complete critical flow repairs (ITSM, Inventory, EBYS, Admin, VIP)"` → `8269197`.

## 9. Kapanış sonrası saha hotfix'leri (G1–G4)
Merge'ten (`8269197`) sonra sahibinin saha testinde bulunan dört madde `fix/ebys-dark-mode-and-status` dalında düzeltildi; dal `master`'a ayrıca `--no-ff` ile merge edildi.

| Hash | Madde | Özet |
|---|---|---|
| `53ee3ec` | G1 · mevcut şablon görünmüyordu | `workflowTemplates` dinleyicisi oturum açılmadan kaydoluyor, `permission-denied` alıp kalıcı olarak kapanıyordu. Mevcut şablonlar ne "Akışı Başlat" listesinde ne "Tanımlar > İş Akışları"nda görünüyordu. Dinleyici artık `window.userAuth`'u bekliyor. |
| `12d20a2` | G2 · adım durumu | Reddedilen akışta önceki **onaylı** adımlar da kırmızı gösteriliyordu. Artık yalnız `status === 'rejected'` kırmızı; sırası gelmeyen adımlar "Değerlendirilmedi". Adım rozetinin arka planı ile yazısı aynı renkti (okunmuyordu); `--badge-*` çiftlerine geçti. |
| `ea55f6a` | G3 · dark mode | "İş Akışı Seçimi" modalında tema sınıflarını ezen satır içi açık renkler kaldırıldı (admin + index). |
| `a8fd395` | G4 · dark mode | Satın alma "Süreç Geçmişi" sabit hex renklerden tema değişkenlerine geçti. |
| `7d51ad1` | test | `ebysWorkflowDisplay` senaryosu; tam suite **13/13**, smoke temiz. |
| `13c4946` | yerel | Sahibinin bekleyen metin düzeltmesi (`inventory-management.js`). |

Not: G1'den sonra bir şablon, "Yetkili Kullanıcılar" listesinde olmayan kullanıcıya (ör. Admin) `checkTemplateAuth` gereği gösterilmez; bu tasarım gereğidir.
