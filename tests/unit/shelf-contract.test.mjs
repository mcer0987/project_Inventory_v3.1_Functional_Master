// v3.3 · Aşama 1 — Ortak raf/slot veri sözleşmesi (Denetim P1-02 temeli, P2-05): Schema.normShelfCode / itemShelfCode /
// isSlotOccupying / computeUsedSlots / slotUsageByShelf / shelfDocId / buildShelfDoc / validateShelfDoc ve
// ShelfCapacity'nin bu sözleşmeye devri. schema.js ve shelf-capacity.js gerçek dosyalarıyla, tarayıcısız (vm) yüklenir.
// Usage: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function memoryStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: k => { store.delete(k); },
        _store: store,
    };
}

// vm bağlamında üretilen dizilerin prototipi test bağlamınınkinden farklıdır (deepStrictEqual "aynı yapı, farklı referans"
// der); fonksiyonların dizi sonuçları ve dizi sabitleri test bağlamına kopyalanır. Hatalar { name } ile karşılaştırılır.
const plain = v => JSON.parse(JSON.stringify(v));
const sameRealm = obj => new Proxy(obj, {
    get(target, key) {
        const v = target[key];
        if (Array.isArray(v)) return plain(v);
        if (typeof v !== 'function') return v;
        return (...args) => { const r = v(...args); return Array.isArray(r) ? plain(r) : r; };
    },
});

function loadSchema() {
    const ctx = vm.createContext({ window: {}, console });
    vm.runInContext(read('src/utils/schema.js'), ctx, { filename: 'schema.js' });
    return sameRealm(ctx.window.Schema);
}

// admin.html sırası: shelf-capacity.js schema.js'ten ÖNCE yüklenir — testte de aynı sıra kullanılır.
function loadBoth({ data = {}, storage = {} } = {}) {
    const window = { data };
    const localStorage = memoryStorage(storage);
    const ctx = vm.createContext({ window, localStorage, console: { ...console, error: () => {} } });
    vm.runInContext(read('src/utils/shelf-capacity.js'), ctx, { filename: 'shelf-capacity.js' });
    vm.runInContext(read('src/utils/schema.js'), ctx, { filename: 'schema.js' });
    return { S: sameRealm(window.Schema), SC: sameRealm(window.ShelfCapacity), window, localStorage };
}

const item = (raf, adet = 1, extra = {}) => ({ id: `x_${Math.random()}`, raf, adet, durumu: 'Kullanıma Hazır', ...extra });

const validShelf = () => ({
    code: 'RAF-A 1', depot: 'b1', capacity: 5, usedSlots: 0, active: true, updatedAt: 1761600000000, updatedBy: 'uid_admin_1',
});

// ─── Normalizasyon ───────────────────────────────────────────────────────────────────────────────────────────────

test('normShelfCode: "A-12", "a-12", " A-12 ", "a - 12" tek kanonik koda iner', () => {
    const S = loadSchema();
    for (const v of ['A-12', 'a-12', ' A-12 ', 'a - 12', '\tA-12\n', 'A​-12']) {
        assert.equal(S.normShelfCode(v), 'A-12', JSON.stringify(v));
    }
});

test('normShelfCode: gerçek konfigürasyon kodları — iç boşluk korunur, fazla boşluk tekilleşir', () => {
    const S = loadSchema();
    assert.equal(S.normShelfCode('Raf-A 1'), 'RAF-A 1');
    assert.equal(S.normShelfCode('raf-a   1'), 'RAF-A 1');
    assert.equal(S.normShelfCode('Raf - A 1 '), 'RAF-A 1');
    assert.equal(S.normShelfCode('Zemin'), 'ZEMIN');
    assert.equal(S.normShelfCode('Raf-1'), 'RAF-1');
});

