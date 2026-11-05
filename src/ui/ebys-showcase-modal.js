// [WHY]: v3.4 EBYS (Aşama 1–6) yeniliklerini birim sorumlusu, imzacı ve personele uzun metin yerine görsel,
//        adım adım bir rehberle anlatmak. Veri okumaz/yazmaz; yalnız statik içerik ve yerel simülasyon içerir.
// [HOW]: Modal ilk açılışta kurulur. Tüm düğümler createElement + textContent ile üretilir (innerHTML yok).
//        Erişilebilirlik: role=dialog, dikey tablist (ok tuşları), Escape ile kapanma, odak hapsi ve odağın geri dönüşü.

const SECTIONS = [
    { id: 'books', icon: 'fa-book', title: 'Evrak Defterleri', tag: 'Aşama 4' },
    { id: 'sign', icon: 'fa-signature', title: 'İmza Süreci', tag: 'Aşama 5' },
    { id: 'execution', icon: 'fa-clipboard-check', title: 'İcra ve Kapanış', tag: 'Aşama 6' },
    { id: 'purchase', icon: 'fa-cart-shopping', title: 'Satın Alma', tag: 'Aşama 3' },
    { id: 'org', icon: 'fa-sitemap', title: 'Kurumsal Yapı', tag: 'Aşama 2' },
    { id: 'faq', icon: 'fa-circle-question', title: 'SSS', tag: 'Yardım' },
];

const BOOKS = [
    { id: 'incoming', icon: 'fa-inbox', title: 'Gelen Evrak', text: 'Kurum dışından gelen yazılar. Karşı kurumun evrak numarası ayrıca saklanır.' },
    { id: 'outgoing', icon: 'fa-paper-plane', title: 'Giden Evrak', text: 'Kurum dışına gönderilen resmi üst yazılar ve dağıtım listesi.' },
    { id: 'internal', icon: 'fa-arrows-rotate', title: 'İç Yazışma', text: 'Birimler arası yazışmalar; kurum içinde dolaşır, dışarı çıkmaz.' },
];

const BOOK_STEPS = [
    { icon: 'fa-pen', title: 'Taslak', text: 'Konu, muhatap ve metin yazılır. Taslak istenildiği kadar düzenlenebilir.' },
    { icon: 'fa-lock', title: 'Onaya sun / Dondur', text: 'Metin mühürlenir. Bu sürüm artık değiştirilemez; değişiklik yeni sürüm demektir.' },
    { icon: 'fa-stamp', title: 'Resmi kayıt', text: 'Evrak, kurum koduyla başlayan benzersiz kayıt numarasını alır ve defterde yerini bulur.' },
];

const CHAIN = [
    { kind: 'Paraf', who: 'Birim Sorumlusu', icon: 'fa-pen-nib' },
    { kind: 'Onay', who: 'Bölüm Müdürü', icon: 'fa-check-double' },
    { kind: 'Olur', who: 'Makam', icon: 'fa-landmark' },
];

const STEP_KINDS = [
    { tone: 'sky', icon: 'fa-pen-nib', title: 'Paraf', text: 'İnceleme imzası: "Metni gördüm, uygundur."' },
    { tone: 'indigo', icon: 'fa-check-double', title: 'Onay', text: 'Yetkili imzası; evrakı sorumluluk alarak onaylar.' },
    { tone: 'violet', icon: 'fa-landmark', title: 'Olur', text: 'Makam onayı; zincirin son ve en üst kararıdır.' },
];

const DECISIONS = [
    { tone: 'green', icon: 'fa-circle-check', title: 'Onayla', text: 'Evrak sıradaki imzacıya geçer. Son onayda icra işi açılır.' },
    { tone: 'amber', icon: 'fa-rotate-left', title: 'Yazara iade et', text: 'Gerekçe yazılması zorunludur; yazar düzeltip yeniden sunar.' },
    { tone: 'red', icon: 'fa-ban', title: 'Reddet', text: 'Gerekçeli red, bu sürümün onay sürecini kapatır. Yazar gerekçeyi görüp yeni sürüm hazırlayabilir.' },
];

const INVOICE = [
    { name: 'Dizüstü Bilgisayar', qty: 4, unit: 1250, cur: 'USD' },
    { name: 'Laboratuvar Mikroskobu', qty: 1, unit: 3400, cur: 'EUR' },
    { name: 'Kurulum Hizmeti', qty: 1, unit: 18000, cur: 'TRY' },
];
const FROZEN_RATES = { TRY: 1, USD: 34.2, EUR: 37.1 };

