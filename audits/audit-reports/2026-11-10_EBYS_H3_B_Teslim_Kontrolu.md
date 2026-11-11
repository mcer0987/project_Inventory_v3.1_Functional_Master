# H3-B teslim kontrolü ve ara yayın kararı

Tarih: 10 Kasım 2026. Çalışma ağacı: `feat/v3.4-ebys-tamamlama-h0`; HEAD: `883da91e947152d41dd6f56cbb8b6b27c1dbf10b`.

## Karar

**H3-B şema hazırlığı kabul edildi; H4 servis entegrasyonuna geçilebilir.** İncelenen kapsamda engelleyici bulgu saptanmadı. Bu karar satın alma–evrak köprüsünün tamamlandığı veya canlıya açıldığı anlamına gelmez.

Kaynaklar: H3-A veri/servis sözleşmesi, H3-B görev promptu, implementation plan, walkthrough, yeni şema modülü ve testleri; başlangıç manifestosu ve çalışma ağacı diff'i.

## Kontrol edilen davranışlar

- Birim kimliği payload içindeki `id` yerine ayrı verilen belge yolundan geliyor. Eşadlı birimler ayırt ediliyor; ad eşleşmesi geçmiş kaydı otomatik dönüştürmüyor.
- Legacy kalemsiz talep yeni fiyat/KDV zorunluluğuna sokulmuyor. Bilinmeyen motor ve karışık yeni/eski işaretçi reddediliyor.
- P/V/kök/sahip bağı, işaretçinin dar alan listesi ve tarihsel sürüm ayrımı sözleşmeye uyuyor.
- Teklif mevcut BigInt hesaplayıcıyla yeniden üretiliyor. Manuel ödenek ayrı; TRY/USD/EUR ve ondalık sınırlar test ediliyor.
- Şema 1 hash kapsamı korunuyor; şema 2 teklifi ve küçük birim künyesini kapsıyor. Sonradan oluşacak ilk onay finansı bu hash'e dahilmiş gibi sunulmuyor.
- Yeni modülde Firebase/DOM çağrısı yok. Ürün kaynaklarında modüle referans bulunmadı; ek SDK okuma/yazma/dinleyici 0. Bu tespit canlı fatura ölçümü değildir.

## Bağımsız yeniden çalıştırma

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| `npm run test:unit` | 352/352; çıkış 0 | `scratch/ebys-h3b-review/unit.log` |
| `npm.cmd run test:rules` | 357/357; çıkış 0 | `scratch/ebys-h3b-review/rules.log` |
| `npm run lint:xss` | 989 dinamik ifade; izinsiz 0; çıkış 0 | `scratch/ebys-h3b-review/xss.log` |
| `node scratch/hosting-files.js` | 108/108; çıkış 0 | `scratch/ebys-h3b-review/hosting.log` |
| `git diff --check` | Çıkış 0 | Bu incelemenin komut çıktısı |
| H3-B başlangıç manifestosu | 554 dosyanın 552'si aynı; yalnız rehber taslağı ve beklenen Hosting sayacı değişmiş | `scratch/ebys-h3b-review/baseline-verification.json` |

Rules testleri ayrı 8180/4410/4510 portlarında, `demo-rules-test` projesinde ve inceleme dizinine yönlendirilmiş `XDG_CONFIG_HOME` ile çalıştırıldı. Kullanıcının 8080/9099 emülatörü sıfırlanmadı. Ürün Rules SHA-256: `b73a9f2dd06044a12cfcefc3da11341fc6cc1df3e3a56ae8d14769666c9a562e`; H3-B başlangıcıyla aynı.

H3-B kendi paketi: yeni yardımcı ve 12 test, iki rapor, rehber taslağı düzeltmeleri, Hosting beklenen sayısının 107'den 108'e çıkması. Git HEAD'e göre bütün diff H3-B'nin diff'i değildir.

## H4'e taşınan uygulama koşulları

