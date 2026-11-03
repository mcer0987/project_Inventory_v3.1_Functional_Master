const puppeteer=require('puppeteer'), fs=require('fs'), assert=require('node:assert/strict');
(async()=>{
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
 try{
  const page=await browser.newPage(), errors=[];await page.setViewport({width:1280,height:900});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>{throw Error('Native confirm açıldı');});
  const html=fs.readFileSync('admin.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  await page.setRequestInterception(true);page.on('request',r=>{
   const url=new URL(r.url());if(url.pathname==='/ebys-ui-test')return r.respond({status:200,contentType:'text/html',body:html});
   const path=require('path'),file=path.resolve('.'+url.pathname);if(url.hostname==='127.0.0.1'&&file.startsWith(process.cwd()+path.sep)&&fs.existsSync(file))return r.respond({status:200,contentType:file.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(file)});
   r.respond({status:200,body:''});
  });
  await page.goto('http://127.0.0.1/ebys-ui-test');
  await page.addScriptTag({content:fs.readFileSync('src/utils/dialog-stack.js','utf8')});
  await page.addScriptTag({content:fs.readFileSync('src/utils/alert.js','utf8')});
  await page.addScriptTag({content:fs.readFileSync('src/utils/ebys-document-schema.js','utf8')});
  await page.evaluate(()=>{
   document.getElementById('admin-premium-loader')?.remove();document.querySelectorAll('.admin-content-hidden').forEach(n=>{n.classList.remove('admin-content-hidden');n.classList.add('admin-content-visible');});
   document.querySelectorAll('.admin-tab-content').forEach(n=>{n.style.display=n.id==='purchaseTab'?'block':'none';if(n.id==='purchaseTab')n.classList.add('active');});
   window.userAuth={uid:'author'};window.data={units:[{id:'u',name:'Birim A',active:true}]};
   let saved=null;window.AppModules.EBYSDocuments={
    listDocuments:(onData,onError,cursor,kind)=>{window.lastKind=kind;onData(saved?[saved.head]:[]);return()=>{}},
    countDocuments:async()=>({total:120,draft:70,registered:40,in_review:10}),
    saveDraft:async input=>{saved={head:{...input,ownerUid:'author',state:'draft',revision:1},body:{content:input.content,metadata:input.metadata}};return{documentId:input.id,revision:1}},
    readDocument:async()=>saved,
    freezeVersion:async()=>{saved.head.currentVersionId='version';saved.head.state='in_review';saved.body.metadataSnapshot=saved.body.metadata;saved.body.contentDigest='a'.repeat(64);return{}},
    registerDocument:async()=>({registrationNo:'EBYS-MED-261102-ABC',revision:2}),
   };window.AppModules.AdminTabs={onAny:fn=>{window.showTab=fn}};window.registerSyncListener=(key,fn)=>{window.cleanup=fn()};
  });
  await page.addScriptTag({content:fs.readFileSync('src/ui/ebys-documents-ui.js','utf8').replace(/^import .*;\r?\n/gm,'')});
  assert.equal(await page.evaluate(()=>window.lastKind),'incoming');
  await page.waitForFunction(()=>document.getElementById('ebysCount-total').textContent==='120');
  assert.deepEqual(await page.$$eval('[data-ebys-count]',nodes=>nodes.map(n=>n.textContent)),['120','70','40','10']);
  assert.equal(await page.evaluate(()=>document.querySelector('#purchaseTab h2').compareDocumentPosition(document.getElementById('ebysDocumentRegistry'))&Node.DOCUMENT_POSITION_FOLLOWING),4);
  await page.click('#ebysDocumentKinds button:nth-child(2)');assert.equal(await page.evaluate(()=>window.lastKind),'outgoing');
  await page.click('#ebysDocumentNew');
  const layout=await page.$eval('dialog',n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,height:r.height,grid:getComputedStyle(n.querySelector('form')).gridTemplateColumns.split(' ').length,body:n.querySelector('[name=content]').parentElement.classList.contains('ebys-wide'),distribution:n.querySelector('[name=distribution]').parentElement.classList.contains('ebys-wide')};});
  assert.ok(Math.abs(layout.x-640)<2&&Math.abs(layout.y-450)<2,JSON.stringify(layout));assert.ok(layout.height<=765);assert.equal(layout.grid,2);assert.equal(layout.body,true);assert.equal(layout.distribution,false);
  await page.click('.ebys-dialog-close');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.click('#ebysDocumentNew');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.click('#ebysDocumentNew');await page.mouse.click(5,5);await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.click('#ebysDocumentNew');
  await page.select('dialog select[name=unitId]','u');
  for(const [name,value] of Object.entries({subject:'Deneme üst yazı',correspondent:'Kurum A',filePlanCode:'934',content:'Sayın ilgili,\nİşlem yapılmasını rica ederim.'}))await page.type(`dialog [name=${name}]`,value);
  await page.$eval('dialog[open]',n=>{n.scrollTop=0;});await page.screenshot({path:'scratch/ebys-stage4-form-ux.png'});
  await page.evaluate(()=>[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Taslağı kaydet').click());
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.click('#ebysDocumentRows button');
  await page.waitForFunction(()=>document.querySelector('dialog[open] input[name=subject]')?.value==='Deneme üst yazı');
  await page.evaluate(()=>[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Onaya sun / Dondur').click());
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('customAlertOverlay')).display==='flex');
  assert.equal(await page.$('dialog[open]'),null);await page.click('#alertCancelBtn');
  await page.waitForFunction(()=>document.querySelector('dialog[open] input[name=subject]')?.value==='Deneme üst yazı');
  await page.evaluate(()=>[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Onaya sun / Dondur').click());
  await page.click('#alertConfirmBtn');
  await page.waitForFunction(()=>document.querySelector('dialog[open] textarea[name=content]')?.disabled===true);
  await page.evaluate(()=>[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Çıktı önizleme').click());
  assert.match(await page.$eval('.ebys-preview',n=>n.textContent),/Deneme üst yazı/);

  await page.evaluate(()=>window.showTab('purchaseTab'));
  const actionLayout=await page.$eval('#ebysDocumentRows .ebys-registry-actions',n=>{const b=[...n.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return{display:getComputedStyle(n).display,count:b.length,separated:b.length===2&&(b[1].left-b[0].right>=7||b[1].top-b[0].bottom>=7)};});
  assert.equal(actionLayout.display,'flex');assert.equal(actionLayout.count,2);assert.equal(actionLayout.separated,true);
  await page.evaluate(()=>window.cleanup());
  assert.equal(await page.$eval('#ebysDocumentRows',n=>n.children.length),0);
  await page.setViewport({width:390,height:844});await page.evaluate(()=>document.getElementById('ebysDocumentNew').click());await page.waitForSelector('dialog[open] .ebys-document-form');
  assert.equal(await page.$eval('.ebys-document-form',n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
  assert.ok(await page.$eval('dialog[open]',n=>n.getBoundingClientRect().right<=innerWidth));await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('Evrak UI/UX: ortalama, 2 kolon, 85vh sınırı, X/Escape/backdrop, kurumsal onay/iptal, kayıtta kapanma, KPI, sayfa sırası ve çıktı önizleme geçti. pageerror=0');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
