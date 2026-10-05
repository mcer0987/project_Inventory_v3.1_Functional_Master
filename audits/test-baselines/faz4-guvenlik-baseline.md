# Faz 4 · Güvenlik Test Baseline'ı

Her tur sonunda güncellenir. Ham kanıtlar `scratch/baseline/<klasör>/` altında; tur ayrıntısı ilgili walkthrough'ta.

## Firestore kural matrisi (`npm run test:rules`)
| Tur | Kurallar | Senaryo | ✔ | ✖ | Kanıt |
|---|---|---|---|---|---|
| J0 | Yayındaki (`firestore.rules`, TEYİT 0.2c: Console ile aynı) | 65 | 39 | 26 | `2026-10-01T08-30-38_p4-j0-rules/rules-baseline.txt` |
| J1 | **Rules v2 Aşama A** | 70 | **70** | 0 | `2026-10-01T09-25-47_p4-j1-rules/rules-v2.txt` |
| J1 | Yayındaki (karşılaştırma) | 70 | 42 | 28 | `2026-10-01T09-25-47_p4-j1-rules/rules-live-for-comparison.txt` |

Yayındaki kuralların 28 açığı (özet): oturumlu herkes talep/satın alma siliyor; bakımda personel yazabiliyor; personel-yazılabilir alanlarda etiket kabul ediliyor; `assignments`/`serviceRecords` anonime açık; bilinmeyen koleksiyon ve `inventory_v2` okunabiliyor; anonim sağlayıcıyla admin e-postası iddiası geçiyor; `auditLogs` kuralı yok. **Kapanış: Faz 4 deploy'u (kurallar + istemci aynı komutta).**

## XSS kapısı (`npm run lint:xss`)
| Tur | Sink | Dinamik ifade | Güvenli | Gerekçeli istisna | **İzinsiz** |
|---|---|---|---|---|---|
| J2 öncesi (aynı lint, `5188ea5`) | 195 | 823 | 688 | 0 | **135** |
| J2 sonu | 194 | 814 | 800 | 14 | **0** |

- Öz-test (`npm run lint:xss:self-test`): **17/17** — ham alan, birleştirme, etiketsiz şablon sink'i, `insertAdjacentHTML`, `document.write`, onclick gömme, map/join, parametre, yeniden atanan değişken, gerekçesiz istisna yakalanıyor.
- Güncel liste: [`xss-lint-latest.json`](xss-lint-latest.json) (14 gerekçeli istisnanın her biri dosya:satır ve gerekçesiyle).

## Tarayıcı içi XSS testleri (akış suite'i)
| Senaryo | Kapsam | Sonuç (J2) |
|---|---|---|
| `xssAdminPanel` | Talep / görev / satın alma yükleri admin panelinde | çalışan yük 0, enjekte `img` 0; Rules v2'de personel yükü `forbidden` |
| `j2XssSurfaces` | B1 tablo + kart + tooltip, ürün türü seçenekleri, navbar, akış/şablon personel araması, kritik stok, özel izleme, mahal, servis görüntüleme, satın alma rozeti, onay API'si, TODO "Ata" | index ve admin: çalışan yük **0**, enjekte `img` **0**; delegation eylemleri ham değeri bozmadan taşıyor |

## Smoke ve akış suite'i
| Tur | Ortam | Akış | pageerror | Smoke (index / admin) |
|---|---|---|---|---|
| J0 | gerçek demo / emülatör | 35/35 · 35/35 | 0 | 0 hata, 13/13 · favicon 404, 13/13 |
| J1 | gerçek demo / emülatör (Rules v2) | 36/36 · 36/36 | 0 | aynı |
| J2 | gerçek demo / emülatör (Rules v2) | 37/37 · 37/37 | 0 | aynı + xss-lint 0 izinsiz |
| J3 | gerçek demo / emülatör (Rules v2) | 38/38 · 38/38 | 0 | aynı; admin.html oturumsuz açılışta kilit kartı — `2026-10-05T08-23-05_p4-j3`, `2026-10-05T08-22-34_p4-j3_emu` |

## Oturum ve vize (J3 · `j3SessionVisa`)
Gerçek admin oturumu gerektiren adımlar yalnız emülatörde (sahte `emu01` hesabı; ≥12 karakter testi için parola geçici olarak değiştirilir ve koşu sonunda geri alınır). Gerçek projede admin kimlik bilgisi kullanılmaz.

| Kontrol | Gerçek demo | Emülatör |
|---|---|---|
| Parola geçiş kuralı: 5 → `"0"+kod`, 6-11 → ağa gitmeden ret, ≥12 → olduğu gibi | ✔ | ✔ |
| `maxlength` kalktı (giriş, bakım, kilit alanları); kilit alanında yapıştırma serbest, personel kodunda kapalı | ✔ | ✔ |
| Vize + `adminVizesi` bayrağı varken sanal "Admin" çizilmiyor, yetki verilmiyor | ✔ | ✔ |
| admin.html, bu sekmede admin oturumu yokken → kilit kartı ("Yönetici Girişi Gerekli"), paylaşılan vize silinmiyor (M8) | ✔ | ✔ |
| Dolmuş vizeyle açılış → kilit kartı, vize silinir, canlanmaz | ✔ | ✔ |
| Zamanlayıcı dolmuş vizeyi uzatmıyor → `endAdminSession('expired')`; force logout aynı yoldan | ✔ | ✔ |
| Admin oturumu sessionStorage'da; yeni sekme (tarayıcı kapat-aç eşdeğeri) anonim | – | ✔ |
| Aynı sekmede F5 → admin oturumu korunur (başka sekmenin anonim oturumu varken de) | – | ✔ |
| Vize dolumu → signOut (`userAuth.isAnonymous === true`), kilitliyken etkinlik vizeyi canlandırmıyor | – | ✔ |
| Kilit açma → admin, senkron sağlıklı, canlı yazma dinleyiciye ulaşıyor (M10) | – | ✔ |
| "Güvenli Çıkış" → signOut + kilit; ≥12 karakterli parola ile açma; rotasyon sonrası eski kod reddediliyor | – | ✔ |
| F5 + dolmuş vize, admin token'ı canlıyken → signOut | – | ✔ |
| "Oturumu Kapat" → index, anonim oturum yerel kalıcılıkta | – | ✔ |
| J3 öncesi istemcinin kalıcı (IndexedDB) admin oturumu → açılışta bayat → signOut (M9) | – | ✔ |
