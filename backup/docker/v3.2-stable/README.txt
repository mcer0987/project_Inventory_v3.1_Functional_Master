MEDIPOL ENVANTER — v3.2 STABLE DOCKER YEDEĞİ

Icerik
- medipol-envanter-v3.2-stable.tar : hazir Docker imaji
- START-v3.2.bat                  : Windows'ta cift tikla baslat
- START-v3.2.sh                   : Linux/macOS'ta tek komutla baslat

Gereksinim: hedef bilgisayarda Docker Desktop/Engine calisiyor olmali.

Windows
1. Bu klasoru hedef cihaza kopyalayin.
2. START-v3.2.bat dosyasina cift tiklayin.
3. http://localhost:8088 adresi acilir.

Linux/macOS
  sh START-v3.2.sh

Bu paket uygulamanin nginx on yuz imajini tasir; Firebase veritabani/kimlik
verisini tasimaz. Uygulama localhost adresinde inventory_demo kokunu kullanir.
Canli veriye baglanan alan adi/IP ile erisim ayri bir dagitim karari gerektirir.
Baslatici portu yalnizca bu bilgisayarin localhost arayuzune acar.

Docker imaji: medipol-envanter:v3.2-stable
Uygulama commit'i: 4e524b1
Docker image ID: sha256:da643f4c1242eb7f9b7c417b3eb1fa78337d5fa6a1eb33598c10c6cdc9adb6de
Imaj boyutu: 26,815,750 bayt
Port: 8088 (host loopback -> konteyner 80)
Arsiv SHA-256: E24337EFE0F07D88A4498FADD528E9ABFDB554D6F283D51B0A110F339F4730E4
