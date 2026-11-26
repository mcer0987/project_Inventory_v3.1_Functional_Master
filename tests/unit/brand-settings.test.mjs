// v3.8 UX-5 — Kurumsal Logo Stüdyosu saf çekirdeği (src/ui/brand-logo.js): amblem kataloğu güvenliği, ayar doğrulaması,
// localStorage önbelleği ve firestore.rules › brandSettingsOk ile sınır eşliği. Gerçek dosya tarayıcısız (vm) yüklenir;
// DOM uygulaması ve stüdyo paneli Puppeteer'a bırakılır. Kural tarafı: tests/rules/brand-settings.test.mjs.
// Usage: node --test tests/unit/brand-settings.test.mjs   (ya da npm run test:unit)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/ui/brand-logo.js'), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

function load(win = {}) {
    const window = { ...win };
    vm.runInContext(SOURCE, vm.createContext({ window }), { filename: 'brand-logo.js' });
    return window.AppModules.BrandLogo;
}
const B = load();
const good = (o = {}) => ({ emblemId: 'cube', title: 'ENVANTER', subtitle: 'TAKİP SİSTEMİ', effect: 'none', customLogo: '', ...o });

// Özel logo örnekleri: yalnız desen/uzunluk sınanır (gerçek piksel verisi gerekmez).
const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WEBP_URI = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
const JPEG_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////';
const uriOfLength = n => 'data:image/webp;base64,'.padEnd(n, 'A'); // tam n karakter

/** buildEmblem için asgari DOM taklidi (createElement/createElementNS + classList). */
function fakeDocument() {
    const make = tag => {
        const el = { tag, children: [], attrs: {}, style: {}, classes: new Set(), textContent: '' };
        Object.defineProperty(el, 'className', {
            get: () => [...el.classes].join(' '),
            set: v => { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
        });
        el.classList = { add: (...c) => c.forEach(x => el.classes.add(x)), remove: (...c) => c.forEach(x => el.classes.delete(x)), contains: x => el.classes.has(x) };
        el.append = (...n) => { el.children.push(...n); };
        el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
        return el;
    };
    return { readyState: 'complete', createElement: make, createElementNS: (ns, tag) => make(tag), querySelector: () => null, getElementById: () => null, addEventListener() {} };
}
function loadWithDom() {
    const window = {};
    vm.runInContext(SOURCE, vm.createContext({ window, document: fakeDocument() }), { filename: 'brand-logo.js' });
    return window.AppModules.BrandLogo;
}

// Basit localStorage taklidi
function fakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
}