test('normShelfCode: Türkçe i/ı/İ tek harfe katlanır; tam genişlik ve tire varyantları ASCII olur', () => {
    const S = loadSchema();
    assert.equal(S.normShelfCode('raf-i 1'), 'RAF-I 1');
    assert.equal(S.normShelfCode('raf-ı 1'), 'RAF-I 1');
    assert.equal(S.normShelfCode('RAF-İ 1'), 'RAF-I 1');
    assert.equal(S.normShelfCode('Raf-I 1'), 'RAF-I 1');
    assert.equal(S.normShelfCode('Ａ－１２'), 'A-12');
    assert.equal(S.normShelfCode('A–12'), 'A-12');   // en dash
    assert.equal(S.normShelfCode('A−12'), 'A-12');   // eksi işareti
    assert.equal(S.normShelfCode('şömine-ğ'), 'ŞÖMINE-Ğ');
});

test('normShelfCode: boş/null/"-" → "" (rafsız); sıfır dolgusu anlamlıdır; idempotent', () => {
    const S = loadSchema();
    for (const v of [undefined, null, '', '   ', '-', ' - ']) assert.equal(S.normShelfCode(v), '', JSON.stringify(v));
    assert.notEqual(S.normShelfCode('A-1'), S.normShelfCode('A-01'));
    assert.equal(S.normShelfCode(12), '12');
    for (const v of ['a-12', 'Raf-A 1', 'raf-ı 1', 'Ａ－１２']) {
        const once = S.normShelfCode(v);
        assert.equal(S.normShelfCode(once), once, `idempotent: ${v}`);
    }
});

test('isValidShelfCode: yalnız kanonik, belge kimliği yapılabilir kodlar', () => {
    const S = loadSchema();
    for (const ok of ['A-12', 'RAF-A 1', 'ZEMIN', 'B2.3', 'R_1', 'ŞÖMINE']) assert.equal(S.isValidShelfCode(ok), true, ok);
    for (const bad of ['', 'a-12', ' A-12', 'A/12', '_A', '.A', '-A', 'A'.repeat(41), 'RAF-İ 1', null, 12]) {
        assert.equal(S.isValidShelfCode(bad), false, JSON.stringify(bad));
    }
    assert.equal(S.isValidShelfCode('A'.repeat(40)), true);
});

test('itemShelfCode: raf → shelf → rafNo; boş ve "-" atlanır', () => {
    const S = loadSchema();
    assert.equal(S.itemShelfCode({ raf: ' a-12 ' }), 'A-12');
    assert.equal(S.itemShelfCode({ raf: '-', shelf: 'b-3' }), 'B-3');
    assert.equal(S.itemShelfCode({ raf: '', shelf: '', rafNo: 'c 1' }), 'C 1');
    assert.equal(S.itemShelfCode({ raf: '-' }), '');
    assert.equal(S.itemShelfCode({}), '');
    assert.equal(S.itemShelfCode(null), '');
});

// ─── Slot işgali ─────────────────────────────────────────────────────────────────────────────────────────────────

test('isSlotOccupying: pozitif adet + aktif durum → slot; adet slotu artırmaz', () => {
    const S = loadSchema();
    assert.equal(S.isSlotOccupying(item('A-1', 1)), true);
    assert.equal(S.isSlotOccupying(item('A-1', 250)), true);
    assert.equal(S.isSlotOccupying(item('A-1', '3')), true, 'string adet');
    assert.equal(S.isSlotOccupying({ qty: 2, status: 'Aktif' }), true, 'eski takma ad qty');
    assert.equal(S.isSlotOccupying(item('A-1', 0)), false);
    assert.equal(S.isSlotOccupying(item('A-1', -1)), false);
    assert.equal(S.isSlotOccupying(item('A-1', 'abc')), false);
    assert.equal(S.isSlotOccupying(null), false);
});

