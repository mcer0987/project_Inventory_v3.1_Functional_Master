import '../services/ebys-document-service.js';
import '../services/ebys-verification-service.js';
import '../services/ebys-catalog-service.js';
import { verificationNotice, verificationUrl } from '../utils/ebys-verification-schema.js';
import { verificationQr } from '../utils/ebys-verification-qr.js';
import './ebys-process-ui.js';
import './ebys-execution-ui.js';
const api = () => window.AppModules.EBYSDocuments;
const schema = () => window.AppModules.EBYSDocumentSchema;
const labels = { incoming: 'Gelen Evrak Defteri', outgoing: 'Giden Evrak Defteri', internal: 'İç Yazışmalar' };
const states = { draft: 'Taslak', registered: 'Kayıtlı', in_review: 'Donduruldu · Süreç durumuna bakın', internally_approved: 'Kurum içi onay tamamlandı', closed: 'Kapandı', returned:'İade edildi',rejected:'Reddedildi',withdrawn:'Geri çekildi',pending_execution: 'İcra bekliyor (eski kayıt)', archived: 'Arşivde' };
const node = (tag, text, css) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (css) n.className = css; return n; };
const button = (text, action, css = 'btn btn-sm btn-outline-primary') => { const b = node('button', text, css); b.type = 'button'; b.onclick = action; return b; };
let kind = 'incoming', rows = [], cursor = null, unsubscribe = null, dialog = null, syncAllowed = false, countsRevision = 0, listRevision = 0, editorEpoch = 0, countsLoaded = false, countsBusy = false;
const documentDialogs=new Map();let sessionActor=null;
function clearDocumentDialogs(documentId=null){for(const [d,r] of documentDialogs)if(!documentId||r.documentId===documentId){d.remove();documentDialogs.delete(d);}if(!documentId)dialog=null;}
function pauseEditors(){for(const [d,r] of documentDialogs){r.ready=false;r.generation++;if(!r.saved)r.saved=[...d.querySelectorAll('button')].filter(b=>b.textContent!=='Kapat'&&!b.classList.contains('ebys-dialog-close')&&b!==r.retry).map(b=>[b,b.disabled]);r.saved.forEach(([b])=>b.disabled=true);}}
async function resumeEditors(){
    for(const [d,r] of documentDialogs){
        if(!d.isConnected){documentDialogs.delete(d);continue;}
        const generation=++r.generation;
        try{
            if(r.actor!==window.userAuth?.uid){d.remove();documentDialogs.delete(d);continue;}
            if(r.validate&&!await r.validate()){
                if(generation===r.generation&&d.isConnected){r.status.textContent='Evrak değişti. Metniniz korunuyor. İşlem yapmak için güncel evrakı yeniden açın.';r.retry.hidden=true;}continue;
            }
            if(!d.isConnected||generation!==r.generation||document.hidden)continue;
            if(r.actor!==window.userAuth?.uid){d.remove();documentDialogs.delete(d);continue;}
            r.saved?.forEach(([b,disabled])=>b.disabled=disabled);r.saved=null;r.ready=true;r.retry.hidden=true;r.status.textContent='';
        }catch(error){
            if(!d.isConnected||generation!==r.generation)continue;
            if(r.actor!==window.userAuth?.uid){d.remove();documentDialogs.delete(d);}
            else if(error.code==='permission-denied'){clearDocumentDialogs(r.documentId);}
            else{r.status.textContent='Evrak durumu kontrol edilemedi. Metniniz korunuyor; yeniden kontrol edin.';r.retry.hidden=false;}
        }
    }
}
const host = document.getElementById('ebysDocumentRegistry');
// [WHY]: registryVisible sabit #purchaseTab'ı varsayıyordu; index.html'de bu panel #purchaseTab yerine kendi
//        premium-card'ındadır (.tab-content ile aynı görünürlük mantığını paylaşır). admin.html'de panel .admin-tab-content'tir.
// [HOW]: Host'un en yakın .tab-content/.admin-tab-content kapsayıcısı baz alınır; kapsayıcı yoksa (host sayfada değilse) her zaman görünür kabul edilmez.
const panel = host?.closest('.tab-content, .admin-tab-content');
const registryVisible = () => Boolean(host) && !document.hidden && (!panel || getComputedStyle(panel).display !== 'none');
const countScope = document.getElementById('ebysCountScope');
const countStatus = document.getElementById('ebysCountStatus');
const countRefresh = document.getElementById('ebysCountRefresh');
const message = text => { const status=document.getElementById('ebysDocumentStatus'); if(status)status.textContent=text;else window.showAppAlert?.(text); };
function clear() { editorEpoch++;rows = []; document.getElementById('ebysDocumentRows')?.replaceChildren(); clearDocumentDialogs(); }
function stop(resetCounts=true) {
    unsubscribe?.();
    unsubscribe = null;
    countsRevision++;
    listRevision++;
    if (resetCounts) {
        countsLoaded = false;
        document.querySelectorAll('[data-ebys-count]').forEach(n => { n.textContent = '—'; });
        if (countStatus) countStatus.textContent = '';
    } else if (countsBusy && countStatus) {
        countStatus.textContent = 'Son sayım tamamlanmadı. Toplamları yeniden kontrol edebilirsiniz.';
    }
    if (countRefresh) countRefresh.disabled = false;
    countsBusy = false;
}
async function refreshCounts() {
    if(!syncAllowed||countsBusy||!registryVisible())return;
    countsBusy=true;countsLoaded=true;const actor=window.userAuth?.uid;
    if (countRefresh) countRefresh.disabled = true;
    if (countStatus) countStatus.textContent = 'Toplamlar kontrol ediliyor…';
    const revision = ++countsRevision;
    try {
        const counts = await api().countDocuments();
        if (revision !== countsRevision || !syncAllowed || !registryVisible() || actor!==window.userAuth?.uid) return;
        countsLoaded=true;
        for (const key of ['total', 'draft', 'registered', 'in_review']) document.getElementById(`ebysCount-${key}`).textContent = String(counts[key]);
        if (countStatus) countStatus.textContent = 'Toplamlar güncel. Son kontrol: ' + new Date().toLocaleTimeString('tr-TR');
    } catch {
        if (revision === countsRevision && registryVisible() && actor === window.userAuth?.uid && countStatus) {
            countStatus.textContent = 'Toplamlar kontrol edilemedi. Yeniden deneyebilirsiniz.';
        }
    } finally {
        if (revision === countsRevision) {
            countsBusy = false;
            if (countRefresh) countRefresh.disabled = false;
        }
    }
}
function dismissable(modal) {
    const r={actor:window.userAuth?.uid,generation:0,ready:!document.hidden};documentDialogs.set(modal,r);
    r.status=node('p','');r.status.setAttribute('role','status');r.retry=button('Durumu yeniden kontrol et',()=>resumeEditors());r.retry.hidden=true;modal.append(r.status,r.retry);
    r.retry.classList.add('ebys-recheck');
    modal.addEventListener('close',()=>{if(modal.dataset.confirming!=='true')documentDialogs.delete(modal);});
    const close = button('✕', () => modal.close(), 'ebys-dialog-close'); close.setAttribute('aria-label', 'Pencereyi kapat'); modal.append(close);
    const outside = e => { const r = modal.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let downOutside = false;
    modal.addEventListener('pointerdown', e => { downOutside = e.target === modal && outside(e); });
    modal.addEventListener('click', e => { if (downOutside && e.target === modal && outside(e)) modal.close(); });
    modal.addEventListener('close', () => { if (!modal.open && modal.dataset.confirming !== 'true') modal.remove(); });
}
function subscribe() {
    unsubscribe?.();unsubscribe=null;const revision=++listRevision, actor=window.userAuth?.uid;
    const repair = document.getElementById("ebysLegacyAccessRepair");
    if (repair) repair.hidden = !window.isDbAdmin?.();
    if (!syncAllowed || !window.userAuth || !registryVisible()) return () => {};
    message('Evraklar yükleniyor…');
    if(!countsLoaded)refreshCounts();
    const own = api().listDocuments(data => { if(revision!==listRevision||!syncAllowed||!registryVisible()||actor!==window.userAuth?.uid)return; rows=data;render();message(data.length+' kayıt · Sayfa başına en fazla 50 evrak · Arama ve durum filtresi yalnız bu sayfada'); },error=>{if(revision!==listRevision||actor!==window.userAuth?.uid)return;stop();clear();message('Evraklar yüklenemedi: '+error.message);},cursor,kind);
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
        // A-3: satın almaya bağlı, henüz dondurulmamış veya revizyon bekleyen evrak genel metin formunda açılamaz
        // (servis bu kaydı reddeder); satın alma formunun EBYS düzenleme kipine yönlendirilir.
        const purchaseRevision = Object.hasOwn(head, 'purchaseOrderId') && (!head.currentVersionId || ['returned', 'rejected', 'withdrawn'].includes(head.state));
        if (head.ownerUid === window.userAuth?.uid) actions.append(button('Aç', () => {
            const target = purchaseRevision && window.AppModules.EBYSPurchaseUI?.openForRevision
                ? window.AppModules.EBYSPurchaseUI.openForRevision(head.id) : open(head.id);
            Promise.resolve(target).catch(error => message(error.message));
        }));
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
        const actor = window.userAuth?.uid, epoch=editorEpoch;
        const loaded = id ? await api().readDocument(id) : null;
        if (!actor || actor !== window.userAuth?.uid || epoch!==editorEpoch) return;
        let head = loaded?.head || { id: schema().uuid(), kind, revision: 0, unitId: '', organizationCode: 'MED', registrationNo: '', state: 'draft' };
        const data = loaded?.body || {}, metadata = data.metadataSnapshot || data.metadata || {};
        const frozen = !!head.currentVersionId;
        // H6b: kurum künyesi, dosya planı ve şablon kataloğu (dondurulmuş evrak kendi kopyalarını gösterir; katalog okunmaz).
        // Katalog yüklenemezse (modül yok / ağ hatası) form eski davranışla açılır: kod ve plan elle yazılır.
        const cat = frozen ? null : await Promise.resolve(window.AppModules.EBYSCatalog?.loadCatalog()).catch(() => null) ?? null;
        if (actor !== window.userAuth?.uid || epoch !== editorEpoch) return;
        if (!loaded && cat?.profile) head = { ...head, organizationCode: cat.profile.code };
        dialog?.remove(); dialog = node('dialog', null, 'ebys-document-dialog');
        const editor = dialog; dismissable(editor);documentDialogs.get(editor).documentId=head.id;documentDialogs.get(editor).validate=async()=>{if(!loaded)return true;const current=await api().readDocument(head.id);return current.head.revision===head.revision;};
        const form = node('form', null, 'ebys-document-form'); form.method = 'dialog';
        const title = node('h3', `${labels[head.kind]} · ${head.registrationNo || 'Yeni taslak'}`, 'ebys-wide'); form.append(title);
        const unitOptions = [['', 'Birim seçin'], ...(window.data?.units || []).filter(u => u.active !== false || String(u.id) === head.unitId).map(u => [String(u.id), u.name || u.birimAdi || String(u.id)])];
        field(form, 'İlgili birim', 'unitId', head.unitId, unitOptions);
        const code = field(form, 'Kurum kodu', 'organizationCode', head.organizationCode); code.readOnly = !!loaded || !!cat?.profile;
        const inst = loaded ? data.institutionSnapshot : cat?.profile;
        if (inst) form.append(node('p', loaded
            ? `Evrakın kurum künyesi: ${inst.name} · revizyon ${inst.revision}. Bu kopya sabittir; künye sonradan değişse de evrak etkilenmez.`
            : `Kurum künyesi: ${inst.name} (${inst.code}). Kaydettiğinizde evraka kopyalanır.`, 'ebys-institution-note'));
        else if (loaded && cat?.profile) form.append(node('p', 'Bu evrak kurum künyesi tanımlanmadan önce açıldı; künye kopyası taşımaz.', 'ebys-institution-note'));
        // Şablon: seçilen sürümün konu ve metni forma kopyalanır; evrak hangi şablon sürümüyle hazırlandığını kaydeder.
        let letterTemplate = data.letterTemplate || null, undo = null;
        const templateNote = node('p', '', 'ebys-institution-note');
        const renderTemplateNote = () => {
            templateNote.replaceChildren();
            templateNote.hidden = !letterTemplate && !undo;
            if (letterTemplate) templateNote.append(`Şablon: ${letterTemplate.name} · sürüm ${letterTemplate.revision}${frozen ? '' : ' (metin evraka kopyalandı; düzenleyebilirsiniz)'}. `);
            if (!frozen && undo) templateNote.append(button('Önceki metne dön', () => {
                form.elements.subject.value = undo.subject; form.elements.content.value = undo.content; letterTemplate = undo.letterTemplate; undo = null; renderTemplateNote();
            }, 'btn btn-sm btn-link p-0 me-2'));
            if (!frozen && letterTemplate) templateNote.append(button('Şablon bağını kaldır', () => { letterTemplate = null; undo = null; renderTemplateNote(); }, 'btn btn-sm btn-link p-0'));
        };
        const usableTemplates = frozen ? [] : (cat?.templates || []).filter(t => t.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
        if (usableTemplates.length) {
            const chooser = field(form, 'Şablondan doldur (isteğe bağlı)', 'templateChoice', '',
                [['', '— Şablon seçin —'], ...usableTemplates.map(t => [t.id, `${t.name} · sürüm ${t.currentRevision}`])]);
            chooser.required = false;
            chooser.addEventListener('change', async () => {
                const t = usableTemplates.find(x => x.id === chooser.value);
                if (!t) return;
                chooser.disabled = true;
                try {
                    const rev = await window.AppModules.EBYSCatalog.getTemplateRevision(t.id, t.currentRevision);
                    undo = { subject: form.elements.subject.value, content: form.elements.content.value, letterTemplate };
                    const applied = window.AppModules.EBYSCatalogSchema.applyTemplate(rev, { subject: form.elements.subject.value });
                    form.elements.subject.value = applied.subject; form.elements.content.value = applied.content; letterTemplate = applied.letterTemplate;
                    if (!undo.content.trim() && !undo.subject.trim()) undo = null;
                    renderTemplateNote();
                } catch (error) { status.textContent = error.message; }
                finally { chooser.value = ''; chooser.disabled = false; }
            });
        }
        form.append(templateNote); renderTemplateNote();
        field(form, 'Konu', 'subject', metadata.subject || ''); field(form, 'Muhatap kurum / kişi', 'correspondent', metadata.correspondent || '');
        field(form, 'Evrak tarihi', 'date', metadata.date || new Date().toLocaleDateString('sv-SE'));
        // Dosya planı: katalog varsa yalnız aktif planlar (ve taslakta kayıtlı pasif/eski değer) seçilir; yoksa kod elle yazılır.
        const planChoices = frozen || !cat ? [] : window.AppModules.EBYSCatalogSchema.filePlanOptions(cat.filePlans, metadata);
        if (frozen) field(form, 'Dosya planı', 'filePlanDisplay', `${metadata.filePlanCode || ''}${metadata.filePlanTitle ? ` – ${metadata.filePlanTitle}` : ''}`);
        else if (planChoices.length) {
            const selected = planChoices.findIndex(p => p.code === metadata.filePlanCode && (!metadata.filePlanTitle || p.title === metadata.filePlanTitle));
            field(form, 'Dosya planı', 'filePlanChoice', selected < 0 ? '' : String(selected), [['', 'Dosya planı seçin'], ...planChoices.map((p, i) => [String(i), p.label])]);
        } else field(form, 'Dosya planı kodu', 'filePlanCode', metadata.filePlanCode || '');
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
            const plan = values.filePlanChoice !== undefined ? planChoices[Number(values.filePlanChoice)] : null;
            if (plan) Object.assign(values, { filePlanCode: plan.code, filePlanTitle: plan.title });
            return { id: head.id, expectedRevision: head.revision, kind: head.kind, unitId: values.unitId, organizationCode: values.organizationCode,
                content: values.content, ...(letterTemplate ? { letterTemplate } : {}),
                metadata: Object.fromEntries(['subject','correspondent','date','filePlanCode','confidentiality','distribution','externalRegistrationNo',
                    ...(values.filePlanTitle ? ['filePlanTitle'] : [])].map(k => [k, values[k]])) };
        };
        async function act(action) {
            if (busy||document.hidden||actor!==window.userAuth?.uid||!documentDialogs.get(editor)?.ready) return; busy = true; actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
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
                if (action === 'issueVerification') await window.AppModules.EBYSVerification.issueVerification(head.id);
                if(!editor.isConnected||actor!==window.userAuth?.uid||epoch!==editorEpoch)return;
                status.textContent = action === 'freeze' ? 'İçerik donduruldu ve incelemeye hazır.' : 'Evrak kaydedildi.';
                if (action === 'save') { editor.close(); cursor = null; subscribe(); message('Taslak kaydedildi.'); }
                else if (editor.isConnected) await open(head.id);
            } catch (error) { if(error.code==='permission-denied'){clearDocumentDialogs();return;}status.textContent = error.message; }
            finally { busy = false; actions.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
        }
        if (!frozen) {
            actions.append(button('Taslağı kaydet', () => act('save'), 'btn btn-primary'));
            actions.append(button('Onaya sun / Dondur', async () => {
                if (busy || document.hidden || !documentDialogs.get(editor)?.ready || !form.reportValidity()) return;
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
        if (!head.registrationNo && ['draft', 'in_review'].includes(head.state)) actions.append(button('Kesin kayıt numarası al', () => act('register'), 'btn btn-outline-success'));
        if (!head.verificationToken && ['closed', 'archived'].includes(head.state) && head.ownerUid === actor) {
            form.append(node('p', head.registrationNo
                ? 'Doğrulama QR’ı, bağlantıyı bilen kişilere kayıt numarası, kayıt tarihi, evrak türü özeti, durum ve içerik özetini gösterir.'
                : 'Doğrulama QR’ı için evrakın kesin kayıt numarası bulunmalıdır.', 'small text-muted ebys-wide'));
            if (head.registrationNo) actions.append(button('Doğrulama QR’ı oluştur', () => act('issueVerification')));
        }
        actions.append(button('Çıktı önizleme', () => preview(head, frozen ? data : { ...input(), institutionSnapshot: loaded ? data.institutionSnapshot : schema().institutionSnapshot(cat?.profile) })));
        actions.append(button('Kapat', () => dialog.close(), 'btn btn-secondary'));
        form.append(actions); form.onsubmit = e => e.preventDefault(); dialog.append(form); document.body.append(dialog); dialog.showModal();
    } catch (error) { message(error.message); }
}
function preview(head, data) {
    const modal = node('dialog', null, 'ebys-document-dialog'); const body = node('article', null, 'ebys-preview');
    dismissable(modal);
    documentDialogs.get(modal).documentId=head.id;
    documentDialogs.get(modal).validate=async()=>{if(!head.revision)return true;const current=await api().readDocument(head.id);return current.head.revision===head.revision;};
    const meta = data.metadataSnapshot || data.metadata || data;
    // H6b: başlık evrakın kendi künye kopyasından çizilir (güncel künyeden değil); eski evrak künyesiz görünür.
    const inst = data.institutionSnapshot;
    if (inst) {
        const header = node('header', null, 'ebys-preview-institution');
        header.append(node('strong', inst.name), node('small', inst.address),
            node('small', [inst.phone, inst.email, inst.web].filter(Boolean).join(' · ')));
        body.append(header);
    }
    body.append(node('h2', meta.subject || 'Üst yazı'), node('p', `Sayı: ${head.registrationNo || 'TASLAK'} · Tarih: ${meta.date || ''}`),
        node('p', `Muhatap: ${meta.correspondent || ''}`),
        node('p', `Dosya planı: ${meta.filePlanCode || ''}${meta.filePlanTitle ? ` – ${meta.filePlanTitle}` : ''} · Gizlilik: ${meta.confidentiality || ''}`),
        node('div', data.content || '', 'ebys-preview-content'), node('p', `Dağıtım:\n${meta.distribution || '—'}`, 'ebys-preview-content'));
    // A-3: Satın almaya bağlı dondurulmuş sürüm yalnız "Satın alma talebi: konu" metnini taşır; onaycı dışındaki
    // okuyucular (ör. yazar kendi çıktı önizlemesinde) kalemleri ve toplamları burada da görsün.
    if (Array.isArray(data.purchaseSnapshot?.items)) {
        const money = v => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—';
        const scroller = node('div', null, 'table-responsive'), table = node('table', null, 'table table-sm align-middle'), head2 = node('tr');
        for (const title of ['Mal / hizmet', 'Miktar', 'Birim', 'Birim fiyat', 'Para', 'KDV %', 'Toplam']) head2.append(node('th', title, 'small text-nowrap'));
        const thead = node('thead'), tbody2 = node('tbody'); thead.append(head2);
        for (const line of data.purchaseSnapshot.items) {
            const row = node('tr');
            for (const value of [line.description, String(line.quantity), line.unit, money(line.unitPrice), line.currency, String(line.taxRate), money(line.totalPrice)]) row.append(node('td', value ?? '—', 'small'));
            tbody2.append(row);
        }
        table.append(thead, tbody2); scroller.append(table);
        body.append(node('h3', 'Satın alma kalemleri'), scroller);
        const totals = data.purchaseSnapshot.totals || {}, used = new Set(data.purchaseSnapshot.items.map(line => line.currency));
        for (const currency of ['TRY', 'USD', 'EUR']) if (used.has(currency) && totals[currency]) body.append(node('p', `${currency}: Ara ${money(totals[currency].subtotal)} · KDV ${money(totals[currency].tax)} · Genel ${money(totals[currency].total)}`, 'small mb-1'));
    }
    if (head.verificationToken) {
        const url = verificationUrl(head.verificationToken, window.location.href, window.AppEnv?.EMULATOR === true);
        const box = node('figure', null, 'ebys-preview-verification');
        const link = node('a', url);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const caption = node('figcaption');
        caption.append(node('strong', 'Evrak doğrulama'), node('p', verificationNotice), link);
        try { box.append(verificationQr(url)); }
        catch { caption.prepend(node('p', 'Doğrulama adresini aşağıdaki bağlantıdan açın.')); }
        box.append(caption);
        body.append(box);
    }
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
    if (countRefresh) countRefresh.onclick = refreshCounts;
    const tabs = document.getElementById('ebysDocumentKinds');
    for (const [value, label] of Object.entries(labels)) { const b = button(label, () => { kind = value; cursor = null; subscribe(); }); b.dataset.kind = value; tabs.append(b); }
    for (const [value, label] of Object.entries(states)) { if (value === 'pending_execution') continue; const opt = node('option', label); opt.value = value; document.getElementById('ebysStateFilter').append(opt); }
    document.getElementById('ebysStateFilter').onchange = render;
    document.getElementById('ebysDocumentSearch').oninput = render;
    document.getElementById('ebysDocumentNew').onclick = () => open();
    document.getElementById('ebysDocumentNext').onclick = () => { if (rows.length === 50) { cursor = rows.at(-1)._cursor; subscribe(); } };
    document.getElementById('ebysDocumentFirst').onclick = () => { cursor = null; subscribe(); };
    const exportButton = document.getElementById('ebysDocumentExport');
    exportButton.onclick = async () => {
        exportButton.disabled = true;
        try {
            const data = await api().exportOwnDocuments();
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const link = node('a');
            link.href = url;
            link.download = `ebys-kisisel-kopya-${Date.now()}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            const partial = Object.values(data.manifest.collections).some(entry => entry.status === 'partial');
            message(partial ? 'Kişisel kopya indirildi. Eksik ilişkiler dosyada belirtiliyor.' : 'Kişisel evrak kopyası indirildi.');
        } catch (error) {
            message(error.message);
        } finally {
            exportButton.disabled = false;
        }
    };
    window.registerSyncListener('ebysDocuments', () => {
        sessionActor = window.userAuth?.uid;
        syncAllowed = true;
        if (countScope) {
            const scope = window.isDbAdmin?.() ? 'Kurumun' : 'Kendi';
            countScope.textContent = scope + ' tüm evrak türlerindeki toplamlarını gösterir. Sayfa filtresi bu toplamları değiştirmez. Bir evrakın yeni sürümü toplamı artırmaz.';
        }
        subscribe();
        return () => { syncAllowed = false; sessionActor = null; stop(); clear(); };
    });
    // index.html'de sekme geçişi window.switchTab ile .tab-content üzerindeki 'active' sınıfını değiştirir (AdminTabs yalnız
    // admin.html'de tetiklenir); panel üzerindeki style/class değişimini izleyip sekmeye göre akışı başlat/durdur.
    if (panel) new MutationObserver(() => { if (registryVisible()) { if (!unsubscribe) subscribe(); } else { stop(); clear(); } })
        .observe(panel, { attributes: true, attributeFilter: ['style', 'class'] });
    window.AppModules.AdminTabs?.onAny(tab => { if (tab === 'purchaseTab') {if(!unsubscribe)subscribe();} else { stop(); clear(); } });
    document.addEventListener('visibilitychange',()=>{
        if(!syncAllowed)return;
        if(sessionActor!==window.userAuth?.uid){syncAllowed=false;stop();clear();return;}
        if(document.hidden){pauseEditors();stop(false);rows=[];document.getElementById('ebysDocumentRows')?.replaceChildren();}
        else if(registryVisible()){if(!unsubscribe)subscribe();resumeEditors();}
    });
    window.addEventListener('onAppLogout', () => { syncAllowed=false;stop();clear(); });
    window.addEventListener('onInventoryDataUpdated', e => { if (e.detail?.collection === 'units') render(); });
}
window.AppModules.EBYSDocumentsUI={open};
