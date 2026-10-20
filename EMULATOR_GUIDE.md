# Emülatör ve Test Kılavuzu (Nasıl Kullanılır)

Uygulamayı ve testleri **gerçek veriye hiç dokunmadan**, kendi bilgisayarınızda çalıştırmak için kısa rehber.

## Emülatör nedir?
Firebase'in (veritabanı + giriş sistemi) bilgisayarınızda çalışan **sahte bir kopyası**. Burada yapılan her kayıt, silme ve
giriş yalnız sizin makinenizde kalır; canlı sistem (`lifeserver_master`) ve bulut demo verisi etkilenmez. Emülatör
kapatılınca içindeki veri silinir. Bu yüzden her açılıştan sonra (ve her tam test koşusundan önce) test verisi yüklenir
(`emu:seed`).

## Bir kerelik kurulum
| Gerekli | Kontrol komutu | Beklenen |
|---|---|---|
| Node.js | `node --version` | v20 veya üstü |
| Java (JDK 21) | `java -version` | `21…` |
| Google Chrome | — | `C:\Program Files\Google\Chrome` altında kurulu |

Proje klasöründe bir kez: `npm install`

## Günlük kullanım: 3 terminal
Komutlar VS Code'da **PowerShell** terminalinde, proje klasöründe çalıştırılır. Her adım ayrı bir terminalde açık kalır.

**Terminal 1: Emülatörü başlat**
```powershell
$env:JAVA_TOOL_OPTIONS = "-Xmx4g"; npm run emu
```
`All emulators ready!` yazısını bekleyin. Bu terminal açık kaldıkça emülatör çalışır.

**Terminal 2: Test verisini yükle** (emülatör her açıldığında bir kez **ve her tam test koşusundan önce**)
```powershell
npm run emu:seed
```
`✔ emülatör tohumlandı` yazısı görünmeli. Tohum, her personele bir **kurumsal kimlik** (PRI, ör. `ihale.ofisi`) ve giriş hesabı açar;
PRI'ler çıktıda listelenir.

Göç aracını elle denemek için eski durumu yükleyin: `node scratch/emu-seed.mjs push --legacy`. Bu durumda tohum personelinin
PRI'si yoktur ve hesapları eski (J7) adrestedir; giriş yapamazlar. Yönetici → VIP → **PRI / Hesap Göç Aracı** ile taşınırlar.

**Terminal 3: Uygulamayı aç**
```powershell
npm run serve
```
Ardından tarayıcıda: **http://127.0.0.1:5500/index.html?emu=1**
- **Personel girişi:** üst kutuya kurumsal kimliği (`ad.soyad`), alt kutuya kodu yazın, **Sisteme Giriş Yap**. Emülatördeki test
  personeli: `flow.personel` / `ftkod77` ve `flow.onaylayici` / `ftkod88` (yalnız emülatörde geçerli). Büyük harf ya da
  Türkçe harf (ör. `Flow.Onaylayıcı`) da kabul edilir.
- **Yönetici girişi:** kimlik kutusunu boş bırakıp alt kutuya `emu-yonetici-0001` yazın, **Yönetici Paneli** (yalnız emülatörde geçerli).
- Giriş yapmadan hiçbir veri görünmez (anonim oturum yok); bu beklenen davranıştır.
- Doğru bağlandığınızı tarayıcı konsolunda (F12) görürsünüz: `ACTIVE DATABASE ROOT: inventory_demo @ EMULATOR`
- Adresin sonunda `?emu=1` **yoksa** uygulama buluttaki demo verisine bağlanır.

## Adresler ve portlar
| Adres | Ne işe yarar |
|---|---|
| http://127.0.0.1:5500/index.html?emu=1 | Uygulama (emülatöre bağlı) |
| http://127.0.0.1:4000 | **Emülatör paneli**: veritabanındaki kayıtlar, açılmış personel hesapları |
| 127.0.0.1:8080 | Veritabanı (Firestore). Tarayıcıda açılmaz, uygulama kullanır |
| 127.0.0.1:9099 | Giriş sistemi (Auth). Tarayıcıda açılmaz, uygulama kullanır |
| 5594 | Otomatik testlerin kendi geçici sunucusu (test sürerken) |
| 4400, 4500, 9150 | Emülatörün iç portları; dokunmayın |

5500 doluysa (ör. Live Server açık): `npm run serve -- --port 5501` ve adreste 5501 kullanın.

## Otomatik testleri çalıştırma
Ajanların ve geliştiricilerin yazdığı senaryolar `scratch/flow-tests.js` içinde (54 senaryo, temiz emülatörde ~8 dk).
Emülatör (Terminal 1) açık ve veri **bu koşudan hemen önce** yüklenmiş (Terminal 2) olmalı: son senaryo (Kod Temizliği)
emülatördeki giriş kodlarını siler; seed'siz ikinci koşuda o senaryo "önce npm run emu:seed" diyerek düşer.

