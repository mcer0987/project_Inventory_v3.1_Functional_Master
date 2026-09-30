# Faz 3 · Tur H3 Walkthrough (atomik stok işlemleri, stok durum mantığı, personel çıkış kısıtı)

> **Tarih:** 29.09.2026 · **Branch:** `refactor/phase-3-data-layer` (H1–H2'nin üstünde; henüz merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** `medipol-inventory-v3` · testler yalnız `inventory_demo` · canlı `lifeserver_master` ve eski `inventory_v2`'ye dokunulmadı
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. b1/b2/b3 transaction'ları admin oturumu gerektirdiği için gerçek Firestore'da sahibi tarafından elle doğrulanmalı (aşağıda).

## Kapsam
Plan 3.4 (atomik çok adımlı işlemler) + 3.5 (stok durum mantığı) + karar 3 (Faz 4'e kadar stok çıkışı yalnız yönetici). Ek olarak sahibinin küçük talebi: giriş kodunda otomatik odak.

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `5a3bdc4` | 3.4 / 3.5 · DATA-05, DATA-09, INV-07; karar 3 | Çekirdek: `computeStockPatch` (durum mantığı), `planStockOps` (saf hesap), `runStockOps({stock, writes})` (stok + tüm kayıtlar tek Firestore transaction'ı), `runExitTransaction`; `runStockTransaction` aynı çekirdeğe bağlandı; yönetici dışı oturum hiçbir şey göndermeden reddedilir |
| `481c956` | INV-04, DATA-09; karar 3 | Tekil çıkış = tek `runExitTransaction` (telafi yok). Sepet: kalemler ürün id'siyle, tüm stok düşümleri + b3 kayıtları tek transaction, istemci stok hesabı ve tüm veritabanı kaydı kaldırıldı. Personel "Envanter Çıkışı Yap"/sepet açarken net mesaj |
| `244eb33` | 3.4 · DATA-09, EBYS-21 | Zimmet ata (stok + b3 + assignments), iade (stok + b3 + assignments + bağlı talep), talep onayı (stok + talep + b3), servisten dönüş (ürünü geri oluştur/adet ekle + servis kaydını sil) — her biri tek transaction |
| `4224872` | istek | Giriş kodu input'u kullanılabilir olduğu anda odaklanır (modal görünürken ve başka odak yokken) |

## 3.5 — Stok durum kuralları
| Durum (önce) | Stok 0'a düşer | Stok 0'dan çıkar |
|---|---|---|
| `''`, Kullanıma Hazır, Mevcut, Aktif | → **Tükendi** (önceki durum `stokOncekiDurum`'da saklanır) | — |
| Tükendi | — | → saklanan önceki durum (yoksa **Kullanıma Hazır**) |
| Pasif, Hurda, Servis Sürecinde, Sıfır, Eski Cihaz, Alternatif Cihaz, Yedek Parça, diğer her şey | **değişmez** | **değişmez** |

- Durum yalnız kaydın kullandığı alana yazılır (B2 `status`, B1 `durumu`); eski kod her harekette ikisine de yazıp B1 kayıtlarına yabancı `status` alanı ekliyordu.
- `lastUpdate` her stok hareketinde güncellenir.

## 3.4 — Atomik işlemler
`runStockOps` tek bir Firestore transaction'ında: stok dokümanlarını sunucudan okur, yeterliliği **sunucu verisiyle** kontrol eder, stok + durum ve tüm kayıt yazmalarını birlikte işler. Başka bir cihaz aynı anda yazarsa Firestore transaction'ı yeniden dener; stok eksiye düşmez, bir cihazın düşümü diğerini ezmez.

| İşlem | Önce | Şimdi (tek transaction) |
|---|---|---|
| Tekil çıkış | stok transaction → ayrı b3 kaydı → hata olursa "stok geri al" | stok −n + b3 |
| Sepet (INV-04) | indeksle, **istemcide** `adet -= n`, durum zorla "Tükendi", yetersiz kalem sessizce atlanır, **tüm veritabanı** kaydı | tüm kalemlerin stoğu + tüm b3 kayıtları; bir kalem yetmezse hiçbiri, hangi ürün olduğu söylenir |
| Zimmet ata | kalem başına stok transaction'ı → b3 → assignments (ayrı) | tüm kalemlerin stoğu + b3 + assignments (ortak id) |
| Zimmet iade | stok → b3 → assignments → talep (4 ayrı yazma) | stok +n + b3 + assignments + talep |
| Talep onayı (E1) | stok → talep → b3, iki kademe telafi | stok −n + talep + b3 (stok kalemi yoksa talep + b3 atomik batch) |
| Servisten dönüş (EBYS-21) | servis kaydı silinir, ürün yazılamazsa **ürün kaybolur** | ürün geri oluşturulur (veya aynı id'li kayda adet eklenir) + servis kaydı silinir |

Başarısızlıkta kullanıcı "hiçbir değişiklik yapılmadı" mesajını görür; yarım kalan hal yoktur, telafi kodu kaldırıldı.

## Karar 3 — personel stok çıkışı
Faz 4 yetki matrisine kadar tüm stok hareketleri Firebase admin oturumu ister (Firestore kuralları da personele b1/b2/b3 yazdırmıyor). Personel "Envanter Çıkışı Yap" veya sepeti açınca form açılmadan **"Çıkış işlemi yalnızca sistem yöneticisi tarafından yapılabilir."** mesajı çıkar; aynı kontrol kayıtta ve çekirdekte tekrar yapılır.

## Maskeleme çiftleri
| Çift | Nasıl ele alındı |
|---|---|
| 3.4 atomik yol ⇄ 3.5 durum ezme | Yeni yol da eski `runStockTransaction` gibi durumu ezseydi atomiklik "Pasif" ürünü yine "Tükendi" yapardı → ikisi aynı çekirdekte (`computeStockPatch`), aynı commit |
| Servisten dönüşün hepsi-ya-hiç olması ⇄ personelin net hata görmesi | Ürün artık kaybolmuyor; karşılığında personel bu işlemi yapamıyor ve "yalnızca sistem yöneticisi" mesajını görüyor (karar 3) |
| Talep onayında atomik batch ⇄ anonim oturumda b3 yazma reddi | Eskiden talep onaylanıp b3 reddedilince geri alınıyordu; şimdi ikisi tek batch — testler bu yüzden b3 kısmını kaydeden, talep kısmını gerçekten yazan "atomik vekil" kullanıyor |

## Kanıt
Yeni senaryolar (`scratch/flow-tests.js`):
| Senaryo | Doğrulanan |
|---|---|
| `stockCore` | 12 durum vakası (tabloya birebir); plan: aynı ürün birleşir, yetersiz stok ve eksik doküman `SaveDataError`, `createIfMissing`; personel oturumu mesajla reddedilir; **gerçek Firestore'da** b1 içeren (kurallarca reddedilen) bir transaction'daki `requests` kaydı da yazılmaz — atomiklik kanıtı |
| `h3Exits` | personel çıkış modalı ve sepette mesajı görür, modal açılmaz; 3 kalemli sepet (araya kayıt eklenmiş) → tek çağrı, doğru deltalar + 3 b3, tüm veritabanı kaydı yok; başarısız sepet hiçbir şey yazmaz; tekil çıkış tek `runExitTransaction`; yetersiz stok mesajı |
| `h3Assignments` | zimmet ata → 1 çağrı (2 stok, 2 b3, 2 assignments, ortak id); başarısızlıkta hiçbir şey; iade → 1 çağrı (+2; b3/assignments/talep); "iade etmeden kapat" → 1 atomik batch; servisten dönüş → `createIfMissing` + servis kaydı silme tek çağrı, başarısızlıkta kayıt yerinde; eski `runStockTransaction` ve tam kayıt çağrısı yok |
| `requestApprovalStock`, `adminRequestActions` (uyarlandı) | b3 hatası veya yetersiz stokta stok ve talep **hiç değişmez**; onay başına tek çağrı |

Tam suite: **23/23 senaryo, pageerror 0** (test kayıtları: 3 temizlendi) · smoke: **index + admin: pageerror 0, "Veri Çekildi" 13/13** (admin tek console.error = favicon 404, önceki turlarla aynı; `scratch/baseline/2026-09-29T06-14-12_p3-h3`) · `inventory_demo` test artığı: **0** `__flowtest__` kaydı

## Sahibinin elle doğrulaması (localhost, admin)
1. Bir ürünü "Pasif" yap, stoğu 1 iken 1 adet çıkış yap → stok 0, durum **Pasif kalır**.
2. "Kullanıma Hazır" bir üründen tüm stoğu çık → **Tükendi**; FAB "+" ile stok ekle → **Kullanıma Hazır**'a döner.
3. Sepete iki ürün ekle, biri için stoktan fazla adet gir → "Toplu çıkış yapılamadı; hiçbir kalem kaydedilmedi", iki ürünün stoğu da değişmez.
4. Zimmet ata (2 kalem) → iade et (B1) → stoklar önce düşer, sonra geri gelir; Kişi Envanteri'nde kapanır.
5. Bir ürünü servise sevk et → Servis panelinden "Depoya Geri Al" → ürün depoda, servis kaydı yok.
6. Personel oturumunda "Envanter Çıkışı Yap" → "Çıkış işlemi yalnızca sistem yöneticisi tarafından yapılabilir."
7. Sayfayı aç/yenile → giriş kodu kutusuna tıklamadan yazılabiliyor.

## Bilinen / H4'e
- İki cihazda **gerçek** eşzamanlı çıkış testi admin oturumu ister (emulator yok, karar 5): mantık Firestore transaction garantisine dayanıyor; saha testi önerilir (iki sekmede aynı ürüne aynı anda çıkış).
- İç sevk (`confirmTransfer`) stok miktarı değiştirmeden kaydı taşıdığı için H2'deki atomik batch'te kaldı; kısmi adetle sevk (INV-06) Faz 5.
- H4: şema sözleşmesi (`normalizeB3/normalizeStock/normalizeRequest`, tek `isDemirbas`, b3 `tip`), zimmet servisi, VIP'te önizlemeli şema göçü.
