/**
 * SİSTEM HARİTASI VE GELİŞTİRİCİ KILAVUZU
 * Bu modül, uygulamanın mimarisini ve dosyaların ne işe yaradığını ekrana basar.
 */

const sitemapData = [
    {
        title: "📄 script.js (Ana Uygulama Motoru)",
        icon: "fa-js",
        color: "#f7df1e",
        description: "Personel tarafının ve genel UI yönetiminin kalbi.",
        functions: [
            { name: "handleLogin()", desc: "Kullanıcı veya adminin şifre kontrolünü yapıp sisteme sokar." },
            { name: "setupUI() / updateNavbarUI()", desc: "Yetkiye göre butonları gizler veya gösterir." },
            { name: "addRequest()", desc: "Personelin ürün talep formunu Firebase'e 'Beklemede' olarak yazar." },
            { name: "updateRequestStatus()", desc: "Adminin talebi 'Teslim Edildi' yapmasını, personelin 'Onaylamasını' sağlar." },
            { name: "renderTable()", desc: "Gelen verileri (B1, B2 vb.) HTML tablolarına basar." }
        ]
    },
    {
        title: "🔥 firebase-handler.js (Veri Katmanı)",
        icon: "fa-database",
        color: "#f5820b",
        description: "Uygulama ile Firebase arasındaki tüm iletişimi yönetir. Sub-collection mimarisini kullanır.",
        functions: [
            { name: "startRealtimeSync()", desc: "Firebase'i dinler, veri değiştiğinde window.data'yı günceller ve ekranları yeniler." },
            { name: "saveData()", desc: "Değişen verileri tespit edip (Diffing algoritması) sadece değişenleri Firebase'e 500'lük paketler (Chunk) halinde yazar." },
            { name: "migrateDataFromOldToNew()", desc: "Eski tek-döküman mimarisinden, yeni güvenli Alt-Koleksiyon mimarisine geçiş aracıdır." }
        ]
    },
    {
        title: "📊 admin-dashboard.js (Admin İstatistik)",
        icon: "fa-chart-pie",
        color: "#3b82f6",
        description: "Admin panelindeki Chart.js grafiklerini ve özel izleme listelerini çalıştırır.",
        functions: [
            { name: "renderDashboardCharts()", desc: "Stok miktarlarını ve sarf dağılımını Bar ve Pie grafiklerine çizer." },
            { name: "renderExitCharts()", desc: "B3 (Çıkış) verilerini okuyarak Demirbaş ve Sarf çıkış trendlerini çizer." },
            { name: "updateCriticalStock()", desc: "B1 ve B2'yi tarayıp stoğu düşük olanları 'Kritik Stok Takibi' tablosuna atar." },
            { name: "showAdminTab()", desc: "Sidebar sekme geçişlerini yönetir, ağır renderleri defer eder." }
        ]
    },
    {
        title: "🛡️ security.js (Kriptografi)",
        icon: "fa-shield-halved",
        color: "#10b981",
        description: "Sistem güvenliğini, şifreleme ve yetkilendirme mantıklarını barındırır.",
        functions: [
            { name: "SecurityConfig.hash(str)", desc: "Girilen şifreyi geri döndürülemez SHA-256 algoritmasıyla şifreler." },
            { name: "checkIsAdmin()", desc: "Kullanıcının localStorage yetkisini kontrol eder." },
            { name: "startSessionTimer()", desc: "Hareketsizlik durumunda oturumu kilitler." }
        ]
    },
    {
        title: "🌌 admin-system-control.js (VIP Motor v2.0)",
        icon: "fa-terminal",
        color: "#00ff88",
        description: "Admin'e tam sistem hakimiyeti sunan premium kontrol merkezi motoru.",
        functions: [
            { name: "Console Interceptor", desc: "console.log/warn/error/info + window.onerror + unhandledrejection yakalama ve VIP terminale canlı akış." },
            { name: "Sistem Sağlık Monitörü", desc: "Bellek kullanımı, ağ durumu, uptime sayacı, veri boyutu analizi, DOM düğüm sayısı." },
            { name: "Operasyon Raporu", desc: "Toplam ürün, stok, çıkış, bekleyen talep, kritik stok — count-up animasyonlu sayaçlar." },
            { name: "Debug & Hata Takip", desc: "Bilinen hatalar + runtime JS hatalarını dinamik olarak listeleyen panel." },
            { name: "SortableJS Motoru", desc: "Widget sürükle-bırak, localStorage dizilim kaydı, collapse/expand desteği." },
            { name: "Oturum & Güvenlik", desc: "Oturum geri sayımı, güvenlik seviyesi barı, aktif kullanıcı bilgisi." }
        ]
    },
    {
        title: "📦 inventory-management.js (Envanter Motoru)",
        icon: "fa-boxes",
        color: "#22c55e",
        description: "Admin panelindeki Envanter Yönetimi sekmesinin tüm CRUD işlemlerini yönetir.",
        functions: [
            { name: "renderInventoryTab()", desc: "Envanter sekmesinin tüm HTML iskeletini dinamik oluşturur." },
            { name: "importFromExcel()", desc: "SheetJS ile Excel dosyasını okuyup Firebase'e aktarır." },
            { name: "showAdminTab Interceptor", desc: "Envanter sekmesi açıldığında verileri lazy-render eder." }
        ]
    },
    {
        title: "🗺️ admin-sitemap.js (Bu Dosya)",
        icon: "fa-project-diagram",
        color: "#60a5fa",
        description: "Projedeki tüm modülleri dosya dosya, interaktif bir ağaç yapısıyla açıklayan Geliştirici Kılavuzu.",
        functions: [
            { name: "openSitemapModal()", desc: "Footer'daki butona tıklanınca modal açar ve dokümantasyonu basar." },
            { name: "sitemapData[]", desc: "Her JS dosyasının fonksiyonlarını ve açıklamalarını barındıran veri dizisi." }
        ]
    }
];

