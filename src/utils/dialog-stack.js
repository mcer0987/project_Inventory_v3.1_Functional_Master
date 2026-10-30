/**
 * utils/dialog-stack.js — En üstteki diyalog yönetimi (v3.3 Aşama 5 · Denetim P2-08)
 * Klasik script; iki sayfada <head>'de html.js'ten hemen sonra (DOM'a dokunan her dosyadan ÖNCE).
 *
 * [WHY]: WMS raf diyalogları/çekmecesi (shelf-matrix.js), genel onay kutusu (showCustomConfirm, alert.js), yönetici
 *        parola doğrulaması (promptAdminReauth, security.js) ve PIN ilk kurulum diyaloğu (admin-quick-unlock.js) HER
 *        BİRİ kendi document-level 'keydown' Escape dinleyicisini kuruyordu. Biri diğerinin ÜSTÜNDE açıldığında (ör.
 *        WMS çekmecesi açıkken kapasite diyaloğu, ya da WMS diyaloğu üstünde bir onay kutusu) TEK Escape basışı
 *        TÜMÜNÜ aynı anda kapatıyordu; hiçbiri Tab ile odağı diyalog içinde tutmuyor ya da kapanışta odağı
 *        açılıştaki elemana geri vermiyordu.
 * [HOW]: Açılış sırasına göre bir YIĞIN (stack) tutulur — bu projede diyaloglar her zaman sıralı açılır/kapanır,
 *        rastgele z-index ile yeniden sıralanmaz; "en üstteki" = yığının sonu. Tek bir CAPTURE fazı 'keydown'
 *        dinleyicisi (document üzerinde, capture:true): yığın boşsa HİÇBİR ŞEYE dokunmaz (ör. ui-components.js'nin
 *        "Escape → satır seçimini temizle" davranışı modalsız sayfada normal çalışmaya devam eder). Yığında bir
 *        diyalog varsa:
 *          - Escape: event.stopPropagation() (CAPTURE fazında durdurulduğu için bubble fazına hiç geçmez — henüz bu
 *            yardımcıya taşınmamış eski dinleyiciler de tetiklenmez) + yalnız EN ÜSTTEKİ diyaloğun onEscape'i (varsa).
 *          - Tab/Shift+Tab: yalnız en üstteki diyaloğun içindeki odaklanabilir düğümler arasında döngü yapar (focus trap).
 *        open(el, opts): açılıştaki odağı kaydeder, ilk odaklanabilir elemana (ya da opts.initialFocus) odaklanır.
 *        close(el): yığından çıkarır; en üstteyse kaydedilen önceki odağa (hâlâ DOM'daysa) geri döner.
 *        Saf DOM API; Firestore/veri katmanına dokunmaz — her sayfada bağımsız çalışır.
 */
(function () {
    'use strict';

    const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const stack = [];   // { el, onEscape, previousFocus }
    let listening = false;

    function isVisible(node) {
        return !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
    }

    function focusablesIn(el) {
        return Array.from(el.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
    }

    function onKeydown(event) {
        if (!stack.length) return;   // hiç diyalog açık değilken sayfanın geri kalanına dokunma
        const top = stack[stack.length - 1];
        if (!top.el.isConnected) { stack.pop(); return onKeydown(event); }   // DOM'dan koparılmış (ör. remove() ile) kalıntı

        if (event.key === 'Escape') {
            event.stopPropagation();
            if (typeof top.onEscape === 'function') top.onEscape();
            return;
        }
        if (event.key !== 'Tab') return;

        const items = focusablesIn(top.el);
        if (!items.length) { event.preventDefault(); return; }
        const currentIndex = items.indexOf(document.activeElement);
        if (currentIndex === -1) {
            // Odak diyalog dışına kaçmış (ör. programatik .focus() ya da dinamik içerik) — başa/sona zorla.
            event.preventDefault();
            (event.shiftKey ? items[items.length - 1] : items[0]).focus();
            return;
        }
        if (!event.shiftKey && currentIndex === items.length - 1) { event.preventDefault(); items[0].focus(); }
        else if (event.shiftKey && currentIndex === 0) { event.preventDefault(); items[items.length - 1].focus(); }
    }

    function ensureListening() {
        if (listening) return;
        document.addEventListener('keydown', onKeydown, true);   // capture: eski/taşınmamış dinleyicilerden ÖNCE çalışır
        listening = true;
    }

    /**
     * Diyaloğu yığının EN ÜSTÜNE ekler. opts.onEscape verilmezse Escape bu diyalog için yok sayılır (çağıran kendi
     * kapatma akışını — ör. bir onay sorusu — Escape'siz sürdürmek istiyorsa). opts.initialFocus açıkça verilebilir
     * (ör. bir input); verilmezse el içindeki İLK odaklanabilir eleman, o da yoksa el'in kendisi (tabindex=-1 ile).
     */
    function open(el, opts = {}) {
        if (!el || stack.some(e => e.el === el)) return;   // aynı eleman iki kez yığına girmez
        ensureListening();
        const previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement : null;
        stack.push({ el, onEscape: typeof opts.onEscape === 'function' ? opts.onEscape : null, previousFocus });
        const target = opts.initialFocus instanceof HTMLElement ? opts.initialFocus : focusablesIn(el)[0];
        if (target) {
            target.focus();
        } else {
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            el.focus();
        }
    }

    /** Diyaloğu yığından çıkarır. Kapanan diyalog en üstteyse, açılışta kaydedilen odağa (hâlâ DOM'daysa) döner. */
    function close(el) {
        const idx = stack.findIndex(e => e.el === el);
        if (idx === -1) return;
        const wasTop = idx === stack.length - 1;
        const [entry] = stack.splice(idx, 1);
        if (wasTop && entry.previousFocus && entry.previousFocus.isConnected) {
            entry.previousFocus.focus();
        }
    }

    function isTop(el) {
        return stack.length > 0 && stack[stack.length - 1].el === el;
    }

    window.DialogStack = Object.freeze({ open, close, isTop });
})();
