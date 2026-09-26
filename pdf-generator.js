window.generateZimmetPDF = function(index) {
    const { jsPDF } = window.jspdf; 
    const doc = new jsPDF(); 

    const item = data.b3[index];
    const activeUser = window.getActiveUser() || { name: 'Sistem Yöneticisi' };

    // Logo (Placeholder - gerçek logo için doc.addImage(base64, 'PNG', x, y, w, h))
    doc.text('MEDIPOL UNV.', 10, 10);  // Logo yerine metin

    doc.setFontSize(16);
    doc.text('Zimmet Formu', 105, 20, { align: 'center' });

    // [WHY]: Sabit örnek satırlar (transfer no, kişi, ITSM linki) gerçek zimmet gibi basılıyordu (ZIM-04). Gerçek form Faz 5'te.
    doc.setFontSize(10);
    doc.text('Teslim Tarihi: ' + (item.tarih || item.date || '-'), 10, 30);

    // Tablo
    doc.autoTable({
        startY: 70,
        head: [['Sıra', 'Varlık Kodu', 'Varlık Tanımı', 'Marka', 'Model', 'Seri No', 'Kare Kodu']],
        body: [
            ['1', item.shelfNo, item.description, item.productType, '-', item.sn, 'QR Code Placeholder']
            // QR için qrcode library ekle: doc.addImage(qrDataUrl, 'PNG', x, y, w, h)
        ],
        headStyles: { fillColor: [41, 128, 185] },
        bodyStyles: { fontSize: 9 }
    });

    // İmza ve Uyarı
    const y = doc.autoTable.previous.finalY + 20;
    doc.text('İşbu tutanak ile yukarıda detayları belirtilen varlıkları, kurumsal iş süreçlerinde kullanılmak üzere eksiksiz ve çalışır vaziyette teslim aldım. Kullanım hatasından kaynaklı oluşabilecek zararlardan şahsen sorumlu olduğumu kabul ve taahhüt ederim.', 10, y, { maxWidth: 190 });
    doc.line(10, y + 40, 100, y + 40);  // Teslim Alan İmza
    doc.text('Teslim Alan: ' + item.person, 10, y + 45);
    doc.line(110, y + 40, 200, y + 40);  // Teslim Eden İmza
    doc.text('Teslim Eden: ' + activeUser.name, 110, y + 45);

    doc.save(`Zimmet_${item.person}_${item.date}.pdf`);
}

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

window.importExcel=function (event) {
    const file = event.target.files[0];
    const depo = event.target.getAttribute('data-depo');
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        let importedData;
        if (file.name.endsWith('.csv')) {
            const text = e.target.result;
            const rows = text.split('\n').map(row => row.split(','));
            importedData = rows.slice(1).map(row => ({
                name: row[0],
                type: row[1],
                shelf: row[2],
                status: row[3],
                qty: parseInt(row[4])
            })).filter(item => item.name && !isNaN(item.qty));
        } else {
            const dataArr = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataArr, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            importedData = XLSX.utils.sheet_to_json(firstSheet, {header: ['name', 'type', 'shelf', 'status', 'qty']});
            importedData = importedData.map(item => ({
                ...item,
                qty: parseInt(item.qty)
            })).filter(item => item.name && !isNaN(item.qty));
        }
        data[depo] = importedData;
        renderTable(depo);
        alert(`${importedData.length} ürün başarıyla yüklendi!`);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset input
}

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