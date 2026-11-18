import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { open, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = 'inventory_demo';
const MAX_DOCUMENTS = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const PAGE_SIZE = 50;
const legacyFormat = 'ebys-emulator-recovery-v1', purchaseFormat = 'ebys-emulator-recovery-v2';
const purchaseCollections = ['purchaseOrders', 'purchaseFinance'];
const window = { AppModules: {} };
const sandbox = vm.createContext({ window, TextEncoder, crypto: webcrypto });
for (const file of ['purchase-money.js', 'ebys-document-schema.js', 'ebys-purchase-schema.js',
    'ebys-catalog-schema.js', 'ebys-correspondence-schema.js']) {
    vm.runInContext(readFileSync(new URL('../src/utils/' + file, import.meta.url), 'utf8'), sandbox, { filename: file });
}
const purchaseSchema = window.AppModules.EBYSPurchaseSchema;
const catalogSchema = window.AppModules.EBYSCatalogSchema;
const correspondenceSchema = window.AppModules.EBYSCorrespondenceSchema;
const contextFields = {
    units: ['id', 'name', 'active', 'parentUnitId', 'organizationId', 'code'],
    personel: ['id', 'name', 'uid', 'pri', 'unitId', 'active'],
    staffAccounts: ['personelId', 'pri'],
    accessGate: ['staffAccessEnabled']
};
export const recoveryCollections = Object.freeze([
    ...Object.keys(contextFields),
    'ebysDocuments', 'ebysDrafts', 'ebysVersions', 'ebysRegistrationIds',
    'ebysOperations', 'ebysEvents', 'ebysProcesses', 'ebysTasks',
    'ebysProcessOperations', 'ebysProcessEvents', 'ebysRouteTemplates',
    'ebysExecutionPolicies', 'ebysExecutionJobs', 'ebysExecutionEvents',
    'ebysExecutionStockLinks', 'ebysNotifications', 'ebysVerifications', 'ebysVerificationTokens',
    'ebysOrganizations', 'ebysOrganizationRevisions', 'ebysFilePlans', 'ebysLetterTemplates', 'ebysLetterTemplateRevisions',
    'ebysReplyLinks', 'ebysIncomingKeys', 'ebysDispatches'
]);

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function demoProject(value) {
    return typeof value === 'string' && /^demo-[a-z0-9][a-z0-9-]{1,39}$/.test(value);
}

function segment(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
        value !== '.' && value !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(value);
}

function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const tokenPattern = /^[a-f0-9]{32}$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const readFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, readValue(value)]));

// Validate the REST wire types before comparing links. Restore writes the original wire values.
function readValue(value) {
    check(isMap(value) && Object.keys(value).length === 1, 'Geçersiz Firestore alanı.');
    const [type, data] = Object.entries(value)[0];
    switch (type) {
        case 'nullValue': check(data === null, 'Geçersiz null alanı.'); return null;
        case 'stringValue': check(typeof data === 'string', 'Geçersiz metin.'); return data;
        case 'booleanValue': check(typeof data === 'boolean', 'Geçersiz mantık alanı.'); return data;
        case 'integerValue':
            check(typeof data === 'string' && /^-?\d{1,19}$/.test(data) &&
                BigInt(data) >= -(2n ** 63n) && BigInt(data) < 2n ** 63n, 'Geçersiz tamsayı.');
            return Number(data);
        case 'doubleValue': check(Number.isFinite(data), 'Geçersiz sayısal alan.'); return data;
        case 'timestampValue': check(timestamp(data), 'Geçersiz Firestore tarihi.'); return data;
        case 'arrayValue':
            check(isMap(data) && Object.keys(data).every(key => key === 'values') &&
                Array.isArray(data.values ?? []), 'Geçersiz Firestore dizisi.');
            return (data.values ?? []).map(readValue);
        case 'mapValue':
            check(isMap(data) && Object.keys(data).every(key => key === 'fields') &&
                isMap(data.fields ?? {}), 'Geçersiz Firestore haritası.');
            return readFields(data.fields ?? {});
        default: throw new Error('Desteklenmeyen Firestore alan türü: ' + type);
    }
}

