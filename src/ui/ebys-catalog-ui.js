// [WHY]: v3.4 EBYS H6b · Yönetim Paneli › Tanımlar: Kurum Künyesi, Dosya Planı ve Üst Yazı Şablonları panelleri.
// [HOW]: Yalnız çizer. Okuma/yazma src/services/ebys-catalog-service.js (Sütun 4); DOM API + textContent (XSS yok).
//        Silme yoktur: plan ve şablon pasife alınır; şablonu kaydetmek yeni sürüm açar. Panel açıklaması ve yardım metni
//        admin.html'deki statik başlıktadır (AGENTS.md).
import '../services/ebys-catalog-service.js';

const api = () => window.AppModules.EBYSCatalog;
const C = () => window.AppModules.EBYSCatalogSchema;
const notify = (text, type = 'success') => window.showAppAlert?.(text, type);
let catalog = { profile: null, filePlans: [], templates: [] };

function node(tag, text, className) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    return n;
}
function button(text, onClick, className = 'btn btn-sm btn-outline-primary') {
    const b = node('button', text, className);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}
function input(labelText, name, value = '', { max, required = false, multiline = false, placeholder = '' } = {}) {
    const label = node('label', labelText, 'ebys-catalog-field');
    const control = node(multiline ? 'textarea' : 'input', null, 'form-control');
    control.name = name;
    control.value = value ?? '';
    if (max) control.maxLength = max;
    if (required) control.required = true;
    if (placeholder) control.placeholder = placeholder;
    if (multiline) control.rows = name === 'content' ? 10 : 3;
    label.append(control);
    return label;
}
const values = form => Object.fromEntries(new FormData(form));
const dateText = ts => (ts?.toDate ? ts.toDate().toLocaleString('tr-TR') : '');
const statusBadge = on => node('span', on ? 'Aktif' : 'Pasif', `badge ${on ? 'bg-success' : 'bg-secondary'}`);

async function guarded(form, work) {
    const submit = form.querySelector('[type=submit]');
    if (submit) submit.disabled = true;
    try { await work(); }
    catch (error) { notify(error.message || 'İşlem tamamlanamadı.', 'error'); }
    finally { if (submit) submit.disabled = false; }
}
async function reload() {
    catalog = await api().loadCatalog();
    return catalog;
}

// ─── Kurum Künyesi ───
function renderInstitution(host) {
    const p = catalog.profile;
    const L = C().LIMITS;
    host.replaceChildren();
    const meta = node('p', p ? `Güncel künye: revizyon ${p.revision}${dateText(p.updatedAt) ? ` · ${dateText(p.updatedAt)}` : ''}`
        : 'Henüz künye tanımlanmadı. Tanımlanana kadar evrak formunda kurum kodu elle yazılır.', 'small text-muted');
    const form = node('form', null, 'ebys-catalog-form');
    form.append(
        input('Kurum adı', 'name', p?.name, { max: L.name, required: true }),
        input('Kurum kodu (kayıt numarasında kullanılır)', 'code', p?.code, { max: 12, required: true, placeholder: 'ör. MED' }),
        input('Adres', 'address', p?.address, { max: L.address, required: true, multiline: true }),
        input('Telefon', 'phone', p?.phone, { max: L.phone }),
        input('E-posta', 'email', p?.email, { max: L.email }),
        input('Web adresi', 'web', p?.web, { max: L.web }),
    );
    const save = node('button', p ? 'Künyeyi güncelle' : 'Künyeyi kaydet', 'btn btn-primary');
    save.type = 'submit';
    form.append(node('p', 'Kaydettiğiniz künye bundan sonra açılan evraklara kopyalanır. Açılmış ve dondurulmuş evraklar kendi kopyasını korur.',
        'small text-muted ebys-catalog-wide'), save);
    form.addEventListener('submit', event => {
        event.preventDefault();
        guarded(form, async () => {
            await api().saveProfile(values(form), { expectedRevision: p ? p.revision : 0 });
            await reload();
            renderInstitution(host);
            notify('Kurum künyesi kaydedildi. Yeni evraklar bu künyeyi alır.');
        });
    });
    const history = node('details', null, 'ebys-catalog-history');
    history.append(node('summary', 'Künye geçmişi (değiştirilemez)'));
    history.addEventListener('toggle', async () => {
        if (!history.open || history.dataset.loaded) return;
        history.dataset.loaded = '1';
        try {
            const list = node('ul');
            (await api().listProfileRevisions()).forEach(r => list.append(node('li',
                `Revizyon ${r.revision} · ${r.profile.name} (${r.profile.code})${dateText(r.createdAt) ? ` · ${dateText(r.createdAt)}` : ''}`)));
            history.append(list.children.length ? list : node('p', 'Kayıt yok.', 'small text-muted'));
        } catch (error) { history.append(node('p', error.message, 'small text-danger')); }
    });
    host.append(meta, form, history);
}

