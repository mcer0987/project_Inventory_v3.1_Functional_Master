// [WHY]: feat/envanter-talep-iade · Faz 6 — envanter çıkışı, talep/onay, zimmet ve iade süreçlerini personele ve
//        yöneticiye uzun bir yardım metni yerine görsel, adım adım bir rehberle anlatmak. EBYS Rehberi
//        (src/ui/ebys-showcase-modal.js) örnek alınarak aynı diyalog iskeleti ve bento/kart sistemiyle kuruldu;
//        veri okumaz/yazmaz, yalnız statik içerik ve yerel simülasyon içerir. "Envanter Takibi" sekmesinden açılır.
// [HOW]: Modal ilk açılışta kurulur. Tüm düğümler createElement + textContent ile üretilir (innerHTML yok).
//        Erişilebilirlik: role=dialog, dikey tablist (ok tuşları), Escape ile kapanma, odak hapsi ve odağın geri dönüşü.

const SECTIONS = [
    { id: 'cikis', icon: 'fa-arrow-right-from-bracket', title: 'Envanter Çıkışı', tag: 'Kim, neyi çıkarabilir' },
    { id: 'talep', icon: 'fa-paper-plane', title: 'Talep ve Onay', tag: 'Demirbaş isteme' },
    { id: 'zimmet', icon: 'fa-id-badge', title: 'Zimmet Yaşam Döngüsü', tag: 'Teslimden iadeye' },
    { id: 'iade', icon: 'fa-rotate-left', title: 'İade Süreci', tag: 'Karar yöneticide' },
    { id: 'faq', icon: 'fa-circle-question', title: 'SSS', tag: 'Yardım' },
];

const ROLES = [
    { id: 'admin', icon: 'fa-user-shield', title: 'Yönetici', text: 'Her depodan demirbaş ya da sarf malzeme çıkışı yapar; alan kişiyi personel listesinden seçer.' },
    { id: 'staff', icon: 'fa-user', title: 'Personel (BT ekibi)', text: 'Yalnız sarf malzeme çıkışı yapar; çıkış kendi adına kaydedilir. Demirbaş için "Envanter Talep Et" kullanılır.' },
];
const ACTIONS = [
    { id: 'sarf', label: 'Sarf malzeme çıkışı yapma', admin: true, staff: true },
    { id: 'toplu', label: 'Toplu çıkış (tek seferde en fazla 6 ürün)', admin: true, staff: true },
    { id: 'demirbas', label: 'Demirbaş çıkışı yapma', admin: true, staff: false },
    { id: 'talep', label: '"Envanter Talep Et" ile demirbaş isteme', admin: false, staff: true },
];

const REQUEST_DECISIONS = [
    { tone: 'green', icon: 'fa-circle-check', title: 'Onayla', text: 'Stok kalemini seçer; demirbaşta her cihaz için Seri No ya da Envanter No girilmesi zorunludur.' },
    { tone: 'red', icon: 'fa-ban', title: 'Reddet', text: 'Gerekçe zorunludur. Red, personelin "Taleplerim" ekranında görünür.' },
];
const ZIMMET_FLOW = [
    { icon: 'fa-paper-plane', title: 'Talep onaylandı', text: 'Demirbaş talebi onaylanınca "⏳ Teslim Bekliyor" durumuna geçer.' },
    { icon: 'fa-hand-holding', title: '"Teslim Aldım" denir', text: 'Personel cihazı fiziken aldığında zimmet "📌 Zimmetli" olur; Kişi Envanterim ve zimmet tutanağında görünür.' },
    { icon: 'fa-rotate-left', title: 'İade talebi gönderilir', text: 'Personel cihazı iade etmek isteyince "↩️ İade Onayı Bekliyor" durumuna geçer.' },
    { icon: 'fa-box-archive', title: 'Yönetici karar verir', text: 'Onaylanınca "✅ İade Edildi" olur; zimmet kişinin üzerinden düşer.' },
];
const ZIMMET_STATES = [
    { tone: 'amber', icon: 'fa-hourglass-half', title: '⏳ Teslim Bekliyor', text: 'Onaylandı ama personel henüz "Teslim Aldım" demedi.' },
    { tone: 'indigo', icon: 'fa-thumbtack', title: '📌 Zimmetli', text: 'Cihaz personelin üzerinde; Kişi Envanterim listesinde görünür.' },
    { tone: 'sky', icon: 'fa-rotate-left', title: '↩️ İade Onayı Bekliyor', text: 'Personel iade talebi gönderdi; yönetici kararını bekliyor.' },
    { tone: 'green', icon: 'fa-circle-check', title: '✅ İade Edildi', text: 'Yönetici karara bağladı; zimmet kapandı, tutanak alınabilir.' },
];