function connector({ host, project, root }) {
    check(typeof host === 'string' && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(host) &&
        Number(host.split(':')[1]) <= 65535, 'Açık bir 127.0.0.1 emülatör portu gerekli.');
    check(demoProject(project), 'Yalnız demo- proje kimliği kullanılabilir.');
    check(root === ROOT, 'Yalnız inventory_demo kökü kullanılabilir.');
    const prefix = 'projects/' + project + '/databases/(default)/documents';
    const url = 'http://' + host + '/v1/' + prefix;
    const stats = { requests: 0, documentsRead: 0, documentsWritten: 0 };
    async function request(path, body, missingAllowed = false) {
        stats.requests++;
        const response = await fetch(url + path, {
            method: body ? 'POST' : 'GET',
            headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'error', signal: AbortSignal.timeout(15000)
        });
        if (response.status === 404 && missingAllowed) return null;
        check(response.ok, 'Emülatör isteği başarısız. HTTP ' + response.status);
        return response.json();
    }
    return { prefix, request, stats };
}

async function scan(db, empty = false) {
    const rows = [];
    let size = 0;
    const append = row => {
        size += bytes(row);
        check(size <= MAX_BYTES, 'Kurtarma paketi boyut sınırını aşıyor.');
        rows.push(row);
        check(rows.length <= MAX_DOCUMENTS, 'Kurtarma prova sınırı ' + MAX_DOCUMENTS + ' belge.');
    };
    for (const collection of recoveryCollections) {
        let pageToken;
        const path = '/' + ROOT + '/' + collection + '/items';
        const fullPath = db.prefix + path + '/';
        do {
            const pageSize = empty ? 1 : Math.min(PAGE_SIZE, MAX_DOCUMENTS + 1 - rows.length);
            const params = new URLSearchParams({ pageSize: String(pageSize) });
            if (pageToken) params.set('pageToken', pageToken);
            const page = await db.request(path + '?' + params);
            for (const doc of page.documents ?? []) {
                db.stats.documentsRead++;
                check(!empty, 'Hedef dolu. Yazma iptal edildi.');
                check(doc.name.startsWith(fullPath) && segment(doc.name.slice(fullPath.length)), 'Kaynak belge yolu geçersiz.');
                const fields = Object.hasOwn(contextFields, collection)
                    ? Object.fromEntries(Object.entries(doc.fields ?? {}).filter(([key]) => contextFields[collection].includes(key)))
                    : doc.fields ?? {};
                append({ collection, id: doc.name.slice(fullPath.length), fields });
            }
            check(!page.nextPageToken || (page.documents?.length > 0 && page.nextPageToken !== pageToken), 'Emülatör sayfalaması ilerlemedi.');
            pageToken = page.nextPageToken;
        } while (pageToken);
    }
    if (!empty) {
        const references = [];
        for (const row of rows) {
            if (row.collection === 'ebysDocuments' && Object.hasOwn(row.fields, 'purchaseOrderId')) {
                check(/^[a-f0-9-]{36}$/.test(row.id), 'Satın alma evrak yolu geçersiz.');
                references.push({ collection: 'purchaseOrders', id: row.id, path: linkedPath('purchaseOrders', row.id) });
            }
            if (row.collection === 'ebysVersions' && readValue(row.fields.schemaVersion ?? { integerValue: '1' }) === 2) {
                const p = readValue(row.fields.documentId);
                references.push({ collection: 'purchaseFinance', id: row.id, path: linkedPath('purchaseFinance', row.id, p) });
            }
        }
        for (const row of references.sort((a, b) => a.path.localeCompare(b.path))) {
            const doc = await db.request('/' + row.path, undefined, true);
            if (doc === null) {
                check(row.collection === 'purchaseFinance', 'Bağlı satın alma işaretçisi eksik.');
                continue;
            }
            check(doc.name === db.prefix + '/' + row.path, 'Bağlı kayıt yolu geçersiz.');
            db.stats.documentsRead++;
            append({ ...row, fields: doc.fields });
        }
    }
    return rows;
}

