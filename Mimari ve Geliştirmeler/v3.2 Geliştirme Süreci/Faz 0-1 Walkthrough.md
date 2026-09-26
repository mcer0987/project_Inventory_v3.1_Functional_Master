# Faz 0–1 Walkthrough

> **Tarih:** 26.09.2026 · **Branch'ler:** `chore/phase-0-safety-net` → `refactor/phase-1-backbone` (master'a henüz merge edilmedi)
> **Durum (§7.2):** Faz 0 ✅ (Console adımları hariç). Faz 1 **uygulandı, smoke + tarayıcı probları ile doğrulandı**. Ek A'nın gerçek giriş gerektiren maddeleri (admin parolası, personel kodu, yazma akışları) sahibi tarafından elle koşulmalı.

## Commit'ler
| Hash | Adım | Özet |
|---|---|---|
| `2e9dd14` | 0.1 | Baseline (master) |
| `edf8ec7` | 0.2b | hosting.ignore sertleştirme (+ dot-klasör içerikleri) |
| `5471433` | 0.5 | Süreç kuralları (execution-protocol §7) + Faz 0 denetim raporu |
| `9751db9` | 0.4 | `scratch/smoke-test.js` + baseline |
| `cbb2ab7` | 1.1 | Tekil modül yüklemesi, `admin-main.js`, `?v=` → `Cache-Control: no-cache` |
| `d02cb5f` | 1.2–1.3 | Session Store + ~25 okuyucu/yazıcı göçü; INV-01⇄INV-02, AUTH-01⇄ZIM-04 aynı commit |
| `3ff89a9` | 1.4 | `isDbAdmin` / `isAppLoggedIn`; personel girişi admin parolası denemiyor; biyometrik bayrak kapalı |
| `c2c7173` | 1.5 | admin.html kimliği |
| `ad16196` | 1.6 | `admin-router.js`; LoadingCoordinator `productTypes`; index router ek rotalar |
| `22ea603` | 1.7 | Logout/relogin, timeout, kilit kartı, dinleyici yeniden başlatma, alert rengi, Güvenlik Raporu butonu |

## Kanıt: smoke-test metrikleri (`scratch/baseline/`)
| Metrik | Baseline | Faz 1 sonu | Hedef |
|---|---|---|---|
| index `pageerror` / `console.error` | 0 / 0 | 0 / 0 | ≤ baseline |
| index çift çalışan modül | 5 | **0** | 0 |
| index iki URL'li modül | 6 | **0** | 0 |
| admin "📥 Veri Çekildi" | 26 | **13** | 13 |
| admin iki URL'li modül | 1 | **0** | 0 |
| admin `console.error` | 1 (`favicon.ico` 404) | 1 (aynı) | ≤ baseline |
| admin ekran açılışı | 4 sn zaman aşımı | ~3 sn, veri hazır olunca | zaman aşımı yok |

## Kanıt: tarayıcı probları (salt okunur, `inventory_demo`)
- Türkçe adlı kullanıcı (`Şükrü Test`) → `m2.` formatında saklanıyor, geri okunuyor; çıkış modalı açılıyor (`display:block`), `exitPerson` dolu (INV-01).
- İki ardışık `onInventoryDataUpdated` → admin router tek render (rAF birleştirme).
- `onAppLogout` sonrası `hidden-modal` kalan modal: **0**; yeniden girişte çıkış ve talep modalları açılıyor (UI-02); `window.userAuth` korunuyor (AUTH-10).
- Güvenlik Raporu butonu navbar'da görünüyor (EBYS-05).
- `scratch/session-store.test.js`: Türkçe round-trip, düz JSON ve eski maske göçü, bozuk değer, `isDbAdmin` e-posta kontrolü, `clearSession` → geçti.

## Davranış değişiklikleri (duyurulmalı)
- Personel artık admin sekmelerini/butonlarını görmez (`checkIsAdmin` yalnız Firebase admin oturumunda true).
- Admin girişi yalnız **Yönetici Paneli** butonundan; normal giriş kutusu yalnız personel kodu kabul eder.
- Biyometrik adım kapalı (`ENABLE_BIOMETRIC_LOGIN = false`, K2).
- Çıkış modalı her açılışta seçimi sıfırlar; B1/B2 satırından açılınca o ürün ön-seçilir.

## Bilinen / kapsam dışı
- Sayfa yenilemede personelin yeniden giriş yapması (AUTH-07/K5) değişmedi.
- Ürün türü root dinleyicileri (RULE-03) Faz 2.4'te.
- `backup_txt/` çalışma ağacında silinmiş (sahibi tarafından); commit'lenmedi.

## Sahibinin Console adımları (Faz 0 kalanı)
Bkz. sohbet özeti: anonim kullanıcıların silinmesi, `admin@medipol.local`'ın silinip **`0` + yeni 5 hane** parolayla yeniden oluşturulması, fazla root koleksiyonların (`inventory`, `productTypes`, `settings`, `workflows`) silinmesi, `inventory_demo`'nun boşaltılması. `inventory_v2` ve `system_config` **silinmez**.
