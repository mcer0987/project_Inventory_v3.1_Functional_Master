import { collection, doc, query, where, onSnapshot, getDocFromServer, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
// Eşleme yalnız belgeyi bulur. Kaynak ve dondurulmuş kopya ayrı Rules denetiminden geçer.
export function subscribeRestrictedPurchases(db, root, actor, onData, onError) {
    let alive = true, own = new Map();
    const live = new Map(), history = new Map(), listeners = new Map();
    function emit() {
        if (!alive) return;
        const rows = new Map(history);
        for (const [id, row] of live) {
            if (!history.has(id) || row.workflow?.started) rows.set(id, row);
        }
        for (const [id, row] of own) rows.set(id, row);
        onData([...rows.values()]);
    }
    onData([]);
    const stopOwn = onSnapshot(query(collection(db, root, 'purchaseOrders', 'items'), where('createdByUid', '==', actor)), snapshot => {
        own = new Map(snapshot.docs.map(d => [d.id, { ...d.data(), id: d.id }]));
        emit();
    }, onError);
    const stopProofs = onSnapshot(query(collection(db, root, 'purchaseAccess', 'items'), where('assigneeUid', '==', actor)), snapshot => {
        const desired = new Map();
        for (const proof of snapshot.docs) {
            const { purchaseId, historyId } = proof.data();
            desired.set('live:' + purchaseId, { purchaseId, id: purchaseId, collection: 'purchaseOrders', rows: live });
            if (historyId) desired.set('history:' + historyId, { purchaseId, id: historyId, collection: 'purchaseHistory', rows: history });
        }
        for (const [key, entry] of listeners) {
            if (desired.has(key)) continue;
            entry.stop();
            entry.rows.delete(entry.purchaseId);
            listeners.delete(key);
        }
        for (const [key, entry] of desired) {
            if (listeners.has(key)) continue;
            const stop = onSnapshot(doc(db, root, entry.collection, 'items', entry.id), snapshot => {
                if (!alive) return;
                const data = snapshot.data();
                const row = entry.rows === history ? data?.snapshot : data;
                if (row) entry.rows.set(entry.purchaseId, entry.rows === history
                    ? { ...row, id: entry.purchaseId, workflow: { ...row.workflow, finished: true } }
                    : { ...row, id: entry.purchaseId });
                else entry.rows.delete(entry.purchaseId);
                emit();
            }, error => {
                if (!alive) return;
                listeners.delete(key);
                entry.rows.delete(entry.purchaseId);
                emit();
                if (error.code !== 'permission-denied') onError(error);
            });
            listeners.set(key, { ...entry, stop });
        }
        emit();
    }, onError);
    return () => {
        alive = false;
        stopOwn();
        stopProofs();
        for (const entry of listeners.values()) entry.stop();
        listeners.clear();
        own.clear();
        live.clear();
        history.clear();
        onData([]);
    };
}

// Geri çekme ile eski içerik ve geçmiş karar keşif eşlemeleri aynı batch'te yazılır.
export async function appendPurchaseWithdrawalHistory(db, root, batch, purchaseId, next) {
    const workflow = next.workflow;
    if (next.durum !== 'Taslak' || workflow?.started !== false || workflow.history?.at(-1)?.action !== 'withdraw') return;
    const old = (await getDocFromServer(doc(db, root, 'purchaseOrders', 'items', purchaseId))).data();
    if (old?.workflow?.started !== true) return;
    const actors = new Set((old.workflow.steps || [])
        .filter(step => step.userUid && ['approved', 'rejected'].includes(step.status))
        .map(step => step.userUid));
    if (!actors.size && !['approved', 'rejected'].includes(old.workflow.steps?.[0]?.status)) return;
    const historyId = purchaseId + '__' + workflow.history.length;
    const proofs = await Promise.all([...actors].map(async assigneeUid => {
        const ref = doc(db, root, 'purchaseAccess', 'items', purchaseId + '__' + assigneeUid);
        const saved = await getDocFromServer(ref);
        return { ref, assigneeUid, createdAt: saved.exists() ? saved.data().createdAt : serverTimestamp() };
    }));
    batch.set(doc(db, root, 'purchaseHistory', 'items', historyId), { purchaseId, snapshot: old, createdAt: serverTimestamp() });
    for (const proof of proofs) {
        batch.set(proof.ref, { purchaseId, assigneeUid: proof.assigneeUid, historyId, createdAt: proof.createdAt, updatedAt: serverTimestamp() });
    }
}

export async function ensurePurchaseAccess(db,root,orders,actor,isAdmin=false) {
    let created=0; const unresolved=[];
    for(const order of orders){
        const steps=order.workflow?.steps||[], eligible=steps.filter((s,i)=>s.status==='approved'||s.status==='rejected'||(order.workflow?.started&&!order.workflow.finished&&order.workflow.currentStep===i));
        if(!isAdmin&&order.createdByUid!==actor&&!eligible.some(s=>s.userUid===actor))continue;
        for(const step of eligible){if(!step.userUid){unresolved.push({purchaseId:String(order.id),name:step.user||''});continue;}
            const id=String(order.id),path=doc(db,root,'purchaseAccess','items',`${id}__${step.userUid}`);
            const saved=await getDocFromServer(path);
            await setDoc(path,{...(saved.data() || {}),purchaseId:id,assigneeUid:step.userUid,createdAt:saved.exists()?saved.data().createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
            if(!saved.exists())created++;
        }
    }
    return {created,unresolved};
}
