// [WHY]: v3.7 · İP-2 — script.js monolitinden ayrıştırıldı (SoC). B3 (Giriş-Çıkış hareketleri) tablosu ve mobil kart görünümü,
//        B3 PDF'i, toplu silme ve "Tümünü Seç" dinleyicisi tek arayüz modülünde. Okuma Schema.normalizeB3'ten, silme servis
//        köprüsüyle (window.bulkRemove / window.removeItem) ID tabanlı yapılır; window.data değiştirilmez.
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick
//        ve modüller bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı (yalnız IIFE girintisi); taşıma öncesi
//        global olan adlar aynı adlarla window'da kalır, AppModules.MovementTable aynı fonksiyonları taşır
//        (sözleşme: tests/unit/script-bridge-contract.test.mjs).

(function () {
    // [WHY]: b3'te birden çok şema vardı; tablo, Excel ve PDF'ler farklı alt kümelerini okuyordu (Tur 2.5'te yalnız bu okuyucu
    //        yamanmıştı, ürün taşınınca/silinince tür yine boşalıyordu).
    // [HOW] (3.6): Tüm okuyucular Schema.normalizeB3'ten okur. normalizeB3Row eski çağıranlar için aynı anahtarları döner.
    window.normalizeB3Row = function (item) {
        const n = window.Schema.normalizeB3(item);
        return { raf: n.rafNo, tur: n.urunTuru, urun: n.urunAciklama, sn: n.sn, adet: n.adet, not: n.not, alanKisi: n.alanKisi, tarih: n.tarih };
    };

    // b3 PDF'i stok tablosu sütunlarıyla (Sütun/Raf/Ürün/Marka/Durum) basılıyordu; çıkış kayıtlarında hepsi "-" çıkıyordu.
    function _exportB3PDF() {
        const rows = (window.data.b3 || []).map(item => window.Schema.normalizeB3(item));
        const cell = v => `<td>${escapeHtml(v)}</td>`;
        const html = `<html><head><title>B3 Çıkış Raporu</title><style>
        body { font-family: "Roboto", Arial, sans-serif; margin: 0; padding: 20px; color: #222; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #cfd6dc; padding: 5px 6px; text-align: left; vertical-align: top; }
        th { background: #2c3e50; color: white; font-weight: 600; }
        tr:nth-child(even) { background: #f7f9fb; }
    </style></head><body><div style="font-size:18px; font-weight:bold; margin-bottom:6px;">B3 ENVANTER ÇIKIŞ KAYITLARI</div>
    <div style="font-size:12px; margin-bottom:14px;">Rapor Tarihi: ${escapeHtml(getTurkiyeSaati())}</div>
    <table><thead><tr><th>#</th><th>Raf No</th><th>Ürün Türü</th><th>Ürün Açıklama</th><th>SN</th><th>Envanter No</th><th>Adet</th><th>Not</th><th>Alan Kişi</th><th>Tarih</th><th>Hareket</th></tr></thead><tbody>
    ${rows.map((n, i) => `<tr>${[i + 1, n.rafNo, n.urunTuru, n.urunAciklama, n.sn, n.envanterNo, n.adet, n.not, n.alanKisi, n.tarih, n.tip === 'zimmet' ? 'Zimmet' : 'Çıkış'].map(cell).join('')}</tr>`).join('')}
    </tbody></table></body></html>`;
        const win = window.open('', '', 'width=1400,height=900');
        if (!win) { showAppAlert('Açılır pencere engellendi; PDF için izin verin.', 'warning'); return; }
        win.document.write(html);
        win.document.close();
        setTimeout(() => { win.print(); win.close(); }, 300);
    }

    // [WHY]: B3 bir depo listesi değil, hareket/zimmet kütüğüdür; mobilde tablo yatay kaydırmayla okunamıyordu.
    // [HOW]: renderExitTable() arama süzgecini uygular ve etkin görünüme göre tabloyu ya da gün gruplu kartları çizer.
    //        Telefon genişliğinde (≤768px) kart modu otomatik açılır; kullanıcı #viewToggleB3 ile tabloya geçebilir.
    window._cardViewActive = window._cardViewActive || {};
    const B3_CARD_MQ = window.matchMedia('(max-width: 768px)');

    function _b3SearchText(row) {
        return [row.rafNo, row.urunTuru, row.urunAciklama, row.marka, row.sn, row.envanterNo, row.not, row.alanKisi, row.tarih]
            .join(' ').toLocaleLowerCase('tr-TR');
    }

    function _getB3Rows() {
        const term = (document.getElementById('searchB3')?.value || '').trim().toLocaleLowerCase('tr-TR');
        return (window.data.b3 || []).map(item => ({ item, row: window.Schema.normalizeB3(item) }))
            .filter(({ row }) => !term || _b3SearchText(row).includes(term));
    }

    // [WHY]: "Çıkışı Geri Al" butonu her satırda aktifti ama onclick yalnız bir "geliştirme aşamasında" bildirimine
    //        bağlıydı (window.showUndoNotice); artık window.undoExit ile gerçek işlemi yapıyor. Yalnız demirbaş
    //        tip:'cikis' kayıtları geri alınabilir (sarf iade edilmez, hurda bilinçli olarak tek yönlü, zimmet
    //        kendi "Zimmetten Düş" akışını kullanır) — uygun olmayan satırlarda buton nedeni açıklayan title ile pasif.
    // [HOW]: row, normalizeB3'ten (_getB3Rows zaten üretiyor); AssignmentService.planUndoExit ile aynı kurallar.
    function _b3UndoDisabledReason(row) {
        if (row.tip !== 'cikis') return 'Yalnız çıkış kayıtları buradan geri alınır (zimmet: "Zimmetten Düş").';
        if (row.iadeEdildi) return 'Bu çıkış zaten geri alınmış.';
        if (!row.isDemirbas) return 'Sarf malzeme çıkışı geri alınamaz.';
        if (row.stokDisi || !row.productId) return 'Stok dışı girilmiş kayıt; geri alınacak depo satırı yok.';
        return '';
    }
    function _b3ActionButtons(id, row) {
        const reason = row ? _b3UndoDisabledReason(row) : '';
        const undoAttrs = reason ? `disabled title="${escapeHtml(reason)}" aria-disabled="true"` : `title="Çıkışı Geri Al" onclick="window.undoExit(${jsArg(id)})"`;
        return `<button type="button" class="table-action-btn pdf-btn btn-pdf" title="Zimmet Tutanağı Yazdır" aria-label="Zimmet tutanağı yazdır" onclick="generateZimmetPDF(${jsArg(id)})">
                <i class="fas fa-file-pdf"></i> <span>PDF</span>
            </button>
            <button type="button" class="table-action-btn undo-btn btn-undo" aria-label="Çıkışı geri al" ${undoAttrs}>
                <i class="fas fa-rotate-left"></i> <span>Geri Al</span>
            </button>
            <button type="button" class="table-action-btn delete-btn btn-delete" title="Kaydı Sil" aria-label="Kaydı sil" onclick="if(validateAdminAction()) deleteB3Row(${jsArg(id)})">
                <i class="fas fa-trash-alt"></i> <span>Sil</span>
            </button>`;
    }

    function _applyB3ViewState() {
        const active = !!window._cardViewActive.b3;
        const section = document.getElementById('b3');
        const tableWrapper = document.querySelector('#b3 .table-responsive-wrapper');
        const cardContainer = document.getElementById('cardViewB3');
        const toggleBtn = document.getElementById('viewToggleB3');
        if (section) section.classList.toggle('b3-cards-active', active);
        if (tableWrapper) tableWrapper.style.display = active ? 'none' : '';
        if (cardContainer) cardContainer.style.display = active ? 'block' : 'none';
        if (toggleBtn) {
            const label = active ? 'Tablo Görünümüne Geç' : 'Kart Görünümüne Geç';
            toggleBtn.innerHTML = active ? '<i class="fas fa-table"></i>' : '<i class="fas fa-th-large"></i>';
            toggleBtn.title = label;
            toggleBtn.setAttribute('aria-label', label);
            toggleBtn.classList.toggle('view-toggle-active', active);
        }
        const selectAll = document.getElementById('selectAllB3');
        if (selectAll) selectAll.checked = false;
        _syncB3SelectionUI();
    }

    // [WHY]: v3.8 UX-4 · B3 tablo/kart satırlarında "Seç" sütunu yerine satıra tıkla-seç + Shift aralık seçimi.
    // [HOW]: Seçili .b3-selectable-row.selected-row öğelerini sayar; #b3SelectionPill göstergesini günceller.
    let _b3LastClicked = null;
    function _getB3SelectableEls() {
        const scope = window._cardViewActive.b3 ? '#cardViewB3' : '#tableB3';
        return Array.from(document.querySelectorAll(`${scope} .b3-selectable-row`));
    }
    function _syncB3SelectionUI() {
        const all = _getB3SelectableEls();
        const selected = all.filter(el => el.classList.contains('selected-row'));
        const pill = document.getElementById('b3SelectionPill');
        const countEl = document.getElementById('b3SelectionCount');
        const selAllBtn = document.getElementById('b3SelectAllBtn');
        if (pill) pill.hidden = selected.length === 0;
        if (countEl) countEl.textContent = `${selected.length} kayıt seçildi`;
        if (selAllBtn) selAllBtn.textContent = (all.length > 0 && selected.length === all.length) ? 'Seçimi Kaldır' : 'Tümünü Seç';
        const cardsCb = document.getElementById('selectAllB3Cards');
        if (cardsCb) cardsCb.checked = all.length > 0 && selected.length === all.length;
    }
    function _toggleB3RowSelection(targetEl, shiftKey) {
        const rows = _getB3SelectableEls();
        if (shiftKey && _b3LastClicked && rows.includes(_b3LastClicked)) {
            const a = rows.indexOf(_b3LastClicked);
            const b = rows.indexOf(targetEl);
            if (a >= 0 && b >= 0) {
                const [start, end] = a < b ? [a, b] : [b, a];
                const nextState = !targetEl.classList.contains('selected-row');
                for (let i = start; i <= end; i++) rows[i].classList.toggle('selected-row', nextState);
                _b3LastClicked = targetEl;
                _syncB3SelectionUI();
                return;
            }
        }
        targetEl.classList.toggle('selected-row');
        _b3LastClicked = targetEl;
        _syncB3SelectionUI();
    }
    function _bindB3Selection(container) {
        if (!container || container._b3ClickSelectBound) return;
        container._b3ClickSelectBound = true;
        container.addEventListener('click', e => {
            if (e.target.closest('button, a, input, label, select, textarea, summary, details, .table-row-actions, .b3-card-actions')) return;
            const rowEl = e.target.closest('.b3-selectable-row');
            if (!rowEl) return;
            _toggleB3RowSelection(rowEl, e.shiftKey);
        });
    }

    function _renderB3Table(rows) {
        const tbody = document.querySelector('#tableB3 tbody');
        if (!tbody) return;
        _b3LastClicked = null;
        if (rows.length === 0) {
            const msg = (window.data.b3 || []).length ? 'Aramanızla eşleşen çıkış kaydı yok.' : 'Çıkış kaydı bulunamadı.';
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">${msg}</td></tr>`;
            _syncB3SelectionUI();
            return;
        }
        tbody.innerHTML = rows.map(({ item, row }) => {
            const isPassive = (item.durumu === 'Pasif' || item.status === 'Pasif');
            const envNo = row.envanterNo !== '-' ? `<div class="b3-env-sub">Env. No: ${escapeHtml(row.envanterNo)}</div>` : '';
            return `<tr class="${isPassive ? 'passive-row ' : ''}selectable-row b3-selectable-row" data-depo="b3" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(row.urunAciklama)}">
            <td${row.stokDisi ? ' style="color:var(--color-text-muted); font-style:italic;"' : ''}>${escapeHtml(row.rafNo)}</td>
            <td>${escapeHtml(row.urunTuru)}</td>
            <td>${escapeHtml(row.urunAciklama)}</td>
            <td><span class="b3-mono">${escapeHtml(row.sn)}</span>${envNo}</td>
            <td>${escapeHtml(row.adet)}</td>
            <td>${escapeHtml(row.not)}</td>
            <td>${escapeHtml(row.alanKisi)}</td>
            <td>${escapeHtml(row.tarih)}</td>
            <td class="action-cell">
                <div class="table-row-actions">${_b3ActionButtons(item.id, row) /* xss-ok: id jsArg ile kaçırılır, geri kalan sabit */}</div>
            </td>
        </tr>`;
        }).join('');
        _bindB3Selection(tbody);
        _syncB3SelectionUI();
    }

    // Tarih "03.11.2026 14:22:11" biçimindedir; gün ve saat ayrılır. Tarih yoksa kaydın zaman damgası kullanılır.
    function _b3DayParts(row) {
        let raw = row.tarih !== '-' ? row.tarih : (row.ts ? tsToTurkiye(row.ts) : '');
        raw = String(raw || '').replace(',', '').trim();
        const [day = '', time = ''] = raw.split(/\s+/);
        return { day: day || 'Tarihsiz', time: time ? time.slice(0, 5) : '' };
    }

    function _b3DayLabel(day) {
        const today = getTurkiyeTarihi();
        const y = new Date(Date.now() - 864e5).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
        if (day === today) return 'Bugün';
        if (day === y) return 'Dün';
        return day;
    }

    function _renderB3Cards(rows) {
        const container = document.getElementById('cardViewB3');
        if (!container) return;
        if (rows.length === 0) {
            const searching = (window.data.b3 || []).length > 0;
            container.innerHTML = `<div class="card-empty-state">
                <i class="fas ${searching ? 'fa-search' : 'fa-box-open'}"></i>
                <p>${searching ? 'Aramanızla eşleşen çıkış kaydı yok.' : 'Çıkış kaydı bulunamadı.'}</p>
            </div>`;
            return;
        }
        const sorted = [...rows].sort((a, b) => (b.row.ts || 0) - (a.row.ts || 0));
        const groups = [];
        sorted.forEach(entry => {
            const parts = _b3DayParts(entry.row);
            let g = groups[groups.length - 1];
            if (!g || g.day !== parts.day) { g = { day: parts.day, items: [] }; groups.push(g); }
            g.items.push({ ...entry, time: parts.time });
        });

        const tipLabel = { zimmet: 'Zimmet', hurda: 'Hurda', cikis: 'Çıkış' };
        const cardHtml = ({ item, row, time }) => {
            const isPassive = (item.durumu === 'Pasif' || item.status === 'Pasif');
            const tip = tipLabel[row.tip] ? row.tip : 'cikis';
            const chips = [
                row.alanKisi !== '-' ? `<span class="b3-chip b3-chip-person"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(row.alanKisi)}</span>` : '',
                row.envanterNo !== '-' ? `<span class="b3-chip b3-chip-env"><i class="fas fa-barcode" aria-hidden="true"></i> ${escapeHtml(row.envanterNo)}</span>` : '',
                row.adet > 0 ? `<span class="b3-chip b3-chip-qty"><i class="fas fa-box" aria-hidden="true"></i> ${escapeHtml(row.adet)} Adet</span>` : ''
            ].join('');
            const detail = (label, value, cls = '') => `<div class="b3-drawer-row"><dt>${escapeHtml(label)}</dt><dd class="${escapeHtml(cls)}">${escapeHtml(value)}</dd></div>`;
            return `<article class="b3-card-item selectable-row b3-selectable-row b3-tip-${escapeHtml(tip)}${isPassive ? ' card-item-passive' : ''}" data-depo="b3" data-id="${escapeHtml(item.id)}">
                <header class="b3-card-header">
                    <div class="b3-card-title">
                        <span class="b3-card-name">${escapeHtml(row.urunAciklama)}</span>
                        <span class="b3-card-sub">${escapeHtml(row.urunTuru)}${row.marka ? ` · ${escapeHtml(row.marka)}` : ''}</span>
                    </div>
                    <div class="b3-card-stamp">
                        <span class="b3-tip-badge">${escapeHtml(tipLabel[tip])}</span>
                        ${time ? `<span class="b3-card-time"><i class="far fa-clock" aria-hidden="true"></i> ${escapeHtml(time)}</span>` : ''}
                    </div>
                </header>
                ${chips ? `<div class="b3-card-hero">${chips}</div>` : ''}
                <details class="b3-card-drawer">
                    <summary><span>Detaylar</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary>
                    <dl>
                        ${detail('Raf / Konum', row.rafNo) /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('ITSM / Gerekçe', row.sn, 'b3-mono') /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('Tarih', row.tarih) /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                        ${detail('Açıklama / Not', row.not, 'b3-note') /* xss-ok: detail() tüm parçaları escapeHtml ile kaçırır */}
                    </dl>
                </details>
                <footer class="b3-card-actions">${_b3ActionButtons(item.id, row) /* xss-ok: id jsArg ile kaçırılır, geri kalan sabit */}</footer>
            </article>`;
        };

        container.innerHTML = `
        <div class="b3-card-toolbar">
            <label class="b3-card-selectall"><input type="checkbox" id="selectAllB3Cards"> Tümünü Seç</label>
            <span class="b3-card-total">${rows.length} kayıt</span>
        </div>
        ${groups.map(g => `
            <section class="b3-day-group">
                <h3 class="b3-day-header">
                    <span><i class="far fa-calendar" aria-hidden="true"></i> ${escapeHtml(_b3DayLabel(g.day))}</span>
                    <span class="b3-day-count">${g.items.length} işlem</span>
                </h3>
                <div class="b3-day-body">${g.items.map(cardHtml).join('')}</div>
            </section>`).join('')}`;
        _bindB3Selection(container);
        _syncB3SelectionUI();
    }

    function renderExitTable() {
        if (window._cardViewActive.b3 === undefined) window._cardViewActive.b3 = B3_CARD_MQ.matches;
        _applyB3ViewState();
        const rows = _getB3Rows();
        if (window._cardViewActive.b3) {
            _renderB3Cards(rows);
            const tbody = document.querySelector('#tableB3 tbody');
            if (tbody) tbody.innerHTML = '';
        } else {
            _renderB3Table(rows);
            const cards = document.getElementById('cardViewB3');
            if (cards) cards.innerHTML = '';
        }
    }
    window.renderExitTable = renderExitTable;

    window.toggleB3CardView = function () {
        window._cardViewActive.b3 = !window._cardViewActive.b3;
        renderExitTable();
    };

    B3_CARD_MQ.addEventListener('change', () => {
        window._cardViewActive.b3 = B3_CARD_MQ.matches;
        renderExitTable();
    });

    window.toggleB3Help = function () {
        const btn = document.getElementById('b3HelpToggle');
        const panel = document.getElementById('b3HelpPanel');
        if (!btn || !panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
    };

    // [WHY]: Çıkış geri alma özelliği için kullanıcı bilgilendirmesi (eski placeholder; buton artık window.undoExit
    //        çağırıyor). Köprü sözleşmesi (script-bridge-contract.test.mjs) adı listelediği için fonksiyon korunuyor.
    window.showUndoNotice = function () {
        if (typeof showAppAlert === 'function') {
            showAppAlert('Geri alma özelliği geliştirme aşamasındadır.', 'info');
        } else {
            alert('Geri alma özelliği geliştirme aşamasındadır.');
        }
    };

    // [WHY]: AssignmentService.planClose ("Zimmetten Düş") deseninin çıkış kayıtlarındaki eşi; buildB3Entry zaten
    //        her çıkışa iadeEdildi alanlarını koyuyordu, yalnız bunu kullanan bir işlem yoktu.
    // [HOW]: planUndoExit (saf plan) başarısızsa kullanıcıya nedeni gösterilir; başarılıysa runStockOps ile stok
    //        +adet ve b3 kaydı iadeEdildi:true tek transaction'da yazılır, tablo ve ilgili depo yeniden çizilir.
    window.undoExit = async function (b3Id) {
        if (typeof validateAdminAction === 'function' && !validateAdminAction()) return;
        const item = (window.data.b3 || []).find(x => x && String(x.id) === String(b3Id));
        const row = item && window.Schema.normalizeB3(item);
        if (!row) { if (typeof showAppAlert === 'function') showAppAlert('Çıkış kaydı bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        const label = `"${row.urunAciklama}"${row.envanterNo !== '-' ? ` (${row.envanterNo})` : (row.sn !== '-' ? ` (SN: ${row.sn})` : '')}`;
        const confirmed = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Çıkışı Geri Al', `${label} çıkışı geri alınacak; ${row.kaynakDepo?.toUpperCase() || 'depo'}ya +${row.adet} adet olarak eklenecek. Onaylıyor musunuz?`)
            : confirm(`${label} çıkışı geri alınsın mı?`);
        if (!confirmed) return;
        const now = typeof getTurkiyeSaati === 'function' ? getTurkiyeSaati() : new Date().toLocaleString('tr-TR');
        const plan = window.AssignmentService.planUndoExit(b3Id, { tarih: now });
        if (!plan.ok) { if (typeof showAppAlert === 'function') showAppAlert(plan.error, 'error'); return; }
        try {
            await window.runStockOps({ stock: plan.stock, writes: plan.writes }, { forbiddenMessage: 'Çıkışı geri alma yalnızca sistem yöneticisi tarafından yapılabilir.' });
        } catch (e) {
            if (typeof showAppAlert === 'function') showAppAlert(`Geri alma kaydedilemedi; kayıt yerinde bırakıldı. ${e.message || ''}`, 'error');
            return;
        }
        if (typeof renderExitTable === 'function') renderExitTable();
        if (typeof window.renderTable === 'function') window.renderTable(plan.view.kaynakDepo);
        if (typeof showAppAlert === 'function') showAppAlert(`${label} çıkışı geri alındı.`, 'success');
    };

    // [WHY]: B3 çıkış kayıtlarının aylık raporlama sonrasında toplu temizlenmesi (v3.8 UX-4 tıkla-seç uyumlu)
    // [HOW]: Seçili satır ID'lerini .b3-selectable-row.selected-row (ve geriye uyumlu .b3-row-select:checked) üzerinden
    //        toplar, yönetici onayından sonra atomic window.bulkRemove('b3', ids) ile siler.
    window.bulkDeleteB3 = async function () {
        if (typeof validateAdminAction === 'function' && !validateAdminAction()) return;
        const selectedRows = Array.from(document.querySelectorAll('#tableB3 .b3-selectable-row.selected-row, #cardViewB3 .b3-selectable-row.selected-row'));
        const legacyChecked = selectedRows.length ? [] : Array.from(document.querySelectorAll('.b3-row-select:checked'));
        const picked = selectedRows.length ? selectedRows : legacyChecked;
        if (picked.length === 0) {
            if (typeof showAppAlert === 'function') showAppAlert('Lütfen silinecek çıkış kayıtlarını seçin.', 'warning');
            return;
        }
        const ids = [...new Set(picked.map(el => el.dataset.id).filter(Boolean))];
        const confirmed = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Toplu Çıkış Kaydı Silme', `${ids.length} adet çıkış kaydı kalıcı olarak silinecek. (Stok değişmez). Onaylıyor musunuz?`)
            : confirm(`${ids.length} adet çıkış kaydı silinsin mi?`);
        if (!confirmed) return;

        try {
            if (typeof window.bulkRemove === 'function') {
                await window.bulkRemove('b3', ids);
            } else if (typeof window.removeItem === 'function') {
                for (const id of ids) {
                    await window.removeItem('b3', id);
                }
            }
            if (typeof renderExitTable === 'function') renderExitTable();
            _syncB3SelectionUI();
            if (typeof showAppAlert === 'function') showAppAlert(`${ids.length} adet çıkış kaydı başarıyla silindi.`, 'success');
        } catch (err) {
            console.error('[bulkDeleteB3] Toplu silme hatası:', err);
            if (typeof showAppAlert === 'function') showAppAlert('Toplu silme sırasında bir hata oluştu.', 'error');
        }
    };

    // [WHY]: B3 çıkış tablosu & kart görünümü "Tümünü Seç" / "Temizle" dinleyicileri (v3.8 UX-4)
    // [HOW]: Delegated change ve click dinleyicileriyle satır/kart .selected-row sınıfları yönetilir.
    document.addEventListener('change', (e) => {
        const scopes = { selectAllB3: '#tableB3', selectAllB3Cards: '#cardViewB3' };
        const scope = e.target && scopes[e.target.id];
        if (scope) {
            const isChecked = e.target.checked;
            document.querySelectorAll(`${scope} .b3-selectable-row`).forEach(el => { el.classList.toggle('selected-row', isChecked); });
            document.querySelectorAll(`${scope} .b3-row-select`).forEach(cb => { cb.checked = isChecked; });
            _syncB3SelectionUI();
        }
    });
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'b3SelectAllBtn') {
            const rows = _getB3SelectableEls();
            const selectAll = rows.some(el => !el.classList.contains('selected-row'));
            rows.forEach(el => el.classList.toggle('selected-row', selectAll));
            _syncB3SelectionUI();
        } else if (e.target && e.target.id === 'b3ClearSelBtn') {
            _getB3SelectableEls().forEach(el => el.classList.remove('selected-row'));
            _b3LastClicked = null;
            _syncB3SelectionUI();
        }
    });

    // Taşıma öncesi script.js'te global olan bildirimler aynı adlarla window'da kalır (ör. exportPDF('b3') → _exportB3PDF).
    Object.assign(window, {
        _exportB3PDF, _b3SearchText, _getB3Rows, _b3ActionButtons, _applyB3ViewState, _renderB3Table, _b3DayParts, _b3DayLabel,
        _renderB3Cards
    });

    window.AppModules = window.AppModules || {};
    window.AppModules.MovementTable = Object.freeze({
        normalizeB3Row: window.normalizeB3Row, renderExitTable, toggleB3CardView: window.toggleB3CardView,
        toggleB3Help: window.toggleB3Help, showUndoNotice: window.showUndoNotice, bulkDeleteB3: window.bulkDeleteB3,
        undoExit: window.undoExit
    });
})();