function indexRows(rows, includePurchases) {
    check(Array.isArray(rows) && rows.length <= MAX_DOCUMENTS, 'Paket belge sınırı geçersiz.');
    const names = includePurchases ? [...recoveryCollections, ...purchaseCollections] : recoveryCollections;
    const index = new Map(names.map(name => [name, new Map()]));
    for (const row of rows) {
        check(isMap(row) && index.has(row.collection) && segment(row.id) && isMap(row.fields), 'Paket belge yolu geçersiz.');
        const records = index.get(row.collection);
        check(!records.has(row.id), 'Yinelenen belge veya token: ' + row.collection);
        if (Object.hasOwn(contextFields, row.collection)) {
            check(Object.keys(row.fields).every(key => contextFields[row.collection].includes(key)), 'Bağlamda kapsam dışı alan.');
        }
        const data = readFields(row.fields);
        if (purchaseCollections.includes(row.collection)) {
            check(row.path === linkedPath(row.collection, row.id, data.purchaseOrderId) && timestamp(row.fields.createdAt?.timestampValue),
                'Mali kayıt veya işaretçi yolu ve tarihi geçersiz.');
            if (row.collection === 'purchaseOrders') check(timestamp(row.fields.updatedAt?.timestampValue), 'İşaretçi tarihi geçersiz.');
        } else check(!Object.hasOwn(row, 'path'), 'Beklenmeyen belge yolu.');
        if (row.collection === 'ebysVersions' && data.schemaVersion === 2) {
            check(includePurchases && timestamp(row.fields.createdAt?.timestampValue), 'Satın alma sürüm tarihi veya kapsamı geçersiz.');
        }
        const id = Object.hasOwn(contextFields, row.collection) && typeof data.id === 'number' ? String(data.id) : data.id;
        check(id === undefined || id === row.id || (includePurchases && row.collection === 'units'), 'Belge kimliği alanıyla uyuşmuyor: ' + row.collection);
        records.set(row.id, data);
    }
    return index;
}

