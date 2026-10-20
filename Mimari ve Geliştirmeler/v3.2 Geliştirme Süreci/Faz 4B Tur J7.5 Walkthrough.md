# Faz 4B Tur J7.5: Kod Benzersizleştirme ve Göç Sihirbazı

## Özet
J8'de giriş "kod → personel → hesap e-postası" eşlemesiyle yapılacak; aynı kodu paylaşan iki personel varsa kişi yanlış
hesaba girer (bugünkü giriş `find(...)` ile listedeki ilk eşleşeni alıyor). Bu tur üç şey getirir: (1) bütün personel
yazma akışlarında **katı kod benzersizliği**, (2) var olan çakışmaları çözen **VIP Kod Benzersizleştirme sihirbazı** —
kod değişince J7'de açılmış hesabın **parolası da Admin SDK olmadan** yeni koda taşınır, (3) J8 için
**`filter(...).length > 1` savunma hattı**. Giriş akışı ve Firestore kuralları DEĞİŞMEDİ. Dal: `feat/phase-4b-identity-model`.

## 1. Katı kural — `src/utils/staff-code-registry.js` (yeni, saf)
Tek kural, tek yer; girişle birebir aynı normalizasyon (kırpılmış, **büyük/küçük harf duyarlı** — `completeStaffLogin`
`p.code === code`):

| Denetim | Neden |
|---|---|
| boş değil, boşluk içermez | girişte kod kırpılır; iç boşluk yazım hatasıdır |
| ≥ 4 karakter | J7 parola kuralıyla aynı (kod + dolgu ≥ Firebase alt sınırı) |
| başka personelde yok | J8 eşlemesinin tekilliği |

Uygulandığı yerler: `addPersonel` (index), `_saveQuickPersonnel` (admin hızlı ekleme) — var olan kodla kayıt durur;
`editPersonel` — kodu başka biriyle ortak olan kişi düzenlenemez, uyarı VIP aracına yönlendirir (düzenleme J7'de hesap
da açtığı için ortak kodla hesap açılmasın). Eski kontrol kırpmadan karşılaştırıyordu (`' abc12'` geçiyordu).
Uyarılar çakışan kişinin ADINI gösterir, kodu göstermez.

`getRandomCode` (iki kopya: `script.js`, `personel.js`) artık `suggestCode` kullanır: listede olmayan, karıştırılan
karakterleri (0/o, 1/l/i) içermeyen, her zaman 5 karakterlik kod. Eski üretici nadiren 1–4 karakter ya da var olan bir
kod döndürebiliyordu. Uzunluk bilinçli olarak 5'te bırakıldı (giriş girdisine dokunulmadı; 8 karakter J8 kararı).

## 2. VIP · Sistem Aksiyonları → "Kod Benzersizleştirme"
- Çakışan grupları bulur (`duplicateGroups`; grup anahtarı kod değil sıra no). Her satır: kişi, hesap rozeti, "kodu
  değişsin" kutusu, yeni kod girdisi, ↻ öneri. Varsayılan: grupta **hesabı bağlı kişi kodunu korur**, diğerlerine
  çakışmasız öneri doldurulur.
- **Satır içi denetim** her yazışta: mevcut kodlar + bu partide seçilen kodlar; grup kuralı "en fazla bir kişi kodunu
  korur". Hata varken "Uygula" kapalı.
- Onay → `window.changeStaffCodes`: parti önce `planCodeChanges` ile doğrulanır. **Yeni kod hiçbir mevcut kodla (değişecek
  olanlar dahil) ve partideki başka yeni kodla çakışamaz** — sıralı uygulamada ara durumda bile çakışma oluşmaz, yarıda
  kalan parti yeni çakışma bırakmaz (A↔B takası bilinçli olarak reddedilir).
- Kişi başına `StaffProvisioning.changeStaffCode`:

