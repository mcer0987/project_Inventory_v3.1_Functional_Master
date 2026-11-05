import '../services/ebys-execution-service.js';

const api = () => window.AppModules.EBYSExecution;
const adminPanel = document.getElementById('ebysExecutionAdmin');
const personalPanel = document.getElementById('ebysExecutionPersonal');
const notificationsPanel = document.getElementById('ebysExecutionNotifications');
const stateLabels = { pending_acceptance: 'Kabul bekliyor', in_progress: 'İcrada', returned: 'İcra iadesi', completed: 'Tamamlandı' };
const kindLabels = { incoming: 'Gelen evrak', outgoing: 'Giden evrak', internal: 'İç yazışma' };
const actionLabels = { accept: 'Kabul edildi', return: 'İade edildi', reassign: 'Yeniden havale', complete: 'Tamamlandı' };
const units = () => window.data?.units || [];
const people = () => window.data?.personel || [];
const unitName = id => units().find(u => String(u.id) === id)?.name || id;
const personName = uid => {
    const person = people().find(p => p.uid === uid);
    return person?.name || person?.adSoyad || uid;
};
const date = value => value?.toDate?.().toLocaleString('tr-TR') || '—';
const overallLate = job => job.state !== 'completed' && (job.originalDueAt || job.dueAt)?.toMillis() < Date.now();
const assignmentLate = job => ['pending_acceptance', 'in_progress'].includes(job.state) && job.dueAt?.toMillis() < Date.now();
const late = job => overallLate(job) || assignmentLate(job);
const delayLabel = job => overallLate(job) ? ' · İlk hedef aşıldı' : assignmentLate(job) ? ' · Atama hedefi aşıldı' : '';
function waitLabel(from, to = Date.now()) {
    const minutes = Math.max(0, Math.floor((to - from.toMillis()) / 60000));
    return minutes < 60 ? minutes + ' dk' : Math.floor(minutes / 60) + ' sa ' + minutes % 60 + ' dk';
}

function node(tag, text, css) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (css) el.className = css;
    return el;
}

function button(title, click) {
    const b = node('button', title, 'btn btn-sm btn-outline-primary');
    b.type = 'button';
    b.onclick = click;
    return b;
}

function options(select, prompt, choices, selected = '') {
    select.replaceChildren(new Option(prompt, ''), ...choices.map(([value, label]) => new Option(label, value)));
    select.value = selected;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
}

function field(host, title, element) {
    const label = node('label', null, 'ebys-process-field');
    label.append(node('span', title), element);
    host.append(label);
    return element;
}

function textField(host, title, max, required = true, multiline = false) {
    const input = node(multiline ? 'textarea' : 'input', null, 'form-control');
    input.required = required;
    input.maxLength = max;
    if (multiline) input.rows = 2;
    return field(host, title, input);
}

function targetFields(form, existing = {}) {
    const row = node('div', null, 'ebys-process-grid');
    const unit = field(row, 'İcra birimi', node('select', null, 'form-select'));
    const person = field(row, 'İcra sorumlusu', node('select', null, 'form-select'));
    unit.required = person.required = true;
    options(unit, 'Birim seçin', units().filter(u => u.active !== false).map(u => [String(u.id), u.name || u.id]), existing.unitId);
    const setPeople = value => options(person, 'Personel seçin', people()
        .filter(p => p.active !== false && p.uid && p.unitId === unit.value)
        .map(p => [String(p.id), (p.name || p.adSoyad || p.id) + ' · ' + (p.pri || p.id)]), value);
    unit.onchange = () => setPeople('');
    setPeople(existing.personnelId);
    const hours = field(row, 'Hedef süre (saat)', node('input', null, 'form-control'));
    hours.type = 'number';
    hours.min = '1';
    hours.max = '720';
    hours.value = String(existing.dueHours || 72);
    hours.required = true;
    form.append(row);
    return () => ({ unitId: unit.value, personnelId: person.value, dueHours: Number(hours.value) });
}

