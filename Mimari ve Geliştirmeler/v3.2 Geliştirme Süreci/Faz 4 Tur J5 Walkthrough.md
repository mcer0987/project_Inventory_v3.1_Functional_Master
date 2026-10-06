# Faz 4 · Tur J5 Walkthrough (Dağıtım sertleştirme — 4.8)

> **Tarih:** 05.10.2026 · **Branch:** `feat/phase-4-security-and-rules` (merge edilmedi, **canlıya deploy edilmedi**)
> **Firebase:** gerçek projede yalnız `inventory_demo` kullanıldı (işaretli test kayıtları, artık 0); `firebase deploy` yapılmadı. Docker yalnız bu makinede, `localhost` üzerinden denendi (→ `inventory_demo`).
> **Durum (§7.2):** Uygulandı + otomatik testlerle ve çalışan konteynerde doğrulandı.
> **Bulgular:** SEC-03, SEC-05 (kod tarafı yok, not), ARC-08/09, OPS-04 (TEYİT 0.2d) · T15 · M15 · KJ-4 · sahibinin özel isteği: `DOCKER_GUIDE.md`.

## Commit'ler
| Hash | Özet |
|---|---|
| `c22f0a6` | **fix(deploy)** — CSP + güvenlik başlıkları, nginx/Docker sertleştirme, sabit CDN sürümleri + SRI |
| `fdcdf2c` | **chore(test)** — smoke ve akış sunucularında canlı CSP + ihlal raporu, pozitif kontrol, `docker-check.js` |
| *(bu commit)* | `DOCKER_GUIDE.md`, `.gitattributes`, walkthrough, kanıtlar, `audits/` baseline |

## 1 — CSP ve güvenlik başlıkları (M15, KJ-4)
- **Tek kaynak `firebase.json`** (`"source": "**"`):
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (kamera, mikrofon, konum, ödeme, usb kapalı)
- **Politika:**
  - `default-src 'self'`
  - `script-src`: self + `'unsafe-inline'` + gstatic / cdnjs / jsdelivr
  - `style-src`: self + `'unsafe-inline'` + cdnjs; `font-src`: self + cdnjs + `data:`; `img-src`: self + `data:` + `blob:`
  - `connect-src`: self + Firestore + Identity Toolkit + Secure Token + `api.emailjs.com`
  - `frame-src`: self + `blob:`
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`
- **Plan taslağından farklar:** `connect-src` için `*.googleapis.com` yerine üç kesin uç nokta. `wss://*.firebaseio.com` kaldırıldı (Realtime Database kullanılmıyor). Storage adresleri `connect-src` ve `img-src`'den çıkarıldı (TEYİT 0.2d).
- **M15 — liste gerçek istek günlüğünden doğrulandı.** Smoke her sayfanın dış kaynaklarını yazıyor; hepsi politikada. `securetoken.googleapis.com` kısa testte görünmüyor ama bir saatlik token yenilemesinde gerekli, bilinçli olarak tutuldu.
- **Yerel doğrulama (KJ-4):**
  - `scratch/csp.js`, `firebase.json`'daki başlıkları smoke ve akış test sunucularının HTML yanıtlarına ekliyor. Emülatör modunda yalnız `connect-src`'ye emülatör adresleri ekleniyor.
  - Tarayıcı ihlalleri `report-uri` ile sunucuya bildiriyor; akış suite'inde tek bir ihlal koşuyu başarısız sayıyor.
  - Smoke'taki **pozitif kontrol**, izinsiz bir `fetch`'in engellenip raporlandığını doğruluyor; "0 ihlal" böylece "CSP çalışmıyor" anlamına gelemiyor.
- J4 senaryosundaki `eval` kaldırıldı: CSP altında kendisi ihlal sayılırdı.
- `'unsafe-inline'` zorunlu (satır içi olay işleyicileri); kaldırılması Faz 6 · KJ-6.