test('isSlotOccupying: Tükendi / Stok dışı / Pasif (her yazımla) slot işgal etmez', () => {
    const S = loadSchema();
    for (const durumu of ['Tükendi', 'TÜKENDİ', 'tukendi', 'Stok Dışı', 'STOK DIŞI', 'stok disi', 'Pasif', ' pasif ',
        'Tükendi / Pasif', 'Pasif (Arızalı)']) {
        assert.equal(S.isSlotOccupying(item('A-1', 3, { durumu })), false, durumu);
    }
});

test('isSlotOccupying: Hurda / Servis Sürecinde / boş durum pozitif adetle slot işgal eder', () => {
    const S = loadSchema();
    for (const durumu of ['Hurda', 'Servis Sürecinde', 'Arızalı', '', '-', 'Mevcut']) {
        assert.equal(S.isSlotOccupying(item('A-1', 1, { durumu })), true, JSON.stringify(durumu));
    }
});

test('isSlotOccupying: b2 — durumu ya da status pasifse slot yok (iki alanın farklılaştığı eski kayıtlar)', () => {
    const S = loadSchema();
    assert.equal(S.isSlotOccupying({ raf: 'Z', adet: 1, durumu: 'Kullanıma Hazır', status: 'Pasif' }), false);
    assert.equal(S.isSlotOccupying({ raf: 'Z', adet: 1, durumu: '', status: 'Pasif' }), false);
    assert.equal(S.isSlotOccupying({ raf: 'Z', adet: 1, durumu: 'Pasif', status: 'Aktif' }), false);
    assert.equal(S.isSlotOccupying({ raf: 'Z', adet: 1, durumu: 'Aktif', status: 'Aktif' }), true);
});

test('computeUsedSlots: her pozitif/aktif kayıt 1 slot; raf yazım farkları aynı rafta sayılır', () => {
    const S = loadSchema();
    const items = [
        item('A-12', 100), item('a-12', 1), item(' A - 12 ', 7),     // 3 slot (adetler slotu artırmaz)
        item('A-12', 0),                                               // tükenmiş → 0
        item('A-12', 5, { durumu: 'Pasif' }),                          // pasif → 0
        item('A-13', 1), item('', 4), item('-', 4),                    // başka raf / rafsız
    ];
    assert.equal(S.computeUsedSlots(items, 'a-12'), 3);
    assert.equal(S.computeUsedSlots(items, 'A-13'), 1);
    assert.equal(S.computeUsedSlots(items, 'A-99'), 0);
    assert.equal(S.computeUsedSlots(items, ''), 0, 'rafsız kayıtlar bir rafın slotu sayılmaz');
    assert.equal(S.computeUsedSlots(Object.fromEntries(items.map((it, i) => [i, it])), 'A-12'), 3, 'nesne koleksiyonu');
    assert.equal(S.computeUsedSlots(undefined, 'A-12'), 0);
});

test('slotUsageByShelf: kanonik koda göre gruplar; rafsız işgaller "" anahtarında', () => {
    const S = loadSchema();
    const usage = S.slotUsageByShelf([item('Raf-A 1'), item('raf-a 1'), item('Raf-B 2'), item('-'), item('Zemin', 0)]);
    assert.deepEqual({ ...usage }, { 'RAF-A 1': 2, 'RAF-B 2': 1, '': 1 });
});

// ─── Raf belgesi sözleşmesi ──────────────────────────────────────────────────────────────────────────────────────

test('shelfDocId: deterministik `${depot}_${code}`; geçersiz depo/kod → RangeError', () => {
    const S = loadSchema();
    assert.equal(S.shelfDocId('b1', ' raf-a 1 '), 'b1_RAF-A 1');
    assert.equal(S.shelfDocId('b1', 'Raf-A 1'), S.shelfDocId('b1', 'RAF - A 1'));
    assert.notEqual(S.shelfDocId('b1', 'Zemin'), S.shelfDocId('b2', 'Zemin'));
    assert.throws(() => S.shelfDocId('b3', 'A-1'), { name: 'RangeError' });
    assert.throws(() => S.shelfDocId('b1', ''), { name: 'RangeError' });
    assert.throws(() => S.shelfDocId('b1', '-'), { name: 'RangeError' });
    assert.throws(() => S.shelfDocId('b1', 'A/1'), { name: 'RangeError' }, 'belge yolunu bölecek "/" reddedilir');
    assert.equal(S.SHELF_COLLECTION, 'shelves');
});

