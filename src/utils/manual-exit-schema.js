(function () {
    const TEXT_LIMITS = Object.freeze({
        kime: 160,
        nereye: 200,
        cihaz: 200,
        sn: 120,
        envanterNo: 120,
        ekNot: 1000,
        cikisiIsteyen: 160,
        tarih: 60,
        personelId: 160,
        actorUid: 160,
    });

    function validate(record) {
        const errors = [];
        if (!record || typeof record !== 'object' || Array.isArray(record)) return ['Kayıt bilgileri geçersiz.'];
        for (const field of ['id', ...Object.keys(TEXT_LIMITS)]) {
            if (typeof record[field] !== 'string') {
                errors.push(`${field} metin olmalıdır.`);
                continue;
            }
            if (record[field].length > (TEXT_LIMITS[field] || 160)) errors.push(`${field} çok uzun.`);
        }
        for (const field of ['id', 'kime', 'nereye', 'cihaz', 'cikisiIsteyen', 'actorUid', 'tarih']) {
            if (typeof record[field] === 'string' && !record[field].trim()) errors.push(`${field} zorunludur.`);
        }
        if (record.isDemirbas !== true && record.isDemirbas !== false) errors.push('Demirbaş bilgisi seçilmelidir.');
        if (record.isDemirbas === true && typeof record.envanterNo === 'string' && !record.envanterNo.trim()) {
            errors.push('Demirbaş için Envanter No zorunludur.');
        }
        if (!Number.isInteger(record.adet) || record.adet < 1) errors.push('Adet en az 1 olan tam sayı olmalıdır.');
        if (!Number.isFinite(record.ts) || record.ts < 0) errors.push('Kayıt tarihi geçersiz.');
        if (record.sema !== 1) errors.push('Kayıt şeması geçersiz.');

        const html = window.AppModules && window.AppModules.Html;
        if (html && typeof html.findTagLike === 'function') {
            const label = html.findTagLike(Object.fromEntries(
                Object.keys(TEXT_LIMITS).map(field => [field, record[field]])
            ));
            if (label) errors.push(`${label} alanında etiket benzeri ifade kullanılamaz.`);
        }
        return errors;
    }

    function build(input) {
        const source = input && typeof input === 'object' ? input : {};
        const text = field => typeof source[field] === 'string' ? source[field].trim() : '';
        const record = {
            id: source.id === undefined || source.id === null ? '' : String(source.id).trim(),
            sema: 1,
            kime: text('kime'),
            nereye: text('nereye'),
            cihaz: text('cihaz'),
            sn: text('sn'),
            envanterNo: text('envanterNo'),
            isDemirbas: source.isDemirbas,
            adet: Number(source.adet),
            ekNot: text('ekNot'),
            cikisiIsteyen: text('cikisiIsteyen'),
            personelId: text('personelId'),
            actorUid: text('actorUid'),
            tarih: text('tarih'),
            ts: source.ts,
        };
        const errors = validate(record);
        return { record, errors };
    }

    window.ManualExitSchema = Object.freeze({ build, validate });
})();
