# Faz 2 · Tur 1 Walkthrough (C1–C6)

> **Tarih:** 26.09.2026 · **Branch:** `fix/phase-2-critical-flows` (master'dan; henüz merge edilmedi)
> **Firebase:** `medipol-inventory-v3` · testler yalnız `inventory_demo` · canlı koleksiyonlara dokunulmadı
> **Durum (§7.2):** Uygulandı + otomatik testlerle doğrulandı. Admin oturumu gerektiren yazma akışları (ürün kaydı, admin onayı) sahibi tarafından elle doğrulanmalı.

## Commit'ler
| Hash | Madde | Özet |
|---|---|---|
| `5f3bd63` | C1 · ITSM-01 | `saveRequest` yeniden yazıldı; doğrulama, ITSM alanları, id ile düzenleme, yalnız `requests` |
| `209610b` | C2 · ITSM-03 / DATA-03 | Geri çek / taslak gönder / teslim aldım yalnız `requests` yazar; teslim aldım `b3`'e yazmaz |
| `398e41b` | C3 · INV-03 | Kart görünümü: `_cardViewActive` başlatma, matchMedia ile mobil/TV oto-kart, `.force-table-view` toggle |
| `113b298` | C4 · DATA-04 (+INV-09) | `saveProduct` id ile birleştirir; limit/takip/B2 status korunur; listede olmayan durum değerleri silinmez; `saveData` true/false döner |
| `b7c4c09` | C5 · EBYS-01 ⇄ EBYS-02 | Satın alma modalı tek kaynak + tam sıfırlama; adım sahibi / admin kontrolü; çift tıklama kilidi |
| `aeca218` | C6 · SEC-01 | `src/utils/html.js` (`escapeHtml`, `safeUrl`, `jsArg`); anonim-yazılabilir tüm render'lar, alert/confirm metin olarak |

## Kanıt
**`scratch/flow-tests.js`** (gerçek Firestore, `inventory_demo`, etiketli kayıtlar önce/sonra silinir):
| Senaryo | Sonuç |
|---|---|
| `saveRequest` | oluşturma ✔ · tüm ITSM alanları ✔ · id ile düzenleme aynı doküman ✔ · iade tarihsiz geçici zimmet reddi ✔ |
| `staffRequestActions` (anonim) | draft ✔ · Beklemede ✔ · completed ✔ · b3 dokunulmadı ✔ |
| `ebysApprovalGuard` | bayat Onayla temizlendi ✔ · yanlış kişi reddedildi ✔ · sahibi (normalize ad) onayladı ✔ · çift tıklamada tek adım ✔ |
| `xssAdminPanel` | **Önce (b7c4c09): 27 çalışma + onclick id enjeksiyonu. Sonra: 0 ve 0**, yük metin olarak görünüyor |

**Tarayıcı probları (bellek içi, yazmasız):** C3 kart/tablo 390·1440·2600 px ✔; C4 `saveProduct` birleştirme, B2 `status: Aktif` korunumu, başarısız kayıtta modal açık kalıyor ✔.

**Smoke test:** her commit'te index/admin `pageerror` 0, "Veri Çekildi" 13/13, çift yükleme 0.

## Davranış değişiklikleri
- "Teslim Aldım" artık zimmet kaydı oluşturmaz (personel b3'e yazamaz); zimmeti admin onayı (`confirmRequest`) yazar.
- Satın alma onay/red yalnız sıradaki adımın sahibi veya Firebase admin oturumunda çalışır.
- Uyarı/onay pencereleri HTML değil düz metin gösterir (satır sonları korunur).

## Bilinen / sonraki tur
- `transitionWorkflowState` root `workflows` + ipify kullanıyor (EBYS-16) — testte stub'landı; Faz 2 Tur 2.
- Admin onay/red/sil hâlâ indeks tabanlı (ITSM-05), zimmet (2.6), VIP (2.5), admin CRUD (2.4), EBYS-06/09/12/13/14.
- `saveData` hâlâ koleksiyonun tamamını yazıyor (DATA-01) — Faz 3.
- `cff0f5f` commit'i yanlışlıkla `backup_txt/` silmesini de içeriyor (indekste hazır bekliyordu); geçmiş yeniden yazılmadı.