test('sabitler: 4 amblem, 4 efekt, varsayılanlar, sınırlar; modül dondurulmuş, DOM yokken yüklenir', () => {
    assert.deepEqual(plain(B.EMBLEMS.map(e => e.id)), ['cube', 'shield', 'crest', 'pulse-node']);
    assert.deepEqual(plain(B.EFFECTS.map(e => e.id)), ['shimmer', 'glow', 'pulse', 'none']);
    assert.deepEqual(plain(B.DEFAULTS), { emblemId: 'cube', title: 'ENVANTER', subtitle: 'TAKİP SİSTEMİ', effect: 'none', customLogo: '' });
    assert.deepEqual(plain(B.LIMITS), { title: 32, subtitle: 40 });
    assert.deepEqual(plain(B.LOGO), { maxChars: 45000, maxPx: 96, maxFileBytes: 5 * 1024 * 1024, maxSourcePixels: 25000000 });
    assert.ok(Object.isFrozen(B.LOGO));
    assert.ok(Object.isFrozen(B) && Object.isFrozen(B.EMBLEMS) && Object.isFrozen(B.EFFECTS) && Object.isFrozen(B.DEFAULTS));
    for (const e of B.EMBLEMS) assert.ok(e.label.length > 2 && /^#[0-9a-f]{6}$/i.test(e.color), e.id);
    for (const e of B.EFFECTS) assert.ok(e.label && e.hint, e.id);
    assert.equal(B.validate(B.DEFAULTS).ok, true, 'varsayılan ayar kendi doğrulamasından geçer');
});

test('katalog güvenliği: yalnız beyaz listeli SVG eleman/nitelikleri; betik, URL veya olay niteliği yok', () => {
    assert.deepEqual(plain(B.SVG_ALLOWED_TAGS), ['rect', 'path', 'circle', 'polyline']);
    for (const e of B.EMBLEMS) {
        assert.ok(e.shapes.length >= 2, `${e.id}: şekil sayısı`);
        for (const s of e.shapes) {
            assert.ok(B.SVG_ALLOWED_TAGS.includes(s.tag), `${e.id}: yasak eleman ${s.tag}`);
            for (const [name, value] of Object.entries(s.attrs)) {
                assert.ok(B.SVG_ALLOWED_ATTRS.includes(name), `${e.id}: yasak nitelik ${name}`);
                assert.ok(!/^on/i.test(name) && !/href/i.test(name), `${e.id}: olay/bağlantı niteliği`);
                assert.ok(!/[<>]|javascript:|url\(|data:/i.test(String(value)), `${e.id}: şüpheli değer ${value}`);
            }
        }
    }
    assert.ok(!B.SVG_ALLOWED_ATTRS.some(a => /^on|href|style/i.test(a)));
});

test('kaynak güvenliği: brand-logo.js innerHTML/outerHTML/insertAdjacentHTML/document.write kullanmaz; servis dışında Firebase yok', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
    assert.ok(!/\bimport\b|onSnapshot|getFirestore|window\.fireDb|systemConfigRef|\bsetDoc\(|\bgetDoc\(|\bdeleteDoc\(/.test(code), 'Firestore yalnız brand-settings-service.js\'te');
    const service = fs.readFileSync(path.join(ROOT, 'src/services/brand-settings-service.js'), 'utf8');
    assert.ok(!/innerHTML/.test(service));
    assert.match(service, /permission-denied/, 'oturumsuz/yetkisiz okuma hatası sessizce yutulur');
    assert.match(service, /onAppLogout/, 'çıkışta dinleyici kapanır');
});

test('validate: geçerli ayar kırpılır ve yalnız 5 alanla döner (fazladan alan yok sayılır)', () => {
    const r = B.validate(good({ title: '  MEDİPOL  ', subtitle: '  Envanter  ', extra: 'yok sayılır', logoUrl: 'https://x' }));
    assert.equal(r.ok, true);
    assert.deepEqual(plain(r.value), { emblemId: 'cube', title: 'MEDİPOL', subtitle: 'Envanter', effect: 'none', customLogo: '' });
    assert.deepEqual(plain(r.errors), {});
    for (const emblemId of ['cube', 'shield', 'crest', 'pulse-node']) assert.equal(B.validate(good({ emblemId })).ok, true);
    for (const effect of ['shimmer', 'glow', 'pulse', 'none']) assert.equal(B.validate(good({ effect })).ok, true);
});

test('validate: amblem/efekt beyaz liste, başlık 1–32, alt başlık 0–40, etiket benzeri "<" reddi (rules › noTag ile aynı)', () => {
    const bad = o => B.validate(good(o));
    assert.ok(bad({ emblemId: 'star' }).errors.emblemId);
    assert.ok(bad({ emblemId: undefined }).errors.emblemId);
    assert.ok(bad({ effect: 'spin' }).errors.effect);
    assert.ok(bad({ title: '' }).errors.title);
    assert.ok(bad({ title: '   ' }).errors.title);
    assert.ok(bad({ title: 'x'.repeat(33) }).errors.title);
    assert.equal(bad({ title: 'x'.repeat(32) }).ok, true);
    assert.ok(bad({ subtitle: 'x'.repeat(41) }).errors.subtitle);
    assert.equal(bad({ subtitle: 'x'.repeat(40) }).ok, true);
    assert.equal(bad({ subtitle: '' }).ok, true, 'alt başlık boş olabilir');
    for (const tag of ['<script>', '<img src=x>', 'a</b', '<!-- x', '<?php']) {
        assert.ok(bad({ title: tag }).errors.title, `başlık: ${tag}`);
        assert.ok(bad({ subtitle: tag }).errors.subtitle, `alt başlık: ${tag}`);
    }
    for (const fine of ['5 < 6', 'a < b', '<5mm', 'ENVANTER & TAKİP']) assert.equal(bad({ title: fine }).ok, true, fine);
    assert.equal(bad({ title: 42 }).ok, false, 'dize olmayan başlık');
    for (const nope of [null, undefined, 'metin', 7, []]) {
        const r = B.validate(nope);
        assert.equal(r.ok, false);
        assert.equal(r.value, null);
    }
});

test('rules eşliği: firestore.rules › brandSettingsOk sınırları ve beyaz listeleri istemciyle aynı', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const block = rules.slice(rules.indexOf('function brandSettingsOk'), rules.indexOf('function definitionOk'));
    assert.ok(block.length > 100, 'brandSettingsOk bulunamadı');
    const list = re => (block.match(re) || [])[1].split(',').map(s => s.trim().replace(/'/g, ''));
    assert.deepEqual(list(/d\.emblemId in \[([^\]]*)\]/), plain(B.EMBLEMS.map(e => e.id)));
    assert.deepEqual(list(/d\.effect in \[([^\]]*)\]/), plain(B.EFFECTS.map(e => e.id)));
    assert.equal(Number(block.match(/d\.title\.size\(\) <= (\d+)/)[1]), B.LIMITS.title);
    assert.equal(Number(block.match(/d\.subtitle\.size\(\) <= (\d+)/)[1]), B.LIMITS.subtitle);
    assert.match(block, /hasOnly\(\['emblemId', 'title', 'subtitle', 'effect', 'customLogo', 'updatedAt', 'updatedBy'\]\)/);
    assert.match(block, /hasAll\(\['emblemId', 'title', 'subtitle', 'effect', 'customLogo', 'updatedAt', 'updatedBy'\]\)/);
    assert.match(block, /noTag\(d\.title\)/);
    assert.match(block, /noTag\(d\.subtitle\)/);
    // Özel logo: sınır, noTag ve desen istemciyle aynı; boyut sınırı desenden önce değerlendirilir
    assert.equal(Number(block.match(/d\.customLogo\.size\(\) <= (\d+)/)[1]), B.LOGO.maxChars);
    assert.match(block, /d\.customLogo is string && d\.customLogo\.size\(\) <= 45000 && noTag\(d\.customLogo\)/);
    assert.match(block, /d\.customLogo == '' \|\| d\.customLogo\.matches\('data:image\/\(png\|jpeg\|webp\);base64,\[A-Za-z0-9\+\/=\]\+'\)/);
    assert.ok(SOURCE.includes('/^data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/'), 'istemci deseni kuralla aynı olmalı');
    assert.match(block, /d\.updatedAt == request\.time/);
    assert.match(block, /d\.updatedBy == request\.auth\.uid/);
    assert.match(rules, /system_config' && id == 'brand_settings' \? brandSettingsOk\(d\)/, 'definitionOk bu kolu çağırmalı');
});

test('önbellek: anahtar brand_settings_<root>; yaz → oku gidiş dönüşü; geçersiz değer yazılmaz', () => {
    const store = fakeStorage();
    assert.equal(B.cacheKey('lifeserver_master'), 'brand_settings_lifeserver_master');
    assert.equal(B.readCache('lifeserver_master', store), null, 'boş önbellek');
    assert.equal(B.writeCache(good({ emblemId: 'shield', effect: 'glow' }), 'lifeserver_master', store), true);
    assert.deepEqual(plain(B.readCache('lifeserver_master', store)), good({ emblemId: 'shield', effect: 'glow' }));
    assert.ok(store.map.has('brand_settings_lifeserver_master'));
    assert.equal(B.readCache('inventory_demo', store), null, 'kökler birbirinin önbelleğini görmez');
    assert.equal(B.writeCache(good({ emblemId: 'bilinmeyen' }), 'lifeserver_master', store), false);
    assert.equal(B.readCache('lifeserver_master', store).emblemId, 'shield', 'geçersiz yazma eskisini bozmaz');
    // Sunucu belgesindeki fazladan alanlar (updatedAt/updatedBy) önbelleğe sızmaz
    B.writeCache({ ...good(), updatedAt: 123, updatedBy: 'uid-1' }, 'lifeserver_master', store);
    assert.deepEqual(Object.keys(JSON.parse(store.map.get('brand_settings_lifeserver_master'))).sort(), ['customLogo', 'effect', 'emblemId', 'subtitle', 'title']);
    B.clearCache('lifeserver_master', store);
    assert.equal(B.readCache('lifeserver_master', store), null);
});

test('önbellek: bozuk JSON, şema dışı kayıt ve patlayan localStorage sessizce yok sayılır', () => {
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: '{bozuk' })), null);
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: JSON.stringify(good({ title: '<script>' })) })), null);
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: JSON.stringify(good({ effect: 'x' })) })), null);
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: 'null' })), null);
    const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
    assert.equal(B.readCache('r', broken), null);
    assert.equal(B.writeCache(good(), 'r', broken), false);
    assert.doesNotThrow(() => B.clearCache('r', broken));
    assert.equal(B.readCache('r', null), null, 'localStorage yoksa (vm) null');
});