function submit(form, title, action, success, controls = form) {
    const b = button(title, null);
    b.type = 'submit';
    const status = node('p', null, 'small');
    status.setAttribute('role', 'status');
    controls.append(b, status);
    form.onsubmit = async event => {
        event.preventDefault();
        if (b.disabled || !form.reportValidity()) return;
        b.disabled = true;
        status.textContent = 'İşleniyor…';
        try {
            await action();
            status.textContent = 'Kaydedildi.';
            success?.();
        } catch (error) { status.textContent = error.message; }
        finally { b.disabled = false; }
    };
}

function modal(title) {
    const d = node('dialog', null, 'ebys-document-dialog ebys-process-dialog ebys-execution-dialog');
    const heading = node('h3', title);
    heading.id = 'ebysExecutionDialogTitle';
    d.setAttribute('aria-labelledby', heading.id);
    const close = button('✕', () => d.close());
    close.className = 'ebys-dialog-close';
    close.setAttribute('aria-label', 'Pencereyi kapat');
    d.append(close, heading);
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
}

async function openJob(job, admin) {
    const d = modal(admin ? 'İcra işi detayı' : 'İcra görevi');
    d.append(node('p', kindLabels[job.kind] + ' · ' + stateLabels[job.state] + ' · Hedef ' + date(job.dueAt)));
    d.append(node('p', unitName(job.unitId) + ' · ' + personName(job.assigneeUid)));
    d.append(node('p', 'İlk hedef · ' + date(job.originalDueAt || job.dueAt) + delayLabel(job)));
    if (job.returnedAt) d.append(node('p', 'Yönetimde bekleme · ' + waitLabel(job.returnedAt), 'text-danger'));
    if (job.note) d.append(node('p', job.note));
    if (job.evidenceRef) d.append(node('p', 'Kanıt · ' + job.evidenceRef));
    if (job.stockOperationId) d.append(node('p', 'Stok işlem referansı · ' + job.stockOperationId));

    if (admin) {
        const status = node('p', 'Evrak ve işlem geçmişi yükleniyor…');
        d.append(status);
        if (job.state !== 'completed') {
            const box = node('details', null, 'ebys-process-panel');
            box.append(node('summary', 'Yeniden Havale Et'), node('p', 'İş yeni sorumluya kabul bekleyen olarak iletilir. Gerekçe işlem geçmişine kaydedilir.'));
            const form = node('form');
            const target = targetFields(form, job);
            const reason = textField(form, 'Havale gerekçesi', 1000, true, true);
            submit(form, 'Yeniden Havale Et', () => api().reassignExecutionJob(job.id, job.revision, { ...target(), note: reason.value }), () => d.close());
            box.append(form);
            d.append(box);
        }
        if (['pending_acceptance', 'in_progress'].includes(job.state)) d.append(stockForm(job));
        try {
            const [head, history] = await Promise.all([api().readExecutionHead(job.documentId), api().readExecutionHistory(job.id)]);
            if (!d.isConnected) return;
            status.textContent = (head?.registrationNo || 'Evrak ' + job.documentId.slice(0, 8)) + (head?.state === 'archived' ? ' · Arşivde' : '');
            if (history.length) {
                const list = node('ol');
                for (const e of history) list.append(node('li', actionLabels[e.action] + ' · ' + personName(e.actorUid)
                    + ' · ' + date(e.createdAt) + (e.returnedAt ? ' · Yönetimde ' + waitLabel(e.returnedAt, e.createdAt.toMillis()) : '') + (e.note ? ' · ' + e.note : '')));
                d.append(node('h4', 'Son 50 işlem'), list);
            }
            if (head?.state === 'closed') {
                const form = node('form');
                submit(form, 'Arşivle', () => api().archiveExecutionDocument(job.id), () => d.close());
                d.append(form);
            }
        } catch (error) { status.textContent = error.message; }
        return;
    }

    if (job.state === 'pending_acceptance' || job.state === 'in_progress') {
        const body = node('article', 'Sabit sürüm yükleniyor…', 'ebys-preview-content ebys-process-panel');
        d.append(body);
        try {
            const version = await window.AppModules.EBYSProcesses.getVersion(job.versionId);
            if (!d.isConnected) return;
            body.replaceChildren(node('h4', version.metadataSnapshot?.subject || 'Evrak'), node('p', version.content || ''));
        } catch (error) {
            body.textContent = error.message;
            return;
        }
    }
    if (job.state === 'pending_acceptance') {
        const form = node('form');
        submit(form, 'Kabul Et', () => api().acceptExecutionJob(job.id, job.revision), () => d.close());
        d.append(form);
    }
    if (job.state === 'in_progress') {
        const done = node('form', null, 'ebys-process-panel');
        done.append(node('h4', 'İcra sonucunu kaydet'), node('p', 'Kanıt için tutanak, yazışma veya teslim kaydının referansını girin.'));
        const result = textField(done, 'İşlem sonucu', 1000, true, true);
        const evidence = textField(done, 'Kanıt referansı', 240);
        const stock = textField(done, 'Yönetimin bu işe bağladığı stok işlem numarası (isteğe bağlı)', 80, false);
        submit(done, 'Tamamla', () => api().completeExecutionJob(job.id, job.revision, {
            note: result.value, evidenceRef: evidence.value, stockOperationId: stock.value
        }), () => d.close());
        const back = node('details', null, 'ebys-process-panel');
        back.append(node('summary', 'İade Et'), node('p', 'İş, yeniden havale edilmek üzere yönetime döner.'));
        const form = node('form');
        const reason = textField(form, 'İade gerekçesi', 1000, true, true);
        submit(form, 'Gerekçeyle İade Et', () => api().returnExecutionJob(job.id, job.revision, reason.value), () => d.close());
        back.append(form);
        d.append(done, back);
    }
}

