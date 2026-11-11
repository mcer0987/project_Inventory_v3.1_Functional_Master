import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const window = { AppModules: {} };
const sandbox = vm.createContext({ window, crypto: webcrypto, TextEncoder });
for (const name of ['ebys-purchase-schema', 'purchase-money', 'ebys-document-schema']) {
    const file = 'src/utils/' + name + '.js';
    vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file });
}
const s = window.AppModules.EBYSPurchaseSchema;
const documentSchema = window.AppModules.EBYSDocumentSchema;
const plain = value => JSON.parse(JSON.stringify(value));
const root = 'inventory_demo', foreignRoot = 'lifeserver_master';
const P = '00000000-0000-4000-8000-000000000001';
const V1 = '00000000-0000-4000-8000-000000000002';
const V2 = '00000000-0000-4000-8000-000000000003';
const operationId = '00000000-0000-4000-8000-000000000004';
const context = { root, purchaseOrderId: P, ownerUid: 'requester' };
const timestamp = Object.freeze({ seconds: 1_800_000_000, nanoseconds: 0 });
const at = (pathId, data, documentRoot = root) => ({ root: documentRoot, pathId, data });
const unit = (pathId, name, data = {}, unitRoot = root) => at(pathId, { name, ...data }, unitRoot);
const chosenUnit = () => unit('0042', 'Bilgi İşlem', {
    id: 42, code: 'BT', organizationId: 'uni', parentUnitId: 'merkez', active: true, personnelIds: ['personel-1']
});
const marker = () => s.createPurchaseMarker(context, { unit: chosenUnit(), revision: 2, createdAt: timestamp, updatedAt: timestamp });
const line = (id, currency, quantity, unitPrice, taxRate) => ({
    id, currency, quantity, unitPrice, taxRate, description: 'Laboratuvar malzemesi', category: 'Sarf', unit: 'Adet'
});
const proposal = () => ({
    purchaseOrderId: P, documentTypeCode: 'PURCHASE_REQUEST',
    items: [line('a', 'TRY', 0.125, 1.24, 12.5), line('b', 'USD', 2, 10.11, 20), line('c', 'EUR', 3, 10.11, 20)],
    budgetMode: 'manual', butce: 2600.25, calculationVersion: 1
});
const metadata = () => ({
    subject: 'Sarf isteği', correspondent: 'İlgili birim', date: '2026-11-10', filePlanCode: '934.01',
    confidentiality: 'Normal', distribution: '', externalRegistrationNo: ''
});
function version(versionId, purchaseSnapshot = s.normalizePurchaseSnapshot(P, proposal()), source = chosenUnit()) {
    return at(versionId, { id: versionId, processId: versionId, documentId: P, ownerUid: context.ownerUid,
        versionNo: versionId === V1 ? 1 : 2, schemaVersion: 2, content: 'Talep metni', metadataSnapshot: metadata(),
        attachments: [], attachmentMode: 'none', purchaseSnapshot, unitSnapshot: s.createUnitSnapshot(root, source, 'MED') });
}
const rates = (USD = 35, EUR = 40) => ({ TRY: 1, USD, EUR });
const rateConfig = () => ({ rates: rates(), date: '2026-11-10', source: 'Operasyon Merkezi' });
const finance = (v, changes = {}) => ({
    schemaVersion: 2, purchaseOrderId: P, versionId: v.pathId, contentDigest: v.data.contentDigest, actorUid: 'approver',
    operationId, exchangeRate: rates(), exchangeRateDate: '2026-11-10', exchangeRateSource: 'Operasyon Merkezi',
    reportingTotalTRY: 2305.28, createdAt: timestamp, ...changes
});

