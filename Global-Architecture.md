projenin **"Genetik Kodunu (Architectural DNA)"** oluşturan, bugünün Vanilla JS/Firebase gerçekliği ile yarının merkeziyetsiz, bağımsız Web 3.0 egemenliği arasında sarsılmaz bir köprü kuran **"Evrensel Mimari Anayasa ve Gelecek Vizyonu Direktifi (Universal Architectural Constitution & Future-Insight)"**.

Bu belge, projeye dahil olan **herhangi bir yapay zekanın (Opus, Sonnet, GPT, Qwen, DeepSeek) veya insan geliştiricinin**, kendisine özel bir talimat verilmese bile kod yazarken uymak zorunda olduğu **mutlak kırmızı çizgileri** belirler.

---

# 📜 EVRENSEL MİMARİ ANAYASA VE GELECEK VİZYONU DİREKTİFİ
### (Universal Architectural Constitution & Sovereign Future-Insight)

> **Mühür:** v3.2 Enterprise Baseline  
> **Kapsam:** `project_Inventory_v3.1_Functional_Master` ve tüm gelecek sürümler (v3.5, v4.0, v5.0+).  
> **Hedef Kitle:** Tüm İnsan Geliştiriciler, AI Ajanları (Architect, Coder, Auditor), Sistem Operatörleri.  
> **Temel İlke:** *"Bugün yazılan her satır kod, yarının merkeziyetsiz, bağımsız ve egemen dünyasına engel değil, basamak olmak zorundadır."*