1. Saf yardımcılar sunucu yetkilendirmesi değildir. `actorUid`, zaman damgası, revizyon, path ve bütün atomik bağlar gerçek servis/Rules katmanında doğrulanacak.
2. Ortak birim dinleyicisinin `{id: docSnap.id, ...docSnap.data()}` biçiminde payload'ın ID'yi ezebilmesi yeni adaptöre taşınmayacak. Gerçek yol ayrı tutulacak; legacy dinleyici sözleşmesi gereksiz yere değiştirilmeyecek.
3. Yeni digest hesaplaması, immutable sürüm/finans, ilk olumlu karar ve kur kaynağı eşitliği emülatörde gerçek servisle kanıtlanacak. İstemci hash'i/BigInt hesabı tek başına kötü niyetli yazımın matematik doğruluğunu sunucuda kanıtlamaz; mevcut pilot sınırı korunuyor.
4. İç içe finans ve işaretçi yedek/restore kapsamına girmeden yeni talep yolu kullanıcıya açılmayacak.
5. H3-A §8'deki ayrıntılı iş bölümü uygulanacak: H4 servis/Rules/adapter ve kurtarma; H5 ekran/onay/çıktı. H4+H5+H6a birlikte kullanıcı kabulü görmeden yeni oluşturma yolu açılmayacak.

## Ara yayın önerisi

**Uygun durak H3-B kapanışı, H4 başlamadan öncedir.** Canlıda yeni EBYS satın alma bağlantısına henüz ihtiyaç yoksa H8'in tamamlanmasını beklemek gerekmez. H0/Q0/H1/H2 düzeltmeleri ve bu hazırlık kodu, yeni köprü etkinleştirilmeden ara sürüm olarak yayınlanabilir.

Bu teknik kabul doğrudan deploy talimatı değildir. Yayından önce:

1. Test edilmiş çalışma ağacının kapsamını sabitleyip kullanıcı onayıyla yerel release commit'i oluştur. Sonraki H4 çalışması bu kontrol noktasından ayrı tutulmalı; çalışırken değişen dizinden yayın yapılmamalı.
2. H3-B'den önce gelen stok seri numarası değişikliklerini ayrı kapsam olarak kaydet: `script.js`, `stock-ledger.js`, `schema.js`, `stock-import.js` ve iki ilgili test. Kod değişiklikleri incelendi ve mevcut tam testler geçti; bu incelemede gerçek tarayıcıda Excel içe/dışa aktarım ve tam stok taşıma provası yapılmadı. Yayın öncesi bunlar ile admin/personel giriş ve temel talep işlemlerini kısa emülatör kabulünden geçir.
3. Mevcut H1 kurtarma kanıtını ve yayın öncesi yedek/geri dönüş planını kayda al. H0 süre şemalı veri oluşmuşken eski Rules'a kör dönüş yapma.
4. Hosting ve ürün `firestore.rules` aynı doğrulanmış sürümden yayınlanmalı; indeks farkı varsa aynı paketle ele alınmalı. H3-A'nın `tests/prototypes/` aday kurallarını deploy etme. `tools/`, `scratch/`, test ve raporların Hosting dışında kalması 108/108 denetimiyle doğrulandı.
5. Yayın sonrası gerçek ortamda admin/personel giriş, liste/temel envanter işlemleri ve izin hatası bulunmadığı kontrol edilmeli. Bu inceleme canlı Rules sürümünü veya canlı veriyi okumadı/değiştirmedi.

H4 başladıktan sonra H4'ün yarım entegrasyonunu bu ara sürüme katma. Mevcut satın alma akışı çalışmaya devam eder; satın alma talebinin İç Yazışmalar'a kendiliğinden bağlanması sonraki birleşik kabulde açılır.

## Sonraki çalışma ayarı

H4 için planlanan **GPT-6.1 Sol / Çok yüksek (`xhigh`)** korunuyor. Gerekçe: iki motorun aynı kayda yazmasını engelleme, ilk kararın atomik finansı, erişim bütçesi ve kurtarma zincirinin birlikte değişmesi. Bu bir proje risk değerlendirmesidir; modeller arasında ölçülmüş üstünlük iddiası değildir. Ultra/maksimum efora gerekçe yok. Resmî [reasoning rehberi](https://developers.openai.com/api/docs/guides/reasoning) daha yüksek eforun süre/maliyet karşılığını değerlendirmeyi önerir; görev promptu kapsamı ve test kapılarını açıkça sınırlar.

Bu incelemede ürün kodu değiştirilmedi; yeni teslim kontrolü ve H4 promptu yazıldı. Commit, push, merge, deploy ve canlı veri işlemi yapılmadı.
