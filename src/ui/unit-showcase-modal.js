// [WHY]: H6a hotfix turu — Birim Yönetimi tablosu kalabalıklaşmıştı (çok personelli birimde tek hücrede
//        üç ayrı liste). Bu rehber, birimin gerçek yapısını (hiyerarşi, kalıcı ID), gerçek EBYS yönlendirme
//        kaynağının (personel.unitId) neden birimin kendi 'personnelIds' dizisinden farklı olduğunu ve yeni
//        "+ Personel Ekle" aksiyonunu örneklerle anlatır. Zimmet Rehberi (src/ui/zim-showcase-modal.js)
//        örnek alınarak aynı diyalog iskeleti ve bento/kart sistemiyle kuruldu; veri okumaz/yazmaz.
// [HOW]: Modal ilk açılışta kurulur. Tüm düğümler createElement + textContent ile üretilir (innerHTML yok).

const SECTIONS = [
    { id: 'yapi', icon: 'fa-sitemap', title: 'Birim Yapısı', tag: 'Ad, kod, hiyerarşi' },
    { id: 'bag', icon: 'fa-link', title: 'Gerçek Personel Bağı', tag: 'unitId mi, personnelIds mi?' },
    { id: 'ekle', icon: 'fa-user-plus', title: 'Personel Ekle / Çıkar', tag: 'Atama nasıl işler' },
    { id: 'pasif', icon: 'fa-pause', title: 'Pasifleştirme', tag: 'Geçmiş korunur' },
    { id: 'faq', icon: 'fa-circle-question', title: 'SSS', tag: 'Yardım' },
];

const FIELDS = [
    { tone: 'indigo', icon: 'fa-fingerprint', title: 'Kalıcı ID', text: 'Her birim oluşturulduğunda rastgele bir ID alır; bu ID bir daha değişmez. Ad veya kod değişse de geçmiş evrak/süreç kayıtları bu ID\'ye bağlı kalır.' },
    { tone: 'sky', icon: 'fa-signature', title: 'Ad ve kod', text: 'Görünen ad ve kısa kod serbestçe değiştirilebilir; EBYS tarafında kullanılan kalıcı ID değil, bu metinler değildir.' },
    { tone: 'violet', icon: 'fa-diagram-project', title: 'Üst birim (hiyerarşi)', text: 'Bir birim başka bir birime bağlanabilir. Üst birim aynı kuruma ait olmalı, döngü oluşturamaz ve en fazla 4 seviye derinliğe izin verilir.' },
    { tone: 'green', icon: 'fa-toggle-on', title: 'Aktif / Pasif', text: 'Pasif birime yeni personel ataması yapılamaz; zaten o birimde olan kişilerin ataması dokunulmadan kalır.' },
];

const BAG_COMPARE = [
    { tone: 'green', icon: 'fa-circle-check', title: 'personel.unitId — gerçek bağ', text: 'EBYS onay/havale akışları ve icra politikaları bu alanı okur. "+ Personel Ekle" ve personel düzenleme formu bunu değiştirir. Tablodaki "Bağlı Personel" listesi bu alana göre hesaplanır.' },
    { tone: 'amber', icon: 'fa-triangle-exclamation', title: 'unit.personnelIds — eski liste', text: 'Birim düzenleme penceresindeki "Ek Katılımcı Ekle" ile doldurulur. Hiçbir onay, havale veya yetki kararında okunmaz; yalnız düzenleme penceresinde "eski kayıt" olarak görünür. Silinmez ama yeni atama için kullanılmaz.' },
];

