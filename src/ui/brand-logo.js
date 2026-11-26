/**
 * ui/brand-logo.js — v3.8 UX-5 · Kurumsal Logo & Efekt Stüdyosu
 * Düz script (ES import yok) → window.AppModules.BrandLogo. index.html ve admin.html erken yükler; Firebase'e DOKUNMAZ
 * (Firestore okuma/yazma yalnız src/services/brand-settings-service.js'tedir).
 *
 * [WHY]: Üst çubuktaki / yan menüdeki logo ve marka metni koda gömülüydü; yönetici kurum kimliğini değiştiremiyordu.
 * [HOW]: Ayar 7 kapalı alandır (emblemId, title, subtitle, effect, customLogo + sunucunun yazdığı updatedAt/updatedBy).
 *        Amblemler bu dosyadaki sabit, beyaz listeli SVG kataloğundan createElementNS ile çizilir; kullanıcıdan ham HTML/SVG/URL
 *        alınmaz. Tek istisna 1 adet özel logodur: png/jpeg/webp dosyası istemcide Canvas ile ≤96×96'ya küçültülüp yeniden
 *        kodlanır (metadata ve gömülü içerik atılır) ve ≤45000 karakterlik data URI olarak saklanır; '' = özel logo yok.
 *        SVG (image/svg+xml) MIME, uzantı ve dosya imzası düzeylerinin hepsinde reddedilir.
 *        Önbellek (localStorage brand_settings_<root>) sayfa açılışında senkron uygulanır → titreme yok; sunucu senkronu
 *        servis tarafından gelir. Doğrulama sınırları firestore.rules › brandSettingsOk ile aynıdır.
 * Güvenlik: tüm metinler textContent ile yazılır (innerHTML yok); etiket benzeri "<x" metinleri reddedilir (noTag);
 *        özel logo yalnız <img src="data:image/(png|jpeg|webp);base64,…"> olarak, desen doğrulamasından sonra çizilir.
 */
