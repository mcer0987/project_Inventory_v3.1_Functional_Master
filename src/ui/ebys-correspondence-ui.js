// [WHY]: v3.4 EBYS H7 · Gelen–cevap bağı (D2), gelen evrak mükerrerlik uyarısı (D3) ve giden evrak manuel
//        gönderim paneli (D4) hem Evraklarım hem Yönetim ekranındaki tek evrak penceresinde ortak çizilir.
// [HOW]: Tüm DOM üretimi güvenli document.createElement/textContent ile yapılır (innerHTML yok). Modül yalnız
//        src/services/ebys-correspondence-service.js ve src/services/ebys-execution-service.js üzerinden okur/yazar.
import '../utils/ebys-correspondence-schema.js';
import '../services/ebys-correspondence-service.js';
import '../services/ebys-execution-service.js';

const Schema = () => window.AppModules.EBYSCorrespondenceSchema;
const Service = () => window.AppModules.EBYSCorrespondence;
const Execution = () => window.AppModules.EBYSExecution;

const node = (tag, text, css) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (css) n.className = css;
    return n;
};
const button = (text, action, css = 'btn btn-sm btn-outline-primary') => {
    const b = node('button', text, css);
    b.type = 'button';
    b.onclick = action;
    return b;
};
const panel = (title, lead) => {
    const section = node('section', null, 'ebys-process-panel');
    section.append(node('h4', title));
    if (lead) section.append(node('p', lead, 'small text-muted'));
    return section;
};

// [WHY]: D2 — Gelen evraka cevap yalnız kesin kayıt numaralı ve dondurulmuş sürüm üzerinden bağlanabilir
//        (firestore.rules ebysReplyLinkOk ile aynı koşul); aksi halde bağ denemesi sunucuda reddedilir.
export function startReplyFromIncoming(head, body) {
    if (!head || head.kind !== 'incoming' || !head.registrationNo || !head.currentVersionId) {
        window.showAppAlert?.('Cevap yazısı bağlamak için gelen evrakın önce kesin kayıt numarası alması ve dondurulması gerekir.');
        return;
    }
    try {
        const meta = body?.metadataSnapshot || body?.metadata || {};
        const summary = Schema().normalizeReplySummary({
            registrationNo: head.registrationNo,
            externalRegistrationNo: meta.externalRegistrationNo || '',
            date: meta.date,
            correspondent: meta.correspondent,
            subject: meta.subject
        });
        window.AppModules.EBYSDocumentsUI.openReplyDraft({
            replyToDocumentId: head.id, replyToVersionId: head.currentVersionId, unitId: head.unitId, summary
        });
    } catch (error) {
        window.showAppAlert?.(error.message);
    }
}

// [WHY]: D3 — Mükerrer uyarısı görünür olmalı ve onay kutusu işaretlenmeden forma gönderilmeye izin verilmemeli.
// [HOW]: Uyarı kutusu bir native "required" onay kutusu taşır; evrak formundaki mevcut form.reportValidity()
//        çağrısı (kaydet/dondur öncesi) bu kutu işaretlenmeden geçmez — ek bir kapı mekanizması gerekmez.
export function bindIncomingDuplicateGuard(form, head) {
    const box = node('div', null, 'ebys-field ebys-wide');
    box.hidden = true;
    const warning = node('p', '', 'small text-danger fw-bold');
    warning.setAttribute('role', 'alert');
    const ackLabel = node('label', null, 'small');
    const ack = node('input'); ack.type = 'checkbox';
    ackLabel.append(ack, document.createTextNode(' Mükerrer olabileceğini kontrol ettim, yine de kaydet'));
    box.append(warning, ackLabel);
    form.append(box);

    let generation = 0;
    async function check() {
        const correspondent = form.elements.correspondent?.value || '';
        const externalRegistrationNo = form.elements.externalRegistrationNo?.value || '';
        const date = form.elements.date?.value || '';
        const revision = ++generation;
        if (!correspondent.trim() || !externalRegistrationNo.trim() || !date.trim()) {
            box.hidden = true; ack.checked = false; ack.required = false;
            return;
        }
        try {
            const result = await Service().checkIncomingDuplicate({ correspondent, externalRegistrationNo, date, excludeDocumentId: head.id });
            if (revision !== generation || !form.isConnected) return;
            if (result.duplicate) {
                const unit = (window.data?.units || []).find(u => String(u.id) === result.record.unitId);
                const createdAt = result.record.createdAt?.toDate?.().toLocaleString('tr-TR') || '—';
                warning.textContent = `Aynı kurum / dış sayı / tarih ile kayıt var · Kayıt No: ${result.record.registrationNo} · `
                    + `Birim: ${unit?.name || result.record.unitId} · Kayıt tarihi: ${createdAt}. İçerik, konu ve kişi bilgisi gizlidir.`;
                box.hidden = false; ack.required = true;
            } else {
                box.hidden = true; ack.checked = false; ack.required = false;
            }
        } catch (error) {
            if (revision !== generation || !form.isConnected) return;
            warning.textContent = 'Mükerrerlik kontrolü yapılamadı: ' + error.message;
            box.hidden = false; ack.required = false;
        }
    }
    for (const name of ['correspondent', 'externalRegistrationNo', 'date']) {
        form.elements[name]?.addEventListener('change', check);
    }
    check();
}

