import { doc, collection, query, where, orderBy, limit, startAfter, getDocFromServer, getDocs, runTransaction, serverTimestamp, Timestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';
import './ebys-execution-service.js';
import '../utils/ebys-document-schema.js';
import '../utils/ebys-process-schema.js';
import '../utils/ebys-purchase-schema.js';
const S = () => window.AppModules.EBYSDocumentSchema;
const P = () => window.AppModules.EBYSProcessSchema;
const purchase = () => window.AppModules.EBYSPurchaseSchema;
const uid = () => { if (!window.userAuth?.uid) throw new Error('Oturum gerekli.'); return window.userAuth.uid; };
const ref = (c, id) => doc(fireDb, window.AppEnv.COLLECTION_ROOT, c, 'items', id);
const taskId = (id, who) => `${id}__${who}`;
const check = (p, expected) => { if (!p || p.revision !== expected) throw new Error('Süreç değişti; yeniden açın.'); };
function task(p, step, assigneeUid, old = null, validUntil = null) {
    const now = Date.now();
    return { id: taskId(p.id, assigneeUid), processId: p.id, versionId: p.id, documentId: p.documentId, ownerUid: p.ownerUid,
        assigneeUid, principalUid: step.assigneeUid, stepIndex: p.currentStep, stepId: step.stepId, kind: step.kind, state: 'active',
        decisionsByStep: old?.decisionsByStep || {}, hasDecision: old?.hasDecision || false, revision: (old?.revision || 0) + 1,
        createdAt: old?.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), validFrom: serverTimestamp(),
        ...(validUntil ? { validUntil } : { validUntil: null, validForSeconds: P().TASK_VALID_FOR_SECONDS }),
        dueAt: Timestamp.fromMillis(now + step.dueHours * 3600000) };
}
async function person(tx, id, ownerUid) {
    const snap = await tx.get(ref('personel', id));
    const p = snap.data();
    if (!p || p.active === false || !p.uid || p.uid === ownerUid) throw new Error('Pasif, hesapsız veya belge sahibi kişi göreve atanamaz.');
    return p;
}
function processSession() {
    const actorUid = uid(), root = window.AppEnv.COLLECTION_ROOT;
    const assertCurrent = () => {
        if (actorUid !== window.userAuth?.uid || root !== window.AppEnv.COLLECTION_ROOT) throw new Error('Oturum veya ortam değişti.');
    };
    return { actorUid, root, assertCurrent };
}

async function purchaseVersion(session, purchaseOrderId, snapshot, versionId, expectedOwner) {
    session.assertCurrent();
    const data = snapshot.data();
    if (!data || (expectedOwner !== undefined && data.ownerUid !== expectedOwner)) throw new Error('Bağlı satın alma sürümü bulunamadı.');
    const context = { root: session.root, purchaseOrderId, versionId, ownerUid: data.ownerUid };
    const version = { root: session.root, pathId: snapshot.id, data };
    const digest = await purchase().digestPurchaseVersion(context, version);
    session.assertCurrent();
    if (digest !== data.contentDigest) throw new Error('Satın alma sürüm özeti uyuşmuyor.');
    return { context, version };
}

function purchaseRateError(code, message) {
    return Object.assign(new Error(message), { code });
}
function observedRates(data) {
    return data ? { rates: data.rates, date: data.date, source: data.source } : null;
}
const tryOnly = proposal => proposal.items.every(item => item.currency === 'TRY');
function quotePurchase(proposal, source) {
    const money = window.AppModules.PurchaseMoney;
    if (tryOnly(proposal)) return {
        exchangeRate: { TRY: 1, USD: 1, EUR: 1 }, exchangeRateDate: new Date().toISOString().slice(0, 10),
        exchangeRateSource: 'TRY', reportingTotalTRY: money.calculate(proposal.items).totals.TRY.total
    };
    const quote = money.snapshotRates(proposal, source);
    money.scaled(quote.reportingTotalTRY, 2, 'TRY rapor toplamı');
    return quote;
}

export async function getPurchaseApprovalPreview({ purchaseOrderId, versionId }) {
    const session = processSession();
    purchase().financePath({ root: session.root, purchaseOrderId, versionId });
    const snapshot = await getDocFromServer(ref('ebysVersions', versionId));
    const { version } = await purchaseVersion(session, purchaseOrderId, snapshot, versionId);
    const proposal = version.data.purchaseSnapshot;
    const source = tryOnly(proposal) ? null : observedRates((await getDocFromServer(ref('system_config', 'ebys_rates'))).data());
    session.assertCurrent();
    if (!tryOnly(proposal) && purchase().compareRateSource(source, source) !== 'same') {
        throw purchaseRateError('purchase-rates-unavailable', 'Döviz kurları eksik veya geçersiz. Yöneticinizden kur ayarlarını kontrol etmesini isteyin.');
    }
    return { purchaseOrderId, versionId, rateSource: source, reportingTotalTRY: quotePurchase(proposal, source).reportingTotalTRY };
}