test('legacy kimlikleri kayıpsız çözer, geçersiz girdileri ayırır', () => {
    for (const [value, id] of [[42, '42'], [0, '0'], ['0042', '0042'], [' 42 ', ' 42 ']]) {
        assert.deepEqual(plain(s.normalizeLegacyId(value)), { kind: 'valid', id });
    }
    for (const [value, kind] of [[undefined, 'absent'], [null, 'null'], ['', 'empty'], [' ', 'invalid'],
        [[], 'invalid'], [{ id: 42 }, 'invalid'], [NaN, 'invalid'], [1.2, 'invalid'], [2 ** 53, 'invalid'],
        ['a/b', 'invalid'], ['..', 'invalid'], ['__reserved__', 'invalid'], ['a'.repeat(1501), 'invalid']]) {
        assert.equal(s.normalizeLegacyId(value).kind, kind);
    }
});

test('legacy birim sınıfları kök ve belge yoluyla çözülür, ad eşleşmesi yazma yetkisi vermez', () => {
    const units = [chosenUnit(), unit('42', 'Sayısal yol', { id: '0042' }),
        unit('f1', 'Fakülte', { code: 'TIP' }), unit('f2', 'Fakülte', { code: 'DİŞ' }),
        unit('old', 'Eski Birim', { active: false }), at('missing', null), unit('x', 'Yabancı', {}, foreignRoot)];
    const before = plain(units);
    const cases = [
        [{ unitId: '0042', birim: 'Tarihsel ad' }, 'already_identified', ['0042']],
        [{ unitId: 42 }, 'already_identified', ['42']],
        [{ birim: '  BİLGİ   İŞLEM  ' }, 'unique_candidate', ['0042']],
        [{ birim: 'Fakülte' }, 'ambiguous', ['f1', 'f2']],
        [{ unitId: null, birim: 'Eski Birim' }, 'inactive_candidate', ['old']],
        [{ unitId: 'old' }, 'inactive_id', ['old']],
        [{ birim: 'Yabancı' }, 'unmatched', []],
        [{ unitId: 'x', birim: 'Bilgi İşlem' }, 'missing_id', []],
        [{ unitId: 'missing', birim: 'Bilgi İşlem' }, 'missing_id', []],
        [{ unitId: {}, birim: 'Bilgi İşlem' }, 'missing_id', []],
        [{ root: foreignRoot, unitId: '0042' }, 'different_root', []]
    ];
    for (const [fields, classification, ids] of cases) {
        const purchase = Object.freeze({ root, ...fields });
        const result = s.matchLegacyUnit(root, purchase, units);
        assert.equal(result.classification, classification);
        assert.deepEqual(Array.from(result.candidates, candidate => candidate.unitId), ids);
        assert.equal(result.automaticWrite, false);
        assert.equal(result.requiresReview, classification !== 'already_identified');
    }
    assert.deepEqual(units, before);
});

test('saf seçim verisi eşadlı birimleri ayırır ve künye kaynaktan bağımsızdır', () => {
    const original = chosenUnit();
    const options = s.unitOptions(root, [original, unit('abcdefgh1', 'Fakülte', { code: 'TIP', parentUnitId: 'A' }),
        unit('abcdefgh2', 'Fakülte', { code: 'TIP', parentUnitId: 'A' }),
        unit('b', 'Fakülte', { code: 'DİŞ', organizationId: 'uni2', parentUnitId: 'B' }),
        unit('old', 'Pasif', { active: false }), unit('x', 'Yabancı', {}, foreignRoot)]);
    assert.deepEqual(Array.from(options, option => option.label), [
        'Bilgi İşlem', 'Fakülte · TIP · A [abcdefgh1]', 'Fakülte · TIP · A [abcdefgh2]', 'Fakülte · DİŞ · uni2 · B'
    ]);
    const snapshot = s.createUnitSnapshot(root, original, 'MED');
    const created = s.createPurchaseMarker(context, { unit: original, revision: 2, createdAt: timestamp, updatedAt: timestamp });
    assert.equal(original.data.id, 42);
    original.data.name = 'Yeni ad';
    original.data.code = 'YENİ';
    assert.deepEqual(plain(snapshot), {
        unitId: '0042', name: 'Bilgi İşlem', code: 'BT', organizationId: 'uni', organizationCode: 'MED', source: 'units'
    });
    assert.equal(created.birim, 'Bilgi İşlem');
    assert.equal(created.unitId, '0042');
    assert.throws(() => s.createUnitSnapshot(root, unit('old', 'Pasif', { active: false }), 'MED'));
    assert.throws(() => s.createUnitSnapshot(root, unit('x', 'Yabancı', {}, foreignRoot), 'MED'));
    assert.throws(() => s.createUnitSnapshot(root, at('missing', null), 'MED'));
    assert.throws(() => s.createUnitSnapshot(root, unit(42, 'Yolu olmayan kimlik'), 'MED'));
});

