// [WHY]: v3.7 · İP-5 — script.js monolitinden ayrıştırıldı (SoC). Talep iş akışı: onay (öz-onay korumasıyla), red, silme,
//        geri çekme / taslak, onay ve red pencereleri, arşiv e-postası, toplu talep seçimi ve silme. Talepler id ile bulunur;
//        yazmalar servis köprülerinden geçer (window.runStockOps, applyItemOps, updateItem, saveData).
// [HOW]: Klasik betik; iki sayfada script.js'ten hemen sonra yüklenir (ES modüllerinden önce tanımlı olmalı: inline onclick,
//        admin-dashboard.js, security.js ve inventory-logic.js bu adları çağırır). Gövde script.js'ten değiştirilmeden taşındı
//        (yalnız IIFE girintisi); taşıma öncesi global olan adlar aynı adlarla window'da kalır, AppModules.RequestActions aynı
//        fonksiyonları taşır (sözleşme: tests/unit/script-bridge-contract.test.mjs).

(function () {
    // [WHY]: Admin talep işlemleri dizi indeksiyle çalışıyordu; snapshot sonrası yanlış talep hedefleniyordu. Tablo yenilenmediği için
    //        ikinci tık ikinci onay + ikinci b3 kaydı yazıyordu; SN sorusunda İptal yine onaylıyordu; red/sil tüm DB'yi yazıyordu (ITSM-05).
    // [HOW]: Talepler id ile bulunur; yalnız bekleyen (taslak olmayan) talep onaylanır/reddedilir; talep başına işlem kilidi;
    //        İptal gerçekten iptaldir; onaylayan ve zaman kaydedilir; yalnız ilgili koleksiyonlar yazılır; tablolar yenilenir.
    const _requestActionsInFlight = new Set();
    const _findRequest = ref => (window.data.requests || []).find(r => String(r.id) === String(ref));
    const _isPendingRequest = r => {
        const d = String(r.durum || '').trim().toUpperCase();
        return ['', 'BEKLEMEDE', 'BEKLİYOR', 'BEKLIYOR', 'PENDING'].includes(d);
    };
    const _refreshRequestTables = () => {
        ['renderRequestsTable', 'renderMyRequestsTable', 'renderAdminRequestTable', 'renderPersonnelInventoryTable']
            .forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
    };
    // [WHY]: B-6 · Talebe bağlı hareket kaydı (b3) zaten varken onay zimmeti tekrar yazmıyor ama stoğu YİNE düşüyordu.
    // [HOW]: Bu tutarsız durumda onay hiç yazmadan durur ve uyarır; yönetici kaydı Envanter Takibi'nde kontrol eder.
    function _stopIfLinkedMovement(req) {
        if (!(window.data.b3 || []).some(b => String(b.requestId) === String(req.id))) return false;
        showAppAlert('Bu talebe bağlı bir hareket kaydı zaten var; onay yapılmadı ve stok düşülmedi. Envanter Takibi\'nde kaydı kontrol edin.', 'warning');
        _refreshRequestTables();
        return true;
    }

    // Talep taslak mı (personel henüz göndermedi / geri çekti) — yönetici listelerinde gösterilmez (B-4).
    function _isDraftRequest(r) { return ['DRAFT', 'TASLAK'].includes(String((r && r.durum) || '').trim().toUpperCase()); }
    window.isDraftRequest = _isDraftRequest;

    // [WHY]: B-2 · Red gerekçesi sorulmuyordu; personel talebinin neden reddedildiğini göremiyordu. B-5 · Red, talebin yerel
    //        kopyasının tamamını yazıyordu (saveData); aynı anda yapılan bir düzenleme ezilebilirdi.
    // [HOW]: Zorunlu gerekçe penceresi (hazır seçenek + açıklama; "Diğer"de açıklama zorunlu; ≤1000 karakter, etiket benzeri metin
    //        yok). Yalnız durum alanları updateItem ile yazılır. Pencere DOM'la kurulur, kayıt verisi textContent ile yazılır.
    const REJECT_REASONS = Object.freeze(['Stokta yok', 'Bütçe uygun değil', 'Mükerrer talep', 'Bilgi eksik', 'Diğer']);
    const REJECT_MAX = 1000;
    window.REQUEST_REJECT_REASONS = REJECT_REASONS;

    // Seçim + açıklama → { reason } | { error }. Saf; testten de çağrılır.
    window.composeRejectReason = function (preset, text, presets = REJECT_REASONS) {
        const p = String(preset || '').trim(), t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!presets.includes(p)) return { error: 'Bir red gerekçesi seçin.' };
        if (p === 'Diğer' && !t) return { error: '"Diğer" seçildiğinde açıklama zorunludur.' };
        const reason = p === 'Diğer' ? t : (t ? `${p} — ${t}` : p);
        if (reason.length > REJECT_MAX) return { error: `Gerekçe en fazla ${REJECT_MAX} karakter olabilir.` };
        if (/<[a-zA-Z\/!?]/.test(reason)) return { error: 'Gerekçede "<" ile başlayan etiket benzeri ifade kullanılamaz.' };
        return { reason };
    };

    // Red gerekçesi penceresi → gerekçe metni | null (Vazgeç / Esc)
    // opts (Faz 5 · iade talebi reddi de kullanır): { title, summary, help, presets, okText }
    window.showRequestRejectModal = function (request, opts = {}) {
        const presets = opts.presets || REJECT_REASONS;
        return new Promise(resolve => {
            const el = (tag, props = {}, children = []) => {
                const n = Object.assign(document.createElement(tag), props);
                children.forEach(c => c && n.append(c));
                return n;
            };
            const lastFocus = document.activeElement;
            const overlay = el('div', { id: 'requestRejectModal', className: 'req-modal-overlay' });
            const titleId = 'requestRejectTitle';
            const dialog = el('div', { className: 'req-modal' });
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', titleId);

            const options = el('div', { className: 'req-reject-options' });
            options.setAttribute('role', 'radiogroup');
            options.setAttribute('aria-label', 'Red gerekçesi');
            presets.forEach((label, i) => {
                const input = el('input', { type: 'radio', name: 'reqRejectPreset', value: label, id: `reqRejectPreset${i}` });
                options.append(el('label', { className: 'req-reject-option', htmlFor: input.id }, [input, el('span', { textContent: label })]));
            });
            const text = el('textarea', { id: 'reqRejectText', rows: 3, maxLength: REJECT_MAX, placeholder: 'Açıklama (isteğe bağlı; "Diğer" seçildiyse zorunlu)' });
            const counter = el('small', { className: 'req-reject-counter', textContent: `0 / ${REJECT_MAX}` });
            const error = el('div', { className: 'req-modal-error', hidden: true });
            error.setAttribute('role', 'alert');
            const cancel = el('button', { type: 'button', className: 'req-modal-btn', textContent: 'Vazgeç' });
            const ok = el('button', { type: 'button', className: 'req-modal-btn danger', id: 'reqRejectOk', textContent: opts.okText || 'Talebi Reddet' });

            dialog.append(
                el('h3', { id: titleId, textContent: opts.title || 'Talebi Reddet' }),
                el('p', { className: 'req-modal-summary', textContent: opts.summary || `${request.personel || '-'} · ${request.ürün || '-'} · ${Number(request.adet) || 1} adet` }),
                el('p', { className: 'req-modal-help', textContent: opts.help || 'Gerekçe, talep sahibine "Taleplerim" ekranında gösterilir.' }),
                options,
                el('label', { className: 'req-modal-label', htmlFor: text.id, textContent: 'Açıklama' }), text, counter,
                error,
                el('div', { className: 'req-modal-actions' }, [cancel, ok]),
            );
            overlay.append(dialog);
            document.body.append(overlay);

            // Esc, odak nerede olursa olsun pencere açıkken çalışır (odak pencereye geçmeden basılsa da).
            const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
            const close = val => {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                if (lastFocus && lastFocus.focus) lastFocus.focus();
                resolve(val);
            };
            document.addEventListener('keydown', onKey, true);
            text.addEventListener('input', () => { counter.textContent = `${text.value.length} / ${REJECT_MAX}`; });
            cancel.addEventListener('click', () => close(null));
            ok.addEventListener('click', () => {
                const preset = (dialog.querySelector('input[name="reqRejectPreset"]:checked') || {}).value;
                const res = window.composeRejectReason(preset, text.value, presets);
                if (res.error) { error.textContent = res.error; error.hidden = false; return; }
                close(res.reason);
            });
            setTimeout(() => dialog.querySelector('input[name="reqRejectPreset"]')?.focus(), 0);
        });
    };

    // [WHY]: Talep serbest metin olduğu için onay stoktan hiç düşmüyordu; onaylanan ürün depoda görünmeye devam ediyor,
    //        iadesi de "stok bağlantısı yok" diye depoya dönmüyordu (ITSM-08, Karar K7-a).
    // [HOW]: Onayda SN ile birlikte B1/B2 stok kalemi seçtirilir; adı talep metniyle birebir eşleşen tek kalem ön seçilir.
    //        "Stoktan düşmeden onayla" ancak açıkça seçilirse geçerlidir. İptal → null; aksi halde { sn, source: {repo, productId} | null }.
    const _normText = s => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const _stockLabel = p => `${p.marka || ''} ${p.ürün || p.name || ''}`.replace(/\s+/g, ' ').trim();
    const _stockQty = p => Number(p.adet ?? p.qty ?? 0) || 0;
    const NO_STOCK = '__none__';

    // [WHY]: Faz 2 (B-1, karar 05.11.2026) — sarf talebi onaylanınca da zimmet yazılıyordu; tükenen sarf kişinin Kişi Envanteri'nde
    //        ve zimmet tutanağında süresiz kalıyordu.
    // [HOW]: Onayın hareket türü: stok kalemi seçildiyse ürün türüne göre (Schema.isDemirbas) — sarf → 'cikis', demirbaş →
    //        'zimmet'. Stok dışı onayda ürün türü bilinmez; yalnız talep türü "Sarf Malzeme İhtiyacı" ve ad bir demirbaş türü
    //        değilse 'cikis', aksi hâlde güvenli taraf 'zimmet'.
    window.requestOutcome = function (request, product) {
        if (product) return window.Schema.isDemirbas(product) ? 'zimmet' : 'cikis';
        const sarfTalebi = String((request && request.talepTuru) || '').trim() === 'Sarf Malzeme İhtiyacı';
        return sarfTalebi && !window.Schema.isDemirbas({ ürün: request.ürün, isDemirbas: request.isDemirbas }) ? 'cikis' : 'zimmet';
    };

    window.showRequestApprovalModal = function (request) {
        return new Promise(resolve => {
            const want = Number(request.adet) || 1;
            const target = _normText(request.ürün);
            const rank = p => {
                const label = _normText(_stockLabel(p)), name = _normText(p.ürün || p.name);
                if (label === target || name === target) return 0;
                if (target && ((label && label.includes(target)) || (name && target.includes(name)))) return 1;
                return 2;
            };
            const candidates = ['b1', 'b2'].flatMap(repo => (window.data[repo] || [])
                .filter(p => _stockQty(p) > 0 && p.durumu !== 'Pasif' && p.status !== 'Pasif' && !window.Schema?.isRowCountLocked?.(p))
                .map(p => ({ repo, p, rank: rank(p), key: `${repo}|${p.id}` })))
                .sort((a, b) => a.rank - b.rank || _stockLabel(a.p).localeCompare(_stockLabel(b.p), 'tr'));
            const exact = candidates.filter(c => c.rank === 0 && _stockQty(c.p) >= want);
            let selected = exact.length === 1 ? exact[0].key : '';

            const overlay = document.createElement('div');
            overlay.id = 'requestApprovalModal';
            overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.75); display:flex; align-items:center; justify-content:center; z-index:11000;';
            // Renkler tema değişkenlerinden (dark-theme.css [data-theme="dark"] ile uyumlu).
            const field = 'width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border,#bdc3c7); background:var(--color-surface-alt,#f8f9fa); color:var(--color-text,#2c3e50); font-size:14px; margin-bottom:12px;';
            overlay.innerHTML = `
          <style>#raSource option:checked { background: linear-gradient(var(--color-primary-light,#dbeafe), var(--color-primary-light,#dbeafe)); color: var(--color-text,#2c3e50); }</style>
          <div style="background:var(--color-surface,#fff); color:var(--color-text,#2c3e50); border:1px solid var(--color-border-light,transparent); padding:24px; border-radius:12px; width:520px; max-width:94vw; font-family:sans-serif;">
            <h3 style="margin:0 0 6px; font-size:1.2rem;">Talebi Onayla</h3>
            <p style="margin:0 0 16px; color:var(--color-text-muted,#7f8c8d); font-size:0.9rem;">${escapeHtml(request.personel || '-')} · <strong>${escapeHtml(request.ürün || '-')}</strong> · ${escapeHtml(want)} adet</p>
            <label style="font-weight:600; font-size:13px;">Stoktan düşülecek kalem</label>
            <input id="raFilter" type="text" placeholder="Ürün, marka veya raf ara..." autocomplete="off" style="${field} margin-bottom:6px;">
            <select id="raSource" size="6" style="${field}"></select>
            <label id="raSnLabel" style="font-weight:600; font-size:13px;">Seri numarası / zimmet bilgisi</label>
            <input id="raSn" type="text" placeholder="Yoksa boş bırakın" autocomplete="off" style="${field}">
            <div id="raDevIds" hidden></div>
            <p id="raOutcome" class="req-outcome-note" role="status"></p>
            <div id="raError" style="display:none; color:var(--color-danger,#e74c3c); font-size:13px; margin-bottom:10px;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button id="raCancel" type="button" style="padding:10px 18px; border:1px solid var(--color-border,#bdc3c7); background:transparent; color:var(--color-text,#2c3e50); border-radius:8px; cursor:pointer;">Vazgeç</button>
              <button id="raOk" type="button" style="padding:10px 18px; border:none; background:var(--color-success-dark,#16a34a); color:#fff; font-weight:700; border-radius:8px; cursor:pointer;">Onayla</button>
            </div>
          </div>`;
            document.body.appendChild(overlay);

            const sel = overlay.querySelector('#raSource');
            const renderOptions = () => {
                const q = _normText(overlay.querySelector('#raFilter').value);
                const visible = candidates.filter(c => !q || _normText(`${_stockLabel(c.p)} ${c.p.raf || ''} ${c.repo}`).includes(q));
                sel.innerHTML = `<option value="${NO_STOCK}">— Stoktan düşmeden onayla (stok dışı / tedarik edilecek)</option>` +
                    visible.map(c => {
                        const qty = _stockQty(c.p);
                        return `<option value="${escapeHtml(c.key)}" ${qty < want ? 'disabled' : ''}>${escapeHtml(c.repo.toUpperCase())} ·${escapeHtml(_stockLabel(c.p))} · Raf ${escapeHtml(c.p.raf || '-')} · Stok: ${escapeHtml(qty)}${qty < want ? ' (yetersiz)' : ''}</option>`;
                    }).join('');
                sel.value = selected;
            };
            // 3.9a: seçilen kalem demirbaşsa (stok dışında: talep edilen ad bir demirbaş türüyse) talep adedi kadar cihaz kimliği
            const devBox = overlay.querySelector('#raDevIds');
            const isDemSelection = () => {
                if (!selected) return false;
                if (selected === NO_STOCK) return window.Schema.isDemirbas({ ürün: request.ürün, isDemirbas: request.isDemirbas });
                const c = candidates.find(x => x.key === selected);
                return !!c && window.Schema.isDemirbas(c.p);
            };
            const outcomeEl = overlay.querySelector('#raOutcome');
            const syncDev = () => {
                const dem = isDemSelection();
                overlay.querySelector('#raSn').style.display = dem ? 'none' : '';
                overlay.querySelector('#raSnLabel').style.display = dem ? 'none' : '';
                // v3.6: seçilen stok kaleminin demirbaş no'su 1. cihaz satırına otomatik ve kilitli gelir
                const fixedFrom = selected && selected !== NO_STOCK ? candidates.find(x => x.key === selected) : null;
                if (dem) window.DeviceIds.render(devBox, want, { fixed: window.DeviceIds.fixedFor(fixedFrom && fixedFrom.p) }); else window.DeviceIds.hide(devBox);
                // Faz 2 (B-1): onayın sonucu önceden söylenir — sarf tüketim çıkışıdır, kişinin envanterine girmez.
                const c = selected && selected !== NO_STOCK ? candidates.find(x => x.key === selected) : null;
                const tip = selected ? window.requestOutcome(request, c ? c.p : null) : null;
                outcomeEl.textContent = !tip ? ''
                    : tip === 'cikis' ? 'Sonuç: tüketim çıkışı (sarf). Stok düşer; ürün kişinin envanterine ve zimmet tutanağına girmez.'
                    : 'Sonuç: zimmet. Personel "Teslim Aldım" dediğinde ürün Kişi Envanteri\'ne geçer.';
                outcomeEl.hidden = !tip;
            };
            renderOptions();
            syncDev();
            overlay.querySelector('#raFilter').addEventListener('input', renderOptions);
            sel.addEventListener('change', () => { selected = sel.value; syncDev(); });

            const close = val => { overlay.remove(); resolve(val); };
            overlay.querySelector('#raCancel').onclick = () => close(null);
            overlay.querySelector('#raOk').onclick = () => {
                if (!selected) {
                    const err = overlay.querySelector('#raError');
                    err.textContent = 'Stoktan düşülecek kalemi seçin veya "Stoktan düşmeden onayla" seçeneğini işaretleyin.';
                    err.style.display = 'block';
                    return;
                }
                let sn = overlay.querySelector('#raSn').value.trim() || '-', ids = null;
                const demirbas = isDemSelection();
                if (demirbas) {
                    const chk = window.AssignmentService.checkDeviceIds({ demirbas: true, qty: want, ids: window.DeviceIds.read(devBox) });
                    if (!chk.ok) {
                        const err = overlay.querySelector('#raError');
                        err.textContent = chk.errors[0];
                        err.style.display = 'block';
                        return;
                    }
                    ids = chk.ids;
                    sn = ids.map(d => d.sn !== '-' ? d.sn : d.envanterNo).join(', ');
                }
                if (selected === NO_STOCK) return close({ sn, ids, demirbas, source: null });
                const [repo, ...rest] = selected.split('|');
                close({ sn, ids, demirbas, source: { repo, productId: rest.join('|') } });
            };
            setTimeout(() => overlay.querySelector(selected ? '#raSn' : '#raFilter')?.focus(), 0);
        });
    };

    window.confirmRequest = async function (requestId) {
        const lockKey = String(requestId);
        if (_requestActionsInFlight.has(lockKey)) return;
        _requestActionsInFlight.add(lockKey);
        try {
            const request = _findRequest(requestId);
            if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
            if (!_isPendingRequest(request)) { showAppAlert('Bu talep zaten işlenmiş veya taslak durumda.', 'warning'); _refreshRequestTables(); return; }

            // [WHY]: Faz 4 · J4 (T6, EBYS-04) — onayın kendi içinde yetki ve self-approval kontrolü yoktu; yalnız index'teki
            //        sarmalayıcı (window üzerinden çağrılırsa) kendi talebini onaylamayı engelliyordu, admin.html'de hiçbir kontrol yoktu.
            // [HOW]: Personelin kendi talebi → engel + 'blocked' (pencere hiç açılmaz). Diğer her durumda yönetici kapısı. Admin'in
            //        kendi talebi → seçimden sonra, yazmadan hemen önce parola yeniden doğrulaması; günlük sonuca göre.
            const selfCtx = rec => ({ kind: 'request', record: rec, refCol: 'requests', type: 'Zimmet/Talep Onayı', item: rec.ürün, qty: Number(rec.adet) || 1 });
            const isSelf = window.Schema.isSelfApproval({ actor: window.getActiveUser() || window.currentUser, record: request, kind: 'request' });
            if (isSelf && !window.isDbAdmin()) { await window.SecurityConfig.guardSelfApproval(selfCtx(request)); return; }
            if (!window.requireDbAdmin('Talep onayı')) return;
            if (_stopIfLinkedMovement(request)) return;   // B-6: pencere hiç açılmaz

            const choice = await window.showRequestApprovalModal(request);
            if (!choice) return;
            const snValue = choice.sn || '-';

            // modal açıkken snapshot gelmiş olabilir: güncel nesne ve durum yeniden kontrol edilir
            const live = _findRequest(requestId);
            if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }
            if (_stopIfLinkedMovement(live)) return;   // B-6 (pencere açıkken bu arada yazılmış olabilir)
            const guard = await window.SecurityConfig.guardSelfApproval(selfCtx(live));
            if (!guard.allowed) return;

            // [WHY] (H3 · 3.4): Stok önce ayrı bir transaction'la düşülüyor, talep ve b3 sonra ayrı ayrı yazılıyordu; ara adımlardan
            //        biri başarısız olunca "stok geri al + talebi geri döndür" telafileri de başarısız olabiliyordu.
            // [HOW]: Stok düşümü + talebin onaylanması + b3 zimmet kaydı TEK transaction (runStockOps); stok kalemi seçilmediyse
            //        talep + b3 tek atomik batch (applyItemOps). Telafi gerekmez: ya hepsi ya hiçbiri.
            const qty = Number(live.adet) || 1;
            const repo = choice.source?.repo;
            const product = repo ? (window.data[repo] || []).find(p => String(p.id) === String(choice.source.productId)) : null;
            if (repo && !product) { showAppAlert('Seçilen stok kalemi bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }

            const approver = window.currentUser?.name || 'Yönetici';
            const now = getTurkiyeSaati();
            const writes = [{ op: 'update', col: 'requests', id: live.id, fields: {
                durum: 'approved', sn: snValue, approvedBy: approver, approvedAt: now,
                ...(product ? { stockRepo: repo, stockProductId: product.id } : {})
            } }];
            // Kanonik b3 zimmet kaydı (3.6): stok kalemi seçildiyse tür/raf/depo üründen kopyalanır; seçilmediyse kaynakDepo
            // 'stok-disi' (tabloda Raf No "Stok dışı" — eskiden "TALEP" basılıyordu).
            // Demirbaş (3.9a): cihaz başına bir b3 zimmet kaydı (adet 1, kendi Seri No / Envanter No'su), hepsi aynı transaction'da.
            // (Talebe bağlı kayıt zaten varsa onay yukarıda durdurulur — B-6.)
            // Faz 2 (B-1): sarf onayı tüketim çıkışıdır (tip 'cikis'); talebe bağlı kalır, Kişi Envanteri'ne / tutanağa girmez.
            const tip = window.requestOutcome(live, product);
            const base = {
                tip, requestId: live.id,
                ...(product ? { product, col: repo } : { urunAciklama: live.ürün, isDemirbas: choice.demirbas === true }),
                not: [live.not, `Onaylayan: ${approver}`].filter(s => s && String(s).trim() && s !== '-').join(' · '),
                alanKisi: live.personel,
                personelId: live.personelId || window.AssignmentService?.resolvePersonelId(live.personel),
                tarih: getTurkiyeTarihi(),
                talepTuru: live.talepTuru, oncelik: live.oncelik, iadeTarihi: live.iadeTarihi,
                onaylayan: approver,
            };
            const units = choice.ids ? choice.ids.map(d => ({ adet: 1, sn: d.sn, envanterNo: d.envanterNo })) : [{ adet: qty, sn: snValue }];
            units.forEach(u => writes.push({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({ ...base, ...u }) }));

            let stockChange = null;
            try {
                if (product) {
                    const res = await window.runStockOps({ stock: [{ col: repo, id: product.id, delta: -qty }], writes },
                        { forbiddenMessage: 'Talep onayı (stok düşümü) yalnızca sistem yöneticisi tarafından yapılabilir.' });
                    stockChange = res.stock[0];
                } else {
                    await window.applyItemOps(writes);
                }
            } catch (e) {
                await window.SecurityConfig.logSelfApproval(guard, false);
                showAppAlert(`Onay kaydedilemedi; hiçbir değişiklik yapılmadı. ${e.message || ''}`, 'error');
                _refreshRequestTables();
                return;
            }
            await window.SecurityConfig.logSelfApproval(guard, true);
            const stockText = stockChange ? ` ${repo.toUpperCase()} stok: ${stockChange.before} → ${stockChange.after}.` : ' Stoktan düşülmedi.';
            const tipText = tip === 'cikis' ? ' Tüketim çıkışı olarak kaydedildi.' : ' Zimmet kaydı oluşturuldu.';
            showAppAlert(`${live.personel} isimli personelin talebi ONAYLANDI.${stockText}${tipText}`, "success");
            _refreshRequestTables();
        } finally {
            _requestActionsInFlight.delete(lockKey);
        }
    };

    window.rejectRequest = async function (requestId) {
        const lockKey = String(requestId);
        if (_requestActionsInFlight.has(lockKey)) return;
        _requestActionsInFlight.add(lockKey);
        try {
            const request = _findRequest(requestId);
            if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
            if (!_isPendingRequest(request)) { showAppAlert('Bu talep zaten işlenmiş veya taslak durumda.', 'warning'); _refreshRequestTables(); return; }
            if (!window.requireDbAdmin('Talep reddi')) return;
            const reason = await window.showRequestRejectModal(request);
            if (reason == null) return;
            const live = _findRequest(requestId);
            if (!live || !_isPendingRequest(live)) { showAppAlert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); _refreshRequestTables(); return; }
            const fields = { durum: 'rejected', rejectedBy: window.currentUser?.name || 'Yönetici', rejectedAt: getTurkiyeSaati(), redGerekcesi: reason };
            if (!(await window.writeOk(window.updateItem('requests', live.id, fields)))) { showAppAlert('Red kaydedilemedi.', 'error'); return; }
            _refreshRequestTables();
            showAppAlert(`${live.personel} talebi reddedildi. Gerekçe personele iletildi.`, "error");
        } finally {
            _requestActionsInFlight.delete(lockKey);
        }
    };

    window.deleteRequest = async function (requestId) {
        if (!window.requireDbAdmin('Talep silme')) return;   // Faz 4 · J1 (M1): Rules v2'de talep silme yalnız admin
        const request = _findRequest(requestId);
        if (!request) { showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
        const onay = await showCustomConfirm("Kaydı Sil", "Bu talep kaydını tamamen silmek istediğinize emin misiniz? Bu işlem geri alınamaz.");
        if (onay !== true) return;
        const remaining = (window.data.requests || []).filter(r => String(r.id) !== String(requestId));
        if (!(await window.writeOk(window.saveData('requests', remaining)))) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
        _refreshRequestTables();
        showAppAlert("Talep kaydı kalıcı olarak silindi.", "info");
    };

    // [WHY]: Personelin talep işlemleri dizi indeksiyle çalışıyordu; snapshot sonrası başka bir talebi hedefleyebiliyordu (DATA-06)
    //        ve koleksiyonun tamamını yazıyordu. Durum kontrolü yoktu (onaylanmış talep "geri çekilip" taslağa dönebiliyordu).
    // [HOW]: Talep id ile bulunur; yalnız kendi talebi ve uygun durumdaysa; yalnız değişen alanlar yazılır (updateItem).
    const _myRequest = id => {
        const req = (window.data.requests || []).find(r => String(r.id) === String(id));
        if (!req || !window.AssignmentService.isMyRequest(req, window.getActiveUser())) {
            showAppAlert('Talep bulunamadı; liste güncellenmiş olabilir.', 'error');
            return null;
        }
        return req;
    };

    window.withdrawInventoryRequest = async function (id) {
        const req = _myRequest(id);
        if (!req) return;
        if (!_isPendingRequest(req)) { showAppAlert('Yalnız onay bekleyen bir talep geri çekilebilir.', 'warning'); renderMyRequestsTable(); return; }
        const onay = await showCustomConfirm("Talebi Geri Çek", `${req.ürün} talebinizi geri çekmek (taslağa almak) istediğinize emin misiniz?`);
        if (onay === true) {
            if (!(await window.writeOk(window.updateItem('requests', req.id, { durum: 'draft' })))) { showAppAlert('Talep geri çekilemedi.', 'error'); return; }
            if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
            showAppAlert("Talebiniz geri çekildi ve TASLAK moduna alındı.", "info");
        }
    };

    window.editPersonnelInventoryRequest = function (id) {
        const req = _myRequest(id);
        if (!req) return;
        window.editingReqIndex = null;
        window.editingReqId = req.id;
        const nameInput = document.getElementById('reqProdName');
        const qtyInput = document.getElementById('reqQty');
        const noteInput = document.getElementById('reqNote');
        if (nameInput) nameInput.value = req.ürün || "";
        if (qtyInput) qtyInput.value = req.adet || 1;
        if (noteInput) noteInput.value = req.not || "";

        const reqType = document.getElementById('reqType');
        const reqPriority = document.getElementById('reqPriority');
        const reqReturnDate = document.getElementById('reqReturnDate');
        if (reqType) reqType.value = req.talepTuru || 'Kalıcı Zimmet';
        if (reqPriority) reqPriority.value = req.oncelik || 'Orta';
        if (reqReturnDate) reqReturnDate.value = req.iadeTarihi || '';

        window.openRequestModal(true);
        if (typeof window.onReqTypeChange === 'function') window.onReqTypeChange();
    };

    window.sendDraftInventoryRequest = async function (id) {
        const req = _myRequest(id);
        if (!req) return;
        const d = String(req.durum || '').trim().toUpperCase();
        if (d !== 'DRAFT' && d !== 'TASLAK') { showAppAlert('Bu talep taslak değil.', 'warning'); renderMyRequestsTable(); return; }
        if (!(await window.writeOk(window.updateItem('requests', req.id, { durum: 'Beklemede', tarih: getTurkiyeTarihi() })))) { showAppAlert('Talep gönderilemedi.', 'error'); return; }
        if (typeof renderMyRequestsTable === 'function') renderMyRequestsTable();
        showAppAlert("Talebiniz başarıyla onaya gönderildi.", "success");
    };

    function sendArchiveEmail(requestData) {
        const serviceID = 'service_jp86sgy';
        const templateID = 'template_wj4lqrv';
        const templateParams = {
            to_name: "Yönetici",
            from_name: "Envanter Sistemi",
            personel_adi: requestData.personel,
            person: requestData.personel,
            urun: requestData.ürün,
            product: requestData.ürün,
            adet: requestData.adet || 1,
            qty: requestData.adet || 1,
            tarih: getTurkiyeTarihi()
        };
        if (typeof emailjs !== 'undefined') {
            emailjs.send(serviceID, templateID, templateParams).then(() => {
                console.log('Mail başarıyla arka planda gönderildi!');
            }, (err) => {
                console.error('Mail gönderme hatası:', err);
            });
        }
    }

    function toggleAllRequests(source) {
        const checkboxes = document.querySelectorAll('.req-checkbox');
        checkboxes.forEach(cb => cb.checked = source.checked);
    }

    async function deleteSelectedRequests() {
        if (!window.requireDbAdmin('Toplu talep silme')) return;   // Faz 4 · J1 (M1)
        const checkboxes = document.querySelectorAll('.req-checkbox:checked');
        if (checkboxes.length === 0) { showAppAlert("Lütfen silinecek kayıtları seçiniz.", "error"); return; }
        const idsToDelete = new Set(Array.from(checkboxes).map(cb => String(cb.value)));
        const onay = await showCustomConfirm("Toplu Silme", `${idsToDelete.size} adet kaydı kalıcı olarak silmek istediğinize emin misiniz?`);
        if (onay) {
            const remaining = (window.data.requests || []).filter(r => !idsToDelete.has(String(r.id)));
            // Kullanıcı onaylı toplu silme: saveData v2 toplu silme kilidi bilinçli olarak açılır (Faz 3.1).
            if (!(await window.writeOk(window.saveData('requests', remaining, { allowBulkDelete: true })))) { showAppAlert('Silme kaydedilemedi.', 'error'); return; }
            renderRequestsTable();
            showAppAlert(`${idsToDelete.size} kayıt başarıyla silindi.`, "success");
            const headerCheck = document.querySelector('.select-all-header input');
            if (headerCheck) headerCheck.checked = false;
        }
    }

    // Taşıma öncesi script.js'te global olan bildirimler aynı adlarla window'da kalır (ör. talep tabloları → _isDraftRequest,
    // inventory-logic.js → sendArchiveEmail, index.html → deleteSelectedRequests).
    Object.assign(window, { _stopIfLinkedMovement, _isDraftRequest, sendArchiveEmail, toggleAllRequests, deleteSelectedRequests });

    window.AppModules = window.AppModules || {};
    window.AppModules.RequestActions = Object.freeze({
        confirmRequest: window.confirmRequest, rejectRequest: window.rejectRequest, deleteRequest: window.deleteRequest,
        withdrawInventoryRequest: window.withdrawInventoryRequest, editPersonnelInventoryRequest: window.editPersonnelInventoryRequest,
        sendDraftInventoryRequest: window.sendDraftInventoryRequest, showRequestApprovalModal: window.showRequestApprovalModal,
        showRequestRejectModal: window.showRequestRejectModal, composeRejectReason: window.composeRejectReason,
        requestOutcome: window.requestOutcome, isDraftRequest: window.isDraftRequest, sendArchiveEmail, toggleAllRequests,
        deleteSelectedRequests
    });
})();