async function firstPurchaseFinance(tx, session, p, input, operationId) {
    if (!p.purchaseOrderId || !purchase().isFirstPositiveDecision(p.currentStep, input.result)) return null;
    session.assertCurrent();
    const financeRef = doc(fireDb, purchase().financePath({ root: session.root, purchaseOrderId: p.purchaseOrderId, versionId: p.id }));
    const [snapshot, prior] = await Promise.all([tx.get(ref('ebysVersions', p.id)), tx.get(financeRef)]);
    if (prior.exists()) throw new Error('İlk karar için mali kayıt zaten var. Süreç durumunu yeniden açın.');
    const { context, version } = await purchaseVersion(session, p.purchaseOrderId, snapshot, p.id, p.ownerUid);
    const proposal = version.data.purchaseSnapshot;
    let source = null;
    if (!tryOnly(proposal)) {
        source = observedRates((await tx.get(ref('system_config', 'ebys_rates'))).data());
        session.assertCurrent();
        if (purchase().compareRateSource(source, source) !== 'same') {
            throw purchaseRateError('purchase-rates-unavailable', 'Döviz kurları eksik veya geçersiz. Yöneticinizden kur ayarlarını kontrol etmesini isteyin.');
        }
        if (purchase().compareRateSource(input.fxPreview, source) !== 'same') {
            throw purchaseRateError('purchase-rates-changed', 'Tutar veya kur bilgisi değişti. Güncel tutarı inceleyip yeniden karar verin.');
        }
    }
    const data = purchase().normalizeFinance(context, version, {
        schemaVersion: 2, purchaseOrderId: p.purchaseOrderId, versionId: p.id, contentDigest: version.data.contentDigest,
        actorUid: session.actorUid, operationId, ...quotePurchase(proposal, source), createdAt: serverTimestamp()
    });
    return { ref: financeRef, data };
}