test('kalemsiz legacy kayıt fiyat/KDV uydurmadan okunur, kayıt değişmez', () => {
    const old = Object.freeze({ id: 42, urun: 'Yazıcı', adet: 2, birim: 'Eski ad', butce: 1200, workflow: {} });
    for (const record of [old, { ...old, engineVersion: 'legacy' }]) {
        const read = s.readPurchase({ root, pathId: '42' }, record);
        assert.equal(read.engine, 'legacy');
        assert.equal(read.purchaseOrderId, '42');
        assert.equal(read.birim, 'Eski ad');
        assert.deepEqual(plain(read.items[0]), {
            id: 'legacy-42', description: 'Yazıcı', category: 'Belirtilmemiş', quantity: 2, unit: 'Adet',
            unitPrice: null, currency: 'TRY', taxRate: null, totalPrice: null, legacy: true
        });
    }
    assert.equal(Object.hasOwn(old, 'items'), false);
    assert.equal(s.readPurchase({ root, pathId: '007' }, { urun: 'Yazıcı' }).items[0].id, 'legacy-007');
    assert.throws(() => s.readPurchase({ root, pathId: '0042' }, old));
});

test('işaretçi alanları, motoru ve yol sahibi kesin doğrulanır', () => {
    const current = marker();
    const read = input => s.readPurchase({ root, pathId: P, ownerUid: context.ownerUid }, input);
    assert.deepEqual(plain(read(current)), { engine: 'ebys-v1', marker: plain(current) });
    for (const changes of [{ engineVersion: 'ebys-v9' }, { engineVersion: 'legacy' }, { engineVersion: null },
        { engineVersion: undefined }, { schemaVersion: 1 }, { createdByUid: 'other' }, { ebysDocumentId: V1 }, { id: V1 },
        { unitId: 42 }, { revision: 0 }, { createdAt: '2026-11-10' }, { workflow: {} }, { purchaseSnapshot: {} },
        { content: 'secret' }, { exchangeRate: rates() }, { documentTypeCode: 'WRONG' }]) {
        assert.throws(() => read({ ...current, ...changes }));
    }
    const { revision, ...incomplete } = current;
    assert.throws(() => read(incomplete));
    const { engineVersion, ...mixed } = current;
    assert.throws(() => read(mixed));
    assert.throws(() => read({ schemaVersion: 2 }));
    assert.throws(() => s.createPurchaseMarker(context, { unit: chosenUnit(), revision, createdAt: timestamp }));
    assert.throws(() => s.createPurchaseMarker(context, {
        unit: chosenUnit(), revision, createdAt: timestamp, updatedAt: timestamp, workflow: {}
    }));
});

