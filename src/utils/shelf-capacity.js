(function () {
    'use strict';

    // [WHY]: v3.3 Aşama 1 (P2-05) — raf kodu, stokta/aktif tanımı ve slot hesabı bu dosyada WMS'ten farklı kuralla yapılıyordu.
    // [HOW]: Hepsi Schema'nın raf sözleşmesine devredilir (normShelfCode, computeUsedSlots). admin.html'de bu dosya schema.js'ten
    //        ÖNCE yüklendiği için Schema çağrı anında okunur; yoksa sessiz yanlış hesap yerine hata fırlatılır.
    //        localStorage kapasitesi yalnız GEÇİŞ dönemi kaynağıdır; ortak kaynak ${ROOT}/shelves/items (Aşama 2/4).
    const STORAGE_KEY = 'shelf_capacities';
    const DEFAULT_CAPACITY = 5;   // = Schema.SHELF_DEFAULT_CAPACITY (birim testi eşitliği denetler)
    const MAX_CAPACITY = 200;     // = Schema.SHELF_MAX_CAPACITY

    function schema() {
        const S = window.Schema;
        if (!S || typeof S.computeUsedSlots !== 'function') {
            throw new Error('Şema modülü (schema.js) yüklenmemiş; raf sözleşmesi uygulanamıyor.');
        }
        return S;
    }

    const keyOf = (depot, shelf) => `${depot}:${schema().normShelfCode(shelf)}`;

    // Eski ayarlar ham raf yazımıyla saklanmış olabilir ("b1:Raf-A 1"); okurken kanonik anahtara çevrilir. Aynı rafa düşen
    // birden fazla değer varsa küçük olan (daha sıkı) kullanılır — değerler sessizce toplanmaz/büyütülmez.
    function capacities() {
        const S = schema();   // try dışında: şema yoksa hata yutulup varsayılan kapasiteye düşülmesin
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Raf kapasitesi ayarı nesne biçiminde değil.');
            }
            const out = {};
            Object.entries(parsed).forEach(([key, value]) => {
                if (!/^b[12]:/.test(key) || !Number.isInteger(value) || value < 1 || value > MAX_CAPACITY) return;
                const code = S.normShelfCode(key.slice(3));
                if (!code) return;
                const canonical = `${key.slice(0, 2)}:${code}`;
                out[canonical] = canonical in out ? Math.min(out[canonical], value) : value;
            });
            return out;
        } catch (error) {
            console.error('[ShelfCapacity] Raf kapasite ayarı okunamadı:', error);
            return {};
        }
    }

    // v3.3 Aşama 2: ortak raf kataloğu (Firestore ${ROOT}/shelves/items, firebase-handler dinleyicisi → window.data.shelves).
    // Raf katalogda yoksa ya da geçersiz kodluysa null.
    function shelfDoc(depot, shelf) {
        const S = schema();
        const list = window.data && Array.isArray(window.data.shelves) ? window.data.shelves : [];
        const code = S.normShelfCode(shelf);
        if (!S.SHELF_DEPOTS.includes(depot) || !S.isValidShelfCode(code)) return null;
        const id = S.shelfDocId(depot, code);
        return list.find(s => s && s.id === id) || null;
    }

    // Karar sırası: ortak raf belgesi → (geçiş dönemi) bu tarayıcının eski localStorage ayarı → varsayılan.
    function capacityFor(depot, shelf) {
        const doc = shelfDoc(depot, shelf);
        if (doc && Number.isInteger(doc.capacity)) return doc.capacity;
        const value = capacities()[keyOf(depot, shelf)];
        return Number.isInteger(value) ? value : DEFAULT_CAPACITY;
    }

    // used: canlı kayıtlardan sayım (görünüm). registered/counted/active: ortak raf belgesi — son kararı transaction verir.
    function slotStats(depot, shelf) {
        const used = schema().computeUsedSlots((window.data && window.data[depot]) || [], shelf);
        const capacity = capacityFor(depot, shelf);
        const doc = shelfDoc(depot, shelf);
        return {
            used, capacity, available: Math.max(capacity - used, 0), full: used >= capacity,
            registered: !!doc, counted: doc && Number.isInteger(doc.usedSlots) ? doc.usedSlots : null, active: doc ? doc.active === true : null,
        };
    }

    function setCapacity(depot, shelf, capacity) {
        if (!['b1', 'b2'].includes(depot) || !schema().normShelfCode(shelf) ||
            !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
            throw new RangeError(`Depo raf kapasitesi 1 ile ${MAX_CAPACITY} arasında bir tam sayı olmalıdır.`);
        }
        const values = capacities();
        values[keyOf(depot, shelf)] = capacity;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
            return true;
        } catch (error) {
            console.error('[ShelfCapacity] Raf kapasitesi kaydedilemedi:', error);
            return false;
        }
    }

    // Sözleşme fonksiyonları tek kaynaktan (Schema) yeniden dışa verilir; ShelfCapacity kendi kopyasını tutmaz.
    const normShelfCode = value => schema().normShelfCode(value);
    const validateShelfDoc = (doc, opts) => schema().validateShelfDoc(doc, opts);
    const computeUsedSlots = (items, shelf) => schema().computeUsedSlots(items, shelf);

    window.ShelfCapacity = {
        DEFAULT_CAPACITY, MAX_CAPACITY, capacityFor, slotStats, setCapacity, shelfDoc,
        normShelfCode, validateShelfDoc, computeUsedSlots,
    };
})();