test('rootName: AppEnv varsa o; yoksa localhost/127.0.0.1/demo → inventory_demo, diğerleri lifeserver_master', () => {
    const root = host => load({ location: { hostname: host } }).rootName();
    assert.equal(root('localhost'), 'inventory_demo');
    assert.equal(root('127.0.0.1'), 'inventory_demo');
    assert.equal(root('envanter-demo.web.app'), 'inventory_demo');
    assert.equal(root('envanter.medipol.edu.tr'), 'lifeserver_master');
    assert.equal(load({ AppEnv: { COLLECTION_ROOT: 'kok_x' }, location: { hostname: 'localhost' } }).rootName(), 'kok_x');
    assert.equal(B.rootName(), 'lifeserver_master', 'konum bilgisi yoksa canlı kök');
});

test('DOM yokken apply / openStudio sessizce çıkar (erken script güvenliği)', () => {
    assert.doesNotThrow(() => B.apply(good()));
    assert.doesNotThrow(() => B.apply(null));
    assert.doesNotThrow(() => B.openStudio());
    assert.equal(B.current(), null);
});

// ─── UX-5 revizyon · özel logo (customLogo) ─────────────────────────────────────────────────────────────────

test('customLogo: geçerli PNG / WebP / JPEG data URI kabul; yok / boş / null → "" (eski 6 alanlı belge geriye uyumlu)', () => {
    for (const uri of [PNG_URI, WEBP_URI, JPEG_URI]) {
        const r = B.validate(good({ customLogo: uri }));
        assert.equal(r.ok, true, uri.slice(0, 24));
        assert.equal(r.value.customLogo, uri);
        assert.equal(B.isLogoData(uri), true);
    }
    const legacy = good(); delete legacy.customLogo; // sunucuda eskiden yazılmış belge
    assert.equal(B.validate(legacy).ok, true);
    assert.equal(B.validate(legacy).value.customLogo, '');
    assert.equal(B.validate(good({ customLogo: '' })).value.customLogo, '');
    assert.equal(B.validate(good({ customLogo: null })).value.customLogo, '');
    assert.equal(B.isLogoData(''), false, 'boş değer "özel logo yok"tur, logo verisi sayılmaz');
});

