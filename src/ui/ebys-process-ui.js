import '../services/ebys-process-service.js';
import '../services/ebys-document-service.js';
const api=()=>window.AppModules.EBYSProcesses;
const n=(tag,text,cls)=>{const x=document.createElement(tag);if(text!=null)x.textContent=text;if(cls)x.className=cls;return x;};
const btn=(text,fn)=>{const b=n('button',text,'btn btn-sm btn-outline-primary');b.type='button';b.onclick=fn;return b;};
const states={active:'Aktif',completed:'Kurum içi onay tamamlandı',returned:'İade edildi',rejected:'Reddedildi',withdrawn:'Geri çekildi'};
const kinds={paraf:'Paraf',approval:'Onay',consent:'Olur'};
const people=()=> (window.data?.personel||[]).filter(p=>p.active!==false&&p.uid);
function selectPerson(value='') {
    const select=n('select',null,'form-select');
    for(const p of people()){const o=n('option',`${p.name||p.adSoyad} · ${p.pri||p.id}`);o.value=String(p.id);select.append(o);}
    if(value)select.value=value;return select;
}
const processDialogs=new Map(), ownerEpochs=new Map();
function closeOwned(owner) {
    ownerEpochs.set(owner,(ownerEpochs.get(owner)||0)+1);
    for(const [d,record] of processDialogs)if(!owner||record.owner===owner){d.remove();processDialogs.delete(d);}
}
function guardDialog(d,validate) {
    const record=processDialogs.get(d);record.validate=validate;
    let generation=0,saved=null;
    const status=n('p',''),retry=btn('Durumu yeniden kontrol et',()=>resume());retry.hidden=true;
    retry.classList.add('ebys-recheck');
    status.setAttribute('role','status');d.append(status,retry);
    const lock=()=>{record.ready=false;generation++;if(!saved)saved=[...d.querySelectorAll('button')].filter(b=>b!==retry&&b.textContent!=='Kapat'&&!b.classList.contains('ebys-dialog-close')).map(b=>[b,b.disabled]);saved.forEach(([b])=>b.disabled=true);};
    const resume=async()=>{
        lock();const token=generation;
        try{
            const valid=await validate();
            if(!d.isConnected||token!==generation||document.hidden)return;
            if(record.actor!==window.userAuth?.uid||!valid){d.remove();processDialogs.delete(d);return;}
            saved?.forEach(([b,disabled])=>b.disabled=disabled);saved=null;record.ready=true;retry.hidden=true;status.textContent='';
        }catch(error){
            if(!d.isConnected||token!==generation)return;
            if(record.actor!==window.userAuth?.uid||error.code==='permission-denied'){d.remove();processDialogs.delete(d);return;}
            status.textContent='Güncel durum kontrol edilemedi. Notunuz korunuyor; yeniden kontrol edin.';retry.hidden=false;
        }
    };
    record.pause=lock;record.resume=resume;record.ready=!document.hidden;if(document.hidden)lock();
}
function modal(title,owner='process') {
    const d=n('dialog',null,'ebys-document-dialog ebys-process-dialog');const x=btn('✕',()=>d.close());x.className='ebys-dialog-close';x.setAttribute('aria-label','Pencereyi kapat');d.append(x,n('h3',title));
    d.addEventListener('close',()=>d.remove());d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))d.close();});
    processDialogs.set(d,{owner,actor:window.userAuth?.uid,ready:!document.hidden});d.addEventListener('close',()=>processDialogs.delete(d));document.body.append(d);d.showModal();return d;
}
let viewEpoch=0;
async function open(versionId,documentId,allowStart=true,owner='process') {
    const ownerEpoch=ownerEpochs.get(owner)||0;
    const epoch=viewEpoch;
    const actor=window.userAuth?.uid;
    try {
        const p=await api().getProcess(versionId);if(actor!==window.userAuth?.uid||epoch!==viewEpoch||ownerEpoch!==(ownerEpochs.get(owner)||0))return;
        const d=modal('Evrak onay süreci',owner),status=n('p','','ebys-process-status');status.hidden=true;status.setAttribute('role','status');d.append(status);
        const run=async(action,again=true)=>{if(document.hidden||actor!==window.userAuth?.uid||!processDialogs.get(d)?.ready)return;const controls=[...d.querySelectorAll('button')],disabled=controls.map(b=>b.disabled);controls.forEach(b=>b.disabled=true);try{await action();if(d.isConnected){d.close();if(again)await open(versionId,documentId,allowStart,owner);}}catch(e){if(e.code==='permission-denied'){closeOwned(owner);return;}status.hidden=false;status.textContent=e.message;}finally{controls.forEach((b,i)=>b.disabled=disabled[i]);}};
        if(!p&&!allowStart){d.append(n("p","Onay rotası henüz yazar tarafından başlatılmadı."));}
        else if(!p){
            d.append(n('p','Dondurulmuş sürüm için sıralı onay rotası seçin. Son onayda bu evrak türü için yönetimin tanımladığı icra sorumlusuna iş açılır. Belge sahibi onay görevine atanamaz.'));
            const preset=n('select',null,'form-select mb-2'),manual=n('option','Manuel rota');manual.value='';preset.append(manual);preset.setAttribute('aria-label','Rota şablonu');d.append(preset);
            let templates=[];
            try{templates=await api().listRouteTemplates();}catch(e){status.hidden=false;status.textContent=e.message;}
            if(!d.isConnected||actor!==window.userAuth?.uid){d.remove();return;}
            for(const t of templates){const o=n('option',t.name+' · Sürüm '+t.revision+' · '+t.id.slice(0,8));o.value=t.id;preset.append(o);}
            const list=n('div');d.append(list);
            const readRoute=()=>[...list.children].map(r=>({personnelId:r.querySelector('[data-person]').value,kind:r.querySelector('[data-kind]').value,dueHours:Number(r.querySelector('[data-hours]').value)}));
            function add(value={}){
                if(list.children.length>=6)return;
                const row=n('div',null,'d-flex flex-wrap gap-2 mb-2');row.dataset.routeStep='';
                const person=selectPerson(value.personnelId);person.dataset.person='';const kind=n('select',null,'form-select');kind.dataset.kind='';
                for(const [value,label]of Object.entries(kinds)){const o=n('option',label);o.value=value;kind.append(o);}kind.value=value.kind||'approval';
                const hours=n('input',null,'form-control');hours.type='number';hours.value=String(value.dueHours||72);hours.min='1';hours.max='720';hours.setAttribute('aria-label','Görev süresi (saat)');hours.dataset.hours='';
                row.append(person,kind,hours,btn('Çıkar',()=>row.remove()));list.append(row);
            }
            const addButton=btn('Adım ekle',()=>add());
            preset.onchange=()=>{list.replaceChildren();const template=templates.find(t=>t.id===preset.value);for(const step of template?.routeSnapshot||[{}])add(step);list.querySelectorAll('select,input,button').forEach(n=>n.disabled=!!template);addButton.disabled=!!template;};
            add();d.append(addButton,btn('Süreci başlat',()=>run(()=>api().startProcess({versionId,documentId,route:readRoute(),templateId:preset.value,operationId:crypto.randomUUID()}))));
            if(window.isDbAdmin?.()){
                const title=n('input',null,'form-control mt-2');title.placeholder='Yeni rota şablonunun adı';title.maxLength=120;title.setAttribute('aria-label','Yeni rota şablonunun adı');
                d.append(title,btn('Rotayı şablon olarak kaydet',()=>run(()=>api().createRouteTemplate({name:title.value,route:readRoute()}))));
            }
        }else{
            const summary=n('section',null,'ebys-process-summary');
            summary.append(n('span',states[p.state],'ebys-process-badge'),n('strong','Adım '+(p.currentStep+1)+' / '+p.routeSnapshot.length));
            if(p.state==='active'){
                const current=p.routeSnapshot[p.currentStep],assigned=people().find(x=>x.uid===p.activeAssigneeUid);
                const name=assigned?.name||assigned?.adSoyad||current.name||'Atanmış personel';
                summary.append(n('p','Şu anda '+name+' tarafından '+(kinds[current.kind]||'karar')+' bekleniyor.'));
                if(p.activeAssigneeUid!==current.assigneeUid)summary.append(n('small','Vekâleten işlem yapacak kişi atanmıştır. Asıl görevli: '+(current.name||current.assigneeUid)));
            }
            if (p.state === 'completed') summary.append(n('p', 'İcra ve evrak kapanışı İcra Takibi bölümünde ayrı olarak izlenir.'));
            d.append(summary,n('h4','Onay rotası','ebys-process-heading'));
            const route=n('ol',null,'ebys-process-route');
            for(const [i,step]of p.routeSnapshot.entries()){
                const active=p.state==='active'&&i===p.currentStep;
                const row=n('li',null,active?'is-current':'');if(active)row.setAttribute('aria-current','step');
                const info=n('div');info.append(n('strong',step.name||step.assigneeUid),n('small',(kinds[step.kind]||step.kind)+' · Hedef süre: '+step.dueHours+' saat'));
                const stage=i<p.currentStep?'Tamamlandı':i>p.currentStep?'Sırası bekleniyor':p.state==='completed'?'Tamamlandı':p.state==='active'?'İşlem bekliyor':states[p.state];
                row.append(n('span',String(i+1),'ebys-process-step'),info,n('span',stage,'ebys-process-step-state'));route.append(row);
            }
            d.append(route);
            if (p.lastReason && ['returned', 'rejected', 'withdrawn'].includes(p.state)) d.append(n('p', 'Gerekçe · ' + p.lastReason, 'ebys-process-panel'));
            const label=(parent,text,input)=>{const wrap=n('label',null,'ebys-process-field');wrap.append(n('span',text),input);parent.append(wrap);return input;};
            const reasonField=(parent,text)=>{const reason=n('textarea',null,'form-control');reason.rows=2;reason.maxLength=1000;reason.setAttribute('aria-label',text);label(parent,text,reason);return reason;};
            if(p.state==='active'&&p.activeAssigneeUid===actor){
                const box=n('section',null,'ebys-process-panel');box.append(n('h4','Kararınız'));
                const reason=reasonField(box,'Karar notu · İade ve red için gerekçe zorunludur');
                const actions=n('div',null,'ebys-process-actions');
                for(const [result,title]of [['approved','Onayla'],['rejected','Reddet'],['returned','Yazara iade et']]){
                    const action=btn(title,()=>run(async()=>{await api().decideTask({processId:p.id,expectedRevision:p.revision,result,reason:reason.value,operationId:crypto.randomUUID()});if(result==='returned')window.showAppAlert?.('Evrak gerekçenizle yazara iade edildi.','success');},result!=='returned'));
                    if(result==='approved')action.classList.add('ebys-process-primary');actions.append(action);
                }
                box.append(actions);d.append(box);
            }
            if(p.state==='active'&&window.isDbAdmin?.()){
                const box=n('details',null,'ebys-process-panel');box.dataset.delegation='';box.append(n('summary','Bekleyen görevi başka kişiye devret'));
                box.append(n('p','Yalnız mevcut bekleyen görevin yetkilisi değişir. Rotaya adım eklenmez; sonraki adımlar aynı sırada devam eder.','ebys-process-help'));
                const form=n('form'),grid=n('div',null,'ebys-process-grid');
                const target=selectPerson();target.setAttribute('aria-label','Vekil personel');target.required=true;
                for(const option of [...target.options]){const person=people().find(x=>String(x.id)===option.value);if(person?.uid===p.activeAssigneeUid||person?.uid===p.ownerUid)option.remove();}
                const empty=n('option','Vekil personel seçin');empty.value='';target.prepend(empty);target.value='';
                const until=n('input',null,'form-control');until.type='datetime-local';until.required=true;until.setAttribute('aria-label','Vekâlet bitişi');
                label(grid,'Vekil personel',target);label(grid,'Yetki bitiş tarihi ve saati',until);form.append(grid);
                const reason=reasonField(form,'Devir gerekçesi');reason.required=true;
                form.append(n('p','Süre dolunca görev otomatik asıl kişiye dönmez; yeniden atama gerekir. En fazla 90 gün yetki verilebilir.','ebys-process-help'));
                const submit=btn('Bekleyen görevi devret',()=>{});submit.type='submit';form.append(submit);
                form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())run(()=>api().delegateTask({processId:p.id,expectedRevision:p.revision,personnelId:target.value,validUntil:until.value,reason:reason.value,operationId:crypto.randomUUID()}));};
                box.append(form);d.append(box);
            }
            if(p.state==='active'&&p.ownerUid===actor){
                const box=n('details',null,'ebys-process-panel ebys-process-withdraw');box.dataset.withdraw='';box.append(n('summary','Süreci geri çek'));
                box.append(n('p','Aktif onay süreci durdurulur ve bekleyen görev kapatılır. Düzeltme sonrası yeni sürümle yeniden sunabilirsiniz.','ebys-process-help'));
                const form=n('form'),reason=reasonField(form,'Geri çekme gerekçesi');reason.required=true;
                const submit=btn('Süreci gerekçeyle geri çek',()=>{});submit.type='submit';form.append(submit);
                form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())run(()=>api().withdrawProcess({processId:p.id,expectedRevision:p.revision,reason:reason.value,operationId:crypto.randomUUID()}));};
                box.append(form);d.append(box);
            }
            if(p.ownerUid===actor&&['returned','rejected','withdrawn'].includes(p.state))d.append(btn('Yeni sürüm hazırla',()=>run(async()=>{const data=await window.AppModules.EBYSDocuments.readDocument(p.documentId);if(data.head.currentVersionId!==p.id)throw new Error('Bu evrak için daha yeni bir sürüm hazırlanmış.');await window.AppModules.EBYSDocuments.reopenDraft({documentId:p.documentId,expectedRevision:data.head.revision,operationId:crypto.randomUUID()});window.AppModules.EBYSDocumentsUI?.open(p.documentId);},false)));
        }
        const footer=n('footer',null,'ebys-process-footer');footer.append(n('small',p?.state==='active'?'Bu pencereyi kapatmak süreci iptal etmez.':'Pencereyi kapatabilirsiniz.'),btn('Kapat',()=>d.close()));d.append(footer);
        guardDialog(d,async()=>{
            const [current]=await Promise.all([api().getProcess(versionId),api().getVersion(versionId)]);
            return p ? current?.revision===p.revision&&current?.state===p.state&&current?.activeAssigneeUid===p.activeAssigneeUid : !current;
        });
    }catch(error){window.showAppAlert?.(error.message,'error');}
}
function renderTasks(tasks,section) {
    let alive=true;const actor=window.userAuth?.uid;
    section.replaceChildren();
    for(const t of [...tasks.filter(t=>t.state==='active').map(t=>({...t,view:'active'})),...tasks.filter(t=>t.hasDecision).map(t=>({...t,view:'history'}))]){
        const history=t.view==='history',row=n('article',null,'modern-card mb-2 ebys-task-card');
        row.dataset.versionId=t.versionId;row.dataset.documentId=t.documentId;row.dataset.taskView=t.view;
        const title=n('h4','Evrak','ebys-task-title'),meta=n('p','Konu ve sürüm için ayrıntıyı açın.','ebys-task-meta'),state=n('p','','ebys-task-state');
        row.append(n('strong',(kinds[t.kind]||t.kind)+' · '+(history?'Karar geçmişi':'Aktif görev')),title,meta,state);
        const end=window.AppModules.EBYSProcessSchema.taskExpiryMillis(t);
        if(!history){const due=t.dueAt?.toDate?.().toLocaleString('tr-TR')||'—';row.append(n('p','Hedef tamamlanma: '+due+(Date.now()>end?' · Yetki süresi dolmuş':t.dueAt?.toMillis?.()<Date.now()?' · Görev gecikti':'')));}
        if(history){
            row.append(n('p','Bu kayıt karar verdiğiniz sabit sürüme aittir. Yeni sürümlere kendiliğinden erişim sağlamaz.','ebys-task-help'));
            for(const [step,decision]of Object.entries(t.decisionsByStep||{}))row.append(n('p','Adım '+(Number(step)+1)+': '+(decision.result==='approved'?'Onaylandı':'Reddedildi')+' · '+(decision.reason||'')));
        }
        const actions=n('div',null,'ebys-task-actions');
        const decide=!history&&Date.now()<end?btn('Görev / Karar',()=>open(t.processId,t.documentId,true,'ebysMyTasks')):null;if(decide)actions.append(decide);
        const read=btn(history?'Karar verdiğim sürümü aç':'Görevdeki sürümü aç',async()=>{
            try{
                const epoch=viewEpoch;const v=await api().getVersion(t.versionId);
                if(!alive||!row.isConnected||actor!==window.userAuth?.uid||epoch!==viewEpoch)return;
                const view=modal((v.metadataSnapshot?.subject||'Evrak')+' · Sürüm '+(v.versionNo||'—'),'ebysMyTasks');guardDialog(view,async()=>{await api().getVersion(t.versionId);return true;});
                view.append(n('p',history?'Bu, karar verdiğiniz sürümdür.':'Bu, size atanmış görevin sürümüdür.','ebys-process-help'),n('p',(v.metadataSnapshot?.correspondent||'')+' · '+(v.metadataSnapshot?.date||'')),n('div',v.content,'ebys-preview-content'),btn('Kapat',()=>view.close()));
            }catch(e){if(!alive||!row.isConnected||actor!==window.userAuth?.uid)return;closeOwned('ebysMyTasks');title.textContent='Evrak';meta.textContent='Sürüm bilgisi alınamadı.';window.showAppAlert?.(e.message,'warning');}
        });
        read.disabled=!history&&Date.now()>=end;actions.append(read);row.append(actions);section.append(row);
        state.textContent='Görev kaydı: '+(t.state==='active'?'Aktif':t.state==='delegated'?'Devredildi':t.state==='cancelled'?'İptal edildi':'Kapandı')+' · Güncel süreç durumunu ayrıntıdan kontrol edin.';
        const detail=btn('Konu / sürüm / durum',async()=>{
            detail.disabled=true;
            try {
                const [p,v]=await Promise.all([api().getProcess(t.processId),api().getVersion(t.versionId)]);
                if(!alive||!row.isConnected||actor!==window.userAuth?.uid)return;
                title.textContent=v.metadataSnapshot?.subject||'Evrak';
                meta.textContent='Sürüm '+(v.versionNo||'—')+' · Evrak kimliği: '+String(t.documentId||'').slice(0,8);
                state.textContent='Kontrol anındaki süreç: '+(states[p?.state]||'Erişim kapandı')+' · '+new Date().toLocaleTimeString('tr-TR');
            }catch(error){
                if(!alive||!row.isConnected||actor!==window.userAuth?.uid)return;
                closeOwned('ebysMyTasks');title.textContent='Evrak';meta.textContent='Sürüm bilgisi alınamadı.';state.textContent=error.message;
            }finally{if(alive&&row.isConnected)detail.disabled=false;}
        });actions.append(detail);
    }
    if(!section.children.length)section.append(n('p','Aktif evrak göreviniz veya karar geçmişiniz yok.'));
    return()=>{alive=false;};
}
// Her kuyruk sunucudan 50 kayıt alır; sonraki sayfa Firestore cursor ile açılır.
function registerQueue(key, host, subscribe, render) {
    if(!host)return;
    let startQueue=null,stopQueue=null;
    const panel=host.closest('.tab-content, .admin-tab-content');
    const visible=()=>!document.hidden&&(!panel||getComputedStyle(panel).display!=='none');
    const reconcile=()=>{if(visible())startQueue?.();else stopQueue?.(document.hidden?'pause':'panel');};
    if(panel)new MutationObserver(reconcile).observe(panel,{attributes:true,attributeFilter:['style','class']});
    document.addEventListener('visibilitychange',reconcile);
    window.registerSyncListener(key,()=>{
        const actor=window.userAuth?.uid;
        let cursor = null, stop = null, stopRender = null, alive = true, generation = 0;
        const clearCards = () => {
            const cleanup = stopRender;
            stopRender = null;
            cleanup?.();
        };
        const clearQuery = () => {
            const cleanup = stop;
            stop = null;
            cleanup?.();
        };
        const load = () => {
            const current = ++generation;
            clearQuery();
            clearCards();
            host.replaceChildren();
            const unsubscribe = subscribe(rows => {
                if (!alive || current !== generation || actor!==window.userAuth?.uid) return;
                clearCards();
                stopRender = render(rows, host);
                const nav = n('div', null, 'd-flex gap-2 my-2');
                nav.append(n('small', 'Sayfa başına en fazla 50 kayıt'));
                if (cursor) nav.append(btn('İlk sayfa', () => { cursor = null; load(); }));
                if (rows.length === 50) nav.append(btn('Sonraki sayfa', () => { cursor = rows.at(-1)._cursor; load(); }));
                host.append(nav);
            }, error => {
                if (!alive || current !== generation || actor!==window.userAuth?.uid) return;
                running=false;generation++;
                clearQuery();
                clearCards();
                closeOwned(key);
                host.textContent = error.message;
            }, cursor);
            if (alive && current === generation) stop = unsubscribe;
            else unsubscribe();
        };
        let running=false;
        startQueue=()=>{if(actor!==window.userAuth?.uid){stopQueue('session');return;}if(!running){running=true;load();}};
        stopQueue=(reason='session')=>{running=false;generation++;clearQuery();clearCards();host.replaceChildren();if(reason!=='pause')closeOwned(key);};
        reconcile();
        return () => {
            startQueue=null;stopQueue?.();stopQueue=null;
            alive = false;
            clearQuery();
            clearCards();
            host.replaceChildren();
            closeOwned(key);
        };
    });
}
registerQueue('ebysMyTasks',document.getElementById('ebysMyTasks'),(...args)=>api().subscribeMyTasks(...args),renderTasks);
registerQueue('ebysMyReturned',document.getElementById('ebysMyReturned'),(...args)=>api().subscribeMyReturnedDocuments(...args),(documents,host)=>{
    host.replaceChildren();
    for (const head of documents) {
        const row = n('article', null, 'modern-card mb-2');
        row.append(n('p', states[head.state] + ' · ' + (head.registrationNo || 'Evrak ' + head.id.slice(0, 8))),
            btn('Gerekçe ve yeni sürüm', () => open(head.currentVersionId, head.id)));
        host.append(row);
    }
    if(host.children.length===0)host.append(n('p','Bu sayfada geri dönen evrakınız yok.'));
});
window.AppModules=window.AppModules||{};window.AppModules.EBYSProcessUI={open};

const clearProcessSession=()=>{viewEpoch++;closeOwned();};
window.registerSyncListener('ebysProcessDialogs',()=>clearProcessSession);
window.addEventListener('onAppLogout',clearProcessSession);
document.addEventListener('visibilitychange',()=>{
    for(const [d,record] of processDialogs){
        if(!d.isConnected){processDialogs.delete(d);continue;}
        if(record.actor!==window.userAuth?.uid){d.remove();processDialogs.delete(d);continue;}
        if(document.hidden)record.pause?.();else record.resume?.();
    }
});
