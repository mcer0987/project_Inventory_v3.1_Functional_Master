# Faz 3 · Tur H1 Walkthrough (saveData v2, makeId, dinleyici yönetimi)

> **Tarih:** 28.09.2026 · **Branch:** `refactor/phase-3-data-layer` (master `522874d`'den; henüz merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** `medipol-inventory-v3` · testler yalnız `inventory_demo` · canlı kök `lifeserver_master`'a ve eski `inventory_v2`'ye dokunulmadı
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Admin yazmaları (b1/b2/b3, toplu silme) sahibi tarafından elle doğrulanmalı.

## Kararlar (sahibi, 28.09.2026)
| # | Karar |
|---|---|
| 1 | `strict` H1–H2 boyunca isteğe bağlı; H2 sonunda varsayılan |
| 2 | Toplu silme kilidi: bir çağrıda bir koleksiyondan >1 **ve** (>5 kayıt **veya** >%20) silme → `allowBulkDelete` olmadan hiçbir şey yazılmaz |
| 3 | Sarf çıkışı Faz 4'e kadar yalnız admin; personele yetkisiz işlem uyarısı (H3'te uygulanacak) |
| 4 | Canlı şema göçünü sahibi çalıştırır; testler `inventory_demo` |
| 5 | Emulator yok; akış testleri + stub'lar + sahada elle doğrulama |

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `094864f` | 3.3 · DATA-12 | `src/utils/schema.js` → `makeId()`: sayısal, sekme içinde kesin artan, güvenli tamsayı. UUID bilinçli olarak değil (kodda `Number(x.id) === Number(id)` ve `b.id - a.id` var; H2'de String karşılaştırmaya geçince değerlendirilir). Sepet çıkışının ondalıklı id'si ilk kullanıcı |
| `888260c` | 3.8 · DATA-11, EBYS-18, DATA-13 | Tek `COLLECTIONS` sabiti; `registerSyncListener` (şablon dinleyicisi artık senkron motorunun parçası: oturumla başlar, çıkışta kapanır, yeniden girişte döner — G1 yamasının yerini aldı); `stopRealtimeSync`; `whenAuthReady()` + `onAuthReady` olayı; oturum açıkken gelen izin reddi ekranda "Veri bağlantısı yetkisi yok" bandı ve admin'de "YETKİ YOK"; `SecurityConfig.logout` dinleyicileri signOut'tan önce kapatır |
| `abff71a` | 3.1 · DATA-01/02/13 | `saveData` v2 (aşağıda) + toplu silme kilidi + kullanıcı onaylı 5 toplu işlemin bayrağı |
| `42cc8f3` | test | `saveDataV2` senaryosu |

## saveData v2
- **Aynı çağrı biçimleri** (`saveData('col', dizi)`, `saveData(window.data)`); üçüncü/ikinci argüman `opts`.
- Her doküman Firestore'daki son kopyayla (anahtar sırasından bağımsız JSON) karşılaştırılır; **yalnız yeni/değişen** yazılır, dizide olmayan silinir.
- Dönüş: `{written, deleted, unchanged, collections}` (truthy). Mevcut 13 `=== false` kontrolü aynen çalışır.
- Hata kodları: `no-auth`, `unknown-collection`, `invalid-argument`, `write-failed`, `bulk-delete-blocked`. Varsayılan `false` döner; `{strict:true}` → `SaveDataError` fırlatır.
- Başarılı yazmadan sonra mirror güncellenir: snapshot gelmeden ikinci kayıt tekrar yazmaz, yeni eklenen kayıt "silinmiş" sayılmaz.

**Maskeleme çifti (aynı commit):** Yazma yalnız değişene inince tek tehlikeli davranış silme kalır — tüm dizi yerine alt küme gönderen bir çağıran geri kalan her şeyi siler. Toplu silme kilidi bunu kapatır. Bilinçli toplu işlemler (`allowBulkDelete`): FAB toplu silme (iki kopya), seçili talepleri sil, kritik stok grubu sil, yedekten geri yükleme (artık başarısız kayıtta "geri yüklendi" demiyor).

**Kota etkisi:** Tek kayıt düzenleme artık 1 doküman yazıyor (önce: koleksiyonun tamamı; `saveData(window.data)` çağrılarında tüm veritabanı).

## Kanıt
**`scratch/flow-tests.js` · `saveDataV2`** (gerçek, etiketli `requests` yazmaları; sunucudan geri okundu):
| Kontrol | Sonuç |
|---|---|
| 5 yeni kayıt / snapshot öncesi tekrar kayıt | 5 yazıldı / 0 ✔ |
| 1 kayıt düzenleme | **1 yazıldı**, 6 değişmedi ✔ |
| Değişiklik yok | 0 yazma ✔ |
| Tek silme | serbest ✔ |
| 3 kayıt silme (bayraksız) | engellendi, sunucuda 4→4, uyarı gösterildi; strict'te `SaveDataError(bulk-delete-blocked)` ✔ |
| Aynı silme `allowBulkDelete` ile | 3 silindi ✔ |
| Bilinmeyen koleksiyon / oturumsuz | `false`; strict'te `unknown-collection` / `no-auth` ✔ |
| `makeId` × 5000 | tekil, kesin artan, güvenli tamsayı ✔ |
| Dinleyiciler | şablon dinleyicisi yönetiliyor; `whenAuthReady` çözülüyor; stop/start şablonları yeniden yüklüyor; izin bandı çıkıyor ve kalkıyor; oturumsuz reddi yok sayılıyor ✔ |
| Çıkış → anonim yeniden giriş (index) | yeni oturum, 13 koleksiyon yeniden yüklendi, bant yok, şablonlar geri geldi ✔ |

Tam suite **14/14**, `pageerror` 0 · smoke `p3-h1`: index/admin `pageerror` 0, "Veri Çekildi" 13/13 · `inventory_demo` test artığı 0.

## Sahibinin elle doğrulaması (localhost, admin)
1. Bir ürünü düzenle → konsolda `saveData(b1): 1 yazıldı · … değişmedi`.
2. B1'de 6+ ürün seçip toplu sil (onayla) → silinir; FAB olmadan başka bir yoldan çok kayıt silinmeye çalışılırsa "Güvenlik kilidi" uyarısı.
3. Çıkış yap → tekrar gir: "İş Akışı Seçimi"nde şablonlar görünür, "YETKİ YOK" bandı çıkmaz.

## Bilinen / H2'ye
- 19 `saveData(window.data)` çağrısı hâlâ tüm koleksiyonları **karşılaştırıyor** (artık yalnız değişeni yazıyor); H2'de hedefli tek-doküman API'ye taşınacak.
- `strict` henüz hiçbir çağıranda açık değil (karar 1).
- İndeks tabanlı işlemler (17 handler, 22 okuma) H2 kapsamı.
