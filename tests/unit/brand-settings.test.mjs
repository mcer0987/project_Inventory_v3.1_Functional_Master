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
const good = (o = {}) => ({ emblemId: 'cube', title: 'ENVANTER', subtitle: 'TAKİP SİSTEMİ', effect: 'none', ...o });

// Basit localStorage taklidi
function fakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return { map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
}

test('sabitler: 4 amblem, 4 efekt, varsayılanlar, sınırlar; modül dondurulmuş, DOM yokken yüklenir', () => {
    assert.deepEqual(plain(B.EMBLEMS.map(e => e.id)), ['cube', 'shield', 'crest', 'pulse-node']);
    assert.deepEqual(plain(B.EFFECTS.map(e => e.id)), ['shimmer', 'glow', 'pulse', 'none']);
    assert.deepEqual(plain(B.DEFAULTS), { emblemId: 'cube', title: 'ENVANTER', subtitle: 'TAKİP SİSTEMİ', effect: 'none' });
    assert.deepEqual(plain(B.LIMITS), { title: 32, subtitle: 40 });
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

test('validate: geçerli ayar kırpılır ve yalnız 4 alanla döner', () => {
    const r = B.validate(good({ title: '  MEDİPOL  ', subtitle: '  Envanter  ', extra: 'yok sayılır', logoUrl: 'https://x' }));
    assert.equal(r.ok, true);
    assert.deepEqual(plain(r.value), { emblemId: 'cube', title: 'MEDİPOL', subtitle: 'Envanter', effect: 'none' });
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
    assert.match(block, /hasOnly\(\['emblemId', 'title', 'subtitle', 'effect', 'updatedAt', 'updatedBy'\]\)/);
    assert.match(block, /noTag\(d\.title\)/);
    assert.match(block, /noTag\(d\.subtitle\)/);
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
    assert.deepEqual(Object.keys(JSON.parse(store.map.get('brand_settings_lifeserver_master'))).sort(), ['effect', 'emblemId', 'subtitle', 'title']);
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
