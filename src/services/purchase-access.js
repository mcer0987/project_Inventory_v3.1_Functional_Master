import { collection, doc, query, where, onSnapshot, getDocFromServer, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
// Eşleme içerik izni değildir; gerçek sıra/karar her kaynak okumasında doğrulanır.
export function subscribeRestrictedPurchases(db, root, actor, onData, onError) {
    let alive = true, own = new Map(), related = new Map(); const listeners = new Map();
    const emit = () => { if (alive) onData([...new Map([...related,...own]).values()]); };
    onData([]);
    const a = onSnapshot(query(collection(db,root,'purchaseOrders','items'),where('createdByUid','==',actor)), s => { own = new Map(s.docs.map(d=>[d.id,{...d.data(),id:d.data().id ?? d.id}])); emit(); },onError);
    const b = onSnapshot(query(collection(db,root,'purchaseAccess','items'),where('assigneeUid','==',actor)), s => {
        // Değişen eşleme, önceki izin reddiyle kapanan kaynak dinleyicisini de yeniler.
        const ids = new Set(s.docs.map(d=>d.data().purchaseId));
        for(const [id,stop] of listeners) if(!ids.has(id)){stop();listeners.delete(id);related.delete(id);}
        for(const id of ids) if(!listeners.has(id)) listeners.set(id,onSnapshot(doc(db,root,'purchaseOrders','items',id),d=>{
            if(d.exists()) related.set(id,{...d.data(),id:d.data().id ?? d.id});else related.delete(id);emit();
        },error=>{listeners.delete(id);related.delete(id);emit();if(error.code!=='permission-denied')onError(error);}));
        emit();
    },onError);
    return ()=>{alive=false;a();b();listeners.forEach(stop=>stop());listeners.clear();own.clear();related.clear();onData([]);};
}
export async function ensurePurchaseAccess(db,root,orders,actor,isAdmin=false) {
    let created=0; const unresolved=[];
    for(const order of orders){
        const steps=order.workflow?.steps||[], eligible=steps.filter((s,i)=>s.status==='approved'||s.status==='rejected'||(order.workflow?.started&&!order.workflow.finished&&order.workflow.currentStep===i));
        if(!isAdmin&&order.createdByUid!==actor&&!eligible.some(s=>s.userUid===actor))continue;
        for(const step of eligible){if(!step.userUid){unresolved.push({purchaseId:String(order.id),name:step.user||''});continue;}
            const id=String(order.id),path=doc(db,root,'purchaseAccess','items',`${id}__${step.userUid}`);
            const saved=await getDocFromServer(path);
            await setDoc(path,{purchaseId:id,assigneeUid:step.userUid,createdAt:saved.exists()?saved.data().createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
            if(!saved.exists())created++;
        }
    }
    return {created,unresolved};
}
