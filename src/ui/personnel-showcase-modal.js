// [WHY]: H6a hotfix turu — personel kaydındaki üç ayrı kimlik (kalıcı ID, hesap/UID, kurumsal kimlik PRI)
//        ve birim atamasının nasıl işlediğini görsel, kartlı ve adım adım anlatan rehber. Zimmet Rehberi
//        (src/ui/zim-showcase-modal.js) örnek alınarak aynı diyalog iskeleti ve bento/kart sistemiyle
//        kuruldu; veri okumaz/yazmaz.
// [HOW]: Modal ilk açılışta kurulur. Tüm düğümler createElement + textContent ile üretilir (innerHTML yok).

const SECTIONS = [
    { id: 'kimlik', icon: 'fa-id-card', title: 'Üç Ayrı Kimlik', tag: 'ID, UID, PRI' },
    { id: 'birim', icon: 'fa-building', title: 'Birim Ataması', tag: 'Gerçek bağ nasıl kurulur' },
    { id: 'hesap', icon: 'fa-key', title: 'Hesap Durumu', tag: 'Açma / göç uyarıları' },
    { id: 'pasif', icon: 'fa-pause', title: 'Pasifleştirme', tag: 'Kayıt silinmez' },
    { id: 'faq', icon: 'fa-circle-question', title: 'SSS', tag: 'Yardım' },
];

const KIMLIKLER = [
    { tone: 'indigo', icon: 'fa-fingerprint', title: 'Kalıcı Personel ID', text: 'Kayıt oluşturulduğunda atanır, bir daha değişmez. Geçmiş evrak, görev ve karar kayıtları bu ID\'ye bağlıdır; ad değişse bile bu kayıtlar bozulmaz.' },
    { tone: 'sky', icon: 'fa-user-shield', title: 'Hesap UID\'si', text: 'Kişinin uygulamaya giriş yapabildiği Firebase hesabının kimliğidir. Hesabı yoksa bu alan boştur; yalnız yönetici "Hesap Aç" ile bağlayabilir.' },
    { tone: 'violet', icon: 'fa-address-card', title: 'Kurumsal Kimlik (PRI)', text: 'Kurumun kendi personel numarasıdır. Giriş kodu değildir ve hiçbir ekranda gösterilmez/saklanmaz; yalnız PRI ve hesap durumu görünür.' },
];

const BIRIM_STEPS = [
    { icon: 'fa-sitemap', title: '1 · Birim Yönetimi\'nden', text: 'İlgili birim satırındaki "+ Personel Ekle" ile kişi aranıp seçilir — en hızlı yol budur.' },
    { icon: 'fa-user-pen', title: '2 · Personel kaydından', text: 'Personel Tanımları\'nda kaydı düzenleyip "Bağlı birim" alanından başka bir birim seçilebilir ya da "— Bağlantı yok —" ile tamamen kaldırılabilir.' },
    { icon: 'fa-triangle-exclamation', title: 'Her ikisi de aynı alanı değiştirir', text: 'Hangi yoldan yapılırsa yapılsın, gerçek kayıt personel.unitId\'dir; EBYS onay/havale akışları bunu okur.' },
];

const HESAP_STATES = [
    { tone: 'amber', icon: 'fa-circle-exclamation', title: 'PRI yok', text: 'Kuruma özel kimlik numarası henüz girilmemiş; personel düzenleme formundan eklenebilir.' },
    { tone: 'sky', icon: 'fa-user-plus', title: 'Hesap yok → "Hesap Aç"', text: 'Kişinin giriş hesabı yok; yalnız yönetici yeni bir kodla hesap açabilir.' },
    { tone: 'green', icon: 'fa-circle-check', title: '✓ Hesap güncel', text: 'Hesap, kurumsal kimlik adresinde ve PRI ile uyumlu; ek işlem gerekmez.' },
    { tone: 'red', icon: 'fa-triangle-exclamation', title: '⚠ Göç bekliyor', text: 'Hesap başka (eski) bir adreste; kurumsal kimlik adresine geçiş yapılmalı. "Hesap Göç Aracı" bunun içindir.' },
];