function stockForm(job) {
    const box = node('details', null, 'ebys-process-panel');
    box.append(node('summary', 'Stok işlemini doğrula ve bağla'),
        node('p', 'Defterdeki hareketi inceleyin. Doğrulanmış bağlantı yalnız bu evrak için kullanılabilir ve değiştirilemez.'));
    const form = node('form');
    const operation = textField(form, 'Mevcut stok işlem numarası', 80);
    const reason = textField(form, 'İlişkilendirme gerekçesi', 240);
    const preview = node('p');
    preview.setAttribute('role', 'status');
    let verified = '';
    form.append(button('Stok kaydını getir', async () => {
        const candidate = operation.value.trim();
        verified = '';
        try {
            const entry = await api().readStockOperation(candidate);
            if (candidate !== operation.value.trim()) return;
            verified = candidate;
            preview.textContent = [entry.kind, entry.sourceCol + '/' + entry.sourceId, entry.targetCol + '/' + entry.targetId, 'Miktar ' + entry.qty].join(' · ');
        } catch (error) { preview.textContent = error.message; }
    }), preview);
    submit(form, 'Doğrulanan kaydı bağla', () => {
        if (!verified || verified !== operation.value.trim()) throw new Error('Önce stok kaydını getirip doğrulayın.');
        return api().linkExecutionStockOperation(job.id, verified, reason.value);
    });
    box.append(form);
    return box;
}