const ORG_TREE = { name: 'Medipol Üniversitesi', code: 'MED', children: [
    { name: 'Bilgi İşlem Daire Başkanlığı', code: 'BIDB', children: [{ name: 'Donanım Birimi', code: 'DON' }, { name: 'Ağ ve Sistem Birimi', code: 'AGS', passive: true }] },
    { name: 'Tıp Fakültesi', code: 'TIP', children: [{ name: 'Radyoloji', code: 'RAD' }] },
] };

const ORG_FACTS = [
    { tone: 'indigo', icon: 'fa-fingerprint', title: 'Kalıcı Personel ID', text: 'Ad, unvan ya da birim değişse de kimlik aynı kalır; geçmiş imzalar doğru kişiye bağlı kalır.' },
    { tone: 'sky', icon: 'fa-building', title: 'Kalıcı Birim ID', text: 'Birim adı değişse bile evraklar ve görevler aynı birime ait görünmeye devam eder.' },
    { tone: 'amber', icon: 'fa-toggle-off', title: 'Silme yerine pasifleştirme', text: 'Pasif birim ve personel yeni seçimlerde çıkmaz; eski kayıtlar bozulmadan okunur.' },
];

const FAQ = [
    ['Evrakı dondurduktan sonra yazım hatası fark ettim, ne yapmalıyım?', 'Dondurulan sürüm değişmez. İmzacılardan biri evrakı gerekçeyle yazara iade ettiğinde düzeltip yeni sürüm olarak yeniden sunabilirsiniz.'],
    ['Başkasına ait bir onay görevini neden göremiyorum?', 'Görevler kişiye özeldir. Sıra size gelmeden evrak listenizde görünmez; sıra geldiğinde "Bana Gelen Onaylar" ekranında açılır.'],
    ['İzne çıkacağım; bekleyen onaylarım ne olacak?', 'Yönetici bekleyen görevinizi en çok 90 gün için başka bir personele devredebilir. Kayıtta asıl görevli olarak adınız görünmeye devam eder.'],
    ['Dövizli talebin tutarı kur değişince değişir mi?', 'Hayır. Kur, talebin ilk onayında belgeye sabitlenir; sonraki kur güncellemeleri o talebin TL karşılığını etkilemez.'],
    ['Kayıt numarası neden bu kadar uzun?', 'Numara kurum kodu, kayıt günü ve tahmin edilemeyen benzersiz bir ekten oluşur; iki evrak asla aynı numarayı almaz.'],
    ['İade ile red arasındaki fark nedir?', 'Onay iadesi yazardan düzeltme ister. Red, mevcut sürümün onayını kapatır. Yazar iki kararı da Bana Gelen Onaylar → Geri dönen evraklarım bölümünde gerekçesiyle görür. İcra iadesi ise onaydan sonra işi yeniden havale için yönetime gönderir.'],
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
const badge = (text, tone = 'slate') => el('span', { cls: `ebys-sc-badge tone-${tone}`, text });
const button = (label, iconName, onClick, cls = 'ebys-sc-btn') => {
    const b = el('button', { cls, attrs: { type: 'button' } }, [iconName ? icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', onClick);
    return b;
};
const sectionHead = (eyebrow, title, lead) => el('header', { cls: 'ebys-sc-head' }, [
    el('span', { cls: 'ebys-sc-eyebrow', text: eyebrow }),
    el('h3', { cls: 'ebys-sc-title', text: title }),
    el('p', { cls: 'ebys-sc-lead', text: lead }),
]);
const miniCard = ({ tone, icon: ic, title, text }) => el('div', { cls: `ebys-sc-mini tone-${tone}` }, [
    el('span', { cls: 'ebys-sc-mini-icon' }, icon(ic)),
    el('div', {}, [el('strong', { text: title }), el('p', { text })]),
]);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── 1 · Evrak defterleri ──────────────────────────────────────────────────────────────────────────────────────
function renderBooks() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Aşama 4 · Evrak Kaydı', 'Üç defter, tek kayıt düzeni',
        'Her evrak doğru deftere yazılır, onaya sunulurken metni kilitlenir ve benzersiz bir resmi numara alır.'));

    const grid = el('div', { cls: 'ebys-sc-bento cols-3', attrs: { role: 'group', 'aria-label': 'Defter seçimi' } });
    const detail = el('p', { cls: 'ebys-sc-book-detail', attrs: { 'aria-live': 'polite' } });
    const cards = BOOKS.map(book => {
        const card = el('button', { cls: 'ebys-sc-book', attrs: { type: 'button', 'aria-pressed': 'false' } }, [
            el('span', { cls: 'ebys-sc-book-icon' }, icon(book.icon)),
            el('strong', { text: book.title }),
            el('span', { cls: 'ebys-sc-book-text', text: book.text }),
        ]);
        card.addEventListener('click', () => select(book.id));
        grid.append(card);
        return { book, card };
    });

    const flow = el('ol', { cls: 'ebys-sc-flow', attrs: { 'aria-label': 'Taslaktan resmi kayda' } });
    const stepNodes = BOOK_STEPS.map((s, i) => {
        const li = el('li', { cls: 'ebys-sc-flow-step' }, [
            el('span', { cls: 'ebys-sc-flow-dot' }, [icon(s.icon), el('span', { cls: 'ebys-sc-flow-num', text: i + 1 })]),
            el('div', { cls: 'ebys-sc-flow-body' }, [el('strong', { text: s.title }), el('p', { text: s.text })]),
        ]);
        flow.append(li);
        return li;
    });

    let timer = null;
    const setStage = stage => stepNodes.forEach((n, i) => {
        n.classList.toggle('is-done', i < stage);
        n.classList.toggle('is-active', i === stage);
    });
    const play = () => {
        clearTimeout(timer);
        if (reducedMotion()) { setStage(BOOK_STEPS.length - 1); return; }
        let stage = 0;
        const tick = () => { setStage(stage); if (stage++ < BOOK_STEPS.length - 1) timer = setTimeout(tick, 900); };
        tick();
    };
    function select(id) {
        cards.forEach(({ book, card }) => {
            const on = book.id === id;
            card.classList.toggle('is-selected', on);
            card.setAttribute('aria-pressed', String(on));
            if (on) detail.textContent = `${book.title} defteri seçildi: ${book.text}`;
        });
        play();
    }

    const number = el('div', { cls: 'ebys-sc-regno', attrs: { 'aria-label': 'Örnek kayıt numarası: EBYS-MED-261104 ve benzersiz ek' } }, [
        el('span', { cls: 'ebys-sc-regno-label', text: 'Örnek kayıt numarası' }),
        el('div', { cls: 'ebys-sc-regno-parts' }, [
            ['EBYS', 'Sistem'], ['MED', 'Kurum kodu'], ['261104', 'Kayıt günü (YYAAGG)'], ['9F3A…C21E', 'Benzersiz ek'],
        ].map(([v, l]) => el('span', { cls: 'ebys-sc-regno-part' }, [el('code', { text: v }), el('small', { text: l })]))),
    ]);

    root.append(grid, detail,
        el('div', { cls: 'ebys-sc-panel' }, [
            el('div', { cls: 'ebys-sc-panel-head' }, [el('strong', { text: 'Taslaktan resmi kayda' }), button('Akışı oynat', 'fa-play', play, 'ebys-sc-btn ghost')]),
            flow,
        ]),
        number);
    select('incoming');
    root._cleanup = () => clearTimeout(timer);
    return root;
}

