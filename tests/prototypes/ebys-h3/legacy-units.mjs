// Read-only, local JSON analysis. No Firebase import, write API, or migration.
import { readFileSync } from 'node:fs';
const key = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');
export function analyzeUnits({ root, units, purchases }) {
    const local = units.filter(u=>u.root===root);
    return purchases.map(p=>{
        const id=String(p.pathId);const explicit=p.unitId==null?'':String(p.unitId);
        let candidates=explicit ? local.filter(u=>String(u.pathId)===explicit) : local.filter(u=>key(u.name)===key(p.birim));
        let classification;
        if(p.root!==root) { candidates=[];classification='different_root'; }
        else if(explicit) classification=candidates.length!==1?'missing_id':candidates[0].active===false?'inactive_id':'already_identified';
        else classification=candidates.length===0?'unmatched':candidates.length>1?'ambiguous':candidates[0].active===false?'inactive_candidate':'unique_candidate';
        return {purchasePathId:id,storedId:p.id??null,classification,
            candidates:candidates.map(u=>({unitId:String(u.pathId),name:u.name,code:u.code??'',organizationId:u.organizationId??'',parentUnitId:u.parentUnitId??'',active:u.active!==false})),
            automaticWrite:false,requiresReview:classification!=='already_identified'};
    });
}
export const demo={root:'inventory_demo',units:[
    {root:'inventory_demo',pathId:'bt',id:'old-bt',name:'Bilgi Teknolojileri',code:'BT',organizationId:'kurum',active:true},
    {root:'inventory_demo',pathId:'f1',name:'Fakülte Sekreterliği',code:'TIP',parentUnitId:'tip',active:true},
    {root:'inventory_demo',pathId:'f2',name:'Fakülte Sekreterliği',code:'DIS',parentUnitId:'dis',active:true},
    {root:'inventory_demo',pathId:'retired',name:'Eski Birim',active:false},
    {root:'inventory_demo',pathId:'42',id:42,name:'Mali İşler',code:'ML',active:true},
    {root:'lifeserver_master',pathId:'foreign',name:'Yabancı Birim',active:true}
],purchases:[
    {root:'inventory_demo',pathId:'1',id:1,unitId:'bt',birim:'Eski BT adı'},
    {root:'inventory_demo',pathId:'2',birim:'  BİLGİ TEKNOLOJİLERİ '},
    {root:'inventory_demo',pathId:'3',birim:'Fakülte Sekreterliği'},
    {root:'inventory_demo',pathId:'4',birim:'Eski Birim'},
    {root:'inventory_demo',pathId:'5',birim:'Yabancı Birim'},
    {root:'inventory_demo',pathId:'6',unitId:'removed',birim:'Bilgi Teknolojileri'},
    {root:'inventory_demo',pathId:'7',unitId:42,birim:'Mali İşler'},
    {root:'lifeserver_master',pathId:'8',unitId:'bt',birim:'Bilgi Teknolojileri'},
    {root:'inventory_demo',pathId:'9',unitId:'retired',birim:'Eski Birim'}
]};
if(process.argv[1]?.endsWith('legacy-units.mjs')) {
    const input=process.argv[2]?JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')):demo;
    console.log(JSON.stringify({source:process.argv[2]?'local-file':'demo-fixture',root:input.root,rows:analyzeUnits(input)},null,2));
}