async function validateLinks(index) {
    const stock = new Set();
    const all = name => index.get(name);
    const requireRecord = (name, id) => {
        check(segment(id) && all(name).has(id), 'Eksik paket ilişkisi: ' + name);
        return all(name).get(id);
    };
    const head = id => requireRecord('ebysDocuments', id);
    const version = id => requireRecord('ebysVersions', id);
    const process = id => requireRecord('ebysProcesses', id);
    const job = id => requireRecord('ebysExecutionJobs', id);
    for (const [id, doc] of all('ebysDocuments')) {
        requireRecord('units', doc.unitId);
        requireRecord('ebysDrafts', id);
        if (doc.currentVersionId) {
            const current = version(doc.currentVersionId);
            check(current.documentId === id && current.versionNo === doc.versionNo, 'Güncel sürüm bağı geçersiz.');
        }
        if (doc.registrationNo) check(requireRecord('ebysRegistrationIds', doc.registrationNo).documentId === id, 'Kayıt numarası bağı geçersiz.');
        if (doc.verificationToken) check(requireRecord('ebysVerificationTokens', doc.verificationToken).documentId === id, 'QR rezervasyonu eşleşmiyor.');
    }
    for (const [id, draft] of all('ebysDrafts')) {
        const h = head(id);
        check(draft.documentId === id && h.ownerUid === draft.ownerUid &&
            Object.hasOwn(h, 'purchaseOrderId') === Object.hasOwn(draft, 'purchaseSnapshot'), 'Taslak bağı geçersiz.');
    }
    for (const [id, v] of all('ebysVersions')) {
        check(v.processId === id && head(v.documentId).ownerUid === v.ownerUid && timestamp(v.createdAt), 'Sürüm bağı veya tarihi geçersiz.');
        const h = head(v.documentId), linked = Object.hasOwn(h, 'purchaseOrderId');
        if (linked) {
            const context = { root: ROOT, purchaseOrderId: h.purchaseOrderId, versionId: id, ownerUid: h.ownerUid };
            const envelope = purchaseSchema.purchaseDigestEnvelope(context, { root: ROOT, pathId: id, data: { ...v, createdAt: { iso: v.createdAt } } });
            check(v.contentDigest === digest(envelope), 'Satın alma sürüm özeti uyuşmuyor.');
        } else {
            check((v.schemaVersion ?? 1) === 1 && !Object.hasOwn(v, 'purchaseSnapshot') && !Object.hasOwn(v, 'unitSnapshot') &&
                typeof v.content === 'string' && isMap(v.metadataSnapshot) && Array.isArray(v.attachments) &&
                v.contentDigest === digest({ content: v.content, metadata: v.metadataSnapshot, attachments: v.attachments }), 'Sürüm özeti uyuşmuyor.');
        }
    }
    for (const [id, registration] of all('ebysRegistrationIds')) {
        check(head(registration.documentId).registrationNo === id && timestamp(registration.createdAt), 'Kayıt numarası veya tarihi geçersiz.');
    }
    for (const [id, p] of all('ebysProcesses')) {
        const v = version(id);
        check(p.versionId === id && v.documentId === p.documentId && head(p.documentId).ownerUid === p.ownerUid &&
            (v.schemaVersion === 2 ? p.purchaseOrderId === v.documentId : !Object.hasOwn(p, 'purchaseOrderId')), 'Süreç sürümü geçersiz.');
    }
    for (const [id, task] of all('ebysTasks')) {
        const p = process(task.processId);
        check(id === task.processId + '__' + task.assigneeUid && task.versionId === p.versionId &&
            task.documentId === p.documentId && task.ownerUid === p.ownerUid, 'Görev sürümü geçersiz.');
        for (const decision of Object.values(task.decisionsByStep ?? {})) {
            check(decision.versionId === task.versionId && decision.actorUid === task.assigneeUid, 'Karar sürümü geçersiz.');
        }
    }
    function validateLog(operations, events, field, related) {
        for (const [id, operation] of all(operations)) {
            const event = requireRecord(events, id);
            related(operation[field]);
            check(event[field] === operation[field] && event.ownerUid === operation.ownerUid, 'Olay ve işlem bağı uyuşmuyor.');
        }
        for (const id of all(events).keys()) requireRecord(operations, id);
    }
    validateLog('ebysOperations', 'ebysEvents', 'documentId', head);
    validateLog('ebysProcessOperations', 'ebysProcessEvents', 'processId', process);
    for (const [id, entry] of all('ebysExecutionJobs')) {
        check(entry.processId === id && process(id).documentId === entry.documentId && entry.versionId === id, 'İcra bağı geçersiz.');
        requireRecord('units', entry.unitId);
        requireRecord('ebysExecutionPolicies', entry.policyId);
        if (entry.stockOperationId) check(requireRecord('ebysExecutionStockLinks', entry.stockOperationId).processId === id, 'İcra stok bağı geçersiz.');
    }
    for (const [id, link] of all('ebysExecutionStockLinks')) {
        check(link.operationId === id && segment(id), 'Stok işlemi bağı geçersiz.');
        job(link.processId);
        stock.add(id);
    }
    for (const event of all('ebysExecutionEvents').values()) job(event.processId);
    for (const entry of all('ebysNotifications').values()) {
        const execution = job(entry.processId);
        check(execution.documentId === entry.documentId && execution.ownerUid === entry.recipientUid, 'Bildirim bağı geçersiz.');
        requireRecord('ebysExecutionEvents', entry.eventId);
    }
    for (const mapping of all('staffAccounts').values()) requireRecord('personel', mapping.personelId);
    for (const [token, reservation] of all('ebysVerificationTokens')) {
        check(tokenPattern.test(token) && timestamp(reservation.createdAt), 'QR rezervasyon biçimi geçersiz.');
        const doc = head(reservation.documentId), v = version(reservation.versionId);
        const publicRecord = requireRecord('ebysVerifications', token);
        const registration = requireRecord('ebysRegistrationIds', doc.registrationNo);
        const summaries = { internal: 'Kurum içi yazışma', incoming: 'Kurum dışından gelen evrak', outgoing: 'Kurum dışına giden evrak' };
        check(doc.verificationToken === token && doc.currentVersionId === reservation.versionId &&
            v.documentId === reservation.documentId, 'QR belge/sürüm bağı geçersiz.');
        check(Object.keys(publicRecord).length === 5 && publicRecord.registrationNo === doc.registrationNo &&
            publicRecord.registeredAt === registration.createdAt && publicRecord.contentDigest === v.contentDigest &&
            publicRecord.subjectSummary === summaries[doc.kind], 'Kamusal QR projeksiyonu geçersiz.');
        const status = reservation.revokedAt === null ? (doc.state === 'archived' ? 'archived' : 'valid') : 'revoked';
        check(['closed', 'archived'].includes(doc.state) && publicRecord.status === status &&
            (status === 'revoked' ? timestamp(reservation.revokedAt) && segment(reservation.revokedBy) : reservation.revokedBy === ''),
        'QR durum veya iptal tarihi geçersiz.');
    }
    for (const token of all('ebysVerifications').keys()) requireRecord('ebysVerificationTokens', token);
    validateCatalog(index, requireRecord);
    await validateCorrespondence(index, requireRecord, head, version);
    return [...stock].sort();
}

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const revisionNo = value => Number.isSafeInteger(value) && value >= 1;
const valid = (normalize, value) => {
    try {
        normalize(value);
        return true;
    } catch {
        return false;
    }
};
const sameFields = (a, b, fields) => isMap(a) && isMap(b) && fields.every(field => a[field] === b[field]);