// ─── 2 · İmza süreci ───────────────────────────────────────────────────────────────────────────────────────────
function renderSign() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Aşama 5 · Kişisel Görevler', 'Sırası gelen imzalar',
        'Evrak, tanımlı onay rotasında sırayla ilerler. Her imzacı görevini "Bana Gelen Onaylar" ekranında görür.'));

    const chain = el('ol', { cls: 'ebys-sc-chain', attrs: { 'aria-label': 'Örnek onay zinciri' } });
    const nodes = CHAIN.map(c => {
        const status = el('span', { cls: 'ebys-sc-chain-status' });
        const li = el('li', { cls: 'ebys-sc-chain-node' }, [
            el('span', { cls: 'ebys-sc-chain-icon' }, icon(c.icon)),
            el('strong', { text: c.kind }), el('small', { text: c.who }), status,
        ]);
        chain.append(li);
        return { li, status };
    });
    const live = el('p', { cls: 'ebys-sc-sim-log', attrs: { 'aria-live': 'polite' } });
    let step = 0, outcome = null;
    const paint = () => {
        nodes.forEach(({ li, status }, i) => {
            const done = i < step, active = i === step && !outcome, returned = outcome === 'returned' && i === step;
            li.className = 'ebys-sc-chain-node' + (done ? ' is-done' : '') + (active ? ' is-active' : '') + (returned ? ' is-returned' : '');
            status.textContent = done ? 'İmzalandı' : returned ? 'İade etti' : active ? 'Sırada' : 'Görmüyor';
        });
        if (outcome === 'returned') live.textContent = `${CHAIN[step].who} evrakı gerekçesiyle yazara iade etti. Yazar düzeltip yeniden sunar.`;
        else if (step >= CHAIN.length) live.textContent = 'Kurum içi onay tamamlandı. Evrakın kapatılması için icra sorumlusuna iş açılır.';
        else live.textContent = `Görev şu an yalnız ${CHAIN[step].who} için açık. Sonraki imzacılar evrakı henüz göremez.`;
        approve.disabled = step >= CHAIN.length || !!outcome;
        ret.disabled = step >= CHAIN.length || !!outcome;
    };
    const approve = button('Onayla', 'fa-circle-check', () => { step++; paint(); }, 'ebys-sc-btn primary');
    const ret = button('İade et', 'fa-rotate-left', () => { outcome = 'returned'; paint(); }, 'ebys-sc-btn warn');
    const reset = button('Baştan başlat', 'fa-arrow-rotate-right', () => { step = 0; outcome = null; paint(); }, 'ebys-sc-btn ghost');

    root.append(
        el('div', { cls: 'ebys-sc-panel' }, [
            el('div', { cls: 'ebys-sc-panel-head' }, [el('strong', { text: 'Onay zinciri simülasyonu' }), badge('Örnek', 'slate')]),
            chain, live, el('div', { cls: 'ebys-sc-actions' }, [approve, ret, reset]),
        ]),
        el('h4', { cls: 'ebys-sc-subtitle', text: 'Adım türleri' }),
        el('div', { cls: 'ebys-sc-bento cols-3' }, STEP_KINDS.map(miniCard)),
        el('h4', { cls: 'ebys-sc-subtitle', text: 'Kararınız' }),
        el('div', { cls: 'ebys-sc-bento cols-3' }, DECISIONS.map(miniCard)),
        el('div', { cls: 'ebys-sc-bento cols-2' }, [
            el('div', { cls: 'ebys-sc-feature' }, [
                badge('Kişisel gizlilik', 'indigo'),
                el('strong', { text: 'Sıranız gelmeden kimse görmez' }),
                el('p', { text: 'Görev yalnız sırası gelen kişiye açılır. Sonraki imzacılar, önceki adım tamamlanana kadar evrakı listelerinde görmez.' }),
            ]),
            el('div', { cls: 'ebys-sc-feature' }, [
                badge('Süreli vekâlet', 'amber'),
                el('strong', { text: 'İzindeyken işler durmaz' }),
                el('p', { text: 'Yönetici bekleyen görevi bitiş tarihiyle (en çok 90 gün) başka bir personele devreder. Asıl görevlinin adı kayıtta kalır.' }),
            ]),
        ]));
    paint();
    return root;
}

