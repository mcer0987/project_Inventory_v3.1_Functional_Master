/**
 * ui/form-keyboard-nav.js — v3.6 · İP-3: formlarda klavyeyle alandan alana geçiş ve dokunmatik "Önceki · Sonraki · Kaydet" çubuğu.
 * Klasik script (window.AppModules.FormKeyboardNav); iki sayfada yüklenir. nextField / barOffset saf ve birim testlidir.
 *
 * [WHY]: Ürün Ekle/Düzenle modalında Enter formu hemen gönderiyordu (diğer alanlar dolmadan kayıt). Mobilde klavye ekranın
 *        yarısını kaplıyor, modal düzen görünümünün (layout viewport) ortasında durduğu için alt alanlar klavyenin arkasında
 *        kalıyordu; kullanıcı klavyeyi kapatıp kaydırıp yeniden açmak zorunda kalıyordu.
 * [HOW]: - Enter bir sonraki alana geçer, yalnız son alanda formu gönderir; metin alanlarına enterkeyhint ("next"/"done").
 *        - Dokunmatik cihazda (pointer: coarse) odak formdayken klavyenin hemen üstüne yapışan çubuk. Konum visualViewport ile
 *          hesaplanır; düğmeler odağı (ve klavyeyi) kapatmaz.
 *        - Klavye açıkken modal görünür alana sığar (--vv-h / --vv-top, .kb-open) ve odaklanan alan ortalanır.
 *        Genel viewport meta'sına interactive-widget eklenmez: uygulamanın sabit alt gezintisini klavyenin üstüne taşırdı.
 */
