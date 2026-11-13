// [WHY]: v3.7 · İP-6 — script.js monolitinden ayrıştırıldı (SoC). Depo PDF / Excel dışa aktarma, Excel içe aktarma (biçim
//        yardımı dahil) ve tablo → Excel dönüştürme tek arayüz modülünde. İçe aktarma ayrıştırmayı StockImport'a, yazmayı tek
//        işlemli servis köprüsüne (window.atomicImportStock) bırakır.
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick
//        ve modüller bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı (yalnız IIFE girintisi); taşıma öncesi
//        global olan adlar aynı adlarla window'da kalır, AppModules.StockImportExport aynı fonksiyonları taşır
//        (sözleşme: tests/unit/script-bridge-contract.test.mjs).
//        exportTableToExcel üst düzeyde kalır: pdf-generator.js de window.exportTableToExcel tanımlar ve hangisinin geçerli
//        olacağı bugünkü gibi sayfadaki yükleme sırasına bağlıdır (index: bu dosya, admin: pdf-generator.js).

function exportTableToExcel(tableID, filename = '') {
    const tableSelect = document.getElementById(tableID);
    if (!tableSelect) return;
    let excelFile = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset="UTF-8"></head><body>${tableSelect.outerHTML}</body></html>`;
    const blob = new Blob([excelFile], { type: 'application/vnd.ms-excel' });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = filename + ".xls";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

(function () {
    window.exportPDF = function (depo) {
        if (!validateAdminAction()) return;
        if (depo === 'b3') return _exportB3PDF();
        const items = (window.data[depo] || []).filter(item => !window.Schema?.isRowCountLocked?.(item));   // v3.6: tabloyla aynı
        function getStatusClass(status) {
            if (!status) return "status-diger";
            status = status.toLowerCase();
            if (status.includes("hazır")) return "status-hazir";
            if (status.includes("sıfır")) return "status-sifir";
            if (status.includes("arız") || status.includes("bozuk") || status.includes("tutmuyor")) return "status-ariza";
            return "status-diger";
        }
        let html = `<html><head><title>${escapeHtml(depo)} Rapor</title><style>
        body { font-family: "Roboto", Arial, sans-serif; margin: 0; padding: 20px; color: #222; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
        th, td { border: 1px solid #cfd6dc; padding: 6px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        td.wrap { white-space: normal; word-break: break-word; }
        th { background: #2c3e50; color: white; font-weight: 600; }
        tr:nth-child(even) { background: #f7f9fb; }
        th:nth-child(1), td:nth-child(1) { width: 30px; text-align: center; }
        th:nth-child(2), td:nth-child(2) { width: 60px; }
        th:nth-child(3), td:nth-child(3) { width: 60px; }
        th:nth-child(4), td:nth-child(4) { width: 160px; }
        th:nth-child(5), td:nth-child(5) { width: 100px; }
        th:nth-child(6), td:nth-child(6) { width: 50px; text-align: center; }
        th:nth-child(7), td:nth-child(7) { width: 90px; }
        th:nth-child(8), td:nth-child(8) { width: 60px; }
        .status-hazir { background: #e8f5e9; color: #2e7d32; font-weight: 600; }
        .status-ariza { background: #ffebee; color: #c62828; font-weight: 600; }
        .status-sifir { background: #e3f2fd; color: #1565c0; font-weight: 600; }
        .status-diger { background: #fff8e1; color: #ef6c00; font-weight: 600; }
    </style></head><body><div class="print-container"><div style="font-size:18px; font-weight:bold; margin-bottom:6px;">${escapeHtml(depo.toUpperCase())} DEPO ENVANTERİ</div>
    <div style="font-size:12px; margin-bottom:14px;">Rapor Tarihi: ${escapeHtml(getTurkiyeSaati())}</div><table><thead><tr><th>#</th><th>Sütun</th><th>Raf</th><th>Ürün</th><th>Marka</th><th>Adet</th><th>Durum</th><th>Tür</th></tr></thead><tbody>`;

        items.forEach((item, index) => {
            const status = item.durumu ?? item.status ?? "-";
            html += `<tr><td>${index + 1}</td><td>${escapeHtml(item.sütun || '-')}</td><td>${escapeHtml(item.raf || '-')}</td><td class="wrap">${escapeHtml(item.ürün || '-')}</td><td class="wrap">${escapeHtml(item.marka || '-')}</td>
        <td style="text-align:center; font-weight:600;">${escapeHtml(item.adet ?? item.qty ?? 0)}</td><td class="${getStatusClass(status) /* xss-ok: dört sabit sınıf adından biri */}">${escapeHtml(status)}</td><td>${escapeHtml(item.tür ?? item.type ?? '-')}</td></tr>`;
        });
        html += `</tbody></table></div></body></html>`;

        const win = window.open('', '', 'width=1400,height=900');
        win.document.write(html);
        win.document.close();
        setTimeout(() => { win.print(); win.close(); }, 300);
    };

    // [WHY]: Admin'ler hangi Excel/CSV sütun adlarının tanındığını ve hangi sırayla verilmesi gerektiğini bilmeden import
    //        deniyor, "sütun tanınmadı" uyarılarıyla karşılaşıyordu.
    // [HOW]: Tek, paylaşılan bilgi penceresi (showCustomConfirm'in salt-bilgi kullanımı); B1/B2 import düğmelerinin yanındaki
    //        ℹ️ ikonundan (index.html) ve WMS "Depo Aksiyonları" panelinden (admin.html) AYNI fonksiyon çağrılır — metin tek
    //        yerde (burada) güncellenir. Sütun adları stock-import.js FIELD_ALIASES'teki kabul edilen takma adlarla birebir;
    //        sıra, Excel Rapor (exportToExcel) çıktısıyla tutarlı olsun diye önerilir — gerçek eşleme başlık ADINA göre
    //        yapıldığından (sıraya değil) teknik olarak zorunlu değildir, yalnız okunabilirlik için.
    window.showImportFormatHelp = function (depo = 'b1') {
        const isB2 = depo === 'b2' || depo === 'all';
        const maxRows = (window.StockImport && window.StockImport.MAX_IMPORT_ROWS) || 200;
        const lines = [
            `${isB2 ? 'B2 (Demirbaş)' : 'B1 (Sarf)'} içe aktarma — önerilen sütun sırası:`, '',
            '1. Sütun  (opsiyonel — raf içindeki fiziksel bölme/kolon)',
            '2. Raf No  (opsiyonel — katalogda yoksa otomatik yaratılır, doluysa Havuz\'a alınır)',
            '3. Ürün Türü  (opsiyonel — demirbaş/sarf ayrımı ve kritik stok grubu için önemli)',
            '4. Ürün Adı  (ZORUNLU — boşsa satır reddedilir)',
            '5. Marka  (opsiyonel)',
            '6. Adet  (opsiyonel — boşsa 0/Tükendi sayılır; negatif ya da tam sayı olmayan değer reddedilir)',
            '7. Durumu  (opsiyonel — ör. Kullanıma Hazır, Pasif, Hurda, Servis Sürecinde)',
            '8. Envanter No  (ZORUNLU — her satırda bulunmalı ve benzersiz olmalı)',
            '9. Seri No  (opsiyonel — cihazın seri numarası)',
            '10. Açıklama  (opsiyonel)', '',
            'Sütun adı büyük/küçük harf ve Türkçe karakterden bağımsız tanınır (ör. "Raf No", "raf numarası", "shelf" hepsi aynı alana eşlenir).',
            'Sıra önemli DEĞİLDİR — eşleme başlık adına göre yapılır; yukarıdaki sıra yalnız okunabilirlik içindir.',
            `Tek dosyada en fazla ${maxRows} veri satırı kabul edilir (yönetici dahil aşılamaz); daha büyük listeleri ${maxRows} satırlık parçalara bölüp ayrı ayrı içe aktarın.`,
        ].filter(x => x !== null).join('\n');
        if (typeof window.showCustomConfirm === 'function') {
            // Uzun rehber güvenli DOM düğümleriyle kurulur; kayıt/dosya verisi HTML olarak yorumlanmaz.
            const el = (tag, className, text) => {
                const node = document.createElement(tag);
                node.className = className;
                if (text !== undefined) node.textContent = text;
                return node;
            };
            const guide = el('div', 'import-guide');
            const intro = el('div', 'import-guide-intro');
            intro.append(el('span', 'import-guide-depot', depo === 'all' ? 'B1 + B2 · ORTAK REHBER' : (isB2 ? 'B2 · DEMİRBAŞ' : 'B1 · SARF')),
                el('p', '', 'Dosyanızı hazırlayın, ürünlerinizi kolayca içe aktarın.'));
            guide.append(intro);
            const facts = el('div', 'import-guide-facts');
            for (const [value, label] of [['.xlsx / .xls / .csv', 'Desteklenen dosyalar'], [`${maxRows} satır`, 'Dosya başına üst sınır'], ['Ürün Adı + Envanter No', 'Zorunlu alanlar']]) {
                const fact = el('div', 'import-guide-fact');
                fact.append(el('span', '', label), el('strong', '', value));
                facts.append(fact);
            }
            guide.append(facts);
            const section = el('section', 'import-guide-section');
            section.append(el('h4', '', 'Sütun rehberi'), el('p', 'import-guide-caption', 'Önerilen sıra aşağıda. Dosyanızdaki sütun sırası farklı olabilir.'));
            const columns = [
                ['Sütun', 'Raf içindeki fiziksel bölme veya kolon.', 'A'],
                ['Raf No', 'Raf yoksa otomatik oluşturulur. Doluysa ürün Havuz’a alınır.', 'R-01'],
                ['Ürün Türü', 'Demirbaş / sarf ayrımı ve kritik stok grubu için önemlidir.', isB2 ? 'Dizüstü Bilgisayar' : 'Kablo'],
                ['Ürün Adı', 'Her veri satırında bulunmalı; boş bırakılan satır reddedilir.', isB2 ? 'Dell Latitude 5440' : 'HDMI Kablo'],
                ['Marka', 'Ürünün marka bilgisi.', isB2 ? 'Dell' : 'Ugreen'],
                ['Adet', '0 veya pozitif tam sayı. Boş bırakılırsa 0 / Tükendi kabul edilir.', '1'],
                ['Durumu', 'Ör. Kullanıma Hazır, Pasif, Hurda veya Servis Sürecinde.', 'Kullanıma Hazır'],
                ['Envanter No', 'Her satırda zorunludur. B1 ve B2’de saklanır; mevcut numaralar yeniden eklenmez.', 'ENV-2026-001'],
                ['Seri No', 'Cihazın seri numarası. Ürün kaydında saklanır.', 'SN5X8K2L9'],
                ['Açıklama', 'Ürünle ilgili ek bilgi veya not.', 'İdari işler'],
            ];
            const list = el('ol', 'import-guide-columns');
            columns.forEach(([name, description, example]) => {
                const required = name === 'Ürün Adı' || name === 'Envanter No';
                const row = el('li', required ? 'import-guide-column is-required' : 'import-guide-column');
                const detail = el('div', 'import-guide-column-detail');
                const heading = el('div', 'import-guide-column-heading');
                heading.append(el('strong', '', name), el('span', required ? 'import-guide-required' : 'import-guide-optional', required ? 'Zorunlu' : 'İsteğe bağlı'));
                detail.append(heading, el('p', '', description));
                row.append(detail, el('code', 'import-guide-example', example));
                list.append(row);
            });
            section.append(list);
            guide.append(section);
            const notes = el('section', 'import-guide-notes');
            notes.append(el('h4', '', 'Yüklemeden önce'),
                el('p', '', 'İlk satıra sütun başlıklarını yazın. Büyük / küçük harf ve Türkçe karakter farklılıkları tanınır: “Raf No”, “raf numarası” ve “shelf” aynı alana eşlenir.'),
                el('p', '', `Sütunlar başlık adına göre eşleştirilir. ${maxRows} satırdan uzun listeleri ayrı dosyalara bölün. Negatif veya ondalıklı adet kabul edilmez.`));
            guide.append(notes);
            window.showCustomConfirm('Excel / CSV hazırlama rehberi', guide, { confirmText: 'Anladım, hazırım', variant: 'import-guide' });
        } else {
            window.alert(lines);
        }
    };

    // [WHY]: Faz 5 denetimi (P1) — içe aktarma kanonik olmayan b1/b2 kaydı üretiyordu ("rafNo", isDemirbas yok, uydurma
    //        "Unbranded"/"Sarf"/limit 3, sayı olmayan adet → 0) ve tüm depoyu saveData ile parça parça yazıyordu; CSV dalı dosyayı
    //        ArrayBuffer olarak okuyup metin gibi bölmeye çalıştığı için hiç çalışmıyordu. saveData'nın b1/b2 tam 'set'
    //        sözleşmesi bu yüzden esnetilmişti (artık esnek değil).
    // [HOW]: Ayrıştırma/eşleme/doğrulama StockImport'ta (saf, birim testli): başlık adlarıyla eşleme, Schema.toCanonicalStock,
    //        validateB1/B2 tam sözleşmesi. Tek hatalı satır bile varsa hiçbir şey yazılmaz. Onaydan sonra YENİ kayıtlar, yeni
    //        raflar ve raf sayaçları atomicImportStock ile hepsi-ya-da-hiçbiri yazılır (depodaki mevcut kayıtlar yeniden yazılmaz).
    //        MAX_IMPORT_ROWS (200, bkz. stock-import.js dosya başı) tek dosyada kabul edilen üst sınırdır — admin dahil aşılamaz.
    async function importExcel(event) {
        const input = event.target;
        const file = input.files[0];
        const depo = input.getAttribute('data-depo') || 'b1';
        input.value = '';   // aynı dosya ikinci kez seçilebilsin
        if (!file) return;
        // Faz 4 · J1 (M1): içe aktarma b1/b2 yazması — yalnız admin (B2 etiketi kapısızdı, B1 etiketi dosya seçiciyi yine açıyordu).
        if (!window.requireDbAdmin('Excel içe aktarma')) return;
        const I = window.StockImport;
        if (!I || !window.Schema || typeof window.atomicImportStock !== 'function') { showAppAlert('İçe aktarma modülü yüklenemedi; sayfayı yenileyin.', 'error'); return; }

        let rows;
        try {
            const buf = await file.arrayBuffer();
            rows = /\.csv$/i.test(file.name) ? I.parseCsv(I.decodeText(buf)) : I.sheetRows(XLSX, buf);
        } catch (err) {
            console.error('İçe aktarma: dosya okunamadı', err);
            showAppAlert('Dosya okunamadı. CSV (UTF-8 / Windows-1254) veya Excel (.xlsx/.xls) olmalı.', 'error');
            return;
        }

        // Raf yerleşimi ("Auto-Create & Overflow"): buradaki yerel katalogla yalnız ÖNİZLENİR (onay diyaloğu). Kesin karar,
        // yeni rafların yaratılması ve sayaçların artırılması atomicImportStock'ta ürünlerle AYNI hepsi-ya-da-hiçbiri işte,
        // sunucudan taze okunan raf belgeleriyle verilir (v3.3 P1).
        const shelfCapacityInfo = new Map((window.data.shelves || [])
            .filter(s => s && s.depot === depo && typeof s.code === 'string')
            .map(s => [s.code, { capacity: s.capacity, usedSlots: s.usedSlots, active: s.active }]));
        const res = I.buildStockRecords(rows, depo, {
            schema: window.Schema,
            makeId: window.makeId,
            now: Date.now(),
            shelfCapacityInfo,
            productTypes: typeof window.getActiveProductTypes === 'function'
                ? window.getActiveProductTypes()
                : ((window.data && window.data.productTypes) || []),
        });
        if (res.errors.length) {
            const more = res.errors.length > 5 ? `\n… (+${res.errors.length - 5} hata)` : '';
            showAppAlert(`İçe aktarma durduruldu, hiçbir kayıt yazılmadı.\n${res.errors.slice(0, 5).join('\n')}${more}`, 'error');
            return;
        }
        const initialPreview = I.planShelfPlacement({
            records: res.records, requests: res.shelfRequests, catalog: shelfCapacityInfo, depot: depo,
        });
        const baseWarnings = res.warnings.filter(w => !initialPreview.warnings.includes(w));
        const filtered = I.filterExistingInventoryNumbers(res.records, res.shelfRequests, [
            { depot: 'b1', records: window.data.b1 || [] },
            { depot: 'b2', records: window.data.b2 || [] },
        ], window.Schema);
        res.skippedDuplicates = filtered.skipped;
        res.shelfRequests = filtered.requests;
        const filteredPreview = I.planShelfPlacement({
            records: filtered.records, requests: filtered.requests, catalog: shelfCapacityInfo, depot: depo,
        });
        res.records = filteredPreview.records;
        res.shelvesToCreate = filteredPreview.shelvesToCreate;
        res.poolOverflowCount = filteredPreview.poolOverflowCount;
        res.poolInactiveCount = filteredPreview.poolInactiveCount;
        res.warnings = [...baseWarnings, ...filteredPreview.warnings];
        res.shelfCorrections = I.findShelfCorrections(filtered.requests, shelfCapacityInfo);
        const duplicateDetails = (list, limit = 5) => {
            const lines = list.slice(0, limit).map(item =>
                `${item.envanterNo}: ${item.incoming.ürün} → ${item.matches.map(match => `${match.depot.toUpperCase()} / ${match.ürün}`).join(', ')}` +
                (item.differences.length ? ` (farklı alanlar: ${item.differences.join(', ')})` : '')
            );
            if (list.length > limit) lines.push(`… (+${list.length - limit} kayıt)`);
            return lines.join('\n');
        };
        if (!res.records.length) {
            if (res.skippedDuplicates.length) {
                showAppAlert(`${res.skippedDuplicates.length} ürün Envanter No nedeniyle zaten kayıtlı; hiçbir ürün yeniden eklenmedi.\n${duplicateDetails(res.skippedDuplicates, Infinity)}`, 'info');
            } else {
                showAppAlert('Yüklenecek geçerli veri bulunamadı!', 'error');
            }
            return;
        }

        if (res.shelfCorrections.length) {
            if (typeof window.showCustomConfirm !== 'function') {
                showAppAlert('Raf eşleşme penceresi açılamadı; hiçbir kayıt içe aktarılmadı.', 'error');
                return;
            }
            const content = document.createElement('div');
            const intro = document.createElement('p');
            intro.textContent = 'Dosyadaki raf kodu ile mevcut raf arasında yalnızca nokta, tire veya boşluk farkı bulundu. Her satır için kullanılacak rafı seçin. Seçim yalnızca bu içe aktarmada geçerlidir.';
            content.appendChild(intro);
            const table = document.createElement('table');
            table.style.cssText = 'width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; text-align:left;';
            const header = document.createElement('tr');
            ['Dosyadaki raf', 'Eşleşecek mevcut raf'].forEach(text => {
                const cell = document.createElement('th');
                cell.textContent = text;
                cell.style.cssText = 'padding:6px; border-bottom:1px solid #cbd5e1;';
                header.appendChild(cell);
            });
            table.appendChild(header);
            res.shelfCorrections.forEach(correction => {
                const row = document.createElement('tr');
                const source = document.createElement('td');
                source.textContent = correction.code;
                source.style.cssText = 'padding:6px; border-bottom:1px solid #e2e8f0;';
                const target = document.createElement('td');
                target.style.cssText = 'padding:6px; border-bottom:1px solid #e2e8f0;';
                const select = document.createElement('select');
                select.dataset.importShelfCode = correction.code;
                select.style.cssText = 'width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px;';
                const newShelf = document.createElement('option');
                newShelf.value = '';
                newShelf.textContent = `Yeni raf oluştur: ${correction.code}`;
                select.appendChild(newShelf);
                correction.candidates.forEach(candidate => {
                    const option = document.createElement('option');
                    option.value = candidate;
                    option.textContent = candidate;
                    select.appendChild(option);
                });
                if (correction.candidates.length === 1) select.value = correction.candidates[0];
                target.appendChild(select);
                row.append(source, target);
                table.appendChild(row);
            });
            content.appendChild(table);
            if (res.shelfCorrections.some(c => c.candidates.length > 1)) {
                const ambiguous = document.createElement('p');
                ambiguous.textContent = 'Birden fazla eşleşme bulunan satırlarda seçim otomatik yapılmadı; listeden doğru rafı seçin veya yeni raf olarak bırakın.';
                content.appendChild(ambiguous);
            }
            const accepted = await window.showCustomConfirm('Raf Eşleşmelerini Kontrol Et', content, {
                confirmText: 'Seçimleri Uygula',
                cancelText: 'İçe Aktarmayı İptal Et',
            });
            if (accepted !== true) return;

            const choices = {};
            content.querySelectorAll('select[data-import-shelf-code]').forEach(select => {
                choices[select.dataset.importShelfCode] = select.value;
            });
            try {
                const oldPreview = I.planShelfPlacement({
                    records: res.records, requests: res.shelfRequests, catalog: shelfCapacityInfo, depot: depo,
                });
                const baseWarnings = res.warnings.filter(w => !oldPreview.warnings.includes(w));
                const corrected = I.applyShelfCorrections(res.records, res.shelfRequests, res.shelfCorrections, choices);
                const preview = I.planShelfPlacement({
                    records: corrected.records, requests: corrected.requests, catalog: shelfCapacityInfo, depot: depo,
                });
                res.records = preview.records;
                res.shelfRequests = corrected.requests;
                res.shelvesToCreate = preview.shelvesToCreate;
                res.poolOverflowCount = preview.poolOverflowCount;
                res.poolInactiveCount = preview.poolInactiveCount;
                res.warnings = [...baseWarnings, ...preview.warnings];
            } catch (err) {
                console.error('İçe aktarma: raf eşleşmesi uygulanamadı', err);
                showAppAlert('Raf eşleşmesi uygulanamadı; hiçbir kayıt içe aktarılmadı.', 'error');
                return;
            }
        }

        const demirbas = res.records.filter(r => r.isDemirbas).length;
        const overflowNote = (res.poolOverflowCount
            ? `\n\n⚠️ ${res.poolOverflowCount} adet ürün, hedef raf dolu olduğu için Havuz'a (rafsız) alınacak.` : '')
            + (res.poolInactiveCount ? `\n⚠️ ${res.poolInactiveCount} adet ürün, hedef raf pasif olduğu için Havuz'a (rafsız) alınacak.` : '');
        const createNote = res.shelvesToCreate.length
            ? `\n\n🆕 ${res.shelvesToCreate.length} yeni raf otomatik oluşturulacak (varsayılan kapasite ${I.DEFAULT_SHELF_CAPACITY}): ${res.shelvesToCreate.slice(0, 5).join(', ')}${res.shelvesToCreate.length > 5 ? '…' : ''}`
            : '';
        const duplicateNote = res.skippedDuplicates.length
            ? `\n\n${res.skippedDuplicates.length} ürün Envanter No zaten kayıtlı olduğu için atlanacak; mevcut kayıtlar değiştirilmez:\n${duplicateDetails(res.skippedDuplicates)}`
            : '';
        const question = `${res.records.length} yeni ürün ${depo.toUpperCase()} deposuna eklenecek (${demirbas} demirbaş, ${res.records.length - demirbas} sarf). ` +
            `Mevcut kayıtlara dokunulmaz.${duplicateNote}${createNote}${overflowNote}${res.warnings.length ? '\n\nUyarılar:\n' + res.warnings.slice(0, 5).join('\n') : ''}`;
        const ok = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Excel / CSV İçe Aktarma', question, { confirmText: 'İçe Aktar' })
            : window.confirm(question);
        if (ok !== true) return;

        let out;
        try {
            out = await window.atomicImportStock(depo, res.records, res.shelfRequests);
        } catch (err) {
            const msg = err && err.code === 'rolled-back' ? 'Yazma yarıda kesildi; eklenen ürünler, yaratılan raflar ve raf sayaçları birlikte geri alındı — depo işlem öncesi hâlinde.'
                : err && err.code === 'rollback-pending' ? 'Yazma yarıda kesildi; geri alma yönetici oturumunda otomatik tamamlanacak (depo şu an kilitli).'
                : err && err.code === 'conflict' ? 'Raf kataloğu aynı anda başka bir işlemle değişti; hiçbir kayıt yazılmadı. Lütfen tekrar deneyin.'
                : err && err.code === 'import-too-large' ? ''   // mesajın tamamı err.message'da; aşağıda ayrıca eklenmez
                : 'Hiçbir kayıt yazılmadı.';
            showAppAlert(`Ürünler kaydedilemedi. ${msg} ${(err && err.message) || ''}`, 'error');
            return;
        }
        if (typeof renderTable === 'function') renderTable(depo);
        if (typeof window.ShelfMatrix?.render === 'function') window.ShelfMatrix.render();

        // Sonuç taze sunucu planından: önizlemeden farklıysa (bu arada raf dolduysa) gerçek sayılar bildirilir.
        const p = out.placement;
        const parts = [`${out.records.length} yeni ürün başarıyla depoya eklendi ve kaydedildi!`];
        if (out.skippedDuplicates.length) {
            parts.push(`${out.skippedDuplicates.length} ürün aynı Envanter No ile zaten bulunduğu için atlandı; mevcut kayıtlar değiştirilmedi.\n${duplicateDetails(out.skippedDuplicates, Infinity)}`);
        }
        if (p.created.length) parts.push(`${p.created.length} yeni raf oluşturuldu (${p.created.slice(0, 5).join(', ')}${p.created.length > 5 ? '…' : ''}).`);
        if (p.updated.length) parts.push(`${p.updated.length} rafın sayacı güncellendi.`);
        if (p.poolOverflowCount) parts.push(`${p.poolOverflowCount} adet ürün, hedef raf dolu olduğu için Havuz'a alındı.`);
        if (p.poolInactiveCount) parts.push(`${p.poolInactiveCount} adet ürün, hedef raf pasif olduğu için Havuz'a alındı.`);
        showAppAlert(parts.join(' '), p.poolOverflowCount || p.poolInactiveCount ? 'warning' : 'success');
    }

    window.exportToExcel = function (depo) {
        if (!window.data || !window.data[depo]) { showAppAlert("İndirilecek veri bulunamadı!", "error"); return; }
        // v3.6: B1/B2 raporu depo görünümüyle aynı — sayımdaki raflardaki ürünler dahil edilmez.
        const items = depo === 'b3' ? window.data[depo] : window.data[depo].filter(item => !window.Schema?.isRowCountLocked?.(item));
        let excelData = [];
        let sheetName = "";
        if (depo === 'b3') {
            excelData = items.map(item => ({
                ...(n => ({
                    "Raf No": n.rafNo,
                    "Ürün Türü": n.urunTuru,
                    "Ürün Açıklama": n.urunAciklama,
                    "ITSM / Gerekçe": n.sn,
                    "Envanter No": n.envanterNo,
                    "Adet": n.adet,
                    "Not/Gerekçe": n.not,
                    "Alan Kişi": n.alanKisi,
                    "Tarih": n.tarih,
                    "Hareket": n.tip === 'zimmet' ? 'Zimmet' : 'Çıkış'
                }))(window.Schema.normalizeB3(item))
            }));
            sheetName = "Envanter Çıkış Raporu";
        } else {
            // Envanter No hem B1 hem B2 raporuna dahil edilir; import tekrarlarını denetlemek için ortak kimlik alanıdır.
            excelData = items.map(item => {
                const row = {
                    "Sütun": item.sütun || "-",
                    "Raf/Shelf": item.raf || item.rafNo || "-",
                    "Ürün Adı": item.ürün || item.name || "-",
                    "Marka": item.marka || "-",
                    "Adet": parseInt(item.adet || item.qty) || 0,
                    "Durumu": item.durumu || "-",
                    "Ürün Türü": item.tür || item.type || "-",
                    "Kritik Limit": item.limit || 3,
                    "Son Güncelleme": tsToTurkiye(item.lastUpdate)
                };
                row["Envanter No"] = item.envanterNo || "-";
                row["Seri No"] = item.sn || "-";
                return row;
            });
            sheetName = depo.toUpperCase() + " Deposu";
        }
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
        XLSX.writeFile(wb, `${depo.toUpperCase()}_Rapor_${dateStr}.xlsx`);
        showAppAlert(`${depo.toUpperCase()} Raporu oluşturuldu.`, "success");
    };

    // Taşıma öncesi script.js'te global olan bildirim aynı adla window'da kalır (index.html / admin.html içe aktarma alanı).
    window.importExcel = importExcel;

    window.AppModules = window.AppModules || {};
    window.AppModules.StockImportExport = Object.freeze({
        exportPDF: window.exportPDF, showImportFormatHelp: window.showImportFormatHelp, importExcel,
        exportToExcel: window.exportToExcel
    });
})();