const PASIF_FLOW = [
    { icon: 'fa-pause', title: 'Personel pasifleştirilir', text: 'Kayıt silinmez; ad, ID, geçmiş görev/karar/evrak bağlantıları olduğu gibi kalır.' },
    { icon: 'fa-door-closed', title: 'Uygulama erişimi kapanır', text: 'Pasif personel yeni işlem yapamaz, yeni göreve atanamaz; mevcut birime bağlılığı görüntü olarak kalır.' },
    { icon: 'fa-rotate-left', title: 'Etkinleştirme geri alınabilir', text: '"Etkinleştir" ile erişim yeniden açılır; geçmiş ve atamalar olduğu gibi devam eder.' },
];

const FAQ = [
    ['Giriş kodunu nereden görürüm?', 'Hiçbir yerden. Giriş kodu güvenlik gereği ekranlarda gösterilmez ve saklanmaz; yalnız PRI ve hesap durumu (✓ / ⚠ / Hesap Aç) görünür.'],
    ['Aynı kişi iki birime birden atanabilir mi?', 'Hayır. personel.unitId tek bir değer taşır; yeni atama öncekinin yerine geçer.'],
    ['Personeli pasifleştirirsem geçmiş onayları kaybolur mu?', 'Hayır. Geçmişte verdiği kararlar, görevler ve evrak bağlantıları kalıcı ID üzerinden korunur; yalnız yeni işlem yapamaz.'],
    ['"Planlanan hesap işlemleri" ne işe yarar?', 'Henüz uygulanmamış, yol haritasındaki gelecek hesap işlemlerini (ör. toplu göç, self servis) kısaca anlatan bir bilgi penceresidir; bu ekrandan canlı bir işlem yapılmaz.'],
    ['Birim ataması olmayan personel sorun yaratır mı?', 'Hayır; yalnız o kişi birime bağlı EBYS süreçlerinde görev alamaz. Atama "— Bağlantı yok —" ile istendiğinde kaldırılabilir.'],
];

