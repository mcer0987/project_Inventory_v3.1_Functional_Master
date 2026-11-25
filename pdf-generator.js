// ═══════════════════════════════════════════════════════════════════════════════════════════
// Resmi Zimmet Tutanağı (Faz 5 · K1 · 5.1 · ZIM-04)
// [WHY]: Eski form sabit Türkçe karakter kıran Helvetica'yla tek satır basıyordu; teslim eden hep "o an oturumdaki
//        kullanıcı" sanılıyordu (gerçek zimmetleyen değil); kişinin ÜZERİNDEKİ TÜM zimmetlerin toplu tutanağı yoktu.
// [HOW]: Veri AssignmentService'ten (generatePersonnelZimmetData / generateB3MovementData, Faz 5 · K1 Opus) kanonik
//        sözleşmeyle gelir; bu dosya yalnız tasarım/basımdır. Türkçe karakter (ş,ğ,ı,İ,ö,ü,ç) için Roboto TTF gömülü
//        (pdf-fonts/Roboto-*.js) — yalnız PDF üretilirken tembel yüklenir, ilk sayfa yükünü şişirmez.
// ═══════════════════════════════════════════════════════════════════════════════════════════
(function () {
    const BRAND = { navy: [30, 41, 59], blue: [41, 128, 185], blueDark: [27, 94, 136], gray: [100, 116, 139], line: [203, 213, 225] };
    const PAGE = { w: 210, h: 297, margin: 14 };

    // ─── Türkçe Unicode font: tembel yükleme (yalnız PDF üretilirken) ───
    function loadScriptOnce(src) {
        if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error('Font dosyası yüklenemedi: ' + src));
            document.head.appendChild(el);
        });
    }
    let fontsReady = null;
    function ensureZimmetFonts() {
        if (!fontsReady) {
            fontsReady = Promise.all([loadScriptOnce('pdf-fonts/Roboto-Regular.js'), loadScriptOnce('pdf-fonts/Roboto-Bold.js')]);
        }
        return fontsReady;
    }

    const safeFileName = s => String(s ?? '-').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || '-';
    const dash = v => (v === undefined || v === null || String(v).trim() === '' ? '-' : String(v));
    const blank = v => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '-';

    // ─── Sayfa başlığı: logo metni, kurumsal unvan, belge türü ───
    function drawHeader(doc, title) {
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...BRAND.navy);
        doc.text('MEDİPOL SAĞLIK GRUBU', PAGE.w / 2, 16, { align: 'center' });

        doc.setFontSize(10.5);
        doc.setTextColor(...BRAND.blueDark);
        doc.text(title, PAGE.w / 2, 23, { align: 'center' });

        doc.setDrawColor(...BRAND.blue);
        doc.setLineWidth(0.6);
        doc.line(PAGE.margin, 27, PAGE.w - PAGE.margin, 27);
    }

    // ─── Belge ve personel bilgi kutuları (iki sütun) ───
    function drawInfoBoxes(doc, docData, startY) {
        const colW = (PAGE.w - PAGE.margin * 2 - 6) / 2;
        const leftX = PAGE.margin, rightX = PAGE.margin + colW + 6;
        const boxH = 28;

        doc.setDrawColor(...BRAND.line);
        doc.setLineWidth(0.3);
        doc.roundedRect(leftX, startY, colW, boxH, 1.5, 1.5);
        doc.roundedRect(rightX, startY, colW, boxH, 1.5, 1.5);

        const field = (x, y, label, value) => {
            doc.setFont('Roboto', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
            doc.text(label, x, y);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...BRAND.navy);
            doc.text(dash(value), x, y + 4.5, { maxWidth: colW - 6 });
        };

        const b = docData.belge, p = docData.personel;
        const padX = 5, padY = 7, rowGap = 10.5;
        field(leftX + padX, startY + padY, 'BELGE NO', b.belgeNo);
        field(leftX + padX, startY + padY + rowGap, 'DÜZENLEME TARİHİ', b.olusturmaTarihi);
        field(leftX + padX, startY + padY + rowGap * 2, 'DÜZENLEYEN', b.duzenleyen);

        field(rightX + padX, startY + padY, 'PERSONEL ADI SOYADI', p.adSoyad);
        field(rightX + padX, startY + padY + rowGap, 'BİRİMİ', p.birim);
        field(rightX + padX, startY + padY + rowGap * 2, b.talepNolari.length ? 'TALEP NO' : 'KAYIT NO',
            b.talepNolari.length ? b.talepNolari.join(', ') : docData.kalemler.map(k => k.kayitId).join(', '));

        return startY + boxH + 6;
    }

    // ─── Kalem tablosu ───
    function drawItemsTable(doc, kalemler, startY) {
        const body = kalemler.map(k => [
            String(k.sira),
            k.envanterNo,
            k.urunTuru,
            [k.marka, k.model].filter(v => v && v !== '-').join(' / ') || '-',
            k.sn,
            String(k.adet),
            k.teslimTarihi,
        ]);
        doc.autoTable({
            startY,
            margin: { left: PAGE.margin, right: PAGE.margin, bottom: 55 },
            head: [['Sıra', 'Varlık Kodu', 'Varlık Tanımı', 'Marka / Model', 'Seri No', 'Adet', 'Teslim Tarihi']],
            body,
            theme: 'grid',
            styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 8.5, cellPadding: 2.4, textColor: BRAND.navy, lineColor: BRAND.line, lineWidth: 0.2, valign: 'middle' },
            headStyles: { font: 'Roboto', fontStyle: 'bold', fillColor: BRAND.blue, textColor: [255, 255, 255], fontSize: 8.5, halign: 'center' },
            alternateRowStyles: { fillColor: [247, 249, 251] },
            columnStyles: {
                0: { halign: 'center', cellWidth: 11 },
                1: { cellWidth: 26 },
                2: { cellWidth: 34 },
                3: { cellWidth: 34 },
                4: { cellWidth: 26 },
                5: { halign: 'center', cellWidth: 14 },
                6: { cellWidth: 23 },
            },
        });
        return doc.lastAutoTable.finalY;
    }

    // ─── Özet şeridi ───
    function drawSummary(doc, ozet, y) {
        doc.setFont('Roboto', 'normal'); doc.setFontSize(8);
        doc.setTextColor(...BRAND.gray);
        const parts = [`Kalem: ${ozet.kalemSayisi}`, `Toplam Adet: ${ozet.toplamAdet}`, `Demirbaş: ${ozet.demirbasAdet}`, `Sarf Malzeme: ${ozet.sarfAdet}`];
        doc.text(parts.join('   ·   '), PAGE.margin, y);
        return y + 6;
    }

    // ─── Taahhüt metni ve imza kutuları ───
    function drawSignatures(doc, docData, y) {
        doc.setFont('Roboto', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...BRAND.navy);
        const taahhut = 'İşbu tutanak ile yukarıda detayları belirtilen demirbaş ve/veya malzemeleri, kurumsal iş süreçlerinde kullanılmak üzere eksiksiz ve çalışır vaziyette teslim aldığımı; kurum envanterine kayıtlı bu varlıkların özenli kullanımından, kaybından ve hor kullanımdan doğacak zararlardan şahsen sorumlu olduğumu, kurumdan ayrılışımda veya talep halinde iade edeceğimi kabul ve taahhüt ederim.';
        const lines = doc.splitTextToSize(taahhut, PAGE.w - PAGE.margin * 2);
        doc.text(lines, PAGE.margin, y);
        y += lines.length * 4 + 10;

        const boxW = (PAGE.w - PAGE.margin * 2 - 10) / 2;
        const leftX = PAGE.margin, rightX = PAGE.margin + boxW + 10;
        const lineY = y + 20;

        doc.setFont('Roboto', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BRAND.gray);
        doc.text('TESLİM EDEN (Yetkili)', leftX, y);
        doc.text('TESLİM ALAN (Personel)', rightX, y);

        doc.setDrawColor(...BRAND.navy); doc.setLineWidth(0.3);
        doc.line(leftX, lineY, leftX + boxW, lineY);
        doc.line(rightX, lineY, rightX + boxW, lineY);

        doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.navy);
        doc.text(dash(docData.belge.teslimEdenler[0]), leftX, lineY + 5);
        doc.text(dash(docData.personel.adSoyad), rightX, lineY + 5);
        doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
        doc.text('İmza', leftX, lineY + 10);
        doc.text('İmza', rightX, lineY + 10);

        return lineY + 10;
    }

    // ─── Sayfa numarası: toplam sayfa sayısı yalnız tüm sayfalar çizildikten sonra bilinir ───
    function stampPageNumbers(doc, footerLabel = 'Medipol Sağlık Grubu · Demirbaş ve Malzeme Zimmet Tutanağı') {
        const total = doc.internal.getNumberOfPages();
        for (let p = 1; p <= total; p++) {
            doc.setPage(p);
            doc.setDrawColor(...BRAND.line); doc.setLineWidth(0.2);
            doc.line(PAGE.margin, PAGE.h - 12, PAGE.w - PAGE.margin, PAGE.h - 12);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
            doc.text(footerLabel, PAGE.margin, PAGE.h - 7);
            doc.text(`Sayfa ${p} / ${total}`, PAGE.w - PAGE.margin, PAGE.h - 7, { align: 'right' });
        }
    }

    // ─── Faz 6 · İade kararı özeti (personelin gerekçesi + yöneticinin kararı) ───
    function drawReturnDecision(doc, iade, y) {
        const w = PAGE.w - PAGE.margin * 2;
        doc.setFont('Roboto', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...BRAND.blueDark);
        doc.text('İADE KARARI', PAGE.margin, y);
        y += 4;
        doc.setDrawColor(...BRAND.blue); doc.setLineWidth(0.4);
        doc.line(PAGE.margin, y, PAGE.margin + 38, y);
        y += 6;

        const rows = [
            ['Personelin gerekçesi', iade.gerekce + (iade.aciklama ? ` — ${iade.aciklama}` : '')],
            ['Beyan edilen cihaz durumu', iade.bildirilenDurum],
            ['Cihaz teslim alındı mı', iade.teslimAlindi ? 'Evet' : 'Hayır (teslim alınmadan kapatıldı)'],
        ];
        if (iade.teslimAlindi) {
            rows.push(['Yönetici değerlendirmesi (cihaz durumu)', iade.adminCihazDurumu]);
            rows.push(['Teslim alınan depo', iade.iadeDepo ? iade.iadeDepo.toUpperCase() : '-']);
            rows.push(['Stoğa eklendi mi', iade.stogaEklendi ? 'Evet' : 'Hayır']);
        } else {
            rows.push(['Kapanış açıklaması', iade.kapanisAciklamasi]);
        }
        if (!blank(iade.adminNotu)) rows.push(['Yönetici notu', iade.adminNotu]);
        rows.push(['Onaylayan', `${dash(iade.onaylayan)}  ·  ${dash(iade.onayTarihi)}`]);

        doc.setFontSize(9);
        rows.forEach(([label, value]) => {
            doc.setFont('Roboto', 'bold'); doc.setTextColor(...BRAND.gray);
            doc.text(`${label}:`, PAGE.margin, y);
            const labelW = doc.getTextWidth(`${label}: `) + 1;
            doc.setFont('Roboto', 'normal'); doc.setTextColor(...BRAND.navy);
            const lines = doc.splitTextToSize(dash(value), w - labelW);
            doc.text(lines, PAGE.margin + labelW, y);
            y += lines.length * 4.3 + 2.4;
        });
        return y + 2;
    }

    // ─── Faz 6 · Taahhüt metni ve imza kutuları (iade yönü zimmetin tersi: personel teslim eden, yetkili teslim alan).
    //            Cihaz fiziken teslim alınmadıysa (kayıp, personel ayrıldı vb.) yalnız onaylayan yetkilinin imzası basılır. ───
    function drawReturnSignatures(doc, docData, y) {
        const iade = docData.iade;
        doc.setFont('Roboto', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...BRAND.navy);
        const taahhut = iade.teslimAlindi
            ? 'İşbu tutanak ile yukarıda bilgileri yer alan demirbaş/malzemeyi kurum yetkilisine eksiksiz olarak iade ettiğimi; yetkilinin bu cihazı teslim aldığını ve zimmetimin kapatıldığını kabul ederim.'
            : 'İşbu tutanak ile yukarıda bilgileri yer alan demirbaş/malzemenin, yukarıdaki kapanış açıklaması uyarınca fiziken teslim alınmadan zimmetimden düşüldüğünü bildiğimi beyan ederim.';
        const lines = doc.splitTextToSize(taahhut, PAGE.w - PAGE.margin * 2);
        doc.text(lines, PAGE.margin, y);
        y += lines.length * 4 + 10;
        const lineY = y + 20;

        doc.setDrawColor(...BRAND.navy); doc.setLineWidth(0.3);
        doc.setFont('Roboto', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BRAND.gray);

        if (!iade.teslimAlindi) {
            doc.text('ONAYLAYAN (Yetkili)', PAGE.margin, y);
            doc.line(PAGE.margin, lineY, PAGE.margin + (PAGE.w - PAGE.margin * 2 - 10) / 2, lineY);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.navy);
            doc.text(dash(iade.onaylayan), PAGE.margin, lineY + 5);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
            doc.text('İmza', PAGE.margin, lineY + 10);
            return lineY + 10;
        }

        const boxW = (PAGE.w - PAGE.margin * 2 - 10) / 2;
        const leftX = PAGE.margin, rightX = PAGE.margin + boxW + 10;
        doc.text('TESLİM EDEN (Personel)', leftX, y);
        doc.text('TESLİM ALAN (Yetkili)', rightX, y);
        doc.line(leftX, lineY, leftX + boxW, lineY);
        doc.line(rightX, lineY, rightX + boxW, lineY);

        doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.navy);
        doc.text(dash(docData.personel.adSoyad), leftX, lineY + 5);
        doc.text(dash(iade.onaylayan), rightX, lineY + 5);
        doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
        doc.text('İmza', leftX, lineY + 10);
        doc.text('İmza', rightX, lineY + 10);
        return lineY + 10;
    }

    // ─── Faz 6 · İade tutanağı: zimmet tutanağıyla aynı başlık/kalem tablosu/özet; karar ve imza bölümü kendine özgü ───
    function renderIadeTutanagi(docData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        doc.setFont('Roboto', 'normal');
        const title = docData.iade.teslimAlindi ? 'DEMİRBAŞ İADE TUTANAĞI' : 'ZİMMET KAPANIŞ TUTANAĞI (Teslim Alınmadı)';

        drawHeader(doc, title);
        let y = drawInfoBoxes(doc, docData, 32);
        y = drawItemsTable(doc, docData.kalemler, y);
        y = drawSummary(doc, docData.ozet, y + 7);
        y = drawReturnDecision(doc, docData.iade, y + 4);

        const SIGNATURE_H = docData.iade.teslimAlindi ? 62 : 40;
        if (y + SIGNATURE_H > PAGE.h - 16) { doc.addPage(); y = 20; }
        drawReturnSignatures(doc, docData, y);

        stampPageNumbers(doc, 'Medipol Sağlık Grubu · Demirbaş İade Tutanağı');
        return doc;
    }

    // ─── Ortak çizim: hem toplu (personel) hem tekil (b3 hareketi) belge aynı düzeni kullanır ───
    function renderZimmetTutanagi(docData, title) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        doc.setFont('Roboto', 'normal');

        drawHeader(doc, title);
        let y = drawInfoBoxes(doc, docData, 32);
        y = drawItemsTable(doc, docData.kalemler, y);
        y = drawSummary(doc, docData.ozet, y + 7);

        // İmza bloğu bir sonraki sayfaya taşmasın; yetmiyorsa yeni sayfa aç.
        const SIGNATURE_H = 62;
        if (y + SIGNATURE_H > PAGE.h - 16) { doc.addPage(); y = 20; }
        drawSignatures(doc, docData, y);

        stampPageNumbers(doc);
        return doc;
    }

    function alertErr(msg) { if (typeof showAppAlert === 'function') showAppAlert(msg, 'error'); else alert(msg); }
    function alertWarn(msg) { if (typeof showAppAlert === 'function') showAppAlert(msg, 'warning'); else alert(msg); }

    /**
     * Personelin üzerindeki tüm zimmetlerin resmi toplu tutanağı (Kişi Envanterim ile aynı küme).
     * @param {string|number} personelId
     */
    window.generatePersonnelZimmetPDF = async function (personelId) {
        try {
            if (!window.AssignmentService || typeof window.AssignmentService.generatePersonnelZimmetData !== 'function') {
                alertErr('Zimmet veri servisi yüklenmedi.'); return;
            }
            const docData = window.AssignmentService.generatePersonnelZimmetData(personelId);
            if (!docData) { alertErr('Personel bulunamadı; zimmet tutanağı oluşturulamadı.'); return; }
            if (docData.kalemler.length === 0) { alertWarn('Bu personelin üzerine kayıtlı aktif/teslim alınmış zimmet bulunmuyor.'); return; }
            await ensureZimmetFonts();
            const doc = renderZimmetTutanagi(docData, 'DEMİRBAŞ VE MALZEME ZİMMET TUTANAĞI');
            doc.save(`Zimmet_Tutanagi_${safeFileName(docData.personel.adSoyad)}_${safeFileName(docData.belge.belgeNo)}.pdf`);
        } catch (err) {
            console.error('Zimmet tutanağı PDF hatası:', err);
            alertErr('Zimmet tutanağı oluşturulamadı. ' + (err && err.message || ''));
        }
    };

    /**
     * Tek bir b3 hareketinin (zimmet / envanter çıkışı / iade) tutanağı.
     * Argüman b3 kaydının id'sidir (DATA-06: indeks snapshot'ta kayar).
     * @param {string|number} b3Id
     */
    window.generateZimmetPDF = async function (b3Id) {
        try {
            if (!window.AssignmentService || typeof window.AssignmentService.generateB3MovementData !== 'function') {
                alertErr('Zimmet veri servisi yüklenmedi.'); return;
            }
            const docData = window.AssignmentService.generateB3MovementData(b3Id);
            if (!docData) { alertErr('Kayıt bulunamadı; liste güncellenmiş olabilir.'); return; }
            await ensureZimmetFonts();
            const isExit = docData.belge.tur === 'cikis';
            const title = isExit ? 'DEMİRBAŞ VE MALZEME ÇIKIŞ TUTANAĞI' : 'DEMİRBAŞ VE MALZEME ZİMMET TUTANAĞI';
            const doc = renderZimmetTutanagi(docData, title);
            doc.save(`${isExit ? 'Cikis' : 'Zimmet'}_${safeFileName(docData.personel.adSoyad)}_${safeFileName(docData.belge.belgeNo)}.pdf`);
        } catch (err) {
            console.error('Zimmet PDF hatası:', err);
            alertErr('Belge oluşturulamadı. ' + (err && err.message || ''));
        }
    };

    /**
     * Onaylanmış bir iade talebinin resmi tutanağı. Argüman returnRequests kaydının id'sidir ("ret_<zimmetId>");
     * bekleyen/reddedilen/geri çekilen talepte buton zaten görünmez (src/modules/return-requests.js), yine de
     * burada da durum doğrulanır.
     * @param {string|number} returnId
     */
    window.generateReturnPDF = async function (returnId) {
        try {
            if (!window.AssignmentService || typeof window.AssignmentService.generateReturnData !== 'function') {
                alertErr('Zimmet veri servisi yüklenmedi.'); return;
            }
            const docData = window.AssignmentService.generateReturnData(returnId);
            if (!docData) { alertErr('Bu iade için tutanak oluşturulamadı; talep onaylanmış olmalı.'); return; }
            await ensureZimmetFonts();
            const doc = renderIadeTutanagi(docData);
            doc.save(`Iade_Tutanagi_${safeFileName(docData.personel.adSoyad)}_${safeFileName(docData.belge.belgeNo)}.pdf`);
        } catch (err) {
            console.error('İade tutanağı PDF hatası:', err);
            alertErr('İade tutanağı oluşturulamadı. ' + (err && err.message || ''));
        }
    };

    // [WHY]: v3.7 İP-10 · Depo / çoklu raf sayımı için resmi, Türkçe Unicode (Roboto) fontlu fark tutanağı üretir.
    // [HOW]: ShelfCount.buildCountReportData sözleşmesindeki belge, özet ve kalemler dizisini A4 tutanak olarak basar.
    function renderShelfCountReportPDF(reportData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        doc.setFont('Roboto', 'normal');

        const b = reportData.belge || {};
        const oz = reportData.ozet || {};
        const kalemler = Array.isArray(reportData.kalemler) ? reportData.kalemler : [];

        drawHeader(doc, 'DEPO SAYIM VE FARK TUTANAĞI');

        const startY = 32;
        const colW = (PAGE.w - PAGE.margin * 2 - 6) / 2;
        const leftX = PAGE.margin, rightX = PAGE.margin + colW + 6;
        const boxH = 31;
        doc.setDrawColor(...BRAND.line);
        doc.setLineWidth(0.3);
        doc.roundedRect(leftX, startY, colW, boxH, 1.5, 1.5);
        doc.roundedRect(rightX, startY, colW, boxH, 1.5, 1.5);

        const field = (x, y, label, value) => {
            doc.setFont('Roboto', 'bold'); doc.setFontSize(7.2); doc.setTextColor(...BRAND.gray);
            doc.text(label, x, y);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.navy);
            doc.text(dash(value), x, y + 4.2, { maxWidth: colW - 8 });
        };

        const padX = 4.5, padY = 6.5, gap = 9.5;
        field(leftX + padX, startY + padY, 'TUTANAK NO', b.raporNo);
        field(leftX + padX, startY + padY + gap, 'SAYIM TARİHİ', b.tarih);
        field(leftX + padX, startY + padY + gap * 2, 'DÜZENLEYEN', b.duzenleyen);

        const rafText = Array.isArray(b.raflar) && b.raflar.length
            ? (b.raflar.length > 8 ? `${b.raflar.slice(0, 8).join(', ')} (+${b.raflar.length - 8} raf)` : b.raflar.join(', '))
            : 'Tüm depo';
        field(rightX + padX, startY + padY, 'DEPO', b.depoAdi || String(b.depo || '').toUpperCase());
        field(rightX + padX, startY + padY + gap, 'SAYIM GEREKÇESİ', b.gerekce);
        field(rightX + padX, startY + padY + gap * 2, 'SAYILAN RAFLAR', rafText);

        let y = startY + boxH + 5;
        // Özet şeridi
        doc.setFillColor(247, 249, 251);
        doc.setDrawColor(...BRAND.line);
        doc.roundedRect(PAGE.margin, y, PAGE.w - PAGE.margin * 2, 10, 1.5, 1.5, 'FD');
        doc.setFont('Roboto', 'bold'); doc.setFontSize(8); doc.setTextColor(...BRAND.navy);
        const netStr = (oz.netDiff > 0 ? `+${oz.netDiff}` : String(oz.netDiff ?? 0));
        const summaryLine = [
            `Toplam Kalem: ${oz.total ?? kalemler.length}`,
            `Sayılan: ${oz.counted ?? 0}`,
            `Eksik: ${oz.missing ?? 0} (-${oz.missingQty ?? 0})`,
            `Fazla: ${oz.excess ?? 0} (+${oz.excessQty ?? 0})`,
            `Tam: ${oz.match ?? 0}`,
            `Net Fark: ${netStr}`,
        ].join('   ·   ');
        doc.text(summaryLine, PAGE.w / 2, y + 6.2, { align: 'center' });
        y += 14;

        const body = kalemler.map(k => [
            String(k.sira),
            dash(k.raf),
            k.envanterNo && k.envanterNo !== '-' ? `${k.urun}\n[${k.envanterNo}]` : dash(k.urun),
            dash(k.tur),
            String(k.sistemAdet),
            dash(k.sayilanLabel),
            dash(k.farkLabel),
            dash(k.durumLabel),
            k.not || '-',
        ]);

        doc.autoTable({
            startY: y,
            margin: { left: PAGE.margin, right: PAGE.margin, bottom: 52 },
            head: [['#', 'Raf', 'Ürün / Envanter No', 'Tür', 'Sistem', 'Sayılan', 'Fark', 'Durum', 'Not']],
            body,
            theme: 'grid',
            styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 7.8, cellPadding: 2.1, textColor: BRAND.navy, lineColor: BRAND.line, lineWidth: 0.2, valign: 'middle' },
            headStyles: { font: 'Roboto', fontStyle: 'bold', fillColor: BRAND.blue, textColor: [255, 255, 255], fontSize: 8, halign: 'center' },
            alternateRowStyles: { fillColor: [249, 250, 252] },
            columnStyles: {
                0: { halign: 'center', cellWidth: 9 },
                1: { cellWidth: 20 },
                2: { cellWidth: 42 },
                3: { cellWidth: 22 },
                4: { halign: 'center', cellWidth: 14 },
                5: { halign: 'center', cellWidth: 15 },
                6: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
                7: { halign: 'center', cellWidth: 18, fontStyle: 'bold' },
                8: { cellWidth: 28 },
            },
            didParseCell(data) {
                if (data.section !== 'body') return;
                const row = kalemler[data.row.index];
                if (!row) return;
                if (data.column.index === 6 || data.column.index === 7) {
                    if (row.durum === 'missing') {
                        data.cell.styles.textColor = [185, 28, 28];
                        data.cell.styles.fillColor = [254, 242, 242];
                    } else if (row.durum === 'excess') {
                        data.cell.styles.textColor = [180, 83, 9];
                        data.cell.styles.fillColor = [255, 251, 235];
                    } else if (row.durum === 'match') {
                        data.cell.styles.textColor = [21, 128, 61];
                        data.cell.styles.fillColor = [240, 253, 244];
                    }
                }
            },
        });

        let sigY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 10;
        if (sigY + 48 > PAGE.h - 16) { doc.addPage(); sigY = 22; }

        doc.setFont('Roboto', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...BRAND.navy);
        const beyan = 'İşbu tutanak ile yukarıda belirtilen depo ve raflarda gerçekleştirilen fiziki sayım neticelerinin, sistem kayıtlarıyla karşılaştırılarak doğruluğunun tespit edildiğini beyan ve imza ederiz.';
        const beyanLines = doc.splitTextToSize(beyan, PAGE.w - PAGE.margin * 2);
        doc.text(beyanLines, PAGE.margin, sigY);
        sigY += beyanLines.length * 4 + 10;

        const sigW = (PAGE.w - PAGE.margin * 2 - 12) / 2;
        const sLeft = PAGE.margin, sRight = PAGE.margin + sigW + 12;
        const lineY = sigY + 18;
        doc.setFont('Roboto', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BRAND.gray);
        doc.text('SAYIM SORUMLUSU', sLeft, sigY);
        doc.text('ONAYLAYAN (Yetkili)', sRight, sigY);
        doc.setDrawColor(...BRAND.navy); doc.setLineWidth(0.3);
        doc.line(sLeft, lineY, sLeft + sigW, lineY);
        doc.line(sRight, lineY, sRight + sigW, lineY);
        doc.setFont('Roboto', 'normal'); doc.setFontSize(9); doc.setTextColor(...BRAND.navy);
        doc.text(dash(b.duzenleyen), sLeft, lineY + 5);
        doc.text('Adı Soyadı / Unvan', sRight, lineY + 5);
        doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
        doc.text('İmza / Tarih', sLeft, lineY + 9.5);
        doc.text('İmza / Tarih', sRight, lineY + 9.5);

        stampPageNumbers(doc, 'Medipol Sağlık Grubu · Depo Sayım ve Fark Tutanağı');
        return doc;
    }

    // [WHY]: v3.7 İP-10 · WMS Sayım Fark Masası'ndan tek tıkla resmi Türkçe PDF sayım tutanağı indirir.
    // [HOW]: Roboto TTF fontlarını tembel yükler, renderShelfCountReportPDF ile üretir ve dosya olarak kaydeder.
    window.generateShelfCountReportPDF = async function (reportData) {
        try {
            if (!reportData || !Array.isArray(reportData.kalemler) || !reportData.kalemler.length) {
                alertWarn('Tutanak oluşturmak için en az bir sayım kalemi bulunmalıdır.');
                return;
            }
            await ensureZimmetFonts();
            const doc = renderShelfCountReportPDF(reportData);
            const b = reportData.belge || {};
            doc.save(`Sayim_Fark_Tutanagi_${safeFileName(String(b.depo || 'depo').toUpperCase())}_${safeFileName(b.raporNo || 'rapor')}.pdf`);
        } catch (err) {
            console.error('Sayım fark tutanağı PDF hatası:', err);
            alertErr('Sayım tutanağı oluşturulamadı. ' + (err && err.message || ''));
        }
    };

    // Test/iç erişim: flow-tests.js jsPDF'in doc.save() tetiklediği dosya indirmesini tarayıcıda taklit etmeden,
    // sayfalama/font/sözleşme eşlemesini doğrudan doğrular.
    window.AppModules = window.AppModules || {};
    window.AppModules.ZimmetPdf = { renderZimmetTutanagi, renderIadeTutanagi, renderShelfCountReportPDF, ensureZimmetFonts };
})();

