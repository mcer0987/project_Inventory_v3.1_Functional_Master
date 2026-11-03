import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
sdk.setLogLevel('silent');let env;const root='inventory_demo';
const ref=(db,c,id)=>sdk.doc(db,root,c,'items',id);
const ctx=uid=>env.authenticatedContext(uid,{email:uid==='admin'?'admin@medipol.local':uid+'.test@staff.medipol.local',firebase:{sign_in_provider:'password'}}).firestore();
const plain=x=>Array.isArray(x)?Array.from(x,plain):x&&x.constructor?.name==='Object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
const c=vm.createContext({...sdk,setDoc:(r,v)=>sdk.setDoc(r,plain(v))});
vm.runInContext(readFileSync('src/services/purchase-access.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+'\nglobalThis.adapter={ensurePurchaseAccess,subscribeRestrictedPurchases};',c);
const waitFor=async predicate=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('Canlı kuyruk bekleme süresi doldu');await new Promise(r=>setTimeout(r,25));}};
const order=()=>({id:'order',createdByUid:'owner',urun:'Eski talep',workflow:{started:true,finished:false,currentStep:0,steps:[{userUid:'a',user:'A',status:'pending'},{userUid:'b',user:'B',status:'pending'}]}});
const put=async value=>env.withSecurityRulesDisabled(c=>sdk.setDoc(ref(c.firestore(),'purchaseOrders','order'),value));
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-purchase-access',firestore:{rules:readFileSync('firestore.rules','utf8')}})});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await sdk.setDoc(ref(db,'accessGate','staff'),{staffAccessEnabled:true});for(const uid of ['owner','a','b']){await sdk.setDoc(ref(db,'personel',uid),{id:uid,uid,pri:uid+'.test',active:true});await sdk.setDoc(ref(db,'staffAccounts',uid),{personelId:uid,pri:uid+'.test'});}});await put(order());});
test('legacy geniş sorgu ve gelecek imzacı reddedilir; sahip ve aktif UID sorguları çalışır',async()=>{
 await assertFails(sdk.getDocs(sdk.collection(ctx('a'),root,'purchaseOrders','items')));
 await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(ctx('owner'),root,'purchaseOrders','items'),sdk.where('createdByUid','==','owner'))));
 await assertSucceeds(sdk.getDoc(ref(ctx('a'),'purchaseOrders','order')));await assertFails(sdk.getDoc(ref(ctx('b'),'purchaseOrders','order')));
 await assertFails(sdk.setDoc(ref(ctx('owner'),'purchaseAccess','order__b'),{purchaseId:'order',assigneeUid:'b',createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()}));
 const before=(await sdk.getDoc(ref(ctx('owner'),'purchaseOrders','order'))).data();
 assert.equal((await c.adapter.ensurePurchaseAccess(ctx('owner'),root,[before],'owner')).created,1);
 assert.deepEqual((await sdk.getDoc(ref(ctx('owner'),'purchaseOrders','order'))).data(),before);
 await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(ctx('a'),root,'purchaseAccess','items'),sdk.where('assigneeUid','==','a'))));
 await assertFails(sdk.getDocs(sdk.collection(ctx('a'),root,'purchaseAccess','items')));
});
test('canlı legacy adaptörü aktif/geçmiş kararları birleştirir, eski onay verisini değiştirmez',async()=>{
 let rows=[],errors=[];const source=order();await c.adapter.ensurePurchaseAccess(ctx('owner'),root,[source],'owner');
 const stop=c.adapter.subscribeRestrictedPurchases(ctx('a'),root,'a',v=>rows=v,e=>errors.push(e));
 try{await waitFor(()=>rows.length===1);source.workflow.steps[0].status='approved';source.workflow.currentStep=1;await put(source);await c.adapter.ensurePurchaseAccess(ctx('owner'),root,[source],'owner');
 await waitFor(()=>rows[0]?.workflow.currentStep===1);await assertSucceeds(sdk.getDoc(ref(ctx('a'),'purchaseOrders','order')));await assertSucceeds(sdk.getDoc(ref(ctx('b'),'purchaseOrders','order')));assert.deepEqual(errors,[]);
 }finally{stop();}assert.equal(rows.length,0);
});
test('stale kuyruk eşlemesi içerik yetkisi vermez; tekrar atama dinleyiciyi güvenle yeniler',async()=>{
 let rows=[],errors=[];const source=order();await c.adapter.ensurePurchaseAccess(ctx('owner'),root,[source],'owner');
 const stop=c.adapter.subscribeRestrictedPurchases(ctx('a'),root,'a',v=>rows=v,e=>errors.push(e));
 try{await waitFor(()=>rows.length===1);source.workflow.finished=true;await put(source);await waitFor(()=>rows.length===0);await assertFails(sdk.getDoc(ref(ctx('a'),'purchaseOrders','order')));
 source.workflow.finished=false;await put(source);await c.adapter.ensurePurchaseAccess(ctx('owner'),root,[source],'owner');await waitFor(()=>rows.length===1);assert.deepEqual(errors,[]);
 }finally{stop();}
});
test('UID eksik legacy adım raporlanır; isimden otomatik içerik yetkisi üretilmez',async()=>{
 const source=order();delete source.workflow.steps[0].userUid;await put(source);const result=await c.adapter.ensurePurchaseAccess(ctx('admin'),root,[source],'admin',true);assert.equal(result.created,0);assert.equal(result.unresolved.length,1);await assertFails(sdk.getDoc(ref(ctx('a'),'purchaseOrders','order')));
});
