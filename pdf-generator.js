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
    function stampPageNumbers(doc) {
        const total = doc.internal.getNumberOfPages();
        for (let p = 1; p <= total; p++) {
            doc.setPage(p);
            doc.setDrawColor(...BRAND.line); doc.setLineWidth(0.2);
            doc.line(PAGE.margin, PAGE.h - 12, PAGE.w - PAGE.margin, PAGE.h - 12);
            doc.setFont('Roboto', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...BRAND.gray);
            doc.text('Medipol Sağlık Grubu · Demirbaş ve Malzeme Zimmet Tutanağı', PAGE.margin, PAGE.h - 7);
            doc.text(`Sayfa ${p} / ${total}`, PAGE.w - PAGE.margin, PAGE.h - 7, { align: 'right' });
        }
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

    // Test/iç erişim: flow-tests.js jsPDF'in doc.save() tetiklediği dosya indirmesini tarayıcıda taklit etmeden,
    // sayfalama/font/sözleşme eşlemesini doğrudan doğrular.
    window.AppModules = window.AppModules || {};
    window.AppModules.ZimmetPdf = { renderZimmetTutanagi, ensureZimmetFonts };
})();

window.exportPDF=function (depo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`${depo.toUpperCase()} Depo Envanteri`, 20, 20);
    doc.setFontSize(12);
    let y = 30;
    (data[depo] || []).forEach(item => {
        doc.text(`${item.name || '-'} (${item.type || '-'}) - ${item.shelf || '-'} - ${item.status || '-'} - Adet: ${item.qty || 0}`, 20, y);
        y += 10;
        if (y > 280) { doc.addPage(); y = 20; }
    });
    doc.save(`${depo}-envanter.pdf`);
}

// [Faz 5 denetimi · P1]: Buradaki ikinci importExcel kaldırıldı — eski takma adlarla (name/type/shelf/status/qty) yalnız
// belleğe yazıyordu ve admin.html'de script.js'ten SONRA yüklendiği için oradaki kanonik içe aktarmanın üzerine biniyordu.
// Tek içe aktarma yolu: script.js importExcel → StockImport + atomicInsertItems.

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