// H6b: kurum tanımları kendi revizyon geçmişiyle, evrak kopyaları bu geçmişle tutarlı olmalıdır (firestore.rules ec*).
function validateCatalog(index, requireRecord) {
    const all = name => index.get(name);
    const fields = catalogSchema.PROFILE_FIELDS;
    for (const [id, org] of all('ebysOrganizations')) {
        check(id === catalogSchema.PROFILE_ID && timestamp(org.updatedAt) && revisionNo(org.revision) &&
            valid(catalogSchema.normalizeProfile, org), 'Kurum künyesi geçersiz.');
        for (let r = 1; r <= org.revision; r++) requireRecord('ebysOrganizationRevisions', String(r));
    }
    for (const [id, rev] of all('ebysOrganizationRevisions')) {
        check(revisionNo(rev.revision) && id === String(rev.revision) && timestamp(rev.createdAt) &&
            valid(catalogSchema.normalizeProfile, rev.profile), 'Kurum künyesi revizyonu geçersiz.');
        const primary = requireRecord('ebysOrganizations', catalogSchema.PROFILE_ID);
        check(primary.revision >= rev.revision && (rev.revision !== primary.revision || sameFields(rev.profile, primary, fields)),
            'Kurum künyesi revizyonu güncel künyeyle uyuşmuyor.');
    }
    for (const [id, plan] of all('ebysFilePlans')) {
        check(id === plan.code && timestamp(plan.createdAt) && timestamp(plan.updatedAt) && revisionNo(plan.revision) &&
            valid(catalogSchema.normalizeFilePlan, plan), 'Dosya planı geçersiz.');
    }
    for (const [id, tpl] of all('ebysLetterTemplates')) {
        check(uuidPattern.test(id) && id === tpl.id && timestamp(tpl.createdAt) && timestamp(tpl.updatedAt) &&
            revisionNo(tpl.currentRevision) && revisionNo(tpl.revision), 'Üst yazı şablonu geçersiz.');
        for (let r = 1; r <= tpl.currentRevision; r++) {
            const rev = requireRecord('ebysLetterTemplateRevisions', catalogSchema.revisionId(id, r));
            check(r !== tpl.currentRevision || rev.name === tpl.name, 'Şablonun güncel sürüm adı uyuşmuyor.');
        }
    }
    for (const [id, rev] of all('ebysLetterTemplateRevisions')) {
        check(uuidPattern.test(rev.templateId ?? '') && revisionNo(rev.revision) && id === catalogSchema.revisionId(rev.templateId, rev.revision) &&
            timestamp(rev.createdAt) && valid(catalogSchema.normalizeTemplate, rev), 'Şablon sürümü geçersiz.');
        check(requireRecord('ebysLetterTemplates', rev.templateId).currentRevision >= rev.revision, 'Şablon sürümü üst şablonu aşıyor.');
    }
    const copies = (record, metadata, versioned) => {
        const snapshot = record.institutionSnapshot;
        if (snapshot !== undefined) {
            check(isMap(snapshot) && Number.isSafeInteger(snapshot.revision), 'Evrakın künye kopyası geçersiz.');
            const rev = requireRecord('ebysOrganizationRevisions', String(snapshot.revision));
            check(sameFields(snapshot, rev.profile, fields), 'Evrakın künye kopyası revizyonla uyuşmuyor.');
        }
        const template = record.letterTemplate;
        if (template !== undefined) {
            check(isMap(template) && Number.isSafeInteger(template.revision), 'Evrakın şablon bağı geçersiz.');
            const rev = requireRecord('ebysLetterTemplateRevisions', catalogSchema.revisionId(template.templateId, template.revision));
            check(rev.name === template.name, 'Evrakın şablon bağı sürümle uyuşmuyor.');
        }
        if (metadata?.filePlanTitle) {
            const plan = requireRecord('ebysFilePlans', metadata.filePlanCode);
            check(valid(catalogSchema.normalizeFilePlan, { code: metadata.filePlanCode, title: metadata.filePlanTitle }),
                'Sürümün dosya planı adı geçersiz.');
            // Plan güncellenmemişse (revision === 1) sürümdeki ad katalogla birebir aynı olmalı; plan sonradan güncellendiyse
            // (revision > 1) sürümün tarihsel plan adı zaten contentDigest ile mühürlüdür.
            check(!versioned || plan.revision > 1 || plan.title === metadata.filePlanTitle, 'Sürümün dosya planı katalogla uyuşmuyor.');
        }
    };
    for (const draft of all('ebysDrafts').values()) copies(draft, draft.metadata, false);
    for (const v of all('ebysVersions').values()) {
        if ((v.schemaVersion ?? 1) === 1) copies(v, v.metadataSnapshot, true);
    }
}