test('customLogo: svg+xml, http(s), javascript:, gif, boş yük, etiket/tırnak/boşluk ve dize olmayan değerler reddedilir', () => {
    const bad = v => B.validate(good({ customLogo: v }));
    for (const v of [
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'data:image/svg+xml;utf8,<svg onload=alert(1)>',
        'https://ornek.com/logo.png',
        'http://ornek.com/logo.png',
        'javascript:alert(1)',
        'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/png;base64,',
        'data:image/png;charset=utf-8;base64,AAAA',
        `${PNG_URI}"onerror="x`,
        `${PNG_URI}<`,
        `${PNG_URI} `,
        ` ${PNG_URI}`,
        `${PNG_URI}\n`,
        `${PNG_URI}\nAAAA`,
        'DATA:image/png;base64,AAAA',
        'iVBORw0KGgo=',
    ]) {
        const r = bad(v);
        assert.equal(r.ok, false, v);
        assert.ok(r.errors.customLogo, v);
        assert.equal(B.isLogoData(v), false, v);
    }
    for (const v of [123, true, {}, [], ['data:image/png;base64,AAAA']]) assert.equal(bad(v).ok, false, JSON.stringify(v));
});

test('customLogo: 45000 karakter geçer, 45001 reddedilir (rules › size() <= 45000 ile aynı)', () => {
    assert.equal(uriOfLength(45000).length, 45000);
    assert.equal(B.validate(good({ customLogo: uriOfLength(45000) })).ok, true);
    assert.equal(B.validate(good({ customLogo: uriOfLength(45001) })).ok, false);
    assert.equal(B.validate(good({ customLogo: uriOfLength(200000) })).ok, false);
});

