const puppeteer=require('puppeteer'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});try{
 const page=await browser.newPage(),errors=[];await page.setViewport({width:1280,height:900});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>errors.push('Native dialog açıldı'));
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');await page.setRequestInterception(true);page.on('request',r=>{const url=new URL(r.url()),file=path.resolve('.'+url.pathname);if(url.pathname==='/stage5-test')return r.respond({status:200,contentType:'text/html',body:html});if(url.hostname==='127.0.0.1'&&file.startsWith(process.cwd()+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.respond({status:200,contentType:file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});r.respond({status:200,body:''});});await page.goto('http://127.0.0.1/stage5-test');
 await page.evaluate(()=>{
 document.getElementById('loginModal')?.remove();
 window.userAuth={uid:'owner'};window.isDbAdmin=()=>window.userAuth.uid==='owner';window.data={personel:[{id:'a',uid:'a',name:'Aynı kişi',pri:'a.pri'},{id:'b',uid:'b',name:'Aynı kişi',pri:'b.pri'},{id:'passive',uid:'p',name:'Pasif',active:false}]};window.AppModules={};window.calls=[];window.cleanups={};window.callbacks={};window.taskContextCount=0;window.registerSyncListener=(key,fn)=>{window.cleanups[key]=fn()};window.showAppAlert=(...v)=>{window.alertResult=v};
 let process=null;window.setProcess=value=>process=value;const api=window.AppModules.EBYSProcesses={
 listRouteTemplates:async()=>[{id:'t',name:'Hazır rota',revision:1,routeSnapshot:[{personnelId:'b',kind:'consent',dueHours:24}]}],getProcess:async()=>{window.calls.push(['processRead']);if(process?.state==='returned'&&window.userAuth.uid==='b')throw Error('İade sonrası süreç erişimi kapandı');return process;},getVersion:async id=>{window.calls.push(['versionRead',id]);return{versionNo:id==='old'?1:2,metadataSnapshot:{subject:id==='old'?'İlk evrak':'Sabit sürüm',correspondent:'Kurum',date:'2026-11-03'},content:id==='old'?'Eski sürüm içeriği':'<img src=x onerror=alert(1)> Güvenli düz metin'};},
 watchTaskContext:(task,callback)=>{window.taskContextCount++;callback({versionId:task.versionId,versionNo:task.versionId==='old'?1:2,subject:task.versionId==='old'?'İlk evrak':'Yeni evrak',state:task.versionId==='old'?'returned':'active',available:true});return()=>window.taskContextCount--;},
 startProcess:async value=>{window.calls.push(['start',value]);process={id:'v',documentId:'d',versionId:'v',ownerUid:'owner',routeSnapshot:value.route.map((s,i)=>({...s,name:s.personnelId,assigneeUid:s.personnelId,stepId:'step-'+i})),state:'active',currentStep:0,activeAssigneeUid:'a',revision:1};},
 decideTask:async value=>{window.calls.push(['decide',value]);process.state=value.result==='returned'?'returned':'completed';process.activeAssigneeUid='';},withdrawProcess:async value=>window.calls.push(['withdraw',value]),delegateTask:async value=>window.calls.push(['delegate',value]),
 subscribeMyTasks:(callback,error,cursor)=>{window.callbacks.tasks=callback;window.callbacks.tasksError=error;window.calls.push(['taskCursor',cursor]);callback([]);return()=>{}},subscribeMyProcesses:(callback,error,cursor)=>{window.callbacks.processes=callback;callback([]);return()=>{}}
 };window.AppModules.EBYSDocuments={};
 document.querySelectorAll('.tab-content').forEach(n=>{n.style.display=n.id==='myApprovalsTab'?'block':'none';});document.getElementById('ebysMyTasks').closest('.tab-content').style.display='block';
 });
 await page.addScriptTag({content:fs.readFileSync('src/ui/ebys-process-ui.js','utf8').replace(/^import .*;\r?\n/gm,'')});

 assert.equal(await page.$$eval('#myApprovals .modern-approval-header-slim',nodes=>nodes.length),1);
 assert.equal(await page.$$eval('#myApprovals>.approval-queue-group',nodes=>nodes.length),2);
 assert.equal(await page.$eval('#ebysTasksHeader',n=>n.classList.contains('modern-approval-header-slim')),false);
 await page.evaluate(()=>window.AppModules.EBYSProcessUI.open('v','d'));await page.waitForSelector('dialog[open] [data-route-step]');assert.deepEqual(await page.$$eval('[data-person] option',a=>a.map(n=>n.textContent)),['Aynı kişi · a.pri','Aynı kişi · b.pri']);
 const click=async title=>page.evaluate(title=>[...document.querySelectorAll('dialog[open]:last-of-type button')].find(b=>b.textContent===title).click(),title);
 await page.select('[aria-label="Rota şablonu"]','t');assert.equal(await page.$eval('[data-person]',n=>n.disabled),true);assert.equal(await page.$eval('[data-kind]',n=>n.value),'consent');await page.select('[aria-label="Rota şablonu"]','');
 await click('Adım ekle');await page.select('[data-route-step]:nth-child(2) [data-person]','b');await click('Süreci başlat');await page.waitForFunction(()=>document.querySelector('dialog[open]')?.textContent.includes('Şu anda'));

 assert.equal(await page.evaluate(()=>window.calls.find(x=>x[0]==='start')[1].route[1].personnelId),'b');
 assert.equal(await page.$eval('dialog[open] [data-delegation]',n=>n.open),false);assert.equal(await page.$eval('dialog[open] [data-withdraw]',n=>n.open),false);
 assert.match(await page.$eval('dialog[open] .ebys-process-footer',n=>n.textContent),/kapatmak süreci iptal etmez/);
 assert.equal(await page.$eval('.ebys-process-route li',n=>n.getAttribute('aria-current')),'step');
 await page.click('[data-delegation] summary');assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('dialog[open] [aria-label="Vekil personel"] option')].map(x=>x.value)),['','b']);
 await page.select('[aria-label="Vekil personel"]','b');await page.$eval('[aria-label="Vekâlet bitişi"]',n=>n.value='2026-11-05T12:00');await page.type('[data-delegation] textarea','Geçici izin');
 await page.$eval('[data-delegation] form',n=>n.requestSubmit());await page.waitForFunction(()=>window.calls.some(x=>x[0]==='delegate'));
 assert.equal(await page.evaluate(()=>window.calls.find(x=>x[0]==='delegate')[1].personnelId),'b');
 await page.waitForSelector('dialog[open] [data-delegation]');await page.$eval('dialog[open] [data-delegation]',n=>n.open=true);
 await page.screenshot({path:'scratch/ebys-stage5-process-ux.png'});
 await click('Kapat');assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='withdraw').length),0);

 await page.evaluate(()=>{window.userAuth={uid:'a'};window.callbacks.tasks([{id:'v__a',processId:'v',versionId:'v',documentId:'d',kind:'approval',state:'active',hasDecision:false,validUntil:{toMillis:()=>Date.now()+10000},dueAt:{toDate:()=>new Date()}}]);});
 assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/Aktif görev/);await page.evaluate(()=>[...document.querySelectorAll('#ebysMyTasks button')].find(b=>b.textContent.includes('sürümü aç')).click());await page.waitForSelector('dialog[open] .ebys-preview-content');assert.equal(await page.$('dialog img'),null);assert.match(await page.$eval('.ebys-preview-content',n=>n.textContent),/<img/);await page.keyboard.press('Escape');
 await page.evaluate(()=>window.AppModules.EBYSProcessUI.open('v','d'));await page.waitForFunction(()=>document.querySelector('dialog[open]')?.textContent.includes('Yazara iade et'));await click('Onayla');await page.waitForFunction(()=>document.querySelector('dialog[open]')?.textContent.includes('Kurum içi onay tamamlandı'));assert.equal(await page.evaluate(()=>window.calls.filter(x=>x[0]==='decide').length),1);await page.keyboard.press('Escape');
 await page.evaluate(()=>window.callbacks.tasks([{id:'old__a',processId:'old',versionId:'old',documentId:'d',kind:'paraf',state:'closed',hasDecision:true,decisionsByStep:{0:{result:'approved',reason:'İlk karar'},2:{result:'approved',reason:'İkinci karar'}}}]));assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/Adım 1: Onaylandı/);assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/Adım 3: Onaylandı/);

 assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/Sürüm 1/);assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/yazara iade edildi/);
 await page.evaluate(()=>[...document.querySelectorAll('#ebysMyTasks button')].find(b=>b.textContent==='Karar verdiğim sürümü aç').click());await page.waitForSelector('dialog[open] .ebys-preview-content');assert.equal(await page.$eval('dialog[open] .ebys-preview-content',n=>n.textContent),'Eski sürüm içeriği');assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='versionRead').at(-1)[1]),'old');await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.userAuth={uid:'b'};window.setProcess({id:'return',documentId:'d',versionId:'old',ownerUid:'owner',state:'active',currentStep:1,revision:2,activeAssigneeUid:'b',routeSnapshot:[{name:'A',assigneeUid:'a',kind:'paraf',dueHours:3},{name:'B',assigneeUid:'b',kind:'approval',dueHours:5}]});window.alertResult=null;});
 await page.evaluate(()=>window.AppModules.EBYSProcessUI.open('return','d'));await page.waitForSelector('dialog[open] textarea');await page.type('dialog[open] textarea','Düzeltme gerekli');const beforeReads=await page.evaluate(()=>window.calls.filter(c=>c[0]==='processRead').length);
 await click('Yazara iade et');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='processRead').length),beforeReads);assert.equal(await page.evaluate(()=>window.alertResult[1]),'success');
 await page.evaluate(()=>window.userAuth={uid:'a'});
 assert.equal(await page.evaluate(()=>!!(document.getElementById('ebysTasksHeader').compareDocumentPosition(document.getElementById('ebysMyTasks'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 await page.setViewport({width:390,height:844});assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#myApprovals .approval-queue-group')].every(n=>n.getBoundingClientRect().right<=innerWidth)));await page.evaluate(()=>window.AppModules.EBYSProcessUI.open('v','d'));await page.waitForSelector('dialog[open]');assert.ok(await page.$eval('dialog[open]',n=>n.getBoundingClientRect().right<=innerWidth));await page.screenshot({path:'scratch/ebys-stage5-mobile.png'});await page.mouse.click(2,2);await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 await page.evaluate(()=>window.callbacks.tasks(Array.from({length:50},(_,i)=>({id:String(i),state:'closed',hasDecision:false,_cursor:'cursor-'+i}))));await page.evaluate(()=>[...document.querySelectorAll('#ebysMyTasks button')].find(b=>b.textContent==='Sonraki sayfa').click());assert.equal(await page.evaluate(()=>window.calls.at(-1)[1]),'cursor-49');

 await page.setViewport({width:1280,height:1000});
 await page.evaluate(()=>{
    window.callbacks.tasks([{id:'v__a',processId:'v',versionId:'v',documentId:'doc-a',kind:'paraf',state:'active',hasDecision:false,validUntil:{toMillis:()=>Date.now()+10000},dueAt:{toDate:()=>new Date()}},{id:'old__a',processId:'old',versionId:'old',documentId:'doc-b',kind:'paraf',state:'closed',hasDecision:true,decisionsByStep:{0:{result:'approved',reason:'İlk test onaylandı'}}}]);
    const legacy=document.createElement('article');legacy.className='modern-card';legacy.textContent='Satın alma talebi · Onay bekliyor';document.getElementById('myApprovalsContainer').replaceChildren(legacy);
 });
 const grouping=await page.$eval('#myApprovals',host=>{const hero=host.querySelector('.modern-approval-header-slim').getBoundingClientRect(),groups=[...host.querySelectorAll('.approval-queue-group')].map(n=>n.getBoundingClientRect());return{mainAbove:hero.bottom<=groups[0].top,gap:groups[1].top-groups[0].bottom};});assert.equal(grouping.mainAbove,true);assert.ok(grouping.gap>=30);
 await page.$eval('#myApprovals',n=>n.scrollIntoView());await page.$eval('#myApprovals',n=>{n.style.display='block';});await (await page.$('#myApprovals')).screenshot({path:'scratch/ebys-approvals-hierarchy.png'});

 assert.equal(await page.evaluate(()=>window.taskContextCount),2);
 await page.evaluate(()=>window.callbacks.tasksError({code:'failed-precondition',message:'Test sorgu hatası'}));
 assert.equal(await page.evaluate(()=>window.taskContextCount),0);
 assert.match(await page.$eval('#ebysMyTasks',n=>n.textContent),/Test sorgu hatası/);
 await page.evaluate(()=>window.callbacks.tasks([{id:'stale',state:'active'}]));
 assert.equal(await page.evaluate(()=>window.taskContextCount),0);
 await page.evaluate(()=>Object.values(window.cleanups).forEach(fn=>fn()));assert.equal(await page.$eval('#ebysMyTasks',n=>n.children.length),0);assert.deepEqual(errors,[]);console.log('Aşama 5 UI: UID ayırımı, pasif filtre, rota, karar, sürümün düz metni, çoklu karar geçmişi, cursor, mobil modal, Escape/backdrop ve çıkış temizliği geçti. pageerror=0');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