// ─── Güvenli DOM yardımcıları ──────────────────────────────────────────────────────────────────────────────────
function el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = String(opts.text);
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, String(v));
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
}
const icon = (name, cls = '') => el('i', { cls: `fas ${name} ${cls}`.trim(), attrs: { 'aria-hidden': 'true' } });
const badge = (text, tone = 'slate') => el('span', { cls: `pr-sc-badge tone-${tone}`, text });
const button = (label, iconName, onClick, cls = 'pr-sc-btn') => {
    const b = el('button', { cls, attrs: { type: 'button' } }, [iconName ? icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', onClick);
    return b;
};
const sectionHead = (eyebrow, title, lead) => el('header', { cls: 'pr-sc-head' }, [
    el('span', { cls: 'pr-sc-eyebrow', text: eyebrow }),
    el('h3', { cls: 'pr-sc-title', text: title }),
    el('p', { cls: 'pr-sc-lead', text: lead }),
]);
const miniCard = ({ tone, icon: ic, title, text }) => el('div', { cls: `pr-sc-mini tone-${tone}` }, [
    el('span', { cls: 'pr-sc-mini-icon' }, icon(ic)),
    el('div', {}, [el('strong', { text: title }), el('p', { text })]),
]);

// ─── 1 · Üç ayrı kimlik ─────────────────────────────────────────────────────────────────────────────────────────
function renderKimlik() {
    const root = el('div', { cls: 'pr-sc-section' });
    root.append(sectionHead('ID, UID, PRI', 'Bir personel kaydının üç kimliği',
        'Bu üçü birbirinin yerine geçmez; her biri ayrı bir amaca hizmet eder.'));
    root.append(el('div', { cls: 'pr-sc-bento cols-2' }, KIMLIKLER.map(miniCard)));
    return root;
}

// ─── 2 · Birim ataması ──────────────────────────────────────────────────────────────────────────────────────────
function renderBirim() {
    const root = el('div', { cls: 'pr-sc-section' });
    root.append(sectionHead('Gerçek bağ nasıl kurulur', 'İki yol, tek hedef alan',
        'personel.unitId, EBYS onay ve havale akışlarının okuduğu gerçek bağdır. Aşağıdaki iki yoldan hangisi kullanılırsa kullanılsın aynı alan güncellenir.'));
    const flow = el('ol', { cls: 'pr-sc-flow', attrs: { 'aria-label': 'Atama yolları' } });
    BIRIM_STEPS.forEach((s, i) => flow.append(el('li', { cls: 'pr-sc-flow-step' }, [
        el('span', { cls: 'pr-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'pr-sc-flow-num', text: i + 1 })]),
        el('div', { cls: 'pr-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
    ])));
    root.append(el('div', { cls: 'pr-sc-panel' }, [el('div', { cls: 'pr-sc-panel-head' }, [el('strong', { text: 'Yollar' })]), flow]));
    return root;
}

// ─── 3 · Hesap durumu ───────────────────────────────────────────────────────────────────────────────────────────
function renderHesap() {
    const root = el('div', { cls: 'pr-sc-section' });
    root.append(sectionHead('Açma / göç uyarıları', 'Personel listesindeki hesap rozetleri',
        'Personel Tanımları tablosundaki "Hesap" sütunu bu dört durumdan birini gösterir.'));
    root.append(el('div', { cls: 'pr-sc-bento cols-2' }, HESAP_STATES.map(miniCard)));
    return root;
}

// ─── 4 · Pasifleştirme ──────────────────────────────────────────────────────────────────────────────────────────
function renderPasif() {
    const root = el('div', { cls: 'pr-sc-section' });
    root.append(sectionHead('Kayıt silinmez', 'Pasifleştirme ne değiştirir, ne değiştirmez',
        '"Pasifleştir" bir silme değildir; yalnız uygulama erişimini kapatır.'));
    const flow = el('ol', { cls: 'pr-sc-flow', attrs: { 'aria-label': 'Pasifleştirme akışı' } });
    PASIF_FLOW.forEach((s, i) => flow.append(el('li', { cls: 'pr-sc-flow-step' }, [
        el('span', { cls: 'pr-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'pr-sc-flow-num', text: i + 1 })]),
        el('div', { cls: 'pr-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
    ])));
    root.append(el('div', { cls: 'pr-sc-panel' }, [el('div', { cls: 'pr-sc-panel-head' }, [el('strong', { text: 'Akış' })]), flow]));
    return root;
}

// ─── 5 · SSS ───────────────────────────────────────────────────────────────────────────────────────────────────
function renderFaq() {
    const root = el('div', { cls: 'pr-sc-section' });
    root.append(sectionHead('Sık sorulanlar', 'Kısa cevaplar', 'Başlığa dokunarak cevabı açın.'));
    root.append(el('div', { cls: 'pr-sc-faq' }, FAQ.map(([q, a]) => el('details', { cls: 'pr-sc-faq-item' }, [
        el('summary', {}, [el('span', { text: q }), icon('fa-chevron-down')]), el('p', { text: a }),
    ]))));
    return root;
}

const RENDERERS = { kimlik: renderKimlik, birim: renderBirim, hesap: renderHesap, pasif: renderPasif, faq: renderFaq };

// ─── Modal kabuğu (Zimmet Rehberi ile aynı iskelet) ─────────────────────────────────────────────────────────────
let modal = null, lastFocus = null, currentPanel = null;

function build() {
    const tabs = el('div', { cls: 'pr-sc-tabs', attrs: { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Rehber bölümleri' } });
    const stage = el('div', { cls: 'pr-sc-stage', attrs: { role: 'tabpanel', id: 'personnelShowcasePanel', tabindex: '0' } });
    const tabButtons = SECTIONS.map((s, i) => {
        const b = el('button', { cls: 'pr-sc-tab', attrs: { type: 'button', role: 'tab', id: `prScTab-${s.id}`, 'aria-controls': 'personnelShowcasePanel', 'aria-selected': 'false', tabindex: '-1' } }, [
            el('span', { cls: 'pr-sc-tab-icon' }, icon(s.icon)),
            el('span', { cls: 'pr-sc-tab-text' }, [el('strong', { text: s.title }), el('small', { text: s.tag })]),
        ]);
        b.addEventListener('click', () => show(s.id));
        b.addEventListener('keydown', e => {
            const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
            let next = null;
            if (e.key in keys) next = (i + keys[e.key] + SECTIONS.length) % SECTIONS.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = SECTIONS.length - 1;
            if (next === null) return;
            e.preventDefault();
            show(SECTIONS[next].id);
            tabButtons[next].focus();
        });
        tabs.append(b);
        return b;
    });

    function show(id) {
        currentPanel?._cleanup?.();
        SECTIONS.forEach((s, i) => {
            const on = s.id === id;
            tabButtons[i].setAttribute('aria-selected', String(on));
            tabButtons[i].tabIndex = on ? 0 : -1;
            tabButtons[i].classList.toggle('is-active', on);
            if (on) stage.setAttribute('aria-labelledby', tabButtons[i].id);
        });
        currentPanel = RENDERERS[id]();
        stage.replaceChildren(currentPanel);
        stage.scrollTop = 0;
    }

    const close = button('', 'fa-xmark', closeShowcase, 'pr-sc-close');
    close.setAttribute('aria-label', 'Rehberi kapat');
    close.title = 'Kapat (Esc)';

    const dialog = el('div', { cls: 'pr-sc-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'personnelShowcaseTitle', 'aria-describedby': 'personnelShowcaseDesc' } }, [
        el('header', { cls: 'pr-sc-topbar' }, [
            el('div', { cls: 'pr-sc-brand' }, [
                el('span', { cls: 'pr-sc-logo' }, icon('fa-id-card')),
                el('div', {}, [
                    el('h2', { cls: 'pr-sc-heading', attrs: { id: 'personnelShowcaseTitle' }, text: 'Personel Yönetimi Rehberi' }),
                    el('p', { cls: 'pr-sc-sub', attrs: { id: 'personnelShowcaseDesc' }, text: 'Kalıcı ID, hesap (UID) ve kurumsal kimlik (PRI) farkının, birim atamasının ve hesap durumu rozetlerinin nasıl işlediğini örneklerle gösterir. Buradaki örnekler gerçek kayıtları değiştirmez.' }),
                ]),
            ]),
            close,
        ]),
        el('div', { cls: 'pr-sc-body' }, [el('nav', { cls: 'pr-sc-nav', attrs: { 'aria-label': 'Rehber bölümleri' } }, tabs), stage]),
    ]);

    const overlay = el('div', { cls: 'pr-sc-overlay', attrs: { id: 'personnelShowcaseModal', hidden: '' } }, dialog);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeShowcase(); });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); closeShowcase(); return; }
        if (e.key !== 'Tab') return;
        const focusable = [...dialog.querySelectorAll('button:not([disabled]), input, select, textarea, summary, [tabindex="0"], a[href]')].filter(n => n.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    overlay._show = show;
    overlay._firstTab = () => tabButtons.find(b => b.getAttribute('aria-selected') === 'true') || tabButtons[0];
    document.body.append(overlay);
    return overlay;
}

export function openShowcase(sectionId = 'kimlik') {
    if (!modal) modal = build();
    lastFocus = document.activeElement;
    modal._show(RENDERERS[sectionId] ? sectionId : 'kimlik');
    modal.hidden = false;
    document.documentElement.classList.add('pr-sc-locked');
    requestAnimationFrame(() => { modal.classList.add('is-open'); modal._firstTab().focus(); });
}

export function closeShowcase() {
    if (!modal || modal.hidden) return;
    currentPanel?._cleanup?.();
    modal.classList.remove('is-open');
    document.documentElement.classList.remove('pr-sc-locked');
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
        if (modal.classList.contains('is-open')) return; // kapanış animasyonu sırasında yeniden açıldı
        modal.hidden = true;
        lastFocus?.focus?.();
    };
    if (reducedMotion()) finish(); else setTimeout(finish, 200);
}

document.querySelectorAll('[data-personnel-showcase]').forEach(trigger => {
    trigger.addEventListener('click', () => openShowcase(trigger.dataset.personnelShowcase || 'kimlik'));
});

window.AppModules = window.AppModules || {};
window.AppModules.PersonnelShowcase = Object.freeze({ open: openShowcase, close: closeShowcase });