// H7: cevap bağı, gelen evrak anahtarı ve gönderim kaydı bağlı evrak/sürümle tutarlı olmalıdır (firestore.rules ebys*Ok).
async function validateCorrespondence(index, requireRecord, head, version) {
    const all = name => index.get(name);
    for (const [id, link] of all('ebysReplyLinks')) {
        check(timestamp(link.createdAt) && valid(correspondenceSchema.normalizeReplyLink, link) && id === link.replyDocumentId,
            'Cevap bağı geçersiz.');
        const replyHead = head(link.replyDocumentId), targetHead = head(link.replyToDocumentId);
        check(['outgoing', 'internal'].includes(replyHead.kind) && replyHead.ownerUid === link.replyOwnerUid, 'Cevap evrakı bağı geçersiz.');
        check(targetHead.kind === 'incoming' && targetHead.ownerUid === link.replyToOwnerUid &&
            Boolean(targetHead.registrationNo) && Boolean(targetHead.currentVersionId), 'Cevaplanan gelen evrak bağı geçersiz.');
        const target = version(link.replyToVersionId), meta = target.metadataSnapshot ?? {};
        check(target.documentId === link.replyToDocumentId && canonical(link.replyToSummary) === canonical({
            registrationNo: targetHead.registrationNo, externalRegistrationNo: meta.externalRegistrationNo || '',
            date: meta.date, correspondent: meta.correspondent, subject: meta.subject
        }), 'Cevap bağının İlgi özeti hedef sürümle uyuşmuyor.');
    }
    const versionsByDocument = new Map();
    for (const v of all('ebysVersions').values()) {
        if (!versionsByDocument.has(v.documentId)) versionsByDocument.set(v.documentId, []);
        versionsByDocument.get(v.documentId).push(v.metadataSnapshot);
    }
    for (const [key, rec] of all('ebysIncomingKeys')) {
        check(/^[a-f0-9]{64}$/.test(key) && rec.id === key && timestamp(rec.createdAt), 'Gelen evrak anahtarı biçimi geçersiz.');
        const inHead = head(rec.documentId);
        check(inHead.kind === 'incoming' && inHead.ownerUid === rec.ownerUid && inHead.unitId === rec.unitId &&
            Boolean(rec.registrationNo) && inHead.registrationNo === rec.registrationNo, 'Gelen evrak anahtarı evrakla uyuşmuyor.');
        const sources = [all('ebysDrafts').get(rec.documentId)?.metadata, ...(versionsByDocument.get(rec.documentId) ?? [])];
        let matched = false;
        for (const meta of sources) {
            if (isMap(meta) && await correspondenceSchema.incomingDuplicateKey(meta) === key) {
                matched = true;
                break;
            }
        }
        check(matched, 'Gelen evrak anahtarı evrakın üstverisinden üretilmemiş.');
    }
    for (const [id, d] of all('ebysDispatches')) {
        check(timestamp(d.createdAt) && d.id === id &&
            valid(input => correspondenceSchema.normalizeDispatch(input, d.createdAt.slice(0, 10)), d), 'Gönderim kaydı geçersiz.');
        const outHead = head(d.documentId);
        check(outHead.kind === 'outgoing' && outHead.ownerUid === d.ownerUid && Boolean(outHead.registrationNo) &&
            ['internally_approved', 'closed', 'archived'].includes(outHead.state), 'Gönderim kaydının evrakı geçersiz.');
        check(version(d.versionId).documentId === d.documentId, 'Gönderim kaydının sürüm bağı geçersiz.');
    }
}

function linkedPath(collection, id, purchaseOrderId) {
    return collection === 'purchaseOrders' ? ROOT + '/purchaseOrders/items/' + id
        : purchaseSchema.financePath({ root: ROOT, purchaseOrderId, versionId: id });
}

