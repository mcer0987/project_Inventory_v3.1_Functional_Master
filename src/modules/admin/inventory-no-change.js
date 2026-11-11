/**
 * modules/admin/inventory-no-change.js — v3.6 · Operasyon Merkezi › Envanter No Değişimi kartı (admin.html #invNoChangeCard).
 *
 * [WHY]: Ürün formunda demirbaş plakası kilitli; dolu numaranın tek değişim yolu bu araçtır. Yönetici numarayı arar, sistem
 *        cihazın bulunduğu yeri (depo, servis, zimmet, hurda) gösterir, "Bu mu?" onayından sonra tüm bilgileri içeren pencerede
 *        yeni numara sorulur.
 * [HOW]: Arama ve plan src/utils/inventory-no-rename.js'te (saf); yazma window.runInventoryNoRename (firebase-handler, tek
 *        transaction + denetim kaydı). Bu dosya yalnız çizer: DOM API ile (textContent), Firestore SDK'sı çağırmaz (Sütun 4).
 *        Pencere WMS diyalog stillerini (shelf-matrix.css) ve DialogStack'i kullanır; onay pencere içinde iki adımlıdır
 *        (ortak onay kutusu bu pencerenin arkasında kalırdı).
 */
const R = () => window.AppModules && window.AppModules.InventoryNoRename;
const KIND_ICON = { depo: '📦', servis: '🛠️', zimmet: '📌', hurda: '♻️' };
const COL_LABEL = { b1: 'B1 depo satırı', b2: 'B2 depo satırı', b3: 'Hareket kaydı (b3)', assignments: 'Zimmet kaydı', serviceRecords: 'Servis kaydı' };

let lastMatches = [];

function el(tag, { className, text, attrs } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    children.filter(Boolean).forEach(c => node.append(c));
    return node;
}
const notify = (message, type) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(message, type); };

function renderResults(query) {
    const box = document.getElementById('invNoResults');
    if (!box) return;
    box.replaceChildren();
    const M = R();
    if (!M) { box.append(el('p', { className: 'inv-no-empty', text: 'Envanter No modülü yüklenmemiş; arama yapılamadı.' })); return; }
    const found = M.findMatches(window.data, query);
    lastMatches = found.matches;
    if (!found.key) return;
    if (!found.matches.length) {
        box.append(el('p', { className: 'inv-no-empty', text: `"${query.trim()}" depoda, serviste, zimmette ya da hurdada bulunamadı.` }));
    }
    found.matches.forEach((m, index) => {
        const product = m.product || {};
        const meta = [product.brand, product.type, product.sn && `SN ${product.sn}`].filter(Boolean).join(' · ');
        const pick = el('button', { className: 'btn btn-sm btn-primary inv-no-pick', text: 'Bu mu?', attrs: { type: 'button', 'data-pick': String(index) } });
        if (!m.editable) pick.disabled = true;
        box.append(el('article', { className: `inv-no-match inv-no-kind-${m.kind}` }, [
            el('div', { className: 'inv-no-match-head' }, [
                el('span', { className: 'inv-no-kind', text: `${KIND_ICON[m.kind] || ''} ${m.label}` }),
                pick,
            ]),
            el('strong', { className: 'inv-no-product', text: product.name || 'Adsız ürün' }),
            meta ? el('small', { className: 'inv-no-meta', text: meta }) : null,
            m.editable ? null : el('small', { className: 'inv-no-warning', text: m.reason || 'Bu kayıt için numara değiştirilemez.' }),
        ]));
    });
    if (found.matches.length > 1) {
        box.append(el('p', { className: 'inv-no-warning', text: 'Aynı numara birden fazla yerde görünüyor; değiştireceğiniz kaydı seçin ve mükerrer kaydı ayrıca kontrol edin.' }));
    }
    found.pendingReturns.forEach(r => box.append(el('p', { className: 'inv-no-warning', text: `${r.label}: bu talep eski numarayla kalır.` })));
    if (found.history.length) {
        const list = el('ul', {}, found.history.slice(0, 12).map(h => el('li', { text: h.label })));
        box.append(el('details', { className: 'inv-no-history' }, [
            el('summary', { text: `Geçmiş kayıtlar (${found.history.length}) — değişmez` }), list,
        ]));
    }
}

function detailRows(m) {
    const p = m.product || {};
    const rec = m.record || {};
    const rows = [
        ['Ürün', p.name], ['Marka', p.brand], ['Tür', p.type], ['Konum', m.label],
        ['Depo / Raf / Sütun', m.stock ? `${m.stock.col.toUpperCase()} · ${p.shelf || '—'} · ${p.column || '—'}` : ''],
        ['Adet (depo satırı)', m.stock ? String(p.qty) : ''], ['Durum', p.status || rec.durum], ['Seri No', p.sn],
        ['Açıklama', p.note], ['Kişi', rec.alanKisi || rec.personel], ['Servis hedefi', rec.hedef], ['Tarih', rec.tarih || rec.sevkTarihi],
    ];
    return rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-');
}