const RETURN_REASONS = ['Ayrılış / görev değişikliği', 'Arıza', 'İhtiyaç kalmadı', 'Değişim', 'Diğer'];
const DEVICE_STATES = ['Çalışır', 'Arızalı', 'Hasarlı', 'Eksik parça'];
const ADMIN_DEVICE_STATES = ['Sağlam', 'Arızalı', 'Hasarlı', 'Eksik parça'];

const FAQ = [
    ['Sarf malzeme iade edilebilir mi?', 'Hayır. İade yalnız demirbaş zimmetleri içindir; sarf malzeme çıkışı tüketim sayılır ve depoya dönmez.'],
    ['İade talebimi gönderdikten sonra vazgeçebilir miyim?', 'Evet. Yönetici karar vermeden önce "İade Taleplerim" bölümünden "Geri Çek"e basabilirsiniz; istediğiniz zaman yeniden gönderebilirsiniz.'],
    ['Yönetici cihazı arızalı/hasarlı bulursa ne olur?', 'Yönetici gördüğü durumu kaydeder. Stoğa eklemek onun kararıdır; sağlam değilse eklemeyip cihazı servis/hurda sürecine ayrıca yönlendirebilir.'],
    ['Cihaz hiç teslim edilmeden zimmet nasıl kapanır?', 'Personel ayrılışı, kayıp gibi durumlarda yönetici "Hayır, teslim almadan kapat"ı seçip açıklama yazarak zimmeti kapatabilir. Depo stoğu bu durumda değişmez.'],
    ['İade onaylandıktan sonra tutanağı nereden alırım?', '"Gelen Talepler" ve admin "Talep ve Süreçler" tablolarında onaylanan iade satırının yanındaki "İade Tutanağı" düğmesiyle.'],
    ['Reddedilen ya da geri çektiğim iade talebi ne olur?', 'Listede kalır; dilediğiniz zaman aynı gerekçe ve beyanla ya da düzelterek "Yeniden Gönder" ile tekrar yöneticiye iletebilirsiniz.'],
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
const badge = (text, tone = 'slate') => el('span', { cls: `zim-sc-badge tone-${tone}`, text });
const button = (label, iconName, onClick, cls = 'zim-sc-btn') => {
    const b = el('button', { cls, attrs: { type: 'button' } }, [iconName ? icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', onClick);
    return b;
};
const sectionHead = (eyebrow, title, lead) => el('header', { cls: 'zim-sc-head' }, [
    el('span', { cls: 'zim-sc-eyebrow', text: eyebrow }),
    el('h3', { cls: 'zim-sc-title', text: title }),
    el('p', { cls: 'zim-sc-lead', text: lead }),
]);
const miniCard = ({ tone, icon: ic, title, text }) => el('div', { cls: `zim-sc-mini tone-${tone}` }, [
    el('span', { cls: 'zim-sc-mini-icon' }, icon(ic)),
    el('div', {}, [el('strong', { text: title }), el('p', { text })]),
]);
const select = (options, value) => {
    const s = el('select', { cls: 'zim-sc-select' });
    options.forEach(o => s.append(el('option', { value: o, text: o })));
    if (value != null) s.value = value;
    return s;
};

// ─── 1 · Envanter çıkışı: rol seçimi → o role açık işlemler ────────────────────────────────────────────────────
function renderCikis() {
    const root = el('div', { cls: 'zim-sc-section' });
    root.append(sectionHead('Kim, neyi çıkarabilir', 'Rol seçin, yetkisini görün',
        'Envanter çıkışını yönetici her ürün için yapabilir. Personel yalnız sarf malzeme çıkışı yapar; demirbaş yalnız yönetici eliyle çıkar ya da talep yoluyla verilir.'));

    const grid = el('div', { cls: 'zim-sc-bento cols-2', attrs: { role: 'group', 'aria-label': 'Rol seçimi' } });
    const list = el('ul', { cls: 'zim-sc-checklist', attrs: { 'aria-live': 'polite' } });
    const cards = ROLES.map(role => {
        const card = el('button', { cls: 'zim-sc-role', attrs: { type: 'button', 'aria-pressed': 'false' } }, [
            el('span', { cls: 'zim-sc-role-icon' }, icon(role.icon)),
            el('strong', { text: role.title }),
            el('span', { cls: 'zim-sc-role-text', text: role.text }),
        ]);
        card.addEventListener('click', () => select(role.id));
        grid.append(card);
        return { role, card };
    });
    function select(id) {
        cards.forEach(({ role, card }) => { const on = role.id === id; card.classList.toggle('is-selected', on); card.setAttribute('aria-pressed', String(on)); });
        list.replaceChildren(...ACTIONS.map(a => {
            const allowed = !!a[id];
            return el('li', { cls: allowed ? 'is-yes' : 'is-no' }, [icon(allowed ? 'fa-circle-check' : 'fa-circle-xmark'), el('span', { text: a.label })]);
        }));
    }

    root.append(grid, el('div', { cls: 'zim-sc-panel' }, [
        el('div', { cls: 'zim-sc-panel-head' }, [el('strong', { text: 'Bu role açık işlemler' }), badge('Örnek', 'slate')]),
        list,
    ]));
    root.append(el('div', { cls: 'zim-sc-bento cols-2' }, [
        miniCard({ tone: 'indigo', icon: 'fa-shield-halved', title: 'Tür bilinmiyorsa güvenli taraf', text: 'Ürünün türü tanımlı değilse ya da adı farklı yazılmışsa çıkış kararı yöneticiye kalır; personel formu doldursa da reddedilir.' }),
        miniCard({ tone: 'sky', icon: 'fa-layer-group', title: 'Toplu çıkış sınırı', text: 'Personel tek seferde en fazla 6 farklı ürün çıkarabilir; daha fazlası ikinci bir toplu çıkışla yapılır.' }),
    ]));
    select('admin');
    return root;
}

// ─── 2 · Talep ve onay ──────────────────────────────────────────────────────────────────────────────────────────
function renderTalep() {
    const root = el('div', { cls: 'zim-sc-section' });
    root.append(sectionHead('Demirbaş isteme', 'Personel ister, yönetici onaylar ya da reddeder',
        '"Envanter Talep Et" ile gönderilen talep gerekçe ve öncelik taşır. Yönetici onaylarken stok kalemini seçer; demirbaşta cihaz kimliği zorunludur.'));
    root.append(el('div', { cls: 'zim-sc-bento cols-2' }, REQUEST_DECISIONS.map(miniCard)));
    root.append(
        el('h4', { cls: 'zim-sc-subtitle', text: 'Onaylanınca ne olur' }),
        el('div', { cls: 'zim-sc-bento cols-2' }, [
            miniCard({ tone: 'indigo', icon: 'fa-id-badge', title: 'Demirbaş → zimmet', text: 'Cihaz "⏳ Teslim Bekliyor" olur; personel "Teslim Aldım" diyince zimmetli sayılır.' }),
            miniCard({ tone: 'green', icon: 'fa-dolly', title: 'Sarf → tüketim çıkışı', text: 'Zimmetlenmez; doğrudan tüketim (çıkış) kaydı olarak işlenir, Kişi Envanterim\'e girmez.' }),
        ]));
    return root;
}

// ─── 3 · Zimmet yaşam döngüsü ───────────────────────────────────────────────────────────────────────────────────
function renderZimmet() {
    const root = el('div', { cls: 'zim-sc-section' });
    root.append(sectionHead('Teslimden iadeye', 'Bir zimmetin dört durumu',
        'Her demirbaş zimmeti bu dört durumdan birindedir. Durum rozetleri Zimmet ekranında ve Kişi Envanterim\'de aynı renk ve simgeyle görünür.'));

    const flow = el('ol', { cls: 'zim-sc-flow', attrs: { 'aria-label': 'Zimmet akışı' } });
    ZIMMET_FLOW.forEach((s, i) => flow.append(el('li', { cls: 'zim-sc-flow-step' }, [
        el('span', { cls: 'zim-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'zim-sc-flow-num', text: i + 1 })]),
        el('div', { cls: 'zim-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
    ])));
    root.append(el('div', { cls: 'zim-sc-panel' }, [el('div', { cls: 'zim-sc-panel-head' }, [el('strong', { text: 'Akış' })]), flow]));
    root.append(el('h4', { cls: 'zim-sc-subtitle', text: 'Durum rozetleri' }),
        el('div', { cls: 'zim-sc-bento cols-2' }, ZIMMET_STATES.map(miniCard)));
    return root;
}

// ─── 4 · İade süreci: canlı karar simülasyonu (gerçek onay penceresiyle aynı mantık) ───────────────────────────
function renderIade() {
    const root = el('div', { cls: 'zim-sc-section' });
    root.append(sectionHead('Karar yöneticide', 'İade talebinden kapanışa',
        'Personel Kişi Envanterim\'den iade talebi gönderir. Yönetici cihazı teslim alıp almadığına, durumuna ve stoğa eklenip eklenmeyeceğine karar vererek onaylar ya da gerekçeyle reddeder.'));

    root.append(el('div', { cls: 'zim-sc-panel' }, [
        el('div', { cls: 'zim-sc-panel-head' }, [el('strong', { text: '1 · Personelin gönderdiği talep' }), badge('Örnek', 'slate')]),
        el('div', { cls: 'zim-sc-bento cols-2' }, [
            el('div', {}, [el('small', { cls: 'zim-sc-field-label', text: 'İade gerekçesi' }), select(RETURN_REASONS, 'Arıza')]),
            el('div', {}, [el('small', { cls: 'zim-sc-field-label', text: 'Cihazın durumu (beyan)' }), select(DEVICE_STATES, 'Arızalı')]),
        ]),
    ]));

    // ── Canlı karar simülasyonu: gerçek onay penceresiyle aynı dallanma ──
    const radio = (value, text, checked) => {
        const attrs = { type: 'radio', name: 'zimScReceived', value, id: `zimScReceived-${value}` };
        if (checked) attrs.checked = '';
        const input = el('input', { attrs });
        return el('label', { cls: 'zim-sc-option', attrs: { for: `zimScReceived-${value}` } }, [input, el('span', { text })]);
    };
    const received = el('div', { cls: 'zim-sc-options', attrs: { role: 'radiogroup', 'aria-label': 'Cihaz teslim alındı mı' } },
        [radio('yes', 'Evet, cihazı teslim aldım', true), radio('no', 'Hayır, teslim almadan kapat', false)]);
    const cihaz = select(ADMIN_DEVICE_STATES, 'Sağlam');
    const depo = select(['B1 Depo', 'B2 Depo'], 'B1 Depo');
    const stokCheck = el('input', { attrs: { type: 'checkbox', id: 'zimScStock', checked: '' } });
    const stokRow = el('label', { cls: 'zim-sc-check', attrs: { for: 'zimScStock' } }, [stokCheck, el('span', { text: 'Stoğa ekle (ürün kalemine +1)' })]);
    const yesBox = el('div', { cls: 'zim-sc-branch' }, [
        el('div', { cls: 'zim-sc-bento cols-2' }, [
            el('div', {}, [el('small', { cls: 'zim-sc-field-label', text: 'Cihaz durumu (yönetici kararı)' }), cihaz]),
            el('div', {}, [el('small', { cls: 'zim-sc-field-label', text: 'Hangi depoya alınsın?' }), depo]),
        ]),
        stokRow,
    ]);
    const kapanis = el('textarea', { cls: 'zim-sc-textarea', attrs: { rows: 2, placeholder: 'Neden teslim alınmadan kapatılıyor? (ör. kayıp, personel ayrıldı)' } });
    const noBox = el('div', { cls: 'zim-sc-branch', attrs: { hidden: '' } }, [el('small', { cls: 'zim-sc-field-label', text: 'Kapanış açıklaması (zorunlu)' }), kapanis]);
    const outcome = el('p', { cls: 'zim-sc-sim-log', attrs: { 'aria-live': 'polite' } });

    const sync = () => {
        const yes = received.querySelector('input:checked').value === 'yes';
        yesBox.hidden = !yes; noBox.hidden = yes;
        if (yes) {
            const line = cihaz.value === 'Sağlam'
                ? (stokCheck.checked ? `Zimmet kapanır; cihaz ${depo.value}'a sağlam olarak eklenir, stok +1 olur.` : `Zimmet kapanır; sağlam olmasına rağmen stoğa eklenmez (yönetici tercihi).`)
                : `Zimmet kapanır; cihaz "${cihaz.value}" olarak ${depo.value}'a alınır. Sağlam değil: stoğa eklemek sizin kararınız.`;
            outcome.textContent = line;
        } else {
            outcome.textContent = kapanis.value.trim()
                ? `Zimmet, cihaz fiziken teslim alınmadan kapanır. Depo stoğu değişmez. Kapanış açıklaması tutanağa işlenir: "${kapanis.value.trim()}"`
                : 'Teslim alınmadan kapatmak için açıklama zorunludur; boşken onay verilmez.';
        }
    };
    received.addEventListener('change', sync);
    cihaz.addEventListener('change', () => { stokCheck.checked = cihaz.value === 'Sağlam'; sync(); });
    stokCheck.addEventListener('change', sync);
    depo.addEventListener('change', sync);
    kapanis.addEventListener('input', sync);
    sync();

    root.append(el('div', { cls: 'zim-sc-panel' }, [
        el('div', { cls: 'zim-sc-panel-head' }, [el('strong', { text: '2 · Yöneticinin kararı — deneyin' }), badge('Canlı simülasyon', 'indigo')]),
        el('p', { cls: 'zim-sc-label', text: 'Cihazı teslim aldınız mı?' }), received, yesBox, noBox, outcome,
    ]));
    root.append(el('div', { cls: 'zim-sc-bento cols-2' }, [
        miniCard({ tone: 'green', icon: 'fa-file-pdf', title: 'İade tutanağı', text: 'Onaylanan her iade için "İade Tutanağı" düğmesiyle imzalı PDF belge alınabilir.' }),
        miniCard({ tone: 'sky', icon: 'fa-repeat', title: '"Zimmetten Düş" aynı pencereyi kullanır', text: 'Zimmet ekranında bekleyen bir iade talebi varsa yönetici doğrudan bu talebi onaylar.' }),
    ]));
    return root;
}

// ─── 5 · SSS ───────────────────────────────────────────────────────────────────────────────────────────────────
function renderFaq() {
    const root = el('div', { cls: 'zim-sc-section' });
    root.append(sectionHead('Sık sorulanlar', 'Kısa cevaplar', 'En çok merak edilen konular. Başlığa dokunarak cevabı açın.'));
    root.append(el('div', { cls: 'zim-sc-faq' }, FAQ.map(([q, a]) => el('details', { cls: 'zim-sc-faq-item' }, [
        el('summary', {}, [el('span', { text: q }), icon('fa-chevron-down')]), el('p', { text: a }),
    ]))));
    return root;
}

const RENDERERS = { cikis: renderCikis, talep: renderTalep, zimmet: renderZimmet, iade: renderIade, faq: renderFaq };

// ─── Modal kabuğu (EBYS Rehberi ile aynı iskelet) ──────────────────────────────────────────────────────────────
let modal = null, lastFocus = null, currentPanel = null;

function build() {
    const tabs = el('div', { cls: 'zim-sc-tabs', attrs: { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Rehber bölümleri' } });
    const stage = el('div', { cls: 'zim-sc-stage', attrs: { role: 'tabpanel', id: 'zimShowcasePanel', tabindex: '0' } });
    const tabButtons = SECTIONS.map((s, i) => {
        const b = el('button', { cls: 'zim-sc-tab', attrs: { type: 'button', role: 'tab', id: `zimScTab-${s.id}`, 'aria-controls': 'zimShowcasePanel', 'aria-selected': 'false', tabindex: '-1' } }, [
            el('span', { cls: 'zim-sc-tab-icon' }, icon(s.icon)),
            el('span', { cls: 'zim-sc-tab-text' }, [el('strong', { text: s.title }), el('small', { text: s.tag })]),
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

    const close = button('', 'fa-xmark', closeShowcase, 'zim-sc-close');
    close.setAttribute('aria-label', 'Rehberi kapat');
    close.title = 'Kapat (Esc)';

    const dialog = el('div', { cls: 'zim-sc-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'zimShowcaseTitle', 'aria-describedby': 'zimShowcaseDesc' } }, [
        el('header', { cls: 'zim-sc-topbar' }, [
            el('div', { cls: 'zim-sc-brand' }, [
                el('span', { cls: 'zim-sc-logo' }, icon('fa-id-badge')),
                el('div', {}, [
                    el('h2', { cls: 'zim-sc-heading', attrs: { id: 'zimShowcaseTitle' }, text: 'Zimmet ve İade Rehberi' }),
                    el('p', { cls: 'zim-sc-sub', attrs: { id: 'zimShowcaseDesc' }, text: 'Envanter çıkışı, talep onayı, zimmet ve iade süreçlerinin nasıl işlediğini örneklerle gösterir. Buradaki örnekler gerçek kayıtları değiştirmez.' }),
                ]),
            ]),
            close,
        ]),
        el('div', { cls: 'zim-sc-body' }, [el('nav', { cls: 'zim-sc-nav', attrs: { 'aria-label': 'Rehber bölümleri' } }, tabs), stage]),
    ]);

    const overlay = el('div', { cls: 'zim-sc-overlay', attrs: { id: 'zimShowcaseModal', hidden: '' } }, dialog);
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

export function openShowcase(sectionId = 'cikis') {
    if (!modal) modal = build();
    lastFocus = document.activeElement;
    modal._show(RENDERERS[sectionId] ? sectionId : 'cikis');
    modal.hidden = false;
    document.documentElement.classList.add('zim-sc-locked');
    requestAnimationFrame(() => { modal.classList.add('is-open'); modal._firstTab().focus(); });
}

export function closeShowcase() {
    if (!modal || modal.hidden) return;
    currentPanel?._cleanup?.();
    modal.classList.remove('is-open');
    document.documentElement.classList.remove('zim-sc-locked');
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
        if (modal.classList.contains('is-open')) return; // kapanış animasyonu sırasında yeniden açıldı
        modal.hidden = true;
        lastFocus?.focus?.();
    };
    if (reducedMotion()) finish(); else setTimeout(finish, 200);
}

document.querySelectorAll('[data-zim-showcase]').forEach(trigger => {
    trigger.addEventListener('click', () => openShowcase(trigger.dataset.zimShowcase || 'cikis'));
});

window.AppModules = window.AppModules || {};
window.AppModules.ZimShowcase = Object.freeze({ open: openShowcase, close: closeShowcase });