// ─── 3 · Satın alma ────────────────────────────────────────────────────────────────────────────────────────────
function renderPurchase() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Aşama 3 · Kalemli Talep', 'Bir talep, birden çok kalem',
        'Mal ve hizmetler tek talepte toplanır. TRY, USD ve EUR kalemler yan yana durur; kur ilk onayda sabitlenir.'));

    const fmt = (v, cur) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v);
    const frozenTotal = INVOICE.reduce((s, r) => s + r.qty * r.unit * FROZEN_RATES[r.cur], 0);
    let current = { ...FROZEN_RATES };

    const rows = el('tbody');
    INVOICE.forEach(r => rows.append(el('tr', {}, [
        el('td', { text: r.name }), el('td', { cls: 'num', text: r.qty }),
        el('td', { cls: 'num', text: fmt(r.unit, r.cur) }), el('td', {}, badge(r.cur, r.cur === 'TRY' ? 'slate' : 'sky')),
        el('td', { cls: 'num', text: fmt(r.qty * r.unit * FROZEN_RATES[r.cur], 'TRY') }),
    ])));
    const invoice = el('div', { cls: 'ebys-sc-invoice' }, [
        el('div', { cls: 'ebys-sc-invoice-head' }, [
            el('div', {}, [el('small', { text: 'Satın alma talebi' }), el('strong', { text: 'Bilgi İşlem · 3 kalem' })]),
            el('span', { cls: 'ebys-sc-stamp', attrs: { title: 'Kur ilk onayda sabitlendi' } }, [icon('fa-snowflake'), el('span', { text: 'KUR DONDURULDU' })]),
        ]),
        el('div', { cls: 'ebys-sc-table-wrap' }, el('table', { cls: 'ebys-sc-table' }, [
            el('thead', {}, el('tr', {}, ['Kalem', 'Adet', 'Birim fiyat', 'Para', 'TL karşılığı']
                .map((t, i) => el('th', { cls: i === 1 || i === 2 || i === 4 ? 'num' : '', text: t })))),
            rows,
        ])),
        el('div', { cls: 'ebys-sc-invoice-foot' }, [el('span', { text: 'Belgedeki toplam' }), el('strong', { text: fmt(frozenTotal, 'TRY') })]),
    ]);

    const rateRow = cur => {
        const val = el('strong', { text: fmt(FROZEN_RATES[cur], 'TRY') });
        const now = el('span', { cls: 'ebys-sc-rate-now', text: `Güncel: ${fmt(FROZEN_RATES[cur], 'TRY')}` });
        return { cur, node: el('div', { cls: 'ebys-sc-rate' }, [badge(cur, 'sky'), el('div', {}, [el('small', { text: 'Sabitlenen kur' }), val]), now]), now };
    };
    const rates = ['USD', 'EUR'].map(rateRow);
    const live = el('p', { cls: 'ebys-sc-sim-log', attrs: { 'aria-live': 'polite' }, text: 'Kur değişse bile bu talebin TL toplamı aynı kalır.' });
    const bump = button('Kur güncellemesini simüle et', 'fa-chart-line', () => {
        current = { ...current, USD: +(current.USD * 1.035).toFixed(2), EUR: +(current.EUR * 1.028).toFixed(2) };
        rates.forEach(r => { r.now.textContent = `Güncel: ${fmt(current[r.cur], 'TRY')}`; r.now.classList.add('is-changed'); });
        const liveTotal = INVOICE.reduce((s, r) => s + r.qty * r.unit * current[r.cur], 0);
        live.textContent = `Güncel kurla toplam ${fmt(liveTotal, 'TRY')} olurdu; belgede ${fmt(frozenTotal, 'TRY')} olarak kalır.`;
    }, 'ebys-sc-btn ghost');

    root.append(
        el('div', { cls: 'ebys-sc-bento cols-split' }, [
            invoice,
            el('div', { cls: 'ebys-sc-panel' }, [
                el('div', { cls: 'ebys-sc-panel-head' }, [el('strong', { text: 'Kur sabitleme' }), badge('İlk onay anı', 'indigo')]),
                ...rates.map(r => r.node), live, bump,
            ]),
        ]),
        el('div', { cls: 'ebys-sc-bento cols-3' }, [
            miniCard({ tone: 'sky', icon: 'fa-list-check', title: 'Çok kalemli', text: 'Her kalemin adedi, birim fiyatı ve para birimi ayrı tutulur.' }),
            miniCard({ tone: 'indigo', icon: 'fa-coins', title: 'TRY · USD · EUR', text: 'Dövizli kalemler, yönetimin tanımladığı kurla TL\'ye çevrilir.' }),
            miniCard({ tone: 'green', icon: 'fa-snowflake', title: 'Kur dondurma', text: 'İlk onaydan sonra raporlar hep aynı TL tutarını gösterir.' }),
        ]));
    return root;
}

