(function () {
    'use strict';

    const purchaseType = 'PURCHASE_REQUEST';
    const ebysEngine = 'ebys-v1';
    const currencies = ['TRY', 'USD', 'EUR'];
    const markerFields = ['id', 'ebysDocumentId', 'engineVersion', 'schemaVersion', 'createdByUid', 'unitId',
        'birim', 'documentTypeCode', 'revision', 'createdAt', 'updatedAt'];
    const unitSnapshotFields = ['unitId', 'name', 'code', 'organizationId', 'organizationCode', 'source'];
    const money = () => window.AppModules.PurchaseMoney;
    const documentSchema = () => window.AppModules.EBYSDocumentSchema;

    function requireValue(condition, label) {
        if (!condition) throw new Error(label + ' geçersiz.');
    }
    function record(value, label) {
        requireValue(value && typeof value === 'object', label);
        const proto = Object.getPrototypeOf(value);
        requireValue(proto === null || Object.getPrototypeOf(proto) === null, label);
        return value;
    }
    function shape(value, required, optional, label) {
        record(value, label);
        requireValue(required.every(key => Object.hasOwn(value, key)) &&
            Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key)), label);
    }
    function text(value, max, label, optional = false) {
        requireValue(typeof value === 'string' && (optional || value.trim()) &&
            value.length <= max && !/<[a-zA-Z/!?]/.test(value), label);
        return value;
    }
    function uuid(value, label) {
        requireValue(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), label);
        return value;
    }
    function rootId(root) {
        requireValue(root === 'inventory_demo' || root === 'lifeserver_master', 'Kök');
        return root;
    }
    function normalizeLegacyId(value) {
        if (value === undefined) return { kind: 'absent' };
        if (value === null) return { kind: 'null' };
        if (value === '') return { kind: 'empty' };
        if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
        if (typeof value !== 'string' || !value.trim() || /[/\u0000-\u001f\u007f]/.test(value) ||
            value === '.' || value === '..' || /^__.*__$/u.test(value) || new TextEncoder().encode(value).length > 1500) {
            return { kind: 'invalid' };
        }
        return { kind: 'valid', id: value };
    }
    function unitId(value) {
        requireValue(typeof value === 'string' && value.length <= 128 && normalizeLegacyId(value).kind === 'valid', 'Birim yolu');
        return value;
    }
    function unitInfo({ pathId, data }) {
        record(data, 'Ortak birim');
        requireValue(!Object.hasOwn(data, 'active') || typeof data.active === 'boolean', 'Birim durumu');
        return { unitId: unitId(pathId), name: text(data.name, 240, 'Birim adı'),
            code: text(Object.hasOwn(data, 'code') ? data.code : '', 120, 'Birim kodu', true),
            organizationId: text(Object.hasOwn(data, 'organizationId') ? data.organizationId : '', 120, 'Kurum kimliği', true),
            parentUnitId: text(Object.hasOwn(data, 'parentUnitId') ? data.parentUnitId : '', 120, 'Üst birim kimliği', true), active: data.active !== false };
    }
    function nameKey(name) {
        return typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR') : '';
    }
    function frequencies(keys) {
        const counts = new Map();
        for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
    }
    function unitOptions(root, units) {
        rootId(root);
        const options = units.filter(unit => unit.root === root && unit.data != null && unit.data.active !== false).map(unitInfo);
        requireValue(new Set(options.map(unit => unit.unitId)).size === options.length, 'Tekrarlanan birim yolu');
        const names = frequencies(options.map(unit => nameKey(unit.name)));
        const labels = options.map(unit => names.get(nameKey(unit.name)) > 1
            ? [unit.name, unit.code, unit.organizationId, unit.parentUnitId].filter(Boolean).join(' · ')
            : unit.name);
        const labelCounts = frequencies(labels.map(nameKey));
        const prefixes = frequencies(options.map(unit => unit.unitId.slice(0, 8)));
        return options.map((unit, index) => {
            const label = labels[index];
            if (labelCounts.get(nameKey(label)) === 1) return { ...unit, label };
            const prefix = unit.unitId.slice(0, 8);
            const suffix = prefixes.get(prefix) === 1 ? prefix : unit.unitId;
            return { ...unit, label: label + ' [' + suffix + ']' };
        });
    }
    function matchLegacyUnit(root, purchase, units) {
        rootId(root);
        const identity = normalizeLegacyId(purchase.unitId);
        let candidates = [];
        let classification = 'different_root';
        if (purchase.root === root) {
            const local = units.filter(unit => unit.root === root && unit.data != null);
            if (identity.kind === 'invalid') classification = 'missing_id';
            else if (identity.kind === 'valid') {
                candidates = local.filter(unit => unit.pathId === identity.id).map(unitInfo);
                classification = candidates.length !== 1 ? 'missing_id' : (candidates[0].active ? 'already_identified' : 'inactive_id');
            } else {
                const key = nameKey(purchase.birim);
                candidates = key ? local.filter(unit => nameKey(unit.data?.name) === key).map(unitInfo) : [];
                if (candidates.length === 0) classification = 'unmatched';
                else if (candidates.length > 1) classification = 'ambiguous';
                else classification = candidates[0].active ? 'unique_candidate' : 'inactive_candidate';
            }
        }
        return { classification, idKind: identity.kind, candidates, automaticWrite: false,
            requiresReview: classification !== 'already_identified' };
    }
    function activeUnit(root, source) {
        requireValue(source?.root === rootId(root), 'Birim kökü');
        const unit = unitInfo(source);
        requireValue(unit.active, 'Aktif birim');
        return unit;
    }
    function organizationCode(value) {
        requireValue(typeof value === 'string' && /^[A-Z0-9]{2,12}$/.test(value), 'Kurum kodu');
        return value;
    }
    function createUnitSnapshot(root, source, code) {
        const unit = activeUnit(root, source);
        return { unitId: unit.unitId, name: unit.name, code: unit.code, organizationId: unit.organizationId,
            organizationCode: organizationCode(code), source: 'units' };
    }

    function purchaseContext({ root, purchaseOrderId, ownerUid }) {
        rootId(root);
        uuid(purchaseOrderId, 'Talep yolu');
        text(ownerUid, 128, 'Sahip');
    }
    function timestamp(value) {
        // SDK zaman damgası veya sunucu değeri çağıran katmanın sorumluluğundadır.
        requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Zaman damgası');
        return value;
    }
    function normalizePurchaseMarker(context, input) {
        purchaseContext(context);
        shape(input, markerFields, [], 'Satın alma işaretçisi alanları');
        requireValue(input.id === context.purchaseOrderId && input.ebysDocumentId === context.purchaseOrderId &&
            input.createdByUid === context.ownerUid && input.engineVersion === ebysEngine && input.schemaVersion === 2 &&
            input.documentTypeCode === purchaseType && Number.isSafeInteger(input.revision) && input.revision >= 1,
        'İşaretçi bağı, motoru veya taslak revizyonu');
        unitId(input.unitId);
        text(input.birim, 240, 'Tarihsel birim adı');
        timestamp(input.createdAt);
        timestamp(input.updatedAt);
        return Object.fromEntries(markerFields.map(key => [key, input[key]]));
    }
    function createPurchaseMarker(context, input) {
        shape(input, ['unit', 'revision', 'createdAt', 'updatedAt'], [], 'İşaretçi girdisi');
        const { unit, revision, createdAt, updatedAt } = input;
        const selected = activeUnit(context.root, unit);
        return normalizePurchaseMarker(context, {
            id: context.purchaseOrderId, ebysDocumentId: context.purchaseOrderId, engineVersion: ebysEngine,
            schemaVersion: 2, createdByUid: context.ownerUid, unitId: selected.unitId, birim: selected.name,
            documentTypeCode: purchaseType, revision, createdAt, updatedAt
        });
    }
    function readPurchase({ root, pathId, ownerUid }, input) {
        rootId(root);
        record(input, 'Satın alma kaydı');
        const engine = Object.hasOwn(input, 'engineVersion') ? input.engineVersion : 'legacy';
        if (engine === ebysEngine) {
            return { engine, marker: normalizePurchaseMarker({ root, purchaseOrderId: pathId, ownerUid }, input) };
        }
        requireValue(engine === 'legacy' && !Object.hasOwn(input, 'ebysDocumentId') &&
            !Object.hasOwn(input, 'purchaseOrderId') && input.schemaVersion !== 2, 'Satın alma motoru veya bağı');
        const path = normalizeLegacyId(pathId);
        requireValue(path.kind === 'valid' &&
            (!Object.hasOwn(input, 'id') || normalizeLegacyId(input.id).id === path.id), 'Eski talep yolu');
        const items = money().readItems({ ...input, id: path.id }).map(item => item && typeof item === 'object' ? { ...item } : item);
        return { engine, purchaseOrderId: path.id, birim: input.birim, items };
    }

    function decimal(value, digits, label) {
        requireValue(typeof value === 'number' && Number.isFinite(value), label);
        return money().scaled(value, digits, label);
    }
    function normalizePurchaseSnapshot(purchaseOrderId, input) {
        uuid(purchaseOrderId, 'Talep yolu');
        shape(input, ['purchaseOrderId', 'documentTypeCode', 'items', 'butce', 'budgetMode', 'calculationVersion'],
            ['totals'], 'Teklif alanları');
        requireValue(input.purchaseOrderId === purchaseOrderId && input.documentTypeCode === purchaseType &&
            input.calculationVersion === 1 && ['auto', 'manual'].includes(input.budgetMode), 'Teklif bağı, hesap sürümü veya ödenek modu');
        decimal(input.butce, 2, 'Ödenek');
        requireValue(Array.isArray(input.items) && input.items.length >= 1 && input.items.length <= money().MAX_ITEMS, 'Kalem sayısı');
        const lines = Array.from(input.items, line => {
            shape(line, ['id', 'description', 'category', 'quantity', 'unit', 'unitPrice', 'currency', 'taxRate'],
                ['totalPrice'], 'Kalem alanları');
            text(line.id, 128, 'Kalem kimliği');
            text(line.description, 240, 'Kalem açıklaması');
            text(line.category, 120, 'Kalem türü');
            text(line.unit, 40, 'Ölçü birimi');
            requireValue(currencies.includes(line.currency), 'Para birimi');
            // Ondalık, tutar ve yuvarlama sınırlarını PurchaseMoney uygular.
            for (const key of ['quantity', 'unitPrice', 'taxRate']) {
                requireValue(typeof line[key] === 'number' && Number.isFinite(line[key]), key);
            }
            return line;
        });
        const { items, totals } = money().calculate(lines);
        for (const currency of currencies) decimal(totals[currency].total, 2, 'Para birimi toplamı');
        return { purchaseOrderId, documentTypeCode: purchaseType, items, totals, butce: input.butce,
            budgetMode: input.budgetMode, calculationVersion: 1 };
    }

    function linkedRecord(ref, root, pathId) {
        requireValue(ref?.root === root && ref.pathId === pathId, 'Belge kökü veya yolu');
        return record(ref.data, 'Bağlı belge');
    }
    function versionPath(context) {
        purchaseContext(context);
        const versionId = uuid(context.versionId, 'Sürüm yolu');
        requireValue(context.purchaseOrderId !== versionId, 'Talep ve sürüm ayrımı');
        return versionId;
    }
    function purchaseDigestEnvelope(context, version) {
        const versionId = versionPath(context);
        const v = linkedRecord(version, context.root, versionId);
        shape(v, ['id', 'processId', 'documentId', 'ownerUid', 'versionNo', 'schemaVersion', 'content',
            'metadataSnapshot', 'attachments', 'attachmentMode', 'purchaseSnapshot', 'unitSnapshot'],
        ['contentDigest', 'createdAt'], 'Sürüm alanları');
        requireValue(v.id === versionId && v.processId === versionId && v.documentId === context.purchaseOrderId &&
            v.ownerUid === context.ownerUid && v.schemaVersion === 2 && Number.isSafeInteger(v.versionNo) && v.versionNo >= 1 &&
            Array.isArray(v.attachments) && v.attachments.length === 0 && v.attachmentMode === 'none', 'Sürüm bağı veya şeması');
        if (Object.hasOwn(v, 'contentDigest')) {
            requireValue(typeof v.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(v.contentDigest), 'İçerik özeti');
        }
        if (Object.hasOwn(v, 'createdAt')) timestamp(v.createdAt);
        const unit = v.unitSnapshot;
        shape(unit, unitSnapshotFields, [], 'Tarihsel birim künyesi');
        unitId(unit.unitId);
        text(unit.name, 240, 'Birim adı');
        text(unit.code, 120, 'Birim kodu', true);
        text(unit.organizationId, 120, 'Kurum kimliği', true);
        organizationCode(unit.organizationCode);
        requireValue(unit.source === 'units', 'Birim kaynağı');

        const schema = documentSchema();
        const { content, metadata } = schema.normalize({ kind: 'internal', unitId: unit.unitId,
            organizationCode: unit.organizationCode, content: v.content, metadata: v.metadataSnapshot });
        shape(v.metadataSnapshot, Object.keys(metadata), [], 'Sürüm üstverisi');
        const purchaseSnapshot = normalizePurchaseSnapshot(context.purchaseOrderId, v.purchaseSnapshot);
        requireValue(v.content === content && schema.canonical(v.metadataSnapshot) === schema.canonical(metadata) &&
            schema.canonical(v.purchaseSnapshot) === schema.canonical(purchaseSnapshot), 'Kanonik sürüm içeriği');
        return { content, metadata, attachments: [], purchaseSnapshot, unitSnapshot: { ...unit } };
    }
    function digestPurchaseVersion(context, version) {
        return documentSchema().digest(purchaseDigestEnvelope(context, version));
    }
    function validatePurchaseLinks(context, { marker, document, version, process }) {
        const { root, purchaseOrderId, ownerUid } = context;
        const pointer = normalizePurchaseMarker(context, linkedRecord(marker, root, purchaseOrderId));
        const head = linkedRecord(document, root, purchaseOrderId);
        requireValue(head.id === purchaseOrderId && head.purchaseOrderId === purchaseOrderId && head.ownerUid === ownerUid &&
            head.kind === 'internal' && head.unitId === pointer.unitId &&
            Number.isSafeInteger(head.revision) && head.revision >= pointer.revision, 'Evrak bağı');
        if (version !== undefined) purchaseDigestEnvelope(context, version);
        if (process !== undefined) {
            requireValue(version !== undefined, 'Sürecin bağlı sürümü');
            const p = linkedRecord(process, root, context.versionId);
            requireValue(p.id === context.versionId && p.versionId === context.versionId && p.documentId === purchaseOrderId &&
                p.purchaseOrderId === purchaseOrderId && p.ownerUid === ownerUid, 'Süreç bağı');
        }
    }

    function financePath({ root, purchaseOrderId, versionId }) {
        rootId(root);
        uuid(purchaseOrderId, 'Talep yolu');
        uuid(versionId, 'Sürüm yolu');
        requireValue(purchaseOrderId !== versionId, 'Talep ve sürüm ayrımı');
        return [root, 'purchaseFinance', 'items', purchaseOrderId, 'versions', versionId].join('/');
    }
    function rateDate(value) {
        requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Kur tarihi');
        const date = new Date(value + 'T00:00:00Z');
        requireValue(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, 'Kur tarihi');
        return value;
    }
    function exchangeRate(rates) {
        shape(rates, currencies, [], 'Kur alanları');
        requireValue(rates.TRY === 1 && decimal(rates.USD, 6, 'USD kuru') > 0n &&
            decimal(rates.EUR, 6, 'EUR kuru') > 0n, 'Kur değerleri');
        return { TRY: 1, USD: rates.USD, EUR: rates.EUR };
    }
    function rateSource(input) {
        record(input, 'Kur ayarı');
        const source = text(input.source, 120, 'Kur kaynağı');
        requireValue(source === source.trim() && source !== 'TRY', 'Kur kaynağı');
        return { rates: exchangeRate(input.rates), date: rateDate(input.date), source };
    }
    function compareRateSource(observed, fresh) {
        if (observed == null || fresh == null) return 'missing';
        try {
            const { rates, date, source } = rateSource(observed);
            const current = rateSource(fresh);
            return date === current.date && source === current.source && rates.USD === current.rates.USD &&
                rates.EUR === current.rates.EUR ? 'same' : 'changed';
        } catch {
            return 'invalid';
        }
    }
    function normalizeFinance(context, version, input) {
        const { purchaseSnapshot } = purchaseDigestEnvelope(context, version);
        shape(input, ['schemaVersion', 'purchaseOrderId', 'versionId', 'contentDigest', 'actorUid', 'operationId',
            'exchangeRate', 'exchangeRateDate', 'exchangeRateSource', 'reportingTotalTRY', 'createdAt'], [], 'Mali kayıt alanları');
        const { purchaseOrderId, versionId } = context;
        const { contentDigest, actorUid, operationId } = input;
        requireValue(input.schemaVersion === 2 && input.purchaseOrderId === purchaseOrderId && input.versionId === versionId &&
            typeof contentDigest === 'string' && /^[a-f0-9]{64}$/.test(contentDigest) && contentDigest === version.data.contentDigest, 'Mali kayıt bağı');
        text(actorUid, 128, 'Karar veren');
        uuid(operationId, 'Karar işlemi');
        const rates = exchangeRate(input.exchangeRate);
        const date = rateDate(input.exchangeRateDate);
        const source = text(input.exchangeRateSource, 120, 'Kur kaynağı');
        const tryOnly = purchaseSnapshot.items.every(item => item.currency === 'TRY');
        requireValue(source === source.trim() && (tryOnly ? source === 'TRY' && rates.USD === 1 && rates.EUR === 1 : source !== 'TRY'), 'Kur kaynağı');
        const calculated = money().reportingTry({ items: purchaseSnapshot.items, exchangeRate: rates });
        decimal(input.reportingTotalTRY, 2, 'TRY rapor toplamı');
        requireValue(input.reportingTotalTRY === calculated, 'TRY rapor toplamı');
        return { schemaVersion: 2, purchaseOrderId, versionId, contentDigest, actorUid, operationId, exchangeRate: rates,
            exchangeRateDate: date, exchangeRateSource: source, reportingTotalTRY: calculated, createdAt: timestamp(input.createdAt) };
    }
    function isFirstPositiveDecision(currentStep, result) {
        return currentStep === 0 && result === 'approved';
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSPurchaseSchema = Object.freeze({
        normalizeLegacyId, unitOptions, matchLegacyUnit, createUnitSnapshot, readPurchase, createPurchaseMarker,
        normalizePurchaseMarker, validatePurchaseLinks, normalizePurchaseSnapshot, purchaseDigestEnvelope,
        digestPurchaseVersion, financePath, compareRateSource, normalizeFinance, isFirstPositiveDecision
    });
})();
