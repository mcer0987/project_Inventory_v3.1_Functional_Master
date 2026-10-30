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
    const versionOrder = ["v3.0", "v3.1", "v3.2", "v3.3"];
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