// ─── 4 · Kurumsal yapı ─────────────────────────────────────────────────────────────────────────────────────────
function renderOrg() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Aşama 2 · Tanımlar', 'Kurumsal hiyerarşi ve rolünüz',
        'Birimler üst birime bağlı bir ağaç oluşturur. Onay rotaları ve evrak sahipliği bu yapıya göre çalışır.'));
    const branch = node => el('li', { cls: node.passive ? 'is-passive' : '' }, [
        el('span', { cls: 'ebys-sc-tree-node' }, [
            icon(node.children ? 'fa-building' : 'fa-users'), el('span', { text: node.name }),
            el('code', { text: node.code }), node.passive ? badge('Pasif', 'amber') : null,
        ]),
        node.children ? el('ul', {}, node.children.map(branch)) : null,
    ]);
    root.append(
        el('div', { cls: 'ebys-sc-panel' }, [
            el('div', { cls: 'ebys-sc-panel-head' }, [el('strong', { text: 'Örnek birim ağacı' }), badge('Örnek', 'slate')]),
            el('ul', { cls: 'ebys-sc-tree', attrs: { 'aria-label': 'Örnek birim hiyerarşisi' } }, branch(ORG_TREE)),
        ]),
        el('div', { cls: 'ebys-sc-bento cols-3' }, ORG_FACTS.map(miniCard)));
    return root;
}

