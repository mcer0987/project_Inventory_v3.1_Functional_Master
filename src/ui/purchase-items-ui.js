// [WHY]: Kalem editörü iki ayrı satın alma formunda aynı hesap ve okuma sözleşmesini kullanmalı.
// [HOW]: DOM olayları yalnız burada bağlanır; para hesabı saf PurchaseMoney yardımcısındadır.
(function () {
    'use strict';
    const money = () => window.AppModules.PurchaseMoney;
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const host = () => document.getElementById('purItemsEditor');
    const budgetInput = () => document.getElementById('purBudget');
    const estimateConfig = () => window.AppModules.EBYSRates?.current();
    const estimateRates = () => host()?._savedEstimateRates || estimateConfig()?.rates || null;
    const el = (tag, className, label) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (label != null) node.textContent = label;
        return node;
    };
    const field = (row, key, label, type, value, choices) => {
        const cell = el('td', 'align-middle');
        const input = el(choices ? 'select' : 'input', 'form-control form-control-sm');
        input.dataset.field = key;
        input.setAttribute('aria-label', label);
        if (choices) {
            for (const value of choices) { const opt = el('option', '', value); opt.value = value; input.append(opt); }
            if (value && !choices.includes(String(value))) { const opt = el('option', '', String(value)); opt.value = String(value); input.append(opt); }
        } else {
            input.type = type || 'text';
            input.value = value ?? '';
            if (['quantity', 'unitPrice', 'taxRate'].includes(key)) input.inputMode = 'decimal';
        }
        if (choices) input.value = value || choices[0];
        row.append(cell);
        cell.append(input);
        return input;
    };
    function addLine(source = {}, view = false) {
        const root = host();
        const list = root?.querySelector('[data-items-list]');
        if (!list) return;
        const row = el('tr');
        row.dataset.itemId = source.id || (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
        const types = [...new Set((window.data?.productTypes || []).map(x => String(x?.name || x || '').trim()).filter(Boolean))];
        field(row, 'description', 'Mal / hizmet açıklaması', 'text', source.description || '');
        field(row, 'category', 'Ürün türü', 'text', source.category || types[0] || 'Genel');
        field(row, 'quantity', 'Miktar', 'text', source.quantity ?? 1);
        field(row, 'unit', 'Birim', null, source.unit || 'Adet', ['Adet', 'Kutu', 'Metre', 'Kilogram', 'Litre', 'Saat', 'Hizmet']);
        field(row, 'unitPrice', 'Birim fiyat', 'text', source.legacy ? '' : source.unitPrice ?? '');
        field(row, 'currency', 'Para', null, source.currency || 'TRY', money().currencies);
        field(row, 'taxRate', 'KDV %', 'text', source.legacy ? '' : source.taxRate ?? 0);
        const total = el('strong', 'small text-nowrap', source.legacy ? 'Eski kayıt: fiyat bilinmiyor' : '—');
        total.dataset.lineTotal = '';
        const totalCell = el('td', 'align-middle text-nowrap'); totalCell.append(total); row.append(totalCell);
        const remove = el('button', 'btn btn-sm btn-outline-danger', 'Çıkar');
        remove.type = 'button'; remove.dataset.removeItem = '';
        const actionCell = el('td', 'align-middle'); actionCell.append(remove); row.append(actionCell);
        list.append(row);
        row.querySelectorAll('input, select, button').forEach(node => { node.disabled = view || root.dataset.legacy === 'true'; });
        refresh();
    }
    const rawRows = () => [...(host()?.querySelectorAll('[data-item-id]') || [])].map(row => {
        const value = key => row.querySelector(`[data-field="${key}"]`)?.value;
        return {
            id: row.dataset.itemId, description: value('description'), category: value('category'),
            quantity: value('quantity'), unit: value('unit'), unitPrice: value('unitPrice'),
            currency: value('currency'), taxRate: value('taxRate')
        };
    });
    function refreshBudget(calculated, rows) {
        const input = budgetInput();
        const note = host()?.querySelector('[data-budget-note]');
        const reset = host()?.querySelector('[data-budget-auto]');
        if (!input || !note || !reset || host().dataset.legacy === 'true') return;
        const totals = calculated.totals;
        if (host().dataset.readonly === 'true') {
            reset.disabled = true;
            note.textContent = `Kayıtlı ödenek: ${input.value || '—'} TRY${input.dataset.budgetMode === 'manual' ? ' (manuel)' : ''}.`;
            return;
        }
        const hasFx = rows.some(row => row.currency !== 'TRY');
        reset.disabled = input.disabled;
        let calculatedTry = totals.TRY.total;
        if (hasFx) {
            try {
                const rates = { TRY: 1 };
                for (const currency of new Set(rows.filter(row => row.currency !== 'TRY').map(row => row.currency))) {
                    const rate = estimateRates()?.[currency];
                    if (rate == null) throw new Error(`${currency} kuru Operasyon Merkezi'nde tanımlı değil.`);
                    rates[currency] = Number(money().scaled(String(rate), 6, `${currency} tahmini kuru`)) / 1000000;
                    if (rates[currency] <= 0) throw new Error(`${currency} kuru sıfırdan büyük olmalı.`);
                }
                calculatedTry = money().reportingTry({ items: calculated.items, exchangeRate: rates });
            } catch (error) {
                if (input.dataset.budgetMode === 'auto') input.value = '';
                note.textContent = `Otomatik TRY ödeneği hesaplanamadı: ${error.message} Ödeneği elle girebilirsiniz.`;
                reset.disabled = true;
                return;
            }
        }
        const amount = calculatedTry.toFixed(2);
        if (input.dataset.budgetMode !== 'manual') { input.value = amount; input.dataset.budgetMode = 'auto'; }
        note.textContent = input.dataset.budgetMode === 'manual'
            ? `Manuel ödenek: ${input.value || '—'} TRY · Hesaplanan: ${amount} TRY. Hesaplananı kullanabilirsiniz.`
            : `Kalemlerden ${hasFx ? 'tahmini kurlarla ' : ''}otomatik hesaplandı: ${amount} TRY. Gerekirse ödeneği elle değiştirebilirsiniz.`;
    }
    function refresh() {
        const root = host();
        if (!root) return;
        const summary = root.querySelector('[data-items-summary]');
        if (!summary) return;
        const rows = rawRows();
        for (const row of root.querySelectorAll('[data-item-id]')) for (const key of ['quantity', 'unitPrice', 'taxRate']) {
            const input = row.querySelector(`[data-field="${key}"]`);
            if (input.disabled) continue;
            let issue = '';
            try { money().scaled(input.value, key === 'quantity' ? 3 : 2, input.getAttribute('aria-label')); }
            catch (error) { issue = error.message; }
            input.setCustomValidity(issue);
        }
        for (const [index, row] of [...root.querySelectorAll('[data-item-id]')].entries()) {
            const target = row.querySelector('[data-line-total]');
            try {
                const line = money().calculateLine(rows[index]);
                target.textContent = `${line.totalPrice.toFixed(2)} ${line.currency}`;
            } catch { target.textContent = '—'; }
        }
        try {
            const calculated = money().calculate(rows);
            const { totals } = calculated;
            summary.textContent = money().currencies.filter(c => totals[c].total || rows.some(r => r.currency === c))
                .map(c => `${c}: Ara ${totals[c].subtotal.toFixed(2)} · KDV ${totals[c].tax.toFixed(2)} · Genel ${totals[c].total.toFixed(2)}`)
                .join('  |  ') || 'Kalem giriniz';
            refreshBudget(calculated, rows);
        } catch (error) {
            summary.textContent = error.message;
            const budget = budgetInput();
            if (budget?.dataset.budgetMode === 'auto' && root.dataset.readonly !== 'true') budget.value = '';
            const note = root.querySelector('[data-budget-note]');
            if (note && root.dataset.legacy !== 'true') note.textContent = 'Kalemler geçerli olduğunda ödenek hesaplanır.';
        }
    }
    function open(record = null, view = false) {
        const root = host();
        if (!root) return;
        root.replaceChildren();
        const legacy = !!record && !Array.isArray(record.items);
        root.dataset.legacy = String(legacy);
        root.dataset.readonly = String(view);
        const header = el('div', 'd-flex justify-content-between align-items-center mb-2');
        header.append(el('strong', '', 'Kalem listesi'));
        const add = el('button', 'btn btn-sm btn-outline-primary', '+ Kalem ekle');
        add.type = 'button'; add.disabled = view || legacy; add.dataset.addItem = '';
        header.append(add);
        const scroller = el('div', 'table-responsive');
        const table = el('table', 'table table-sm table-hover align-middle purchase-items-table');
        const head = el('thead'); const headers = el('tr');
        for (const title of ['Mal / hizmet', 'Ürün türü', 'Miktar', 'Birim', 'Birim fiyat', 'Para', 'KDV %', 'Toplam', ''])
            headers.append(el('th', 'small text-nowrap', title));
        head.append(headers);
        const list = el('tbody'); list.dataset.itemsList = '';
        table.append(head, list); scroller.append(table);
        const summary = el('div', 'small fw-bold p-2 rounded border bg-light'); summary.dataset.itemsSummary = '';
        const budgetHint = el('div', 'd-flex align-items-center justify-content-between gap-2 small mt-2');
        const note = el('span', 'text-muted'); note.dataset.budgetNote = '';
        const resetBudget = el('button', 'btn btn-sm btn-outline-secondary', 'Hesaplananı kullan');
        resetBudget.type = 'button'; resetBudget.dataset.budgetAuto = ''; resetBudget.disabled = view || legacy;
        budgetHint.append(note, resetBudget);
        root._savedEstimateRates = record?.budgetEstimateRates && Object.keys(record.budgetEstimateRates).length
            ? record.budgetEstimateRates : null;
        root.append(header, scroller, summary, budgetHint);
        const budget = budgetInput();
        if (budget) {
            budget.dataset.budgetMode = record?.budgetMode || (record?.butce && Array.isArray(record.items) ? 'manual' : 'auto');
            budget.oninput = () => { budget.dataset.budgetMode = 'manual'; refresh(); };
        }
        root.oninput = refresh;
        root.onchange = refresh;
        root.onclick = event => {
            if (event.target.closest('[data-add-item]')) { if (list.children.length < money().MAX_ITEMS) addLine(); else alert('En fazla 3 kalem eklenebilir.'); }
            if (event.target.closest('[data-remove-item]')) { event.target.closest('[data-item-id]')?.remove(); refresh(); }
            if (event.target.closest('[data-budget-auto]')) { if (budget) budget.dataset.budgetMode = 'auto'; refresh(); }
        };
        (record ? money().readItems(record) : [{}]).forEach(line => addLine(line, view));
        if (record?.exchangeRate) {
            let tryTotal = '—';
            try { tryTotal = money().reportingTry(record); } catch { /* Bozuk veri ayrıntıda uyarı olarak kalır. */ }
            const fx = el('div', 'small text-muted mt-2',
                `Onay kuru (${record.exchangeRateDate || ''}, ${record.exchangeRateSource || ''}): ${Object.entries(record.exchangeRate).filter(([c]) => c === 'TRY' || record.items?.some(line => line.currency === c)).map(([c, v]) => `${c} ${v}`).join(' · ')} · TRY karşılığı ${tryTotal}`);
            root.append(fx);
        }
        if (record && !Array.isArray(record.items)) {
            const note = el('div', 'small text-muted mt-1', 'Eski tek ürünlü kayıt: ödenek eski bütçedir; birim fiyat ve KDV bilinmiyor. Mevcut alanlar kalem dönüşümü olmadan düzenlenebilir.');
            root.append(note);
            if (view) summary.textContent = `Eski kayıt ödeneği: ${record.butce ?? '—'} TRY · Kalem fiyatı ve KDV bilinmiyor.`;
            budgetHint.remove();
        }
    }
    function read() {
        if (host()?.dataset.legacy === 'true') return null;
        const invalid = host()?.querySelector('input:invalid');
        if (invalid) { invalid.reportValidity(); throw new Error(invalid.validationMessage); }
        return money().calculate(rawRows());
    }
    function readBudget() {
        const input = budgetInput();
        const value = input?.value ?? '';
        if (!value.trim()) throw new Error('Ödenek tutarı girilmeli. Dövizli kalemlerde planlanan TRY ödeneğini elle belirtin.');
        const minor = money().scaled(value, 2, 'Ödenek tutarı');
        const used = new Set(rawRows().filter(row => row.currency !== 'TRY').map(row => row.currency));
        const rates = Object.fromEntries([...used].filter(c => estimateRates()?.[c] > 0).map(c => [c, estimateRates()[c]]));
        return { amount: Number(minor) / 100, mode: input.dataset.budgetMode === 'manual' ? 'manual' : 'auto', estimateRates: rates };
    }
    // İlk onayda güncel yönetici ayarı okunur; ayrıca kur giriş penceresi açılmaz.
    async function requestRates(record) {
        if (record?.exchangeRate) return null;
        if (Array.isArray(record?.items) && !record.items.some(line => line.currency !== 'TRY'))
            return { exchangeRate: { TRY: 1, USD: 1, EUR: 1 }, exchangeRateDate: today(),
                exchangeRateSource: 'TRY', reportingTotalTRY: money().calculate(record.items).totals.TRY.total };
        const config = await window.AppModules.EBYSRates.fresh();
        return money().snapshotRates(record, { rates: config.rates, date: config.date, source: config.source });
    }
    function print(record) {
        const pane = el('section', 'purchase-print-pane');
        pane.append(el('h2', '', 'Satın Alma Talebi'), el('p', '', `${record.evrakNo || ''} · ${record.tarih || ''} · ${record.talepEden || ''}`));
        pane.append(el('h3', '', record.urun || ''));
        const table = el('table', 'table table-sm');
        const head = el('tr');
        for (const label of ['Açıklama', 'Tür', 'Miktar', 'Birim', 'Birim fiyat', 'Para', 'KDV %', 'Toplam']) head.append(el('th', '', label));
        table.append(head);
        let lines = money().readItems(record);
        let totals = {};
        if (Array.isArray(record.items)) {
            try { const calculated = money().calculate(record.items); lines = calculated.items; totals = calculated.totals; }
            catch { pane.append(el('p', '', 'Mali kalemler doğrulanamadı.')); lines = []; }
        }
        for (const line of lines) {
            const row = el('tr');
            for (const value of [line.description, line.category, line.quantity, line.unit, line.unitPrice ?? '—', line.currency, line.taxRate ?? '—', line.totalPrice == null ? '—' : line.totalPrice.toFixed(2)]) row.append(el('td', '', String(value ?? '')));
            table.append(row);
        }
        pane.append(table);
        for (const [currency, value] of Object.entries(totals)) if (value?.total) pane.append(el('p', '', `${currency}: Ara ${value.subtotal.toFixed(2)} · KDV ${value.tax.toFixed(2)} · Genel ${value.total.toFixed(2)}`));
        if (!record.items) pane.append(el('p', '', `Eski kayıt ödeneği: ${record.butce ?? '—'} TRY; kalem fiyatı bilinmiyor.`));
        if (record.exchangeRate) {
            let tryTotal = '—';
            try { tryTotal = money().reportingTry(record); } catch { /* Bozuk veri yazdırma uyarısında kalır. */ }
            const shownRates = Object.fromEntries(Object.entries(record.exchangeRate).filter(([c]) => c === 'TRY' || record.items?.some(line => line.currency === c)));
            pane.append(el('p', '', `Kur: ${JSON.stringify(shownRates)} · ${record.exchangeRateDate || ''} · ${record.exchangeRateSource || ''} · TRY karşılığı ${tryTotal}`));
        }
        pane.append(el('p', '', `Gerekçe: ${record.aciklama || '—'}`));
        document.body.append(pane);
        document.body.classList.add('printing-purchase');
        const cleanup = () => { pane.remove(); document.body.classList.remove('printing-purchase'); window.removeEventListener('afterprint', cleanup); };
        window.addEventListener('afterprint', cleanup, { once: true });
        window.print();
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.PurchaseItemsUI = Object.freeze({ open, read, readBudget, refresh, print, requestRates });
    window.addEventListener('ebysRatesUpdated', refresh);
})();
