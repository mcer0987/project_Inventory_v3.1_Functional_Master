

window.renderAdminDashboard = function () {
    const tbody = document.getElementById('purchaseTableBody');
    if (!tbody) return;

    const allRequests = window.data.purchaseOrders || [];
    // A-4: EBYS satır sözleşmesi purchase-servises.js'ten (EBYSPurchaseRows) gelir.
    const ebysRows = window.AppModules?.EBYSPurchaseRows;

    // [WHY]: Render fonksiyonu içinde veritabanı kaydı atmak Anti-Pattern'dir.
    // [HOW]: Veri onarımı (Data Sanitization) artık edm-workflow.js içerisinde onInventoryDataUpdated event'iyle Firebase'den veri ilk çekildiğinde arka planda sadece 1 kez yapılıyor.

    // Search filtreleme
    const search = document.getElementById("purchaseSearch")?.value?.toLocaleLowerCase('tr-TR') || "";
    let filteredData = allRequests;

    if (search) {
        filteredData = allRequests.filter(item =>
            item.evrakNo?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.urun?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.talepEden?.toLocaleLowerCase('tr-TR').includes(search) ||
            item.birim?.toLocaleLowerCase('tr-TR').includes(search)
        );
    }

    // Workflow durum helper fonksiyonu
    function getWorkflowStatus(item) {
        // A-4: EBYS motorundaki talebin durumu eski workflow'da değil; ayrıntı süreç penceresinde.
        if (ebysRows?.isLinked(item)) return { text: 'EBYS Süreci', bg: '#dbeafe', color: '#1e40af', icon: 'fa-route' };
        const currentState = item.workflow?.currentState;
        const isStarted = item.workflow?.started;
        const steps = item.workflow?.steps || [];

        if (!isStarted) {
            return { text: 'Başlatılmadı', bg: '#f1f5f9', color: '#475569', icon: 'fa-circle' };
        }

        // Tüm adımlar onaylandı mı kontrol et (status-based)
        const allApproved = steps.length > 0 && steps.every(step => step.status === 'approved');

        if (allApproved || currentState === window.WorkflowEngine?.states?.COMPLETED) {
            return { text: 'Tamamlandı', bg: '#d1fae5', color: '#065f46', icon: 'fa-check-circle' };
        }

        if (currentState === window.WorkflowEngine?.states?.CANCELLED) {
            return { text: 'Reddedildi', bg: '#fee2e2', color: '#991b1b', icon: 'fa-times-circle' };
        }

        if (currentState === window.WorkflowEngine?.states?.SUSPENDED) {
            return { text: 'Askıya Alındı', bg: '#fef9c3', color: '#854d0e', icon: 'fa-pause-circle' };
        }

        // Aktif workflow durumları - onay bekleyen adımı göster
        const pendingStep = steps.find(step => step.status === 'pending' || step.status === 'waiting');
        if (pendingStep) {
            return {
                text: `${pendingStep.user} Onay Bekliyor`,
                bg: '#dbeafe',
                color: '#1e40af',
                icon: 'fa-clock'
            };
        }

        return { text: 'Onay Bekliyor', bg: '#dbeafe', color: '#1e40af', icon: 'fa-clock' };
    }

    tbody.innerHTML = filteredData.length > 0
        ? filteredData.map(item => {
            const ebys = !!ebysRows?.isLinked(item);
            if (ebys) item = ebysRows.display(item);
            const status = getWorkflowStatus(item);
            const isCancelled = item.durum === "İptal Edildi";
            const isStarted = item.workflow?.started === true;

            return `
                <tr class="align-middle" style="${isCancelled ? 'background:#f1f5f9; opacity:0.7;' : ''}">
                    <td><span class="text-muted" style="font-size: 11px;">${escapeHtml(item.evrakNo || "-")}</span>${item.engineVersion === 'ebys-v1' ? ' <span class="badge-soft bg-primary text-white" style="font-size:9px;" title="Kurum içi sıralı EBYS onay rotasıyla yönetilir">EBYS</span>' : ''}</td>
                    <td><div style="font-size: 12px; color: #64748b;">${escapeHtml(item.tarih || "-")}</div></td>
                    <td>
                        <div class="fw-bold" style="font-size: 13px; color: #1e293b;">${escapeHtml(item.talepEden || item.createdByName || "-")}</div>
                        <small class="text-muted" style="font-size: 10px;">EBYS Birimi</small>
                    </td>
                    <td>
                        <div class="fw-bold text-primary" style="font-size: 13px;">${escapeHtml(item.urun || "-")}</div>
                        <small class="text-muted" style="font-size: 11px;">${escapeHtml(item.birim || "")}</small>
                    </td>
                    <td>
                        <span class="badge-soft" style="background: ${escapeHtml(status.bg)}; color: ${escapeHtml(status.color)};">
                            <i class="fas ${escapeHtml(status.icon)} me-1"></i>${escapeHtml(status.text)}
                        </span>
                    </td>
                    <td class="text-end">
                        <div class="d-flex justify-content-end gap-1">${ebys ? ebysRows.actionsHtml(item) : `
                            <!-- Görüntüle -->
                            <button onclick="window.openPurchaseDetail(${jsArg(item.id)},'view')" 
                                class="btn-action btn-passive" title="Görüntüle">
                                <i class="fas fa-eye fa-xs"></i>
                            </button>
                            
                            <!-- Düzenle -->
                            <button onclick="window.openPurchaseDetail(${jsArg(item.id)},'edit')" 
                                class="btn-action btn-edit" title="Düzenle">
                                <i class="fas fa-edit fa-xs"></i>
                            </button>
                            
                            ${!isStarted ? `
                                <!-- Akışı Başlat -->
                                <button onclick="window.startWorkflow(${jsArg(item.id)})" 
                                    class="btn-action btn-buy" title="Akışı Başlat">
                                    <i class="fas fa-play fa-xs"></i>
                                </button>
                            ` : `
                                <!-- İş Akışı (Mavi) -->
                                <button onclick="window.viewWorkflow(${jsArg(item.id)})" 
                                    class="btn-action btn-buy" title="İş Akışı">
                                    <i class="fas fa-stream fa-xs"></i>
                                </button>
                                <!-- Durdur (Kırmızı) -->
                                <button onclick="window.stopWorkflow(${jsArg(item.id)})" 
                                    class="btn-action btn-danger" title="Akışı Durdur">
                                    <i class="fas fa-stop fa-xs"></i>
                                </button>
                            `}

                            ${!isCancelled ? `
                                <!-- [FEATURE] Bug 3: Geri Çek / İptal (cancelPurchaseRequest) butonu -->
                                <button onclick="window.cancelPurchaseRequest(${jsArg(String(item.id))})" 
                                    class="btn-action btn-danger" title="${isStarted ? 'Geri Çek (Taslağa Al)' : 'Talebi İptal Et'}">
                                    <i class="fas fa-ban fa-xs"></i>
                                </button>
                            ` : ''}

                            ${!isStarted ? `
                                <!-- Sil -->
                                <button onclick="window.deletePurchaseRequest(${jsArg(item.id)})" 
                                    class="btn-action btn-danger" title="Sil">
                                    <i class="fas fa-trash-alt fa-xs"></i>
                                </button>
                            ` : ''}
                        `}</div>
                    </td>
                </tr>
            `;
        }).join('')
        : `
            <tr>
                <td colspan="6" style="text-align:center; padding:40px; color:#94a3b8;">
                    <i class="fas fa-inbox fa-2x mb-2"></i><br>
                    Henüz talep bulunmuyor.
                </td>
            </tr>
        `;
};

// Admin panelinde olduğumuzu belirt
window.isAdminPanel = true;
