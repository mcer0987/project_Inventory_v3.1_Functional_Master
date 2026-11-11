import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as sdk from 'firebase/firestore';
export { sdk };
export const root = 'inventory_demo';
export const uuid = () => webcrypto.randomUUID();
export const ref = (db,c,id,r=root) => sdk.doc(db,r,c,'items',String(id));
export const financeRef = (db,pid,vid,r=root) => sdk.doc(db,r,'purchaseFinance','items',pid,'versions',vid);
export const plain = v => Array.isArray(v) ? Array.from(v,plain) : v && v.constructor?.name === 'Object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)])) : v;
sdk.setLogLevel('silent');
export function contextDb(env,uid) {
    return env.authenticatedContext(uid,{ email:uid === 'admin' ? 'admin@medipol.local' : uid+'.test@staff.medipol.local', firebase:{sign_in_provider:'password'} }).firestore();
}
export function actor(env, uid, { transform = (_path, data) => data, r = root, onRead, lostResponse = false } = {}) {
    const db = contextDb(env, uid), metrics = { reads: [], writes: [], committed: [], attempts: 0 };
    const window = { userAuth: { uid }, AppEnv: { COLLECTION_ROOT: r }, AppModules: {}, isDbAdmin: () => uid === 'admin' };
    const read = async (path, action) => {
        metrics.reads.push(path.path);
        const snapshot = await action(path);
        onRead?.(path, window);
        return snapshot;
    };
    const run = async (_db, callback, options) => {
        let finalWrites = [];
        const result = await sdk.runTransaction(db, async raw => {
            metrics.attempts++;
            finalWrites = [];
            const tx = { get: path => read(path, value => raw.get(value)) };
            for (const action of ['set', 'update']) {
                tx[action] = (path, value) => {
                    const data = transform(path, plain(value));
                    if (data === null) return;
                    finalWrites.push(path.path);
                    metrics.writes.push(path.path);
                    raw[action](path, data);
                };
            }
            return callback(tx);
        }, options);
        metrics.committed.push(...finalWrites);
        if (lostResponse) throw Error('Simüle edilen yanıt kaybı');
        return result;
    };
    const context = vm.createContext({ window, console, crypto: webcrypto, TextEncoder, Date, fireDb: db, ...sdk,
        getDocFromServer: path => read(path, sdk.getDocFromServer), runTransaction: run,
        where: (field, op, value) => sdk.where(field, op, plain(value)) });
    const verificationSchema = 'src/utils/ebys-verification-schema.js';
    vm.runInContext(readFileSync(verificationSchema, 'utf8').replace(/^export /gm, ''), context, { filename: verificationSchema });
    const modules = [
        'utils/ebys-document-schema.js', 'utils/ebys-process-schema.js', 'utils/purchase-money.js',
        'utils/ebys-purchase-schema.js', 'services/ebys-document-service.js', 'services/ebys-execution-service.js',
        'services/ebys-verification-service.js', 'services/ebys-process-service.js'
    ];
    for (const module of modules) {
        const file = 'src/' + module;
        const code = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
        const exposed = module === 'services/ebys-document-service.js'
            ? '\nwindow.purchaseCommands = { createPurchaseDocument, savePurchaseDraft, freezePurchaseVersion, getPurchaseView };'
            : module === 'services/ebys-process-service.js' ? '\nwindow.purchasePreview = getPurchaseApprovalPreview;' : '';
        vm.runInContext('{\n' + code + exposed + '\n}', context, { filename: file });
    }
    const commands = window.purchaseCommands;
    return {
        db, metrics, window,
        save: async input => plain(await (input.expectedRevision == null ? commands.createPurchaseDocument(input) : commands.savePurchaseDraft(input))),
        freeze: async input => plain(await commands.freezePurchaseVersion(input)),
        view: commands.getPurchaseView, preview: window.purchasePreview, processes: window.AppModules.EBYSProcesses,
        documents: window.AppModules.EBYSDocuments, execution: window.AppModules.EBYSExecution,
        verification: window.AppModules.EBYSVerification,
        reset: () => { metrics.reads = []; metrics.writes = []; metrics.committed = []; metrics.attempts = 0; }
    };
}


export const input=()=>({unitId:'unit',organizationCode:'MED',budgetMode:'manual',butce:120000,content:'İLK METİN A',metadata:{subject:'Demo laboratuvar ihtiyacı',correspondent:'Birim',date:'2026-11-09',filePlanCode:'100',confidentiality:'Normal',distribution:'',externalRegistrationNo:''},
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
