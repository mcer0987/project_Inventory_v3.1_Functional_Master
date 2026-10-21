/**
 * SİSTEM KILAVUZU — v3.2
 * PO, denetmen ve projeye yeni katılan geliştiriciler için kategorilere ayrılmış,
 * kademeli açılır (progressive disclosure) rehber. "Teknik Referans" kartları
 * (tech:true) varsayılan kapalıdır; iş akışına yönelik kartlar öne çıkar.
 */

const sitemapCategories = [
    {
        id: 'quickstart',
        title: 'Hızlı Başlangıç & PO Özeti',
        icon: 'fa-rocket',
        color: '#60a5fa',
        modules: [
            {
                title: '🪪 Kurumsal Kimlik (PRI) ile Giriş',
                icon: 'fa-id-badge',
                color: '#60a5fa',
                open: true,
                description: 'Personel artık 5 haneli eski koda değil, "ad.soyad" formatındaki kurumsal kimliğine (PRI) dayalı bir oturum sistemine sahiptir.',
                functions: [
                    { name: 'Veritabanı Sorgusuz (Zero-Lookup) Giriş', desc: 'PRI ve kod doğrudan kimlik doğrulama servisine gönderilir; giriş anında personel kaydı aranmaz. Eşleme, girişten SONRA arka planda yapılır.' },
                    { name: 'Türkçe Karakter Normalizasyonu', desc: '"Çağla.Öztürk" gibi girişler otomatik olarak "cagla.ozturk" biçimine çevrilir; büyük/küçük harf ve Türkçe karakter farkı girişi engellemez.' },
                    { name: 'F5 / Sayfa Yenileme Koruması', desc: 'Oturum, sayfa yenilense dahi korunur. Personel yeniden kod girmek zorunda kalmaz; buna karşın oturum her seferinde güncel personel kaydıyla yeniden doğrulanır.' },
                    { name: 'Ortak Cihazlarda Güvenli Çıkış', desc: 'Giriş alanları başarılı girişten hemen sonra temizlenir; ortak bilgisayarda bir sonraki kullanıcı önceki kimliği göremez. Çıkışta tek ve denetlenebilir bir oturum sonlandırma zinciri çalışır.' },
                    { name: 'Belirsiz Hata Mesajı', desc: 'Yanlış kod ile var olmayan bir kimlik aynı genel hata mesajını üretir; hangi kimliklerin sistemde kayıtlı olduğu dışarıya sızdırılmaz.' }
                ]
            },
            {
                title: '🧭 Panel Yapısı',
                icon: 'fa-compass',
                color: '#818cf8',
                description: 'Personel ekranı günlük işlemler, Admin Paneli ise yönetim, onay ve denetim araçları içindir.',
                functions: [
                    { name: 'Personel Ekranı', desc: 'Talep oluşturma, kişisel zimmet envanteri, görevler ve onay bekleyen işlemler buradan yürütülür.' },
                    { name: 'Admin Paneli', desc: 'Depo yönetimi, personel/birim tanımları, onay şablonları, satın alma ve VIP Operasyon Merkezi buradadır.' },
                    { name: 'Rol Bazlı Görünürlük', desc: 'Menü ve butonlar, oturum açan kişinin rolüne göre otomatik olarak gösterilir veya gizlenir.' }
                ]
            },
            {
                title: '🔧 Teknik Referans — Kimlik & Oturum',
                icon: 'fa-code',
                color: '#475569',
                tech: true,
                description: 'Geliştiriciler için: kimlik doğrulama akışının güncel dosya haritası.',
                functions: [
                    { name: 'src/modules/auth-engine.js', desc: 'handleLogin(), checkAuth(), checkIsAdmin(), handleLogout() — personel ve admin giriş/çıkış akışının tamamı.' },
                    { name: 'src/services/staff-provisioning.js', desc: 'PRI üretimi (generateStaffPri), normalizePri(), isValidPri(); kimlik sağlayıcıda hesap oluşturma.' },
                    { name: 'security.js', desc: 'SecurityConfig.authenticate() — admin girişi (≥12 karakter parola) ve tek oturum sonlandırma zinciri (endAdminSession).' },
                    { name: 'src/utils/session-store.js', desc: 'Admin "vize" süresi yönetimi (varsayılan 10 dk), hasValidAdminVisa(), isDbAdmin().' }
                ]
            }
        ]
    },
    {
        id: 'inventory',
        title: 'Depo & Envanter',
        icon: 'fa-warehouse',
        color: '#22c55e',
        modules: [
            {
                title: '🏬 B1 / B2 Depo Mantığı',
                icon: 'fa-boxes-stacked',
                color: '#22c55e',
                open: true,
                description: 'B1 ve B2, birbirinden bağımsız iki depo konumudur; her ikisi de hem Sarf hem Demirbaş ürün barındırabilir.',
                functions: [
                    { name: 'Sarf (B1 tipi) vs Demirbaş Ayrımı', desc: 'Bir ürünün Sarf mı Demirbaş mı olduğu, ürün türü tanımındaki tek bir özellikle belirlenir — hangi depoda durduğuyla karışmaz.' },
                    { name: 'İç Transfer (B1 ↔ B2)', desc: 'Depolar arası taşıma yalnızca bir konum değişikliğidir, kişiye zimmet anlamına gelmez; ayrı bir kimlik veya imza gerektirmez.' }
                ]
            },
            {
                title: '✂️ Kısmi Sevk (Seçilen Adedin Transferi)',
                icon: 'fa-scissors',
                color: '#16a34a',
                description: 'Talep edilen miktarın tamamı yerine, yalnızca seçilen adet gönderilebilir.',
                functions: [
                    { name: 'Seçilen Adet Kadar Çıkış', desc: 'Stoktaki toplam miktarın bir kısmı hedefe taşınır veya sevk edilir; kalan miktar kaynakta durmaya devam eder.' },
                    { name: 'Demirbaşta Cihaz Kimliği Zorunluluğu', desc: 'Demirbaş kalemlerde sevk edilen her birim için seri no / envanter no istenir; Sarf kalemlerde yalnızca adet yeterlidir.' },
                    { name: 'Atomik İşlem', desc: 'Stok düşümü ve hedef kayıt oluşturma tek bir işlemde yürütülür; yarım kalan transfer oluşmaz.' }
                ]
            },
            {
                title: '♻️ Hurdaya Ayırma (Scrap)',
                icon: 'fa-recycle',
                color: '#ef4444',
                description: 'Kullanım ömrünü tamamlamış ürünler geri alınamaz şekilde hurdaya ayrılır ve cihaz geçmişine işlenir.',
                functions: [
                    { name: 'Sadece Yönetici Yetkisi', desc: 'Hurdaya ayırma yalnızca sistem yöneticisi tarafından başlatılabilir; onaydan önce geri alınamaz işlem uyarısı gösterilir.' },
                    { name: 'Cihaz Geçmişine Otomatik İşleme', desc: 'İşlem tamamlandığında cihazın geçmişine "♻️ Hurdaya Ayrıldı" durumu ve tarihi otomatik eklenir; açık servis kaydı varsa aynı anda kapatılır.' },
                    { name: 'Atomik ve Geri Dönüşsüz', desc: 'Stok düşümü, hurda kaydı ve servis kaydı kapanışı tek işlemde yürütülür; hata durumunda ürün olduğu yerde bırakılır.' }
                ]
            },
            {
                title: '🔧 Teknik Referans — Envanter',
                icon: 'fa-code',
                color: '#475569',
                tech: true,
                description: 'Geliştiriciler için: depo/transfer mantığının güncel dosya haritası.',
                functions: [
                    { name: 'src/ui/ui-components.js — confirmTransfer()', desc: 'İç transfer, dış sevk ve hurdaya ayırma dallarının tamamı; tek fonksiyon, işlem tipine göre dallanır.' },
                    { name: 'src/utils/schema.js — isDemirbas()', desc: 'Sarf/Demirbaş tek kaynaklı kural: ürün türü tanımı → kalemin kendi alanı → isim eşleşmesi (son çare).' },
                    { name: 'src/services/assignment-service.js — getDeviceHistory()', desc: 'Zimmet, çıkış ve hurda kayıtlarından cihazın birleşik geçmiş zaman çizelgesini üretir.' },
                    { name: 'src/modules/admin/inventory-management.js', desc: 'Envanter sekmesinin CRUD işlemleri ve Excel içe aktarma.' }
                ]
            }
        ]
    },
    {
        id: 'zimmet',
        title: 'Zimmet & Tutanak',
        icon: 'fa-file-signature',
        color: '#f59e0b',
        modules: [
            {
                title: '📄 Resmi Zimmet Teslim-Tesellüm Tutanağı',
                icon: 'fa-file-pdf',
                color: '#f59e0b',
                open: true,
                description: 'Her personel için, kendisine zimmetli tüm ürünleri listeleyen resmi bir A4 PDF belge üretilir.',
                functions: [
                    { name: 'Türkçe Karakter Garantisi', desc: 'Belge, ş/ğ/ı/ö/ü/ç karakterlerini tam destekleyen gömülü bir yazı tipiyle oluşturulur; karakter bozulması yaşanmaz.' },
                    { name: 'Gerçek Teslim Eden İmzası', desc: '"Teslim Eden" alanı, o anda oturum açan kişi değil, kaydın gerçek tarihsel onaylayıcısı/zimmetleyeni esas alınarak doldurulur.' },
                    { name: 'Deterministik Belge Numarası', desc: 'Aynı kişi ve aynı kalemler için aynı gün yeniden alınan belge, aynı belge numarasını üretir.' },
                    { name: 'Hassas Veri Hariç Tutma', desc: 'Personelin oturum açma kodu hiçbir koşulda tutanak belgesine dahil edilmez.' }
                ]
            },
            {
                title: '🔧 Teknik Referans — Zimmet/PDF',
                icon: 'fa-code',
                color: '#475569',
                tech: true,
                description: 'Geliştiriciler için: belge üretim katmanının güncel dosya haritası.',
                functions: [
                    { name: 'pdf-generator.js', desc: 'Salt görsel katman — jsPDF + jspdf-autotable, gömülü Roboto fontu (ensureZimmetFonts), imza bloğu çizimi.' },
                    { name: 'src/services/assignment-service.js', desc: 'generatePersonnelZimmetData(), issuerOf() — gerçek zimmetleyen/onaylayan kişiyi geçmiş kayıttan çözümler.' }
                ]
            }
        ]
    },
    {
        id: 'approvals',
        title: 'Onay Süreçleri',
        icon: 'fa-stamp',
        color: '#8b5cf6',
        modules: [
            {
                title: '🔗 Sıralı Onay Akışı (EBYS)',
                icon: 'fa-list-ol',
                color: '#8b5cf6',
                open: true,
                description: 'Satın alma ve talep süreçleri, önceden tanımlanmış sabit bir onay sırasıyla ilerler; adım atlanamaz.',
                functions: [
                    { name: 'Adım Adım İlerleme', desc: 'Başlangıç → Yönetici Onayı → İK Onayı → Mali Onay → Direktör Onayı → Tamamlandı. Bir adım, yalnızca kendinden önceki adım tamamlandıysa açılır.' },
                    { name: 'Kimlik Bazlı Yetki', desc: 'Bir adımı yalnızca o adıma atanmış kişi (sistemdeki benzersiz kimliğiyle) veya yönetici onaylayabilir — isim benzerliğiyle değil.' }
                ]
            },
            {
                title: '🚫 Kendi Talebini Onaylayamama',
                icon: 'fa-ban',
                color: '#dc2626',
                description: 'Hiç kimse kendi oluşturduğu talebi veya satın alma kaydını onaylayarak süreci kısayoldan geçiremez.',
                functions: [
                    { name: 'Personel için Doğrudan Engel', desc: 'Bir personel kendi talebini onaylamaya çalışırsa işlem anında reddedilir ve "engellendi" olarak denetim kaydına düşer.' },
                    { name: 'Admin için Ek Kimlik Doğrulama', desc: 'Yönetici kendi oluşturduğu bir kaydı onaylamak isterse, devam edebilmek için parolasını yeniden girerek kimliğini doğrulamak zorundadır (en fazla 3 deneme).' },
                    { name: 'Her Sonuç Kayıt Altında', desc: 'Engellenen, iptal edilen ve onaylanan her self-approval girişimi ayrı ayrı denetim kaydına yazılır.' }
                ]
            },
            {
                title: '🔒 Değiştirilemez Denetim Kayıtları (auditLogs)',
                icon: 'fa-lock',
                color: '#7c3aed',
                description: 'Kritik güvenlik olayları, hiçbir kullanıcı veya yönetici tarafından sonradan değiştirilemeyen bir deftere yazılır.',
                functions: [
                    { name: 'Sadece Ekleme', desc: 'Denetim kayıtları yalnızca oluşturulabilir; güncelleme ve silme, yöneticiler dahil herkese kapalıdır.' },
                    { name: 'Sunucu Tarafı Zorunluluk', desc: 'Bu kısıtlama istemci kodunun tercihi değil, veritabanı güvenlik kurallarıyla sunucu seviyesinde garanti altındadır.' }
                ]
            },
            {
                title: '🔧 Teknik Referans — Onay & Denetim',
                icon: 'fa-code',
                color: '#475569',
                tech: true,
                description: 'Geliştiriciler için: onay motoru ve denetim kaydı katmanının güncel dosya haritası.',
                functions: [
                    { name: 'src/modules/edm-workflow.js — approveStep()', desc: 'Sabit durum makinesi (WorkflowEngine.states), adım bazlı yetki kontrolü (_canActOnCurrentStep).' },
                    { name: 'security.js — guardSelfApproval() / promptAdminReauth()', desc: 'Self-approval tespiti ve admin yeniden kimlik doğrulama modalı.' },
                    { name: 'src/utils/schema.js — isSelfApproval()', desc: 'uid/id/kod/isim eşleşmesiyle kendi kaydını onaylama tespiti.' },
                    { name: 'src/services/firebase-handler.js — appendAuditLog()', desc: 'auditLogs koleksiyonuna yalnızca yeni doküman ekler; güncelleme yolu kodda yoktur.' },
                    { name: 'firestore.rules — auditLogs', desc: '"allow update, delete: if false" — sunucu tarafı değiştirilemezlik garantisi.' }
                ]
            }
        ]
    },
    {
        id: 'security-vip',
        title: 'Güvenlik & VIP',
        icon: 'fa-shield-halved',
        color: '#06b6d4',
        modules: [
            {
                title: '🛡️ Oturum Güvenliği',
                icon: 'fa-user-shield',
                color: '#06b6d4',
                open: true,
                description: 'Admin oturumları zaman sınırlı bir "vize" ile korunur; personel oturumları her sayfa yüklemesinde canlı kayıtla yeniden doğrulanır.',
                functions: [
                    { name: 'Admin Oturum Süresi', desc: 'Admin oturumu varsayılan olarak 10 dakika sonra vizesini yitirir; süresi dolan oturum otomatik sonlandırılır.' },
                    { name: 'Tek Çıkış Zinciri', desc: 'Çıkış işlemi; dinleyicileri durdurma, oturumu kapatma ve arayüzü sıfırlama adımlarını tek ve tutarlı bir sırayla yürütür.' }
                ]
            },
            {
                title: '🌌 VIP Operasyon Merkezi',
                icon: 'fa-terminal',
                color: '#00c2a8',
                description: 'Yöneticiye sistemin anlık sağlığını ve geçmiş olaylarını gösteren canlı kontrol merkezi.',
                functions: [
                    { name: 'Sistem Sağlık Monitörü', desc: 'Çalışma süresi, bellek/ağ durumu, veri boyutu ve arayüz performansı canlı izlenir; sekme arka plandayken kaynak tüketmez.' },
                    { name: 'Konsol ve Hata Yakalama', desc: 'Uygulama içi hatalar ve uyarılar canlı bir terminal akışında yöneticiye gösterilir.' },
                    { name: 'Operasyon Raporu', desc: 'Toplam ürün, stok, çıkış, bekleyen talep ve kritik stok sayıları tek bakışta özetlenir.' }
                ]
            },
            {
                title: '🧹 Güvenli Tekerrür Temizleme',
                icon: 'fa-broom',
                color: '#0891b2',
                description: 'Depo kayıtlarındaki kazara oluşmuş kopyaları, hareket geçmişine dokunmadan temizler.',
                functions: [
                    { name: 'Kapsam Sadece B1/B2', desc: 'Temizleme yalnızca depo stok tablolarını kapsar; zimmet/hareket geçmişi bilerek kapsam dışıdır — aktif bir zimmet kaydı yanlışlıkla silinemez.' },
                    { name: 'Önizle, Onayla, Yeniden Doğrula', desc: 'Silinecek kayıtlar önce önizlenir; onay sonrası liste canlı veriyle yeniden kontrol edilip yalnızca hâlâ kopya olan kayıtlar silinir.' }
                ]
            },
            {
                title: '💾 Ortam Korumalı Birleşik Yedekleme',
                icon: 'fa-database',
                color: '#0e7490',
                description: 'Tüm yedekleme/geri yükleme işlemleri tek bir güvenli servis üzerinden yürütülür.',
                functions: [
                    { name: 'Ortam Kontrolü', desc: 'Bir ortamdan alınan yedek, farklı bir ortama geri yüklenmek istendiğinde işlem otomatik olarak engellenir.' },
                    { name: 'Geri Yükleme Öncesi Önizleme', desc: 'Geri yükleme onaylanmadan önce hangi kayıtların ekleneceği/değişeceği özetlenir.' },
                    { name: 'Tüm ya da Hiç', desc: 'Geri yükleme tek seferde ya tamamen uygulanır ya da başarısız olursa iptal edilir. Denetim kayıtları yedek/geri yüklemeye asla dahil edilmez.' }
                ]
            },
            {
                title: '🔧 Teknik Referans — VIP & Güvenlik',
                icon: 'fa-code',
                color: '#475569',
                tech: true,
                description: 'Geliştiriciler için: operasyon merkezi ve yedekleme katmanının güncel dosya haritası.',
                functions: [
                    { name: 'src/modules/admin/admin-system-control.js', desc: 'Sağlık monitörü, konsol yakalayıcı, tekerrür temizleme (vipCleanDuplicates), sürükle-bırak widget düzeni.' },
                    { name: 'src/modules/admin/admin-backup.js — BackupService', desc: 'Kanonik yedek formatı (v3.2), ortam (root) kontrolü, diff önizleme, auditLogs hariç tutma.' },
                    { name: 'src/services/atomic-writer.js', desc: 'restoreCollections() — tüm-ya-da-hiç geri yükleme ve başarısızlıkta geri alma.' },
                    { name: 'src/utils/session-store.js / security.js', desc: 'Admin vize yönetimi ve tek çıkış zinciri (endAdminSession).' }
                ]
            }
        ]
    }
];

