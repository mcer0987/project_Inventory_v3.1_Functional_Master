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
    host.append(top, card, node('div', null, 'ebys-catalog-detail'));
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