test('buildShelfDoc: varsayılanlar (kapasite 5, usedSlots 0, active true) ve kanonik kod; çıktı sözleşmeden geçer', () => {
    const S = loadSchema();
    const d = S.buildShelfDoc({ depot: 'b2', code: ' zemin ', updatedBy: 'uid_1' });
    assert.equal(d.code, 'ZEMIN');
    assert.equal(d.capacity, 5);
    assert.equal(d.usedSlots, 0);
    assert.equal(d.active, true);
    assert.equal(typeof d.updatedAt, 'number');
    assert.deepEqual(plain(Object.keys(d).sort()), plain([...S.SHELF_KEYS].sort()));
    assert.deepEqual(S.validateShelfDoc(d, { id: 'b2_ZEMIN' }), []);
    assert.equal(S.buildShelfDoc({ depot: 'b1', code: 'A', capacity: 12, active: false, updatedBy: 'u' }).active, false);
});

test('validateShelfDoc: geçerli belge → hata yok; her eksik alan ayrı yakalanır', () => {
    const S = loadSchema();
    assert.deepEqual(S.validateShelfDoc(validShelf()), []);
    for (const k of S.SHELF_KEYS) {
        const bad = validShelf(); delete bad[k];
        assert.ok(S.validateShelfDoc(bad).some(e => e === `eksik alan: ${k}`), `${k} eksikliği yakalanmalı`);
    }
    assert.deepEqual(S.validateShelfDoc(null), ['kayıt yok']);
    assert.deepEqual(S.validateShelfDoc([]), ['kayıt yok']);
});

test('validateShelfDoc: kapasite 1–200 arası tam sayı', () => {
    const S = loadSchema();
    for (const capacity of [1, 5, 200]) assert.deepEqual(S.validateShelfDoc({ ...validShelf(), capacity }), [], String(capacity));
    for (const capacity of [0, -1, 201, 2.5, '5', null, NaN]) {
        assert.ok(S.validateShelfDoc({ ...validShelf(), capacity }).some(e => e.startsWith('geçersiz kapasite')), String(capacity));
    }
});

test('validateShelfDoc: depo, kod, usedSlots, active, updatedAt, updatedBy tip/biçim kuralları', () => {
    const S = loadSchema();
    const has = (patch, prefix) => S.validateShelfDoc({ ...validShelf(), ...patch }).some(e => e.startsWith(prefix));
    assert.ok(has({ depot: 'b3' }, 'geçersiz depo'));
    assert.ok(has({ code: 'raf-a 1' }, 'geçersiz raf kodu'), 'normalize edilmemiş kod reddedilir');
    assert.ok(has({ code: 'A/1' }, 'geçersiz raf kodu'));
    assert.ok(has({ code: '' }, 'geçersiz raf kodu'));
    assert.ok(has({ usedSlots: -1 }, 'geçersiz usedSlots'));
    assert.ok(has({ usedSlots: 1.5 }, 'geçersiz usedSlots'));
    assert.ok(has({ active: 'true' }, 'active boolean değil'));
    assert.ok(has({ updatedAt: 'dün' }, 'updatedAt'));
    assert.ok(has({ updatedAt: 0 }, 'updatedAt'));
    assert.ok(has({ updatedAt: null }, 'updatedAt'));
    assert.ok(has({ updatedBy: '' }, 'updatedBy'));
    assert.ok(has({ updatedBy: 42 }, 'updatedBy'));
    assert.ok(has({ updatedBy: 'u'.repeat(129) }, 'updatedBy'));
    // Firestore Timestamp / serverTimestamp() sentinel'i nesnedir; sunucu zamanı kuralı firestore.rules'ta (Aşama 3).
    assert.deepEqual(S.validateShelfDoc({ ...validShelf(), updatedAt: { seconds: 1, nanoseconds: 0 } }), []);
});

