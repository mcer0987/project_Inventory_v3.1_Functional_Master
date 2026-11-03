import '../services/ebys-document-service.js';
import './ebys-process-ui.js';
const api = () => window.AppModules.EBYSDocuments;
const schema = () => window.AppModules.EBYSDocumentSchema;
const labels = { incoming: 'Gelen Evrak Defteri', outgoing: 'Giden Evrak Defteri', internal: 'İç Yazışmalar' };
const states = { draft: 'Taslak', registered: 'Kayıtlı', in_review: 'İncelemede / rota bekliyor', internally_approved: 'Onaylandı', returned:'İade edildi',rejected:'Reddedildi',withdrawn:'Geri çekildi',pending_execution: 'İcrada', archived: 'Arşivde' };
const node = (tag, text, css) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (css) n.className = css; return n; };
const button = (text, action, css = 'btn btn-sm btn-outline-primary') => { const b = node('button', text, css); b.type = 'button'; b.onclick = action; return b; };
let kind = 'incoming', rows = [], cursor = null, unsubscribe = null, dialog = null, syncAllowed = false, countsRevision = 0;
const host = document.getElementById('ebysDocumentRegistry');
const message = text => { const status=document.getElementById('ebysDocumentStatus'); if(status)status.textContent=text;else window.showAppAlert?.(text); };
function clear() { rows = []; document.getElementById('ebysDocumentRows')?.replaceChildren(); document.querySelectorAll('.ebys-document-dialog').forEach(d => d.remove()); dialog = null; }
function stop() { unsubscribe?.(); unsubscribe = null; countsRevision++; }
async function refreshCounts() {
    const revision = ++countsRevision;
    try {
        const counts = await api().countDocuments();
        if (revision !== countsRevision || !syncAllowed) return;
        for (const key of ['total', 'draft', 'registered', 'in_review']) document.getElementById(`ebysCount-${key}`).textContent = String(counts[key]);
    } catch { if (revision === countsRevision) document.querySelectorAll('[data-ebys-count]').forEach(n => { n.textContent = '—'; }); }
}
function dismissable(modal) {
    const close = button('✕', () => modal.close(), 'ebys-dialog-close'); close.setAttribute('aria-label', 'Pencereyi kapat'); modal.append(close);
    const outside = e => { const r = modal.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let downOutside = false;
    modal.addEventListener('pointerdown', e => { downOutside = e.target === modal && outside(e); });
    modal.addEventListener('click', e => { if (downOutside && e.target === modal && outside(e)) modal.close(); });
    modal.addEventListener('close', () => { if (!modal.open && modal.dataset.confirming !== 'true') modal.remove(); });
}
function subscribe() {
    stop();
    const repair = document.getElementById("ebysLegacyAccessRepair");
    if (repair) repair.hidden = !window.isDbAdmin?.();
    if (!syncAllowed || !window.userAuth || document.getElementById('purchaseTab')?.style.display === 'none') return () => {};
    message('Evraklar yükleniyor…');
    const own = api().listDocuments(data => { rows = data; render(); refreshCounts(); message(`${data.length} kayıt · Sayfa başına en fazla 50 evrak`); }, error => message(`Evraklar yüklenemedi: ${error.message}`), cursor, kind);
    unsubscribe = own;
    return () => { own(); if (unsubscribe === own) { unsubscribe = null; clear(); } };
}
function render() {
    const body = document.getElementById('ebysDocumentRows'); if (!body) return;
    document.querySelectorAll('#ebysDocumentKinds button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.kind === kind)); b.className = b.dataset.kind === kind ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-primary'; });
    body.replaceChildren();
    const selected = document.getElementById('ebysStateFilter').value;
    const search = document.getElementById('ebysDocumentSearch').value.toLocaleLowerCase('tr-TR').trim();
    for (const head of rows.filter(h => (!selected || h.state === selected) && (!search || (h.registrationNo || h.id).toLocaleLowerCase('tr-TR').includes(search)))) {
        const row = node('tr');
        const unit = (window.data?.units || []).find(u => String(u.id) === head.unitId);
        const date = head.updatedAt?.toDate?.().toLocaleString('tr-TR') || '—';
        for (const text of [head.registrationNo || `Taslak · ${head.id.slice(0, 8)}`, unit?.name || head.unitId, states[head.state] || head.state, date]) row.append(node('td', text));
        const action = node('td'), actions = node('div',null,'ebys-registry-actions');
        if (head.ownerUid === window.userAuth?.uid) actions.append(button('Aç', () => open(head.id)));
        else actions.append(node('span', 'Yazarına özel içerik', 'small text-muted'));
        if(head.currentVersionId)actions.append(button('Süreç durumu',()=>window.AppModules.EBYSProcessUI.open(head.currentVersionId,head.id,head.ownerUid===window.userAuth?.uid)));
        action.append(actions);
        row.append(action); body.append(row);
    }
    if (!body.children.length) { const row = node('tr'), cell = node('td', 'Bu sayfada filtreye uygun evrak yok.', 'text-muted p-3'); cell.colSpan = 5; row.append(cell); body.append(row); }
}
function field(form, label, name, value = '', options = null, multiline = false) {
    const wrap = node('label', label, name === 'content' ? 'ebys-field ebys-wide' : 'ebys-field');
    const input = node(options ? 'select' : multiline ? 'textarea' : 'input', null, 'form-control'); input.name = name;
    if (options) for (const [v, title] of options) { const opt = node('option', title); opt.value = v; input.append(opt); }
    input.value = value; input.required = !['distribution', 'externalRegistrationNo'].includes(name);
    if (multiline) input.rows = name === 'content' ? 7 : 2;
    if (name === 'date') input.type = 'date';
    const max = { subject: 240, correspondent: 240, filePlanCode: 40, distribution: 2000, externalRegistrationNo: 120, content: 40000, organizationCode: 12 }[name];
    if (max) input.maxLength = max;
    wrap.append(input); form.append(wrap); return input;
}
async function open(id = null) {
    try {
        const actor = window.userAuth?.uid;
        const loaded = id ? await api().readDocument(id) : null;
        if (!actor || actor !== window.userAuth?.uid) return;
        let head = loaded?.head || { id: schema().uuid(), kind, revision: 0, unitId: '', organizationCode: 'MED', registrationNo: '', state: 'draft' };
        const data = loaded?.body || {}, metadata = data.metadataSnapshot || data.metadata || {};
        const frozen = !!head.currentVersionId;
        dialog?.remove(); dialog = node('dialog', null, 'ebys-document-dialog');
        const editor = dialog; dismissable(editor);
        const form = node('form', null, 'ebys-document-form'); form.method = 'dialog';
        const title = node('h3', `${labels[head.kind]} · ${head.registrationNo || 'Yeni taslak'}`, 'ebys-wide'); form.append(title);
        const unitOptions = [['', 'Birim seçin'], ...(window.data?.units || []).filter(u => u.active !== false || String(u.id) === head.unitId).map(u => [String(u.id), u.name || u.birimAdi || String(u.id)])];
        field(form, 'İlgili birim', 'unitId', head.unitId, unitOptions);
        const code = field(form, 'Kurum kodu', 'organizationCode', head.organizationCode); code.readOnly = !!loaded;
        field(form, 'Konu', 'subject', metadata.subject || ''); field(form, 'Muhatap kurum / kişi', 'correspondent', metadata.correspondent || '');
        field(form, 'Evrak tarihi', 'date', metadata.date || new Date().toLocaleDateString('sv-SE'));
        field(form, 'Dosya planı kodu', 'filePlanCode', metadata.filePlanCode || '');
        field(form, 'Gizlilik derecesi', 'confidentiality', metadata.confidentiality || 'Normal', ['Normal', 'Hizmete Özel', 'Gizli'].map(v => [v, v]));
        field(form, 'Dış evrak numarası', 'externalRegistrationNo', metadata.externalRegistrationNo || '');
        field(form, 'Dağıtım yerleri (her satıra bir yer)', 'distribution', metadata.distribution || '', null, true);
        field(form, 'Üst yazı / evrak gövdesi', 'content', data.content || '', null, true);
        form.append(node('p', frozen ? `Dondurulmuş sürüm ${data.versionNo || head.versionNo} · SHA-256: ${data.contentDigest}` : 'Evrak gövdesi düz metindir. Dosya eki bu pilot evrakta kullanılmaz.', 'small text-muted ebys-wide'));
        const status = node('div', '', 'small ebys-wide'); status.setAttribute('role', 'status'); form.append(status);
        const actions = node('div', null, 'd-flex flex-wrap gap-2 ebys-wide');
        let busy = false, pendingSave = null, pendingRegister = null, pendingFreeze = null;
        const input = () => {
            const values = Object.fromEntries(new FormData(form));
            return { id: head.id, expectedRevision: head.revision, kind: head.kind, unitId: values.unitId, organizationCode: values.organizationCode,
                content: values.content, metadata: Object.fromEntries(['subject','correspondent','date','filePlanCode','confidentiality','distribution','externalRegistrationNo'].map(k => [k, values[k]])) };
        };
        async function act(action) {
            if (busy) return; busy = true; actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
            try {
                if (!frozen) {
                    if (!form.reportValidity()) return;
                    const value = input(); schema().normalize(value);
                    const signature = schema().canonical(value);
                    if (!pendingSave || pendingSave.signature !== signature) pendingSave = { signature, operationId: schema().uuid() };
                    const saved = await api().saveDraft({ ...value, operationId: pendingSave.operationId });
                    head = { ...head, ...saved, revision: saved.revision }; pendingSave = null;
                }
                if (action === 'register') {
                    pendingRegister ||= schema().uuid();
                    const saved = await api().registerDocument({ documentId: head.id, expectedRevision: head.revision, operationId: pendingRegister });
                    head = { ...head, ...saved }; pendingRegister = null;
                }
                if (action === 'freeze') {
                    pendingFreeze ||= schema().uuid();
                    await api().freezeVersion({ documentId: head.id, expectedRevision: head.revision, operationId: pendingFreeze });
                    pendingFreeze = null;
                }
                status.textContent = action === 'freeze' ? 'İçerik donduruldu ve incelemeye hazır.' : 'Evrak kaydedildi.';
                if (action === 'save') { editor.close(); cursor = null; subscribe(); message('Taslak kaydedildi.'); }
                else if (editor.isConnected) await open(head.id);
            } catch (error) { status.textContent = error.message; }
            finally { busy = false; actions.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
        }
        if (!frozen) {
            actions.append(button('Taslağı kaydet', () => act('save'), 'btn btn-primary'));
            actions.append(button('Onaya sun / Dondur', async () => {
                if (busy || !form.reportValidity()) return;
                if (typeof window.showCustomConfirm !== 'function') { status.textContent = 'Onay penceresi yüklenemedi; sayfayı yenileyin.'; return; }
                // Kurumsal onay katmanı native dialogun altında kalmasın; form ve girişleri korunur.
                editor.dataset.confirming = 'true'; editor.close();
                try {
                    const accepted = await window.showCustomConfirm('Evrakı dondur', 'İçerik dondurulacak ve bu sürüm değiştirilemeyecek. Devam edilsin mi?', { confirmText: 'Dondur ve onaya sun', cancelText: 'Vazgeç' });
                    if (!editor.isConnected || actor !== window.userAuth?.uid) return;
                    editor.showModal();
                    if (accepted === true) await act('freeze');
                } finally { delete editor.dataset.confirming; }
            }, 'btn btn-outline-primary'));
        } else form.querySelectorAll('input,select,textarea').forEach(n => { n.disabled = true; });
        if (frozen) actions.append(button('Onay rotası / Süreç',()=>window.AppModules.EBYSProcessUI.open(head.currentVersionId,head.id)));
        if (!head.registrationNo) actions.append(button('Kesin kayıt numarası al', () => act('register'), 'btn btn-outline-success'));
        actions.append(button('Çıktı önizleme', () => preview(head, frozen ? data : input())));
        actions.append(button('Kapat', () => dialog.close(), 'btn btn-secondary'));
        form.append(actions); form.onsubmit = e => e.preventDefault(); dialog.append(form); document.body.append(dialog); dialog.showModal();
    } catch (error) { message(error.message); }
}
function preview(head, data) {
    const modal = node('dialog', null, 'ebys-document-dialog'); const body = node('article', null, 'ebys-preview');
    dismissable(modal);
    const meta = data.metadataSnapshot || data.metadata || data;
    body.append(node('h2', meta.subject || 'Üst yazı'), node('p', `Sayı: ${head.registrationNo || 'TASLAK'} · Tarih: ${meta.date || ''}`),
        node('p', `Muhatap: ${meta.correspondent || ''}`), node('p', `Dosya planı: ${meta.filePlanCode || ''} · Gizlilik: ${meta.confidentiality || ''}`),
        node('div', data.content || '', 'ebys-preview-content'), node('p', `Dağıtım:\n${meta.distribution || '—'}`, 'ebys-preview-content'));
    const actions = node('div', null, 'd-flex gap-2 ebys-preview-actions');
    actions.append(button('Yazdır', () => { document.body.classList.add('printing-ebys'); window.print(); document.body.classList.remove('printing-ebys'); }), button('Kapat', () => { modal.close(); modal.remove(); }));
    modal.append(body, actions); document.body.append(modal); modal.showModal();
}
if (host) {
    {
        const repair=button('Eski satın alma erişim eşlemeleri',async()=>{
            try{const preview=await window.previewLegacyPurchaseAccess();const ok=await window.showCustomConfirm('Erişim eşleme önizlemesi',`${preview.orders} satın alma kaydı incelendi. UID eksik adım: ${preview.unresolved.length}. Yalnız doğrulanmış mevcut/karar verilmiş adımlara kuyruk eşlemesi oluşturulsun mu?`);
                if(ok){const result=await window.prepareLegacyPurchaseAccess();message(`${result.created} eşleme oluşturuldu. Belirsiz kişi: ${result.unresolved.length}.`);}}
            catch(e){message(e.message);}
        });repair.id="ebysLegacyAccessRepair";repair.hidden=true;host.append(repair);
    }
    const tabs = document.getElementById('ebysDocumentKinds');
    for (const [value, label] of Object.entries(labels)) { const b = button(label, () => { kind = value; cursor = null; subscribe(); }); b.dataset.kind = value; tabs.append(b); }
    for (const [value, label] of Object.entries(states)) { const opt = node('option', label); opt.value = value; document.getElementById('ebysStateFilter').append(opt); }
    document.getElementById('ebysStateFilter').onchange = render;
    document.getElementById('ebysDocumentSearch').oninput = render;
    document.getElementById('ebysDocumentNew').onclick = () => open();
    document.getElementById('ebysDocumentNext').onclick = () => { if (rows.length === 50) { cursor = rows.at(-1)._cursor; subscribe(); } };
    document.getElementById('ebysDocumentFirst').onclick = () => { cursor = null; subscribe(); };
    document.getElementById('ebysDocumentExport').onclick = async () => {
        try { const data = await api().exportOwnDocuments(); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = node('a'); a.href = url; a.download = `ebys-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        catch (error) { message(error.message); }
    };
    window.registerSyncListener('ebysDocuments', () => { syncAllowed = true; subscribe(); return () => { syncAllowed = false; stop(); clear(); }; });
    window.AppModules.AdminTabs.onAny(tab => { if (tab === 'purchaseTab') subscribe(); else { stop(); clear(); } });
    window.addEventListener('onAppLogout', () => { stop(); clear(); });
    window.addEventListener('onInventoryDataUpdated', e => { if (e.detail?.collection === 'units') render(); });
}
window.AppModules.EBYSDocumentsUI={open};