function openRenameDialog(m) {
    const M = R();
    const oldNo = (m.record && (M.key(m.record.envanterNo) ? m.record.envanterNo : (m.record.originalData || {}).envanterNo)) || '';
    const oldKey = M.key(oldNo);

    const overlay = el('div', { className: 'shelf-dialog-overlay inv-no-overlay' });
    const section = el('section', { className: 'shelf-dialog inv-no-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'invNoDialogTitle' } });
    const close = el('button', { className: 'shelf-dialog-close', text: '×', attrs: { type: 'button', 'aria-label': 'Pencereyi kapat' } });
    section.append(
        el('header', { className: 'shelf-dialog-header' }, [el('small', { className: 'shelf-dialog-eyebrow', text: 'ENVANTER NO DEĞİŞİMİ' }), close]),
        el('h2', { text: (m.product && m.product.name) || 'Ürün', attrs: { id: 'invNoDialogTitle' } }),
    );
    const plate = el('div', { className: 'asset-plate inv-no-plate', attrs: { 'data-state': 'locked' } }, [
        el('span', { className: 'asset-plate-eyebrow', text: 'Mevcut Demirbaş No' }),
        el('span', { className: 'asset-plate-input', text: String(oldNo) }),
    ]);
    const dl = el('dl', { className: 'inv-no-details' });
    detailRows(m).forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: String(v) })));
    const targets = el('ul', { className: 'inv-no-targets' }, m.targets.map(t => el('li', { text: `${COL_LABEL[t.col] || t.col} · ${t.id}` })));

    const form = el('form', { className: 'shelf-dialog-form', attrs: { autocomplete: 'off' } });
    const fields = el('div', { className: 'shelf-dialog-fields' });
    const input = el('input', { attrs: { id: 'invNoNewInput', type: 'text', maxlength: String(M.MAX_LEN), spellcheck: 'false', required: 'required' } });
    const reason = el('input', { attrs: { id: 'invNoReason', type: 'text', maxlength: '200', placeholder: 'ör. etiket yenilendi' } });
    const status = el('p', { className: 'inv-no-check', attrs: { role: 'status' } });
    fields.append(
        el('label', { className: 'shelf-dialog-label', text: 'Yeni Envanter No', attrs: { for: 'invNoNewInput' } }), input,
        status,
        el('label', { className: 'shelf-dialog-label', text: 'Gerekçe (isteğe bağlı)', attrs: { for: 'invNoReason' } }), reason,
    );
    const error = el('p', { className: 'shelf-dialog-error', attrs: { role: 'alert' } });
    error.hidden = true;
    const cancel = el('button', { className: 'shelf-dialog-cancel', text: 'Vazgeç', attrs: { type: 'button' } });
    const submit = el('button', { className: 'shelf-dialog-submit', text: 'Devam', attrs: { type: 'submit' } });
    form.append(fields, error, el('footer', { className: 'shelf-dialog-actions' }, [cancel, submit]));
    section.append(plate, dl, el('p', { className: 'shelf-dialog-description', text: 'Değişecek kayıtlar (geçmiş kayıtlar ve basılmış tutanaklar eski numarayla kalır):' }), targets, form);
    overlay.append(section);
    document.body.append(overlay);

    const finish = () => {
        if (window.DialogStack) window.DialogStack.close(section);
        overlay.remove();
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
    close.addEventListener('click', finish);
    cancel.addEventListener('click', finish);
    if (window.DialogStack) window.DialogStack.open(section, { onEscape: finish, initialFocus: input });
    else input.focus();

    let confirming = false;
    let timer = null;
    const resetConfirm = () => { confirming = false; submit.textContent = 'Devam'; };
    const liveCheck = () => {
        const value = input.value;
        if (!value.trim()) { status.textContent = ''; status.dataset.state = ''; return null; }
        const r = M.checkNewNumber(window.data, value, oldKey);
        status.dataset.state = r.ok ? (r.warnings.length ? 'warn' : 'ok') : 'error';
        status.textContent = r.ok ? (r.warnings[0] || 'Numara kullanılabilir görünüyor; kayıt öncesinde sunucuda yeniden denetlenir.') : r.blockers[0];
        return r;
    };
    input.addEventListener('input', () => { resetConfirm(); clearTimeout(timer); timer = setTimeout(liveCheck, 250); });

    let busy = false;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        error.hidden = true;
        const check = liveCheck();
        if (!check || !check.ok) { error.textContent = (check && check.blockers[0]) || 'Yeni numarayı yazın.'; error.hidden = false; input.focus(); return; }
        if (!confirming) {
            confirming = true;
            submit.textContent = `Onayla: ${String(oldNo).trim()} → ${input.value.trim()}`;
            submit.focus();
            return;
        }
        busy = true;
        submit.disabled = true;
        try {
            const res = await window.runInventoryNoRename(m, input.value, { reason: reason.value });
            finish();
            notify(`Envanter No ${res.fromValue} → ${res.toValue} olarak değiştirildi (${res.written.length} kayıt). Değişim güvenlik raporuna yazıldı.`, 'success');
            const search = document.getElementById('invNoSearchInput');
            if (search) { search.value = res.toValue; renderResults(res.toValue); }
        } catch (e) {
            error.textContent = (e && e.message) || 'Numara değiştirilemedi.';
            error.hidden = false;
            resetConfirm();
        } finally {
            busy = false;
            submit.disabled = false;
        }
    });
}

function bind() {
    const form = document.getElementById('invNoSearchForm');
    const box = document.getElementById('invNoResults');
    if (!form || !box || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Envanter No değişimi')) return;
        renderResults(document.getElementById('invNoSearchInput').value);
    });
    box.addEventListener('click', event => {
        const pick = event.target.closest('[data-pick]');
        if (!pick) return;
        const m = lastMatches[Number(pick.dataset.pick)];
        if (m && m.editable) openRenameDialog(m);
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
else bind();