async function command(commandName, input, callback) {
    const session = processSession(), { actorUid, root } = session, operationId = input.operationId || S().uuid();
    const payloadDigest = await S().digest({ ...input, command: commandName, operationId: null });
    const opRef = doc(fireDb, root, 'ebysProcessOperations', 'items', operationId);
    const execute = () => runTransaction(fireDb, async tx => {
        session.assertCurrent();
        const op = await tx.get(opRef);
        session.assertCurrent();
        if (op.exists()) {
            const d = op.data();
            if (d.actorUid !== actorUid || d.command !== commandName || d.payloadDigest !== payloadDigest) throw new Error('İşlem anahtarı farklı içerikle kullanıldı.');
            return d.result;
        }
        const result = await callback(tx, operationId, actorUid, session);
        session.assertCurrent();
        tx.set(opRef, { id: operationId, processId: result.processId, actorUid, command: commandName, payloadDigest, result, ownerUid: result.ownerUid, createdAt: serverTimestamp() });
        tx.set(ref('ebysProcessEvents', operationId), { id: operationId, processId: result.processId, actorUid, command: commandName, ownerUid: result.ownerUid, revision: result.revision, reason: input.reason || '', createdAt: serverTimestamp() });
        return result;
    });
    try {
        const result = await execute();
        session.assertCurrent();
        return result;
    } catch (error) {
        session.assertCurrent();
        // Eşzamanlı aynı komutun ilk yazımı tamamlandıysa yalnız o doğrulanmış sonucu döndür.
        try {
            const d = (await getDocFromServer(opRef)).data();
            session.assertCurrent();
            if (d && d.actorUid === actorUid && d.command === commandName && d.payloadDigest === payloadDigest) return d.result;
        } catch { /* Başka aktör veya gerçek izin reddi sonuç kazandırmaz. */ }
        session.assertCurrent();
        throw error;
    }
}
export async function startProcess(input) {
    return command('start', input, async (tx, operationId, actorUid, session) => {
        const [version, old, headSnap] = await Promise.all([tx.get(ref('ebysVersions', input.versionId)), tx.get(ref('ebysProcesses', input.versionId)), tx.get(ref('ebysDocuments', input.documentId))]);
        const v = version.data(), head = headSnap.data();
        if (!v || v.ownerUid !== actorUid || v.documentId !== input.documentId || head?.currentVersionId !== input.versionId || old.exists()) throw new Error('Sürüm bu süreç için uygun değil.');
        const schemaVersion = v.schemaVersion === undefined ? 1 : v.schemaVersion;
        if (schemaVersion === 2) {
            if (head.purchaseOrderId !== input.documentId) throw new Error('Satın alma evrak bağı geçersiz.');
            await purchaseVersion(session, input.documentId, version, input.versionId, actorUid);
        } else if (schemaVersion !== 1 || Object.hasOwn(head, 'purchaseOrderId')) {
            throw new Error('Evrak sürümü ve karar motoru uyuşmuyor.');
        }
        const template = input.templateId ? (await tx.get(ref('ebysRouteTemplates', input.templateId))).data() : null;
        if(input.templateId && !template)throw new Error('Rota şablonu bulunamadı.');
        const selected = P().route(template?.routeSnapshot || input.route), route = [];
        for (const [i,step] of selected.entries()) {
            const p = await person(tx, step.personnelId, actorUid), source=template?.routeSnapshot[i];
            if(source && source.assigneeUid!==p.uid)throw new Error('Şablondaki hesap bağı değişmiş; yeni şablon hazırlayın.');
            route.push({ ...step, assigneeUid:p.uid, name:source?.name || p.name || p.adSoyad || step.personnelId });
        }
        const p = { id: input.versionId, documentId: input.documentId, versionId: input.versionId, ownerUid: actorUid, routeSnapshot: route, templateId: template?.id || '', templateRevision: template?.revision || 0,
            ...(schemaVersion === 2 ? { purchaseOrderId: input.documentId } : {}),
            currentStep: 0, activeAssigneeUid: route[0].assigneeUid, state: 'active', revision: 1, lastOperationId: operationId, lastCommand: 'start', lastResult: '', lastReason: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        tx.set(ref('ebysProcesses', p.id), p); tx.set(ref('ebysTasks', taskId(p.id, p.activeAssigneeUid)), task(p, route[0], p.activeAssigneeUid));
        return { processId: p.id, revision: 1, ownerUid: actorUid };
    });
}
export async function decideTask(input) {
    const reason = P().reason(input.result, input.reason);
    return command('decide', { ...input, reason }, async (tx, operationId, actorUid, session) => {
        const snap = await tx.get(ref('ebysProcesses', input.processId)), p = snap.data(); check(p, input.expectedRevision);
        const currentRef = ref('ebysTasks', taskId(p.id, p.activeAssigneeUid)), current = (await tx.get(currentRef)).data();
        if (p.state !== 'active' || p.activeAssigneeUid !== actorUid || !current || current.state !== 'active') throw new Error('Aktif görev size ait değil.');
        const financial = await firstPurchaseFinance(tx, session, p, input, operationId);
        const next = { ...p, revision: p.revision + 1, lastOperationId: operationId, lastCommand: 'decide', lastResult: input.result, lastReason: reason, updatedAt: serverTimestamp() };
        const decisions = { ...current.decisionsByStep };
        if (input.result !== 'returned') decisions[String(p.currentStep)] = { stepId: current.stepId, versionId: p.id, kind: current.kind, actorUid, principalUid: current.principalUid, result: input.result, reason, decidedAt: serverTimestamp() };
        const closed = { ...current, decisionsByStep: decisions, hasDecision: Object.keys(decisions).length > 0, state: 'closed', revision: current.revision + 1, updatedAt: serverTimestamp() };
        let nextTask = null;
        if (input.result === 'approved' && p.currentStep + 1 < p.routeSnapshot.length) {
            next.currentStep++; const step = p.routeSnapshot[next.currentStep];
            await person(tx, step.personnelId, p.ownerUid);
            next.activeAssigneeUid = step.assigneeUid;
            const previous = next.activeAssigneeUid === actorUid ? { ...closed, revision: current.revision } : (await tx.get(ref('ebysTasks', taskId(p.id, next.activeAssigneeUid)))).data();
            nextTask = task(next, step, next.activeAssigneeUid, previous);
        } else { next.state = input.result === 'approved' ? 'completed' : input.result; next.activeAssigneeUid = ''; }
        const head = next.state !== 'active' ? (await tx.get(ref('ebysDocuments', p.documentId))).data() : null;
        const job = next.state === 'completed' ? await window.AppModules.EBYSExecution.assignExecutionJob(tx, next, head) : null;
        session.assertCurrent();
        tx.set(ref('ebysProcesses', p.id), next);
        if (financial) tx.set(financial.ref, financial.data);
        if (job) tx.set(ref('ebysExecutionJobs', job.id), job);
        if (head) tx.set(ref('ebysDocuments',p.documentId), { ...head, state: next.state === 'completed' ? 'internally_approved' : next.state, revision: head.revision+1, updatedAt: serverTimestamp() });
        tx.set(currentRef, nextTask?.id === current.id ? nextTask : closed);
        if (nextTask && nextTask.id !== current.id) tx.set(ref('ebysTasks', nextTask.id), nextTask);
        return { processId: p.id, revision: next.revision, ownerUid: p.ownerUid };
    });
}
export async function withdrawProcess(input) {
    const reason = P().reason('returned', input.reason);
    return command('withdraw', { ...input, reason }, async (tx, operationId, actorUid) => {
        const p = (await tx.get(ref('ebysProcesses', input.processId))).data(); check(p, input.expectedRevision);
        if (p.ownerUid !== actorUid || p.state !== 'active') throw new Error('Süreç geri çekilemez.');
        const tRef = ref('ebysTasks', taskId(p.id, p.activeAssigneeUid)), t = (await tx.get(tRef)).data();
        const head = (await tx.get(ref('ebysDocuments',p.documentId))).data();
        const next = { ...p, state: 'withdrawn', activeAssigneeUid: '', revision: p.revision + 1, lastOperationId: operationId, lastCommand: 'withdraw', lastResult: 'withdrawn', lastReason: reason, updatedAt: serverTimestamp() };
        tx.set(ref('ebysProcesses', p.id), next); tx.set(tRef, { ...t, state: 'cancelled', revision: t.revision + 1, updatedAt: serverTimestamp() });
        tx.set(ref('ebysDocuments',p.documentId), { ...head, state:'withdrawn', revision:head.revision+1, updatedAt:serverTimestamp() });
        return { processId: p.id, revision: next.revision, ownerUid: p.ownerUid };
    });
}
export async function delegateTask(input) {
    if (!window.isDbAdmin?.()) throw new Error('Vekâlet için yönetici yetkisi gerekli.');
    const reason = P().reason('returned', input.reason);
    return command('delegate', {...input,reason}, async (tx, operationId) => {
        const p = (await tx.get(ref('ebysProcesses', input.processId))).data(); check(p, input.expectedRevision);
        if (p.state !== 'active') throw new Error('Aktif süreç gerekli.');
        const target = await person(tx, input.personnelId, p.ownerUid), until = Timestamp.fromDate(new Date(input.validUntil));
        if (until.toMillis() <= Date.now() || until.toMillis() > Date.now() + 90 * 86400000 || target.uid === p.activeAssigneeUid) throw new Error('Vekâlet kişisi veya bitiş tarihi geçersiz.');
        const oldRef = ref('ebysTasks', taskId(p.id, p.activeAssigneeUid)), old = (await tx.get(oldRef)).data();
        const targetRef = ref('ebysTasks', taskId(p.id, target.uid)), previous = (await tx.get(targetRef)).data();
        const next = { ...p, activeAssigneeUid: target.uid, revision: p.revision + 1, lastOperationId: operationId, lastCommand: 'delegate', lastResult: 'delegated', lastReason: reason, updatedAt: serverTimestamp() };
        tx.set(ref('ebysProcesses', p.id), next); tx.set(oldRef, { ...old, state: 'delegated', revision: old.revision + 1, updatedAt: serverTimestamp() });
        tx.set(targetRef, task(next, p.routeSnapshot[p.currentStep], target.uid, previous, until));
        return { processId: p.id, revision: next.revision, ownerUid: p.ownerUid, personnelId: input.personnelId };
    });
}
export async function createRouteTemplate(input) {
    if(!window.isDbAdmin?.())throw new Error('Şablon oluşturmak için yönetici yetkisi gerekli.');
    const name=String(input.name||'').trim(), selected=P().route(input.route), actor=uid(), id=S().uuid();
    if(!name || name.length>120 || /<[a-zA-Z/!?]/.test(name))throw new Error('Geçerli bir şablon adı girin.');
    await runTransaction(fireDb,async tx=>{
        const routeSnapshot=[];
        for(const step of selected){const p=await person(tx,step.personnelId,actor);routeSnapshot.push({...step,assigneeUid:p.uid,name:p.name||p.adSoyad||step.personnelId});}
        tx.set(ref('ebysRouteTemplates',id),{id,ownerUid:actor,name,revision:1,routeSnapshot,createdAt:serverTimestamp()});
    });
    return id;
}
export async function listRouteTemplates() {
    const snap=await getDocs(query(collection(fireDb,window.AppEnv.COLLECTION_ROOT,'ebysRouteTemplates','items'),limit(50)));
    return snap.docs.map(d=>d.data());
}
export async function getProcess(id) {
    const actor=uid();
    try {
        const snapshot=await getDocFromServer(ref('ebysProcesses',id));
        if(actor!==uid())throw new Error('Oturum değişti; süreç durumunu yeniden açın.');
        return snapshot.exists()?{...snapshot.data(),id:snapshot.id}:null;
    } catch(error) {
        if(error.code!=='permission-denied')throw error;
        const root=window.AppEnv.COLLECTION_ROOT,emulator=window.AppEnv.EMULATOR===true;
        console.error('[EBYS] Süreç durumu okuma reddi',{root,emulator,collection:'ebysProcesses',versionId:id,code:error.code});
        const failure=new Error('Süreç durumu okunamadı: Firestore erişimi reddetti. Ortam: '+(emulator?'Emülatör':'Firebase')+'; kök: '+root+'. Oturumu ve bu ortamdaki Aşama 5 kurallarını kontrol edin.');
        failure.code=error.code;failure.cause=error;throw failure;
    }
}
export async function getVersion(id) {
    const who=uid();
    try {
        const snapshot=await getDocFromServer(ref('ebysVersions',id));
        if(who!==uid())throw new Error('Oturum değişti.');
        if(!snapshot.exists())throw new Error('Evrak sürümü bulunamadı.');
        return snapshot.data();
    } catch(error) {
        if(error.code!=='permission-denied')throw error;
        const denied=new Error('Bu sürüme erişiminiz kapandı. Görev iade edilmiş, devredilmiş veya yetki süresi dolmuş olabilir. Karar geçmişiniz varsa yalnız karar verdiğiniz sürüm açılabilir.');
        denied.code=error.code;denied.cause=error;throw denied;
    }
}
// İçerik için daima görevdeki immutable sürüm yolu kullanılır; güncel başlığa yönlendirme yoktur.
export function watchTaskContext(task,onData,onError) {
    let alive=true,context={versionId:task.versionId};const emit=()=>{if(alive)onData({...context});};
    const stop=onSnapshot(ref('ebysProcesses',task.processId),snapshot=>{
        context.state=snapshot.data()?.state;emit();
    },error=>{if(alive){context.state='unavailable';emit();if(error.code!=='permission-denied')onError?.(error);}});
    getVersion(task.versionId).then(version=>{
        context={...context,subject:version.metadataSnapshot?.subject||'Evrak',versionNo:version.versionNo,available:true};emit();
    }).catch(error=>{if(alive){context.available=false;emit();if(error.code!=='permission-denied')onError?.(error);}});
    return()=>{alive=false;stop();};
}
export function subscribeMyTasks(callback, onError, cursor = null) {
    return onSnapshot(query(collection(fireDb, window.AppEnv.COLLECTION_ROOT, 'ebysTasks', 'items'), where('assigneeUid', '==', uid()), orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)), snap => callback(snap.docs.map(d => ({ ...d.data(), _cursor:d }))), onError);
}
export async function listMyProcesses() { const s = await getDocs(query(collection(fireDb, window.AppEnv.COLLECTION_ROOT, 'ebysProcesses', 'items'), where('ownerUid', '==', uid()), limit(50))); return s.docs.map(d => d.data()); }
export function subscribeMyReturnedDocuments(callback, onError, cursor = null) {
    const documents = collection(fireDb, window.AppEnv.COLLECTION_ROOT, 'ebysDocuments', 'items');
    return onSnapshot(query(documents, where('ownerUid', '==', uid()), where('state', 'in', ['returned', 'rejected', 'withdrawn']),
        orderBy('updatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)),
        snap => callback(snap.docs.map(d => ({ ...d.data(), _cursor: d }))), onError);
}
window.AppModules = window.AppModules || {};
window.AppModules.EBYSProcesses = { startProcess, decideTask, withdrawProcess, delegateTask, getProcess, getVersion, subscribeMyTasks, listMyProcesses, subscribeMyReturnedDocuments,createRouteTemplate,listRouteTemplates,watchTaskContext };