test('customLogo: önbelleğe yazılır / okunur; şema dışı özel logo içeren önbellek yok sayılır', () => {
    const store = fakeStorage();
    assert.equal(B.writeCache(good({ customLogo: PNG_URI }), 'r', store), true);
    assert.equal(B.readCache('r', store).customLogo, PNG_URI);
    assert.equal(B.writeCache(good({ customLogo: 'data:image/svg+xml;base64,AAAA' }), 'r', store), false);
    assert.equal(B.readCache('r', store).customLogo, PNG_URI, 'geçersiz yazma eskisini bozmaz');
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: JSON.stringify(good({ customLogo: 'https://x/y.png' })) })), null);
    // 6 alanlı eski önbellek (customLogo yok) hâlâ okunur
    const legacy = good(); delete legacy.customLogo;
    assert.equal(B.readCache('r', fakeStorage({ brand_settings_r: JSON.stringify(legacy) })).customLogo, '');
});

test('checkLogoFile: SVG her yoldan reddedilir; yalnız png/jpeg/webp ve ≤5 MB kabul', () => {
    const f = (name, type, size = 1024) => B.checkLogoFile({ name, type, size });
    for (const ok of [f('logo.png', 'image/png'), f('foto.JPG', 'image/jpeg'), f('a.jpeg', 'image/jpeg'), f('x.webp', 'image/webp'), f('adsiz', 'image/png')]) assert.equal(ok.ok, true, JSON.stringify(ok));
    for (const [name, type] of [['logo.svg', 'image/svg+xml'], ['logo.svg', 'image/png'], ['logo.png', 'image/svg+xml'], ['logo.svgz', ''], ['logo.SVG', 'image/svg+xml']]) {
        const r = f(name, type);
        assert.equal(r.ok, false, `${name} ${type}`);
        assert.match(r.error, /SVG/);
    }
    for (const [name, type] of [['a.gif', 'image/gif'], ['a.bmp', 'image/bmp'], ['a.pdf', 'application/pdf'], ['a.png', ''], ['a.txt', 'text/plain'], ['a.exe.png', 'application/octet-stream']]) {
        assert.equal(f(name, type).ok, false, `${name} ${type}`);
    }
    assert.equal(f('a.png', 'image/png', 0).ok, false, 'boş dosya');
    assert.equal(f('a.png', 'image/png', B.LOGO.maxFileBytes).ok, true);
    assert.equal(f('a.png', 'image/png', B.LOGO.maxFileBytes + 1).ok, false, '5 MB üstü');
    assert.equal(B.checkLogoFile(null).ok, false);
    assert.equal(B.checkLogoFile(undefined).ok, false);
});

