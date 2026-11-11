import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as sdk from 'firebase/firestore';
import { replaceExact } from './build-rules.mjs';
export { sdk };
export const root = 'inventory_demo';
export const uuid = () => webcrypto.randomUUID();
export const ref = (db,c,id,r=root) => sdk.doc(db,r,c,'items',String(id));
export const financeRef = (db,pid,vid,r=root) => sdk.doc(db,r,'purchaseFinance','items',pid,'versions',vid);
export const plain = v => Array.isArray(v) ? Array.from(v,plain) : v && v.constructor?.name === 'Object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])) : v;
sdk.setLogLevel('silent');
export function contextDb(env,uid,r=root) {
    return env.authenticatedContext(uid,{ email:uid === 'admin' ? 'admin@medipol.local' : uid+'.test@staff.medipol.local', firebase:{sign_in_provider:'password'} }).firestore();
}
export function actor(env, uid, { transform = (_path,d)=>d, r=root } = {}) {
    const db = contextDb(env,uid,r), metrics={ reads:[],writes:[],attempts:0 };
    const path=(c,id)=>ref(db,c,id,r);
    const get=async p=>{metrics.reads.push(p.path);return sdk.getDocFromServer(p);};
    const run=callback=>sdk.runTransaction(db,async raw=>{
        metrics.attempts++;
        const tx={
            get:async p=>{metrics.reads.push(p.path);return raw.get(p);},
            set:(p,d)=>{const next=transform(p,plain(d));if(next){metrics.writes.push(p.path);raw.set(p,next);}},
            update:(p,d)=>{const next=transform(p,plain(d));if(next){metrics.writes.push(p.path);raw.update(p,next);}}
        };return callback(tx);
    },{maxAttempts:3});
    const window={userAuth:{uid},AppEnv:{COLLECTION_ROOT:r},AppModules:{},isDbAdmin:()=>uid==='admin'};
    const c=vm.createContext({window, console, crypto:webcrypto, TextEncoder, Date, fireDb:db,...sdk,
        getDocFromServer:get,runTransaction:(_db,cb)=>run(cb),
        where:(field,op,value)=>sdk.where(field,op,plain(value)),
        h3PrepareFinance:async(tx,p,n,input,operationId)=>{
            if (!p.purchaseOrderId || p.currentStep!==0 || input.result!=='approved') return null;
            const v=(await tx.get(path('ebysVersions',p.id))).data();
            const fpath=financeRef(db,p.purchaseOrderId,p.id,r);
            const prior=await tx.get(fpath);
            if(prior.exists())throw Error('Finans zaten var; süreç tutarsız.');
            const proposal=v.purchaseSnapshot, usedForeign=proposal.items.some(x=>x.currency!=='TRY');
            let financial;
            if(usedForeign){
                const config=(await tx.get(path('system_config','ebys_rates'))).data();
                const observed=config ? {rates:config.rates,date:config.date,source:config.source} : null;
                if(!observed || S.canonical(plain(input.fxPreview))!==S.canonical(observed)) throw Error('Kur değişti veya eksik; tutarı yeniden görüp onaylayın.');
                financial=plain(M.snapshotRates(proposal,config));
            }else{
                financial={exchangeRate:{TRY:1,USD:1,EUR:1},exchangeRateDate:new Date().toISOString().slice(0,10),exchangeRateSource:'TRY',reportingTotalTRY:M.calculate(proposal.items).totals.TRY.total};
            }
            return {path:fpath,data:{schemaVersion:2,purchaseOrderId:p.purchaseOrderId,versionId:p.id,contentDigest:v.contentDigest,
                actorUid:uid,operationId,...financial,createdAt:sdk.serverTimestamp()}};
        }
    });
    for(const source of ['src/utils/ebys-document-schema.js','src/utils/ebys-process-schema.js','src/utils/purchase-money.js',
        'src/services/ebys-document-service.js','src/services/ebys-execution-service.js','src/services/ebys-process-service.js']) {
        let code=readFileSync(source,'utf8').replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace(/export /g,'');
        if(source.endsWith('ebys-process-service.js')) {
            code=replaceExact(code,'currentStep: 0, activeAssigneeUid: route[0].assigneeUid,',
                "...(v.purchaseSnapshot ? {purchaseOrderId:v.purchaseSnapshot.purchaseOrderId} : {}), currentStep: 0, activeAssigneeUid: route[0].assigneeUid,");
            code=replaceExact(code,"        tx.set(ref('ebysProcesses', p.id), next);\n        if (job)",
                "        const financial = await h3PrepareFinance(tx,p,next,input,operationId);\n        if (financial) tx.set(financial.path,financial.data);\n        tx.set(ref('ebysProcesses', p.id), next);\n        if (job)");
        }
        vm.runInContext('{'+code+'}',c,{filename:source});
    }
    const S=window.AppModules.EBYSDocumentSchema,M=window.AppModules.PurchaseMoney;
    const digest=v=>S.digest(plain(v));
    const log=(tx,h,op,command,payloadDigest,result)=>{
        tx.set(path('ebysOperations',op),{id:op,documentId:h.id,ownerUid:uid,command,payloadDigest,result,revision:h.revision,createdAt:sdk.serverTimestamp()});
        tx.set(path('ebysEvents',op),{id:op,documentId:h.id,ownerUid:uid,operationId:op,type:command,revision:h.revision,createdAt:sdk.serverTimestamp()});
    };
    const replay=(snap,command,payloadDigest)=>{
        if(!snap.exists())return null;const d=snap.data();
        if(d.ownerUid!==uid || d.command!==command || d.payloadDigest!==payloadDigest)throw Error('İşlem kimliği farklı içerikle kullanıldı.');
        return d.result;
    };
    const execute=async(command,op,payloadDigest,callback)=>{
        try{return await run(callback);}catch(error){
            try{const previous=replay(await get(path('ebysOperations',op)),command,payloadDigest);if(previous)return previous;}catch{/* Preserve actual denial/conflict. */}
            throw error;
        }
    };
    async function save(input) {
        const id=input.id||uuid(),op=input.operationId||uuid();
        const data=plain(S.normalize({...input,kind:'internal',organizationCode:'MED'}));
        const money=plain(M.calculate(input.items));
        const proposal={purchaseOrderId:id,documentTypeCode:'PURCHASE_REQUEST',items:money.items,totals:money.totals,
            butce:input.butce??120000,budgetMode:'manual',calculationVersion:1};
        const payloadDigest=await digest({id,...data,proposal,expectedRevision:input.expectedRevision??null,reopen:input.reopen===true});
        return execute('saveDraft',op,payloadDigest,async tx=>{
            const [operation,old,unit,po]=await Promise.all([tx.get(path('ebysOperations',op)),tx.get(path('ebysDocuments',id)),tx.get(path('units',data.unitId)),tx.get(path('purchaseOrders',id))]);
            const previous=replay(operation,'saveDraft',payloadDigest);if(previous)return previous;
            if(!unit.exists()||unit.data().active===false)throw Error('Aktif birim gerekli.');
            const h=old.data();
            if(h && (h.ownerUid!==uid||h.revision!==input.expectedRevision))throw Error('Evrak revizyonu veya sahibi değişti.');
            if(h && input.reopen){const process=(await tx.get(path('ebysProcesses',h.currentVersionId))).data();if(!['returned','rejected','withdrawn'].includes(process?.state))throw Error('Yeni sürüm açılamaz.');}
            else if(h && !['draft','registered'].includes(h.state))throw Error('Dondurulmuş evrak.');
            const head={...(h||{}),id,ownerUid:uid,kind:'internal',unitId:data.unitId,organizationCode:'MED',purchaseOrderId:id,
                state:input.reopen?'draft':h?.state||'draft',currentVersionId:'',versionNo:h?.versionNo||0,registrationNo:h?.registrationNo||'',
                revision:(h?.revision||0)+1,lastOperationId:op,createdAt:h?.createdAt||sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()};
            const pointer={id,engineVersion:'ebys-v1',schemaVersion:2,ebysDocumentId:id,createdByUid:uid,unitId:data.unitId,birim:unit.data().name,
                documentTypeCode:'PURCHASE_REQUEST',revision:head.revision,createdAt:po.data()?.createdAt||sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()};
            tx.set(path('purchaseOrders',id),pointer);tx.set(path('ebysDocuments',id),head);
            tx.set(path('ebysDrafts',id),{id,documentId:id,ownerUid:uid,revision:head.revision,content:data.content,metadata:data.metadata,
                purchaseSnapshot:proposal,attachments:[],attachmentMode:'none',updatedAt:sdk.serverTimestamp()});
            const result={documentId:id,revision:head.revision};log(tx,head,op,'saveDraft',payloadDigest,result);return result;
        });
    }
    async function freeze({documentId,expectedRevision,operationId=uuid()}) {
        const payloadDigest=await digest({documentId,expectedRevision});const versionId=uuid();
        return execute('freezeVersion',operationId,payloadDigest,async tx=>{
            const [op,hSnap,dSnap]=await Promise.all([tx.get(path('ebysOperations',operationId)),tx.get(path('ebysDocuments',documentId)),tx.get(path('ebysDrafts',documentId))]);
            const prior=replay(op,'freezeVersion',payloadDigest);if(prior)return prior;
            const h=hSnap.data(),draft=dSnap.data();
            if(h.ownerUid!==uid||h.revision!==expectedRevision||!['draft','registered'].includes(h.state))throw Error('Taslak revizyonu değişti.');
            const u=(await tx.get(path('units',h.unitId))).data();if(!u||u.active===false)throw Error('Aktif birim gerekli.');
            const unitSnapshot={unitId:h.unitId,name:u.name,code:u.code||'',organizationId:u.organizationId||'',organizationCode:h.organizationCode,source:'units'};
            const contentDigest=await digest({content:draft.content,metadata:draft.metadata,attachments:[],purchaseSnapshot:draft.purchaseSnapshot,unitSnapshot});
            const head={...h,state:'in_review',currentVersionId:versionId,versionNo:h.versionNo+1,revision:h.revision+1,lastOperationId:operationId,updatedAt:sdk.serverTimestamp()};
            tx.set(path('ebysVersions',versionId),{id:versionId,processId:versionId,documentId,ownerUid:uid,versionNo:head.versionNo,schemaVersion:2,
                content:draft.content,metadataSnapshot:draft.metadata,purchaseSnapshot:draft.purchaseSnapshot,unitSnapshot,attachments:[],attachmentMode:'none',contentDigest,createdAt:sdk.serverTimestamp()});
            tx.set(path('ebysDocuments',documentId),head);const result={documentId,versionId,revision:head.revision};log(tx,head,operationId,'freezeVersion',payloadDigest,result);return result;
        });
    }
    return { db, metrics, save, freeze, S, M, processes:window.AppModules.EBYSProcesses,execution:window.AppModules.EBYSExecution,
        documents:window.AppModules.EBYSDocuments,reset:()=>{metrics.reads=[];metrics.writes=[];metrics.attempts=0;} };
}
export const input=()=>({unitId:'unit',content:'İLK METİN A',metadata:{subject:'Demo laboratuvar ihtiyacı',correspondent:'Birim',date:'2026-11-09',filePlanCode:'100',confidentiality:'Normal',distribution:'',externalRegistrationNo:''},
    items:['TRY','USD','EUR'].map((currency,i)=>({id:'line-'+i,description:'Kalem '+i,category:'Sarf',quantity:i+1,unit:'Adet',unitPrice:10.11,currency,taxRate:20,totalPrice:0}))});
