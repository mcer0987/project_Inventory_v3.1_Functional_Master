import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import puppeteer from 'puppeteer';
const clean=p=>readFileSync(p,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const evidence='scratch/ebys-q0-evidence';mkdirSync(evidence,{recursive:true});
async function fixture(before=false){
 const executablePath=process.env.CHROME_EXECUTABLE_PATH||process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
 const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<div id="approvals" class="tab-content"><section id="ebysMyTasks"></section></div><div id="returnedPanel" class="tab-content"><section id="ebysMyReturned"></section></div><div id="purchaseTab"><section id="ebysDocumentSummary"><button id="ebysCountRefresh" type="button">Toplamları yenile</button><span id="ebysCountStatus"></span><p id="ebysCountScope"></p></section><section id="ebysDocumentRegistry"></section><div id="ebysDocumentKinds"></div><select id="ebysStateFilter"><option value=""></option></select><input id="ebysDocumentSearch"><div id="ebysDocumentRows"></div><div id="ebysDocumentStatus"></div>${['New','Next','First','Export'].map(x=>`<button id="ebysDocument${x}"></button>`).join('')}${['total','draft','registered','in_review'].map(x=>`<span data-ebys-count id="ebysCount-${x}"></span>`).join('')}</div>`);
 await page.evaluate(()=>{
 window.userAuth={uid:'a'};window.AppEnv={COLLECTION_ROOT:'inventory_demo'};window.data={};window.isDbAdmin=()=>true;window.AppModules={AdminTabs:{onAny:fn=>window.tabChange=fn}};
 window.starts={};window.events={};window.stats={listeners:0,process:0,processSnapshots:0,version:0,count:0};window.pending=null;
 window.registerSyncListener=(k,fn)=>starts[k]=fn;window.showAppAlert=()=>{};
 window.fireDb={};window.doc=(db,...p)=>p.join('/');window.collection=window.doc;
 window.query=(...args)=>({args});window.where=(...a)=>a;window.orderBy=(...a)=>a;window.limit=x=>x;window.startAfter=x=>x;
 window.getDocFromServer=async path=>{if(path.includes('/ebysVersions/'))stats.version++;else stats.process++;
 if(window.pending)await window.pending;
 if(window.deny)throw Object.assign(new Error('Erişim kapandı'),{code:'permission-denied'});
 return{exists:()=>true,id:'v',data:()=>path.includes('/ebysVersions/')?{versionNo:1,metadataSnapshot:{subject:'Eski sürüm'},content:'Sabit içerik'}:{state:'active'}};};
 window.getDocs=()=>{};window.runTransaction=()=>{};window.serverTimestamp=()=>{};window.Timestamp={};
 window.getCountFromServer=async()=>{stats.count++;return{data:()=>({count:12})}};
 window.onSnapshot=(q,data,error)=>{stats.listeners++;const key=typeof q==='string'?q:q.args[0];events[key]={data,error};if(typeof q==='string'){stats.processSnapshots++;}if(typeof q==='string')data({data:()=>({state:'active'})});return()=>stats.listeners--;};
 });
 await page.addScriptTag({content:clean('src/utils/ebys-process-schema.js')});
 await page.addScriptTag({content:clean('src/utils/ebys-document-schema.js')});
 await page.addScriptTag({content:'{'+clean('src/services/ebys-process-service.js')+'}'});
 await page.addScriptTag({content:'{'+clean('src/services/ebys-document-service.js')+'}'});
 await page.addScriptTag({content:'{'+clean(process.env.EBYS_Q0_CLOSURE_BEFORE?'scratch/ebys-q0-closure-evidence/baseline/ebys-process-ui.js':before?evidence+'/baseline/ebys-process-ui.js':'src/ui/ebys-process-ui.js')+'}'});
 await page.addScriptTag({content:'{'+clean(process.env.EBYS_Q0_CLOSURE_BEFORE?'scratch/ebys-q0-closure-evidence/baseline/ebys-documents-ui.js':before?evidence+'/baseline/ebys-documents-ui.js':'src/ui/ebys-documents-ui.js')+'}'});
 return{browser,page,errors};
}
async function tasks(page,n){await page.evaluate(n=>{events['inventory_demo/ebysTasks/items'].data({docs:Array.from({length:n},(_,i)=>({id:''+i,data:()=>({id:''+i,processId:'p'+i,versionId:'v'+i,documentId:'d',state:'active',kind:'approval',validFrom:{toMillis:()=>Date.now()},validUntil:{toMillis:()=>Date.now()+86400000}})}))});},n);}
const phases=process.env.EBYS_Q0_COMPARE_BASELINE?[true,false]:[false];
const measurements=[];
test('Q0 Chrome: 1/25/50 kart önce-sonra gerçek UI ve servis SDK çağrıları',async()=>{
 for(const before of phases)for(const n of [1,25,50]){
 const f=await fixture(before);try{await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await tasks(f.page,n);await f.page.evaluate(()=>Promise.resolve());
 const stats=await f.page.evaluate(()=>({...stats}));measurements.push({before,cards:n,...stats});
 assert.equal(stats.listeners,before?n+1:1);assert.equal(stats.version,before?n:0);assert.equal(stats.process,0);
 await f.page.evaluate(()=>stopTasks());assert.equal(await f.page.evaluate(()=>stats.listeners),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}}
 writeFileSync(evidence+(process.env.EBYS_Q0_COMPARE_BASELINE?'/measurements.json':'/measurements-after.json'),JSON.stringify(measurements,null,2));
});
test('Q0 Chrome: snapshot sayaçları çoğaltmaz, açık yenileme dört sorgudur',async()=>{
 const result=[];for(const before of phases){const f=await fixture(before);try{
 await f.page.evaluate(()=>window.stopDocs=starts.ebysDocuments());
 for(let i=0;i<3;i++)await f.page.evaluate(()=>events['inventory_demo/ebysDocuments/items'].data({docs:[]}));
 await f.page.evaluate(()=>Promise.resolve());const count=await f.page.evaluate(()=>stats.count);assert.equal(count,before?12:4);
 if(!before){await f.page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Toplamları yenile').click());await f.page.evaluate(()=>Promise.resolve());assert.equal(await f.page.evaluate(()=>stats.count),8);}
 result.push({before,snapshots:3,queries:count});await f.page.evaluate(()=>stopDocs());assert.equal(await f.page.evaluate(()=>stats.listeners),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}}
 writeFileSync(evidence+(process.env.EBYS_Q0_COMPARE_BASELINE?'/counts.json':'/counts-after.json'),JSON.stringify(result,null,2));
});
test('Q0 Chrome: gizli sekme, hata, yeniden açma ve geç callback temizliği',async()=>{
 const f=await fixture();try{await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await tasks(f.page,50);
 await f.page.evaluate(()=>{window.oldEvent=events['inventory_demo/ebysTasks/items'];document.getElementById('approvals').style.display='none';});
 await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.equal(await f.page.evaluate(()=>stats.listeners),0);
 await f.page.evaluate(()=>{oldEvent.data({docs:[]});document.getElementById('approvals').style.display='block';});await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.equal(await f.page.evaluate(()=>stats.listeners),1);
 await tasks(f.page,1);await f.page.evaluate(()=>events['inventory_demo/ebysTasks/items'].error(new Error('Yetki kapandı')));assert.equal(await f.page.evaluate(()=>stats.listeners),0);assert.equal(await f.page.$$('.ebys-task-card').then(x=>x.length),0);
 await f.page.evaluate(()=>stopTasks());assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('Q0 Chrome: ayrıntı isteğe bağlı, kaldırılmış kart ve oturum geç yanıtı göstermez',async()=>{
 const f=await fixture();try{await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await tasks(f.page,1);
 await f.page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Konu / sürüm / durum').click());await f.page.waitForFunction(()=>document.querySelector('.ebys-task-title').textContent==='Eski sürüm');
 assert.deepEqual(await f.page.evaluate(()=>[stats.process,stats.version]),[1,1]);
 await f.page.evaluate(()=>{window.pending=new Promise(r=>window.finish=r);[...document.querySelectorAll('button')].find(x=>x.textContent==='Görevdeki sürümü aç').click();window.userAuth={uid:'other'};stopTasks();finish();});
 await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.equal(await f.page.$$('dialog').then(x=>x.length),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('Q0 Chrome: sayfalama, boş liste, erişim reddi ve dar ekran',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await tasks(f.page,50);
 await f.page.evaluate(()=>[...document.querySelectorAll('#ebysMyTasks button')].find(x=>x.textContent==='Sonraki sayfa').click());
 assert.equal(await f.page.evaluate(()=>stats.listeners),1);await tasks(f.page,0);
 assert.ok(await f.page.$eval('#ebysMyTasks',n=>n.textContent.includes('göreviniz veya karar geçmişiniz yok')));
 await tasks(f.page,1);await f.page.evaluate(()=>{window.deny=true;[...document.querySelectorAll('button')].find(x=>x.textContent==='Konu / sürüm / durum').click();});
 await f.page.waitForFunction(()=>document.querySelector('.ebys-task-meta').textContent==='Sürüm bilgisi alınamadı.');
 assert.equal(await f.page.$eval('.ebys-task-title',n=>n.textContent),'Evrak');
 await f.page.setViewport({width:390,height:844});await f.page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}]);
 await f.page.screenshot({path:evidence+'/fixture-mobile.png'});
 await f.page.evaluate(()=>stopTasks());assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

async function visibility(page,hidden){await page.evaluate(hidden=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'));},hidden);await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));}
async function decisionForm(page){await page.evaluate(async()=>{
 window.decisions=0;window.currentProcess={id:'p',documentId:'d',state:'active',ownerUid:'owner',activeAssigneeUid:'a',currentStep:0,revision:1,routeSnapshot:[{assigneeUid:'a',kind:'approval',dueHours:72,name:'Test kişi'}]};
 window.AppModules.EBYSProcesses.getProcess=async()=>{if(window.pendingProcess)await window.pendingProcess;if(window.rejectProcess)throw Object.assign(Error('Ret'),{code:'permission-denied'});return{...window.currentProcess};};
 window.AppModules.EBYSProcesses.decideTask=async()=>{window.decisions++;};
 await window.AppModules.EBYSProcessUI.open('p','d',true,'ebysMyTasks');document.querySelector('.ebys-process-dialog textarea').value='Kaydedilmemiş karar notu';
 });}
async function documentForm(page){await page.evaluate(async()=>{
 window.saved=0;window.AppModules.EBYSDocuments.readDocument=async()=>{if(window.rejectDocument)throw Object.assign(Error('Ret'),{code:'permission-denied'});return{head:{id:'d',kind:'incoming',ownerUid:'a',revision:1,unitId:'unit',organizationCode:'MED',state:'draft'},body:{content:'Taslak',metadata:{subject:'Konu'}}};};
 window.AppModules.EBYSDocuments.saveDraft=async()=>{window.saved++;};
 await window.AppModules.EBYSDocumentsUI.open('d');document.querySelector('dialog textarea[name=content]').value='Kaydedilmemiş evrak metni';
 });}
test('Q0-R1: gerçek karar notu gizle/göster korunur ve otomatik karar yoktur',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await decisionForm(f.page);
 assert.equal(await f.page.evaluate(()=>stats.listeners),1);await visibility(f.page,true);
 assert.equal(await f.page.evaluate(()=>stats.listeners),0);assert.equal(await f.page.$eval('.ebys-process-dialog textarea',n=>n.value),'Kaydedilmemiş karar notu');
 await visibility(f.page,false);await f.page.waitForFunction(()=>[...document.querySelectorAll('.ebys-process-dialog button')].some(b=>b.textContent==='Onayla'&&!b.disabled));
 assert.equal(await f.page.evaluate(()=>stats.listeners),1);assert.equal(await f.page.$eval('.ebys-process-dialog textarea',n=>n.value),'Kaydedilmemiş karar notu');assert.equal(await f.page.evaluate(()=>decisions),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('Q0-R2: gerçek editör metni korunur, defter 1-0-1 ve sayaç sabittir',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>window.stopDocs=starts.ebysDocuments());await documentForm(f.page);await f.page.evaluate(()=>Promise.resolve());
 const count=await f.page.evaluate(()=>stats.count);assert.equal(count,4);
 for(let i=0;i<3;i++){await visibility(f.page,true);assert.equal(await f.page.evaluate(()=>stats.listeners),0);await visibility(f.page,false);assert.equal(await f.page.evaluate(()=>stats.listeners),1);}
 assert.equal(await f.page.$eval('dialog textarea[name=content]',n=>n.value),'Kaydedilmemiş evrak metni');assert.equal(await f.page.evaluate(()=>stats.count),count);assert.equal(await f.page.evaluate(()=>saved),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('Q0-R1: iki kuyruk temizliği ilgisiz gerçek editörü ve karar formunu kaldırmaz',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await decisionForm(f.page);await documentForm(f.page);
 await f.page.evaluate(()=>{window.stopReturned=starts.ebysMyReturned();stopReturned();});
 assert.equal(await f.page.$$('.ebys-process-dialog').then(x=>x.length),1);
 await f.page.evaluate(()=>stopTasks());
 assert.equal(await f.page.$$('dialog textarea[name=content]').then(x=>x.length),1);
 await f.page.evaluate(()=>window.stopDocs=starts.ebysDocuments());await f.page.evaluate(()=>stopDocs());
 // Editör temizliği yalnız editöre aittir; görev kuyruğu formunun ayrı örneği korunur.
 await decisionForm(f.page);await f.page.evaluate(()=>tabChange('other'));
 assert.equal(await f.page.$$('.ebys-process-dialog').then(x=>x.length),1);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('Q0-R1: gizliyken logout veya UID değişimi eski formu temizler',async()=>{
 for(const logout of [true,false]){const f=await fixture();try{
 await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await decisionForm(f.page);await visibility(f.page,true);
 await f.page.evaluate(logout=>{window.userAuth={uid:'other'};if(logout)window.dispatchEvent(new Event('onAppLogout'));},logout);await visibility(f.page,false);
 assert.equal(await f.page.$$('.ebys-process-dialog').then(x=>x.length),0);assert.equal(await f.page.evaluate(()=>decisions),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}}
});
test('Q0-R1/R2: dönüşte yetki reddi ve eski yanıt formu geri getirmez',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>{window.stopTasks=starts.ebysMyTasks();window.stopDocs=starts.ebysDocuments();});await decisionForm(f.page);await documentForm(f.page);
 await f.page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Çıktı önizleme').click());
 await visibility(f.page,true);
 await f.page.evaluate(()=>{window.rejectProcess=true;window.rejectDocument=true;});await visibility(f.page,false);
 assert.equal(await f.page.$$('dialog').then(x=>x.length),0);
 await f.page.evaluate(()=>{window.rejectProcess=false;window.pendingProcess=new Promise(r=>window.finishProcess=r);window.AppModules.EBYSProcessUI.open('p','d');window.userAuth={uid:'other'};window.dispatchEvent(new Event('onAppLogout'));finishProcess();});
 await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.equal(await f.page.$$('dialog').then(x=>x.length),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
test('Q0-R2: geç sayaç yanıtı gizliye yazılmaz ve olay tekrarı dinleyici çoğaltmaz',async()=>{
 const f=await fixture();try{
 await f.page.evaluate(()=>{window.countResult=new Promise(r=>window.finishCount=r);window.getCountFromServer=async()=>{stats.count++;await countResult;return{data:()=>({count:99})}};window.stopDocs=starts.ebysDocuments();});
 await visibility(f.page,true);await f.page.evaluate(()=>finishCount());await f.page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
 assert.notEqual(await f.page.$eval('#ebysCount-total',n=>n.textContent),'99');
 await visibility(f.page,false);for(let i=0;i<3;i++){await visibility(f.page,false);await f.page.evaluate(()=>tabChange('purchaseTab'));}
 assert.equal(await f.page.evaluate(()=>stats.listeners),1);assert.equal(await f.page.evaluate(()=>stats.count),4);
 await f.page.evaluate(()=>events['inventory_demo/ebysDocuments/items'].error(Error('Sorgu hatası')));assert.equal(await f.page.evaluate(()=>stats.listeners),0);
 await f.page.evaluate(()=>tabChange('purchaseTab'));assert.equal(await f.page.evaluate(()=>stats.listeners),1);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('Q0-R1: dönüşte değişen revision eski kararı engeller',async()=>{
 const f=await fixture();try{await f.page.evaluate(()=>window.stopTasks=starts.ebysMyTasks());await decisionForm(f.page);await visibility(f.page,true);
 await f.page.evaluate(()=>currentProcess.revision++);await visibility(f.page,false);
 assert.equal(await f.page.$$('.ebys-process-dialog').then(x=>x.length),0);assert.equal(await f.page.evaluate(()=>decisions),0);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
