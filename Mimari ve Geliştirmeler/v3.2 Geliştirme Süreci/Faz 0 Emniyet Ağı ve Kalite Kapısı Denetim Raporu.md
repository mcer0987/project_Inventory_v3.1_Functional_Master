# Faz 0 — Emniyet Ağı ve Kalite Kapısı Denetim Raporu

> **Rol:** Baş Güvenlik Denetçisi / Master Architect · **Tarih:** 26.09.2026
> **Dayanak:** v3.2 Master Stabilizasyon Planı §0.2, §5 Faz 0, §8 · v3.2 Bulgu Kataloğu (SEC-02, OPS-01…04, RULE-04, VIP-01, VIP-09)
> **Branch:** `chore/phase-0-safety-net` · **Baseline commit:** `2e9dd14` (`master`)
> **Kapsam dışı:** `src/`, `script.js` ve diğer iş mantığı dosyaları. Bu denetimde hiçbirine dokunulmadı.
> **Sır politikası:** Bu raporda parola, hash, salt veya token değeri **yoktur**. Yalnızca dosya adları ve konumlar geçer.

---

## 0. Karar Özeti

| | |
|---|---|
| **Karar** | 🔴 **NO-GO (şartlı)**: Faz 1'e geçilemez |
| **Gerekçe** | 7 kapı koşulundan 3'ü ✅, 1'i ⚠️, 3'ü ⏳/❌. Açık kalanlar insan operatör adımları (parola rotasyonu, Console envanteri), smoke-test baseline ve süreç kurallarının onayı |
| **Denetimde bulunan yeni kritik açık** | `firebase.json` ignore listesi dot-klasörlerin **içeriğini** dışlamıyordu. `git init` sonrasında bir sonraki deploy `.git/` dizinini (tüm geçmiş dahil, sızmış hash'i içeren iki dosya ile) yayımlayacaktı. **Denetim sırasında düzeltildi** (§2.3) |
| **GO için kalan iş** | §5'teki 6 kapanış aksiyonu. Tahmini süre yarım gün |

---

## 1. İnsan Operatör Konsol Rehberi (Faz 0.2a · 0.2c · 0.2d)

> **Genel kurallar (üç adım için de geçerli):**
> - Hiçbir parola, hash, API anahtarı veya kural içeriğini ajana, sohbete, walkthrough'a veya commit mesajına **yazmayın**. Ajana yalnızca aşağıdaki "teyit cümlesi" iletilir.
> - Console'da yalnızca belirtilen ekranlarda işlem yapın. Rules, Hosting veya Storage ekranlarında **"Publish / Deploy / Rollback" düğmelerine basmayın**.
> - Adımlar localhost'u gerektirmez. Uygulamayı canlı adreste test etmeyin.

### 1.1 Admin parola rotasyonu (0.2a · SEC-02). **Öncelik: Bugün**

**Neden:** Son hosting deploy'u (01.07.2026), admin hash'ini ve salt'ını içeren iki dosyayı (`backup/functions/index.js`, `scratch/brute_force.js`) herkese açık yayımladı. 5 haneli bir kod bu bilgilerle saniyeler içinde bulunur, yani **mevcut parola ele geçirilmiş sayılmalıdır**.

> ⚠️ **Kritik teknik ayrıntı: 6 karakter kuralı**
> Uygulama (`security.js:15`), kullanıcının girdiği 5 haneli kodun **başına sabit bir `0` ekleyerek** Firebase'e gönderir (Firebase en az 6 karakter ister).
> Bu yüzden **Console'a girilecek parola = `0` + yeni 5 haneli kod** (toplam 6 karakter) olmalıdır.
> Console'a yalnızca 5 haneyi girerseniz Firebase reddeder. Başında `0` olmadan 6 hane girerseniz admin girişi **kilitlenir**.

| # | Adım |
|---|---|
| 1 | Yeni 5 haneli kodu **çevrimdışı** belirleyin. Kurallar: eski koddan farklı olsun; `12345`, `00000`, doğum yılı veya dahili numara gibi tahmin edilebilir diziler olmasın; hiçbir yere dijital olarak not edilmesin (gerekirse mühürlü zarf / kurumsal parola kasası) |
| 2 | Firebase Console → proje **medipol-envanter** → **Build → Authentication → Users** |
| 3 | `admin@medipol.local` satırı → sağdaki **⋮** menüsü → **Reset password** değil, **"Edit / Şifreyi değiştir"** seçeneğini kullanın. (Reset e-posta gönderir; `.local` alan adına e-posta ulaşmaz) |
| 4 | Yeni parola alanına **`0` + yeni 5 haneli kod** yazın → Kaydet |
| 5 | **Doğrulama (localhost'ta):** Uygulamayı yalnızca `http://localhost:…` üzerinden açın → Yönetici Paneli → **yeni 5 haneli kodu** girin (başında `0` olmadan, arayüz kendisi ekler) → admin paneli açılmalı. Ardından **eski kodla** deneyin; reddedilmeli |
| 6 | Uygulamayı kapatın. Başka bir sekmede/cihazda açık eski admin oturumu varsa çıkış yapın |
| 7 | Ajana **yalnızca** şu teyidi iletin: |

```
TEYİT 0.2a: Admin parolası Console'da döndürüldü. Yeni kod localhost'ta kabul edildi, eski kod reddedildi. Tarih/saat: <GG.AA.YYYY SS:DD>. Operatör: <ad soyad / rol>
```

> **Not:** Firebase Auth, parolası değiştirilen hesabın mevcut oturumlarını belirli bir süre içinde geçersiz kılar. Eski parolayla açılmış bir oturumdan şüpheleniyorsanız Console → Authentication → kullanıcı → **"Disable account"** ile anında kapatıp hemen tekrar **Enable** edebilirsiniz.

### 1.2 Canlı Firestore Rules karşılaştırması (0.2c · OPS-02)

**Neden:** Depodaki `firestore.rules` dosyasının canlıda yayımlanan kurallarla aynı olduğu hiç doğrulanmadı. Faz 4 kuralları bu farka göre planlanacak.

| # | Adım |
|---|---|
| 1 | Console → **Build → Firestore Database → Rules** sekmesi |
| 2 | Editörün üstündeki **yayım tarihini** not edin |
| 3 | Sol/üstteki **geçmiş (history)** simgesiyle kaç sürüm olduğunu ve son sürümün tarihini not edin. **Hiçbir sürümü "Restore" etmeyin** |
| 4 | Canlı kuralları yerel `firestore.rules` ile **satır satır** karşılaştırın (en güvenli yol: iki ekranı yan yana açıp göz ile karşılaştırma. Metni kopyalayıp bir üçüncü taraf "diff" sitesine yapıştırmayın) |
| 5 | Özellikle şu 5 noktayı kontrol edin ve **Evet/Hayır** olarak raporlayın: |

| Kontrol noktası | Yerelde | Canlıda aynı mı? |
|---|---|---|
| K-a · `isAdmin()` e-posta kontrolü `admin@medipol.local` | Var | E / H |
| K-b · `inventory_v2/{col}` → okuma: oturum açmış herkes | Var | E / H |
| K-c · `inventory_v2/{col}` → personel yazma listesi: `purchaseOrders, requests, tasks, assignments, serviceRecords` | Var | E / H |
| K-d · `system_config` → okuma: oturumlu, yazma: admin | Var | E / H |
| K-e · `inventory` (v1) tamamen kapalı · `inventory_demo` kuralları `inventory_v2` ile aynı | Var | E / H |
| K-f · Yerelde **olmayan** ek bir `match` bloğu var mı? | – | Var ise yalnız **yol adını** yazın (içeriği değil) |

6. Ajana iletilecek teyit:
```
TEYİT 0.2c: Canlı rules yayım tarihi <tarih>, sürüm sayısı <n>. K-a..K-e: <E/H listesi>. K-f: <yok | yol adları>. Hosting son yayım tarihi: <tarih> (Hosting → Release history'den).
```
> Hosting → **Release history** ekranında son yayımın tarihine bakmak yeterlidir. Beklenen değer **01.07.2026** (yerel `.firebase/hosting..cache` ile tutarlı). Farklıysa ajan bunu OPS-02'ye bulgu olarak ekler.

### 1.3 Fatura planı ve Storage durumu (0.2d · K11 · OPS-04)

**Neden:** EBYS dosya ekleri Storage'a gidiyor. Yüklemeler başarısız olursa kod bunu sessizce "sahte ek"e çeviriyor (EBYS-14). Yeni projelerde varsayılan Storage bucket'ı Blaze planı gerektirebiliyor.

| # | Adım | Raporlanacak |
|---|---|---|
| 1 | Console → sol alt **⚙ Project settings → Usage and billing** (veya "Spark/Blaze" rozeti) | Plan: **Spark / Blaze** |
| 2 | **Build → Storage** ekranı açılıyor mu, yoksa "Upgrade project" mi istiyor? | Açılıyor / Yükseltme istiyor |
| 3 | Açılıyorsa: **Files** sekmesinde klasör listesi (yalnız üst klasör **adları**, dosya adı/içerik değil) ve toplam dosya sayısı yaklaşık kaç? | Klasör adları, ~adet |
| 4 | **Rules** sekmesi → yayım tarihi ve kural özeti: "herkese açık okuma var mı?" (`allow read: if true` benzeri) | Tarih, E/H |
| 5 | **Usage** sekmesi → son 30 gün yükleme (upload) grafiği sıfır mı? | Sıfır / Sıfır değil |
| 6 | Firestore → **Usage** → son 7 günde günlük okuma/yazma kotası **%100'e** ulaşan gün oldu mu? (DATA-01 kota riski) | E/H, varsa tarih |

```
TEYİT 0.2d: Plan <Spark/Blaze>. Storage <açık/yükseltme gerekli>. Klasörler <liste>, ~<n> dosya. Storage rules herkese açık okuma: <E/H>. 30 gün upload: <sıfır/değil>. Firestore kota tavanı son 7 gün: <E/H>.
```

---

## 2. Emniyet Ağı Yapılandırma Denetimi (Faz 0.2b · SEC-02)

### 2.1 Kanıt: son deploy'da yayımlanan hassas içerik
`.firebase/hosting..cache` (tarih 01.07.2026, **deploy sonrası değişmemiş**) son deploy'da şu hassas grupların yayımlandığını gösteriyor:

| Grup | Örnek yol(lar) | Risk |
|---|---|---|
| Admin kimlik bilgisi türevleri | `backup/functions/index.js`, `scratch/brute_force.js` | **Kritik**: parola kırılabilir |
| Güvenlik test araçları | `scratch/security_mock.js`, `scratch/patch_index.js` | Saldırgana yol haritası |
| Kurallar ve plan | `firestore.rules`, `plan.json` | Yetki modelinin tamamı ifşa |
| Mimari dokümanlar | `Mimari ve Geliştirmeler/**` (~90 dosya, PDF dahil) | Bilinen açıkların listesi |
| Ajan talimatları | `.agents/rules/*.md` (dot-klasör olmasına rağmen yayımlanmış) | Dot-dışlamanın çalışmadığının kanıtı |
| Eski kaynak kopyaları | `backup/**`, `scripts_txt/**`, kökte eski düzen `*.js` | Eski/zayıf kod yüzeyi |
| Paket bilgisi | `package.json`, `package-lock.json` | Bağımlılık sürümleri |

### 2.2 `hosting.ignore` doğrulaması (Local Executor değişikliği)
Plan §5 Faz 0.2b'deki 13 desenin tamamı eklenmiş: ✅ `backup/**`, `backup_txt/**`, `scratch/**`, `functions/**`, `Mimari ve Geliştirmeler/**`, `**/*.md`, `plan.json`, `package*.json`, `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `firestore.rules`, `.agents/**`. JSON geçerli.

> `firestore.rules` dosyasının hosting'den dışlanması **Firestore kural deploy'unu etkilemez**. `firebase deploy --only firestore:rules` dosyayı `firestore.rules` anahtarından ayrı okur.

### 2.3 🔴 Denetimde bulunan açık: dot-klasör içerikleri (düzeltildi)
- **Kök neden:** `**/.*` deseni yalnızca **adı nokta ile başlayan yolun kendisini** eşler. Firebase CLI'ın glob-ignore semantiğinde bir klasörü eşlemek, **içindeki dosyaları dışlamaz**. Kanıt: `.agents/rules/*.md` bu desen varken yayımlanmış.
- **Etki:** Faz 0.1'de oluşturulan `.git/` klasörü (170 dosya: tüm geçmiş, dolayısıyla §2.1'deki iki kimlik dosyası) ile `.github/`, `.kilo/` (~3.460 dosya, kendi `node_modules`'ı dahil), `.lingma/` bir sonraki deploy'da yayımlanacaktı.
- **Düzeltme (bu branch'te, commit bekliyor):**
  ```diff
         "**/.*",
  +      "**/.*/**",
  +      ".git/**",
         "**/node_modules/**",
  ```
- **Doğrulama (simülasyon):** Node `path.matchesGlob` ile tüm ağaç tarandı. Düzeltme sonrası yayımlanabilir dosya sayısı **40**, hepsi uygulama dosyası (`*.html`, `*.css`, `*.js` kökte + `src/**`). Hassas grup: **0**. `.firebase/*` CLI tarafından zaten dışlanıyor.
- **Sınırlama:** Firebase CLI bu makinede kurulu değil. Simülasyon yaklaşık bir modeldir. **Faz 2 sonu deploy'unda** CLI çıktısındaki `found N files` değerinin **≈40** olduğu kontrol edilmeli. Belirgin sapma olursa deploy iptal edilir.

### 2.4 Mimari not: bu adım neyi yapar, neyi yapmaz
| | |
|---|---|
| ✅ **Yapar** | Bundan sonraki **her** deploy'da sızıntıyı kalıcı olarak engeller |
| ❌ **Yapmaz** | Canlıdaki 01.07.2026 sürümü deploy edilene kadar hassas dosyaları yayında tutar. Ayrıca internet arşivlerinde/önbelleklerde kalmış kopyaları silmez |
| 🛡️ **Canlı sızıntının panzehiri** | §1.1 **parola rotasyonu**. Sızan hash eski parolaya aittir; parola değişince **değersizleşir**. Bu yüzden rotasyon, deploy'u (Faz 2 sonu) beklemeden **bugün** yapılmalıdır |
| ⚠️ **Ek risk (git)** | Baseline commit, iki kimlik dosyasını yerel git geçmişine aldı. Rotasyon sonrası değersiz olsalar da **bu repo hiçbir uzak sunucuya (GitHub vb.) push edilmemelidir**, en azından Faz 4.4 uzun-parola geçişi ve geçmiş temizliği kararı verilene kadar |

### 2.5 Ek gözlem: ortam koruması (smoke test için önemli)
`firebase-handler.js:38-42` → `localhost`, `127.0.0.1` ve adında `demo` geçen hostlar `inventory_demo`'ya bağlanır. **Dosyanın `file://` ile açılması veya LAN IP'si (ör. `192.168.x.x`) üzerinden erişim CANLI `inventory_v2`'ye bağlanır.** Smoke test ve manuel testler yalnızca `http://localhost` / `http://127.0.0.1` üzerinden yapılmalıdır. Ayrıca `system_config` ortam ayrımı yapmaz (RULE-04). localhost'tan bile VIP kontrolleri canlıyı etkiler.

---

## 3. Süreç Kuralları (Faz 0.5 · Plan §8). Önerilen Güvenli Diff

**Hedef dosya:** `.agents/rules/execution-protocol.md` (öncelik 3. Anayasa ile çelişmez, onu genişletir).
**Durum:** ⏳ **Hazırlandı, uygulanmadı.** Plan §5 Faz 0.5 gereği sahip onayı bekliyor. Onay gelince Local Executor tek atomik commit ile uygular: `chore(rules): add phase-0 process safety rules to execution protocol`.
**Dil:** Dosyanın mevcut dili (İngilizce) korunmuştur.

```diff
--- a/.agents/rules/execution-protocol.md
+++ b/.agents/rules/execution-protocol.md
@@ ## 6. Prohibited Actions @@
 | Working outside your agent domain | Violates 02-agent-roles.md |
 | Omitting `// [WHY]` / `// [HOW]` on new functions | Violates Constitution §9 |
+| Claiming "verified"/"completed" without evidence | Violates this file §7.2 |
+| Writing files with PowerShell `Set-Content`/`Add-Content`/`Out-File` without `-Encoding utf8` | Violates this file §7.3 |
+| Fixing one half of a masking pair in isolation | Violates this file §7.4 |
+| Writing passwords, hashes, salts or tokens to terminal, logs, walkthroughs or commit messages | Violates this file §7.5 |
+
+---
+
+## 7. Process Safety Rules (v3.2 Phase 0)
+
+> Added after the v3.2 audit (root cause KN-7: behaviour lost during migrations went unnoticed).
+
+### 7.1 Atomic Commits
+- Every task = its own commit on the active phase branch (`<type>/phase-N-<topic>`). Never commit directly to `master`.
+- Commit message: Conventional Commits (`fix(scope): …`, `chore(scope): …`). No secrets.
+- Every walkthrough MUST list: commit hash(es), changed file list (`git diff --stat`), and the branch name.
+
+### 7.2 Definition of "Verified" / "Completed"
+A task may be reported as verified/completed ONLY when all three are attached:
+1. The code change (commit hash).
+2. Observed result of the related Regression List (Plan Ek A) items. State what was actually seen, not what is expected.
+3. Evidence: console output excerpt and/or screenshot, plus smoke-test metrics (error count, duplicate-load count) compared with the Phase 0 baseline.
+Without evidence, the status is "implemented, not verified".
+
+### 7.3 Character Encoding (OPS-03 / VIP-09)
+- Prefer editor tools (Edit/Write) for source files.
+- In Windows PowerShell 5.1, `Set-Content`, `Add-Content` and `Out-File` MUST be called with `-Encoding utf8`. Without it, the default ANSI code page (cp1254) corrupts Turkish characters.
+- Bulk regex replacements require a dry-run preview before writing.
+
+### 7.4 Masking Pairs
+If fixing bug A exposes bug B (see Master Plan §5.0 list, e.g. INV-01⇄INV-02, EBYS-01⇄EBYS-02, VIP-04⇄VIP-06⇄VIP-03), both MUST be fixed in the same commit. Do not ship half a pair.
+
+### 7.5 Secrets & Live-System Safety
+- Never request, print, or store passwords, hashes, salts, or tokens. Human operators confirm credential changes with a confirmation sentence only.
+- Test only via `http://localhost` or `http://127.0.0.1` (→ `inventory_demo`). Never via `file://` or a LAN IP (→ live `inventory_v2`).
+- Until Phase 2.5 is completed: do not trigger VIP "Tekerrürleri Temizle", kill switch, force logout, or system message, not even on localhost (`system_config` is not environment-scoped).
+- No `firebase deploy` of any target until the owner explicitly approves (planned: end of Phase 2).
```

---

## 4. Faz 0 Geçiş Kapısı (Quality Gate)

| # | Koşul | Durum | Kanıt / Eksik |
|---|---|---|---|
| 1 | Güvenli başlangıç commit'i ve izole faz branch'i | ✅ | `2e9dd14` · `chore(baseline): v3.1 freeze before v3.2 stabilization` · 142 dosya, `node_modules` hariç, `.env`/kimlik dosyası yok · branch `chore/phase-0-safety-net` aktif. *Not: varsayılan dal `master` (planda `main`). İşlevsel fark yok, kayıt için belirtildi* |
| 2 | Admin parolası Console'da döndürüldü (onay kaydı) | ⏳ **Açık** | TEYİT 0.2a bekleniyor (§1.1). **Engelleyici** |
| 3 | `firebase.json` ignore doğru + canlı deploy yapılmadı | ⚠️ **Şartlı ✅** | Liste plana uygun + dot-klasör açığı kapatıldı (§2.3). Simülasyon: 40 dosya, 0 hassas. Deploy yapılmadı: `.firebase/hosting..cache` tarihi 01.07.2026 (değişmemiş), makinede Firebase CLI kurulu değil. **Eksik:** değişiklik henüz commit edilmedi |
| 4 | Canlı rules, faturalandırma, Storage envanteri belgelendi | ⏳ **Açık** | TEYİT 0.2c + 0.2d bekleniyor (§1.2, §1.3) |
| 5 | Testler `inventory_demo`'ya bağlı + smoke-test baseline kaydı | ❌ **Açık** | Ortam koruması kodda doğrulandı (localhost/127.0.0.1 → `inventory_demo`, §2.5). **Ancak `scratch/smoke-test.js` yok. Hata sayısı, çift yükleme ("yüklendi" logları), admin "📥 Veri Çekildi" sayısı baseline'ı alınmadı.** Ek A elle koşulmadı |
| 6 | "Tekerrürleri Temizle" ve VIP can alıcı butonlarına dokunulmadı | ✅ (Faz 0 kapsamı) | Bu fazda uygulama hiç çalıştırılmadı. `git diff master` yalnız `firebase.json` gösteriyor. Canlıya yazma yok. *Garanti sınırı:* kod seviyesinde devre dışı bırakma iş mantığıdır (Faz 2.5). O zamana kadar koruma §3/7.5 kuralı ve operatör disiplinidir |
| 7 | Süreç kuralları ajan talimatlarına bağlandı | ⏳ **Açık** | Diff hazır (§3), sahip onayı bekliyor |

**Sonuç:** 🔴 **NO-GO.** Faz 1'e (Omurga Onarımı) geçilmez.

---

## 5. GO İçin Kapanış Aksiyonları

| # | Aksiyon | Sahip | Kapı |
|---|---|---|---|
| A1 | `firebase.json` değişikliğini atomik commit'le: `chore(hosting): harden hosting.ignore against source and dot-dir leaks` | Local Executor | 3 |
| A2 | Admin parola rotasyonu + TEYİT 0.2a | İnsan operatör | 2 |
| A3 | Rules/Hosting karşılaştırması + TEYİT 0.2c, fatura/Storage + TEYİT 0.2d. Ajan sonuçları OPS-02/OPS-04 altında Bulgu Kataloğu'na işler | İnsan operatör → Ajan | 4 |
| A4 | `scratch/smoke-test.js` (mevcut `puppeteer_debug.js` iskeletinden; yalnız **okuma**; `http://localhost`; index + admin; `pageerror` + `console.error` sayısı, modül "yüklendi" log sayıları, admin "📥 Veri Çekildi" sayısı, ekran görüntüsü). Çıktı `scratch/baseline/` altına tarih damgalı. Ek A bir kez elle koşulup "bilinen bozuklar" listesi kaydedilir | Local Executor | 5 |
| A5 | §3 diff'inin sahip onayı → tek commit ile uygulanması | Sahip → Local Executor | 7 |
| A6 | Faz 0 walkthrough'u: tüm commit hash'leri + teyit cümleleri + baseline metrikleri. Sonra bu kapı yeniden değerlendirilir | Master Architect | Tümü |

> **Sıralama önerisi:** A2 **hemen** (deploy'u beklemez, canlı sızıntının tek panzehiri) → A1 → A5 → A3 → A4 → A6.

---

## Ek — Bu Denetimde Yapılan Değişiklikler
| Dosya | Değişiklik | Commit |
|---|---|---|
| `firebase.json` | Local Executor'ın 13 deseni + denetçinin 2 deseni (`**/.*/**`, `.git/**`) | Bekliyor (A1) |
| Bu rapor | Yeni. `**/*.md` ve `Mimari ve Geliştirmeler/**` ile hosting'den dışlanır | Bekliyor (A6) |

İş mantığı dosyalarında değişiklik: **yok**. Deploy: **yok**. Canlı veritabanına yazma: **yok**. Terminale/rapora yazılan sır: **yok**.
