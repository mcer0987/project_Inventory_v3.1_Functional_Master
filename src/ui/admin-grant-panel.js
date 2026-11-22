/**
 * ui/admin-grant-panel.js — İP-7 · VIP › "👑 Yönetici Yetkileri" penceresi.
 * Klasik script (admin.html, admin-system-control.js'ten sonra) → window.AppModules.AdminGrantPanel.open(btn).
 * Veri yalnız window.AppModules.AdminGrantService üzerinden (SDK yok); karar mantığı window.AppModules.AdminGrants'ta.
 *
 * [WHY]: Ek yönetici yetkisi panelden, iz bırakarak ve yalnız ana yönetici tarafından verilip geri alınmalı (K1). Ek yönetici
 *        listeyi görebilmeli ama değiştirememeli.
 * [HOW]: Açılışta servis sunucudan taze okur (listAdminGrants). Kip: ana yönetici → 'owner' (geri al + yetki ver), ek yönetici →
 *        'readonly' (düğme yok, üstte not). Her değişiklik gerekçe + parola doğrulaması ister; sonuç mesajı panelde kalır ve liste
 *        yeniden okunur. DOM API ve textContent (innerHTML yok). Test kancaları: #adminGrantPanel[data-mode|data-state], data-role.
 */
(function () {
    'use strict';

    const DESCRIPTION = 'Personel hesaplarına yönetici yetkisi verir ya da geri alır. Yetkiyi yalnız ana yönetici hesabı değiştirebilir; verilen yöneticiler başkasına yetki veremez. Her değişiklik Güvenlik Raporu\'na kaydedilir.';
    const HELP = [
        ['Kimler yönetici yapılabilir?', 'Aktif personel kaydı olan ve kurumsal kimliğiyle (PRI) giriş hesabı açılmış kişiler. Uygun olmayanlar listede soluk görünür ve nedeni yazar (ör. personel pasif, giriş hesabı yok, eşleme uyuşmuyor).'],
        ['Ortam başına ayrıdır', 'Canlı ortamda verilen yetki demo ortamında geçerli değildir (ve tersi). Her ortamda ayrıca verilir.'],
        ['Hemen geçerlidir', 'Yetki verildiğinde ya da geri alındığında kişinin bir sonraki işleminden itibaren geçerli olur; açık oturumda paneli hemen açılır ya da kilitlenir.'],
        ['Askıya alma', 'Personel pasifleştirilirse, PRI / hesap bağı bozulursa ya da Personel Erişim Kilidi kapatılırsa yetki kendiliğinden askıya alınır; listede "Askıda" ve nedeni görünür. Koşul düzelince yeniden geçerli olur.'],
        ['Erişim Kilidi uyarısı', 'Bir ek yönetici Personel Erişim Kilidi\'ni kapatırsa kendisi dahil bütün ek yöneticiler askıya alınır; kilidi kapanış kanıtıyla yalnız ana yönetici yeniden açabilir.'],
        ['Geri alma', 'Yetkisi geri alınan kişi personel olarak çalışmaya devam eder; yönetici işlemleri ve yönetici paneli kapanır. Geçmiş, Güvenlik Raporu\'nda kalır.'],
        ['Şifre doğrulaması', 'Her değişiklikte ana yönetici parolası yeniden sorulur. Parola doğrulaması 10 dakikadan eskiyse değişiklik reddedilir.'],
    ];
    const READONLY_NOTE = 'Yetkileri yalnız ana yönetici değiştirebilir. Bu listeyi yalnız görüntüleyebilirsiniz.';

    let _openPanel = null;

    const el = (tag, css, text) => {
        const n = document.createElement(tag);
        if (css) n.style.cssText = css;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    };
    const role = (node, r) => { node.dataset.role = r; return node; };
    const btn = (text, css, r) => { const b = role(el('button', css, text), r); b.type = 'button'; return b; };
    const fmtTs = ts => {
        try {
            const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : (ts ? new Date(ts) : null);
            return d && !isNaN(d) ? d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '-';
        } catch (e) { return '-'; }
    };
    const alertMsg = (msg, type) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type); };
    const CELL = 'padding:6px 8px; border-bottom:1px solid var(--color-border, #e2e8f0); vertical-align:top;';
    const BTN_GHOST = 'padding:8px 14px; background:none; border:1px solid var(--color-border, #cbd5e1); border-radius:8px; cursor:pointer; color:inherit;';
    const BTN_DANGER = 'padding:6px 12px; background:#b45309; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;';
    const BTN_PRIMARY = 'padding:9px 18px; background:#7c3aed; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;';

    // [WHY]: Açıklama görünür, uzun anlatım yardım alanında olmalı (AGENTS.md).
    // [HOW]: admin-main.js'teki belge düzeyi [data-panel-help] dinleyicisi aria-controls'teki alanı açar / kapatır.
    function buildHeader(panel, data) {
        const head = el('div', 'display:flex; align-items:flex-start; gap:12px; margin-bottom:8px;');
        const title = el('h4', 'margin:0; font-weight:800; flex:1;', '👑 Yönetici Yetkileri');
        title.id = 'adminGrantTitle';
        const close = btn('Kapat', BTN_GHOST, 'close');
        head.append(title, close);
        const desc = role(el('p', 'margin:0 0 6px; font-size:13px; color:var(--color-text-muted, #475569);', DESCRIPTION), 'description');
        const env = role(el('div', 'font-size:12px; color:var(--color-text-muted, #64748b);', `Ortam: ${data.root}`), 'env');
        const help = el('button', null);
        help.type = 'button';
        help.className = 'panel-help-trigger';
        help.setAttribute('data-panel-help', '');
        help.setAttribute('aria-expanded', 'false');
        help.setAttribute('aria-controls', 'adminGrantHelp');
        help.dataset.role = 'help-toggle';
        const icon = el('i'); icon.className = 'fas fa-info-circle'; icon.setAttribute('aria-hidden', 'true');
        help.append(icon, document.createTextNode(' Nasıl çalışır?'));
        const helpBox = el('div');
        helpBox.id = 'adminGrantHelp';
        helpBox.className = 'panel-help';
        helpBox.hidden = true;
        helpBox.dataset.role = 'help';
        const ul = el('ul');
        HELP.forEach(([k, v]) => { const li = el('li'); li.append(el('strong', null, k + ': '), document.createTextNode(v)); ul.appendChild(li); });
        helpBox.appendChild(ul);
        panel.append(head, desc, env, help, helpBox);
        if (data.canManage !== true) {
            panel.appendChild(role(el('div', 'margin-top:10px; padding:8px 12px; border-radius:8px; border:1px solid #94a3b8; font-size:13px; font-weight:600;', '🔒 ' + READONLY_NOTE), 'readonly-note'));
        }
        if (data.gateOpen === false) {
            panel.appendChild(role(el('div', 'margin-top:10px; padding:8px 12px; border-radius:8px; border:1px solid #dc2626; color:#b91c1c; font-size:13px;',
                '⚠ Personel Erişim Kilidi kapalı: bütün ek yöneticilerin yetkisi askıda. Kilit açılınca yeniden geçerli olur.'), 'gate-warning'));
        }
        return close;
    }

    function stateCell(row) {
        const td = el('td', CELL);
        const ok = row.state.state === 'active';
        const badge = role(el('span', `font-weight:700; color:${ok ? '#16a34a' : '#b45309'};`, ok ? 'Aktif' : 'Askıda'), 'state');
        badge.dataset.state = row.state.state;
        td.appendChild(badge);
        if (!ok) td.appendChild(el('div', 'font-size:11px; color:var(--color-text-muted, #64748b);', row.state.reasons.join(', ')));
        return td;
    }

    // [WHY]: Bölüm 1 — kim yönetici, yetki geçerli mi, kim / ne zaman / neden verdi tek bakışta görünmeli.
    // [HOW]: Ana yönetici satırı sabit; ek yöneticiler AdminGrants.adminRows sırasıyla. Owner kipinde satır başına "Yetkiyi geri al".
    function buildAdmins(data, mode, onRevoke) {
        const sec = role(el('section', 'margin-top:16px;'), 'admins');
        sec.appendChild(el('h5', 'margin:0 0 8px; font-weight:800;', '1 · Mevcut yöneticiler'));
        // Dar ekranda tablo sıkışmasın: kap yatay kayar, sayfa taşmaz.
        const scroller = role(el('div', 'overflow-x:auto; -webkit-overflow-scrolling:touch;'), 'admins-scroll');
        const table = el('table', 'width:100%; min-width:640px; border-collapse:collapse; font-size:13px;');
        const head = el('tr');
        const cols = ['Ad', 'PRI', 'Durum', 'Veren', 'Tarih', 'Gerekçe'];
        if (mode === 'owner') cols.push('İşlem');
        cols.forEach(h => head.appendChild(el('th', CELL + ' text-align:left;', h)));
        table.appendChild(head);
        const primary = role(el('tr'), 'primary-row');
        primary.append(el('td', CELL + ' font-weight:700;', 'Ana yönetici'), el('td', CELL, 'admin@medipol.local'),
            el('td', CELL + ' font-weight:700;', 'Ana yönetici (değiştirilemez)'), el('td', CELL, '-'), el('td', CELL, '-'), el('td', CELL, '-'));
        if (mode === 'owner') primary.appendChild(el('td', CELL, '-'));
        table.appendChild(primary);
        data.rows.forEach(row => {
            const tr = role(el('tr'), 'admin-row');
            tr.dataset.uid = row.uid;
            tr.append(el('td', CELL + ' font-weight:600;', row.name), el('td', CELL, row.pri || '-'), stateCell(row),
                el('td', CELL, 'Ana yönetici'), el('td', CELL + ' white-space:nowrap;', fmtTs(row.mapping.adminChangedAt)),
                el('td', CELL, row.mapping.adminReason || '-'));
            if (mode === 'owner') {
                const td = el('td', CELL);
                const b = btn('Yetkiyi geri al', BTN_DANGER, 'revoke');
                b.dataset.uid = row.uid;
                b.addEventListener('click', () => onRevoke(row));
                td.appendChild(b);
                tr.appendChild(td);
            }
            table.appendChild(tr);
        });
        scroller.appendChild(table);
        sec.appendChild(scroller);
        if (!data.rows.length) sec.appendChild(role(el('div', 'margin-top:6px; font-size:13px; color:var(--color-text-muted, #64748b);', 'Ek yönetici yok.'), 'empty'));
        return sec;
    }

    // Gerekçe alanı + sayaç; geçerlilik AdminGrants.validateReason ile (kuralla aynı sınırlar).
    function reasonField(placeholder) {
        const AG = window.AppModules.AdminGrants;
        const wrap = el('div', 'margin-top:8px;');
        const label = el('label', 'display:block; font-size:12px; font-weight:700; margin-bottom:4px;', `Gerekçe (${AG.REASON_MIN}–${AG.REASON_MAX} karakter, zorunlu)`);
        const area = role(el('textarea', 'width:100%; box-sizing:border-box; min-height:60px; padding:8px 10px; border:1px solid var(--color-border, #cbd5e1); border-radius:8px; font:inherit; font-size:13px;'), 'reason');
        area.maxLength = AG.REASON_MAX;
        area.placeholder = placeholder;
        const fieldId = 'agr' + Math.random().toString(36).slice(2, 8);
        area.id = fieldId; label.htmlFor = fieldId;
        const hint = role(el('div', 'font-size:11px; color:var(--color-text-muted, #64748b); margin-top:2px;'), 'reason-hint');
        const check = () => {
            const r = AG.validateReason(area.value);
            hint.textContent = r.ok ? `${r.value.length}/${AG.REASON_MAX}` : r.error;
            hint.style.color = r.ok ? '' : '#b45309';
            return r;
        };
        area.addEventListener('input', check);
        check();
        wrap.append(label, area, hint);
        return { wrap, area, check };
    }

    // [WHY]: Bölüm 2 — aday seçimi uygunluk nedeniyle birlikte görünmeli; uygun olmayan kişi seçilemez.
    // [HOW]: AdminGrants.candidates (uygunlar önce) + matchesQuery araması; seçim → gerekçe → "Yönetici yap" → servis.
    function buildGrant(data, onGrant) {
        const AG = window.AppModules.AdminGrants;
        const sec = role(el('section', 'margin-top:18px;'), 'grant');
        sec.appendChild(el('h5', 'margin:0 0 8px; font-weight:800;', '2 · Yetki ver'));
        const search = role(el('input', 'width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--color-border, #cbd5e1); border-radius:8px; font-size:13px;'), 'search');
        search.type = 'search';
        search.placeholder = 'Ad ya da PRI ile ara…';
        search.setAttribute('aria-label', 'Personel ara');
        const list = role(el('div', 'margin-top:8px; max-height:220px; overflow:auto; border:1px solid var(--color-border, #e2e8f0); border-radius:8px;'), 'candidates');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Yetki verilebilecek personel');
        const selected = role(el('div', 'margin-top:8px; font-size:13px; font-weight:700;', 'Seçilen: —'), 'selected');
        const { wrap, area, check } = reasonField('Ör. Bilgi işlem sorumlusu olarak atandı');
        const submit = btn('Yönetici yap', BTN_PRIMARY + ' margin-top:10px;', 'grant-submit');
        let chosen = null;
        const sync = () => {
            const ok = !!(chosen && chosen.eligibility.ok && check().ok);
            submit.disabled = !ok;
            submit.style.opacity = ok ? '1' : '0.5';
        };
        const render = () => {
            list.replaceChildren();
            const rows = data.candidates.filter(c => AG.matchesQuery(c, search.value));
            rows.forEach(c => {
                const item = role(el('button', 'display:block; width:100%; text-align:left; padding:8px 10px; border:none; border-bottom:1px solid var(--color-border, #e2e8f0); background:none; cursor:pointer; color:inherit;'), 'candidate');
                item.type = 'button';
                item.dataset.id = String(c.person.id);
                item.dataset.eligibility = c.eligibility.code;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(!!(chosen && chosen.person.id === c.person.id)));
                item.disabled = !c.eligibility.ok;
                if (!c.eligibility.ok) { item.style.opacity = '0.55'; item.style.cursor = 'not-allowed'; }
                if (chosen && chosen.person.id === c.person.id) item.style.background = 'rgba(124,58,237,0.12)';
                item.append(el('span', 'font-weight:700;', c.name), el('span', 'margin-left:6px; color:var(--color-text-muted, #64748b);', c.pri ? `(${c.pri})` : ''),
                    el('div', `font-size:11px; color:${c.eligibility.ok ? '#16a34a' : '#b45309'};`, c.eligibility.text));
                item.addEventListener('click', () => {
                    if (!c.eligibility.ok) return;
                    chosen = c;
                    selected.textContent = `Seçilen: ${c.name}${c.pri ? ' (' + c.pri + ')' : ''}`;
                    render(); sync();
                });
                list.appendChild(item);
            });
            if (!rows.length) list.appendChild(el('div', 'padding:10px; font-size:13px; color:var(--color-text-muted, #64748b);', 'Eşleşen personel yok.'));
        };
        search.addEventListener('input', render);
        area.addEventListener('input', sync);
        submit.addEventListener('click', () => { if (!submit.disabled) onGrant(chosen, area.value); });
        render(); sync();
        sec.append(search, list, selected, wrap, submit);
        return sec;
    }

    // [WHY]: Geri alma da gerekçe ister; yanlış satırın geri alınmaması için hedef ad açıkça yazılır.
    // [HOW]: Bölüm 1'in altında tek bir satır içi form; "Geri al" → servis (parola doğrulaması serviste).
    function buildRevokeForm(row, onConfirm, onCancel) {
        const box = role(el('div', 'margin-top:10px; padding:10px 12px; border:1px solid #b45309; border-radius:10px;'), 'revoke-form');
        box.dataset.uid = row.uid;
        box.appendChild(el('div', 'font-size:13px; font-weight:700;', `Yetkisi geri alınacak: ${row.name}${row.pri ? ' (' + row.pri + ')' : ''}`));
        const { wrap, area, check } = reasonField('Ör. Görev değişikliği');
        const actions = el('div', 'display:flex; gap:8px; justify-content:flex-end; margin-top:8px;');
        const cancel = btn('Vazgeç', BTN_GHOST, 'revoke-cancel');
        const ok = btn('Geri al', BTN_DANGER, 'revoke-confirm');
        const sync = () => { const v = check().ok; ok.disabled = !v; ok.style.opacity = v ? '1' : '0.5'; };
        area.addEventListener('input', sync);
        cancel.addEventListener('click', onCancel);
        ok.addEventListener('click', () => { if (!ok.disabled) onConfirm(area.value); });
        actions.append(cancel, ok);
        box.append(wrap, actions);
        sync();
        return box;
    }

    /**
     * Pencereyi açar. Dönüş: { overlay, refresh, close } ya da null (yetki yok / zaten açık).
     */
    // [WHY]: Tek giriş noktası; VIP düğmesi (admin-system-control.js vipAdminGrants) ve testler bunu çağırır.
    // [HOW]: Servis okunur → kip belirlenir → bölümler kurulur. İşlem sonrası liste yeniden okunur, sonuç mesajı üstte kalır.
    async function open(trigger) {
        if (_openPanel) return null;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) { alertMsg('Bu pencere için yönetici oturumu gerekir.', 'error'); return null; }
        const svc = window.AppModules && window.AppModules.AdminGrantService;
        if (!svc || !window.AppModules.AdminGrants) { alertMsg('Yönetici yetkisi modülü yüklenemedi; sayfayı yenileyin.', 'error'); return null; }
        if (trigger) trigger.disabled = true;
        const overlay = el('div', 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:10650; display:flex; align-items:center; justify-content:center;');
        overlay.id = 'adminGrantPanel';
        overlay.dataset.state = 'loading';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'adminGrantTitle');
        const panel = el('div', 'background:var(--color-surface,#fff); color:var(--color-text,#1e293b); border-radius:16px; width:860px; max-width:95vw; max-height:88vh; overflow:auto; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.45);');
        overlay.appendChild(panel);
        panel.appendChild(el('div', 'font-size:13px;', 'Yönetici yetkileri sunucudan okunuyor…'));
        document.body.appendChild(overlay);
        let lastResult = null;

        const dispose = () => {
            if (window.DialogStack) window.DialogStack.close(panel);
            overlay.remove();
            _openPanel = null;
            if (trigger) trigger.disabled = false;
        };
        const report = (ok, text) => { lastResult = { ok, text }; };
        const showResult = () => {
            if (!lastResult) return;
            const r = role(el('div', 'margin-top:12px; padding:10px 12px; border-radius:10px; font-size:13px; border:1px solid ' + (lastResult.ok ? '#16a34a' : '#dc2626') + ';', lastResult.text), 'result');
            r.dataset.status = lastResult.ok ? 'done' : 'refused';
            r.setAttribute('role', 'status');
            panel.appendChild(r);
        };

        async function run(work, okText) {
            overlay.dataset.state = 'running';
            panel.querySelectorAll('button[data-role="revoke"], button[data-role="grant-submit"], button[data-role="revoke-confirm"]').forEach(b => { b.disabled = true; });
            try {
                const res = await work();
                report(true, okText(res));
            } catch (e) {
                report(false, '✗ ' + ((e && e.message) || 'bilinmeyen hata'));
            }
            await refresh();
        }

        async function refresh() {
            let data;
            try { data = await svc.listAdminGrants(); }
            catch (e) {
                overlay.dataset.state = 'error';
                panel.replaceChildren();
                const close = buildHeader(panel, { root: (window.AppEnv && window.AppEnv.COLLECTION_ROOT) || '-', canManage: true });
                close.addEventListener('click', dispose);
                panel.appendChild(role(el('div', 'margin-top:12px; color:#b91c1c; font-size:13px;', 'Yönetici yetkileri okunamadı: ' + ((e && e.message) || 'bilinmeyen hata')), 'error'));
                return null;
            }
            const mode = data.canManage ? 'owner' : 'readonly';
            overlay.dataset.mode = mode;
            panel.replaceChildren();
            const close = buildHeader(panel, data);
            close.addEventListener('click', dispose);
            showResult();
            let revokeBox = null;
            const admins = buildAdmins(data, mode, row => {
                if (revokeBox) revokeBox.remove();
                revokeBox = buildRevokeForm(row,
                    reason => run(() => svc.revokeAdmin(row.uid, reason), res => `✓ ${res.name} kişisinin yönetici yetkisi geri alındı. Güvenlik Raporu'na kaydedildi.`),
                    () => { revokeBox.remove(); revokeBox = null; });
                admins.appendChild(revokeBox);
                const area = revokeBox.querySelector('textarea');
                if (area) area.focus();
            });
            panel.appendChild(admins);
            if (mode === 'owner') {
                panel.appendChild(buildGrant(data, (c, reason) => run(() => svc.grantAdmin(c.person.id, reason),
                    res => `✓ ${res.name} yönetici yapıldı. Yetki kişinin bir sonraki işleminden itibaren geçerli; Güvenlik Raporu'na kaydedildi.`)));
            }
            overlay.dataset.state = 'ready';
            return data;
        }

        _openPanel = { overlay, refresh, close: dispose };
        await refresh();
        if (window.DialogStack) window.DialogStack.open(panel, { onEscape: dispose });
        return _openPanel;
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.AdminGrantPanel = Object.freeze({ open, isOpen: () => !!_openPanel, close: () => { if (_openPanel) _openPanel.close(); } });
})();