function pager(host, watch, render) {
    const rows = host.querySelector('[data-execution-rows]');
    const status = host.querySelector('[data-execution-status]');
    const next = host.querySelector('[data-execution-next]');
    const first = host.querySelector('[data-execution-first]');
    let data = [], cursor = null, stop = null;
    function clear() {
        stop?.();
        stop = null;
        data = [];
        rows.replaceChildren();
        status.textContent = '';
        next.disabled = first.disabled = true;
    }
    function redraw() { if (stop) render(rows, data, status); }
    function start(after = null) {
        clear();
        cursor = after;
        status.textContent = 'Yükleniyor…';
        stop = watch(cursor, values => {
            data = values;
            status.textContent = 'Bu sayfada ' + data.length + ' kayıt';
            next.disabled = data.length < 50;
            first.disabled = cursor === null;
            render(rows, data, status);
        }, error => {
            rows.replaceChildren();
            status.textContent = error.message;
        });
    }
    next.onclick = () => { if (data.length === 50) start(data.at(-1).cursor); };
    first.onclick = () => start();
    return { start, clear, redraw };
}

function adminJobs(body, jobs) {
    const filters = Array.from(adminPanel.querySelectorAll('[data-filter]'));
    const choices = {
        unitId: ['Tüm birimler', [...new Set(jobs.map(j => j.unitId))].map(id => [id, unitName(id)])],
        assigneeUid: ['Tüm sorumlular', [...new Set(jobs.map(j => j.assigneeUid))].map(uid => [uid, personName(uid)])],
        state: ['Tüm durumlar', Object.entries(stateLabels)]
    };
    for (const select of filters) options(select, ...choices[select.dataset.filter], select.value);
    const visible = jobs.filter(job => filters.every(s => !s.value || s.value === job[s.dataset.filter])
        && (!adminPanel.querySelector('[data-execution-late]').checked || late(job)));
    renderAdminRows(body, visible);
}

function renderAdminRows(body, visible) {
    body.replaceChildren();
    for (const job of visible) {
        const row = node('tr');
        for (const value of [job.documentId.slice(0, 8), unitName(job.unitId), personName(job.assigneeUid)]) row.append(node('td', value));
        row.append(node('td', stateLabels[job.state] + delayLabel(job), late(job) ? 'text-danger fw-bold' : ''));
        row.append(node('td', job.returnedAt
            ? date(job.originalDueAt || job.dueAt) + ' · Yönetimde ' + waitLabel(job.returnedAt)
            : date(job.dueAt)));
        const actions = node('td');
        actions.append(button('Detay', () => openJob(job, true)));
        row.append(actions);
        body.append(row);
    }
    if (!visible.length) {
        const row = node('tr'), cell = node('td', 'Bu sayfada filtreye uygun icra işi yok.');
        cell.colSpan = 6;
        row.append(cell);
        body.append(row);
    }
}

function personalJobs(body, jobs) {
    body.replaceChildren();
    for (const job of jobs) {
        const card = node('article', null, 'ebys-process-panel mb-2');
        card.append(node('h4', kindLabels[job.kind] + ' · ' + stateLabels[job.state]),
            node('p', unitName(job.unitId) + ' · Hedef ' + date(job.dueAt) + delayLabel(job)),
            button('Görevi aç', () => openJob(job, false)));
        body.append(card);
    }
    if (!jobs.length) body.append(node('p', 'Bu sayfada size atanmış icra işi yok.'));
}

function notifications(body, rows, status) {
    body.replaceChildren();
    for (const item of rows) {
        const card = node('article', null, 'ebys-process-panel mb-2');
        card.append(node('h4', item.readAt ? 'Evrakınız kapandı' : 'Yeni · Evrakınız kapandı'), node('p', date(item.createdAt)));
        card.append(button('Evrakı aç', () => window.AppModules.EBYSDocumentsUI.open(item.documentId)));
        if (!item.readAt) card.append(button('Okundu olarak işaretle', async () => {
            try { await api().markNotificationRead(item.id); }
            catch (error) { status.textContent = error.message; }
        }));
        body.append(card);
    }
    if (!rows.length) body.append(node('p', 'Bu sayfada kapanış bildiriminiz yok.'));
}