test('validateShelfDoc: fazla alan reddedilir; usedSlots > capacity belge hatası değildir (Aşama 6 aşım durumu)', () => {
    const S = loadSchema();
    assert.ok(S.validateShelfDoc({ ...validShelf(), note: 'x' }).includes('bilinmeyen alan: note'));
    assert.ok(S.validateShelfDoc({ ...validShelf(), raf: 'A' }).includes('bilinmeyen alan: raf'));
    assert.deepEqual(S.validateShelfDoc({ ...validShelf(), capacity: 2, usedSlots: 3 }), []);
});

test('validateShelfDoc: opts.id belge kimliği shelfDocId ile aynı olmalı', () => {
    const S = loadSchema();
    assert.deepEqual(S.validateShelfDoc(validShelf(), { id: 'b1_RAF-A 1' }), []);
    assert.ok(S.validateShelfDoc(validShelf(), { id: 'b2_RAF-A 1' }).some(e => e.startsWith('belge kimliği uyumsuz')));
    assert.ok(S.validateShelfDoc(validShelf(), { id: 'b1_Raf-A 1' }).some(e => e.startsWith('belge kimliği uyumsuz')));
    assert.equal(S.shelfDocId(validShelf().depot, validShelf().code), 'b1_RAF-A 1');
});

// ─── ShelfCapacity → sözleşmeye devir ────────────────────────────────────────────────────────────────────────────

test('ShelfCapacity sabitleri Schema sözleşmesiyle aynı', () => {
    const { S, SC } = loadBoth();
    assert.equal(SC.DEFAULT_CAPACITY, S.SHELF_DEFAULT_CAPACITY);
    assert.equal(SC.MAX_CAPACITY, S.SHELF_MAX_CAPACITY);
});

test('ShelfCapacity: schema.js sonradan yüklense de çalışır; hiç yüklenmezse sessiz hesap yerine hata', () => {
    const { SC } = loadBoth({ data: { b1: [item('A-1')] } });
    assert.equal(SC.slotStats('b1', 'a-1').used, 1);

    const ctx = vm.createContext({ window: { data: { b1: [] } }, localStorage: memoryStorage(), console });
    vm.runInContext(read('src/utils/shelf-capacity.js'), ctx);
    assert.throws(() => ctx.window.ShelfCapacity.slotStats('b1', 'A-1'), /schema\.js/);
    assert.throws(() => ctx.window.ShelfCapacity.capacityFor('b1', 'A-1'), /schema\.js/);
});

test('ShelfCapacity.slotStats: kanonik raf ve ortak slot tanımıyla sayar (eski ham karşılaştırma yerine)', () => {
    const data = { b1: [
        item('Raf-A 1', 10), item('raf-a 1', 1), item('RAF - A 1', 2),
        item('Raf-A 1', 0), item('Raf-A 1', 3, { durumu: 'Tükendi / Pasif' }),
    ] };
    const { SC } = loadBoth({ data, storage: { shelf_capacities: JSON.stringify({ 'b1:Raf-A 1': 3 }) } });
    const notRegistered = { registered: false, counted: null, active: null };
    assert.deepEqual({ ...SC.slotStats('b1', ' raf-a 1') }, { used: 3, capacity: 3, available: 0, full: true, ...notRegistered });
    assert.deepEqual({ ...SC.slotStats('b1', 'Raf-A 2') }, { used: 0, capacity: 5, available: 5, full: false, ...notRegistered });
});