┌────────────────────────────────────────────────────────┐
│                   GÖRÜNÜM (FRONTEND)                   │
│   WebAssembly (Wasm) + TypeScript / Rust               │
│   (Tarayıcıda yerel C hızıyla çalışan, PWA arayüz)      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│         MERKEZİYETSİZ VERİTABANI & DEPOLAMA            │
│   • Veritabanı: GunDB / OrbitDB / Ceramic Network      │
│     (Firebase Firestore'un P2P merkeziyetsiz hali)     │
│   • Dosya/PDF Arşivi: IPFS (InterPlanetary File System) │
│     (AWS S3 yerine dünyanın her yerine dağıtık dosya)  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│             İŞ MANTIKLARI VE SÖZLEŞMELER               │
│   • Akıllı Sözleşmeler: Solidity / Rust                │
│   • Özel Kurumsal Ağ: Avalanche Subnet veya Polygon CDK│
│     (Sıfır işlem ücretli, saniyede 5.000 işlem)        │
└────────────────────────────────────────────────────────┘

---

## 1. DÖRT EGEMEN SÜTUN (THE 4 SOVEREIGN PILLARS)

Projeye dokunan her el, şu dört temel felsefeyi çalıştığı dosyada yaşatmakla yükümlüdür:

### Sütun 1: Dijital İkiz ve Varlık Egemenliği (Digital Twin & Sovereign Asset)
* **İlke:** Bir fiziksel cihaz (demirbaş), veritabanındaki sıradan bir "stok satırı" değildir; yaşayan, kimliği olan bir **Dijital İkizdir (Asset Entity)**.
* **Bugünkü Karşılığı:** Cihazların Seri No (SN) ve Envanter No ile tekilleştirilmesi, adet=1 kuralı, yaşam döngüsü (`IN_POOL` -> `ASSIGNED` -> `IN_SERVICE` -> `SCRAPPED`) ve tarihçeli servis geçmişi.
* **Gelecek Vizyonu:** NFC/IoT destekli, bağımsız blokzincir ağlarında yaşayan dinamik NFT (Varlık Pasaportu).
* **Ajan Yasağı:** Hiçbir ajan demirbaşları kimliksizleştiremez, serileri toplu bir metin kutusuna gömemez, cihaz geçmişini üzerine yazarak (overwrite) silemez.

### Sütun 2: "Kod Kanundur" ve Katı Sözleşmeler (Code is Law & Strict Contracts)
* **İlke:** İş mantığı arayüzdeki butonların insafına bırakılamaz; kurallar ve veri sözleşmeleri veritabanı kapısında kilitlenir.
* **Bugünkü Karşılığı:** `schema.js` içindeki `validateB1/B2/B3` sözleşmeleri, `WriteContract` regresyon kapıları ve `firestore.rules` Zero-Trust denetimleri.
* **Gelecek Vizyonu:** Akıllı Sözleşmeler (Smart Contracts). İnsan müdahalesi olmadan kendi kendine çalışan ihale ve tedarik kuralları.
* **Ajan Yasağı:** Hiçbir ajan bir özelliği hızlı bitirmek adına şema sözleşmelerini esnetemez (`stockLegacy` gibi geçici gevşetmeler yasaktır). Şema doğrulaması olmadan veritabanına doğrudan obje yazılamaz.

### Sütun 3: İnkar Edilemez ve Değiştirilemez Denetim (Immutable Auditability)
* **İlke:** Bir kurumda geçmiş değiştirilemez. Sistemde gerçekleşen her onay, ret, transfer ve silme inkar edilemez bir kanıt bırakmalıdır.
* **Bugünkü Karşılığı:** `${ROOT}/auditLogs` koleksiyonu. Kurallar gereği Admin dahil kimse bu logları güncelleyemez veya silemez (`allow update, delete: if false;`).
* **Gelecek Vizyonu:** Sıfır Bilgi İspatları (Zero-Knowledge Proofs - ZK) ile harici denetçilere ticari sırları ifşa etmeden matematiksel dürüstlük kanıtı sunma.
* **Ajan Yasağı:** Hiçbir ajan logları temizleyen, sessizce silen veya istemci saatine güvenerek geçmiş uyduran kod yazamaz.

### Sütun 4: Sağlayıcı Bağımsızlığı ve Yerel Egemenlik (Vendor-Agnostic / Local-First)
* **İlke:** Sistem bugün Google Firebase üzerindedir; ancak yarın bir gün Firebase'in fişi çekildiğinde veya sistem özel bir P2P ağa (GunDB, IPFS, SQLite) taşınmak istendiğinde mimari çökmeyecek şekilde soyutlanmalıdır.
* **Bugünkü Karşılığı:** Arayüz (`/ui/`) ve iş mantığı (`/modules/`) dosyaları doğrudan Firebase SDK fonksiyonlarını çağırmaz. Tüm veri erişimi `/services/` (Data Access Layer) köprüsü üzerinden yürütülür.
* **Gelecek Vizyonu:** P2P, merkezi sunucusuz, doğrudan yerel cihazların birbiriyle konuştuğu dağıtık ERP ağı.
* **Ajan Yasağı:** UI bileşenlerinin veya modal pencerelerin içine doğrudan `getFirestore()`, `collection()`, `setDoc()` gibi sağlayıcıya özel kodlar GÖMÜLEMEZ.

---

## 2. SİSTEMDE YAŞAYAN KÜRESEL YAPILAR (ACTIVE GLOBAL PRIMITIVES)

Her geliştiricinin bilmesi ve koruması gereken mevcut çekirdek yapılar:

1. **`window.AppEnv` ve `ENV_GUARD` (Ortam İzolasyonu):**
   - Kod, çalıştığı alan adına bakar: `localhost` / `demo` ise test verisine (`inventory_demo`), diğer durumlarda üretim verisine (`lifeserver_master`) bağlanır. Canlı veriyle test verisi asla birbirine karışamaz.
2. **`window.AppModules.*` (İzole Ad Alanı):**
   - Global `window.*` kirliliği engellenmiştir. Tüm servisler ve mantıklar (`AppModules.Schema`, `AppModules.Assignments`, `AppModules.Backup`, `AppModules.AdminTabs`) izole namespace'lerde yaşar.
3. **Session Store & Kurumsal PRI Kimliği:**
   - Kimlik tek kaynaktan yönetilir. Kullanıcı `ad.soyad` kurumsal kimliği ile doğrulanır; veritabanında düz metin parola/kod tutulmaz.
4. **AtomicWriter ve Write-Ahead Logging (WAL):**
   - 500 işlem sınırını aşan toplu işlemlerde iki aşamalı commit uygulanır. Hata anında sistem otomatik olarak işlem öncesi durumuna döner (Rollback).
5. **Kompakt Arayüz ve PWA (Progressive Web App):**
   - Ekranlar hantal tablolar yerine parmakla yönetilen (Touch-First), duyarlı (responsive) ve tam ekran (`standalone`) çalışan bağımsız bir kabuktur.

---

## 3. AJANLAR VE GELİŞTİRİCİLER İÇİN ALTIN KURALLAR (THE GOLDEN RULES)

Projeye katkı sağlayan her varlık aşağıdaki 5 emre koşulsuz itaat eder:

* **KURAL 1 (Ayrık Sorumluluk):** UI sadece çizer; veri sadece servis katmanında işlenir; güvenlik sadece kurallarda zorlanır. Bu üç katmanı birbirine çorba eden kod anında reddedilir.
* **KURAL 2 (Fail-Closed Güvenlik):** Bir işlemde yetki veya veri belirsizse, varsayılan davranış her zaman **REDDETMEKTİR (REJECT)**. Asla "belki doğrudur" diyerek kapı açık bırakılamaz.
* **KURAL 3 (Geriye Dönük Saygı):** Canlı sistemde personeller çalışmaktadır. Yeni bir özellik eklenirken mevcut veri şeması bozulamaz; göç gerekiyorsa araç (Migration Tool) yazılmadan kod canlıya alınamaz.
* **KURAL 4 (Performans & Hafiflik):** Proje Vanilla JS ile yazılmıştır ve öyle kalacaktır. Gereksiz bir NPM paketi veya ağır bir framework eklemek yasaktır. O(N) sorgular yerine her zaman indeksli ve O(1) çözümler aranır.
* **KURAL 5 (Sözleşme Dokunulmazlığı):** Birim testleri (`test:unit`) ve Kural testleri (`test:rules`), mimarinin bekçisidir. Bir testi geçirmek için testin beklentisi gevşetilemez; kod teste uyacak şekilde mükemmelleştirilir.

---

## 4. STRATEJİK GEÇİŞ KÖPRÜSÜ (STRATEGIC ROADMAP)

Geliştirmeler bu omurgaya basarak ilerleyecektir:
- **v3.2:** Güvenlik ve stabilite temeli mühürlendi (Zero-Trust, WAL, PRI).
- **v3.5:** Bağımsız Varlık (Asset) ve Seri No Havuzu kurulacak (Dijital İkiz Sütunu hayata geçecek).
- **v4.0:** Uçtan Uca Satın Alma ve Tedarik Masası inşa edilecek (Akıllı Sözleşme mantığı simüle edilecek).
- **v5.0+ (Sovereign Era):** Firebase bağımlılığı kırılarak sistem P2P/Web3 veri defterlerine ve açık kaynaklı bağımsız backend mimarilerine taşınacak.

---

*Bu anayasa; projenin kod tabanındaki en yüksek otoritedir. Hiçbir ajan talimatı, kullanıcı aceleciliği veya geçici geliştirme isteği bu anayasanın maddelerini geçersiz kılamaz.*