test('P, V, kök ve sahip zinciri tarihsel sürümü güncel revizyona eşitlemeden denetlenir', () => {
    const current = { ...context, versionId: V1 };
    const links = {
        marker: at(P, marker()),
        document: at(P, { id: P, kind: 'internal', purchaseOrderId: P, ownerUid: context.ownerUid, unitId: '0042',
            revision: 12, currentVersionId: V2 }),
        version: version(V1, undefined, unit('old-unit', 'Tarihsel birim')),
        process: at(V1, { id: V1, versionId: V1, purchaseOrderId: P, documentId: P, ownerUid: context.ownerUid })
    };
    assert.doesNotThrow(() => s.validatePurchaseLinks(current, links));
    for (const [key, changes] of [
        ['marker', { root: foreignRoot }], ['document', { pathId: V1 }], ['version', { root: foreignRoot }],
        ['process', { root: foreignRoot }], ['process', { pathId: V2 }]
    ]) assert.throws(() => s.validatePurchaseLinks(current, { ...links, [key]: { ...links[key], ...changes } }));
    for (const [key, changes] of [
        ['document', { purchaseOrderId: V1 }], ['document', { unitId: 'other-unit' }], ['document', { ownerUid: 'other' }],
        ['document', { revision: 1 }],
        ['version', { documentId: V1 }], ['version', { processId: V2 }], ['version', { ownerUid: 'other' }],
        ['process', { versionId: V2 }], ['process', { ownerUid: 'other' }], ['process', { purchaseOrderId: V1 }]
    ]) assert.throws(() => s.validatePurchaseLinks(current, {
        ...links, [key]: { ...links[key], data: { ...links[key].data, ...changes } }
    }));
    assert.throws(() => s.validatePurchaseLinks(current, { ...links, version: undefined }));
    assert.throws(() => s.validatePurchaseLinks({ ...current, versionId: P }, links));
});

test('üç dövizde yarım kuruş ve KDV yuvarlanır, ödenek teklif toplamından ayrıdır', () => {
    const input = proposal();
    input.items[0].totalPrice = -999;
    input.totals = 'bozuk';
    const before = plain(input);
    const result = s.normalizePurchaseSnapshot(P, input);
    assert.deepEqual(plain(result.totals), {
        TRY: { subtotal: 0.16, tax: 0.02, total: 0.18 },
        USD: { subtotal: 20.22, tax: 4.04, total: 24.26 },
        EUR: { subtotal: 30.33, tax: 6.07, total: 36.4 }
    });
    assert.deepEqual(Array.from(result.items, row => row.totalPrice), [0.18, 24.26, 36.4]);
    assert.equal(result.butce, 2600.25);
    assert.equal(result.budgetMode, 'manual');
    assert.deepEqual(input, before);
    const auto = s.normalizePurchaseSnapshot(P, { ...proposal(), butce: 2306, budgetMode: 'auto' });
    assert.equal(auto.butce, 2306);
    assert.equal(auto.budgetMode, 'auto');
    assert.deepEqual(plain(auto.totals), plain(result.totals));
});

test('yeni teklif kalem, şekil, tür, hassasiyet ve üst sınır hatalarını reddeder', () => {
    const input = proposal();
    for (const changes of [{ budgetMode: 'estimate' }, { butce: 1.001 }, { butce: -1 }, { butce: 1_000_000_001 },
        { butce: '10' }, { calculationVersion: 2 }, { purchaseOrderId: V1 }, { exchangeRate: rates() },
        { items: [] }, { items: Array(1) }, { items: [...input.items, input.items[0]] },
        { items: [input.items[0], input.items[0]] }]) {
        assert.throws(() => s.normalizePurchaseSnapshot(P, { ...input, ...changes }));
    }
    for (const changes of [{ currency: 'GBP' }, { description: 'x'.repeat(241) }, { category: ' ' }, { unit: '<b>Adet' },
        { id: 5 }, { id: ' ' }, { quantity: 1.0001 }, { quantity: 0 }, { unitPrice: 1.001 }, { unitPrice: Infinity },
        { unitPrice: 1_000_000_001 }, { unitPrice: '1' }, { taxRate: 100.01 }, { taxRate: -1 }, { taxRate: 1.001 },
        { quantity: 3, unitPrice: 1_000_000_000 }, { privateField: 'x' }]) {
        assert.throws(() => s.normalizePurchaseSnapshot(P, { ...input, items: [{ ...input.items[0], ...changes }] }));
    }
    const { taxRate: _taxRate, ...withoutTax } = input.items[0];
    const { unitPrice: _unitPrice, ...withoutPrice } = input.items[0];
    for (const item of [withoutTax, withoutPrice]) assert.throws(() => s.normalizePurchaseSnapshot(P, { ...input, items: [item] }));
    assert.equal(s.normalizePurchaseSnapshot(P, { ...input, items: [line('a', 'TRY', 1, 1_000_000_000, 0)] }).items[0].totalPrice, 1_000_000_000);
    assert.throws(() => s.normalizePurchaseSnapshot(P, {
        ...input, items: [line('a', 'TRY', 1, 600_000_000, 0), line('b', 'TRY', 1, 600_000_000, 0)]
    }));
});