test('v3.3 Aşama 2: ortak raf kataloğu (window.data.shelves) localStorage ayarından önce gelir', () => {
    const data = {
        b1: [item('Raf-A 1', 2)],
        shelves: [{ id: 'b1_RAF-A 1', code: 'RAF-A 1', depot: 'b1', capacity: 8, usedSlots: 1, active: true }],
    };
    const { SC } = loadBoth({ data, storage: { shelf_capacities: JSON.stringify({ 'b1:Raf-A 1': 3, 'b1:Raf-A 2': 4 }) } });
    assert.equal(SC.capacityFor('b1', 'raf-a 1'), 8, 'katalog kazanır');
    assert.equal(SC.capacityFor('b1', 'Raf-A 2'), 4, 'katalogda olmayan raf: geçiş dönemi localStorage');
    assert.equal(SC.capacityFor('b1', 'Raf-A 3'), 5, 'hiçbiri yoksa varsayılan');
    assert.deepEqual({ ...SC.slotStats('b1', 'Raf-A 1') }, { used: 1, capacity: 8, available: 7, full: false, registered: true, counted: 1, active: true });
    assert.equal(SC.shelfDoc('b1', 'A/1'), null, 'geçersiz kod → katalog kaydı yok (hata değil)');
});

test('v3.3 Aşama 2: isWatched isteğe bağlı kanonik alan — set\'te zorunlu değil, boolean olmalı', () => {
    const { S } = loadBoth();
    assert.ok(S.B1_OPTIONAL_KEYS.includes('isWatched') && S.B2_OPTIONAL_KEYS.includes('isWatched'));
    assert.ok(!S.B1_KEYS.includes('isWatched'), 'tam kayıt sözleşmesinde zorunlu alan değil');
    assert.deepEqual(S.validateB1({ isWatched: true }, { partial: true }), []);
    assert.ok(S.validateB1({ isWatched: 'evet' }, { partial: true }).includes('isWatched boolean değil'));
});

test('ShelfCapacity: eski ham anahtarlar kanonik anahtara çevrilir; çakışmada küçük (sıkı) değer', () => {
    const storage = { shelf_capacities: JSON.stringify({ 'b1:Raf-A 1': 8, 'b1:raf-a 1': 4, 'b2:Zemin': 20, 'b3:X': 9, 'b1:-': 7 }) };
    const { SC } = loadBoth({ storage });
    assert.equal(SC.capacityFor('b1', 'RAF-A 1'), 4);
    assert.equal(SC.capacityFor('b2', 'zemin'), 20);
    assert.equal(SC.capacityFor('b1', 'Zemin'), 5, 'depo ayrımı korunur');
});

test('ShelfCapacity.setCapacity: kanonik anahtarla yazar; yazım farkı aynı rafı günceller', () => {
    const { SC, localStorage } = loadBoth();
    assert.equal(SC.setCapacity('b1', ' raf-a 1 ', 12), true);
    assert.deepEqual(JSON.parse(localStorage.getItem('shelf_capacities')), { 'b1:RAF-A 1': 12 });
    assert.equal(SC.capacityFor('b1', 'Raf-A 1'), 12);
    SC.setCapacity('b1', 'RAF-A 1', 7);
    assert.deepEqual(JSON.parse(localStorage.getItem('shelf_capacities')), { 'b1:RAF-A 1': 7 });
    assert.throws(() => SC.setCapacity('b1', '-', 5), { name: 'RangeError' });
    assert.throws(() => SC.setCapacity('b1', 'A', 201), { name: 'RangeError' });
    assert.throws(() => SC.setCapacity('b3', 'A', 5), { name: 'RangeError' });
});

test('ShelfCapacity sözleşme fonksiyonlarını Schema ile aynı sonuçla yeniden dışa verir', () => {
    const { S, SC } = loadBoth();
    assert.equal(SC.normShelfCode(' a - 12 '), S.normShelfCode(' a - 12 '));
    assert.deepEqual(SC.validateShelfDoc(validShelf()), []);
    assert.equal(SC.computeUsedSlots([item('a-1'), item('A-1')], 'A-1'), 2);
});