window.exportPDF=function (depo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${depo.toUpperCase()} Depo Envanteri`, 20, 20);
    doc.setFontSize(12);
    let y = 30;
    (data[depo] || []).filter(item => !window.Schema?.isRowCountLocked?.(item)).forEach(item => {
        doc.text(`${item.name || '-'} (${item.type || '-'}) - ${item.shelf || '-'} - ${item.status || '-'} - Adet: ${item.qty || 0}`, 20, y);
        y += 10;
        if (y > 280) { doc.addPage(); y = 20; }
    });
    doc.save(`${depo}-envanter.pdf`);
}

// [Faz 5 denetimi · P1]: Buradaki ikinci importExcel kaldırıldı — eski takma adlarla (name/type/shelf/status/qty) yalnız
// belleğe yazıyordu ve admin.html'de script.js'ten SONRA yüklendiği için oradaki kanonik içe aktarmanın üzerine biniyordu.
// Tek içe aktarma yolu: src/ui/stock-import-export.js importExcel → StockImport + atomicImportStock.

// Excel Export (Kütüphanesiz, Saf JS Çözümü)
window.exportTableToExcel=function (tableID, filename = ''){
    const tableSelect = document.getElementById(tableID);
    if (!tableSelect) return;

    // Türkçe karakter sorunu olmaması için BOM ekliyoruz ve encoding ayarlıyoruz
    let excelFile = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="UTF-8">
            </head>
        <body>
            ${tableSelect.outerHTML}
        </body>
        </html>
    `;
    
    const blob = new Blob([excelFile], { type: 'application/vnd.ms-excel' });
    const downloadUrl = URL.createObjectURL(blob);
    
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = filename + ".xls";
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}