window.openSitemapModal = function() {
    const modal = document.getElementById('sitemapModal');
    const container = document.getElementById('sitemapContainer');
    
    if (modal) modal.style.display = 'flex';
    if (!container) return;

    let html = '';
    
    sitemapData.forEach((module, idx) => {
        html += `
            <div style="
                margin-bottom: 24px;
                border-left: 3px solid ${module.color};
                padding: 18px 18px 18px 20px;
                background: rgba(255,255,255,0.02);
                border-radius: 0 12px 12px 0;
                animation: vipCardEntry 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
                animation-delay: ${idx * 0.06}s;
            ">
                <h4 style="
                    color: ${module.color};
                    margin-top: 0;
                    font-weight: 800;
                    font-size: 1.05rem;
                    display: flex;
                    align-items: center;
                    letter-spacing: 0.5px;
                ">
                    <i class="fas ${module.icon} me-2"></i> ${module.title}
                </h4>
                <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 14px; line-height: 1.5;">${module.description}</p>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px;">
        `;

        module.functions.forEach(fn => {
            html += `
                    <div style="
                        background: rgba(0,0,0,0.25);
                        padding: 12px 16px;
                        border-radius: 8px;
                        border: 1px solid rgba(255,255,255,0.04);
                        transition: all 0.2s;
                    " onmouseenter="this.style.borderColor='${module.color}40'; this.style.background='rgba(0,0,0,0.35)'"
                       onmouseleave="this.style.borderColor='rgba(255,255,255,0.04)'; this.style.background='rgba(0,0,0,0.25)'">
                        <div style="
                            color: #cbd5e1;
                            font-family: 'Cascadia Code', 'Consolas', monospace;
                            font-weight: bold;
                            margin-bottom: 4px;
                            font-size: 0.85rem;
                        ">${fn.name}</div>
                        <div style="color: #64748b; font-size: 0.78rem; line-height: 1.4;">${fn.desc}</div>
                    </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
};
