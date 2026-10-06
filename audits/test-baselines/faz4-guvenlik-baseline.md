# Faz 4 · Güvenlik Test Baseline'ı

Her tur sonunda güncellenir. Ham kanıtlar `scratch/baseline/<klasör>/` altında; tur ayrıntısı ilgili walkthrough'ta.

## ★ Faz 4A nihai güvenlik baseline'ı (06.10.2026 · J6, merge öncesi)

| Kapı | Sonuç | Komut / kanıt |
|---|---|---|
| Firestore kural matrisi (Rules v2 Aşama A) | **72/72** | `npm run test:rules` |
| Yayındaki kurallar, karşılaştırma | 42/70 — 28 açık, deploy'da kapanır | J1 |
| XSS kapısı — izinsiz / gerekçeli / öz-test | **0** / 14 / **17/17** (194 sink, 817 ifade) | `npm run lint:xss`, [xss-lint-latest.json](xss-lint-latest.json) |
| Tarayıcı içi XSS yüzeyleri — çalışan yük / enjekte img | **0 / 0** (index + admin) | `j2XssSurfaces`, `xssAdminPanel` |
| Akış suite'i — gerçek demo | **41/41**, FAILED 0, pageerror 0, artık 0, CSP ihlali **0** | `npm run flow` |
| Akış suite'i — emülatör (Rules v2) | **41/41**, FAILED 0, pageerror 0, artık 0, CSP ihlali **0** | `npm run flow -- --emu` |
| CSP pozitif kontrolü (politika gerçekten uygulanıyor) | ✔ | smoke |
| Smoke index / admin (iki ortam) | pageerror 0, console.error **0**, "Veri Çekildi" 13/13; nginx = firebase.json ✔ | `2026-10-06T12-04-41_p4-final`, `…12-05-07_p4-final_emu` |
| Docker imajı (güncel kod) + çalışan konteyner | `nginx -t` uyarısız; 47 dosya; `docker-check` ✔ | `2026-10-06T12-04-41_p4-final/docker-check.txt` |
| Hosting'e gidecek dosyalar | 47 (yalnız uygulama) | `node scratch/hosting-files.js` |
| Ek A matrisi (39 madde + 2 Faz 4 eki) | 24 tam otomatik · 14 kısmi · 3 elle (liste sahibinde) | Faz 4 Kapanış Walkthrough §5, §9 |

Deploy günü kapananlar: M16 (kurallar + istemci tek komut), M17 / T14 (parola ≥12), SEC-05 paneli (EmailJS). Aşama B (RULE-02 kalanı, AUTH-07/09) Faz 4B'de.

## Firestore kural matrisi (`npm run test:rules`)
| Tur | Kurallar | Senaryo | ✔ | ✖ | Kanıt |
|---|---|---|---|---|---|
| J0 | Yayındaki (`firestore.rules`, TEYİT 0.2c: Console ile aynı) | 65 | 39 | 26 | `2026-10-01T08-30-38_p4-j0-rules/rules-baseline.txt` |
| J1 | **Rules v2 Aşama A** | 70 | **70** | 0 | `2026-10-01T09-25-47_p4-j1-rules/rules-v2.txt` |
| J1 | Yayındaki (karşılaştırma) | 70 | 42 | 28 | `2026-10-01T09-25-47_p4-j1-rules/rules-live-for-comparison.txt` |
| J4 | Rules v2 (+ rapor sorgusu: admin listeler, anonim listeleyemez) | 72 | **72** | 0 | `npm run test:rules` (05.10.2026) |

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
| J5 | gerçek demo / emülatör (Rules v2, **CSP uygulanıyor**) | 39/39 · 39/39 (CSP ihlali 0) | 0 | console.error 0 — `2026-10-05T12-54-03_p4-j5`, `2026-10-05T13-03-54_p4-j5_emu` |
| J4 | gerçek demo / emülatör (Rules v2) | 39/39 · 39/39 | 0 | aynı — `2026-10-05T11-36-42_p4-j4`, `2026-10-05T11-36-16_p4-j4_emu` |
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

