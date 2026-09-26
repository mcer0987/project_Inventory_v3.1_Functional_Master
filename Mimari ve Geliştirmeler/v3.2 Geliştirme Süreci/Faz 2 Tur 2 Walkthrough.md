# Faz 2 · Tur 2 Walkthrough (D1–D5)

> **Tarih:** 26.09.2026 · **Branch:** `fix/phase-2-critical-flows` (Tur 1 + Tur 2; henüz merge edilmedi)
> **Firebase:** `medipol-inventory-v3` · yazma testleri yalnız `inventory_demo` · VIP aksiyonları (kill switch / force logout / mesaj) tetiklenmedi (kural 7.5)
> **Durum (§7.2):** Uygulandı + doğrulandı (gerçek Firestore akış testleri; admin yazmaları için stub'lı tarayıcı probları). Admin oturumu gerektiren adımlar sahibi tarafından elle doğrulanmalı (aşağıda liste).

## Plan ve maskeleme çiftleri
| # | Kapsam | Aynı commit'te ele alınan çift |
|---|---|---|
| D1 | EBYS-16 + SEC-04 | Gerçek geçiş çalışınca ortaya çıkan snapshot yarışı (onay sonrası değişikliklerin kaybı) |
| D2 | ITSM-05 | Self-approval sarmalayıcısı (indeks → id) |
| D3 | RULE-04 / VIP-05 | – (VIP testlerinden **önce**; kalan VIP-03/04/06 çifti Tur 3) |
| D4 | ZIM-01 / 02 / 03 | ITSM-06 ikiz sayımı (talep + requestId'li b3) |
| D5 | ADM-02 / ADM-03 | `syncProductTypesToProducts` kaydetmeme (ADM-02 alt maddesi) |

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `56257b0` | D1 | Akış yalnız `${ROOT}/purchaseOrders` içindeki `workflow`; kök `workflows` ve ipify kaldırıldı; approve/reject `persist:false` + tek kayıt |
| `4e3e31d` | D2 | Admin onay/red/sil id ile; yalnız bekleyen (taslak olmayan) talep; kilit; İptal = iptal; approvedBy/At; tek b3 kaydı (`requestId`) |
| `6b59258` | D3 | `systemConfigRef(name)` → `${ROOT}/system_config/items/{admin_settings|admin_messages}` (2 dinleyici + 3 yazıcı) |
| `6225b97` | D4 | Zimmet atama/iade: id ile ürün, doğrulama + birleştirme, atomik stok + geri alma, üç seçenekli iade, assignments güncellemesi |
| `f5ac94a` | D5 | Ürün türü CRUD `${ROOT}/productTypes/items` + açık id; kök dinleyiciler kaldırıldı; `closeProductTypeModal`; ölü editRequest özelliği silindi; snapshot'ta id yedeği |

## Kanıt
**`scratch/flow-tests.js`** (gerçek Firestore, `inventory_demo`, etiketli kayıtlar temizlendi):
| Senaryo | Sonuç |
|---|---|
| `ebysApprovalGuard` (stub'sız gerçek geçiş) | 2 adım → `completed`, 2 onay + 2 geçiş kaydı, IP saklanmadı, ipify isteği yok |
| `adminRequestActions` | İptal onaylamıyor ✔ · çift tık tek onay + tek b3 denemesi ✔ · ikinci onay/taslak reddi ✔ · self-approval engeli ✔ · red/sil id ile ✔ |
| `systemConfigScope` | yollar `inventory_demo/system_config/items/*` ✔ · okuma izinli ✔ · personel yazması reddedildi ✔ |
| Tur 1 senaryoları | hepsi geçiyor (regresyon yok) |

**Tarayıcı probları (admin.html, stub'lı — Firestore'a yazmaz):**
- D4: aynı ürün iki satır → tek `-3` işlemi · stok aşımı / 0 adet reddi · işlem veya b3 kaydı başarısızsa stok geri alındı · çift tık tek kayıt · iade `+2` doğru ürüne, planlanan iade tarihi korunur · Vazgeç hiçbir şey yapmaz · talep ikizi tek sayılır ve stok sorusu çıkmaz.
- D5: ekle/güncelle/sil yolları `inventory_demo/productTypes/items/…` · mükerrer ad engeli · ad değişince B1 ürünleri kaydedilir · modal kapanıyor.

**Smoke test:** her commit'te pageerror 0, "Veri Çekildi" 13/13.

## Sahibinin elle doğrulaması (admin oturumu)
1. Satın alma: şablonla akış başlat → sıradaki kişi olarak onayla → son adımda "Onaylandı".
2. Talep onayı: SN iste → İptal (talep bekler) → tekrar Onayla → b3'te tek zimmet kaydı.
3. Zimmet: B1'den demirbaş ata (stok düşer) → iade → B1 (stok geri gelir).
4. Ürün türü: ekle / yeniden adlandır (ürünlerdeki tür adı değişir) / sil; düzenleme modalı kapanır.

## Bilinen / Tur 3 adayları
- VIP: `vipCleanDuplicates` (VIP-01/02), VIP-04 ⇄ VIP-06 ⇄ VIP-03 çifti, kill switch buton durumu (VIP-07).
- Admin: mahal (ADM-04), birim yönetimi (EBYS-15), `bulkAddB2Items`/`deleteCriticalGroup` (ADM-07).
- EBYS: talep eden kimliği (EBYS-06), boş onaylayıcı (EBYS-09), geri çek yetkisi (EBYS-12), durdur (EBYS-13), sahte ek (EBYS-14).
- Tehlikeli ölü kod (2.7): `archiveOldRequests`, launchpad kalıntıları.
- Kurallar: kullanılmayan kök `/system_config` bloğu kaldırılabilir (Faz 4).