| Adım | Ayrıntı |
|---|---|
| 1. Auth | `provisioner` ikincil örneğinde **eski parolayla giriş → `updatePassword(yeni)` → `signOut`** (taze giriş "yakın zamanda oturum" koşulunu sağlar). Admin oturumu etkilenmez. |
| 2. Firestore | `personel.code` (admin yazması). Hesap var ama bağlı değilse (J7 `link-failed`) uid de bağlanır. |
| Kayıt düşerse | Parola **eski koda geri alınır**; geri alma da düşerse durum açıkça raporlanır ve aynı yeni kodla tekrar uygulamak tamamlar (eski parola tutmazsa yeni parola denenir → yalnız kayıt yazılır). |
| Hesap yok | Yalnız kod değişir (`changed-code-only`); hesap sonra J7 ile yeni kodla açılır. |
| Bağlı hesap iki parolayla da açılmıyor | `auth-out-of-sync` — hiçbir şey yazılmaz; yerel `firebase-admin` sıfırlaması gerekir. |
| Kota | Toplu iş durur, kalan sayı bildirilir. |

- Sonuç satır satır gösterilir; yeni kodlar yalnız yöneticinin gördüğü girdilerde kalır (personele iletmek için),
  uyarı / VIP logu / konsola yazılmaz. Modal DOM API ile kurulur (innerHTML yok).

## 3. J8 savunma hattı — `StaffCodeRegistry.resolveLoginCode(personel, code)`
`filter(...)` ile tüm eşleşmeleri sayar: `> 1` → **`ambiguous`** (giriş reddedilmeli, ilk eşleşmeye asla düşülmez),
`0` → `none`, `1` → `unique` + kişi. Bu turda girişe bağlanmadı (J8 kapsamı); birim ve emülatör testleriyle sabitlendi.

## Test sonuçları

| Paket | Sonuç |
|---|---|
| `npm run test:unit` | 79/79 (yeni: `staff-code-registry.test.mjs` 6, `changeStaffCode` 7) |
| `npm run test:staff:emu` | 11/11 (yeni J7.5: 4) |
| `node scratch/flow-tests.js --emu` | 52/52 (yeni `j75CodeWizard`) · 0 sayfa hatası · 0 CSP ihlali |
| `npm run test:rules` / `test:atomic:emu` | 72/72 · 5/5 |
| `npm run lint:xss` | 0 izinsiz (45 dosya) |
| `node scratch/hosting-files.js` | 54/54 ✔ (yeni modül: `EXPECTED_COUNT` 53 → 54) |

Emülatörde kanıtlananlar (gerçek Auth + Firestore, üretim kuralları): kod değişince **eski parola geçersiz, yeni parola
aynı uid'yi açar**, admin oturumu düşmez; `resolveLoginCode` önce `ambiguous`, sonra iki kişi için de `unique`; kayıt
yazması **gerçek kural reddiyle** düşünce parola eski koda döner; parolası sapmış hesapta hiçbir şey yazılmaz.
Tarayıcıda (gerçek admin, `j75CodeWizard`): ortak kodlu kişinin düzenlemesi ve ortak/kısa kodla ekleme/hızlı ekleme
engellenir; sihirbazın varsayılanları, satır içi ✗/✓ ve grup kuralı, uygulama sonrası Firestore + Auth durumu.

## Kalan / J8 girdileri
- `resolveLoginCode` J8 giriş fonksiyonuna bağlanacak (`ambiguous` → giriş reddi + yöneticiye yönlendirme).
- Kod benzersizliği istemci kuralıdır; Firestore kuralları tekilliği denetleyemez (sorgu yok). Veri katmanına doğrudan
  yazan bir yol (ör. konsol, yedek geri yükleme) çakışma üretebilir → sihirbaz tekrar çalıştırılabilir; J8 savunması
  bu durumda girişi reddeder.
- `auth-out-of-sync` ve personel silindiğinde hesap silme hâlâ yerel `firebase-admin` betiğinin işi (yazılmadı).