## Self-approval ve denetim günlüğü (J4 · `j4SelfApproval`)
Denetim günlüğü kalıcıdır ve kural gereği silinemez; bu yüzden **gerçek demoda test kaydı yazılmaz** (`appendAuditLog` bellekte toplanır, alanlar yine sınanır). Emülatörde gerçek yazılır ve admin olarak başka bir sekmeden geri okunur.

| Kontrol | Gerçek demo | Emülatör |
|---|---|---|
| Tek politika `Schema.isSelfApproval` (id > kod > Türkçe güvenli ad; satın almada kod / ad) | ✔ | ✔ |
| Personel kendi satın alma adımını onaylayamaz → yazma 0, adım bekliyor, `blocked` | ✔ | ✔ (kayıt okundu) |
| Personel kendi talebini onaylayamaz → onay penceresi açılmaz, `blocked` | ✔ | ✔ |
| Personel başkasının talebini onaylayamaz → yönetici kapısı (günlük yok) | ✔ | ✔ |
| Sarmalayıcı yok; kontrol `confirmRequest` / `approveStep` içinde | ✔ | ✔ |
| `auditLogs` COLLECTIONS dışında; `saveData` yazamaz; yedek yalnız COLLECTIONS | ✔ | ✔ |
| Biyometrik kapalı, `prompt` 0, eski yardımcılar yok | ✔ | ✔ |
| Rapor düğmesi ada göre değil oturuma göre; personelde rapor reddedilir | ✔ | ✔ |
| Admin kendi talebi (index): yanlış parola reddedilir, vazgeç → `cancelled`, yazma 0; doğru parola → `approved` | – | ✔ |
| Admin kendi satın alma adımı (admin.html): parola → `approved` | – | ✔ |
| Günlük admin dahil güncellenemez / silinemez (uygulamadan) | – | ✔ `permission-denied` ×2 |
| Etiketli metin günlüğe düşer ("<" → "‹"), raporda enjekte `img` 0 | – | ✔ |
| Rapor (admin.html, ayrı sekme) bu koşunun 6 kaydını üç sonuç rozetiyle gösteriyor | – | ✔ |

## CSP ve dağıtım (J5)
Politika kaynağı `firebase.json` (`"**"` başlıkları); nginx şablonu birebir kopyası (smoke her koşuda karşılaştırır). Test sunucuları aynı başlıkları HTML yanıtlarına ekler, ihlaller `report-uri` ile toplanır; emülatör modunda yalnız `connect-src`'ye emülatör adresleri eklenir.

| Kontrol | Sonuç |
|---|---|
| Akış suite'i (39 senaryo) — gerçek demo / emülatör | CSP ihlali **0 / 0** |
| Smoke index + admin — gerçek demo / emülatör | CSP ihlali **0 / 0**; pozitif kontrol (izinsiz `fetch`) engellendi ve raporlandı |
| Gözlenen dış kaynaklar | gstatic, cdnjs, jsdelivr, identitytoolkit, firestore (+ emülatör) — hepsi politikada; `securetoken` token yenilemesi için tutuldu |
| nginx şablonu = firebase.json | CSP ✔, diğer 4 başlık ✔ |
| Docker imajı | `nginx -t` ✔ (uyarı 0); web kökünde 47 uygulama dosyası (1,5 MB), `backup*`, `scratch`, `tests`, `audits`, `*.md`, `firebase.json` yok |
| Çalışan konteyner (`docker-check.js`) | 17 hassas yol 404 (`/backup/x.js` dahil); JS/CSS/HTML `no-cache` + ETag → 304; 404 sayfası başlıklı; `Server` sürümsüz; X-XSS-Protection yok; iki sayfa 0 CSP ihlali, `inventory_demo` |
| Konteyner + emülatör (`CSP_CONNECT_EXTRA`) | emülatöre bağlandı, 0 ihlal; aynı deneme üretim konteynerinde engellendi (canlı politika yerel adreslere izin vermiyor) |
| TLS (`tls.conf.example`, geçici sertifika) | 443 → 200 + HSTS; 80'de HSTS yok |
| Compose | sağlık kontrolü `healthy` |
| CDN | tüm etiketler kesin sürüm + SRI (sha384); `@latest` yok; compat kaldırıldı |
