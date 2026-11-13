// [WHY]: v3.7 · İP-4 — script.js monolitinden ayrıştırıldı (SoC). Talep tabloları (Gelen Talepler, Taleplerim, Kişi Envanteri)
//        ile talep penceresinin ürün araması ve talep türü alanı tek arayüz modülünde. Yalnız okur ve çizer; talep işlemleri
//        (onay, red, silme, geri çekme) src/modules/request-actions.js'tedir.
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick
//        ve modüller bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı (yalnız IIFE girintisi); taşıma öncesi
//        global olan adlar aynı adlarla window'da kalır, AppModules.RequestTables aynı fonksiyonları taşır
//        (sözleşme: tests/unit/script-bridge-contract.test.mjs).

(function () {
    // 🔷 Gelen Talepler (Admin & MyRequests)
    window.renderRequestsTable = function () {
        const tbody = document.querySelector('#tableRequests tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        // B-4: personelin gönderilmemiş taslakları yönetici listesinde gösterilmez; yalnız sayıları bilgi satırında.
        const all = window.data.requests || [];
        const visible = all.filter(r => !_isDraftRequest(r));
        const draftNote = document.getElementById('requestsDraftNote');
        if (draftNote) {
            const drafts = all.length - visible.length;
            draftNote.textContent = drafts ? `Personelin gönderilmemiş ${drafts} taslak talebi var (listelenmez; gönderildiğinde burada görünür).` : '';
            draftNote.hidden = drafts === 0;
        }
        if (visible.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Henüz bekleyen talep bulunmuyor.</td></tr>';
            return;
        }
        visible.forEach((req, index) => {
            const row = tbody.insertRow();
            const rawDurum = (req.durum || '').trim().toUpperCase();
            const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
            const isRejected = rawDurum === 'REJECTED' || rawDurum === 'REDDEDİLDİ';
            const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
            const isPending = rawDurum === 'BEKLEMEDE' || rawDurum === 'BEKLİYOR' || rawDurum === 'BEKLIYOR' || rawDurum === '';

            const statusClass = isPending ? 'status-pending-pill' :
                (isApproved ? 'status-approved-pill' :
                    (isRejected ? 'status-rejected-pill' :
                        (isCompleted ? 'status-completed-pill' : 'status-pending-pill')));
            const statusText = isPending ? 'Bekliyor' :
                (isApproved ? 'Onaylandı' :
                    (isRejected ? 'Reddedildi' :
                        (isCompleted ? 'Teslim Alındı' : req.durum || 'Bilinmiyor')));

            row.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="req-checkbox" value="${escapeHtml(req.id)}"></td>
            <td>${escapeHtml(req.tarih || "-")}</td>
            <td>${escapeHtml(req.personel || "-")}</td>
            <td>${escapeHtml(req.ürün || "-")} <strong>(${escapeHtml(req.adet || 1)} Adet)</strong></td>
            <td style="color:#7f8c8d;">${escapeHtml(req.not || "-")}</td>
            <td style="font-weight:bold; color:#2c3e50;">${escapeHtml(req.sn || "-")}</td>
            <td style="text-align:center;"><span class="status-badge-pill ${statusClass}">${escapeHtml(statusText)}</span>${isRejected && req.redGerekcesi ? `<div class="req-reject-reason">${escapeHtml(req.redGerekcesi)}</div>` : ''}</td>
            <td style="text-align:center;">
                ${isPending ? `
                    <button onclick="confirmRequest(${jsArg(req.id)})" class="req-approve-btn">Onayla</button>
                    <button onclick="rejectRequest(${jsArg(req.id)})" class="req-reject-btn">Reddet</button>
                ` : `<span class="req-done-text">${isCompleted ? 'Teslim Alındı' : 'İşlem Yapıldı'}</span>`}
            </td>
        `;
        });
    };

    function renderMyRequestsTable() {
        const tbody = document.querySelector('#tableMyRequests tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const currentUser = window.getActiveUser();
        if (!currentUser) return;

        // Sahiplik zimmet servisinden (3.7): personelId → eski talepte kod → Türkçe güvenli ad.
        const myReqs = window.data.requests.filter(r =>
            window.AssignmentService.isMyRequest(r, currentUser)
        );

        if (myReqs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Henüz bir talebiniz bulunmuyor.</td></tr>';
            return;
        }

        myReqs.forEach((req) => {
            const rid = jsArg(req.id); // DATA-06: işlemler talep id'siyle
            const row = tbody.insertRow();
            const rawDurum = (req.durum || '').trim().toUpperCase();
            const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
            const isRejected = rawDurum === 'REJECTED' || rawDurum === 'REDDEDİLDİ';
            const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
            const isDraft = rawDurum === 'DRAFT' || rawDurum === 'TASLAK';
            const isPending = rawDurum === 'BEKLEMEDE' || rawDurum === 'BEKLİYOR' || rawDurum === 'BEKLIYOR' || rawDurum === '';

            let statusHTML = '';
            if (isPending) statusHTML = `<div class="status-badge-pill status-pending-pill">ONAY BEKLİYOR</div>`;
            else if (isApproved) statusHTML = `<div class="status-badge-pill status-approved-pill">ONAYLANDI</div>`;
            else if (isRejected) statusHTML = `<div class="status-badge-pill status-rejected-pill">REDDEDİLDİ</div>${req.redGerekcesi ? `<div class="req-reject-reason"><strong>Gerekçe:</strong> ${escapeHtml(req.redGerekcesi)}</div>` : ''}`;
            else if (isCompleted) statusHTML = `<div class="status-badge-pill status-completed-pill">TESLİM ALINDI</div>`;
            else if (isDraft) statusHTML = `<div class="status-badge-pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">TASLAK</div>`;
            else statusHTML = `<div class="status-badge-pill status-pending-pill">${escapeHtml(req.durum || '-')}</div>`;
            // Faz 2 (B-1): onaylanan sarf talebi tüketim çıkışıdır — personele envanterine eklenmeyeceği söylenir.
            if ((isApproved || isCompleted) && (window.data.b3 || []).some(b => String(b.requestId) === String(req.id) && window.Schema.normalizeB3(b).tip === 'cikis')) {
                statusHTML += '<div class="req-outcome-note">Tüketim çıkışı — envanterinize eklenmez</div>';
            }

            row.innerHTML = `
            <td>${escapeHtml(req.tarih)}</td>
            <td>
                <strong>${escapeHtml(req.ürün)}</strong><br>
                <small style="color: #666; font-weight: bold;">Miktar: ${escapeHtml(req.adet || 1)} Adet</small>
            </td>
            <td style="text-align: center; vertical-align: middle;">${statusHTML}</td>
            <td style="text-align: center; vertical-align: middle;">${escapeHtml(req.teslimTarihi || '-')}</td>
            <td style="text-align: center; vertical-align: middle;">
                ${isCompleted ?
                `<div class="status-badge-pill status-completed-pill" style="min-width: 120px; justify-content: center; margin: 0 auto;">Teslim Alındı</div>` :
                isApproved ?
                    `<button class="save-btn" onclick="receiveProduct(${rid})" style="background-color: var(--color-primary); cursor: pointer; min-width: 120px;">Teslim Aldım</button>` :
                    isDraft ?
                        `<div class="d-flex gap-1" style="justify-content: center;">
                        <button class="edit-btn" onclick="window.editPersonnelInventoryRequest(${rid})" style="padding: 5px 10px; font-size: 11px;">Düzenle</button>
                        <button class="save-btn" onclick="window.sendDraftInventoryRequest(${rid})" style="padding: 5px 10px; font-size: 11px; background: #10b981;">Gönder</button>
                     </div>` :
                        isRejected ?
                            `<div class="status-badge-pill status-rejected-pill" style="min-width: 120px; justify-content: center; margin: 0 auto;">Talep Reddedildi</div>` :
                            `<button class="delete-btn" onclick="window.withdrawInventoryRequest(${rid})" style="background-color: #fca5a5; color: #7f1d1d; min-width: 120px; font-size: 11px;">Talebi Geri Çek</button>`
            }
            </td>
        `;
        });
    }

    window.renderPersonnelInventoryTable = function () {
        const tbody = document.querySelector('#tablePersonnelInventory tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        const currentUser = window.getActiveUser();
        if (!currentUser) return;

        // [WHY]: Yalnız teslim alınmış talepler taranıyordu; admin'in "Zimmet Yap" ile verdiği zimmetler hiç görünmüyor, iade
        //        edilenler listede kalıyordu (ITSM-04, saha notu 29.09 #1).
        // [HOW] (3.7): Zimmet servisi — admin Zimmet ekranıyla aynı liste; kullanıcının aktif ve teslim alınmış zimmetleri.
        // Faz 3 (B-3): onaylanıp henüz teslim alınmamış kalemler de listenin başında "Teslim Bekliyor" rozetiyle görünür (zimmet
        // tutanağına girmez); varsa üstte Taleplerim'e yönlendiren bilgi satırı çıkar.
        const A = window.AssignmentService;
        const toRow = a => ({
            tarih: a.teslimTarihi || a.tarih,
            ürün: a.urun,
            sn: a.sn,
            envanterNo: a.envanterNo,
            adet: a.adet,
            isDemirbas: a.isDemirbas,
            not: a.not,
            state: A.assignmentState(a),
            asg: a,   // Faz 5: "İade Talebi" düğmesi (ReturnRequests.staffActionCell)
        });
        const awaiting = A.getPendingDeliveries(currentUser).map(toRow);
        const myInventory = [...awaiting, ...A.getPersonInventory(currentUser).map(toRow)];
        const note = document.getElementById('personnelAwaitingNote');
        if (note) {
            note.hidden = awaiting.length === 0;
            const text = note.querySelector('[data-role="text"]');
            if (text) text.textContent = `Onaylanan ${awaiting.length} kalem teslim almanızı bekliyor. Teslim aldığınızda "Taleplerim" ekranında "Teslim Aldım" deyin; kalem zimmetinize ve tutanağınıza o zaman geçer.`;
        }
        if (myInventory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--color-text-muted);">Üzerinize kayıtlı envanter bulunmamaktadır.</td></tr>';
            return;
        }

        myInventory.forEach((req) => {
            const row = tbody.insertRow();
            const isDem = req.isDemirbas === true || req.isDemirbas === "true";
            const typeText = isDem ? 'Demirbaş' : 'Sarf Malzeme';
            const typeBadgeStyle = isDem
                ? 'background: var(--color-purple-light); color: var(--color-purple); border: 1px solid rgba(167, 139, 250, 0.2);'
                : 'background: var(--color-info-light); color: var(--color-info); border: 1px solid rgba(96, 165, 250, 0.2);';

            row.innerHTML = `
            <td>${escapeHtml(req.tarih || "-")}</td>
            <td><strong>${escapeHtml(req.ürün || "-")}</strong></td>
            <td style="font-weight:bold; color: var(--color-text);">${escapeHtml(req.sn || "-")}${req.envanterNo && req.envanterNo !== '-' ? `<div style="font-weight:normal; font-size:11px; color:var(--color-text-muted);">Env. No: ${escapeHtml(req.envanterNo)}</div>` : ''}</td>
            <td>${escapeHtml(req.adet || 1)} Adet</td>
            <td><span class="status-badge-pill" style="min-width: 100px; padding: 6px 12px; font-size: 11px; ${typeBadgeStyle}">${typeText}</span></td>
            <td>${A.stateBadgeHtml(req.state) /* xss-ok: sabit durum anahtarı ve etiketi (AssignmentService.STATE_LABELS) */}</td>
            <td style="color: var(--color-text-muted);">${escapeHtml(req.not || "-")}</td>
        `;
            if (req.state === 'teslimBekliyor') row.classList.add('zim-row-awaiting');
            row.append(window.ReturnRequests ? window.ReturnRequests.staffActionCell(req.asg) : document.createElement('td'));
        });
        if (window.ReturnRequests) window.ReturnRequests.renderMine();
    };

    // Talep penceresi: ürün araması ve talep türü (v3.7'ye kadar script.js'teydi)
    window.searchForRequest = function () {
        const filter = document.getElementById('reqSearch').value.toLocaleLowerCase('tr-TR');
        const list = document.getElementById('reqProductList');
        if (!list) return;
        if (filter.length < 2) { list.style.display = 'none'; return; }
        list.innerHTML = '';
        const allProducts = [...(window.data.b1 || []), ...(window.data.b2 || [])].filter(item => !window.Schema?.isRowCountLocked?.(item));
        const results = allProducts.filter(item =>
            (item.ürün || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.marka || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.model || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.raf || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.tür || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.açıklama || "").toLocaleLowerCase('tr-TR').includes(filter) ||
            (item.envanterNo || "").toLocaleLowerCase('tr-TR').includes(filter)
        ).slice(0, 8);

        if (results.length > 0) {
            list.style.display = 'block';
            results.forEach(item => {
                const div = document.createElement('div');
                div.style = "padding: 12px; border-bottom: 1px solid #f1f2f6; cursor: pointer; transition: background 0.2s;";
                div.className = "search-item-hover";
                div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div><strong style="color: #0984e3;">${escapeHtml(item.ürün)}</strong> <span style="font-size: 0.85em; color: #636e72;">${escapeHtml(item.marka || '')}</span></div>
                    <div style="text-align: right;"><span style="display: block; font-size: 0.75em; background: #dfe6e9; padding: 2px 6px; border-radius: 4px;">Raf: ${escapeHtml(item.raf)}</span><small style="color: ${escapeHtml(item.adet > 0 ? '#27ae60' : '#d63031')}">Stok: ${escapeHtml(item.adet)}</small></div>
                </div>`;
                div.onmouseover = () => div.style.backgroundColor = "#f8f9fa";
                div.onmouseout = () => div.style.backgroundColor = "white";
                div.onclick = () => {
                    document.getElementById('reqProdName').value = `${item.marka || ''} ${item.ürün}`.trim();
                    document.getElementById('reqSearch').value = "";
                    list.style.display = 'none';
                };
                list.appendChild(div);
            });
        } else { list.style.display = 'none'; }
    };

    window.onReqTypeChange = function () {
        const reqType = document.getElementById('reqType');
        const container = document.getElementById('reqReturnDateContainer');
        const reqReturnDate = document.getElementById('reqReturnDate');
        if (!reqType || !container || !reqReturnDate) return;

        if (reqType.value === 'Geçici Zimmet') {
            container.style.display = 'block';
            reqReturnDate.setAttribute('required', 'required');
        } else {
            container.style.display = 'none';
            reqReturnDate.removeAttribute('required');
            reqReturnDate.value = '';
        }
    };

    // Taşıma öncesi script.js'te global olan bildirim aynı adla window'da kalır (main.js, inventory-logic.js ve talep işlemleri).
    window.renderMyRequestsTable = renderMyRequestsTable;

    window.AppModules = window.AppModules || {};
    window.AppModules.RequestTables = Object.freeze({
        renderRequestsTable: window.renderRequestsTable, renderMyRequestsTable,
        renderPersonnelInventoryTable: window.renderPersonnelInventoryTable, searchForRequest: window.searchForRequest,
        onReqTypeChange: window.onReqTypeChange
    });
})();