function policies(host) {
    const form = node('form');
    const selectors = node('div', null, 'ebys-process-grid');
    const kind = field(selectors, 'Evrak türü', node('select', null, 'form-select'));
    const source = field(selectors, 'Evrakın bağlı birimi', node('select', null, 'form-select'));
    options(kind, 'Tür seçin', Object.entries(kindLabels), 'incoming');
    kind.required = true;
    const status = node('p');
    status.setAttribute('role', 'status');
    const targetHost = node('div');
    form.append(selectors, status, targetHost);
    host.replaceChildren(form);
    let generation = 0;
    const load = async () => {
        const current = ++generation;
        const selected = kind.value, unitId = source.value;
        targetHost.replaceChildren();
        form.onsubmit = event => event.preventDefault();
        if (!selected) { status.textContent = 'Havale tanımı için evrak türü seçin.'; return; }
        status.textContent = 'Tanım yükleniyor…';
        try {
            const policy = await api().readExecutionPolicy(selected, unitId);
            if (generation !== current || !form.isConnected) return;
            status.textContent = policy ? 'Kayıtlı havale tanımı' : 'Bu kapsam için kayıtlı havale tanımı yok.';
            const target = targetFields(targetHost, policy || {});
            submit(form, 'Havale Tanımını Kaydet', () => api().saveExecutionPolicy(selected, unitId, target()), null, targetHost);
        } catch (error) { if (generation === current) status.textContent = error.message; }
    };
    const refreshUnits = () => {
        options(source, 'Tür varsayılanı', units().filter(u => u.active !== false).map(u => [String(u.id), u.name || u.id]), source.value);
        load();
    };
    kind.onchange = source.onchange = load;
    refreshUnits();
    return refreshUnits;
}

if (adminPanel) {
    const jobs = pager(document.getElementById('ebysExecutionAll'), (cursor, data, error) => api().watchExecutionJobs(true, cursor, data, error), adminJobs);
    const returns = pager(document.getElementById('ebysExecutionReturns'), (...args) => api().watchReturnedExecutionJobs(...args), renderAdminRows);
    const policyHost = document.getElementById('ebysExecutionPolicies');
    let refreshUnits = null, timer = null, signedIn = false;
    const stop = () => {
        jobs.clear();
        returns.clear();
        clearInterval(timer);
        timer = null;
        refreshUnits = null;
        policyHost.replaceChildren();
    };
    const start = () => {
        if (!signedIn || !window.isDbAdmin?.() || refreshUnits) return;
        jobs.start();
        returns.start();
        refreshUnits = policies(policyHost);
        timer = setInterval(() => { jobs.redraw(); returns.redraw(); }, 60000);
    };
    adminPanel.querySelectorAll('[data-filter], [data-execution-late]').forEach(input => { input.onchange = jobs.redraw; });
    window.AppModules.AdminTabs.onAny(tab => { if (tab === 'purchaseTab') start(); else stop(); });
    window.registerSyncListener('ebysExecutionAdmin', () => {
        signedIn = true;
        if (getComputedStyle(document.getElementById('purchaseTab')).display !== 'none') start();
        return () => { signedIn = false; stop(); };
    });
    window.addEventListener('onInventoryDataUpdated', event => {
        if (!refreshUnits || !['units', 'personel'].includes(event.detail?.collection)) return;
        jobs.redraw();
        returns.redraw();
        if (!policyHost.contains(document.activeElement)) refreshUnits();
    });
}

if (personalPanel && notificationsPanel) {
    const jobs = pager(personalPanel, (cursor, data, error) => api().watchExecutionJobs(false, cursor, data, error), personalJobs);
    const notices = pager(notificationsPanel, (...args) => api().watchNotifications(...args), notifications);
    window.registerSyncListener('ebysExecutionPersonal', () => {
        jobs.start();
        notices.start();
        return () => { jobs.clear(); notices.clear(); };
    });
}
window.addEventListener('onAppLogout', () => document.querySelectorAll('.ebys-execution-dialog').forEach(d => d.remove()));
