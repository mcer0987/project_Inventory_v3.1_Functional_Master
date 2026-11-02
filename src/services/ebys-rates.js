// Operasyon Merkezi kur tahminleri; satın alma formları bu tek kaynağı dinler.
import { doc, getDocFromServer, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { fireDb } from './firebase-handler.js';

const root = window.AppEnv.COLLECTION_ROOT;
const ratesRef = doc(fireDb, root, 'system_config', 'items', 'ebys_rates');
let current = null;
const money = () => window.AppModules.PurchaseMoney;
const form = document.getElementById('ebysRatesForm');

function validRate(raw, currency) {
    const scaled = money().scaled(String(raw).trim(), 6, `${currency} kuru`);
    if (scaled <= 0n || scaled > 100000000000n) throw new Error(`${currency} kuru 0 ile 100000 arasında olmalı.`);
    return Number(scaled) / 1000000;
}

function render() {
    if (!form) return;
    for (const currency of ['USD', 'EUR']) {
        const input = form.querySelector(`[name="${currency}"]`);
        if (input && document.activeElement !== input) input.value = current?.rates?.[currency] ?? '';
    }
    const date = form.querySelector('[name="date"]');
    const source = form.querySelector('[name="source"]');
    if (date && document.activeElement !== date) date.value = current?.date || '';
    if (source && document.activeElement !== source) source.value = current?.source || '';
    const status = document.getElementById('ebysRatesStatus');
    if (status) status.textContent = current ? `Geçerli tahmini kurlar: ${current.date} · ${current.source}` : 'Henüz kur tanımlanmadı.';
}

async function save(event) {
    event.preventDefault();
    const status = document.getElementById('ebysRatesStatus');
    try {
        if (!window.isDbAdmin?.()) throw new Error('Yönetici yetkisi gerekli.');
        const fields = new FormData(form);
        const date = String(fields.get('date') || '').trim();
        const source = String(fields.get('source') || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Geçerli kur tarihi girin.');
        if (!source || source.length > 120 || /<[a-zA-Z/!?]/.test(source)) throw new Error('Geçerli kur kaynağı girin.');
        await setDoc(ratesRef, {
            rates: { TRY: 1, USD: validRate(fields.get('USD'), 'USD'), EUR: validRate(fields.get('EUR'), 'EUR') },
            date, source, updatedAt: serverTimestamp(), updatedBy: window.userAuth?.uid || '',
        });
        if (status) status.textContent = 'Kurlar kaydedildi.';
    } catch (error) {
        if (status) status.textContent = error.message;
    }
}

if (form) form.addEventListener('submit', save);
window.registerSyncListener('ebys_rates', () => onSnapshot(ratesRef, snapshot => {
    current = snapshot.exists() ? snapshot.data() : null;
    render();
    window.dispatchEvent(new Event('ebysRatesUpdated'));
}, error => window.reportListenerError('ebys_rates', error)));
window.AppModules = window.AppModules || {};
window.AppModules.EBYSRates = Object.freeze({
    current: () => current,
    fresh: async () => {
        const snapshot = await getDocFromServer(ratesRef);
        if (!snapshot.exists()) throw new Error('Operasyon Merkezi’nde döviz kurları tanımlanmadı. Yönetici kurları kaydetmeli.');
        const value = snapshot.data();
        if (value.rates?.TRY !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')) ||
            !String(value.source || '').trim() || String(value.source).length > 120) {
            throw new Error('Operasyon Merkezi kur tarihi, kaynağı veya TRY temel kuru geçersiz. Yönetici ayarları düzeltmeli.');
        }
        validRate(value.rates.USD, 'USD');
        validRate(value.rates.EUR, 'EUR');
        return value;
    },
});