## 2 — nginx ve Docker (SEC-03)
| Sorun (önce) | Şimdi |
|---|---|
| Engel regex'leri statik varlık kuralının **arkasındaydı**: `/backup/x.js` servis ediliyordu | Engeller `^~` önekleri ve baştaki regex'ler. Çalışan konteynerde 17 hassas yolun hepsi 404 (`/backup/x.js`, `/.git/config`, `/firebase.json`, `/scratch/…`, `/Mimari ve Geliştirmeler/…`, `/DOCKER_GUIDE.md` …) |
| Güvenlik başlıkları server düzeyinde; kendi `add_header`'ı olan her location (JS/CSS/HTML) onları **düşürüyordu** | Tek include (`nginx/templates/security-headers.inc.template`) her location'da; 404 sayfası dahil |
| Hash'siz JS/CSS `max-age=31536000, immutable` (yeni sürüm tarayıcıya ulaşmıyordu) | `no-cache` + ETag. Değişmeyen dosya `304` döner, gövde gelmez; yeni sürüm hemen yayılır |
| `X-XSS-Protection` (eskimiş), `X-Frame-Options: SAMEORIGIN`, CSP yok | `firebase.json` ile birebir aynı başlıklar (smoke karşılaştırıyor). HSTS yalnız TLS'te |
| `50x.html` yoktu; bilinmeyen yol `index.html`'e düşüyordu | 5xx → 404 sayfası; bilinmeyen yol gerçek 404 |
| `include mime.types` + aynı uzantılar → derlemede çok sayıda uyarı | Açık ve tam MIME listesi; `nginx -t` uyarısız. `server_tokens off` |
| `COPY .` + kara liste `.dockerignore` (yedekler, `backup_txt/`, belgeler, yapılandırma imaja girebiliyordu) | **Beyaz liste** `.dockerignore` + açık `COPY`. Web kökünde 47 uygulama dosyası (1,5 MB) |
| Compose host portu 8080, emülatörle çakışıyordu; sağlık kontrolü `localhost` (IPv6'ya çözülebiliyor) | `HOST_PORT` (varsayılan 8088); sağlık kontrolü `127.0.0.1`, durumu `healthy` |

Ekler:
- `nginx/tls.conf.example`: isteğe bağlı 443 sunucusu. Sertifikalar bağlanır, imaja girmez.
- `CSP_CONNECT_EXTRA`: yalnız yerel emülatörle geliştirme için; varsayılan boş.
- Taban imaj sabitlenebilir: `--build-arg NGINX_IMAGE=nginx:1.30-alpine`; 05.10.2026'da stable 1.30.5.
- `.gitattributes`: Docker/nginx dosyaları Windows checkout'unda da LF kalıyor.

## 3 — CDN ve bağımlılıklar (T15, ARC-09)
- `sortablejs@latest` → **1.15.7**; `@emailjs/browser@3` (aralık) → **3.12.1**.
- İki sayfada eşit: jspdf-autotable **3.8.2** (admin'de 3.5.28 idi), Font Awesome **6.5.2** (admin'de 6.5.1 idi).
- Kullanılmayan `firebase-app-compat` / `firebase-firestore-compat` kaldırıldı. Hiçbir kod `firebase.*` global'ini kullanmıyor; modüler SDK zaten gstatic'ten import ediliyor.
- **SRI:** her CDN etiketine `integrity` (sha384) + `crossorigin="anonymous"` + `referrerpolicy="no-referrer"` eklendi. CDN'deki dosya değişirse tarayıcı onu çalıştırmaz. Güncelleme komutu: `DOCKER_GUIDE.md` §6.2.
- admin.html'e index'teki boş favicon eklendi: bilinen tek `console.error` (favicon 404) kapandı, smoke iki sayfada `console.error: 0`.

## 4 — Storage ve EmailJS
- **Storage (OPS-04, TEYİT 0.2d):**
  - Aktif değil, bu yüzden `storage.rules` yazılmadı, CSP'de Storage adresi yok.
  - Ek yükleme denemesi EBYS-14'ün açık hata yoluna düşüyor: "eklersiz devam / iptal".
  - Storage açılırsa yapılacaklar `DOCKER_GUIDE.md` §6.4'te.
- **EmailJS (SEC-05):**
  - Kod değişikliği gerekmiyor: anahtar *public key* ve tarayıcıda görünmesi beklenen bir durum.
  - Sahibinin işleri `DOCKER_GUIDE.md` §3.5'te: izinli alan adı kısıtı, kota/hız sınırı, kaçışlı `{{ }}` şablonları.

## 5 — `DOCKER_GUIDE.md` (sahibinin isteği)
Kök dizinde. Firebase Hosting'e (`**/*.md`) ve Docker imajına (beyaz liste) girmiyor; nginx de `.md` dosyalarını 404'e çeviriyor. Bölümler:

| § | İçerik |
|---|---|
| 0 | Veri kökünün alan adına göre seçilmesi (sunucu IP'si = **canlı**); imajın yalnız ön yüz olduğu |
| 1 | Gereksinimler: Git, Node 20+, Temurin 21, Docker/Compose, Chrome, VS Code eklentileri |
| 2 | `npm ci`, JAVA_HOME, test komutları, emülatör tohumlama |
| 3 | Build (taban imaj sabitleme), run (80 / 8088 / compose), doğrulama (`docker-check.js`), HTTPS (vekil veya `tls.conf.example`), yeni alan adına taşıma (EmailJS, API anahtarı) |
| 4 | Emülatör + Docker: port tablosu, `CSP_CONNECT_EXTRA`, salt-okunur kaynak bağlama (yalnız yerel) |
| 5 | Sürümleme, yeniden derleme, geri dönüş, `docker save \| gzip` / `sha256sum` / `docker load`, registry |
| 6 | CSP/başlık değiştirme kuralı, SRI güncelleme, çalışma anı dış erişim listesi, Storage, `firebase deploy` |
| 7 | Sorun giderme |

Kılavuzdaki komutların hepsi bu turda çalıştırıldı: build, run, compose (`healthy`), emülatörlü konteyner, TLS (geçici sertifika), save → load (~26 MB).

## Kanıt
| Kontrol | Sonuç |
|---|---|
| Akış suite'i — emülatör (Rules v2) | **39/39**, `FAILED` yok, pageerror 0, artık 0, **`csp violations: 0`**. J4 çıktısıyla birebir aynı (yalnız süre ölçümleri farklı) |
| Akış suite'i — gerçek demo | **39/39**, `FAILED` yok, pageerror 0, artık 0, **`csp violations: 0`**. J4 ile birebir aynı |
| Smoke | Gerçek `scratch/baseline/2026-10-05T12-54-03_p4-j5`, emülatör `…/2026-10-05T13-03-54_p4-j5_emu`. pageerror 0, **console.error 0**, "Veri Çekildi" 13/13. CSP ihlali 0; pozitif kontrol ✔; nginx = firebase.json ✔ |
| Docker build | `nginx -t` başarılı, uyarı 0. Web kökü 47 dosya / 1,5 MB, imaj ~95 MB, sıkıştırılmış dışa aktarım ~26 MB |
| `docker-check.js` (üretim) | Başlıklar = firebase.json ✔; 17 yol 404 ✔; JS/CSS/HTML `no-cache` + ETag → 304 ✔; iki sayfa 0 CSP ihlali, 0 pageerror, `inventory_demo` ✔ → `2026-10-05T12-54-03_p4-j5/docker-check.txt` |
| `docker-check.js --emu` | Emülatöre bağlandı, 0 ihlal ✔ → `…/docker-check-emu.txt`. Karşı kontrol: üretim konteyneri emülatör bağlantısını CSP ile engelledi |
| TLS / compose / save-load | 443 → 200 + HSTS, 80'de HSTS yok · `healthy` · `docker load` sonrası çalışıyor |
| Kural matrisi / xss-lint | 72/72 (değişmedi) · izinsiz 0 |

## Bilinen / sonraki
- **Canlı CSP ancak deploy ile devreye girer.** Yerel testler aynı politikayı uyguluyor. Yine de deploy sonrası tarayıcı konsolunda `Refused to` olup olmadığına bakılmalı; runbook'a eklenecek (J6).
- Kullanıcı tarayıcılarının CDN'lere ve Google uç noktalarına erişmesi gerekiyor (`DOCKER_GUIDE.md` §6.3). Kurumsal güvenlik duvarı bu adresleri engellerse uygulama açılmaz. Bu J5 öncesinde de böyleydi; SRI yalnız dosyanın değişmesine karşı koruyor.
- Konteyner nginx'i root master + `nginx` worker kullanıcısıyla çalıştırıyor (resmi imaj varsayılanı). Root'suz imaj (`nginxinc/nginx-unprivileged`) ileride değerlendirilebilir.
- **J6:** Ek A tam regresyon, master plana durum, merge hazırlığı, deploy runbook'u. Runbook'ta şunlar yer alacak: TEYİT 0.2c, kurallar + istemci tek komut (M16), aynı gün parola rotasyonu (T14), deploy sonrası CSP kontrolü.

## Sahibinin elle doğrulaması (önerilen)
1. Docker Desktop açıkken: `docker compose up -d --build` → `http://localhost:8088`. Uygulama açılır; F12 → Konsol'da `Refused to` yok.
2. `node scratch/docker-check.js http://localhost:8088` → `✔ docker-check: tümü geçti`.
3. Tarayıcıda `http://localhost:8088/firebase.json` ve `http://localhost:8088/DOCKER_GUIDE.md` → 404 sayfası.
4. EmailJS panelinde izinli alan adlarını canlı alan adıyla sınırlayın (§3.5).