let _sitemapActiveCategory = sitemapCategories[0].id;

function _renderSitemapNav() {
    const nav = document.getElementById('sitemapNav');
    if (!nav) return;

    let html = '';
    sitemapCategories.forEach(cat => {
        const active = cat.id === _sitemapActiveCategory;
        html += `
            <button type="button" data-action="sitemapSwitchCategory" data-cat="${escapeHtml(cat.id)}" style="
                display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
                background: ${active ? 'rgba(255,255,255,0.08)' : 'transparent'};
                border: none; border-left: 3px solid ${active ? escapeHtml(cat.color) : 'transparent'};
                color: ${active ? escapeHtml(cat.color) : '#94a3b8'};
                padding: 12px 14px; margin-bottom: 4px; border-radius: 0 8px 8px 0;
                font-weight: ${active ? '700' : '500'}; font-size: 0.86rem; cursor: pointer; transition: all 0.15s;
            ">
                <i class="fas ${escapeHtml(cat.icon)}" style="width: 18px; text-align: center;"></i>
                <span>${escapeHtml(cat.title)}</span>
            </button>
        `;
    });

    nav.innerHTML = html;

    bindActions(nav, {
        sitemapSwitchCategory: (el) => {
            _sitemapActiveCategory = el.dataset.cat;
            _renderSitemapNav();
            _renderSitemapContent();
        }
    });
}