> **Önce bir kez (her yeni terminalde):** `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
> Bu satır olmadan çıktı dosyasındaki Türkçe karakterler ve `■` işareti bozuk kaydedilir; ilerleme filtresi bitiş satırını göremez.

| Ne yapmak istiyorum | Komut |
|---|---|
| Tüm senaryolar, emülatörde | `node scratch/flow-tests.js --emu *> scratch/flow-emu.out` |
| Tek/birkaç senaryo | `node scratch/flow-tests.js --emu j10StaffLogin j7StaffProvisioning` |
| Testin tarayıcısını **ekranda izlemek** | sona `--headed` ekleyin. Açılan Chrome'a **tıklamayın** (test bozulur); F12 ile konsolu izleyebilirsiniz |
| Bulut demo verisinde (yalnız okuma ağırlıklı, işaretli test kayıtları) | Testler bir personel hesabıyla girer: `$env:FT_STAFF_PRI='<ad.soyad>'; $env:FT_STAFF_CODE='<kod>'; node scratch/flow-tests.js`. Kod dosyaya / depoya yazılmaz. J10 kuralları ve istemcisi buluta yayınlanmadan bu mod kullanılamaz |

**Senaryo adlarını listelemek:**
```powershell
Select-String -Path scratch/flow-tests.js -Pattern '^    async (\w+)\(page' | ForEach-Object { $_.Matches[0].Groups[1].Value }
```

**İlerlemeyi izlemek** (ayrı terminalde):
```powershell
Get-Content scratch/flow-emu.out -Wait | Select-String "^\[|FAILED|■"
```
Her senaryo başlarken bir satır çıkar: `[51/54] j10StaffLogin başladı · 15:42:10 · geçen 9dk 3sn · hata 0`.
Aynı satır 5 dakikadan uzun süre değişmiyorsa o senaryo takılmıştır (aşağıya bakın).

**Sonucu okumak:** En sonda `■ bitti · 54 senaryo · 0 hata` ve `csp violations: 0` görünmeli. Hata varsa
`=== senaryoAdı FAILED: …` satırı neyin beklendiği gibi olmadığını söyler. Bu satırı geliştiriciye iletin.

**Diğer test paketleri** (kısa sürer, emülatörü kendileri açıp kapatır; Terminal 1'deki emülatörle çakışmaz):
| Komut | Ne test eder | Süre |
|---|---|---|
| `npm run test:unit` | İş kuralları (tarayıcısız) | saniyeler |
| `npm run test:rules` | Veritabanı güvenlik kuralları (kim neyi okuyup yazabilir) | ~1 dk |
| `npm run test:staff:emu` | Personel giriş hesapları, kurumsal kimlik (PRI) ve eski hesapların taşınması | ~1 dk |
| `npm run test:atomic:emu` | Toplu yazma / yedekten geri yükleme güvenliği | ~1 dk |
| `npm run test:ownership:emu` | Kayıt sahipliği (uid) göçü ve değiştirilemezlik | ~1 dk |

## Sık karşılaşılan sorunlar
| Belirti | Çözüm |
|---|---|
| 5500 adresi açılmıyor | Terminal 3'te `npm run serve` çalışıyor mu? |
| "Kurumsal kimlik ya da giriş kodu hatalı" | PRI'yi `npm run emu:seed` çıktısındaki gibi yazın (ör. `flow.personel`); hâlâ olmuyorsa tohumu yeniden yükleyin |
| Test başında `ABORT: test personeli girişi başarısız` ya da `j10CodeCleanse: … önce npm run emu:seed` | `npm run emu:seed` çalıştırıp testi yeniden başlatın |
| Testler peş peşe `timed out` ile düşüyor | Emülatörün belleği dolmuş olabilir. Kontrol: `(Select-String -Path firestore-debug.log -Pattern OutOfMemoryError).Count` 0'dan büyükse Terminal 1'de Ctrl+C, emülatörü yeniden başlatın ve `npm run emu:seed` çalıştırın |
| `port taken` / `EADDRINUSE` | Önceki emülatör hâlâ açık. `Get-Process java` ile bulun, `Stop-Process -Id <numara>` ile kapatın |
| Emülatör çalışıyor mu? | `Get-Process java` (satır yoksa kapalıdır) ve http://127.0.0.1:4000 açılıyor mu |
| `firestore-debug.log` çok büyüdü | Emülatörü kapatıp açınca sıfırlanır. Git'e eklenmez |

## Güvenlik notları
- Emülatör yalnız `localhost` / `127.0.0.1` adresinde ve `?emu=1` ile devreye girer; canlı alan adında asla devreye girmez.
- `emu-yonetici-0001` gerçek bir parola değildir; yalnız emülatörde çalışır.
- Emülatörü yeniden başlatmak her şeyi sıfırlar. Bu bilinçli bir davranıştır; önemli bir şey kaybolmaz.

Kurulumun ayrıntıları (Docker, deploy, sunucu) için: `DOCKER_GUIDE.md`.
