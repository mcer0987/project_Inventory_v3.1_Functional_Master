// [WHY]: feat/envanter-talep-iade · Faz 5 — personel üzerindeki demirbaşı iade etmek için talep gönderir; yönetici talebi iki
//        yerde (index "Gelen Talepler", admin "Talep ve Süreçler") görür, cihazı teslim alıp almadığına, cihaz durumuna ve stoğa
//        eklenip eklenmeyeceğine karar vererek onaylar ya da gerekçeyle reddeder. Karara bağlanan iadeler listede kalır;
//        görüntülenebilir, iki adımlı onayla silinebilir. "Zimmetten Düş" de aynı karar penceresini ve kapanış kodunu kullanır.
// [HOW]: Klasik betik, iki sayfada. Kayıt sözleşmesi ReturnRequestSchema, kapanış planı AssignmentService.planClose; yazmalar
//        applyItemOps / runStockOps (tek işlem: stok + zimmet kapanışı + talep kararı). Kurallar: firestore.rules returnRequests.
//        Tüm pencereler ve tablolar createElement + textContent ile kurulur (kayıt verisi HTML olarak basılmaz).
(function () {
    const RS = () => window.ReturnRequestSchema;
    const A = () => window.AssignmentService;
    const alert = (m, t) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(m, t); };
    const isAdmin = () => typeof window.isDbAdmin === 'function' && window.isDbAdmin();
    const now = () => (typeof window.getTurkiyeSaati === 'function' ? window.getTurkiyeSaati() : new Date().toLocaleString('tr-TR'));
    const today = () => (typeof window.getTurkiyeTarihi === 'function' ? window.getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR'));
    const list = () => (window.data && window.data.returnRequests) || [];
    const find = id => list().find(r => r && String(r.id) === String(id)) || null;
    const STATE = Object.freeze({
        Beklemede: { cls: 'pending', text: '⏳ Onay Bekliyor' },
        approved: { cls: 'approved', text: '✅ İade Alındı' },
        rejected: { cls: 'rejected', text: '❌ Reddedildi' },
        withdrawn: { cls: 'withdrawn', text: '↩️ Geri Çekildi' },
    });
    const RETURN_REJECT_REASONS = Object.freeze(['Cihaz görev için hâlâ gerekli', 'Yedek cihaz bekleniyor', 'Bilgi eksik', 'Mükerrer talep', 'Diğer']);

    function el(tag, props = {}, children = []) {
        const n = document.createElement(tag);
        Object.entries(props).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (k === 'text') n.textContent = String(v);
            else if (k === 'class') n.className = v;
            else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') n.setAttribute(k, String(v));
            else n[k] = v;
        });
        [].concat(children).forEach(c => c && n.append(c));
        return n;
    }
    const stateBadge = durum => { const s = STATE[durum] || STATE.Beklemede; return el('span', { class: `ret-state ret-state-${s.cls}`, text: s.text }); };
    const deviceText = r => [r.sn && r.sn !== '-' ? `SN: ${r.sn}` : '', r.envanterNo && r.envanterNo !== '-' ? `Env. No: ${r.envanterNo}` : ''].filter(Boolean).join(' · ') || '-';

    // ─── Ortak pencere kabuğu (Esc, odak, arka plan) ──────────────────────────────────────────────────────────
    function modal({ id, title, help, body = [], actions = [], wide = false }) {
        const lastFocus = document.activeElement;
        const titleId = `${id}Title`;
        const dialog = el('div', { class: `req-modal${wide ? ' req-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
        dialog.append(el('h3', { id: titleId, text: title }));
        if (help) dialog.append(el('p', { class: 'req-modal-help', text: help }));
        body.forEach(b => b && dialog.append(b));
        const error = el('div', { class: 'req-modal-error', role: 'alert', hidden: true });
        dialog.append(error, el('div', { class: 'req-modal-actions' }, actions));
        const overlay = el('div', { id, class: 'req-modal-overlay' }, [dialog]);
        document.body.append(overlay);
        let done = null;
        const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
        const close = val => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (lastFocus && lastFocus.focus) lastFocus.focus();
            if (done) done(val);
        };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { const f = dialog.querySelector('input, select, textarea, button'); if (f) f.focus(); }, 0);
        return {
            dialog, close,
            showError: msg => { error.textContent = msg; error.hidden = false; },
            result: new Promise(r => { done = r; }),
        };
    }
    const btn = (text, cls, onClick, extra = {}) => { const b = el('button', { type: 'button', class: `req-modal-btn ${cls || ''}`.trim(), text, ...extra }); b.addEventListener('click', onClick); return b; };
    const field = (label, control, hint) => el('div', { class: 'ret-field' }, [el('label', { class: 'req-modal-label', htmlFor: control.id, text: label }), control, hint ? el('small', { class: 'ret-hint', text: hint }) : null]);
    const select = (id, options, value) => {
        const s = el('select', { id, class: 'ret-select' });
        options.forEach(o => s.append(el('option', { value: o.value ?? o, text: o.text ?? o })));
        if (value != null) s.value = value;
        return s;
    };

    // ─── Personel: iade talebi gönder / yeniden gönder ─────────────────────────────────────────────────────────
    async function openStaffForm(zimmetId) {
        const user = window.getActiveUser?.();
        const assignment = A().getAssignments().find(a => String(a.id) === String(zimmetId) && A().matchesPerson(a, user));
        if (!assignment || !RS().isReturnable(assignment)) { alert('Bu kalem için iade talebi gönderilemez (yalnız üzerinizdeki demirbaş zimmetleri).', 'warning'); return; }
        const existing = find(RS().docId(assignment.id));
        if (existing && existing.durum === 'Beklemede') { alert('Bu cihaz için bekleyen bir iade talebiniz zaten var.', 'info'); return; }
        const gerekce = select('retGerekce', [{ value: '', text: 'Seçin…' }, ...RS().GEREKCELER], existing ? existing.gerekce : '');
        const durum = select('retBeyan', [{ value: '', text: 'Seçin…' }, ...RS().CIHAZ_DURUMLARI], existing ? existing.bildirilenDurum : '');
        const aciklama = el('textarea', { id: 'retAciklama', rows: 3, maxLength: 1000, placeholder: 'Açıklama (isteğe bağlı; "Diğer" seçildiyse zorunlu)', value: existing ? existing.aciklama || '' : '' });
        const m = modal({
            id: 'returnRequestModal', title: existing ? 'İade Talebini Yeniden Gönder' : 'İade Talebi Gönder',
            help: 'Talebiniz yöneticiye gider. Yönetici cihazı teslim aldığında cihaz üzerinizden düşer ve iade tutanağı oluşur.',
            body: [
                el('p', { class: 'req-modal-summary', text: `${assignment.urun} · ${deviceText(assignment)}` }),
                existing && existing.redGerekcesi ? el('p', { class: 'req-reject-reason', text: `Önceki red gerekçesi: ${existing.redGerekcesi}` }) : null,
                field('İade gerekçesi', gerekce), field('Cihazın durumu', durum), field('Açıklama', aciklama),
            ],
            actions: [btn('Vazgeç', '', () => m.close(null)), btn(existing ? 'Yeniden Gönder' : 'Talebi Gönder', 'primary', async () => {
                const { record, errors } = RS().build({ assignment, user, uid: window.userAuth?.uid, gerekce: gerekce.value, aciklama: aciklama.value,
                    bildirilenDurum: durum.value, tarih: now(), ts: Date.now() });
                if (errors.length) { m.showError(errors[0]); return; }
                const ok = existing
                    ? await window.writeOk(window.updateItem('returnRequests', existing.id, { durum: 'Beklemede', gerekce: record.gerekce, aciklama: record.aciklama,
                        bildirilenDurum: record.bildirilenDurum, tarih: record.tarih, ts: record.ts }))
                    : await window.writeOk(window.applyItemOps([{ op: 'set', col: 'returnRequests', item: record }]));
                if (!ok) { m.showError('Talep kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.'); return; }
                m.close(true);
            }, { id: 'retSubmit' })],
        });
        if (await m.result) { alert('İade talebiniz yöneticiye gönderildi.', 'success'); refresh(); }
    }

    async function withdraw(id) {
        const r = find(id);
        if (!r || r.durum !== 'Beklemede') { alert('Yalnız onay bekleyen bir iade talebi geri çekilebilir.', 'warning'); return; }
        const ok = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('İade Talebini Geri Çek', `"${r.urun}" için gönderdiğiniz iade talebi geri çekilecek. Emin misiniz?`) : true;
        if (ok !== true) return;
        if (!(await window.writeOk(window.updateItem('returnRequests', r.id, { durum: 'withdrawn', tarih: now(), ts: Date.now() })))) { alert('Talep geri çekilemedi.', 'error'); return; }
        alert('İade talebiniz geri çekildi.', 'info');
        refresh();
    }

    // ─── Yönetici: karar penceresi (iade onayı ve "Zimmetten Düş" ortak) ───────────────────────────────────────
    // → { teslimAlindi, depo, stogaEkle, adminCihazDurumu, adminNotu, kapanisAciklamasi } | null
    function decisionModal({ assignment, request }) {
        const beyanToAdmin = { 'Çalışır': 'Sağlam', 'Arızalı': 'Arızalı', 'Hasarlı': 'Hasarlı', 'Eksik parça': 'Eksik parça' };
        const startState = request ? (beyanToAdmin[request.bildirilenDurum] || 'Sağlam') : 'Sağlam';
        const radio = (value, text, checked) => {
            const input = el('input', { type: 'radio', name: 'retReceived', value, id: `retReceived_${value}`, checked });
            return el('label', { class: 'req-reject-option', htmlFor: input.id }, [input, el('span', { text })]);
        };
        const received = el('div', { class: 'req-reject-options', role: 'radiogroup', 'aria-label': 'Cihaz teslim alındı mı' },
            [radio('yes', 'Evet, cihazı teslim aldım', true), radio('no', 'Hayır, teslim almadan kapat', false)]);
        const cihaz = select('retAdminState', RS().ADMIN_CIHAZ_DURUMLARI, startState);
        const depo = select('retDepo', [{ value: 'b1', text: 'B1 Depo' }, { value: 'b2', text: 'B2 Depo' }], ['b1', 'b2'].includes(assignment.depo) ? assignment.depo : 'b1');
        const stok = el('input', { type: 'checkbox', id: 'retAddStock', checked: startState === 'Sağlam' });
        const stokRow = el('label', { class: 'ret-check', htmlFor: 'retAddStock' }, [stok, el('span', { text: 'Stoğa ekle (ürün kalemine +1)' })]);
        const stokHint = el('small', { class: 'ret-hint', text: '' });
        const kapanis = el('textarea', { id: 'retCloseNote', rows: 2, maxLength: 1000, placeholder: 'Neden teslim alınmadan kapatılıyor? (ör. kayıp, personel ayrıldı)' });
        const not = el('textarea', { id: 'retAdminNote', rows: 2, maxLength: 1000, placeholder: 'İade tutanağına girecek not (isteğe bağlı)' });
        const yesBox = el('div', { class: 'ret-branch' }, [field('Cihaz durumu (sizin kararınız)', cihaz), field('Hangi depoya alınsın?', depo), stokRow, stokHint]);
        const noBox = el('div', { class: 'ret-branch', hidden: true }, [field('Kapanış açıklaması (zorunlu)', kapanis)]);
        const sync = () => {
            const yes = received.querySelector('input:checked').value === 'yes';
            yesBox.hidden = !yes; noBox.hidden = yes;
            stokHint.textContent = cihaz.value === 'Sağlam' ? '' : 'Cihaz sağlam değil: stoğa eklemek sizin kararınız. Eklemezseniz cihaz depoda kayıt dışı durur; servis/hurda sürecini ayrıca başlatabilirsiniz.';
        };
        received.addEventListener('change', sync);
        cihaz.addEventListener('change', () => { stok.checked = cihaz.value === 'Sağlam'; sync(); });
        const summary = [
            el('p', { class: 'req-modal-summary', text: `${assignment.personel || request?.personel || '-'} · ${assignment.urun || request?.urun || '-'} · ${deviceText(assignment)}` }),
            request ? el('p', { class: 'ret-request-info', text: `Personelin gerekçesi: ${request.gerekce}${request.aciklama ? ` — ${request.aciklama}` : ''} · Beyan edilen durum: ${request.bildirilenDurum}` }) : null,
        ];
        let m;
        m = modal({
            id: 'returnDecisionModal', wide: true,
            title: request ? 'İade Talebini Onayla' : 'Zimmetten Düş',
            help: 'Cihazı teslim aldıysanız depoyu ve cihazın durumunu seçin; stoğa eklenip eklenmeyeceğine siz karar verirsiniz. Onayla, cihaz kişinin üzerinden düşer.',
            body: [...summary, el('p', { class: 'req-modal-label', text: 'Cihazı teslim aldınız mı?' }), received, yesBox, noBox, field('Yönetici notu', not)],
            actions: [btn('Vazgeç', '', () => m.close(null)), btn(request ? 'İadeyi Onayla' : 'Zimmetten Düş', 'success', () => {
                const yes = received.querySelector('input:checked').value === 'yes';
                const tag = /<[a-zA-Z/!?]/;
                if (!yes && !kapanis.value.trim()) { m.showError('Teslim alınmadan kapatırken açıklama zorunludur.'); return; }
                if (tag.test(kapanis.value) || tag.test(not.value)) { m.showError('Metinlerde "<" ile başlayan etiket benzeri ifade kullanılamaz.'); return; }
                const d = { teslimAlindi: yes, depo: yes ? depo.value : null, stogaEkle: yes && stok.checked,
                    adminCihazDurumu: yes ? cihaz.value : startState, adminNotu: not.value.trim(), kapanisAciklamasi: yes ? '' : kapanis.value.trim() };
                const plan = A().planClose(assignment.id, { teslimAlindi: d.teslimAlindi, depo: d.depo, stogaEkle: d.stogaEkle, tarih: today() });
                if (!plan.ok) { m.showError(plan.error); return; }
                m.close({ ...d, plan });
            }, { id: 'retDecisionOk' })],
        });
        sync();
        return m.result;
    }

    async function commitClose(decision, extraWrites) {
        const { plan } = decision;
        const writes = [...plan.writes, ...extraWrites];
        if (plan.stock.length) {
            const res = await window.runStockOps({ stock: plan.stock, writes }, { forbiddenMessage: 'İade işlemi yalnızca sistem yöneticisi tarafından yapılabilir.' });
            return res.stock[0];
        }
        await window.applyItemOps(writes);
        return null;
    }

    async function approve(id) {
        if (!window.requireDbAdmin('İade talebi onayı')) return;
        const r = find(id);
        if (!r || r.durum !== 'Beklemede') { alert('Bu iade talebi zaten karara bağlanmış.', 'warning'); refresh(); return; }
        const assignment = A().getAssignments().find(a => String(a.id) === String(r.zimmetId));
        if (!assignment || assignment.iadeEdildi) { alert('Bu zimmet başka bir yoldan zaten kapatılmış. Talebi gerekçesiyle reddedebilirsiniz.', 'warning'); return; }
        const ctx = { kind: 'request', record: r, refCol: 'returnRequests', type: 'İade Talebi Onayı', item: r.urun, qty: 1 };
        const decision = await decisionModal({ assignment, request: r });
        if (!decision) return;
        const guard = window.SecurityConfig ? await window.SecurityConfig.guardSelfApproval(ctx) : { allowed: true };
        if (!guard.allowed) return;
        const live = find(id);
        if (!live || live.durum !== 'Beklemede') { alert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); refresh(); return; }
        const fields = { durum: 'approved', teslimAlindi: decision.teslimAlindi, iadeDepo: decision.depo, stogaEklendi: decision.stogaEkle,
            adminCihazDurumu: decision.adminCihazDurumu, adminNotu: decision.adminNotu, kapanisAciklamasi: decision.kapanisAciklamasi,
            onaylayan: window.currentUser?.name || 'Yönetici', onayTarihi: now() };
        let stockChange;
        try { stockChange = await commitClose(decision, [{ op: 'update', col: 'returnRequests', id: live.id, fields }]); }
        catch (e) {
            if (window.SecurityConfig) await window.SecurityConfig.logSelfApproval(guard, false);
            alert(`İade onaylanamadı; hiçbir değişiklik yapılmadı. ${e.message || ''}`, 'error'); return;
        }
        if (window.SecurityConfig) await window.SecurityConfig.logSelfApproval(guard, true);
        alert(`İade onaylandı; cihaz ${live.personel} üzerinden düştü.${stockChange ? ` ${String(decision.depo).toUpperCase()} stok: ${stockChange.before} → ${stockChange.after}.` : decision.teslimAlindi ? ' Stoğa eklenmedi.' : ' Teslim alınmadan kapatıldı.'}`, 'success');
        refresh();
    }

    async function reject(id) {
        if (!window.requireDbAdmin('İade talebi reddi')) return;
        const r = find(id);
        if (!r || r.durum !== 'Beklemede') { alert('Bu iade talebi zaten karara bağlanmış.', 'warning'); refresh(); return; }
        const reason = await window.showRequestRejectModal(r, {
            title: 'İade Talebini Reddet', summary: `${r.personel} · ${r.urun} · ${deviceText(r)}`, presets: RETURN_REJECT_REASONS,
            help: 'Gerekçe personelin "İade Taleplerim" bölümünde görünür; personel talebi düzeltip yeniden gönderebilir.', okText: 'İadeyi Reddet',
        });
        if (reason == null) return;
        const live = find(id);
        if (!live || live.durum !== 'Beklemede') { alert('Talep bu arada değişti; işlem iptal edildi.', 'warning'); refresh(); return; }
        if (!(await window.writeOk(window.updateItem('returnRequests', live.id, { durum: 'rejected', redGerekcesi: reason, reddeden: window.currentUser?.name || 'Yönetici', redTarihi: now() })))) {
            alert('Red kaydedilemedi.', 'error'); return;
        }
        alert('İade talebi reddedildi; gerekçe personele iletildi.', 'info');
        refresh();
    }

    // "Zimmetten Düş" (Zimmet ekranı): bekleyen iade talebi varsa onu onaylar; yoksa talepsiz kapanış (aynı pencere ve kod).
    async function closeAssignment(zimmetId) {
        if (!window.requireDbAdmin('Zimmet iadesi')) return;
        const pending = list().find(r => r && String(r.zimmetId) === String(zimmetId) && r.durum === 'Beklemede');
        if (pending) { await approve(pending.id); return; }
        const assignment = A().getAssignments().find(a => String(a.id) === String(zimmetId));
        if (!assignment || assignment.iadeEdildi) { alert('Bu zimmet zaten iade edilmiş.', 'info'); return; }
        const decision = await decisionModal({ assignment, request: null });
        if (!decision) return;
        let stockChange;
        try { stockChange = await commitClose(decision, []); }
        catch (e) { alert(`İade kaydedilemedi; hiçbir değişiklik yapılmadı. ${e.message || ''}`, 'error'); return; }
        alert(`Zimmet düşüldü.${stockChange ? ` ${String(decision.depo).toUpperCase()} stok: ${stockChange.before} → ${stockChange.after}.` : decision.teslimAlindi ? ' Stoğa eklenmedi.' : ' Teslim alınmadan kapatıldı.'}`, 'success');
        refresh();
    }

    function view(id) {
        const r = find(id);
        if (!r) return;
        const rows = [
            ['Personel', r.personel], ['Ürün', r.urun], ['Cihaz', deviceText(r)], ['Talep tarihi', r.tarih],
            ['Gerekçe', r.gerekce + (r.aciklama ? ` — ${r.aciklama}` : '')], ['Beyan edilen durum', r.bildirilenDurum],
            ['Durum', (STATE[r.durum] || STATE.Beklemede).text],
            ...(r.durum === 'approved' ? [['Teslim alındı', r.teslimAlindi ? 'Evet' : 'Hayır'], ['Depo', r.iadeDepo ? String(r.iadeDepo).toUpperCase() : '-'],
                ['Stoğa eklendi', r.stogaEklendi ? 'Evet' : 'Hayır'], ['Cihaz durumu (yönetici)', r.adminCihazDurumu],
                ['Kapanış açıklaması', r.kapanisAciklamasi], ['Yönetici notu', r.adminNotu], ['Onaylayan', `${r.onaylayan || '-'} · ${r.onayTarihi || ''}`]] : []),
            ...(r.durum === 'rejected' ? [['Red gerekçesi', r.redGerekcesi], ['Reddeden', `${r.reddeden || '-'} · ${r.redTarihi || ''}`]] : []),
        ].filter(([, v]) => v != null && String(v).trim() !== '');
        const dl = el('dl', { class: 'ret-detail' });
        rows.forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: v })));
        const m = modal({ id: 'returnViewModal', title: 'İade Talebi', body: [dl], actions: [btn('Kapat', '', () => m.close(null))] });
    }

    // Silme — iki adım: onay + kaydı tanıtan ifadeyi yazma (Env. No → SN → "SİL")
    async function remove(id) {
        if (!window.requireDbAdmin('İade kaydı silme')) return;
        const r = find(id);
        if (!r) return;
        if (r.durum === 'Beklemede') { alert('Bekleyen iade talebi silinemez; önce onaylayın ya da reddedin.', 'warning'); return; }
        const first = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('İade Kaydını Sil', `"${r.urun}" iade kaydı listeden kalıcı olarak silinecek. Cihazın zimmet kapanışı ve stok hareketi geri alınmaz. Devam edilsin mi?`) : true;
        if (first !== true) return;
        const expected = r.envanterNo && r.envanterNo !== '-' ? r.envanterNo : (r.sn && r.sn !== '-' ? r.sn : 'SİL');
        const input = el('input', { type: 'text', id: 'retDeleteConfirm', autocomplete: 'off' });
        const m = modal({
            id: 'returnDeleteModal', title: 'Silmeyi Onaylayın',
            help: `Kalıcı silme için aşağıya "${expected}" yazın.`,
            body: [field('Onay ifadesi', input)],
            actions: [btn('Vazgeç', '', () => m.close(null)), btn('Kalıcı Olarak Sil', 'danger', () => {
                if (input.value.trim() !== expected) { m.showError(`Yazdığınız ifade "${expected}" ile aynı değil.`); return; }
                m.close(true);
            }, { id: 'retDeleteOk' })],
        });
        if (!(await m.result)) return;
        if (!(await window.writeOk(window.applyItemOps([{ op: 'delete', col: 'returnRequests', id: r.id }])))) { alert('Silme kaydedilemedi.', 'error'); return; }
        alert('İade kaydı silindi.', 'info');
        refresh();
    }

    // ─── Tablolar ───────────────────────────────────────────────────────────────────────────────────────────────
    const EMPTY_TEXT = 'Personelin üzerindeki demirbaşı iade etmek için gönderdiği talepler burada listelenir. Onayladığınızda cihaz kişinin üzerinden düşer; teslim aldıysanız seçtiğiniz depoya eklenir.';
    const ADMIN_TABLES = [{ body: 'returnRequestsBody', filter: 'returnRequestsFilter' }, { body: 'adminReturnRequestsBody', filter: 'adminReturnRequestsFilter' }];
    const actionBtn = (text, cls, fn, label) => { const b = el('button', { type: 'button', class: `ret-action ${cls}`, text, 'aria-label': label || text }); b.addEventListener('click', fn); return b; };

    function renderAdminTables() {
        const all = [...list()].sort((a, b) => (a.durum === 'Beklemede' ? 0 : 1) - (b.durum === 'Beklemede' ? 0 : 1) || (b.ts || 0) - (a.ts || 0));
        ADMIN_TABLES.forEach(({ body, filter }) => {
            const tbody = document.getElementById(body);
            if (!tbody) return;
            const f = document.getElementById(filter);
            if (f && !f.dataset.bound) { f.dataset.bound = '1'; f.addEventListener('change', renderAdminTables); }
            const mode = f ? f.value : 'pending';
            const rows = all.filter(r => mode === 'all' || (mode === 'pending' ? r.durum === 'Beklemede' : r.durum !== 'Beklemede'));
            tbody.replaceChildren();
            if (!rows.length) {
                const text = all.length === 0 ? EMPTY_TEXT : (mode === 'pending' ? 'Onay bekleyen iade talebi yok.' : 'Bu süzgece uyan iade kaydı yok.');
                tbody.append(el('tr', {}, [el('td', { colSpan: 7, class: 'ret-empty', text })]));
                return;
            }
            rows.forEach(r => {
                const actions = el('div', { class: 'ret-actions' });
                if (r.durum === 'Beklemede') {
                    actions.append(actionBtn('Onayla', 'success', () => approve(r.id), `${r.urun} iadesini onayla`), actionBtn('Reddet', 'danger', () => reject(r.id), `${r.urun} iadesini reddet`));
                } else {
                    actions.append(actionBtn('Görüntüle', '', () => view(r.id)));
                    if (r.durum === 'approved' && typeof window.generateReturnPDF === 'function') actions.append(actionBtn('İade Tutanağı', 'primary', () => window.generateReturnPDF(r.id)));
                    actions.append(actionBtn('Sil', 'danger', () => remove(r.id), `${r.urun} iade kaydını sil`));
                }
                const decision = r.durum === 'approved'
                    ? `${r.adminCihazDurumu || '-'}${r.teslimAlindi ? ` · ${String(r.iadeDepo || '').toUpperCase()}${r.stogaEklendi ? ' · stoğa eklendi' : ' · stoğa eklenmedi'}` : ' · teslim alınmadı'}`
                    : r.durum === 'rejected' ? `Red: ${r.redGerekcesi || '-'}` : '';
                tbody.append(el('tr', { 'data-id': r.id }, [
                    el('td', { text: r.tarih || '-' }), el('td', { text: r.personel || '-' }),
                    el('td', {}, [el('strong', { text: r.urun || '-' }), el('div', { class: 'ret-sub', text: deviceText(r) })]),
                    el('td', { text: r.gerekce + (r.aciklama ? ` — ${r.aciklama}` : '') }),
                    el('td', {}, [el('div', { text: `Beyan: ${r.bildirilenDurum || '-'}` }), decision ? el('div', { class: 'ret-sub', text: decision }) : null]),
                    el('td', {}, [stateBadge(r.durum)]), el('td', {}, [actions]),
                ]));
            });
        });
    }

    function renderMine() {
        const tbody = document.getElementById('myReturnRequestsBody');
        if (!tbody) return;
        const user = window.getActiveUser?.();
        const uid = window.userAuth?.uid;
        const mine = list().filter(r => r && (r.personelUid === uid || (user && String(r.personelId) === String(user.id)))).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        tbody.replaceChildren();
        if (!mine.length) {
            tbody.append(el('tr', {}, [el('td', { colSpan: 5, class: 'ret-empty', text: 'Henüz iade talebiniz yok. Üzerinizdeki bir demirbaşı iade etmek için yukarıdaki tabloda "İade Talebi"ne basın.' })]));
            return;
        }
        mine.forEach(r => {
            const actions = el('div', { class: 'ret-actions' });
            if (r.durum === 'Beklemede') actions.append(actionBtn('Geri Çek', '', () => withdraw(r.id), `${r.urun} iade talebini geri çek`));
            if (r.durum === 'rejected' || r.durum === 'withdrawn') actions.append(actionBtn('Yeniden Gönder', 'primary', () => openStaffForm(r.zimmetId), `${r.urun} iade talebini yeniden gönder`));
            if (r.durum === 'approved' && typeof window.generateReturnPDF === 'function') actions.append(actionBtn('İade Tutanağı', 'primary', () => window.generateReturnPDF(r.id)));
            tbody.append(el('tr', {}, [
                el('td', { text: r.tarih || '-' }),
                el('td', {}, [el('strong', { text: r.urun || '-' }), el('div', { class: 'ret-sub', text: deviceText(r) })]),
                el('td', { text: r.gerekce + (r.aciklama ? ` — ${r.aciklama}` : '') }),
                el('td', {}, [stateBadge(r.durum), r.durum === 'rejected' && r.redGerekcesi ? el('div', { class: 'req-reject-reason', text: `Gerekçe: ${r.redGerekcesi}` }) : null]),
                el('td', {}, [actions]),
            ]));
        });
    }

    // Kişi Envanteri satırının işlem hücresi (script.js renderPersonnelInventoryTable çağırır)
    function staffActionCell(assignment) {
        const td = el('td');
        if (!RS().isReturnable(assignment)) return td;
        const r = find(RS().docId(assignment.id));
        if (r && r.durum === 'Beklemede') { td.append(el('span', { class: 'ret-sub', text: 'Yönetici onayı bekleniyor' })); return td; }
        td.append(actionBtn('İade Talebi', 'primary', () => openStaffForm(assignment.id), `${assignment.urun} için iade talebi gönder`));
        return td;
    }

    function refresh() {
        renderAdminTables();
        renderMine();
        ['renderPersonnelInventoryTable'].forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
        if (window.inventoryManagementModule && document.getElementById('invTableBody')) window.inventoryManagementModule.renderTable();
        if (window.RequestBadge) window.RequestBadge.update();
    }

    window.addEventListener('onInventoryDataUpdated', e => {
        const col = e && e.detail && e.detail.collection;
        if (col === 'returnRequests') refresh();
        else if (col === 'b3' || col === 'personel') { renderAdminTables(); renderMine(); }
    });
    document.addEventListener('DOMContentLoaded', () => { renderAdminTables(); renderMine(); });

    window.ReturnRequests = Object.freeze({
        openStaffForm, withdraw, approve, reject, view, remove, closeAssignment, renderAdminTables, renderMine, staffActionCell,
        decisionModal, RETURN_REJECT_REASONS, EMPTY_TEXT,
    });
})();