function renderExecution() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Aşama 6 · İcra ve Kapanış', 'Son onaydan evrakın kapanışına',
        'Son onay evrakı sorumluya havale eder. İşin kabulü, uygulanması ve kanıtla tamamlanması ayrı adımlardır.'));

    const cards = document.getElementById('ebysExecutionAdmin') ? [
        { tone: 'indigo', icon: 'fa-sitemap', title: 'Havale tanımını hazırlayın',
            text: 'Talep ve Süreçler → İcra Takibi → Havale tanımları. Önce evrak türü ve evrakın bağlı birimi birlikte aranır. Özel tanım yoksa kaydettiğiniz tür varsayılanı kullanılır. Geçerli bir sorumlu bulunamazsa son onay bekler.' },
        { tone: 'amber', icon: 'fa-rotate-left', title: 'İadeyi yeniden havale edin',
            text: 'Havale Bekleyen İadeler bölümünde gerekçeyi, ilk hedefi ve yönetimde geçen süreyi görün. Yeniden havale, sorumluya ayrı bir hedef verir.' },
        { tone: 'sky', icon: 'fa-link', title: 'Stok işlemini doğrulayın',
            text: 'İcra işi detayından defterdeki mevcut stok hareketini inceleyip gerekçeyle bu işe bağlayın. Stok hareketi depo işlemiyle kaydedilir.' },
        { tone: 'green', icon: 'fa-box-archive', title: 'Kapanışı ve yedeği izleyin',
            text: 'Tamamlanan evrakı İcra Takibi üzerinden arşivleyin. Evraklarımı yedekle, yetkili icra kayıtlarını ve bunların kapsam bilgisini dosyaya ekler.' },
    ] : [
        { tone: 'indigo', icon: 'fa-clipboard-check', title: 'Size atanan işi kabul edin',
            text: 'Görevlerim → İcra İşlerim bölümünde evrakın onaylanmış sürümünü açın ve Kabul Et seçeneğini kullanın.' },
        { tone: 'green', icon: 'fa-circle-check', title: 'Sonucu ve kanıtı kaydedin',
            text: 'İşlem sonucunu ve tutanak gibi bir kanıt referansını girip Tamamla seçeneğini kullanın. Stok referansı gerekiyorsa yönetimin bu işe bağladığı hareket numarasını girin.' },
        { tone: 'amber', icon: 'fa-rotate-left', title: 'Gerekçeyle iade edin',
            text: 'İşi yürütemiyorsanız gerekçeyle iade edin. Yönetici işi yeniden havale etmek üzere İcra Takibi ekranında görür.' },
        { tone: 'sky', icon: 'fa-bell', title: 'Evrakın kapanışını görün',
            text: 'Evrak sahibi, iş tamamlandığında Görevlerim → Evrak Bildirimlerim bölümünde kapanış bildirimini görür.' },
    ];
    root.append(el('div', { cls: 'ebys-sc-bento cols-2' }, cards.map(miniCard)));
    return root;
}

// ─── 5 · SSS ───────────────────────────────────────────────────────────────────────────────────────────────────
function renderFaq() {
    const root = el('div', { cls: 'ebys-sc-section' });
    root.append(sectionHead('Sık sorulanlar', 'Kısa cevaplar', 'En çok merak edilen konular. Başlığa dokunarak cevabı açın.'));
    root.append(el('div', { cls: 'ebys-sc-faq' }, FAQ.map(([q, a]) => el('details', { cls: 'ebys-sc-faq-item' }, [
        el('summary', {}, [el('span', { text: q }), icon('fa-chevron-down')]), el('p', { text: a }),
    ]))));
    return root;
}