export const fx={rates:{TRY:1,USD:35,EUR:40},date:'2026-11-09',source:'Yönetici demo'};
export async function seed(env) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c=>{
        const db=c.firestore();
        await sdk.setDoc(ref(db,'accessGate','staff'),{staffAccessEnabled:true});
        await sdk.setDoc(ref(db,'units','unit'),{id:'unit',name:'Bilgi Teknolojileri',code:'BT',organizationId:'demo-kurum',parentUnitId:'',active:true});
        await sdk.setDoc(ref(db,'system_config','ebys_rates'),fx);
        for(const who of ['owner','a','b','c','d','e','f','worker','stranger']) {
            await sdk.setDoc(ref(db,'personel',who),{id:who,uid:who,name:who,unitId:'unit',pri:who+'.test',active:true});
            await sdk.setDoc(ref(db,'staffAccounts',who),{personelId:who,pri:who+'.test'});
        }
        await sdk.setDoc(ref(db,'ebysExecutionPolicies','internal__unit'),{kind:'internal',sourceUnitId:'unit',unitId:'unit',personnelId:'worker',assigneeUid:'worker',dueHours:72});
    });
}
export const route=names=>names.map((personnelId,i)=>({personnelId,kind:i===0?'paraf':'approval',dueHours:72}));