(function () {
    'use strict';
    window.AppModules = window.AppModules || {};

    const hasDom = typeof document !== 'undefined';

    // ─── Katalog ──────────────────────────────────────────────────────────────────────────────────────────────
    const SVG_ALLOWED_TAGS = Object.freeze(['rect', 'path', 'circle', 'polyline']);
    const SVG_ALLOWED_ATTRS = Object.freeze(['d', 'x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'points', 'fill', 'stroke',
        'stroke-width', 'stroke-linecap', 'stroke-linejoin']);
    const W = { stroke: '#ffffff', fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

    const EMBLEMS = Object.freeze([
        { id: 'cube', label: 'Medipol Küp', color: '#3498db', shapes: [
            { tag: 'path', attrs: { ...W, d: 'M17 7H7V17H17V7Z' } },
            { tag: 'path', attrs: { ...W, d: 'M7 12H17' } },
            { tag: 'path', attrs: { ...W, d: 'M12 7V17' } },
        ] },
        { id: 'shield', label: 'Kalkan', color: '#2563eb', shapes: [
            { tag: 'path', attrs: { ...W, d: 'M12 4.5L18 7V12C18 15.3 15.5 17.8 12 19.5C8.5 17.8 6 15.3 6 12V7L12 4.5Z' } },
            { tag: 'path', attrs: { ...W, d: 'M9.3 12L11.2 13.9L14.8 10.1' } },
        ] },
        { id: 'crest', label: 'Tıp Amblemi', color: '#7c3aed', shapes: [
            { tag: 'circle', attrs: { ...W, cx: '12', cy: '12', r: '7' } },
            { tag: 'path', attrs: { ...W, d: 'M12 8.5V15.5' } },
            { tag: 'path', attrs: { ...W, d: 'M8.5 12H15.5' } },
        ] },
        { id: 'pulse-node', label: 'Nabız Düğümü', color: '#0891b2', shapes: [
            { tag: 'polyline', attrs: { ...W, points: '4.5,12 8.5,12 10.5,7.5 13.5,16.5 15.5,12 17.5,12' } },
            { tag: 'circle', attrs: { stroke: 'none', fill: '#ffffff', cx: '19.5', cy: '12', r: '1.6' } },
        ] },
    ]);

    const EFFECTS = Object.freeze([
        { id: 'shimmer', label: 'Platin Parıltı', hint: 'Logo üzerinde belirli aralıklarla akan çapraz ışık yansıması' },
        { id: 'glow', label: 'Cam Işıması', hint: 'Hafif ortam halosu; üzerine gelince parlar' },
        { id: 'pulse', label: 'Nefes Alan Halka', hint: 'Logonun çevresinde yavaşça büyüyen canlı halka' },
        { id: 'none', label: 'Sade Kurumsal', hint: 'Hareketsiz, yalın görünüm' },
    ]);

    const DEFAULTS = Object.freeze({ emblemId: 'cube', title: 'ENVANTER', subtitle: 'TAKİP SİSTEMİ', effect: 'none', customLogo: '' });
    const LIMITS = Object.freeze({ title: 32, subtitle: 40 });
    const TAG_LIKE = /<[a-zA-Z/!?]/; // firestore.rules › noTag ile aynı kural

    // Özel logo: firestore.rules › brandSettingsOk ile aynı sınır ve desen. maxPx/maxFileBytes yalnız istemci ön kontrolüdür.
    const LOGO = Object.freeze({ maxChars: 45000, maxPx: 96, maxFileBytes: 5 * 1024 * 1024, maxSourcePixels: 25000000 });
    const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
    const LOGO_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
    const LOGO_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp']);

    const emblemIds = EMBLEMS.map(e => e.id);
    const effectIds = EFFECTS.map(e => e.id);

    /** Sunucuda saklanabilecek özel logo mu? ('' özel logo yok anlamında geçerlidir; bu işlev yalnız dolu değeri sınar.) */
    const isLogoData = v => typeof v === 'string' && v.length > 0 && v.length <= LOGO.maxChars && LOGO_PATTERN.test(v);

    // ─── Doğrulama (firestore.rules › brandSettingsOk ile aynı sınırlar) ─────────────────────────────────────
    /** @returns {{ok:boolean, value:object|null, errors:object}} value: {emblemId,title,subtitle,effect,customLogo} (kırpılmış) */
    function validate(input) {
        const raw = input && typeof input === 'object' ? input : {};
        const errors = {};
        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle.trim() : '';
        // customLogo yok (eski 6 alanlı belge / önbellek) → '' sayılır; dolu ise desen + uzunluk zorunlu.
        const customLogo = raw.customLogo === undefined || raw.customLogo === null ? '' : raw.customLogo;
        if (!emblemIds.includes(raw.emblemId)) errors.emblemId = 'Listeden bir amblem seçin.';
        if (!effectIds.includes(raw.effect)) errors.effect = 'Listeden bir efekt seçin.';
        if (customLogo !== '' && !isLogoData(customLogo)) errors.customLogo = 'Özel logo geçersiz: yalnız PNG, JPEG veya WebP kabul edilir.';
        if (!title) errors.title = 'Başlık boş bırakılamaz.';
        else if (title.length > LIMITS.title) errors.title = `Başlık en fazla ${LIMITS.title} karakter olabilir.`;
        else if (TAG_LIKE.test(title)) errors.title = 'Başlıkta etiket benzeri "<" ifadesi kullanılamaz.';
        if (subtitle.length > LIMITS.subtitle) errors.subtitle = `Alt başlık en fazla ${LIMITS.subtitle} karakter olabilir.`;
        else if (TAG_LIKE.test(subtitle)) errors.subtitle = 'Alt başlıkta etiket benzeri "<" ifadesi kullanılamaz.';
        const ok = Object.keys(errors).length === 0;
        return { ok, errors, value: ok ? { emblemId: raw.emblemId, title, subtitle, effect: raw.effect, customLogo } : null };
    }

    // ─── Özel logo hazırlığı (dosya ön kontrolü + imza + ölçek + yeniden kodlama) ─────────────────────────────
    /** Dosya türünü ilk baytlardan okur: 'png' | 'jpeg' | 'webp' | null (SVG/metin/GIF vb. → null). */
    function sniffImageType(bytes) {
        if (!bytes || typeof bytes.length !== 'number') return null;
        const at = (i, ...sig) => sig.every((b, k) => bytes[i + k] === b);
        if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
        if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
        if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'; // RIFF....WEBP
        return null;
    }

    /** Seçilen dosyanın (ad/tür/boyut) ön kontrolü. @returns {{ok:boolean, error?:string}} */
    function checkLogoFile(file) {
        const name = String((file && file.name) || '').toLowerCase();
        const type = String((file && file.type) || '').toLowerCase();
        const ext = name.includes('.') ? name.split('.').pop() : '';
        if (!file) return { ok: false, error: 'Bir görsel dosyası seçin.' };
        if (type === 'image/svg+xml' || ext === 'svg' || ext === 'svgz') return { ok: false, error: 'SVG logo güvenlik nedeniyle kabul edilmez; PNG, JPEG veya WebP seçin.' };
        if (!LOGO_MIMES.includes(type) || (ext && !LOGO_EXTENSIONS.includes(ext))) return { ok: false, error: 'Yalnız PNG, JPEG veya WebP görsel yüklenebilir.' };
        if (!(file.size > 0)) return { ok: false, error: 'Seçilen dosya boş.' };
        if (file.size > LOGO.maxFileBytes) return { ok: false, error: `Dosya çok büyük (en fazla ${Math.round(LOGO.maxFileBytes / 1048576)} MB).` };
        return { ok: true };
    }

    /** Görseli en uzun kenarı max px olacak şekilde, oranı bozmadan sığdırır; küçük görseli büyütmez. */
    function fitSize(width, height, max) {
        const w = Number(width), h = Number(height), m = Number(max) || LOGO.maxPx;
        if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
        const scale = Math.min(1, m / Math.max(w, h));
        return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
    }

    /**
     * Dosyayı çözer, Canvas ile küçültüp yeniden kodlar ve sunucuya yazılabilir data URI döndürür (≤LOGO.maxChars).
     * Yeniden kodlama, dosyadaki metadata ve olası gömülü içeriği atar. Hata → Error(Türkçe ileti).
     */
    async function prepareLogo(file) {
        const pre = checkLogoFile(file);
        if (!pre.ok) throw new Error(pre.error);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const kind = sniffImageType(bytes);
        if (!kind) throw new Error('Dosya içeriği PNG, JPEG veya WebP değil; görsel okunamadı.');
        const url = URL.createObjectURL(new Blob([bytes], { type: `image/${kind}` }));
        let img;
        try {
            img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('Görsel çözülemedi; dosya bozuk olabilir.'));
                el.src = url;
            });
        } finally { URL.revokeObjectURL(url); }
        if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error('Görsel boyutu okunamadı.');
        if (img.naturalWidth * img.naturalHeight > LOGO.maxSourcePixels) throw new Error('Görselin çözünürlüğü çok yüksek; daha küçük bir dosya seçin.');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Bu tarayıcı görsel işlemeyi desteklemiyor.');
        // Önce 96 px; sığmazsa kademeli küçült. Her adımda WebP (sıkı) → destek yoksa tarayıcı PNG üretir.
        for (const px of [LOGO.maxPx, 80, 64, 48]) {
            const size = fitSize(img.naturalWidth, img.naturalHeight, px);
            canvas.width = size.width;
            canvas.height = size.height;
            ctx.clearRect(0, 0, size.width, size.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, size.width, size.height);
            for (const quality of [0.92, 0.8, 0.6]) {
                const out = canvas.toDataURL('image/webp', quality);
                if (isLogoData(out)) return out;
                if (!out.startsWith('data:image/webp')) break; // WebP kodlanamıyor → PNG denenir
            }
            const png = canvas.toDataURL('image/png');
            if (isLogoData(png)) return png;
        }
        throw new Error('Görsel çok ayrıntılı ve küçültülse de sınırı aşıyor; daha sade bir logo seçin.');
    }

    // ─── Önbellek ─────────────────────────────────────────────────────────────────────────────────────────────
    // Kök adı firebase-handler.js'teki COLLECTION_ROOT ile aynı mantık; ES modülü yüklenmeden önce de çalışabilsin diye burada.
    function rootName() {
        if (window.AppEnv && window.AppEnv.COLLECTION_ROOT) return window.AppEnv.COLLECTION_ROOT;
        const host = (window.location && window.location.hostname) || '';
        return (host === 'localhost' || host === '127.0.0.1' || host.includes('demo')) ? 'inventory_demo' : 'lifeserver_master';
    }
    const cacheKey = root => `brand_settings_${root || rootName()}`;
    const storageOf = s => s || (typeof localStorage !== 'undefined' ? localStorage : null);

    /** Geçerli önbellek değerini döndürür; yok / bozuk / şema dışıysa null. */
    function readCache(root, storage) {
        try {
            const store = storageOf(storage);
            const text = store && store.getItem(cacheKey(root));
            if (!text) return null;
            const parsed = validate(JSON.parse(text));
            return parsed.ok ? parsed.value : null;
        } catch (e) { return null; }
    }
    function writeCache(value, root, storage) {
        try {
            const store = storageOf(storage);
            const parsed = validate(value);
            if (!store || !parsed.ok) return false;
            store.setItem(cacheKey(root), JSON.stringify(parsed.value));
            return true;
        } catch (e) { return false; }
    }
    function clearCache(root, storage) {
        try { const store = storageOf(storage); if (store) store.removeItem(cacheKey(root)); } catch (e) { /* özel mod */ }
    }

    // ─── DOM yardımcıları (createElement + textContent) ───────────────────────────────────────────────────────
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
    }

    /**
     * Amblemi çizer: <span class="brand-emblem"><svg>…</svg></span>. Bilinmeyen kimlik → küp.
     * customLogo geçerli bir data URI ise (isLogoData) SVG yerine <span class="brand-emblem has-custom-logo"><img></span> çizilir.
     */
    function buildEmblem(emblemId, size, customLogo) {
        const def = EMBLEMS.find(e => e.id === emblemId) || EMBLEMS[0];
        const px = String(size || 40);
        const wrap = node('span', 'brand-emblem');
        wrap.style.width = `${px}px`;
        wrap.style.height = `${px}px`;
        if (isLogoData(customLogo)) {
            wrap.classList.add('has-custom-logo');
            const img = document.createElement('img');
            img.alt = '';
            img.width = Number(px);
            img.height = Number(px);
            img.decoding = 'async';
            img.draggable = false;
            img.setAttribute('aria-hidden', 'true');
            img.src = customLogo; // yalnız isLogoData desenini geçen png/jpeg/webp data URI
            wrap.append(img);
            return wrap;
        }
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', px);
        svg.setAttribute('height', px);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('width', '24');
        bg.setAttribute('height', '24');
        bg.setAttribute('rx', '6');
        bg.setAttribute('fill', def.color);
        svg.append(bg);
        def.shapes.forEach(shape => {
            if (!SVG_ALLOWED_TAGS.includes(shape.tag)) return;
            const el = document.createElementNS(SVG_NS, shape.tag);
            Object.entries(shape.attrs).forEach(([name, value]) => { if (SVG_ALLOWED_ATTRS.includes(name)) el.setAttribute(name, value); });
            svg.append(el);
        });
        wrap.append(svg);
        return wrap;
    }

    const FX_CLASSES = effectIds.map(id => `brand-fx-${id}`);
    const setEffect = (target, effect) => {
        if (!target) return;
        target.classList.remove(...FX_CLASSES);
        target.classList.add(`brand-fx-${effectIds.includes(effect) ? effect : 'none'}`);
    };

    // ─── Uygulama (index .logo-wrapper · admin .sidebar-header) ──────────────────────────────────────────────
    let applied = null; // son uygulanan değer (null = varsayılan)
    let appliedKey = '';

    function applyToLogoWrapper(wrapper, value) {
        const v = value || DEFAULTS;
        const old = wrapper.querySelector('.brand-emblem, svg');
        const emblem = buildEmblem(v.emblemId, 40, v.customLogo);
        if (old) old.replaceWith(emblem); else wrapper.prepend(emblem);
        const wordmark = wrapper.querySelector('.brand-wordmark');
        if (wordmark) {
            const secondary = wordmark.querySelector('.brand-wordmark-secondary');
            const lead = [...wordmark.childNodes].find(n => n.nodeType === 3);
            if (lead) lead.nodeValue = v.title; else wordmark.prepend(document.createTextNode(v.title));
            if (secondary) secondary.textContent = v.subtitle;
        }
        setEffect(wrapper, v.effect);
        wrapper.dataset.brandEffect = v.effect;
    }

    function applyToSidebarHeader(header, value) {
        header.replaceChildren();
        if (!value) { // Kayıtlı ayar yok: özgün görünüm (kalkan + "Admin Panel")
            const icon = node('i', 'fas fa-shield-halved');
            icon.setAttribute('aria-hidden', 'true');
            header.append(icon, node('span', null, 'Admin Panel'));
            header.classList.remove('is-branded', ...FX_CLASSES);
            return;
        }
        header.classList.add('is-branded');
        const text = node('div', 'brand-sidebar-text');
        text.append(node('small', 'brand-sidebar-eyebrow', 'Admin Panel'), node('strong', 'brand-sidebar-title', value.title));
        if (value.subtitle) text.append(node('small', 'brand-sidebar-sub', value.subtitle));
        header.append(buildEmblem(value.emblemId, 38, value.customLogo), text);
        setEffect(header, value.effect);
    }

    /** value: geçerli ayar ya da null (varsayılan görünüm). Aynı değer tekrar uygulanmaz (titreme yok). */
    function apply(value) {
        if (!hasDom) return;
        const v = value ? validate(value) : null;
        const next = v && v.ok ? v.value : null;
        const key = JSON.stringify(next);
        const wrapper = document.querySelector('.logo-wrapper');
        const header = document.querySelector('.sidebar-header');
        // Hedefler henüz DOM'da değilse (erken script) DOMContentLoaded'da yeniden denenir.
        if (!wrapper && !header) return;
        if (key === appliedKey && ((wrapper && wrapper.querySelector('.brand-emblem')) || !wrapper)
            && ((header && (header.classList.contains('is-branded') === !!next)) || !header)) return;
        if (wrapper) applyToLogoWrapper(wrapper, next);
        if (header) applyToSidebarHeader(header, next);
        applied = next;
        appliedKey = key;
        window.dispatchEvent(new CustomEvent('onBrandApplied', { detail: { settings: next } }));
    }

    // ─── Stüdyo paneli (admin) ────────────────────────────────────────────────────────────────────────────────
    let studio = null, studioOpener = null;

    function buildStudio() {
        const state = { ...(applied || DEFAULTS) };
        const status = node('p', 'brand-studio-status');
        status.setAttribute('aria-live', 'polite');

        // Canlı önizleme: üst çubuk ve yan menü şeritleri
        const previewTop = node('div', 'brand-preview-bar');
        const previewSide = node('div', 'brand-preview-side');
        const preview = node('div', 'brand-studio-preview');
        preview.append(
            node('small', 'brand-preview-label', 'Önizleme · ana ekran üst çubuğu'), previewTop,
            node('small', 'brand-preview-label', 'Önizleme · yönetici yan menüsü'), previewSide);
        const paintPreview = () => {
            const check = validate(state);
            const v = check.ok ? check.value : { ...DEFAULTS, ...state, title: state.title.trim() || DEFAULTS.title };
            previewTop.replaceChildren(buildEmblem(v.emblemId, 36, v.customLogo));
            const word = node('div', 'brand-wordmark', v.title);
            word.append(node('span', 'brand-wordmark-secondary', v.subtitle));
            previewTop.append(word);
            setEffect(previewTop, v.effect);
            const side = node('div', 'brand-sidebar-text');
            side.append(node('small', 'brand-sidebar-eyebrow', 'Admin Panel'), node('strong', 'brand-sidebar-title', v.title));
            if (v.subtitle) side.append(node('small', 'brand-sidebar-sub', v.subtitle));
            previewSide.replaceChildren(buildEmblem(v.emblemId, 38, v.customLogo), side);
            setEffect(previewSide, v.effect);
        };

        const choice = (name, def, extra) => {
            const input = node('input');
            input.type = 'radio'; input.name = name; input.value = def.id;
            input.checked = state[name === 'brand-emblem' ? 'emblemId' : 'effect'] === def.id;
            input.addEventListener('change', () => {
                state[name === 'brand-emblem' ? 'emblemId' : 'effect'] = def.id;
                paintPreview();
            });
            const label = node('label', 'brand-choice');
            label.append(input, extra, node('span', 'brand-choice-text', def.label));
            if (def.hint) { label.title = def.hint; label.append(node('small', null, def.hint)); }
            return label;
        };
        const emblemGroup = node('fieldset', 'brand-fieldset');
        emblemGroup.append(node('legend', null, 'Amblem'),
            node('div', 'brand-choices', null));
        EMBLEMS.forEach(def => emblemGroup.lastChild.append(choice('brand-emblem', def, buildEmblem(def.id, 34))));
        const effectGroup = node('fieldset', 'brand-fieldset');
        effectGroup.append(node('legend', null, 'Efekt'), node('div', 'brand-choices'));
        EFFECTS.forEach(def => {
            const swatch = node('span', 'brand-effect-swatch');
            swatch.append(buildEmblem('cube', 34)); // efekt sınıfı .brand-emblem'i etkiler
            setEffect(swatch, def.id);
            effectGroup.lastChild.append(choice('brand-effect', def, swatch));
        });

        const textField = (key, label, max) => {
            const input = node('input', 'brand-input');
            input.type = 'text'; input.maxLength = max; input.value = state[key]; input.autocomplete = 'off';
            const counter = node('small', 'brand-counter', `${input.value.length}/${max}`);
            input.addEventListener('input', () => {
                state[key] = input.value;
                counter.textContent = `${input.value.length}/${max}`;
                paintPreview();
            });
            const wrap = node('label', 'brand-field');
            wrap.append(node('span', null, label), input, counter);
            return wrap;
        };
        const fields = node('div', 'brand-fields');
        fields.append(textField('title', 'Ana başlık', LIMITS.title), textField('subtitle', 'Alt başlık', LIMITS.subtitle));

        const service = () => window.AppModules && window.AppModules.BrandSettings;
        const say = (text, bad) => { status.textContent = text; status.classList.toggle('is-error', !!bad); };
        let focusBeforeBusy = null; // düğmeler devre dışı kalınca odak kaybolmasın (klavye kullanıcısı)
        const busy = flag => {
            if (!studio) return;
            if (flag) focusBeforeBusy = document.activeElement;
            studio.querySelectorAll('button, input[type="file"]').forEach(b => { b.disabled = flag; });
            if (flag) return;
            paintLogo(); // "Özel Logoyu Kaldır" yalnız logo varken etkin kalır
            if (focusBeforeBusy && focusBeforeBusy.isConnected && !focusBeforeBusy.disabled) focusBeforeBusy.focus();
        };

        // Özel logo: 1 adet; dosya seçilince istemcide küçültülür, Kaydet'e kadar yalnız önizlemede durur.
        const logoGroup = node('fieldset', 'brand-fieldset brand-logo-upload');
        const logoThumb = node('span', 'brand-logo-thumb');
        const logoMeta = node('small', 'brand-logo-meta');
        const logoFile = node('input', 'brand-file-input');
        logoFile.type = 'file';
        logoFile.accept = 'image/png,image/jpeg,image/webp';
        logoFile.id = 'brandLogoFile';
        logoFile.setAttribute('aria-describedby', 'brandLogoHint');
        const logoRemove = node('button', 'brand-btn ghost', 'Özel Logoyu Kaldır');
        logoRemove.type = 'button';
        const paintLogo = () => {
            const has = isLogoData(state.customLogo);
            logoThumb.replaceChildren(has ? buildEmblem(state.emblemId, 44, state.customLogo) : node('span', 'brand-logo-empty', 'Yok'));
            logoMeta.textContent = has
                ? `Özel logo yüklü · yaklaşık ${Math.max(1, Math.round(state.customLogo.length / 1024))} KB. Kaydedince tüm kullanıcılarda görünür.`
                : 'Özel logo yok; yukarıda seçili yerleşik amblem kullanılır.';
            logoRemove.disabled = !has;
        };
        logoFile.addEventListener('change', async () => {
            const file = logoFile.files && logoFile.files[0];
            if (!file) return;
            const pre = checkLogoFile(file);
            if (!pre.ok) { logoFile.value = ''; say(pre.error, true); return; }
            busy(true); say('Logo hazırlanıyor…');
            try {
                state.customLogo = await prepareLogo(file);
                paintLogo(); paintPreview();
                say('Logo hazır. Önizlemeyi kontrol edip Kaydet\'e basın.');
            } catch (e) { say((e && e.message) || 'Logo hazırlanamadı.', true); }
            finally { logoFile.value = ''; busy(false); }
        });
        logoRemove.addEventListener('click', () => {
            state.customLogo = '';
            paintLogo(); paintPreview();
            say('Özel logo kaldırıldı; Kaydet\'e basınca seçili yerleşik amblem tüm kullanıcılarda geçerli olur.');
        });
        const logoHint = node('p', 'brand-logo-hint', 'Kare ve sade bir logo en iyi sonucu verir. Görsel otomatik olarak en fazla 96×96 piksele küçültülür; SVG kabul edilmez.');
        logoHint.id = 'brandLogoHint';
        const logoRow = node('div', 'brand-logo-row');
        logoRow.append(logoThumb, node('div', 'brand-logo-controls'));
        logoRow.lastChild.append(logoFile, logoRemove, logoMeta);
        logoGroup.append(node('legend', null, 'Özel logo (isteğe bağlı)'), logoHint, logoRow);
        paintLogo();

        const save = node('button', 'brand-btn primary', 'Kaydet');
        save.type = 'button';
        save.addEventListener('click', async () => {
            const check = validate(state);
            if (!check.ok) { say(Object.values(check.errors)[0], true); return; }
            if (!service()) { say('Marka servisi yüklenmedi; sayfayı yenileyip tekrar deneyin.', true); return; }
            busy(true); say('Kaydediliyor…');
            try { await service().save(check.value); say('Kaydedildi. Değişiklik tüm kullanıcılarda görünür.'); }
            catch (e) { say((e && e.message) || 'Kaydedilemedi.', true); }
            finally { busy(false); }
        });
        const reset = node('button', 'brand-btn ghost', 'Sıfırla');
        reset.type = 'button';
        reset.addEventListener('click', async () => {
            if (!service()) { say('Marka servisi yüklenmedi; sayfayı yenileyip tekrar deneyin.', true); return; }
            busy(true); say('Varsayılana dönülüyor…');
            try {
                await service().reset();
                close(); openStudio(studioOpener); // form, varsayılan değerlerle yeniden kurulur
                if (studio) studio.querySelector('.brand-studio-status').textContent = 'Varsayılan görünüme dönüldü.';
            } catch (e) { say((e && e.message) || 'Sıfırlanamadı.', true); busy(false); }
        });
        const closeBtn = node('button', 'brand-close');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Marka ve logo ayarlarını kapat');
        closeBtn.title = 'Kapat (Esc)';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => close());

        const title = node('h3', null, '⚙️ Marka & Logo Ayarları');
        title.id = 'brandStudioTitle';
        const dialog = node('section', 'brand-studio');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'brandStudioTitle');
        dialog.setAttribute('aria-describedby', 'brandStudioLead');
        const lead = node('p', 'brand-studio-lead', 'Üst çubuktaki ve yan menüdeki kurumsal logoyu, marka metnini ve efekti seçersiniz; isterseniz kendi logonuzu yüklersiniz. Kaydedince değişiklik tüm kullanıcılarda görünür.');
        lead.id = 'brandStudioLead';
        const tip = node('p', 'brand-studio-tip', 'İpucu: Özel logoyu kaldırırsanız seçili yerleşik amblem döner; Sıfırla ise her şeyi varsayılan görünüme çevirir. Efektler, cihazınızda hareket azaltma açıksa otomatik durur.');
        dialog.append(node('header', 'brand-studio-head', null), lead, preview, emblemGroup, logoGroup, fields, effectGroup, status, tip,
            node('footer', 'brand-studio-foot', null));
        dialog.firstChild.append(title, closeBtn);
        dialog.lastChild.append(reset, save);
        paintPreview();

        const overlay = node('div', 'brand-studio-overlay');
        overlay.hidden = true;
        overlay.append(dialog);
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            if (e.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(n => n.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        return overlay;
    }

    function openStudio(opener) {
        if (!hasDom) return;
        if (studio) studio.remove(); // her açılışta güncel ayarla yeniden kurulur
        studioOpener = opener || document.activeElement;
        studio = buildStudio();
        document.body.append(studio);
        studio.hidden = false;
        const first = studio.querySelector('input:checked') || studio.querySelector('input');
        if (first) first.focus();
    }
    function close() {
        if (!studio) return;
        studio.remove();
        studio = null;
        if (studioOpener && typeof studioOpener.focus === 'function') studioOpener.focus();
    }

    const api = Object.freeze({
        EMBLEMS, EFFECTS, DEFAULTS, LIMITS, LOGO, SVG_ALLOWED_TAGS, SVG_ALLOWED_ATTRS,
        validate, isLogoData, sniffImageType, checkLogoFile, fitSize, prepareLogo, rootName, cacheKey, readCache, writeCache, clearCache,
        buildEmblem, apply, openStudio, closeStudio: close, current: () => applied,
    });
    window.AppModules.BrandLogo = api;

    // ─── Açılış: önbellekteki ayar senkron uygulanır (sıfır gecikme). Servis sunucudan gelenle günceller. ──────
    if (hasDom) {
        const boot = () => {
            apply(readCache());
            const opener = document.getElementById('brandStudioOpen'); // yalnız admin.html'de var
            if (opener && !opener.dataset.brandBound) {
                opener.dataset.brandBound = '1';
                opener.addEventListener('click', () => openStudio(opener));
            }
        };
        boot(); // script header'dan sonra yüklenirse DOM hazır; head'deyse aşağıdaki olay devreye girer
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    }
})();
