// [WHY]: v3.4 · "Alan Kişi" çıkış ve toplu çıkış formlarında salt okunur ve her zaman oturumdaki kişiydi; yönetici başka bir
//        personele çıkış yaptığında kayıt (ve Kişi Envanteri) yöneticinin üzerine düşüyordu.
// [HOW]: PersonPicker — personel listesinden (window.data.personel, pasifler hariç) yazarak arayıp seçilen erişilebilir bir
//        combobox; seçilen kişinin id'si gizli alana yazılır. Yalnız createElement/textContent kullanılır.
//        ExitReceiver — iki formun alan kişisini kurar ve gönderimde çözer: yönetici listeden seçer (varsayılan kendisi);
//        personel hesabında alan kişi kendisidir ve değiştirilemez (firestore.rules staffExitB3Ok aynısını zorunlu tutar).
(function () {
    const MAX_RESULTS = 8;
    const norm = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    const nameOf = p => String(p?.name || p?.adSoyad || p?.ad || '').trim();
    const people = () => (window.data?.personel || []).filter(p => p && p.id != null && p.active !== false && nameOf(p));

    function attach(input, hidden) {
        if (!input || !hidden || input.dataset.personPicker === '1') return;
        input.dataset.personPicker = '1';
        const wrap = document.createElement('div');
        wrap.className = 'person-picker';
        input.parentNode.insertBefore(wrap, input);
        wrap.append(input);
        const list = document.createElement('ul');
        list.className = 'person-picker-list';
        list.id = `${input.id}List`;
        list.setAttribute('role', 'listbox');
        list.hidden = true;
        wrap.append(list);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', list.id);
        input.setAttribute('aria-expanded', 'false');
        input.autocomplete = 'off';

        let options = [], active = -1;
        const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
        const choose = p => { input.value = nameOf(p); hidden.value = String(p.id); input.dataset.chosenName = nameOf(p); close(); };
        const highlight = i => {
            active = i;
            [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
            if (list.children[i]) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
        };
        const render = () => {
            if (input.readOnly) return;
            const q = norm(input.value);
            if (input.dataset.chosenName !== input.value) hidden.value = '';
            options = people().filter(p => !q || norm(nameOf(p)).includes(q) || norm(p.pri).includes(q) || norm(p.birim || p.unit || '').includes(q))
                .slice(0, MAX_RESULTS);
            list.replaceChildren();
            if (!options.length) {
                const li = document.createElement('li');
                li.className = 'person-picker-empty';
                li.textContent = 'Eşleşen personel yok';
                list.append(li);
            }
            options.forEach((p, i) => {
                const li = document.createElement('li');
                li.id = `${list.id}-${i}`;
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                const strong = document.createElement('strong');
                strong.textContent = nameOf(p);
                li.append(strong);
                const meta = [p.pri, p.birim || p.unit].filter(Boolean).join(' · ');
                if (meta) { const small = document.createElement('small'); small.textContent = meta; li.append(small); }
                li.addEventListener('mousedown', e => { e.preventDefault(); choose(p); });
                list.append(li);
            });
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            active = -1;
        };
        input.addEventListener('input', render);
        // Odakta tüm metin seçilir (yazınca varsayılan ad değişir); fareyle odaklanınca mouseup seçimi bozmasın.
        let justFocused = false;
        input.addEventListener('focus', () => { if (!input.readOnly) { justFocused = true; input.select(); render(); } });
        input.addEventListener('mouseup', e => { if (justFocused) { e.preventDefault(); justFocused = false; } });
        input.addEventListener('blur', () => {
            // Tam ad yazılıp listeden tıklanmadıysa tek eşleşme kabul edilir
            if (!hidden.value) {
                const exact = people().filter(p => norm(nameOf(p)) === norm(input.value));
                if (exact.length === 1) choose(exact[0]);
            }
            close();
        });
        input.addEventListener('keydown', e => {
            if (list.hidden || !options.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % options.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + options.length) % options.length); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(options[active]); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        input._personPick = choose;
    }

    const FORMS = { exit: ['exitPerson', 'exitPersonId'], cart: ['cartPerson', 'cartPersonId'] };
    const els = kind => FORMS[kind].map(id => document.getElementById(id));

    // Modal açılırken çağrılır.
    function setup(kind, isAdmin) {
        const [input, hidden] = els(kind);
        if (!input || !hidden) return;
        attach(input, hidden);
        const me = window.getActiveUser?.() || {};
        input.value = nameOf(me) || String(me.name || '');
        hidden.value = me.id != null ? String(me.id) : '';
        input.dataset.chosenName = input.value;
        input.readOnly = !isAdmin;
        input.placeholder = isAdmin ? 'Personel adı veya kurumsal kimlik yazın…' : '';
        input.title = isAdmin ? 'Çıkışı alan personeli listeden seçin' : 'Personel çıkışında alan kişi siz olursunuz';
    }

    // Gönderimde çağrılır → { id, name } | null (uyarı gösterilmiştir)
    function resolve(kind, isAdmin) {
        const me = window.getActiveUser?.() || {};
        if (!isAdmin) {
            if (me.id == null || !String(me.name || '').trim()) { window.showAppAlert?.('Oturumdaki personel kaydı bulunamadı; sayfayı yenileyin.', 'error'); return null; }
            return { id: String(me.id), name: String(me.name).trim() };
        }
        const [input, hidden] = els(kind);
        const name = String(input?.value || '').trim();
        if (!name) { window.showAppAlert?.('Lütfen "Alan Kişi" için bir personel seçin.', 'warning'); input?.focus(); return null; }
        if (hidden?.value) return { id: hidden.value, name };
        // Yönetici kendi adını değiştirmeden bıraktıysa (personel kaydı olmayan yönetici kimliği) eski davranış korunur.
        if (name === String(me.name || '').trim()) return { id: me.id != null ? String(me.id) : null, name };
        window.showAppAlert?.('Lütfen "Alan Kişi"yi listeden seçin; yazılan ad bir personelle eşleşmiyor.', 'warning');
        input?.focus();
        return null;
    }

    window.PersonPicker = Object.freeze({ attach });
    window.ExitReceiver = Object.freeze({ setup, resolve });
})();