test('kur gözlemi değişen oranı, tarihi ve kaynağı ayırır, ayar üstverisi karşılaştırılmaz', () => {
    const observed = rateConfig();
    assert.equal(s.compareRateSource(observed, { ...rateConfig(), updatedAt: timestamp, updatedBy: 'admin' }), 'same');
    for (const changes of [{ rates: rates(36, 40) }, { rates: rates(35, 41) }, { date: '2026-11-11' }, { source: 'Başka kaynak' }]) {
        assert.equal(s.compareRateSource(observed, { ...rateConfig(), ...changes }), 'changed');
    }
    assert.equal(s.compareRateSource(observed, null), 'missing');
    assert.equal(s.compareRateSource(undefined, rateConfig()), 'missing');
    for (const changes of [{ rates: { TRY: 1, USD: 0, EUR: 40 } }, { rates: { TRY: 1, USD: 35 } },
        { rates: rates(35.0000001) }, { rates: rates(100_001) }, { date: '2026-02-30' }, { source: 'TRY' }]) {
        assert.equal(s.compareRateSource(observed, { ...rateConfig(), ...changes }), 'invalid');
    }
});

test('nested finans yalnız bağlı sürümü ve hesaplanan TRY toplamını kabul eder', async () => {
    const ctx = { ...context, versionId: V1 };
    const v = version(V1);
    v.data.contentDigest = await s.digestPurchaseVersion(ctx, v);
    assert.equal(s.financePath(ctx), root + '/purchaseFinance/items/' + P + '/versions/' + V1);
    assert.throws(() => s.financePath({ ...ctx, versionId: P }));
    const input = finance(v);
    const data = s.normalizeFinance(ctx, v, input);
    assert.deepEqual(plain(data), plain(input));
    input.exchangeRate.USD = 50;
    assert.equal(data.exchangeRate.USD, 35);
    for (const changes of [{ exchangeRateSource: 'TRY' }, { exchangeRate: rates(36) }, { reportingTotalTRY: 1 },
        { purchaseOrderId: V2 }, { versionId: V2 }, { contentDigest: '0'.repeat(64) }, { operationId: 'old' },
        { schemaVersion: 1 }, { actorUid: '' }, { extra: 'x' }]) {
        assert.throws(() => s.normalizeFinance(ctx, v, finance(v, changes)));
    }
    assert.throws(() => s.normalizeFinance({ ...ctx, root: foreignRoot }, v, finance(v)));
    const tryVersion = version(V1, s.normalizePurchaseSnapshot(P, { ...proposal(), items: [proposal().items[0]] }));
    tryVersion.data.contentDigest = await s.digestPurchaseVersion(ctx, tryVersion);
    const tryFinance = finance(tryVersion, { exchangeRate: rates(1, 1), exchangeRateSource: 'TRY', reportingTotalTRY: 0.18 });
    assert.equal(s.normalizeFinance(ctx, tryVersion, tryFinance).reportingTotalTRY, 0.18);
    assert.throws(() => s.normalizeFinance(ctx, tryVersion, { ...tryFinance, exchangeRate: rates() }));
    assert.throws(() => s.normalizeFinance(ctx, tryVersion, { ...tryFinance, exchangeRateSource: 'Operasyon Merkezi' }));
    assert.equal(s.isFirstPositiveDecision(0, 'approved'), true);
    assert.equal(s.isFirstPositiveDecision(1, 'approved'), false);
    assert.equal(s.isFirstPositiveDecision(0, 'rejected'), false);
    assert.equal(s.isFirstPositiveDecision(0, 'returned'), false);
});