function selectField(label, options, value = '') {
    const wrap = node('label', label, 'ebys-field');
    const select = node('select', null, 'form-select');
    for (const [v, title] of options) { const opt = node('option', title); opt.value = v; select.append(opt); }
    select.value = value;
    wrap.append(select);
    return { wrap, input: select };
}
function textFieldLocal(label, max, required, multiline = false, type = null) {
    const wrap = node('label', label, 'ebys-field');
    const input = node(multiline ? 'textarea' : 'input', null, 'form-control');
    input.required = required;
    input.maxLength = max;
    if (multiline) input.rows = 2;
    if (type) input.type = type;
    wrap.append(input);
    return { wrap, input };
}

// [WHY]: D4 — Yazma yetkisi evrak sahibi, yönetici veya evrakın güncel sürümüne bağlı aktif icra sorumlusudur
//        (firestore.rules ebysDispatchOk ile aynı koşul); bu yalnız formu gösterme kararıdır, gerçek yetki sunucuda denetlenir.
async function canWriteDispatch(head) {
    const actor = window.userAuth?.uid;
    if (!actor) return false;
    if (head.ownerUid === actor || window.isDbAdmin?.()) return true;
    if (!head.currentVersionId) return false;
    try {
        const job = await Execution().readExecutionJob(head.currentVersionId);
        return job?.assigneeUid === actor && ['pending_acceptance', 'in_progress'].includes(job.state);
    } catch {
        return false;
    }
}

function buildDispatchForm(head, onSaved) {
    const form = node('form');
    const today = new Date().toLocaleDateString('sv-SE');
    const channel = selectField('Gönderim kanalı', Object.entries(Schema().CHANNELS));
    const sentDate = textFieldLocal('Gönderim tarihi', 10, true, false, 'date');
    sentDate.input.value = today; sentDate.input.max = today;
    const externalRef = textFieldLocal('Dış referans / takip numarası', 120, true);
    const entryKind = selectField('Kayıt türü', [['initial', 'İlk/Tekrar Gönderim'], ['correction', 'Düzeltme Beyanı']]);
    const note = textFieldLocal('Not / gerekçe', 500, false, true);
    const updateNoteRequirement = () => { note.input.required = entryKind.input.value === 'correction'; };
    entryKind.input.addEventListener('change', updateNoteRequirement);
    updateNoteRequirement();
    form.append(channel.wrap, sentDate.wrap, externalRef.wrap, entryKind.wrap, note.wrap);
    const status = node('p', '', 'small'); status.setAttribute('role', 'status');
    const submitBtn = node('button', 'Gönderimi kaydet', 'btn btn-sm btn-primary'); submitBtn.type = 'submit';
    form.append(submitBtn, status);
    form.onsubmit = async event => {
        event.preventDefault();
        if (submitBtn.disabled || !form.reportValidity()) return;
        submitBtn.disabled = true; status.textContent = 'Kaydediliyor…';
        try {
            const record = await Service().recordDispatch({
                documentId: head.id, versionId: head.currentVersionId, channel: channel.input.value,
                sentDate: sentDate.input.value, externalRef: externalRef.input.value, note: note.input.value,
                entryKind: entryKind.input.value
            });
            status.textContent = 'Gönderim kaydedildi.';
            onSaved(record);
            externalRef.input.value = ''; note.input.value = ''; entryKind.input.value = 'initial'; updateNoteRequirement();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            submitBtn.disabled = false;
        }
    };
    return form;
}