test('sniffImageType: dosya imzası PNG/JPEG/WebP dışındakileri (SVG, HTML, GIF, kısa/boş) reddeder', () => {
    const bytes = (...n) => Uint8Array.from(n);
    const text = s => Uint8Array.from(Buffer.from(s, 'latin1'));
    assert.equal(B.sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)), 'png');
    assert.equal(B.sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)), 'jpeg');
    assert.equal(B.sniffImageType(Uint8Array.from([...text('RIFF'), 1, 2, 3, 4, ...text('WEBPVP8 ')])), 'webp');
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<?xml version="1.0"?><svg/>', '<!DOCTYPE html><html>', 'GIF89a......', 'BM......', 'RIFF....WAVEfmt ', '']) {
        assert.equal(B.sniffImageType(text(s)), null, s);
    }
    assert.equal(B.sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47)), null, 'eksik PNG imzası');
    assert.equal(B.sniffImageType(bytes(0xff, 0xd8)), null, 'eksik JPEG imzası');
    assert.equal(B.sniffImageType(null), null);
    assert.equal(B.sniffImageType(undefined), null);
});

test('fitSize: en uzun kenar ≤ sınır, oran korunur, küçük görsel büyütülmez, geçersiz boyut 0', () => {
    assert.deepEqual(plain(B.fitSize(1000, 500, 96)), { width: 96, height: 48 });
    assert.deepEqual(plain(B.fitSize(100, 400, 96)), { width: 24, height: 96 });
    assert.deepEqual(plain(B.fitSize(96, 96, 96)), { width: 96, height: 96 });
    assert.deepEqual(plain(B.fitSize(50, 30, 96)), { width: 50, height: 30 });
    assert.deepEqual(plain(B.fitSize(4000, 1, 96)), { width: 96, height: 1 }, 'en az 1 piksel');
    assert.deepEqual(plain(B.fitSize(300, 300)), { width: 96, height: 96 }, 'sınır verilmezse LOGO.maxPx');
    for (const [w, h] of [[0, 10], [10, 0], [-5, 5], [NaN, 5], [undefined, undefined]]) assert.deepEqual(plain(B.fitSize(w, h, 96)), { width: 0, height: 0 }, `${w}x${h}`);
});

test('buildEmblem: geçerli özel logo <img> (yalnız data URI) olarak çizilir; geçersiz/boş değerde yerleşik SVG amblem', () => {
    const D = loadWithDom();
    const custom = D.buildEmblem('shield', 40, PNG_URI);
    assert.ok(custom.classList.contains('brand-emblem') && custom.classList.contains('has-custom-logo'));
    assert.equal(custom.children.length, 1);
    const img = custom.children[0];
    assert.equal(img.tag, 'img');
    assert.equal(img.src, PNG_URI);
    assert.equal(img.alt, '');
    assert.equal(img.attrs['aria-hidden'], 'true');
    assert.equal(img.width, 40);
    assert.equal(custom.style.width, '40px');
    for (const nope of [undefined, '', 'https://x/y.png', 'data:image/svg+xml;base64,AAAA', `${PNG_URI}"`, 42]) {
        const e = D.buildEmblem('shield', 38, nope);
        assert.ok(!e.classList.contains('has-custom-logo'), String(nope));
        assert.equal(e.children[0].tag, 'svg', `${nope}: yerleşik amblem`);
        assert.ok(!e.children.some(c => c.tag === 'img'));
    }
    assert.equal(D.buildEmblem('bilinmeyen', 40, '').children[0].tag, 'svg', 'bilinmeyen kimlik → küp');
});

test('kaynak: özel logo yalnız isLogoData doğrulamasından sonra <img src> olur; SVG/innerHTML/URL yükleme yolu yok', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(code, /if \(isLogoData\(customLogo\)\) \{[\s\S]*?img\.src = customLogo/, 'img.src doğrulamadan sonra atanır');
    assert.equal((code.match(/\.src\s*=/g) || []).length, 2, 'yalnız özel logo <img> ve yerel blob çözümleyici .src atar');
    assert.match(code, /type === 'image\/svg\+xml'/, 'SVG MIME reddi');
    assert.ok(!/\bfetch\(|XMLHttpRequest|new WebSocket/.test(code), 'logo için ağ isteği yok');
    assert.ok(!/DOMParser/.test(code), 'SVG ayrıştırılmaz');
});