const EKLE_STEPS = [
    { icon: 'fa-magnifying-glass', title: '1 · Birim satırında "Personel Ekle"', text: 'Birim Yönetimi tablosunda ilgili satırın İşlemler sütunundan açılır.' },
    { icon: 'fa-keyboard', title: '2 · Ad yazıp sonuçtan seçin', text: 'En az 2 harf yazınca eşleşen aktif personel listelenir; zaten bu birimde olan kişi "zaten bu birimde" diye işaretlenir ve seçilemez.' },
    { icon: 'fa-right-left', title: '3 · Atama anında değişir', text: 'Kişi seçilince personel.unitId bu birime güncellenir; kişinin önceki birimi değişir (bir kişi aynı anda yalnız bir birime bağlı olabilir).' },
];
const CIKAR_NOTE = { tone: 'sky', icon: 'fa-user-minus', title: 'Birimden çıkarmak için', text: 'Doğrudan bir "çıkar" düğmesi yoktur: kişiyi başka bir birime yeniden atarsınız ya da Personel Tanımları\'ndan o kişinin kaydını açıp "Bağlı birim" alanını "— Bağlantı yok —" yapıp kaydedersiniz.' };

const PASIF_FLOW = [
    { icon: 'fa-pause', title: 'Birim pasifleştirilir', text: '"Pasifleştir" ile birim artık yeni atama kabul etmez; kayıt ve geçmiş bağlantıları silinmez, olduğu gibi kalır.' },
    { icon: 'fa-users', title: 'Zaten bağlı personel etkilenmez', text: 'O birime önceden atanmış kişilerin unitId\'si otomatik boşaltılmaz; "halihazırda bu birimde olmak" korunur.' },
    { icon: 'fa-ban', title: 'Yeni atama reddedilir', text: 'Pasif birime başka bir kişi "+ Personel Ekle" ile eklenmeye çalışılırsa sistem reddeder; önce birim yeniden etkinleştirilmelidir.' },
];

