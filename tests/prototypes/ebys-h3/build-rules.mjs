import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const BASE_SHA256 = 'b73a9f2dd06044a12cfcefc3da11341fc6cc1df3e3a56ae8d14769666c9a562e';
export const output = 'scratch/ebys-h3a-evidence/candidate.rules';
export function replaceExact(source, before, after, expected = 1) {
    const count = source.split(before).length - 1;
    if (count !== expected) throw Error(`Yama eşleşmedi: ${count}/${expected}: ${before.slice(0, 100)}`);
    return source.split(before).join(after);
}
export function buildRules() {
    const raw = readFileSync('firestore.rules');
    if (createHash('sha256').update(raw).digest('hex') !== BASE_SHA256) throw Error('Rules tabanı değişti; yama yeniden incelenmeli.');
    let source = raw.toString().replace(/\r\n/g, '\n');
    const patches = [];
    const patch = (before, after, count = 1) => { source = replaceExact(source, before, after, count); patches.push({ before, after, count }); };
    // Extract the four existing expressions unchanged (apart from binding col to
    // purchaseOrders). A single role/motor dispatcher avoids evaluating both
    // generic role branches plus the new branch for every legacy request.
    const originals=[...source.matchAll(/allow (create|update): if \(col == 'purchaseOrders' \|\| \(!col.matches\('ebys\.\*'\) && (knownCol|staffWritable)\(col\)\)\)[\s\S]*?;/g)];
    if(originals.length!==4)throw Error('Dört özgün satın alma yazma dalı bekleniyor.');
    const legacyFunctions=[];
    for(const [full,kind,collectionTest] of originals){
        const role=collectionTest==='knownCol'?'Admin':'Staff';
        let body=full.slice(full.indexOf('if ')+3,-1);
        body=replaceExact(body,`(col == 'purchaseOrders' || (!col.matches('ebys.*') && ${collectionTest}(col)))\n        && `,'');
        if(role==='Staff' && kind==='create')body=replaceExact(body,`(col == 'requests' ? requestCreateOk(root, request.resource.data)
            : col == 'purchaseOrders' ? poPathId(docId,request.resource.data) && poCreateOk(root, request.resource.data)
            : (request.resource.data.get('creatorUid', '') == request.auth.uid
                && request.resource.data.get('creatorId', '') == staffName(root)))`,
            'poPathId(docId,request.resource.data) && poCreateOk(root, request.resource.data)');
        if(role==='Staff' && kind==='update'){
            body=replaceExact(body,'ownerUnchanged(col, request.resource.data, resource.data)',"request.resource.data.get('createdByUid',null) == resource.data.get('createdByUid',null)");
            body=replaceExact(body,`(col == 'requests' ? textOk(col, request.resource.data) && requestUpdateOk(resource.data, request.resource.data)
            : col == 'purchaseOrders' ? `,'(');
            body=replaceExact(body,`\n            : textOk(col, request.resource.data) && taskUpdateOk(resource.data, request.resource.data))`,')');
        }
        body=body.replace(/\broot\b/g,'r').replace(/\bdocId\b/g,'id').replace(/\bcol\b/g,"'purchaseOrders'");
        legacyFunctions.push(`    function h3Old${role}${kind==='create'?'Create':'Update'}(r,id) { return ${body}; }`);
        patch(full,full.replace('if (',"if col == 'purchaseOrders' ? false : ("));
    }
    // Same legacy identity checks, one account->person lookup for both display
    // name and createdBy. No author/UID/name condition is removed.
    patch(`function poCreateOk(root, d) {
      let wf = d.get('workflow', {});
      let me = staffName(root);`,
    `function poCreateOk(root, d) {
      let wf = d.get('workflow', {});
      let pid = staffPid(root);
      let me = h3StaffNameByPid(root,pid);`);
    patch("&& string(d.get('createdBy', '')) == staffPid(root)","&& string(d.get('createdBy', '')) == pid");
    patch("allow delete: if validRoot(root) && knownCol(col) && isAdmin(root) && !(col in ['units', 'personel']);",
        "allow delete: if validRoot(root) && knownCol(col) && isAdmin(root) && !(col in ['units', 'personel'])\n        && (col != 'purchaseOrders' || h3Legacy(resource.data));");
    patch("(col != 'purchaseOrders' || isAdmin(root) || lpRead(root,docId,resource.data,request.auth.uid))",
        "(col != 'purchaseOrders' ? true : resource == null ? false : isAdmin(root) || (h3New(resource.data) ? resource.data.createdByUid == request.auth.uid : lpRead(root,docId,resource.data,request.auth.uid)))");
    patch("'lastOperationId','createdAt','updatedAt'])\n        && d.id == id", "'lastOperationId','createdAt','updatedAt','purchaseOrderId'])\n        && d.id == id");
    patch('&& request.resource.data.createdAt == request.time && ebysDraftHead(r, request.resource.data);',
        '&& request.resource.data.createdAt == request.time && h3HeadCreate(r,id,request.resource.data) && ebysDraftHead(r, request.resource.data);');
    patch('return ebysHead(d, old.id) && d.ownerUid == old.ownerUid',
        "return ebysHead(d, old.id) && d.get('purchaseOrderId','') == old.get('purchaseOrderId','') && d.ownerUid == old.ownerUid");
    patch("'content','metadata','attachments','attachmentMode','updatedAt'])", "'content','metadata','attachments','attachmentMode','updatedAt','purchaseSnapshot'])");
    patch("&& h.state in ['draft','registered'] && ebysCommand(r,h,'saveDraft')", "&& h.state in ['draft','registered'] && h3Draft(r,h,d) && ebysCommand(r,h,'saveDraft')");
    patch("'contentDigest','createdAt'])\n        && ebysOwn", "'contentDigest','createdAt','purchaseSnapshot','unitSnapshot'])\n        && ebysOwn");
    patch('d.schemaVersion == 1 && d.versionNo == h.versionNo', 'h3Version(r,h,d,draft) && d.versionNo == h.versionNo');
    patch("'lastReason','createdAt','updatedAt'])\n        && p.updatedAt", "'lastReason','createdAt','updatedAt','purchaseOrderId'])\n        && p.updatedAt");
    patch('&& epCommand(r,request.resource.data) && epActivation(r,request.resource.data);',
        '&& h3ProcessStart(r,id,request.resource.data) && epCommand(r,request.resource.data) && epActivation(r,request.resource.data);');
    patch('return epBase(n,p.id) && epCommand(r,n) && p.state', 'return epBase(n,p.id) && h3FirstFinance(r,p,n) && epCommand(r,n) && p.state');
    // Same permissions, disjoint command dispatch. Do not evaluate expensive author-edit
    // rules for an assignee's terminal transition (especially on rejected writes).
    patch(`allow update: if (ebysOwn(r, resource.data) && ebysHeadUpdate(r, resource.data, request.resource.data))
        || (validRoot(r) && member(r) && (request.resource.data.get('verificationToken','') != resource.data.get('verificationToken','')
          ? evIssueHead(r,resource.data,request.resource.data)
          : request.resource.data.state in ['closed','archived']
            ? ejCloseOrArchive(r,resource.data,request.resource.data)
            : epHeadTransition(r,resource.data,request.resource.data)));`,
    `allow update: if validRoot(r) && member(r) && (request.resource.data.get('verificationToken','') != resource.data.get('verificationToken','')
          ? evIssueHead(r,resource.data,request.resource.data)
          : request.resource.data.state in ['closed','archived']
            ? ejCloseOrArchive(r,resource.data,request.resource.data)
            : request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state','revision','updatedAt'])
              ? epHeadTransition(r,resource.data,request.resource.data)
              : resource.data.ownerUid == request.auth.uid && ebysHeadUpdate(r,resource.data,request.resource.data));`);
    const extension = legacyFunctions.join('\n')+'\n'+readFileSync(new URL('./extension.rules', import.meta.url), 'utf8');
    patch('    // V1 arşiv kilidi.', `${extension}\n    // V1 arşiv kilidi.`);
    mkdirSync('scratch/ebys-h3a-evidence', { recursive: true });
    writeFileSync(output, source);
    writeFileSync('scratch/ebys-h3a-evidence/rules-patches.json', JSON.stringify({ baseHash: BASE_SHA256, candidateHash: createHash('sha256').update(source).digest('hex'), patches }, null, 2));
    return source;
}
if (process.argv[1]?.endsWith('build-rules.mjs')) { buildRules(); console.log(output); }