const RENDERERS = { books: renderBooks, sign: renderSign, execution: renderExecution, purchase: renderPurchase, org: renderOrg, faq: renderFaq };

// ─── Modal kabuğu ──────────────────────────────────────────────────────────────────────────────────────────────
let modal = null, lastFocus = null, currentPanel = null;

function build() {
    const tabs = el('div', { cls: 'ebys-sc-tabs', attrs: { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Rehber bölümleri' } });
    const stage = el('div', { cls: 'ebys-sc-stage', attrs: { role: 'tabpanel', id: 'ebysShowcasePanel', tabindex: '0' } });
    const tabButtons = SECTIONS.map((s, i) => {
        const b = el('button', { cls: 'ebys-sc-tab', attrs: { type: 'button', role: 'tab', id: `ebysScTab-${s.id}`, 'aria-controls': 'ebysShowcasePanel', 'aria-selected': 'false', tabindex: '-1' } }, [
            el('span', { cls: 'ebys-sc-tab-icon' }, icon(s.icon)),
            el('span', { cls: 'ebys-sc-tab-text' }, [el('strong', { text: s.title }), el('small', { text: s.tag })]),
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

    const close = button('', 'fa-xmark', closeShowcase, 'ebys-sc-close');
    close.setAttribute('aria-label', 'Rehberi kapat');
    close.title = 'Kapat (Esc)';

    const dialog = el('div', { cls: 'ebys-sc-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ebysShowcaseTitle', 'aria-describedby': 'ebysShowcaseDesc' } }, [
        el('header', { cls: 'ebys-sc-topbar' }, [
            el('div', { cls: 'ebys-sc-brand' }, [
                el('span', { cls: 'ebys-sc-logo' }, icon('fa-wand-magic-sparkles')),
                el('div', {}, [
                    el('h2', { cls: 'ebys-sc-heading', text: 'EBYS Rehberi', attrs: { id: 'ebysShowcaseTitle' } }),
                    el('p', { cls: 'ebys-sc-sub', text: 'Evrak, imza, icra ve satın alma süreçlerinin nasıl işlediğini örneklerle gösterir. Buradaki örnekler gerçek kayıtları değiştirmez.', attrs: { id: 'ebysShowcaseDesc' } }),
                ]),
            ]),
            badge('v3.4', 'indigo'), close,
        ]),
        el('div', { cls: 'ebys-sc-body' }, [el('nav', { cls: 'ebys-sc-nav', attrs: { 'aria-label': 'Rehber bölümleri' } }, tabs), stage]),
    ]);

    const overlay = el('div', { cls: 'ebys-sc-overlay', attrs: { id: 'ebysShowcaseModal', hidden: '' } }, dialog);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeShowcase(); });
    overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); closeShowcase(); return; }
        if (e.key !== 'Tab') return;
        const focusable = [...dialog.querySelectorAll('button:not([disabled]), summary, [tabindex="0"], a[href]')].filter(n => n.offsetParent !== null);
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

export function openShowcase(sectionId = 'books') {
    if (!modal) modal = build();
    lastFocus = document.activeElement;
    modal._show(RENDERERS[sectionId] ? sectionId : 'books');
    modal.hidden = false;
    document.documentElement.classList.add('ebys-sc-locked');
    requestAnimationFrame(() => { modal.classList.add('is-open'); modal._firstTab().focus(); });
}

export function closeShowcase() {
    if (!modal || modal.hidden) return;
    currentPanel?._cleanup?.();
    modal.classList.remove('is-open');
    document.documentElement.classList.remove('ebys-sc-locked');
    const finish = () => {
        if (modal.classList.contains('is-open')) return; // kapanış animasyonu sırasında yeniden açıldı
        modal.hidden = true;
        lastFocus?.focus?.();
    };
    if (reducedMotion()) finish(); else setTimeout(finish, 200);
}

document.querySelectorAll('[data-ebys-showcase]').forEach(trigger => {
    trigger.addEventListener('click', () => openShowcase(trigger.dataset.ebysShowcase || 'books'));
});

window.AppModules = window.AppModules || {};
window.AppModules.EBYSShowcase = Object.freeze({ open: openShowcase, close: closeShowcase });
