# Docker Geliştirici ve Dağıtım Kılavuzu — Medipol Envanter Takip Sistemi

Bu kılavuz projeyi **temiz bir bilgisayarda veya yeni bir sunucuda sıfırdan** ayağa kaldırmak içindir: geliştirme ortamı, testler, Docker imajı (nginx), HTTPS, emülatörle geliştirme, yeniden imaj alma ve offline taşıma.

> Son doğrulama: 05.10.2026 (Faz 4 · Tur J5). Bu dosyadaki komutlar Windows 11 + Git Bash, Docker 29.7.2, Node.js 26.7.0 ve JDK 21 ile çalıştırılarak denendi.

---

## 0. Başlamadan önce — iki kritik kural

**1. Veritabanı kökü ALAN ADINA göre seçilir** (`src/services/firebase-handler.js`):

| Tarayıcıdaki adres | Bağlanılan Firestore kökü |
|---|---|
| `localhost`, `127.0.0.1` veya adında `demo` geçen alan adı | `inventory_demo` (test verisi) |
| **Diğer her şey** (sunucu IP'si, şirket alan adı, `envanter.medipol…`) | **`lifeserver_master` — CANLI veri** |

Docker konteynerini bir sunucuda IP adresiyle açtığınız anda uygulama **canlı veriye** bağlanır. Deneme kurulumlarında `localhost` kullanın ya da alan adında `demo` geçsin (ör. `envanter-demo.kurum.local`).

**2. Docker imajı yalnız ön yüzdür.** Veritabanı ve kimlik doğrulama Firebase'de (bulutta) çalışır; konteynerde veritabanı yoktur. Firestore kuralları Docker ile değil, `firebase deploy` ile yayınlanır (§6.5). Canlıya her yayın sahibinin açık onayı ile yapılır.

---

## 1. Gereksinimler

| Araç | Sürüm | Ne için | Kontrol |
|---|---|---|---|
| Git | 2.40+ | Kaynak kod | `git --version` |
| Node.js (npm dahil) | **20 LTS veya üstü** (doğrulandı: 26.7.0) | Test betikleri, Firebase CLI, emülatör tohumlama | `node --version` |
| JDK | **Temurin 21** | Firestore/Auth emülatörü ve kural testleri (Java 1.8 yetmez) | `java -version` → `21…` |
| Docker | **Engine 24+ / Docker Desktop 4.x**, Compose v2 (doğrulandı: 29.7.2) | Üretim imajı (nginx) | `docker version`, `docker compose version` |
| Google Chrome | Güncel | Smoke / akış testleri (puppeteer) | — |
| IDE (isteğe bağlı) | VS Code | Önerilen eklentiler: *Docker*, *ESLint*, *Firebase Explorer*, *GitLens* | — |

Notlar:
- **Firebase CLI ayrıca kurulmaz.** Projenin `devDependencies`'inde (`firebase-tools`); her komut `npx firebase …` ya da `npm run …` ile çalışır.
- Test betikleri (`scratch/smoke-test.js`, `scratch/flow-tests.js`, `scratch/docker-check.js`) Chrome'u Windows yolunda arar: `C:/Program Files/Google/Chrome/Application/chrome.exe`. macOS/Linux'ta bu yolu betiklerde kendi Chrome yolunuzla değiştirin.
- JDK kurulumu: <https://adoptium.net> → Temurin 21 (LTS). Kurulumda "Set JAVA_HOME" seçeneğini işaretleyin.
- Docker Desktop (Windows): WSL 2 altyapısını kullanır. İlk kurulumdan sonra Docker Desktop'ı bir kez açın; `docker info` hata vermiyorsa motor çalışıyordur.

---

## 2. Ortam kurulumu ve bağımlılıklar

```bash
# 1) Kaynak kod
git clone <depo-adresi> project_Inventory_v3.1_Functional_Master
cd project_Inventory_v3.1_Functional_Master

# 2) Bağımlılıklar (package-lock.json'a birebir uyar; puppeteer, firebase-tools, rules-unit-testing, acorn)
npm ci

# 3) Araç kontrolü
java -version                 # 21.x görünmeli. Görünmüyorsa JAVA_HOME'u Temurin 21'e ayarlayın:
                              #   PowerShell:  setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-21…"
npx firebase --version        # firebase-tools (devDependency)
docker version
```

### 2.1 Testler — yeni makinede ilk koşu

```bash
npm run test:rules            # Firestore kural matrisi; kendi emülatörünü açar/kapatır (port 8180). Beklenen: tümü ✔ (72/72)
npm run lint:xss              # XSS kapısı. Beklenen: İZİNSİZ 0
npm run lint:xss:self-test    # kapının öz-testi. Beklenen: 17/17

# Uygulama emülatörü (AYRI bir terminalde açık kalır: Firestore 8080, Auth 9099)
npm run emu

# İlk kez: gerçek inventory_demo'nun salt-okunur kopyasını çek, emülatöre yükle (sahte admin hesabı da açılır)
npm run emu:pull              # yalnız inventory_demo okunur; canlı köke hiç dokunulmaz
npm run emu:seed              # emülatöre yazar; admin parolası: emu-yonetici-0001 (YALNIZ emülatörde geçerli)

node scratch/smoke-test.js deneme --emu     # index/admin yükleme + CSP ihlal sayısı. Beklenen: pageerror 0, CSP ihlali 0
npm run flow -- --emu                       # uçtan uca akışlar. Beklenen: FAILED yok, csp violations: 0
```

Emülatör çalışırken uygulama tarayıcıda: `http://127.0.0.1:<port>/index.html?emu=1`. Konsolda `🚀 ACTIVE DATABASE ROOT: inventory_demo @ EMULATOR` görünmelidir. Ayrıntılı test kuralları: `audits/README.md`.

> Gerçek parola, token veya hash hiçbir betiğe, loga ya da bu belgeye yazılmaz. Emülatörde yalnız `emu-yonetici-0001` sahte hesabı kullanılır.

---

## 3. Docker: üretim (nginx) imajı

### 3.1 İmajın içeriği

| Dosya | Görev |
|---|---|
| `Dockerfile` | `nginx:stable-alpine` tabanı; yalnız uygulama dosyalarını kopyalar; derleme anında `nginx -t` |
| `.dockerignore` | **Beyaz liste**: yalnız `index.html`, `admin.html`, `404.html`, kökteki `*.css`/`*.js`, `src/`, `nginx/` derleme bağlamına girer. Yedekler, testler, `audits/`, `scratch/`, belgeler, `firebase.json`, `.git`, `node_modules` hiç gönderilmez |
| `nginx/nginx.conf` | Ana yapılandırma (MIME türleri, gzip, `server_tokens off`, HSTS eşlemesi) |
| `nginx/sites/default.conf` | HTTP sunucusu (konteyner içi 80) |
| `nginx/snippets/site.inc` | Bütün konumlar: engeller, önbellek, 404 (HTTP ve HTTPS ortak) |
| `nginx/templates/security-headers.inc.template` | Güvenlik başlıkları + CSP; konteyner açılışında `/etc/nginx/generated/`'a üretilir |
| `nginx/tls.conf.example` | İsteğe bağlı HTTPS sunucusu (§3.4) |
| `docker-compose.yml` | Tek servis; host portu `HOST_PORT` (varsayılan **8088**) |

Doğrulanmış sonuç: web kökünde 47 dosya (~1,5 MB); imaj ~95 MB (diskte), sıkıştırılmış dışa aktarım ~26 MB.

### 3.2 Derleme (build)

```bash
docker build -t medipol-envanter:1.0.0 .

# Tekrarlanabilir derleme için taban imajı sabit sürüme kilitleyin (önerilir; güncel etiketi hub.docker.com/_/nginx'ten seçin):
docker build --build-arg NGINX_IMAGE=nginx:1.30-alpine -t medipol-envanter:1.0.0 .     # 05.10.2026: stable = 1.30.5
```

Derleme çıktısının sonunda `nginx: configuration file /etc/nginx/nginx.conf test is successful` görünmelidir. Yapılandırmada hata varsa derleme burada durur.

### 3.3 Çalıştırma ve port yönlendirme

```bash
# Sunucuda: host 80 → konteyner 80
docker run -d --name medipol-envanter --restart unless-stopped -p 80:80 medipol-envanter:1.0.0

# Yerel deneme (80 doluysa): http://localhost:8088
docker run -d --name medipol-envanter -p 8088:80 medipol-envanter:1.0.0

# Compose ile (imajı derler ve başlatır; sağlık kontrolü dahil)
docker compose up -d --build                  # http://localhost:8088
HOST_PORT=80 docker compose up -d --build     # sunucuda 80 (PowerShell: $env:HOST_PORT=80; docker compose up -d --build)
docker compose ps                             # STATUS: healthy
```

Doğrulama:

```bash
curl -I http://localhost:8088/index.html                 # 200 + Content-Security-Policy, X-Frame-Options: DENY …
node scratch/docker-check.js http://localhost:8088       # başlıklar, engeller, önbellek, iki sayfada CSP ihlali → "✔ docker-check: tümü geçti"
```

`docker-check.js` şunları denetler:
- CSP ve diğer başlıklar `firebase.json` ile aynı mı;
- `/firebase.json`, `/.git/config`, `/backup/…`, `/scratch/…`, `/DOCKER_GUIDE.md` vb. 404 dönüyor mu;
- JS/CSS `no-cache` + ETag ile gidiyor ve tekrar istendiğinde `304` dönüyor mu;
- iki sayfa tarayıcıda 0 CSP ihlali ve 0 pageerror ile açılıyor mu.

Günlük işletme:

```bash
docker logs -f medipol-envanter          # nginx erişim/hata günlükleri
docker stop medipol-envanter && docker rm medipol-envanter
docker compose down                      # compose ile başlatıldıysa
```

### 3.4 HTTPS (443)

**Seçenek A — önerilen:** önde bir ters vekil / yük dengeleyici TLS'i sonlandırır (kurumsal nginx, Caddy, Traefik, bulut yük dengeleyicisi). Konteyner 80'de kalır; vekil `https://alan-adi` → `http://konteyner:80`. HSTS başlığını vekil eklemelidir.

**Seçenek B — konteynerin kendisi TLS sonlandırır.** `certs/` klasöründe `fullchain.pem` ve `privkey.pem` bulunmalıdır (ör. Let's Encrypt). Sertifikalar imaja ve git'e **girmez**; çalıştırırken bağlanır:

```bash
# Linux / macOS
docker run -d --name medipol-envanter --restart unless-stopped -p 80:80 -p 443:443 \
  -v "$PWD/certs:/etc/nginx/certs:ro" \
  -v "$PWD/nginx/tls.conf.example:/etc/nginx/sites/tls.conf:ro" \
  medipol-envanter:1.0.0

# Windows Git Bash (yol dönüşümünü kapatın, Windows yolu verin)
MSYS_NO_PATHCONV=1 docker run -d --name medipol-envanter -p 80:80 -p 443:443 \
  -v "$(pwd -W)/certs:/etc/nginx/certs:ro" \
  -v "$(pwd -W)/nginx/tls.conf.example:/etc/nginx/sites/tls.conf:ro" \
  medipol-envanter:1.0.0
```

- 443'teki yanıtlarda `Strict-Transport-Security` gönderilir; düz HTTP'de gönderilmez.
- HTTP'yi HTTPS'e yönlendirmek için `tls.conf.example`'ın sonundaki `return 301` sunucusunu ayrı bir dosyaya alıp `/etc/nginx/sites/default.conf` yerine bağlayın.
- Bu yol kendinden imzalı geçici bir sertifikayla denendi: `https://localhost:8443` → 200 + HSTS.

### 3.5 Yeni alan adına taşırken (sahibinin işleri)

1. **Veri kökü:** §0'daki tabloya göre canlı mı, demo mu bağlanacağını kontrol edin.
2. **EmailJS:** `index.html`'deki EmailJS anahtarı bir *public key*'dir ve tarayıcıda görünür; bu beklenen bir durum. Kötüye kullanımı sınırlamak için:
   - EmailJS panelinde (Account → Security) izinli alan adlarını yalnız gerçek alan adlarınızla sınırlayın; yeni alan adını oraya ekleyin.
   - Aylık kota / hız sınırını açın.
   - Şablonlarda kaçışlı `{{ }}` değişkenleri kullanın (üçlü `{{{ }}}` HTML basar).
3. **Firebase web API anahtarı:** Google Cloud Console'da anahtara HTTP referrer kısıtı koyduysanız yeni alan adını ekleyin; koymadıysanız işlem gerekmez (anahtar zaten genel yapılandırmadır, güvenlik Firestore kurallarıyla sağlanır).
4. **Firebase Hosting'de** yayın yapılıyorsa Docker'a gerek yoktur. Aynı güvenlik başlıkları `firebase.json`'dan gelir (§6.1).

---

## 4. Geliştirme: emülatör ve Docker birlikte

| Port | Kim kullanır |
|---|---|
| 8080 | Firestore emülatörü (`npm run emu`) |
| 9099 | Auth emülatörü |
| 8180 | Kural testlerinin kendi emülatörü (`npm run test:rules`) |
| **8088** | Docker/compose varsayılan host portu (8080 emülatörle çakışmasın diye) |
| 5594 / 5599 | Akış ve smoke testlerinin kendi geçici sunucuları |

Emülatör modu üç koşulla açılır:
- adres `localhost` / `127.0.0.1` olmalı;
- adres çubuğunda `?emu=1` bulunmalı (sekme boyunca kalır, `?emu=0` kapatır);
- emülatör host'ta çalışıyor olmalı.

Tarayıcı emülatöre **doğrudan** (`http://127.0.0.1:8080`, `:9099`) bağlanır, konteyner üzerinden değil. Bu yüzden konteynerin CSP'si bu iki adrese izin vermelidir. Üretim politikası izin vermez: emülatörle açılan bir üretim konteyneri, Auth emülatörüne bağlanırken CSP ihlali verir (denendi).

```bash
# Terminal 1 — emülatör (+ ilk seferde: npm run emu:pull && npm run emu:seed)
npm run emu

# Terminal 2 — emülatöre izin veren geliştirme konteyneri
docker run -d --name medipol-envanter-dev -p 8088:80 \
  -e CSP_CONNECT_EXTRA="http://127.0.0.1:8080 http://127.0.0.1:9099" \
  medipol-envanter:1.0.0
# ya da: CSP_CONNECT_EXTRA="http://127.0.0.1:8080 http://127.0.0.1:9099" docker compose up -d --build

# Tarayıcı: http://localhost:8088/index.html?emu=1   (admin parolası: emu-yonetici-0001)
node scratch/docker-check.js http://localhost:8088 --emu   # emülatöre bağlandı, CSP ihlali 0
```

Bilmeniz gerekenler:
- **`CSP_CONNECT_EXTRA` yalnız yerel geliştirme içindir**; sunucuda boş bırakın. Değer, konteyner her açıldığında başlık şablonuna işlenir; imajı yeniden derlemek gerekmez.
- **Kod değişikliği imaja yeniden derleyince girer** (§5). Hızlı yineleme için Docker şart değildir; testler kendi sunucularını açar, tarayıcıda denemek için herhangi bir yerel statik sunucu (ör. VS Code *Live Server*) + `?emu=1` yeterlidir.
- Yalnız kendi makinenizde, derlemeden canlı düzenleme istiyorsanız kaynak klasörü salt-okunur bağlayabilirsiniz:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -p 8088:80 -v "$(pwd -W):/usr/share/nginx/html:ro" medipol-envanter:1.0.0
  ```
  Bu durumda bütün depo web köküne girer. nginx engelleri `scratch/`, `backup/`, `*.md`, `.git` gibi yolları 404'e çevirir, ama bu kullanım **yalnız yereldir**; sunucuda asla kullanmayın.

---

## 5. Değişiklikten sonra yeniden imaj alma ve offline taşıma

### 5.1 Sürümleme ve yeniden derleme

```bash
# 1) Testler (en az): kural matrisi, XSS kapısı, smoke (CSP ihlali 0)
npm run test:rules && npm run lint:xss && node scratch/smoke-test.js surum-oncesi

# 2) Yeni sürüm etiketiyle derle (sürüm + git kısaltması önerilir)
TAG=1.0.1-$(git rev-parse --short HEAD)
docker build -t medipol-envanter:$TAG -t medipol-envanter:latest .

# 3) Eski konteyneri yenisiyle değiştir
docker stop medipol-envanter && docker rm medipol-envanter
docker run -d --name medipol-envanter --restart unless-stopped -p 80:80 medipol-envanter:$TAG
node scratch/docker-check.js http://localhost        # sunucuda adres ve portu kendinize göre verin

# Compose ile: IMAGE_TAG=$TAG HOST_PORT=80 docker compose up -d --build
```

Geri dönüş: önceki etiketle aynı `docker run` komutu (`docker image ls medipol-envanter` eski etiketleri listeler).

### 5.2 Offline ortama taşıma (`docker save` / `docker load`)

İnternet erişimi olmayan bir sunucuya taşımak için imaj tek bir dosyaya aktarılır. Taban nginx katmanları da dosyanın içindedir, hedefte internet gerekmez. Uygulamanın *çalışırken* Firebase'e ve CDN'lere erişmesi gerekir (§6.3).

```bash
# Kaynak makine
docker save medipol-envanter:$TAG | gzip > medipol-envanter_$TAG.tar.gz
sha256sum medipol-envanter_$TAG.tar.gz > medipol-envanter_$TAG.tar.gz.sha256      # bütünlük için

# (USB / kurumsal aktarım ile hedefe kopyalayın)

# Hedef makine
sha256sum -c medipol-envanter_$TAG.tar.gz.sha256
gunzip -c medipol-envanter_$TAG.tar.gz | docker load        # "Loaded image: medipol-envanter:<TAG>"
docker run -d --name medipol-envanter --restart unless-stopped -p 80:80 medipol-envanter:$TAG
```

PowerShell'de `gzip` yoksa sıkıştırmasız da çalışır: `docker save -o medipol-envanter.tar medipol-envanter:$TAG` → hedefte `docker load -i medipol-envanter.tar`. Denendi: sıkıştırılmış dosya ~26 MB; `docker load` sonrası imaj olduğu gibi çalışıyor.

Bir kayıt defteri (registry) kullanıyorsanız: `docker tag medipol-envanter:$TAG <registry>/medipol-envanter:$TAG && docker push <registry>/medipol-envanter:$TAG`.

Temizlik: `docker image prune` (etiketsiz katmanlar), `docker image rm medipol-envanter:<eski-etiket>`.

---

## 6. Güvenlik yapılandırması — değiştirirken

### 6.1 Güvenlik başlıkları ve CSP

- **Tek kaynak `firebase.json`** (`hosting.headers` → `"source": "**"`). `nginx/templates/security-headers.inc.template` bunun birebir kopyasıdır.
- Birini değiştirirseniz ötekini de değiştirin ve smoke testini koşun. Rapor iki kopyayı karşılaştırır (`nginx = firebase.json: CSP ✔`); ayrıca politikanın gerçekten uygulandığını bir pozitif kontrolle doğrular.
- Politikanın özeti:
  - `default-src 'self'`
  - Betikler: kendi alan adı + `www.gstatic.com` (Firebase SDK), `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`
  - `connect-src`: Firestore, Identity Toolkit, Secure Token (Firebase Auth) ve `api.emailjs.com`
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`
  - Ek başlıklar: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
- `'unsafe-inline'` şimdilik zorunlu (yüzlerce satır içi olay işleyicisi; kaldırılması Faz 6 · KJ-6).
- Uygulamaya yeni bir dış hizmet eklerseniz önce `connect-src` / `script-src`'ye ekleyin; aksi halde tarayıcı isteği engeller (`npm run flow` sonunda `csp violations` > 0 olur ve koşu başarısız sayılır).

### 6.2 CDN kütüphaneleri (sabit sürüm + SRI)

`index.html` / `admin.html`'deki her CDN etiketi **kesin sürümlü** ve `integrity` (SHA-384) taşır. CDN'deki dosya değişirse tarayıcı onu çalıştırmaz. Sürüm yükseltirken yeni özeti hesaplayın:

```bash
curl -s https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js | openssl dgst -sha384 -binary | openssl base64 -A
# → integrity="sha384-<çıktı>"
```

Güncel sürümler: chart.js 4.4.1, lz-string 1.5.0, jsPDF 2.5.1, jspdf-autotable 3.8.2 (iki sayfa), xlsx 0.18.5, EmailJS 3.12.1, Font Awesome 6.5.2 (iki sayfa), SortableJS 1.15.7. Firebase modüler SDK 10.7.1 `import` ile gstatic'ten gelir.

### 6.3 Çalışma anında gereken dış erişim

Sunucu offline olabilir, ama **kullanıcıların tarayıcısı** şu adreslere erişebilmelidir: `www.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `api.emailjs.com`. Kurumsal güvenlik duvarında bu adresler açık olmalıdır.

### 6.4 Firebase Storage

TEYİT 0.2d: proje Spark planında, **Storage aktif değil**. Bu yüzden:
- `storage.rules` yazılmadı ve CSP'de Storage adresi yok.
- Satın alma ekine dosya yükleme denemesi açık bir hata verir ve kullanıcıya "eklersiz devam / iptal" sorulur (EBYS-14).

Storage ileride açılırsa:
- `connect-src` ve `img-src`'ye `https://firebasestorage.googleapis.com` ekleyin (iki kopyada da);
- `storage.rules` yazın (plan §3 J5.6) ve `firebase.json`'a `storage` hedefini ekleyin.

### 6.5 Firebase Hosting / kurallar (Docker dışı)

```bash
npx firebase login                                    # yalnız proje sahibi
npx firebase deploy --only firestore:rules,hosting    # kurallar ve istemci AYNI komutta (M16) — yalnız sahibinin açık onayıyla
```

Ayrıntılı yayın adımları Faz 4 kapanışındaki deploy runbook'undadır.

---

## 7. Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| `docker build` → `failed to connect to the docker API` | Docker Desktop motoru kapalı; Docker Desktop'ı açın, `docker info` çalışana kadar bekleyin |
| Derlemede `nginx: [emerg] …` | `nginx/` altındaki yapılandırmada sözdizimi hatası; satır numarası çıktıda |
| `bind: address already in use` (8080) | Emülatör 8080'i kullanıyor; host portunu değiştirin (`-p 8088:80` / `HOST_PORT=8088`) |
| Sayfa açılıyor ama veri gelmiyor, konsolda `Refused to connect` | CSP bir adresi engelliyor. Emülatörle çalışıyorsanız `CSP_CONNECT_EXTRA` verin (§4); yeni bir hizmet eklediyseniz §6.1 |
| Konsolda `Failed to find a valid digest in the 'integrity' attribute` | CDN dosyası SRI özetiyle uyuşmuyor; sürüm/özet güncelleyin (§6.2) |
| JS değişikliği tarayıcıya gelmiyor | JS/CSS `no-cache` + ETag ile her istekte doğrulanır; değişmiyorsa imajı yeniden derlemediniz (§5.1) |
| Emülatör açılmıyor (`java` hatası) | JDK 21 değil; `java -version` ve `JAVA_HOME` (§2) |
| Uygulama beklenmedik şekilde **canlı** veriyi gösteriyor | Alan adı `localhost`/`demo` değil (§0) |
| Admin girişi yeni sekmede parola istiyor | Beklenen davranış: admin oturumu sekmeye bağlıdır (Faz 4 · J3) |


kısaca 3 adımda paketleme ve 2 adımda çalıştırma 

1) taşınabilir tek bir "Container Paketi" haline getirmek için kendi bilgisayarında terminali açıp şu 3 komutu sırayla çalıştıracaksın: docker build -t medipol-envanter:v3.2 .
2) Adım: Kutuyu Tek Bir Dosyaya Çevir (Save Et) : docker save medipol-envanter:v3.2 -o medipol-envanter-v3.2.tar
3) dosyayı yedekle.
Geriye doğru işlem, AYAĞA KALDIRMA:
1) Dosyanın olduğu yerde terminali aç ve şunu yaz (Ekranda: Loaded image: medipol-envanter:v3.2 yazar. Docker imajı içine çeker).: docker load -i medipol-envanter-v3.2.tar
2) Ayağa Kaldır: docker run -d --name envanter-app -p 8088:80 medipol-envanter:v3.2
3) 👉 http://localhost:8088
***İŞİN BİTTİĞİNDE DURDURMAK İSTERSEN : docker stop envanter-app && docker rm envanter-app