async function mountDispatchPanel(wrap, head, container) {
    const section = panel('Gönderim Takibi', 'Bu giden evrakın dış kuruma manuel gönderim bilgilerini (kanal, tarih, referans) kaydeder ve geçmişini listeler.');
    section.append(node('p', 'Sistem e-posta/KEP göndermez; bu kayıt KEP delili değildir.', 'small text-danger fw-bold'));
    const status = node('p', 'Gönderim kayıtları yükleniyor…', 'small');
    status.setAttribute('role', 'status');
    const list = node('ul', null, 'list-unstyled mb-0');
    section.append(status, list);
    wrap.append(section);

    let current = [];
    const paint = () => {
        list.replaceChildren();
        status.textContent = current.length
            ? `Gönderildi (manuel kayıt) · ${Schema().CHANNELS[current[0].channel] || current[0].channel} · ${current[0].sentDate} · Ref: ${current[0].externalRef}`
            : 'Onaylandı · gönderim kaydı yok';
        for (const d of current) {
            const li = node('li', null, 'mb-1');
            const kindLabel = d.entryKind === 'correction' ? 'Düzeltme' : 'İlk/Tekrar Gönderim';
            li.append(node('div', `${kindLabel} · ${Schema().CHANNELS[d.channel] || d.channel} · ${d.sentDate} · Ref: ${d.externalRef}`));
            if (d.note) li.append(node('div', d.note, 'small text-muted'));
            list.append(li);
        }
    };

    try {
        current = await Service().listDispatches(head.id, head);
        if (!container.isConnected) return;
        paint();
    } catch (error) {
        if (!container.isConnected) return;
        status.textContent = 'Gönderim kayıtları okunamadı: ' + error.message;
        return;
    }

    let allowed = false;
    try { allowed = await canWriteDispatch(head); } catch { allowed = false; }
    if (!container.isConnected || !allowed) return;
    section.append(buildDispatchForm(head, record => { current = [record, ...current]; paint(); }));
}

function renderReplyContext(wrap, head, body, replyTo, replies, onOpenDocument) {
    if (replyTo) {
        const section = panel('İlgi (Bağlı Gelen Evrak)', 'Bu evrak, aşağıdaki gelen evraka cevap olarak hazırlanmıştır.');
        const s = replyTo.replyToSummary;
        section.append(node('p', `Kayıt No: ${s.registrationNo}${s.externalRegistrationNo ? ' · Dış Sayı: ' + s.externalRegistrationNo : ''} · Tarih: ${s.date}`));
        section.append(node('p', `Muhatap: ${s.correspondent}`));
        section.append(node('p', `Konu: ${s.subject}`));
        section.append(button('Gelen evrakı aç', () => onOpenDocument(replyTo.replyToDocumentId)));
        wrap.append(section);
    }
    if (head.kind === 'incoming') {
        const section = panel('Bu Evraka Yazılan Cevaplar', 'Bu gelen evraka karşılık hazırlanan cevap yazılarını listeler.');
        if (replies.length) {
            const list = node('ul', null, 'list-unstyled mb-0');
            for (const reply of replies) {
                const li = node('li', null, 'mb-1');
                const createdAt = reply.createdAt?.toDate?.().toLocaleString('tr-TR') || '—';
                li.append(node('span', `Cevap · ${createdAt} · `));
                li.append(button('Cevabı aç', () => onOpenDocument(reply.replyDocumentId), 'btn btn-sm btn-link p-0 align-baseline'));
                list.append(li);
            }
            section.append(list);
        } else section.append(node('p', 'Bu evraka henüz cevap yazılmadı.', 'small text-muted'));
        if (head.registrationNo && head.currentVersionId) {
            section.append(button('Cevap yazısı hazırla', () => startReplyFromIncoming(head, body)));
        }
        wrap.append(section);
    }
}

// [WHY]: D2+D4 — Evrak penceresinin altına tek çağrıyla eklenir; İlgi/Cevaplar ve (uygunsa) Gönderim Takibi
//        bölümleri tek getReplyContext okumasıyla ve ayrı bir listDispatches okumasıyla doldurulur.
export function mountDocumentPanel(container, head, body, onOpenDocument) {
    const wrap = node('div', null, 'ebys-wide mt-3');
    container.append(wrap);

    (async () => {
        const status = node('p', 'İlgi ve cevap bilgisi yükleniyor…', 'small text-muted');
        wrap.append(status);
        try {
            const { replyTo, replies } = await Service().getReplyContext(head.id, head);
            if (!container.isConnected) return;
            status.remove();
            renderReplyContext(wrap, head, body, replyTo, replies, onOpenDocument);
        } catch (error) {
            if (!container.isConnected) return;
            status.textContent = 'İlgi ve cevap bilgisi okunamadı: ' + error.message;
        }

        if (head.kind === 'outgoing' && head.registrationNo && ['internally_approved', 'closed', 'archived'].includes(head.state)) {
            await mountDispatchPanel(wrap, head, container);
        }
    })();
}

window.AppModules = window.AppModules || {};
window.AppModules.EBYSCorrespondenceUI = { mountDocumentPanel, startReplyFromIncoming, bindIncomingDuplicateGuard };