const FAQ = [
    ['Bir kişiyi aynı anda iki birime atayabilir miyim?', 'Hayır. personel.unitId tek bir değer taşır; yeni atama öncekinin yerine geçer.'],
    ['Birimin adını değiştirirsem geçmiş evraklar bozulur mu?', 'Hayır. Geçmiş evrak/sürüm kayıtları, o anki birim adının bir anlık görüntüsünü (künye) taşır; sonradan ad değişse de geçmiş kayıt değişmez.'],
    ['"Ek Katılımcı Ekle" ne zaman kullanılır?', 'Yalnız birimin kendi düzenleme penceresinde, tarihsel/bilgi amaçlı bir liste olarak. Gerçek EBYS yönlendirmesi için "+ Personel Ekle" kullanılmalıdır.'],
    ['Birim kalıcı ID\'sini nereden kopyalarım?', 'Birim Yönetimi tablosunda birim adının yanındaki küçük kopyalama simgesinden; panoya kopyalanır.'],
    ['Üst birim neden bazen seçilemiyor?', 'Üst birim pasifse, farklı kuruma aitse ya da seçim 4 seviyeden derin bir döngüye yol açıyorsa engellenir.'],
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
const badge = (text, tone = 'slate') => el('span', { cls: `un-sc-badge tone-${tone}`, text });
const button = (label, iconName, onClick, cls = 'un-sc-btn') => {
    const b = el('button', { cls, attrs: { type: 'button' } }, [iconName ? icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', onClick);
    return b;
};
const sectionHead = (eyebrow, title, lead) => el('header', { cls: 'un-sc-head' }, [
    el('span', { cls: 'un-sc-eyebrow', text: eyebrow }),
    el('h3', { cls: 'un-sc-title', text: title }),
    el('p', { cls: 'un-sc-lead', text: lead }),
]);
const miniCard = ({ tone, icon: ic, title, text }) => el('div', { cls: `un-sc-mini tone-${tone}` }, [
    el('span', { cls: 'un-sc-mini-icon' }, icon(ic)),
    el('div', {}, [el('strong', { text: title }), el('p', { text })]),
]);

// ─── 1 · Birim yapısı ───────────────────────────────────────────────────────────────────────────────────────────
function renderYapi() {
    const root = el('div', { cls: 'un-sc-section' });
    root.append(sectionHead('Ad, kod, hiyerarşi', 'Bir birimin taşıdığı alanlar',
        'Her birim bu dört temel özelliği taşır. Tablodaki yeni "Birim" hücresi bunları tek bakışta gösterir: ad, durum rozeti ve kısaltılmış kalıcı ID.'));
    root.append(el('div', { cls: 'un-sc-bento cols-2' }, FIELDS.map(miniCard)));
    return root;
}

// ─── 2 · Gerçek personel bağı ───────────────────────────────────────────────────────────────────────────────────
function renderBag() {
    const root = el('div', { cls: 'un-sc-section' });
    root.append(sectionHead('unitId mi, personnelIds mi?', 'İki ayrı liste, tek gerçek kaynak',
        'Kodda birim-personel ilişkisinin iki ayrı yolu var. Hangisinin EBYS onay/havale kararlarını etkilediğini bilmek karışıklığı önler.'));
    root.append(el('div', { cls: 'un-sc-bento cols-2' }, BAG_COMPARE.map(miniCard)));
    root.append(el('div', { cls: 'un-sc-panel' }, [
        el('div', { cls: 'un-sc-panel-head' }, [el('strong', { text: 'Pratik sonuç' }), badge('Özet', 'slate')]),
        el('p', { cls: 'un-sc-sim-log', text: 'Birim tablosundaki "Bağlı Personel" hücresi yalnız personel.unitId\'ye göre hesaplanır. Birimin kendi "Ek Katılımcı" listesi orada görünmez; yalnız birimi düzenlerken "eski kayıt" olarak karşınıza çıkar.' }),
    ]));
    return root;
}

// ─── 3 · Personel ekle / çıkar ──────────────────────────────────────────────────────────────────────────────────
function renderEkle() {
    const root = el('div', { cls: 'un-sc-section' });
    root.append(sectionHead('Atama nasıl işler', '"+ Personel Ekle" ile üç adım',
        'Birim tablosundaki yeni aksiyon, seçtiğiniz kişinin gerçek birim atamasını (personel.unitId) doğrudan değiştirir.'));
    const flow = el('ol', { cls: 'un-sc-flow', attrs: { 'aria-label': 'Atama akışı' } });
    EKLE_STEPS.forEach((s, i) => flow.append(el('li', { cls: 'un-sc-flow-step' }, [
        el('span', { cls: 'un-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'un-sc-flow-num', text: i + 1 })]),
        el('div', { cls: 'un-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
    ])));
    root.append(el('div', { cls: 'un-sc-panel' }, [el('div', { cls: 'un-sc-panel-head' }, [el('strong', { text: 'Akış' })]), flow]));
    root.append(el('div', { cls: 'un-sc-bento cols-2' }, [miniCard(CIKAR_NOTE),
        miniCard({ tone: 'red', icon: 'fa-ban', title: 'Pasif kişi eklenemez', text: 'Arama sonucunda pasif personel hiç listelenmez; yalnız aktif hesaplar seçilebilir.' })]));
    return root;
}

// ─── 4 · Pasifleştirme ──────────────────────────────────────────────────────────────────────────────────────────
function renderPasif() {
    const root = el('div', { cls: 'un-sc-section' });
    root.append(sectionHead('Geçmiş korunur', 'Pasifleştirme ne değiştirir, ne değiştirmez',
        '"Pasifleştir" bir silme değildir; birim kaydı ve geçmiş bağlantıları kalır, yalnız yeni kullanım kapanır.'));
    const flow = el('ol', { cls: 'un-sc-flow', attrs: { 'aria-label': 'Pasifleştirme akışı' } });
    PASIF_FLOW.forEach((s, i) => flow.append(el('li', { cls: 'un-sc-flow-step' }, [
        el('span', { cls: 'un-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'un-sc-flow-num', text: i + 1 })]),
        el('div', { cls: 'un-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
    ])));
    root.append(el('div', { cls: 'un-sc-panel' }, [el('div', { cls: 'un-sc-panel-head' }, [el('strong', { text: 'Akış' })]), flow]));
    return root;
}

// ─── 5 · SSS ───────────────────────────────────────────────────────────────────────────────────────────────────
function renderFaq() {
    const root = el('div', { cls: 'un-sc-section' });
    root.append(sectionHead('Sık sorulanlar', 'Kısa cevaplar', 'Başlığa dokunarak cevabı açın.'));
    root.append(el('div', { cls: 'un-sc-faq' }, FAQ.map(([q, a]) => el('details', { cls: 'un-sc-faq-item' }, [
        el('summary', {}, [el('span', { text: q }), icon('fa-chevron-down')]), el('p', { text: a }),
    ]))));
    return root;
}

const RENDERERS = { yapi: renderYapi, bag: renderBag, ekle: renderEkle, pasif: renderPasif, faq: renderFaq };

// ─── Modal kabuğu (Zimmet Rehberi ile aynı iskelet) ─────────────────────────────────────────────────────────────
let modal = null, lastFocus = null, currentPanel = null;

function build() {
    const tabs = el('div', { cls: 'un-sc-tabs', attrs: { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Rehber bölümleri' } });
    const stage = el('div', { cls: 'un-sc-stage', attrs: { role: 'tabpanel', id: 'unitShowcasePanel', tabindex: '0' } });
    const tabButtons = SECTIONS.map((s, i) => {
        const b = el('button', { cls: 'un-sc-tab', attrs: { type: 'button', role: 'tab', id: `unScTab-${s.id}`, 'aria-controls': 'unitShowcasePanel', 'aria-selected': 'false', tabindex: '-1' } }, [
            el('span', { cls: 'un-sc-tab-icon' }, icon(s.icon)),
            el('span', { cls: 'un-sc-tab-text' }, [el('strong', { text: s.title }), el('small', { text: s.tag })]),
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

    const close = button('', 'fa-xmark', closeShowcase, 'un-sc-close');
    close.setAttribute('aria-label', 'Rehberi kapat');
    close.title = 'Kapat (Esc)';

    const dialog = el('div', { cls: 'un-sc-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'unitShowcaseTitle', 'aria-describedby': 'unitShowcaseDesc' } }, [
        el('header', { cls: 'un-sc-topbar' }, [
            el('div', { cls: 'un-sc-brand' }, [
                el('span', { cls: 'un-sc-logo' }, icon('fa-sitemap')),
                el('div', {}, [
                    el('h2', { cls: 'un-sc-heading', attrs: { id: 'unitShowcaseTitle' }, text: 'Birim Yönetimi Rehberi' }),
                    el('p', { cls: 'un-sc-sub', attrs: { id: 'unitShowcaseDesc' }, text: 'Birim yapısı, gerçek personel bağı ve atama/pasifleştirme süreçlerinin nasıl işlediğini örneklerle gösterir. Buradaki örnekler gerçek kayıtları değiştirmez.' }),
                ]),
            ]),
            close,
        ]),
        el('div', { cls: 'un-sc-body' }, [el('nav', { cls: 'un-sc-nav', attrs: { 'aria-label': 'Rehber bölümleri' } }, tabs), stage]),
    ]);

    const overlay = el('div', { cls: 'un-sc-overlay', attrs: { id: 'unitShowcaseModal', hidden: '' } }, dialog);
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

export function openShowcase(sectionId = 'yapi') {
    if (!modal) modal = build();
    lastFocus = document.activeElement;
    modal._show(RENDERERS[sectionId] ? sectionId : 'yapi');
    modal.hidden = false;
    document.documentElement.classList.add('un-sc-locked');
    requestAnimationFrame(() => { modal.classList.add('is-open'); modal._firstTab().focus(); });
}

export function closeShowcase() {
    if (!modal || modal.hidden) return;
    currentPanel?._cleanup?.();
    modal.classList.remove('is-open');
    document.documentElement.classList.remove('un-sc-locked');
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
        if (modal.classList.contains('is-open')) return; // kapanış animasyonu sırasında yeniden açıldı
        modal.hidden = true;
        lastFocus?.focus?.();
    };
    if (reducedMotion()) finish(); else setTimeout(finish, 200);
}

document.querySelectorAll('[data-unit-showcase]').forEach(trigger => {
    trigger.addEventListener('click', () => openShowcase(trigger.dataset.unitShowcase || 'yapi'));
});

window.AppModules = window.AppModules || {};
window.AppModules.UnitShowcase = Object.freeze({ open: openShowcase, close: closeShowcase });