// ─── Dosya Planı ───
function renderFilePlans(host) {
    host.replaceChildren();
    const form = node('form', null, 'ebys-catalog-form ebys-catalog-inline');
    form.append(input('Kod', 'code', '', { max: 40, required: true, placeholder: 'ör. 100 ya da 100.01' }),
        input('Ad', 'title', '', { max: C().LIMITS.planTitle, required: true, placeholder: 'ör. İdari İşler' }));
    const add = node('button', 'Plan ekle', 'btn btn-primary');
    add.type = 'submit';
    form.append(add);
    form.addEventListener('submit', event => {
        event.preventDefault();
        guarded(form, async () => {
            await api().saveFilePlan(values(form), { create: true });
            await reload();
            renderFilePlans(host);
            notify('Dosya planı eklendi.');
        });
    });
    const table = node('table', null, 'modern-table');
    const head = node('tr');
    ['Kod', 'Ad', 'Durum', 'İşlemler'].forEach(t => head.append(node('th', t)));
    table.append(node('thead'), node('tbody'));
    table.tHead.append(head);
    const plans = [...catalog.filePlans].sort((a, b) => String(a.code).localeCompare(String(b.code), 'tr', { numeric: true }));
    for (const plan of plans) {
        const row = node('tr');
        const titleCell = node('td', plan.title);
        const actions = node('td');
        const wrap = node('div', null, 'ebys-catalog-actions');
        wrap.append(
            button('Adı düzelt', () => editPlanTitle(plan, titleCell, host)),
            button(plan.active === false ? 'Etkinleştir' : 'Pasife al', async () => {
                try {
                    await api().setFilePlanActive(plan.code, plan.active === false, { expectedRevision: plan.revision });
                    await reload();
                    renderFilePlans(host);
                } catch (error) { notify(error.message, 'error'); }
            }, plan.active === false ? 'btn btn-sm btn-outline-success' : 'btn btn-sm btn-outline-secondary'),
        );
        actions.append(wrap);
        const status = node('td');
        status.append(statusBadge(plan.active !== false));
        row.append(node('td', plan.code), titleCell, status, actions);
        table.tBodies[0].append(row);
    }
    if (!plans.length) {
        const row = node('tr'), cell = node('td', 'Henüz dosya planı yok. Plan eklenene kadar evrak formunda kod elle yazılır.', 'text-muted p-3');
        cell.colSpan = 4;
        row.append(cell);
        table.tBodies[0].append(row);
    }
    const card = node('div', null, 'modern-card table-responsive');
    card.append(table);
    host.append(form, card);
}
function editPlanTitle(plan, cell, host) {
    const form = node('form', null, 'ebys-catalog-inline');
    const field = node('input', null, 'form-control form-control-sm');
    field.value = plan.title;
    field.maxLength = C().LIMITS.planTitle;
    field.required = true;
    field.setAttribute('aria-label', `${plan.code} planının yeni adı`);
    const save = node('button', 'Kaydet', 'btn btn-sm btn-primary');
    save.type = 'submit';
    form.append(field, save, button('Vazgeç', () => renderFilePlans(host), 'btn btn-sm btn-secondary'));
    form.addEventListener('submit', event => {
        event.preventDefault();
        guarded(form, async () => {
            await api().saveFilePlan({ ...plan, title: field.value }, { expectedRevision: plan.revision });
            await reload();
            renderFilePlans(host);
            notify('Plan adı güncellendi. Önceden açılmış evraklar eski adı korur.');
        });
    });
    cell.replaceChildren(form);
    field.focus();
}