function _renderSitemapContent() {
    const container = document.getElementById('sitemapContainer');
    if (!container) return;

    const category = sitemapCategories.find(c => c.id === _sitemapActiveCategory) || sitemapCategories[0];

    let html = `
        <div style="margin-bottom: 18px;">
            <h4 style="color: ${escapeHtml(category.color)}; margin: 0; font-weight: 800; display: flex; align-items: center; gap: 10px;">
                <i class="fas ${escapeHtml(category.icon)}"></i> ${escapeHtml(category.title)}
            </h4>
        </div>
    `;

    category.modules.forEach((module, idx) => {
        const isOpen = !!module.open;
        const bodyId = escapeHtml(`sitemap-body-${category.id}-${idx}`);

        html += `
            <div style="
                margin-bottom: 14px;
                border-left: 3px solid ${escapeHtml(module.color)};
                background: rgba(255,255,255,0.02);
                border-radius: 0 12px 12px 0;
                overflow: hidden;
                animation: vipCardEntry 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
                animation-delay: ${idx * 0.05}s;
            ">
                <button type="button" data-action="sitemapToggleModule" data-target="${bodyId}" style="
                    width: 100%; display: flex; align-items: center; justify-content: space-between;
                    gap: 12px; background: none; border: none; cursor: pointer; padding: 16px 18px; text-align: left;
                ">
                    <span style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="color: ${escapeHtml(module.color)}; font-weight: 800; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                            <i class="fas ${escapeHtml(module.icon)}"></i> ${escapeHtml(module.title)}
                        </span>
                        <span style="color: #94a3b8; font-size: 0.82rem; font-weight: 400;">${escapeHtml(module.description)}</span>
                    </span>
                    <i class="fas fa-chevron-down sitemap-chevron" style="
                        color: #64748b; transition: transform 0.2s; flex-shrink: 0;
                        transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0deg)'};
                    "></i>
                </button>
                <div id="${bodyId}" style="
                    display: ${isOpen ? 'grid' : 'none'};
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; padding: 0 18px 18px;
                ">
        `;

        module.functions.forEach(fn => {
            html += `
                    <div style="background: rgba(0,0,0,0.25); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">
                        <div style="color: #cbd5e1; font-weight: bold; margin-bottom: 4px; font-size: 0.85rem;">${escapeHtml(fn.name)}</div>
                        <div style="color: #64748b; font-size: 0.78rem; line-height: 1.4;">${escapeHtml(fn.desc)}</div>
                    </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    bindActions(container, {
        sitemapToggleModule: (el) => {
            const body = document.getElementById(el.dataset.target);
            if (!body) return;
            const chevron = el.querySelector('.sitemap-chevron');
            const willOpen = body.style.display === 'none';
            body.style.display = willOpen ? 'grid' : 'none';
            if (chevron) chevron.style.transform = willOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    });
}

window.openSitemapModal = function () {
    const modal = document.getElementById('sitemapModal');
    if (modal) modal.style.display = 'flex';

    _renderSitemapNav();
    _renderSitemapContent();
};