test('şema 1 hash geriye uyumlu, şema 2 zarfı teklif ve künyeyi kapsar', async () => {
    const ctx = { ...context, versionId: V1 };
    const v = version(V1);
    const before = plain(v);
    const envelope = s.purchaseDigestEnvelope(ctx, v);
    assert.deepEqual(Object.keys(envelope), ['content', 'metadata', 'attachments', 'purchaseSnapshot', 'unitSnapshot']);
    const schema1 = { content: 'A', metadata: { subject: 'B' }, attachments: [] };
    const knownCanonical = '{"attachments":[],"content":"A","metadata":{"subject":"B"}}';
    assert.equal(await documentSchema.digest(schema1), createHash('sha256').update(knownCanonical).digest('hex'));

    const hash = await s.digestPurchaseVersion(ctx, v);
    assert.equal(hash, await documentSchema.digest(envelope));
    for (const changes of [
        { content: 'Başka metin' }, { metadataSnapshot: { ...metadata(), subject: 'Yeni konu' } },
        { purchaseSnapshot: s.normalizePurchaseSnapshot(P, { ...proposal(), butce: 2601 }) },
        { unitSnapshot: { ...v.data.unitSnapshot, name: 'Yeni ad' } }
    ]) assert.notEqual(await s.digestPurchaseVersion(ctx, { ...v, data: { ...v.data, ...changes } }), hash);
    for (const changes of [{ schemaVersion: 1 }, { attachments: ['ek'] }, { finance: {} },
        { purchaseSnapshot: { ...v.data.purchaseSnapshot, totals: {} } },
        { unitSnapshot: { ...v.data.unitSnapshot, personnelIds: [] } }]) {
        assert.throws(() => s.purchaseDigestEnvelope(ctx, { ...v, data: { ...v.data, ...changes } }));
    }
    envelope.metadata.subject = 'değişti';
    envelope.unitSnapshot.name = 'değişti';
    envelope.purchaseSnapshot.items[0].description = 'değişti';
    assert.deepEqual(plain(v), before);
});

test('iade sonrası V2 ve yeni kur V1 zarfını ve önceki finansı değiştirmez', async () => {
    const source = chosenUnit(), fx = rateConfig();
    const first = { ...context, versionId: V1 }, second = { ...context, versionId: V2 };
    const v1 = version(V1, undefined, source);
    v1.data.contentDigest = await s.digestPurchaseVersion(first, v1);
    const f1 = s.normalizeFinance(first, v1, finance(v1, { exchangeRate: fx.rates }));
    const firstState = plain({ v1, f1 });
    const f1Alternate = s.normalizeFinance(first, v1, finance(v1, { exchangeRate: rates(36, 41), reportingTotalTRY: 2365.94 }));
    assert.equal(f1Alternate.contentDigest, f1.contentDigest);
    source.data.name = 'Adı değişen birim';
    fx.rates.USD = 36;
    fx.rates.EUR = 41;
    const v2 = version(V2, undefined, source);
    v2.data.contentDigest = await s.digestPurchaseVersion(second, v2);
    const f2 = s.normalizeFinance(second, v2, finance(v2, { exchangeRate: fx.rates, reportingTotalTRY: 2365.94 }));
    assert.notEqual(v1.data.contentDigest, v2.data.contentDigest);
    assert.notEqual(s.financePath(first), s.financePath(second));
    assert.equal(f2.reportingTotalTRY, 2365.94);
    assert.equal(v2.data.unitSnapshot.name, 'Adı değişen birim');
    assert.deepEqual(plain({ v1, f1 }), firstState);
    assert.equal(await s.digestPurchaseVersion(first, v1), firstState.v1.data.contentDigest);
});