// ─── Üst Yazı Şablonları ───
function renderTemplates(host) {
    host.replaceChildren();
    const top = node('div', null, 'ebys-catalog-actions mb-3');
    top.append(button('Yeni şablon', () => openTemplateEditor(host, null), 'btn btn-primary'));
    const table = node('table', null, 'modern-table');
    const head = node('tr');
    ['Şablon', 'Güncel sürüm', 'Durum', 'İşlemler'].forEach(t => head.append(node('th', t)));
    table.append(node('thead'), node('tbody'));
    table.tHead.append(head);
    const list = [...catalog.templates].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    for (const t of list) {
        const row = node('tr');
        const status = node('td');
        status.append(statusBadge(t.active !== false));
        const actions = node('td'), wrap = node('div', null, 'ebys-catalog-actions');
        wrap.append(
            button('Düzenle (yeni sürüm)', () => openTemplateEditor(host, t)),
            button('Sürümler', () => showRevisions(host, t), 'btn btn-sm btn-outline-secondary'),
            button(t.active === false ? 'Etkinleştir' : 'Pasife al', async () => {
                try {
                    await api().setTemplateActive(t.id, t.active === false, { expectedRevision: t.revision });
                    await reload();
                    renderTemplates(host);
                } catch (error) { notify(error.message, 'error'); }
            }, t.active === false ? 'btn btn-sm btn-outline-success' : 'btn btn-sm btn-outline-secondary'),
        );
        actions.append(wrap);
        row.append(node('td', t.name), node('td', `Sürüm ${t.currentRevision}`), status, actions);
        table.tBodies[0].append(row);
    }
    if (!list.length) {
        const row = node('tr'), cell = node('td', 'Henüz şablon yok.', 'text-muted p-3');
        cell.colSpan = 4;
        row.append(cell);
        table.tBodies[0].append(row);
    }
    const card = node('div', null, 'modern-card table-responsive');
    card.append(table);
    const detail = node('div', null, 'ebys-catalog-detail');
    const delegationBox = node('section', null, 'modern-card p-3 mt-3');
    host.append(top, card, detail, delegationBox);
    renderDelegationSection(delegationBox);
}

