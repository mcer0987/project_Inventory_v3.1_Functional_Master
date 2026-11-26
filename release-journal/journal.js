(() => {
    const releases = {
        "v3.0": {
            phase: "Temeli kurma dönemi",
            highlights: [
                {
                    label: "Veri temeli", kind: "MİMARİ BAŞLIK", headline: "Veriyi taşı, sözleşmesini kaybetme.",
                    body: "Migration yaklaşımı ve canlı tablo güncelleme fikri kaynaklarda anlatılıyor. Ancak migration'ın tamamlandığını gösteren kayıt bu arşivde yok.",
                    tags: ["Migration", "Schema", "Canlı güncelleme"], source: "v3.0 Phase 0 planları ve öz-doğrulama notu. İşlem yöneticinin ayrıca başlatmasını bekliyor; tamamlanma durumu belirtilmemiş.",
                    scene: "data", code: "DATA / 01", glyph: "◈", caption: "VERİ AKIŞI", chipA: "SCHEMA", chipB: "LIVE",
                    technique: {
                        label: "MIGRATION AKIŞI", intro: "Kaynaklarda anlatılan migration yaklaşımını üç basit adıma indiriyoruz.",
                        steps: [["▤", "Kaynağı oku", "Mevcut şemayı tanı"], ["⇢", "Göçü hazırla", "Yeni sözleşmeye dönüştür"], ["◉", "Durumu doğrula", "Sonucu kayıt altına al"]],
                        takeaway: "Adımlar anlatılıyor; migration tamamlanmış varsayılmıyor.", source: "v3.0 Phase 0 · öz-doğrulama"
                    }
                },
                {
                    label: "Mobil deneyim", kind: "ÜRÜN DENEYİMİ", headline: "Bir işlem, küçük ekranda da akıcı olmalı.",
                    body: "Touch-first etkileşimler, kart düzeni ve daha sade gezinme üzerine çalışmalar arşivlenmiş. Bunlar kullanım niyetini anlatıyor; tüm ekranları kapsayan tek bir yayın kanıtı değil.",
                    tags: ["Dokunmatik", "Kart görünümü", "Bottom sheet"], source: "v3.0 Phase 1–3 walkthrough ve Phase 2 raporundaki 15/15 tarihsel beyanı. Ham çıktı bu kayda bağlı değil.",
                    scene: "mobile", code: "UX / 02", glyph: "▣", caption: "MOBİL AKIŞ", chipA: "TOUCH", chipB: "CARDS",
                    technique: {
                        label: "DOKUNMATİK AKIŞ", intro: "Arşivdeki mobil yaklaşım, eylemi bağlama yaklaştırıp ekran kalabalığını azaltıyor.",
                        steps: [["◎", "Öğeyi bul", "Kartta bağlamı gör"], ["＋", "Eylemi aç", "Başparmak alanına taşı"], ["✓", "İşlemi bitir", "Durumu görünür kıl"]],
                        takeaway: "Etkileşim yolu raporlanıyor; uçtan uca sonuç ayrıca kanıtlanmış değil.", source: "v3.0 Phase 1–3 · walkthrough"
                    }
                },
                {
                    label: "Operasyon araçları", kind: "YÖNETİM AKIŞI", headline: "Günlük operasyonu görünür kıl.",
                    body: "Yönetici mesajı, bakım modu, yedek geri yükleme ve God-Eye/heatmap gibi kavramlar geliştirme notlarında yer alıyor. Fikir ile gerçek canlı kullanıcı takibi arasındaki sınır korunmalı.",
                    tags: ["Yönetici araçları", "Bakım modu", "God-Eye planı"], source: "v3.0 Phase 4–6 raporları. God-Eye için gerçek presence veya güvenilir kick davranışı kanıtlanmamış.",
                    scene: "ops", code: "OPS / 03", glyph: "✣", caption: "OPERASYON", chipA: "ADMIN", chipB: "SIGNAL",
                    technique: {
                        label: "OPERASYON SİNYALİ", intro: "Planlanan yönetim akışı, sistem durumunu personele anlaşılır bir sinyalle iletmeyi hedefliyor.",
                        steps: [["⚑", "Durumu seç", "Bakım veya mesaj niyeti"], ["⌁", "Sinyali üret", "Panel ve arayüz akışı"], ["◌", "Sonucu izle", "Presence kanıtı gerekli"]],
                        takeaway: "Arayüz ve plan var; gerçek zamanlı personel takibi doğrulanmış değil.", source: "v3.0 Phase 4–6 · God-Eye planları"
                    }
                }
            ]
        },
        "v3.1": {
            phase: "Modüllere ayrışma dönemi",
            highlights: [
                {
                    label: "Modüler ESM", kind: "MİMARİ DÖNÜŞÜM", headline: "Sorumlulukları ayır, değişimi kolaylaştır.",
                    body: "v3.1 walkthrough'ları büyük uygulama akışını ESM parçalarına ayırma ve AppModules namespace stratejisini anlatıyor. Task listesinde final adımı boş bırakılmış; bu yüzden tüm modüllerin kapanışı varsayılmıyor.",
                    tags: ["ESM", "AppModules", "Modül sınırları"], source: "Phase 2 ESM walkthrough'ları ve Phase 2_task.md. Final adımın durumu belirsiz.",
                    scene: "module", code: "ARCH / 01", glyph: "⟡", caption: "MODÜL HARİTASI", chipA: "IMPORT", chipB: "BOUNDARY",
                    technique: {
                        label: "MODÜLLEŞME", intro: "Yürütme girişini, iş kurallarını ve arayüz parçalarını ayrı sorumluluklar halinde düşün.",
                        steps: [["⌘", "Girişi başlat", "Uygulama başlangıç noktası"], ["⟡", "Modüllere böl", "Auth · data · UI"], ["↔", "Sınırları bağla", "Açık import sözleşmeleri"]],
                        takeaway: "Walkthrough modülerleşmeyi anlatıyor; faz kapanışı tam belgelenmemiş.", source: "v3.1 · ESM walkthrough / task listesi"
                    }
                },
                {
                    label: "EBYS iş akışı", kind: "İŞ AKIŞI DÜZELTMESİ", headline: "Belge akışı, yetkiyle birlikte ilerlesin.",
                    body: "EBYS workflow state ve authorization için hata düzeltme walkthrough'u var. Bu, iş akışının durum/yetki bağını toparlama çalışması olarak sunulabilir; bağımsız koşum çıktısı arşivde eşlik etmiyor.",
                    tags: ["Workflow state", "Authorization", "EBYS"], source: "bugfix reports içindeki v3.1 EBYS Workflow State & Authorization Fixes walkthrough'u.",
                    scene: "workflow", code: "FLOW / 02", glyph: "⇄", caption: "BELGE ROTASI", chipA: "STATE", chipB: "ROLE",
                    technique: {
                        label: "EBYS DURUM AKIŞI", intro: "Güvenilir belge akışında kimde olduğu ve hangi adımda durduğu birlikte izlenir.",
                        steps: [["▧", "Belgeyi al", "Süreç kaydı oluşur"], ["♙", "Yetkiyi denetle", "Rol ve atanma kontrolü"], ["⇢", "Durumu ilerlet", "İşlem kaydı güncellenir"]],
                        takeaway: "Düzeltme raporu var; bağımsız yürütme kanıtı bulunmuyor.", source: "v3.1 · EBYS state/yetki walkthrough"
                    }
                },
                {
                    label: "Oturum ve kimlik", kind: "GÜVENLİK AKIŞI", headline: "Çıkış, gerçekten temiz bir başlangıç olsun.",
                    body: "Logout soft reset, observer ve biyometrik/self-approval akışları ele alınmış. Bugfix raporlarında WebAuthn olmayan cihazlarda bypass ve yerel oturum temizliği sorunları da bulunduğu için özellikler güvenlik garantisi olarak sunulmuyor.",
                    tags: ["Logout reset", "Observer", "Biyometrik akış"], source: "v3.1 bugfix reports ve security biometrics walkthrough'ları.",
                    scene: "session", code: "AUTH / 03", glyph: "◎", caption: "OTURUM SINIRI", chipA: "RESET", chipB: "VERIFY",
                    technique: {
                        label: "OTURUM KAPANIŞI", intro: "Bir oturumun sonlanması, yalnızca ekranı kapatmakla kalmamalı; bellekteki bağlı durumu da temizlemeli.",
                        steps: [["↗", "Çıkışı başlat", "Oturum sonlandırma"], ["⌫", "Durumu temizle", "Observer ve yerel state"], ["⛨", "Yeniden doğrula", "Giriş kontrolü" ]],
                        takeaway: "Arşivde güvenlik sorunlarını ele alan düzeltme kayıtları da var.", source: "v3.1 · logout ve biometrics kayıtları"
                    }
                }
            ]
        },
        "v3.2": {
            phase: "Sağlamlaştırma dönemi",
            highlights: [
                {
                    label: "Yazma bütünlüğü", kind: "VERİ GÜVENLİĞİ", headline: "Yarım kalan yazma, yarım veri bırakmasın.",
                    body: "Stabilizasyon belgeleri WAL tabanlı büyük yazma, rollback ve kurtarma yaklaşımını öne çıkarıyor. Bu anlatım, kayıtlı mimari işi tanımlar; burada geri yükleme işlemi çalıştırıldığı anlamına gelmez.",
                    tags: ["WAL", "Rollback", "Recovery"], source: "v3.2 Master Stabilizasyon Planı ve ilgili Faz 4/5 walkthrough'ları.",
                    scene: "wal", code: "DATA / 01", glyph: "↻", caption: "WRITE JOURNAL", chipA: "COMMIT", chipB: "RECOVER",
                    technique: {
                        label: "WAL YAZMA DÖNGÜSÜ", intro: "Write-ahead logging fikri, ana veriyi değiştirmeden önce değişikliği kayda alır.",
                        steps: [["≋", "Değişikliği yaz", "Journal girdisi hazırla"], ["✓", "İşlemi uygula", "Atomik sonucu kaydet"], ["↶", "Hata olursa dön", "Rollback/kurtarma yolu"]],
                        takeaway: "Bu, arşivdeki teknik yaklaşımın özeti; güncel üretim garantisi değildir.", source: "v3.2 · stabilizasyon walkthrough'ları"
                    }
                },
                {
                    label: "Şema sözleşmeleri", kind: "VERİ MODELİ", headline: "B1, B2 ve B3 aynı dili konuşsun.",
                    body: "Birim, ürün ve personel şemalarının sözleşme etrafında standardize edilmesi; yazma yollarında tutarlılık ve migration sonrası uyum hedeflenmiş.",
                    tags: ["B1 / B2 / B3", "Schema contract", "Migration"], source: "v3.2 Faz 4–5 stabilizasyon ve kapanış kayıtları.",
                    scene: "schema", code: "SCHEMA / 02", glyph: "▦", caption: "CONTRACT MAP", chipA: "B1 · B2", chipB: "B3",
                    technique: {
                        label: "ŞEMA SÖZLEŞMESİ", intro: "Aynı kayda yazan ekranlar ortak veri şeklini kabul etmeli; geçiş sırasında eski veriyi de hesaba katmalı.",
                        steps: [["▤", "Şemayı tanımla", "Alan ve tip sözleşmesi"], ["⌕", "Girdiyi doğrula", "Uyumsuz şekli yakala"], ["⇄", "Geçişi yönet", "Eski/yeni biçim uyumu"]],
                        takeaway: "Şema standardı raporlanıyor; her çalışma zamanı yoluna ilişkin ayrı kanıt gerekir.", source: "v3.2 · Faz 4/5 kayıtları"
                    }
                },
                {
                    label: "İz ve çıktılar", kind: "OPERASYONEL KAYIT", headline: "İşlem görünür olsun, belge iz bırakabilsin.",
                    body: "Audit log, zimmet PDF'i, PWA ve görsel WMS gibi kullanıcıya dönük çıktılar stabilizasyon kayıtlarında birlikte anılıyor. Her parçanın yayın ve doğrulama durumu aynı değil.",
                    tags: ["Audit log", "Zimmet PDF", "PWA / WMS"], source: "Faz 5 kapanış walkthrough'u ve RELEASE_v3.2.md.",
                    scene: "audit", code: "TRACE / 03", glyph: "⌁", caption: "AUDIT TRAIL", chipA: "EVENT", chipB: "RECORD",
                    technique: {
                        label: "İZLENEBİLİR İŞLEM", intro: "Bir işlem; kullanıcı eyleminden kayıt izine, oradan okunabilir bir çıktıya bağlanmalı.",
                        steps: [["⚑", "Olayı üret", "Kim · ne · ne zaman"], ["≋", "İzi kaydet", "Audit log girdisi"], ["▤", "Çıktıyı sun", "Rapor veya belge"]],
                        takeaway: "Sürüm notları bu parçaları raporluyor; üretimdeki etkinlik ayrıca doğrulanmalı.", source: "v3.2 · Faz 5 / RELEASE kaydı"
                    }
                }
            ]
        },
        "v3.3": {
            phase: "Sahaya yaklaşma dönemi",
            highlights: [
                {
                    label: "Görsel WMS", kind: "DEPO DENEYİMİ", headline: "Rafı bir hücre değil, bir yer olarak gör.",
                    body: "Görsel raf sistemi ve kapasite anlatıları depo yerleşimini arayüzde görünür kılmayı hedefliyor. Bu kayıtlar proje geliştirme notlarıdır; deploy kanıtı olarak yorumlanmamalı.",
                    tags: ["Visual WMS", "Raf kapasitesi", "Konum"], source: "v3.3 Görsel Raf Sistemi ve Aşama 4–5 WMS walkthrough'u.",
                    scene: "wms", code: "WMS / 01", glyph: "▦", caption: "RACK MAP", chipA: "AISLE A", chipB: "CAPACITY",
                    technique: {
                        label: "GÖRSEL RAF HARİTASI", intro: "Yer, kapasite ve stok adedi aynı bağlamda görünür olduğunda saha kararı hızlanır.",
                        steps: [["⌖", "Konumu seç", "Raf / göz adresi"], ["▦", "Kapasiteyi gör", "Dolu · boş · sınır"], ["◈", "Stoğu eşle", "Ürün ve miktar"]],
                        takeaway: "Görsel WMS geliştirme kayıtlarında anlatılıyor; üretime çıkışı bu arşivde doğrulanmadı.", source: "v3.3 · WMS ve raf raporları"
                    }
                },
                {
                    label: "Ledger ve stok", kind: "İŞLEM BÜTÜNLÜĞÜ", headline: "Her hareket, sayacı da yanında taşısın.",
                    body: "Transaction/ledger, stok ve raf sayacı akışları; hareketlerin tutarlı biçimde işlenmesini hedefliyor. Raporlarda farklı yerel test sonuçları var ve bunlar tek bir release snapshot'ına bağlı değil.",
                    tags: ["Transaction", "Ledger", "Raf sayacı"], source: "Aşama 1 yazma haritası ve Aşama 2 transaction/stock walkthrough'ları.",
                    scene: "ledger", code: "STOCK / 02", glyph: "⇄", caption: "STOCK LEDGER", chipA: "TXN", chipB: "COUNTER",
                    technique: {
                        label: "STOK HAREKETİ", intro: "Bir ürün hareketi ile stok ve raf sayacı aynı işlem sonucunda güncellenmeli.",
                        steps: [["↔", "Hareketi al", "Giriş / çıkış talebi"], ["≋", "Ledger'a işle", "İşlem izi oluştur"], ["▦", "Sayacı uzlaştır", "Stok ve kapasite"]],
                        takeaway: "Transaction yaklaşımı raporlanmış; metrikler yerel test beyanı olarak kalıyor.", source: "v3.3 · Aşama 1–2 raporları"
                    }
                },
                {
                    label: "Excel içe aktarma", kind: "OPERASYON AKIŞI", headline: "Eksik rafı bul, doğru yere yönlendir.",
                    body: "Excel içe aktarmada auto-create/overflow, havuz sekmesi ve ürün klonlama akışları işlenmiş. Kayıtlar aşama bazında ve yerel geliştirme dalında; yayın/yedekle eşleştirilememiş.",
                    tags: ["Excel import", "Auto-create", "Overflow / havuz"], source: "P1 Fix Excel Import Raf Sayacı, Aşama 4–5 WMS ve Aşama 6–7 raporları.",
                    scene: "import", code: "IMPORT / 03", glyph: "⇩", caption: "SHEET → STOCK", chipA: "ROWS", chipB: "OVERFLOW",
                    technique: {
                        label: "İÇE AKTARMA ROTASI", intro: "Toplu satırları doğrula, bulunmayan yeri belirle ve belirsiz kaydı gözden geçirilecek havuza al.",
                        steps: [["▤", "Satırları oku", "Dosya ve alanlar"], ["⌕", "Eşle / oluştur", "Ürün ve raf kuralı"], ["▧", "Havuza yönlendir", "Overflow incelemesi"]],
                        takeaway: "Rapor edilen akış anlatısı; tek bir deploy snapshot'ında doğrulanmış değil.", source: "v3.3 · Excel import ve Aşama 6–7"
                    }
                }
            ]
        },
        "v3.4": {
            phase: "CSP ve depo sınırları dönemi",
            highlights: [
                {
                    label: "KJ-6 & XSS / CSP", kind: "GÜVENLİK SERTLEŞTİRME", headline: "Satır içi betiği kapat, delegasyona geç.",
                    body: "Tüm etkileşimler HTML içindeki inline onclick/onkeyup yerine veri nitelikli (data-action + bindActions) delegasyona taşındı; escapeHtml kapsayıcılığı statik taramayla doğrulandı.",
                    tags: ["KJ-6", "CSP script-src 'none'", "data-action"], source: "v3.4 Konsol Log ve CSP Sıkıştırması klasöründeki KJ-6 Faz 1 raporu, kj6-browser-check.txt ve kj6-lint-xss.txt.",
                    scene: "ops", code: "CSP / 01", glyph: "⛨", caption: "DELEGATION", chipA: "DATA-ACTION", chipB: "0 SINK",
                    technique: {
                        label: "GÜVENLİ ETKİLEŞİM", intro: "Kullanıcı tıklaması veya tuş basışı ham HTML niteliği üzerinden değil delegasyon haritasından geçer.",
                        steps: [["⛨", "Veriyi kaçır", "escapeHtml veya textContent"], ["◈", "Eylemi işaretle", "data-action & data-id"], ["✓", "Kısıtlı test et", "CSP inline kapalıyken geç"]],
                        takeaway: "Tarayıcı testi script-src 'none' başlığı altında pageErrors=0 ile çalıştırıldı.", source: "v3.4 · KJ-6 raporu ve kanıtları"
                    }
                },
                {
                    label: "Salt-okunur depo", kind: "YETKİ SINIRI", headline: "Personel stoğu görsün, yalnız çıkış ekranından düşsün.",
                    body: "staff-guards.js ile B1/B2 depo araç çubuğu personel için salt-okunur yapıldı; sarf malzeme çıkışları Envanter Çıkışı Yap akışına toplandı ve geliştirici kısayol koruması eklendi.",
                    tags: ["staff-guards.js", "Sarf çıkışı", "capture guard"], source: "v3.4 · Personel Envanter Çıkışı ve Salt-Okunur Depo Walkthrough + Test Kanıtları.",
                    scene: "session", code: "GUARD / 02", glyph: "🔒", caption: "READONLY BAR", chipA: "STAFF", chipB: "RULES",
                    technique: {
                        label: "İKİ KATMANLI KORUMA", intro: "Arayüzdeki erken yakalama kullanıcıyı yönlendirir; asıl red kararı sunucudaki Firestore kurallarında kalır.",
                        steps: [["⚑", "Rolü tanı", "body.staff-readonly durumu"], ["✋", "Barı durdur", "Capture fazında tek uyarı"], ["⛨", "Kuralda kilitle", "Sunucu tarafı yazma reddi"]],
                        takeaway: "Arayüz kolaylığı sunucu güvenlik duvarının yerine geçmez; kurallar tek nihai hakemdir.", source: "v3.4 · Salt-Okunur Depo Walkthrough"
                    }
                },
                {
                    label: "Talep & İade onayı", kind: "SÜREÇ DOĞRULAMASI", headline: "Talep ve iade stokla çelişmesin.",
                    body: "Personel talep onayı ve zimmet iade talebi akışları incelenip atomik stok ve hareket defteri tutarlılığıyla eşleştirildi.",
                    tags: ["Talep onayı", "İade talebi", "B3 tutarlılık"], source: "v3.4 · Talep Onay Süreci Doğrulaması ve İade Talebi Uygulama Planı + Test Kanıtları.",
                    scene: "ledger", code: "FLOW / 03", glyph: "⇄", caption: "TALEP / İADE", chipA: "APPROVE", chipB: "RETURN",
                    technique: {
                        label: "TALEP-STOK BAĞI", intro: "Onaylanan talep ya da iade kaydı envanter ve B3 hareket defterini tek bir mantık üzerinden besler.",
                        steps: [["▤", "Talebi doğrula", "Yetki ve stok yeterliliği"], ["⇄", "Stok & B3 yaz", "Atomik transaction"], ["✓", "Zimmeti kapat", "İade durumu güncellenir"]],
                        takeaway: "Talep ve iade adımları ayrı belge/kanıt notlarıyla doğrulandı.", source: "v3.4 · Talep & İade kanıtları"
                    }
                }
            ]
        },
        "v3.5": {
            phase: "Kurumsal EBYS dönemi (H0–H8)",
            highlights: [
                {
                    label: "Katalog & Döviz", kind: "TEMEL VERİ", headline: "Sabit kimlik, donmuş kur.",
                    body: "Kurum künyesi, dosya planı ve üst yazı şablonları sürümlendi; satın alma taleplerinde çok kalemli TRY/USD/EUR sepeti eklendi ve kur ilk olumlu kararda donduruldu.",
                    tags: ["Künye/Dosya Planı", "Döviz kilidi", "reportingTotalTRY"], source: "v3.5 · EBYS Aşama 2–3 ve H6b Katalog Walkthrough'ları.",
                    scene: "schema", code: "CATALOG / 01", glyph: "📄", caption: "DÖVİZ KİLİDİ", chipA: "REVISION", chipB: "FX LOCK",
                    technique: {
                        label: "FİNANSAL DONDURMA", intro: "İlk paraf/onay anında seçilen kur ve tarih kopyalanır; sonraki kur değişimleri geçmişi bozmaz.",
                        steps: [["▦", "Sepeti kur", "TRY / USD / EUR kalemler"], ["🔒", "Kuru kilitle", "İlk olumlu kararda snapshot"], ["▤", "Çıktıyı koru", "Sabit TL raporu üret"]],
                        takeaway: "Eski tek-ürünlü kayıtlar göç gerektirmeden sanal tek kalemle uyumlu gösterilir.", source: "v3.5 · Aşama 3 ve H8 kabul raporu"
                    }
                },
                {
                    label: "Evrak & Onay rotası", kind: "DİJİTAL MÜHÜR", headline: "Dondurulan evrak değişmez; sıra gelmeden görünmez.",
                    body: "SaveDraft ve FreezeVersion ile SHA-256 özetli değişmez sürümler ve sayaçsız kriptografik kayıt no kuruldu; sıralı onay adımlarında sırası gelmeyen görevler izole edildi.",
                    tags: ["SHA-256 sürüm", "EBYS kayıt no", "Sıralı görev"], source: "v3.5 · EBYS Aşama 4–5, Q0 ve H1–H5 walkthrough belgeleri.",
                    scene: "wal", code: "EBYS / 02", glyph: "❖", caption: "SEAL & ROUTE", chipA: "SHA-256", chipB: "TASKS",
                    technique: {
                        label: "SÜRÜM MÜHÜRLEME", intro: "İçerik taslakta düzenlenir; dondurulduğu anda özetle mühürlenir ve imza adımlarına açılır.",
                        steps: [["✎", "Taslak & Kayıt No", "EBYS-{KURUM}-{YYMMDD}"], ["◈", "Sürümü dondur", "SHA-256 contentDigest"], ["⇢", "Sıralı onayla", "Paraf → Onay görev akışı"]],
                        takeaway: "İade veya revizyon halinde eski kararlı sürüm kilitli kalır, yeni sürüm açılır.", source: "v3.5 · H1–H5 / H8 walkthrough"
                    }
                },
                {
                    label: "Havale, İcra & QR", kind: "H7–H8 KAPANIŞ", headline: "Cevap bağı, gönderim ve açık doğrulama.",
                    body: "Gelen evraka İlgi bağı, mükerrer dış kayıt kontrolü, manuel gönderim (KEP/elden/posta), icra tamamlama, herkese açık QR doğrulama (verify.html) ve 114 belgeli H8 kurtarma tatbikatı kapatıldı.",
                    tags: ["H7 yazışma", "verify.html QR", "114 belge kurtarma"], source: "v3.5 · 2026-11-18_EBYS_H8_Birlesik_Kabul_ve_Kurtarma_Walkthrough.md.",
                    scene: "audit", code: "H8 / 03", glyph: "✓", caption: "END-TO-END", chipA: "QR VERIFY", chipB: "RECOVERY",
                    technique: {
                        label: "TAM KURUMSAL DÖNGÜ", intro: "Son onayla tek icra işi açılır; gönderim ve arşiv sonrası QR ile 5 açık alan dış dünyaya doğrulanır.",
                        steps: [["⇄", "İcra & Gönderim", "Sorumlu atama ve dispatch"], ["▣", "QR mühür", "verify.html açık doğrulama"], ["↻", "Kurtarma testi", "114 belge tam geri dönüş"]],
                        takeaway: "Spark okuma/yazma kotaları ve 9 bozuk paket reddi emülatörde kanıtlandı.", source: "v3.5 · H8 kapanış walkthrough"
                    }
                }
            ]
        },
        "v3.6": {
            phase: "Saha zekâsı dönemi (İP-1..İP-4)",
            highlights: [
                {
                    label: "İP-1 Sayım kilidi", kind: "DEPO GÜVENLİĞİ", headline: "Sayımdaki rafın taşı yerinden oynamasın.",
                    body: "WMS raf kilidi (lockReason, rafPasif) devreye girdi: sayımdaki rafların ürünleri listelerden ve personelden gizlenir; çıkış, zimmet, transfer ve talep sunucu kuralıyla engellenir.",
                    tags: ["İP-1", "lockReason", "rafPasif"], source: "v3.6 · 00_v3.6_Surum_Ozeti_ve_Mimari_Miras_Raporu.md ve İP-1 Walkthrough.",
                    scene: "wms", code: "WMS / 01", glyph: "🔒", caption: "COUNT LOCK", chipA: "SHELF", chipB: "FAIL-CLOSED",
                    technique: {
                        label: "ÇİFT KİLİT MİMARİSİ", intro: "Raf kilidi ve ürün bayrağı birbirini yedekler; tek biri dahi aktifse işlem kuraldan reddedilir.",
                        steps: [["🔒", "Rafı kilitle", "lockReason + auditLogs"], ["◌", "Listeden gizle", "B1/B2 ve aramada gizli"], ["🔓", "Sayımı kapat", "Bayraklar raf kilidine döner"]],
                        takeaway: "Eski active:false rafların kilit sayılmaması için ayrı kilit alanları seçildi.", source: "v3.6 · İP-1 Mimari Karar"
                    }
                },
                {
                    label: "İP-2 Envanter No", kind: "VARLIK KİMLİĞİ", headline: "Demirbaş plakası kalıcı, değişim ise kayıtlı olsun.",
                    body: "Dolu Envanter No ürün formundan kilitlendi; çıkış ve sevkte tek adetli demirbaşlar numarayı kilitli taşır. Değişim yalnız Operasyon Merkezi'nden gerekçeli denetim kaydıyla yapılır.",
                    tags: ["İP-2", "DeviceIds.fixedFor", "envanterNoChangeOk"], source: "v3.6 · İP-2 Walkthrough ve 00_v3.6_Surum_Ozeti_ve_Mimari_Miras_Raporu.md.",
                    scene: "schema", code: "ASSET / 02", glyph: "🏷️", caption: "ASSET PLATE", chipA: "IMMUTABLE", chipB: "AUDIT",
                    technique: {
                        label: "DENETİMLİ PLAKA DEĞİŞİMİ", intro: "Normale kapalı plaka güncellemesi aynı commit'te sonEnvanterNoDegisimId denetim belgesi ister.",
                        steps: [["🏷️", "Plakayı kilitle", "Dolu envanterNo salt-okunur"], ["⇄", "Gerekçeli değiştir", "runInventoryNoRename"], ["⌁", "Zinciri koru", "fromValue → toValue izi"]],
                        takeaway: "Kurallar !exists + getAfter denetimiyle sunucuda zorlanır.", source: "v3.6 · İP-2 kurallar"
                    }
                },
                {
                    label: "İP-3 & İP-4", kind: "SAHA & PERFORMANS", headline: "Sahada akıcı form, VIP'te sızıntısız döngü.",
                    body: "Mobil klavyede alanların gizlenmesini önleyen form-keyboard-nav.js (visualViewport) eklendi; VIP konsol ve SVG heatmap rAF/innerHTML sızıntılarından arındırıldı.",
                    tags: ["İP-3 visualViewport", "İP-4 Heatmap", "development-notice"], source: "v3.6 · İP-3, İP-4 walkthrough'ları ve commit 306aa10.",
                    scene: "mobile", code: "FIELD / 03", glyph: "⌨️", caption: "MOBILE / VIP", chipA: "VIEWPORT", chipB: "ZERO-LEAK",
                    technique: {
                        label: "KLAVYE & YAŞAM DÖNGÜSÜ", intro: "Form açıkken görünür yükseklik izlenir; VIP panelde animasyon yalnız sekme görünürken yaşar.",
                        steps: [["⌨️", "Klavyeyi ölç", "--vv-h & ‹ Önceki/Sonraki ›"], ["⚡", "rAF'ı durdur", "Sekme gizliyse döngü kapalı"], ["✓", "DOM'u koru", "DocumentFragment & textContent"]],
                        takeaway: "Hosting beyaz listesi bu sürüm sonunda 120 dosyaya güncellendi.", source: "v3.6 · İP-3 / İP-4 kapanışı"
                    }
                }
            ]
        },
        "v3.7": {
            phase: "Omurga ve sayım masası dönemi (İP-5..İP-13)",
            highlights: [
                {
                    label: "SoC & Yetki Devri", kind: "MİMARİ & YETKİ", headline: "Monoliti böl, yönetici yetkisini panelden ver.",
                    body: "script.js (2.350 satır → 539 satır) 6 modüle bölündü; B3 Çıkışı Geri Al transaction'a bağlandı ve eski Admin SDK claim yolu kaldırılarak taze parolalı belge yetki devrine geçildi.",
                    tags: ["İP-5 SoC", "İP-6 undoExit", "İP-7 Yetki Devri"], source: "v3.7 · 00_v3.7_Surum_Ozeti... ve İP-7 Aşama A/B walkthrough'ları.",
                    scene: "module", code: "ARCH / 01", glyph: "⌘", caption: "SOC & GRANT", chipA: "6 MODULES", chipB: "ZERO-TRUST",
                    technique: {
                        label: "BELGE TABANLI YETKİ", intro: "Ana yönetici 10 dakikalık taze parola ile yetki verir; her verme/alma değişmez denetim kaydı bırakır.",
                        steps: [["⛨", "Parolayı doğrula", "Taze reauth oturumu"], ["✎", "Eşlemeyi yaz", "staffAccounts + auditLogs"], ["✕", "Eski yolu kapat", "inventoryLiveAdmin kaldırıldı"]],
                        takeaway: "İP-7 Aşama A canlıda doğrulandı; Aşama B ve İP-10..13 dalda yayın bekliyor.", source: "v3.7 · İP-7 A/B raporları"
                    }
                },
                {
                    label: "Sayım Fark Masası", kind: "İP-10 ENVANTER SAYIMI", headline: "Depoyu kilitle, farkı masada gör, tutanağı bas.",
                    body: "shelf-count-session.js ile çoklu raf/tüm depo sayım kilidi, canlı Eksik/Fazla/Tam fark hesaplama masası, sayim-duzeltme stok işleme ve Türkçe Roboto fontlu PDF/Excel sayım tutanağı eklendi.",
                    tags: ["İP-10", "ShelfCount", "Roboto PDF Tutanak"], source: "v3.7 · 03_v3.7_Tamamlama_Paketleri... ve 04_..._Kapanis_Denetim_ve_Test_Rehberi.md.",
                    scene: "wms", code: "COUNT / 02", glyph: "📋", caption: "FARK MASASI", chipA: "BATCH LOCK", chipB: "PDF / XLSX",
                    technique: {
                        label: "FARK YÖNETİMİ AKIŞI", intro: "Sayılan adet girildikçe sistemle fark anlık hesaplanır; onaylanan farklar kilidi bozmadan işlenir.",
                        steps: [["🔒", "Rafları kilitle", "4'lü paralel güvenli kilit"], ["▤", "Sayımı gir", "Eksik / Fazla / Tam çipleri"], ["📄", "İşle & Raporla", "runProductSave + PDF tutanak"]],
                        takeaway: "shelf-count-session saf çekirdeği birim testlerle korunur.", source: "v3.7 · İP-10 denetim raporu"
                    }
                },
                {
                    label: "Rehber & Kişisel Şablon", kind: "İP-8..13 TAMAMLAMA", headline: "Kendi şablonunu sakla, rehberde akışı deneyimle.",
                    body: "Kişisel üst yazı şablonları (ebysPersonalTemplates, tam gizlilik + gelecek vekâlet kancası), VIP 3. Parti API Bağımlılık Kartı ve Yönetici/Personel çift rol simülasyonlu 3 adımlı EBYS Rehberi eklendi.",
                    tags: ["İP-11 Gizli Şablon", "İP-12 VIP API", "İP-13 Pusula"], source: "v3.7 · 03_v3.7_Tamamlama_Paketleri_Uygulama_Plani.md ve 03_v3.8_UX1_UX2_UX3...md.",
                    scene: "workflow", code: "GUIDE / 03", glyph: "🧭", caption: "SİMÜLASYON", chipA: "PRIVACY", chipB: "3 ADIM",
                    technique: {
                        label: "GİZLİLİK & REHBERLİK", intro: "Kişisel şablon personalTemplateAccessOk ile yalnızca sahibine açılır; rehber rolüne göre simülasyon kurar.",
                        steps: [["🔒", "Kendi şablonun", "ownerUid == auth.uid"], ["🔌", "Bağımlılık şeffaf", "VIP CSP envanter listesi"], ["🧭", "3 Adımda öğren", "Yönetici & Personel modu"]],
                        takeaway: "Vekâlet kancası sonraki evre için rules içinde tek fonksiyonda izole bırakıldı.", source: "v3.7 · İP-11/12/13"
                    }
                }
            ]
        },
        "v3.8": {
            phase: "Platinum UX ve Vizyon Evresi (UX-1..UX-5 + VP)",
            highlights: [
                {
                    label: "Analitik & Bento", kind: "UX-1 & UX-2", headline: "Yığılan çubukları ayır, tabloları karta çevir.",
                    body: "Demirbaş Stok Durumu Tür/Model yatay çubuklara, 3 grafik ise merkez toplamlı etkileşimli Doughnut ve HTML lejantlara dönüştü. 16 admin tablosu MutationObserver + enhanceBentoTable ile 390px mobilde karta dönüyor.",
                    tags: ["UX-1 Chart.js 4.4", "UX-2 Bento", "390px Taşmasız"], source: "v3.8 · 03_v3.8_UX1_UX2_UX3_Denetim_ve_Walkthrough_Raporu.md.",
                    scene: "data", code: "UX / 01", glyph: "◔", caption: "ANALYTICS", chipA: "DOUGHNUT", chipB: "BENTO 390PX",
                    technique: {
                        label: "GÖRSEL & MOBİL DÖNÜŞÜM", intro: "Tema MutationObserver ile grafik renklerini tazeler; Bento geliştiricisi satırları veri yapısını bozmadan kartlaştırır.",
                        steps: [["◔", "Grupla & Çiz", "Tür / Model ve merkez toplam"], ["▦", "data-bento işaretle", "title · status · meta · actions"], ["✓", "Doğrula", "8/8 viewport + tema taraması"]],
                        takeaway: "Türkçe İ/i büyük/küçük harf tuzağı toLocaleLowerCase('tr-TR') ile giderildi.", source: "v3.8 · UX-1/UX-2 walkthrough"
                    }
                },
                {
                    label: "Platinum & Tıkla-Seç", kind: "UX-3 & UX-4", headline: "Girişte göz kırpma yok, satırda checkbox kalabalığı yok.",
                    body: "Erken auth-hydrating perdesi Admin→Index geçişindeki loginModal kırpmasını kaldırdı; ana ekran Warm Platinum/Space Titanium tonajına kavuştu ve tablolarda B3 butonları ile Shift destekli satıra tıkla-seç aktifleşti.",
                    tags: ["UX-3 Soft Geçiş", "UX-4 Tıkla-Seç", "B3 Buton Ailesi"], source: "v3.8 · 03 & 04 denetim raporları.",
                    scene: "mobile", code: "UX / 02", glyph: "✦", caption: "PLATINUM UI", chipA: "ZERO FLICKER", chipB: "CLICK-SELECT",
                    technique: {
                        label: "YÜZEY & SEÇİM BÜTÜNLÜĞÜ", intro: "Oturum netleşene kadar cam perde ekranı tutar; veri geldiğinde tek satır/Shift aralık seçimi __index ile güvenle çalışır.",
                        steps: [["◌", "Perdeyi aç", "Oturum ipucu → loader"], ["✦", "Temayı giydir", "Platinum & Space Titanium"], ["☑", "Satıra dokun", "Shift aralık + seçim hapı"]],
                        takeaway: "Güvenlik bariyeri korunur; geçersiz oturumda perde anında loginModal'a açılır.", source: "v3.8 · UX-3 / UX-4"
                    }
                },
                {
                    label: "Marka Stüdyosu & Dock", kind: "UX-5 + VP-5 ALTYAPI", headline: "Özel logo yükle, tek katmanlı kurumsal barı paylaş.",
                    body: "Admin sidebar altından yönetilen ≤45KB PNG/JPEG/WebP özel logo + amblem/efekt stüdyosu, tam genişlikli Warm Platinum/Space Titanium dock navbar, Dry-Run rafPasif eşitleme ve gelişim günlüğü v3.4–v3.8 genişlemesi tamamlandı.",
                    tags: ["UX-5 Logo Stüdyosu", "45KB Rule Regex", "VP-5 Dry-Run"], source: "v3.8 · 04 ve 05 plan belgeleri + brand-settings emulator testleri (23/23).",
                    scene: "ops", code: "BRAND / 03", glyph: "⚙", caption: "BRAND STUDIO", chipA: "SINGLE DOCK", chipB: "DRY-RUN SYNC",
                    technique: {
                        label: "GÜVENLİ ÖZELLEŞTİRME", intro: "Yalnız beyaz listeli ve imza denetimli görseller 96px'e küçültülüp tek brand_settings belgesinde senkronlanır.",
                        steps: [["⛨", "Dosyayı kokla", "Magic bytes · SVG reddi"], ["⚙", "96px / ≤45KB", "Canvas + RE2 kural sınırı"], ["❖", "Canlı senkron", "onSnapshot + tek katman bar"]],
                        takeaway: "SVG her katmanda reddedilir; mobilde tek katman üst bar sıfır yatay taşma verir.", source: "v3.8 · UX-5 Rev-2 & VP-5"
                    }
                }
            ]
        }
    };

    const tabs = [...document.querySelectorAll(".version-tab")];
    const panels = [...document.querySelectorAll(".release-panel")];
    const highlightTabs = [...document.querySelectorAll(".highlight-tab")];
    const progress = document.querySelector(".timeline-progress");
    const versionLabel = document.getElementById("selectedVersion");
    const phaseLabel = document.getElementById("selectedPhase");
    const nextButton = document.getElementById("nextVersion");
    const nextButtonText = document.getElementById("nextVersionText");
    const readingProgress = document.getElementById("readingProgress");
    const versionOrder = ["v3.0", "v3.1", "v3.2", "v3.3", "v3.4", "v3.5", "v3.6", "v3.7", "v3.8"];
    let currentIndex = -1;
    let scrollFrame = 0;

    function syncReadingProgress() {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        readingProgress.style.width = `${maxScroll > 0 ? (window.scrollY / maxScroll) * 100 : 0}%`;
    }

    function scheduleReadingProgress() {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            syncReadingProgress();
            scrollFrame = 0;
        });
    }

    function setText(id, value) {
        document.getElementById(id).textContent = value;
    }

    function renderHighlight(index, moveFocus = false) {
        const version = versionOrder[currentIndex];
        const highlight = releases[version].highlights[index];

        highlightTabs.forEach((tab, tabIndex) => {
            const active = tabIndex === index;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
            tab.querySelector("span").textContent = `0${tabIndex + 1}`;
            tab.querySelector("b").textContent = releases[version].highlights[tabIndex].label;
        });
        if (moveFocus) highlightTabs[index].focus({ preventScroll: true });

        setText("spotlightNumber", `0${index + 1} / 0${releases[version].highlights.length}`);
        setText("spotlightKind", highlight.kind);
        setText("spotlightHeadline", highlight.headline);
        setText("spotlightBody", highlight.body);
        setText("spotlightSource", highlight.source);
        document.querySelector(".spotlight-note").open = false;
        setText("artCode", highlight.code);
        setText("artGlyph", highlight.glyph);
        setText("artCaption", highlight.caption);
        setText("artChipA", highlight.chipA);
        setText("artChipB", highlight.chipB);

        const art = document.getElementById("spotlightArt");
        art.dataset.scene = highlight.scene;
        const tags = document.getElementById("spotlightTags");
        tags.replaceChildren(...highlight.tags.map((tag) => {
            const item = document.createElement("span");
            item.textContent = tag;
            return item;
        }));

        document.getElementById("highlightDetail").setAttribute("aria-labelledby", `highlightTab${index}`);
        const technique = highlight.technique;
        setText("techniqueVersion", version);
        setText("techniqueLabel", technique.label);
        setText("techniqueIntro", technique.intro);
        setText("techniqueTakeawayText", technique.takeaway);
        setText("techniqueSource", technique.source);

        const flow = document.getElementById("techniqueFlow");
        flow.replaceChildren(...technique.steps.map(([icon, title, detail], stepIndex) => {
            const step = document.createElement("li");
            step.className = "flow-step";
            const number = document.createElement("span");
            number.className = "flow-index";
            number.textContent = `0${stepIndex + 1}`;
            const mark = document.createElement("span");
            mark.className = "flow-icon";
            mark.textContent = icon;
            const heading = document.createElement("b");
            heading.textContent = title;
            const note = document.createElement("small");
            note.textContent = detail;
            step.append(number, mark, heading, note);
            return step;
        }));
        flow.classList.remove("flow-arrive");
        void flow.offsetWidth;
        flow.classList.add("flow-arrive");
        scheduleReadingProgress();
    }

    function selectVersion(index, moveFocus = false) {
        const nextIndex = (index + tabs.length) % tabs.length;
        if (nextIndex === currentIndex && panels[nextIndex].classList.contains("is-visible")) return;
        currentIndex = nextIndex;
        const version = versionOrder[currentIndex];

        document.body.dataset.era = version;
        tabs.forEach((tab, tabIndex) => {
            const active = tabIndex === currentIndex;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
            if (active && moveFocus) tab.focus();
        });
        panels.forEach((panel, panelIndex) => {
            const active = panelIndex === currentIndex;
            panel.hidden = !active;
            panel.classList.toggle("is-visible", active);
            if (active) {
                panel.classList.remove("is-visible");
                void panel.offsetWidth;
                panel.classList.add("is-visible");
            }
        });
        progress.style.width = `${(currentIndex / (tabs.length - 1)) * 100}%`;
        versionLabel.textContent = version;
        phaseLabel.textContent = releases[version].phase;
        nextButtonText.textContent = currentIndex === tabs.length - 1 ? "Başa dön" : "Sonraki sürüm";
        renderHighlight(0);
        scheduleReadingProgress();
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => selectVersion(index));
        tab.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                selectVersion(index + 1, true);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                selectVersion(index - 1, true);
            } else if (event.key === "Home") {
                event.preventDefault();
                selectVersion(0, true);
            } else if (event.key === "End") {
                event.preventDefault();
                selectVersion(tabs.length - 1, true);
            }
        });
    });

    highlightTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => renderHighlight(index));
        tab.addEventListener("keydown", (event) => {
            if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "Home") renderHighlight(0);
            else if (event.key === "End") renderHighlight(highlightTabs.length - 1);
            else renderHighlight((index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + highlightTabs.length) % highlightTabs.length, true);
        });
    });

    document.querySelectorAll("[data-highlight-jump]").forEach((button) => {
        button.addEventListener("click", () => {
            const highlightIndex = Number(button.dataset.highlightJump);
            renderHighlight(highlightIndex, true);
            document.getElementById("spotlight").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        });
    });

    nextButton.addEventListener("click", () => selectVersion(currentIndex + 1));

    if ("IntersectionObserver" in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-revealed");
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.14 });
        document.querySelectorAll("[data-reveal]").forEach((element) => {
            element.classList.add("story-reveal");
            revealObserver.observe(element);
        });
    }

    window.addEventListener("scroll", scheduleReadingProgress, { passive: true });
    window.addEventListener("resize", scheduleReadingProgress, { passive: true });

    selectVersion(0);
})();
