// [WHY]: Satın alma tutarları ikili kayan nokta çarpımıyla hesaplanırsa kuruş farkı oluşur.
// [HOW]: Girdileri ondalık metinden tam sayı ölçeğine çevirir; her kalemde net ve KDV'yi yarım-yukarı yuvarlar.
(function () {
    'use strict';
    const currencies = Object.freeze(['TRY', 'USD', 'EUR']);
    const MAX_ITEMS = 3;
    const MAX_MINOR = 100000000000n;

    function scaled(value, digits, label) {
        const raw = String(value ?? '').trim().replace(',', '.');
        if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label} geçerli bir sayı olmalı.`);
        const [whole, part = ''] = raw.split('.');
        if (part.length > digits) throw new Error(`${label} en fazla ${digits} ondalık basamak içerebilir.`);
        const n = BigInt(whole) * (10n ** BigInt(digits)) + BigInt((part || '0').padEnd(digits, '0'));
        if (n > MAX_MINOR) throw new Error(`${label} üst sınırı aşıyor.`);
        return n;
    }
    const round = (n, divisor) => (n + divisor / 2n) / divisor;
    function decimal(n, digits = 2) {
        const factor = 10n ** BigInt(digits);
        return Number(`${n / factor}.${String(n % factor).padStart(digits, '0')}`);
    }
    function money(n) { return decimal(n); }

    function calculateLine(input) {
        const description = String(input.description || '').trim();
        const category = String(input.category || '').trim();
        const unit = String(input.unit || '').trim();
        const currency = String(input.currency || 'TRY');
        if (!description || description.length > 240 || !category || category.length > 120 || !unit || unit.length > 40)
            throw new Error('Kalem açıklaması, türü ve birimi zorunludur; uzunluk sınırını aşamaz.');
        if (/<[a-zA-Z/!?]/.test(`${description} ${category} ${unit}`)) throw new Error('Kalem metninde HTML etiketi kullanılamaz.');
        if (!currencies.includes(currency)) throw new Error('Para birimi TRY, USD veya EUR olmalı.');
        const q = scaled(input.quantity, 3, 'Miktar');
        const p = scaled(input.unitPrice, 2, 'Birim fiyat');
        const taxBp = scaled(input.taxRate, 2, 'KDV oranı');
        if (q === 0n || taxBp > 10000n) throw new Error('Miktar sıfırdan büyük, KDV 0–100 arasında olmalı.');
        const subtotal = round(q * p, 1000n);
        const tax = round(subtotal * taxBp, 10000n);
        if (subtotal + tax > MAX_MINOR) throw new Error('Kalem toplamı üst sınırı aşıyor.');
        return {
            id: String(input.id || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)),
            description, category, quantity: decimal(q, 3), unit,
            unitPrice: money(p), currency, taxRate: decimal(taxBp), totalPrice: money(subtotal + tax)
        };
    }
    function calculate(items) {
        if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw new Error('1–3 kalem girilmeli.');
        const ids = new Set();
        const minor = { TRY: { subtotal: 0n, tax: 0n }, USD: { subtotal: 0n, tax: 0n }, EUR: { subtotal: 0n, tax: 0n } };
        const lines = items.map(raw => {
            const line = calculateLine(raw);
            if (ids.has(line.id)) throw new Error('Kalem kimlikleri tekrar edemez.');
            ids.add(line.id);
            const subtotal = round(scaled(line.quantity, 3, 'Miktar') * scaled(line.unitPrice, 2, 'Birim fiyat'), 1000n);
            const tax = round(subtotal * scaled(line.taxRate, 2, 'KDV oranı'), 10000n);
            const bucket = minor[line.currency];
            bucket.subtotal += subtotal;
            bucket.tax += tax;
            return line;
        });
        const result = {};
        for (const currency of currencies) {
            const bucket = minor[currency];
            result[currency] = { subtotal: money(bucket.subtotal), tax: money(bucket.tax), total: money(bucket.subtotal + bucket.tax) };
        }
        return { items: lines, totals: result };
    }
    // [WHY]: Eski tek ürünlü belgeler açılırken veritabanına sessiz göç yazılmamalı.
    // [HOW]: Bütçeyi tahmini birim fiyat gibi göstermeden yalnız görsel, sanal bir kalem üretir.
    function readItems(record) {
        if (Array.isArray(record?.items) && record.items.length) return record.items;
        return [{ id: `legacy-${record?.id ?? 'unknown'}`, description: String(record?.urun || 'Eski talep'),
            category: String(record?.tur || 'Belirtilmemiş'), quantity: Number(record?.adet) || 1,
            unit: 'Adet', unitPrice: null, currency: 'TRY', taxRate: null, totalPrice: null, legacy: true }];
    }
    // [WHY]: Onaydan sonra canlı kur değişse de tarihsel TRY rapor toplamı aynı kalmalı.
    // [HOW]: İlk onayda Operasyon Merkezi'nden okunan kurları altı ondalık ölçeğinde çevirir ve belgeye kopyalar.
    function snapshotRates(record, submitted) {
        const used = currencies.filter(c => (record.items || []).some(line => line.currency === c));
        if (!used.some(c => c !== 'TRY')) return null;
        if (record.exchangeRate) return null;
        const exchangeRateDate = String(submitted.date || '').trim();
        const exchangeRateSource = String(submitted.source || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exchangeRateDate) || !exchangeRateSource || exchangeRateSource.length > 120 || /<[a-zA-Z/!?]/.test(exchangeRateSource))
            throw new Error('Kur tarihi (YYYY-AA-GG) ve kaynak bilgisi zorunludur.');
        // Yönetici ayarının tamamı belgeye kopyalanır; rapor hesabı yalnız kullanılan para birimlerini dikkate alır.
        const exchangeRate = { TRY: 1, USD: 1, EUR: 1 };
        for (const currency of currencies.filter(c => c !== 'TRY')) {
            const rate = scaled(submitted.rates?.[currency], 6, `${currency} kuru`);
            if (rate <= 0n) throw new Error(`${currency} kuru sıfırdan büyük olmalı.`);
            exchangeRate[currency] = decimal(rate, 6);
        }
        const totals = calculate(record.items).totals;
        let totalTryMinor = 0n;
        for (const currency of used) {
            const rate = currency === 'TRY' ? 1000000n : scaled(exchangeRate[currency], 6, `${currency} kuru`);
            if (rate === 0n) throw new Error(`${currency} kuru sıfırdan büyük olmalı.`);
            exchangeRate[currency] = decimal(rate, 6);
            const amountMinor = scaled(totals[currency].total, 2, `${currency} toplamı`);
            totalTryMinor += round(amountMinor * rate, 1000000n);
        }
        return { exchangeRate, exchangeRateDate, exchangeRateSource, reportingTotalTRY: money(totalTryMinor) };
    }
    function hasValidSnapshot(record) {
        if (!Array.isArray(record?.items)) return true;
        if (!record.exchangeRate || record.exchangeRate.TRY !== 1 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(String(record.exchangeRateDate || '')) ||
            !String(record.exchangeRateSource || '').trim() ||
            typeof record.reportingTotalTRY !== 'number' || !Number.isFinite(record.reportingTotalTRY)) return false;
        return currencies.every(c => c === 'TRY' || (typeof record.exchangeRate[c] === 'number' &&
            Number.isFinite(record.exchangeRate[c]) && record.exchangeRate[c] > 0));
    }
    function reportingTry(record) {
        if (!record?.exchangeRate || !Array.isArray(record.items)) return null;
        const totals = calculate(record.items).totals;
        let sum = 0n;
        for (const currency of currencies) {
            const rate = currency === 'TRY' ? 1000000n : scaled(record.exchangeRate[currency] ?? 0, 6, `${currency} kuru`);
            if (totals[currency].total && rate === 0n) throw new Error(`${currency} kuru eksik.`);
            sum += round(scaled(totals[currency].total, 2, `${currency} toplamı`) * rate, 1000000n);
        }
        return money(sum);
    }
    window.AppModules = window.AppModules || {};
    window.AppModules.PurchaseMoney = Object.freeze({ currencies, MAX_ITEMS, scaled, calculateLine, calculate, readItems, snapshotRates, hasValidSnapshot, reportingTry });
})();