function purchaseRecovery(index) {
    const markers = index.get('purchaseOrders'), finances = index.get('purchaseFinance');
    const heads = index.get('ebysDocuments'), drafts = index.get('ebysDrafts'), versions = index.get('ebysVersions');
    const processes = index.get('ebysProcesses'), operations = index.get('ebysProcessOperations');
    const linkedHeads = [...heads].filter(([, head]) => Object.hasOwn(head, 'purchaseOrderId'));
    if (!linkedHeads.length) {
        check(!markers?.size && !finances?.size, 'Bağsız satın alma veya mali kayıt.');
        return null;
    }
    check(markers && finances && linkedHeads.length === markers.size, 'Satın alma işaretçisi kapsamı eksik.');
    const entries = [];
    const add = (collection, id, status, purchaseOrderId) => entries.push({
        path: linkedPath(collection, id, purchaseOrderId), engineVersion: 'ebys-v1', schemaVersion: 2, status
    });
    for (const [id, head] of linkedHeads) {
        const marker = markers.get(id), draft = drafts.get(id);
        check(marker && draft && draft.revision === marker.revision, 'Satın alma işaretçisi veya taslak revizyonu eksik.');
        const context = { root: ROOT, purchaseOrderId: id, ownerUid: head.ownerUid };
        purchaseSchema.validatePurchaseLinks(context, {
            marker: { root: ROOT, pathId: id, data: { ...marker, createdAt: { iso: marker.createdAt }, updatedAt: { iso: marker.updatedAt } } },
            document: { root: ROOT, pathId: id, data: head }
        });
        check(canonical(purchaseSchema.normalizePurchaseSnapshot(id, draft.purchaseSnapshot)) === canonical(draft.purchaseSnapshot),
            'Taslak teklif toplamları geçersiz.');
        add('purchaseOrders', id, 'included');
    }

    const firstDecisions = new Map();
    for (const task of index.get('ebysTasks').values()) {
        const decision = task.decisionsByStep?.['0'];
        if (decision?.result !== 'approved') continue;
        check(!firstDecisions.has(task.versionId), 'Birden çok ilk olumlu karar.');
        firstDecisions.set(task.versionId, decision);
    }
    let expectedFinances = 0;
    for (const [id, v] of versions) {
        if (v.schemaVersion !== 2) continue;
        const p = processes.get(id), orderId = v.documentId;
        const financial = finances.get(id), decision = firstDecisions.get(id);
        const advanced = p && (p.currentStep > 0 || p.state === 'completed');
        check(Boolean(decision) === Boolean(advanced), 'İlk olumlu karar geçmişi eksik veya tutarsız.');
        check(Boolean(financial) === Boolean(decision), 'İlk olumlu kararın mali kayıt kapsamı geçersiz.');
        if (financial) {
            expectedFinances++;
            const operation = operations.get(financial.operationId);
            check(p && operation && operation.command === 'decide' && operation.processId === id &&
                operation.ownerUid === v.ownerUid && operation.actorUid === decision.actorUid && operation.result?.processId === id &&
                Number.isSafeInteger(operation.result.revision) && operation.result.revision >= 2 && operation.result.revision <= p.revision &&
                financial.actorUid === decision.actorUid && financial.createdAt === decision.decidedAt &&
                operation.createdAt === decision.decidedAt, 'Mali kayıt, ilk karar ve işlem bağı geçersiz.');
            const context = { root: ROOT, purchaseOrderId: orderId, versionId: id, ownerUid: v.ownerUid };
            const ref = { root: ROOT, pathId: id, data: { ...v, createdAt: { iso: v.createdAt } } };
            purchaseSchema.normalizeFinance(context, ref, { ...financial, createdAt: { iso: financial.createdAt } });
        }
        add('purchaseFinance', id, financial ? 'included' : 'not-created', orderId);
    }
    check(finances.size === expectedFinances, 'Sürümsüz veya çapraz mali kayıt.');
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { entries, referenced: entries.length, included: markers.size + expectedFinances,
        notCreated: entries.length - markers.size - expectedFinances, missing: 0 };
}


const counts = index => Object.fromEntries([...index].map(([name, docs]) => [name, docs.size]));
const bytes = value => Buffer.byteLength(JSON.stringify(value));

async function stockDigests(db, ids) {
    const pairs = [];
    for (const id of ids) {
        const doc = await db.request('/' + ROOT + '/stockOperations/items/' + encodeURIComponent(id), undefined, true);
        check(doc, 'Stok dayanağı eksik. İşlem durduruldu.');
        db.stats.documentsRead++;
        pairs.push([id, digest(doc.fields)]);
    }
    return Object.fromEntries(pairs);
}

export async function captureRecovery(options) {
    const db = connector(options);
    check(options.quiescent === true, 'Kaynak yazmaları durdurulduktan sonra prova başlatılmalı.');
    const first = await scan(db);
    const index = indexRows(first, first.some(row => row.collection === 'purchaseOrders'));
    const stockIds = await validateLinks(index);
    const purchases = purchaseRecovery(index);
    const stockRequirements = await stockDigests(db, stockIds);
    const second = await scan(db);
    check(digest(first) === digest(second) && digest(stockRequirements) === digest(await stockDigests(db, stockIds)),
        'Kaynak taramalar arasında değişti. Paket oluşturulmadı.');
    const payload = {
        format: purchases ? purchaseFormat : legacyFormat, sourceProject: options.project, root: ROOT,
        consistency: 'operator-quiescence-and-two-matching-scans', exportedAt: new Date().toISOString(),
        excluded: ['firebase-auth', 'attachment-bytes', 'stock-operations'], counts: counts(index),
        ...(purchases ? { purchaseManifest: purchases } : {}), stockRequirements, rows: first
    };
    const bundle = { ...payload, digest: digest(payload) };
    check(bytes(bundle) <= MAX_BYTES, 'Kurtarma paketi boyut sınırını aşıyor.');
    return { bundle, stats: db.stats };
}