(function () {
    'use strict';

    const FIELD_SELECTOR = 'input, select, textarea';
    const NON_FIELD_TYPES = ['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'];
    const KEYBOARD_GAP = 120;   // görünür alan bu kadar küçüldüyse ekran klavyesi açık sayılır

    const isTextual = el => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !NON_FIELD_TYPES.includes(el.type)));

    // Saf: alan listesinde current'tan sonraki (dir 1) / önceki (dir -1) alan; yoksa null.
    function nextField(fields, current, dir = 1) {
        const list = Array.isArray(fields) ? fields : [];
        const i = list.indexOf(current);
        if (i === -1) return list.length ? list[dir > 0 ? 0 : list.length - 1] : null;
        return list[i + dir] || null;
    }

    // Saf: klavye açıkken çubuğun yukarı kaydırılacağı piksel = düzen görünümü yüksekliği − görünür alanın alt kenarı.
    function barOffset(layoutHeight, vv) {
        if (!vv || !Number.isFinite(vv.height)) return 0;
        return Math.max(0, Math.round(layoutHeight - (vv.height + (vv.offsetTop || 0))));
    }

    function isNavigable(el) {
        if (!el || el.disabled || el.readOnly) return false;
        if (el.tagName === 'INPUT' && NON_FIELD_TYPES.includes(el.type)) return false;
        return el.getClientRects().length > 0;   // görünmeyen (gizli grup) alan atlanır
    }
    function fieldsOf(form) {
        return [...form.querySelectorAll(FIELD_SELECTOR)].filter(isNavigable);
    }
    function applyHints(form) {
        const textual = fieldsOf(form).filter(isTextual);
        textual.forEach((el, i) => el.setAttribute('enterkeyhint', i === textual.length - 1 ? 'done' : 'next'));
    }
    const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function ensureVisible(el) {
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    function focusField(el) {
        el.focus({ preventScroll: true });
        ensureVisible(el);
    }
    function submit(form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else { const b = form.querySelector('[type="submit"]'); if (b) b.click(); }
    }

    // ─── Dokunmatik çubuk (tek, paylaşılan) ──────────────────────────────────────────────────────────────────────────
    let bar = null;
    let activeForm = null;
    let hideTimer = null;
    const coarse = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    function ensureBar() {
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'form-kb-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Form alanları arasında gezinme');
        bar.hidden = true;
        const make = (action, label, extra = '') => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `form-kb-btn ${extra}`.trim();
            b.dataset.kbAction = action;
            b.textContent = label;
            return b;
        };
        bar.append(make('prev', '‹ Önceki'), make('next', 'Sonraki ›'), make('submit', 'Kaydet', 'form-kb-submit'));
        // Düğmeye dokunmak odağı formdan almasın: klavye açık kalır.
        bar.addEventListener('pointerdown', e => { if (e.target.closest('[data-kb-action]')) e.preventDefault(); });
        bar.addEventListener('mousedown', e => { if (e.target.closest('[data-kb-action]')) e.preventDefault(); });
        bar.addEventListener('click', e => {
            const b = e.target.closest('[data-kb-action]');
            if (!b || !activeForm) return;
            const fields = fieldsOf(activeForm);
            const current = document.activeElement;
            if (b.dataset.kbAction === 'submit') { submit(activeForm); return; }
            const target = nextField(fields, current, b.dataset.kbAction === 'next' ? 1 : -1);
            if (target) focusField(target);
        });
        document.body.append(bar);
        return bar;
    }

    function modalOf(form) {
        return form.closest('.modal, [data-kb-modal]');
    }
    function updateLayout() {
        if (!activeForm) return;
        const vv = window.visualViewport;
        const root = document.documentElement;
        const height = vv ? vv.height : window.innerHeight;
        root.style.setProperty('--vv-h', `${Math.round(height)}px`);
        root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
        const keyboardOpen = !!vv && window.innerHeight - vv.height > KEYBOARD_GAP;
        const modal = modalOf(activeForm);
        if (modal) modal.classList.toggle('kb-open', keyboardOpen);
        if (bar && !bar.hidden) {
            bar.style.transform = `translateY(${-barOffset(window.innerHeight, vv)}px)`;
            const fields = fieldsOf(activeForm);
            const current = document.activeElement;
            bar.querySelector('[data-kb-action="prev"]').disabled = !nextField(fields, current, -1) || fields.indexOf(current) === -1;
            bar.querySelector('[data-kb-action="next"]').disabled = !nextField(fields, current, 1) || fields.indexOf(current) === -1;
        }
    }
    function onViewportChange() {
        updateLayout();
        if (activeForm && activeForm.contains(document.activeElement)) ensureVisible(document.activeElement);
    }
    let viewportBound = false;
    function bindViewport() {
        if (viewportBound || !window.visualViewport) return;
        viewportBound = true;
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', updateLayout);
    }

    function showFor(form) {
        clearTimeout(hideTimer);
        activeForm = form;
        if (coarse()) {
            ensureBar().hidden = false;
            document.documentElement.classList.add('form-kb-active');
        }
        bindViewport();
        updateLayout();
    }
    function hideSoon(form) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (form.contains(document.activeElement) || (bar && bar.contains(document.activeElement))) return;
            if (bar) bar.hidden = true;
            document.documentElement.classList.remove('form-kb-active');
            const modal = modalOf(form);
            if (modal) modal.classList.remove('kb-open');
            if (activeForm === form) activeForm = null;
        }, 150);
    }

    /** Forma klavye gezinmesini bağlar (tekrar çağrı zararsız). */
    function attach(form) {
        if (!form || form.dataset.kbNav === '1') return form;
        form.dataset.kbNav = '1';
        form.addEventListener('focusin', e => {
            if (!e.target.matches(FIELD_SELECTOR)) return;
            applyHints(form);   // alan kümesi değişebilir (ör. demirbaş plakası kilitli/yazılabilir)
            showFor(form);
        });
        form.addEventListener('focusout', () => hideSoon(form));
        form.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
            const t = e.target;
            if (!isTextual(t) || t.tagName === 'TEXTAREA') return;
            e.preventDefault();
            const target = nextField(fieldsOf(form), t, 1);
            if (target) focusField(target);
            else submit(form);
        });
        return form;
    }

    window.AppModules = window.AppModules || {};
    window.AppModules.FormKeyboardNav = Object.freeze({ attach, nextField, barOffset, fieldsOf, applyHints });
})();
