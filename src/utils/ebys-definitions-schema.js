// [WHY]: Kalıcı kimlik ve hiyerarşi doğrulaması UI'dan bağımsız, legacy alanlar korunarak yapılır.
// [HOW]: Saf fonksiyonlar kopya üretir; belirsiz isimleri kendiliğinden ID'ye dönüştürmez.
(function () {
    const text = v => String(v ?? '').trim();
    const active = v => v?.active !== false;
    const idOf = v => text(v?.id);
    const nameOf = v => text(v?.name || v?.birimAdi || v?.adSoyad);
    function validateUnit(candidate, units, previous = {}) {
        if (!idOf(candidate) || !nameOf(candidate)) throw new Error('Birim kimliği ve adı zorunludur.');
        for (const key of ['organizationId', 'parentUnitId', 'code']) {
            if (typeof candidate[key] !== 'string' || candidate[key].length > 120 || /[<>/]/.test(candidate[key])) throw new Error('Birim kodu ve ilişki kimlikleri geçersiz.');
        }
        if (typeof candidate.active !== 'boolean') throw new Error('Birim durumu geçersiz.');
        const graph = new Map(units.filter(u => u && typeof u === 'object').map(u => [idOf(u), u]));
        graph.set(idOf(candidate), candidate);
        if (candidate.parentUnitId && candidate.parentUnitId !== previous.parentUnitId &&
            !active(graph.get(candidate.parentUnitId))) throw new Error('Yeni bağlantı için aktif bir üst birim seçin.');
        for (const unit of graph.values()) {
            const seen = new Set([idOf(unit)]);
            let node = unit, depth = 0;
            while (node.parentUnitId) {
                if (seen.has(text(node.parentUnitId))) throw new Error('Birim hiyerarşisi döngü içeremez.');
                seen.add(text(node.parentUnitId));
                const parent = graph.get(text(node.parentUnitId));
                if (!parent) throw new Error('Üst birim bulunamadı.');
                if (text(parent.organizationId) !== text(node.organizationId)) throw new Error('Üst birim aynı kuruma ait olmalıdır.');
                if (++depth > 4) throw new Error('Hiyerarşi en fazla dört üst birim içerebilir.');
                node = parent;
            }
        }
        return candidate;
    }
    // [WHY]: Eski ad listeleri tarihsel gösterimdir; aynı adlı iki kişi ayrı ID ile seçilir.
    function resolveLegacyNames(names, people) {
        const ids = [], unresolved = [];
        for (const name of names || []) {
            const hits = people.filter(p => nameOf(p).toLocaleLowerCase('tr-TR') === text(name).toLocaleLowerCase('tr-TR'));
            if (hits.length === 1 && idOf(hits[0])) ids.push(idOf(hits[0]));
            else unresolved.push(name);
        }
        return { ids: [...new Set(ids)], unresolved };
    }
    function personnelPatch(person, fields, units) {
        const unitId = text(fields.unitId), jobTitle = text(fields.jobTitle);
        if (jobTitle.length > 160 || /<[/!?a-z]/i.test(jobTitle)) throw new Error('Görev/unvan geçersiz.');
        const unit = units.find(u => idOf(u) === unitId);
        if (unitId && (!unit || (!active(unit) && unitId !== text(person?.unitId)))) throw new Error('Aktif bir birim seçin.');
        return { unitId, jobTitle, active: fields.active !== false,
            birim: unit ? nameOf(unit) : text(person?.birim || fields.birim) };
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.EBYSDefinitionsSchema = { text, active, idOf, nameOf, validateUnit, resolveLegacyNames, personnelPatch };
})();