export async function restoreRecovery(options, bundle) {
    const db = connector(options);
    check(isMap(bundle) && bytes(bundle) <= MAX_BYTES, 'Kurtarma paketi biçimi veya boyutu geçersiz.');
    const { digest: expected, ...payload } = bundle;
    check([legacyFormat, purchaseFormat].includes(payload.format) && demoProject(payload.sourceProject) &&
        payload.sourceProject !== options.project && payload.root === ROOT, 'Kaynak ve hedef ayrı demo projeleri olmalı.');
    check(payload.consistency === 'operator-quiescence-and-two-matching-scans' && timestamp(payload.exportedAt) &&
        expected === digest(payload), 'Paket özeti veya manifestosu doğrulanamadı.');
    const index = indexRows(payload.rows, payload.format === purchaseFormat);
    const stockIds = await validateLinks(index);
    const purchases = purchaseRecovery(index);
    check(purchases ? payload.format === purchaseFormat && canonical(purchases) === canonical(payload.purchaseManifest)
        : payload.format === legacyFormat && !Object.hasOwn(payload, 'purchaseManifest'), 'Satın alma kurtarma manifestosu uyuşmuyor.');
    check(canonical(counts(index)) === canonical(payload.counts), 'Paket belge sayıları uyuşmuyor.');
    check(isMap(payload.stockRequirements) && canonical(Object.keys(payload.stockRequirements).sort()) === canonical(stockIds),
        'Stok dayanağı manifestosu eksik.');
    await scan(db, true);
    for (const entry of purchases?.entries ?? []) {
        check(await db.request('/' + entry.path, undefined, true) === null, 'Hedefte bağlı satın alma kaydı var.');
    }
    check(digest(await stockDigests(db, stockIds)) === digest(payload.stockRequirements), 'Hedefte stok dayanağı uyuşmuyor.');
    if (options.apply !== true) return { applied: false, documents: payload.rows.length, stats: db.stats };
    check(options.quiescent === true && payload.rows.length > 0, 'Yazma için durgun ve boş hedef ile dolu paket gerekli.');
    const writes = payload.rows.map(row => ({
        update: { name: db.prefix + '/' + (row.path ?? (ROOT + '/' + row.collection + '/items/' + row.id)), fields: row.fields },
        currentDocument: { exists: false }
    }));
    check(bytes({ writes }) <= MAX_BYTES, 'Atomik yazma boyut sınırını aşıyor.');
    try {
        const result = await db.request(':commit', { writes });
        check(result.writeResults?.length === writes.length, 'Yazma yanıtı eksik.');
        db.stats.documentsWritten = writes.length;
    } catch (error) {
        throw new Error('Yazma sonucu doğrulanamadı. Yeniden uygulamadan önce hedefi inceleyin. ' + error.message, { cause: error });
    }
    const restored = await scan(db);
    check(digest(restored) === digest(payload.rows), 'Yazma sonrası doğrulama başarısız. Hedefi inceleyin.');
    return { applied: true, documents: writes.length, stats: db.stats };
}

async function main([mode, host, project, root, file, ...flags]) {
    check(['capture', 'restore'].includes(mode) && file && flags.every(flag => ['--quiescent', '--apply'].includes(flag)) &&
        !(mode === 'capture' && flags.includes('--apply')), 'Kullanım: capture|restore HOST PROJE inventory_demo DOSYA [--quiescent] [--apply]');
    const options = { host, project, root, quiescent: flags.includes('--quiescent'), apply: flags.includes('--apply') };
    if (mode === 'capture') {
        const { bundle, stats } = await captureRecovery(options);
        await writeFile(file, JSON.stringify(bundle), { flag: 'wx' });
        console.log(JSON.stringify({ documents: bundle.rows.length, stats }));
        return;
    }
    const handle = await open(file, 'r');
    let bundle;
    try {
        check((await handle.stat()).size <= MAX_BYTES, 'Kurtarma dosyası boyut sınırını aşıyor.');
        bundle = JSON.parse(await handle.readFile('utf8'));
    } finally {
        await handle.close();
    }
    console.log(JSON.stringify(await restoreRecovery(options, bundle)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