// [WHY]: v3.8 VP-4 · Yöneticiye acil kurumsal süreklilik için personel kişisel şablonlarına süreli, gerekçeli, parola doğrulamalı
//        ve denetim kayıtlı salt-okunur vekâlet tanımlama / görüntüleme paneli sunar (AGENTS.md kısa açıklama + ⓘ yardım).
// [HOW]: Saf createElement/textContent kullanır; yalnız aktif yönetici işlem yapabilir, değişiklik öncesi promptAdminReauth çağrılır.
async function renderDelegationSection(box) {
    box.replaceChildren();
    const head = node('div', null, 'd-flex align-items-center justify-content-between flex-wrap gap-2 mb-2');
    head.append(node('h3', '🔑 Vekâleten Kişisel Şablon Erişimi (Süreli & Denetimli)', 'h6 m-0'));
    const helpId = 'ebysDelegationHelpBox';
    const helpBox = node('div', null, 'small text-muted p-2 mb-2 border rounded');
    helpBox.id = helpId;
    helpBox.hidden = true;
    helpBox.append(
        node('p', '1. Kişisel üst yazı şablonları varsayılan olarak yönetici dahil herkese kapalıdır.', 'mb-1'),
        node('p', '2. İzin, rapor veya görev devri gibi acil kurumsal süreklilik durumlarında, gerekçe ve süre (en çok 7 gün / 168 saat) belirterek yalnızca salt-okunur vekâlet açabilirsiniz.', 'mb-1'),
        node('p', '3. Vekâlet tanımlama ve sonlandırma işlemleri yönetici parolası doğrulaması gerektirir, Güvenlik/Denetim Günlüğüne yazılır ve ilgili personelin evrak ekranında şeffaf olarak bildirilir.', 'mb-0')
    );
    const helpBtn = button('ⓘ Nasıl çalışır?', () => {
        helpBox.hidden = !helpBox.hidden;
        helpBtn.setAttribute('aria-expanded', String(!helpBox.hidden));
    }, 'btn btn-sm btn-outline-secondary');
    helpBtn.setAttribute('aria-expanded', 'false');
    helpBtn.setAttribute('aria-controls', helpId);
    head.append(helpBtn);

    const desc = node('p', 'Kurumsal süreklilik gerektiğinde seçili personelin kişisel üst yazı şablonlarına süreli (en çok 7 gün) ve salt-okunur vekâlet erişimi tanımlar; tüm işlemler denetim günlüğüne kaydedilir.', 'small text-muted mb-2');
    box.append(head, desc, helpBox);

    const personel = ((window.data && window.data.personel) || []).filter(p => p && p.uid && p.active !== false);
    const form = node('form', null, 'ebys-catalog-form ebys-catalog-inline mb-3');
    const uidLabel = node('label', 'Personel (UID)', 'ebys-catalog-field');
    if (personel.length) {
        const sel = node('select', null, 'form-control');
        sel.name = 'ownerUid';
        sel.required = true;
        sel.append(node('option', '— Personel seçin —'));
        sel.firstChild.value = '';
        for (const p of personel) {
            const opt = node('option', `${p.name || p.adSoyad || p.pri || p.uid} (${p.pri || p.uid})`);
            opt.value = String(p.uid);
            sel.append(opt);
        }
        uidLabel.append(sel);
    } else {
        const inp = node('input', null, 'form-control');
        inp.name = 'ownerUid';
        inp.required = true;
        inp.maxLength = 128;
        inp.placeholder = 'Personel Auth UID';
        uidLabel.append(inp);
    }
    const hoursLabel = input('Süre (saat, 1–168)', 'durationHours', '24', { max: 3, required: true, placeholder: '24' });
    const reasonLabel = input('Gerekçe (en az 5 karakter)', 'reason', '', { max: 240, required: true, placeholder: 'ör. Yıllık izin süresince bekleyen üst yazı şablonu erişimi' });
    const grantBtn = node('button', 'Vekâlet Tanımla', 'btn btn-primary');
    grantBtn.type = 'submit';
    form.append(uidLabel, hoursLabel, reasonLabel, grantBtn);

    const listWrap = node('div');
    const previewWrap = node('div', null, 'mt-2');
    box.append(form, listWrap, previewWrap);

    const confirmReauth = async titleText => {
        if (typeof window.SecurityConfig?.promptAdminReauth === 'function') {
            const res = await window.SecurityConfig.promptAdminReauth({
                title: titleText,
                message: 'Bu işlem denetim günlüğüne yazılır. Onaylamak için yönetici parolanızı doğrulayın.',
            });
            if (res !== 'verified') throw new Error('Parola doğrulaması tamamlanmadığı için işlem iptal edildi.');
        }
    };

    form.addEventListener('submit', event => {
        event.preventDefault();
        guarded(form, async () => {
            const v = values(form);
            await confirmReauth('Kişisel Şablon Vekâleti Tanımla');
            await api().grantPersonalTemplateDelegation({
                ownerUid: v.ownerUid,
                durationHours: Number(v.durationHours || 24),
                reason: v.reason,
            });
            notify('Kişisel şablon vekâleti tanımlandı ve denetim günlüğüne kaydedildi.');
            await renderDelegationSection(box);
        });
    });

    try {
        const delegations = await api().listPersonalTemplateDelegations();
        if (!delegations.length) {
            listWrap.append(node('p', 'Henüz tanımlanmış bir kişisel şablon vekâleti yok.', 'small text-muted mb-0'));
            return;
        }
        const tbl = node('table', null, 'modern-table');
        const trHead = node('tr');
        ['Personel UID', 'Durum', 'Bitiş Zamanı', 'Gerekçe', 'İşlemler'].forEach(h => trHead.append(node('th', h)));
        tbl.append(node('thead'), node('tbody'));
        tbl.tHead.append(trHead);
        for (const d of delegations) {
            const isAct = C().isDelegationActive(d);
            const row = node('tr');
            const st = node('td');
            st.append(node('span', isAct ? 'Aktif Vekâlet' : (d.revoked ? 'Sonlandırıldı' : 'Süresi Doldu'), `badge ${isAct ? 'bg-warning text-dark' : 'bg-secondary'}`));
            const actTd = node('td');
            const btns = node('div', null, 'ebys-catalog-actions');
            if (isAct) {
                btns.append(
                    button('Şablonları Gör', async () => {
                        previewWrap.replaceChildren(node('p', 'Yükleniyor…', 'small text-muted'));
                        try {
                            const items = await api().listDelegatedPersonalTemplates(d.ownerUid);
                            previewWrap.replaceChildren();
                            const cardBox = node('div', null, 'p-2 border rounded');
                            cardBox.append(node('h4', `${d.ownerUid} · Vekâleten Görüntülenen Kişisel Şablonlar (${items.length})`, 'h6'));
                            if (!items.length) cardBox.append(node('p', 'Bu personele ait kayıtlı kişisel şablon bulunmuyor.', 'small text-muted mb-0'));
                            for (const tpl of items) {
                                const det = node('details', null, 'ebys-catalog-history');
                                det.append(node('summary', `${tpl.name}${tpl.subject ? ` · Konu: ${tpl.subject}` : ''}`));
                                det.append(node('pre', tpl.content, 'ebys-catalog-pre'));
                                cardBox.append(det);
                            }
                            previewWrap.append(cardBox);
                        } catch (err) { previewWrap.replaceChildren(node('p', err.message, 'small text-danger')); }
                    }, 'btn btn-sm btn-outline-primary'),
                    button('Sonlandır', async () => {
                        try {
                            await confirmReauth('Kişisel Şablon Vekâletini Sonlandır');
                            await api().revokePersonalTemplateDelegation({ ownerUid: d.ownerUid, reason: 'Yönetici tarafından panelden sonlandırıldı.' });
                            notify('Vekâlet erişimi sonlandırıldı.');
                            await renderDelegationSection(box);
                        } catch (err) { notify(err.message, 'error'); }
                    }, 'btn btn-sm btn-outline-danger')
                );
            }
            actTd.append(btns);
            row.append(node('td', d.ownerUid), st, node('td', dateText(d.expiresAt) || '-'), node('td', d.reason || '-'), actTd);
            tbl.tBodies[0].append(row);
        }
        listWrap.append(tbl);
    } catch (err) {
        listWrap.append(node('p', `Vekâlet listesi okunamadı: ${err.message}`, 'small text-muted mb-0'));
    }
}
async function openTemplateEditor(host, template) {
    const detail = host.querySelector('.ebys-catalog-detail');
    detail.replaceChildren(node('p', 'Yükleniyor…', 'small text-muted'));
    let current = null;
    try { if (template) current = await api().getTemplateRevision(template.id, template.currentRevision); }
    catch (error) { detail.replaceChildren(node('p', error.message, 'text-danger')); return; }
    const L = C().LIMITS;
    const form = node('form', null, 'ebys-catalog-form modern-card p-3');
    form.append(node('h3', template ? `${template.name} · sürüm ${template.currentRevision + 1} hazırlanıyor` : 'Yeni şablon', 'h6 ebys-catalog-wide'),
        input('Şablon adı', 'name', current?.name || '', { max: L.templateName, required: true }),
        input('Konu (isteğe bağlı)', 'subject', current?.subject || '', { max: L.subject }),
        input('Üst yazı metni', 'content', current?.content || '', { max: L.content, required: true, multiline: true }));
    const save = node('button', template ? 'Yeni sürüm olarak kaydet' : 'Şablonu kaydet', 'btn btn-primary');
    save.type = 'submit';
    form.append(node('p', 'Kaydetmek yeni bir sürüm açar. Önceki sürümler ve onlarla hazırlanmış evraklar değişmez.', 'small text-muted ebys-catalog-wide'),
        save, button('Vazgeç', () => detail.replaceChildren(), 'btn btn-secondary'));
    form.addEventListener('submit', event => {
        event.preventDefault();
        guarded(form, async () => {
            const saved = await api().saveTemplate({ ...values(form), id: template?.id }, { expectedRevision: template ? template.revision : undefined });
            await reload();
            renderTemplates(host);
            notify(`Şablon kaydedildi (sürüm ${saved.currentRevision}).`);
        });
    });
    detail.replaceChildren(form);
    form.querySelector('[name=name]').focus();
}
async function showRevisions(host, template) {
    const detail = host.querySelector('.ebys-catalog-detail');
    detail.replaceChildren(node('p', 'Yükleniyor…', 'small text-muted'));
    try {
        const box = node('div', null, 'modern-card p-3');
        box.append(node('h3', `${template.name} · sürümler (değiştirilemez)`, 'h6'));
        for (const r of await api().listTemplateRevisions(template.id)) {
            const item = node('details', null, 'ebys-catalog-history');
            item.append(node('summary', `Sürüm ${r.revision}${r.revision === template.currentRevision ? ' · güncel' : ''}${dateText(r.createdAt) ? ` · ${dateText(r.createdAt)}` : ''}`));
            if (r.subject) item.append(node('p', `Konu: ${r.subject}`, 'small'));
            item.append(node('pre', r.content, 'ebys-catalog-pre'));
            box.append(item);
        }
        box.append(button('Kapat', () => detail.replaceChildren(), 'btn btn-sm btn-secondary'));
        detail.replaceChildren(box);
    } catch (error) { detail.replaceChildren(node('p', error.message, 'text-danger')); }
}

const PANELS = { institution: ['ebysInstitutionPanel', renderInstitution], filePlans: ['ebysFilePlanPanel', renderFilePlans],
    letterTemplates: ['ebysTemplatePanel', renderTemplates] };
window.renderEBYSCatalog = async function (tabId) {
    const [hostId, render] = PANELS[tabId] || [];
    const host = hostId && document.getElementById(hostId);
    if (!host) return;
    host.replaceChildren(node('p', 'Yükleniyor…', 'small text-muted'));
    try {
        await reload();
        render(host);
    } catch (error) {
        host.replaceChildren(node('p', `Tanımlar yüklenemedi: ${error.message}`, 'text-danger'));
    }
};
