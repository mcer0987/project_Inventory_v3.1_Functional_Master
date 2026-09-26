/**
 * inventory-management.js — Envanter Zimmet Yönetim Modülü
 * Tüm zimmet, iade, KPI ve Excel raporlama mantığını kapsüller.
 * admin.html içinde type="module" olarak yüklenir.
 * Bağımlılıklar: window.data, window.showAdminTab, window.saveData, SheetJS (XLSX)
 * NOT: Firebase erişimi window.db ve window.saveData üzerinden sağlanır (firebase-handler.js)
 */


// ─────────────────────────────────────────────
// GLOBAL MODÜL TANIMI
// ─────────────────────────────────────────────
window.inventoryManagementModule = {

  // ──────────────────
  // STATE
  // ──────────────────
  state: {
    searchTerm: '',
    typeFilter: 'all',       // 'all' | 'Kalıcı Zimmet' | 'Geçici Zimmet' | 'Sarf Malzeme İhtiyacı'
    assignTypeFilter: 'all', // 'all' | 'request' | 'b3'
    priorityFilter: 'all',   // 'all' | 'Kritik' | 'Yüksek' | 'Orta' | 'Düşük'
    sortOrder: 'newest'      // 'newest' | 'oldest'
  },

  // ──────────────────────────────────────────
  // 1. VERİ BİRLEŞTİRME & NORMALİZASYON
  // ──────────────────────────────────────────
  /**
   * requests (completed/approved) ve b3 zimmet kayıtlarını ortak şemaya dönüştürür.
   * @returns {Array} Normalize edilmiş zimmet kayıtları
   */
  getNormalizedAssignments: function () {
    const assignments = [];

    // --- KAYNAK 1: requests (onaylanan veya teslim alınan talepler) ---
    const requests = window.data?.requests || [];
    // [WHY]: Onay aynı zimmet için b3'e requestId'li ikiz kayıt yazar; talep ayrıca sayılınca KPI çift sayıyordu (ITSM-06).
    const twinRequestIds = new Set((window.data?.b3 || []).filter(b => b.requestId != null).map(b => String(b.requestId)));
    requests.forEach((req, idx) => {
      if (twinRequestIds.has(String(req.id))) return;
      const rawDurum = (req.durum || '').trim().toUpperCase();
      const isCompleted = rawDurum === 'COMPLETED' || rawDurum === 'TESLİM ALINDI' || rawDurum === 'TESLIM ALINDI';
      const isApproved = rawDurum === 'APPROVED' || rawDurum === 'ONAYLANDI';
      if (!isCompleted && !isApproved) return;

      assignments.push({
        _source: 'request',
        _index: idx,
        _id: req.id || idx,
        personel: req.personel || '-',
        ürün: req.ürün || '-',
        adet: req.adet || 1,
        tarih: req.tarih || '-',
        not: req.not || '-',
        sn: req.sn || '-',
        durum: req.iadeEdildi ? 'İade Edildi' : (isCompleted ? 'Teslim Alındı' : 'Onaylandı'),
        talepTuru: req.talepTuru || 'Kalıcı Zimmet',
        oncelik: req.oncelik || 'Orta',
        iadeTarihi: req.iadeTarihi || null,
        iadeEdildi: req.iadeEdildi || false,
        rawRef: req
      });
    });

    // --- KAYNAK 2: b3 (doğrudan/toplu envanter çıkışları) ---
    const b3 = window.data?.b3 || [];
    b3.forEach((item, idx) => {
      const person = item.alanKisi || item.personel || item.person || null;
      if (!person) return; // Kişisiz b3 kayıtları zimmet sayılmaz

      // [CRITICAL FIX]: Sadece Zimmet / Talep onay modülü üzerinden gelen (talepTuru veya oncelik içeren) b3 kayıtları zimmet sayılır.
      // Standart "Envanter Çıkışı Yap" ile b3'e kaydedilen normal sarfiyat/çıkış verileri Kişi Envanterine / Zimmet Modülüne GİRMEMELİDİR.
      if (!item.talepTuru && !item.oncelik) return;

      assignments.push({
        _source: 'b3',
        _index: idx,
        _id: item.id || idx,
        personel: person,
        ürün: item.productType || item.ürünTürü || '-',
        adet: item.sarfAdet || item.adet || 1,
        tarih: item.date || item.tarih || '-',
        not: item.note || item.not || '-',
        sn: item.sn || '-',
        durum: item.iadeEdildi ? 'İade Edildi' : 'Zimmetli',
        talepTuru: item.talepTuru || 'Kalıcı Zimmet',
        oncelik: item.oncelik || 'Orta',
        iadeTarihi: item.iadeTarihi || null,
        iadeEdildi: item.iadeEdildi || false,
        depo: item.sourceRepo || null,
        rawRef: item
      });
    });

    // En yeniden en eskiye sırala (id büyükse daha yeni)
    assignments.sort((a, b) => (b._id - a._id) || 0);
    return assignments;
  },

  // ──────────────────────────────────────────
  // 2. FİLTRE & ARAMA UYGULAMASI
  // ──────────────────────────────────────────
  applyFilters: function (assignments) {
    const { searchTerm, typeFilter, assignTypeFilter, priorityFilter, sortOrder } = this.state;
    let result = [...assignments];

    if (searchTerm) {
      const q = searchTerm.toLocaleLowerCase('tr-TR');
      result = result.filter(a =>
        (a.personel || '').toLocaleLowerCase('tr-TR').includes(q) ||
        (a.ürün || '').toLocaleLowerCase('tr-TR').includes(q) ||
        (a.sn || '').toLocaleLowerCase('tr-TR').includes(q) ||
        (a.not || '').toLocaleLowerCase('tr-TR').includes(q)
      );
    }
    if (typeFilter !== 'all') result = result.filter(a => a.talepTuru === typeFilter);
    if (assignTypeFilter !== 'all') result = result.filter(a => a._source === assignTypeFilter);
    if (priorityFilter !== 'all') result = result.filter(a => a.oncelik === priorityFilter);
    if (sortOrder === 'oldest') result.reverse();

    return result;
  },

  // ──────────────────────────────────────────
  // 3. KPI GÜNCELLEME
  // ──────────────────────────────────────────
  updateKPIs: function (assignments) {
    const total = assignments.filter(a => !a.iadeEdildi).length;
    const temporary = assignments.filter(a => a.talepTuru === 'Geçici Zimmet' && !a.iadeEdildi).length;
    const permanent = assignments.filter(a => a.talepTuru === 'Kalıcı Zimmet' && !a.iadeEdildi).length;
    const returned = assignments.filter(a => a.iadeEdildi).length;
    const pending = (window.data?.requests || []).filter(r => {
      const d = (r.durum || '').toUpperCase();
      return d === 'BEKLEMEDE' || d === 'BEKLİYOR' || d === 'BEKLIYOR' || d === '';
    }).length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-total', total);
    set('kpi-temp', temporary);
    set('kpi-perm', permanent);
    set('kpi-returned', returned);
    set('kpi-pending', pending);
  },

  // ──────────────────────────────────────────
  // 4. TAB RENDER FONKSİYONU
  // ──────────────────────────────────────────
  renderAdminInventoryTab: function () {
    const container = document.getElementById('inventoryManagementTab');
    if (!container) return;

    container.innerHTML = `
        <div style="padding: 8px 0 24px;">

          <!-- BAŞLIK -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:12px;">
            <div>
              <h2 style="margin:0; font-size:1.6rem; font-weight:800; color:var(--color-text); letter-spacing:-0.5px;">
                <i class="fas fa-boxes" style="color:var(--color-success); margin-right:10px;"></i>Envanter Zimmet Yönetimi
              </h2>
              <small style="color:var(--color-text-muted);">Tüm zimmetler, iadeler ve ITSM talep akışları tek ekranda</small>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button onclick="window.inventoryManagementModule.openAssignModal()"
                style="padding:10px 20px; background:var(--color-primary); color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; font-size:14px; display:flex; align-items:center; gap:6px; transition:0.2s;"
                onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <i class="fas fa-plus-circle"></i> Zimmet Yap
              </button>
              <button onclick="window.inventoryManagementModule.exportToExcel()"
                style="padding:10px 20px; background:#27ae60; color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; font-size:14px; display:flex; align-items:center; gap:6px; transition:0.2s;"
                onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <i class="fas fa-file-excel"></i> Excel Raporu
              </button>
            </div>
          </div>

          <!-- KPI KARTLARI -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:14px; margin-bottom:24px;">
            ${[
        { id: 'kpi-total', label: 'Toplam Zimmetli', icon: 'fa-layer-group', color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
        { id: 'kpi-perm', label: 'Kalıcı Zimmet', icon: 'fa-thumbtack', color: '#8e44ad', bg: 'rgba(142,68,173,0.1)' },
        { id: 'kpi-temp', label: 'Geçici / Ödünç', icon: 'fa-clock', color: '#e67e22', bg: 'rgba(230,126,34,0.1)' },
        { id: 'kpi-returned', label: 'İade Edildi', icon: 'fa-undo-alt', color: '#27ae60', bg: 'rgba(39,174,96,0.1)' },
        { id: 'kpi-pending', label: 'Bekleyen Talep', icon: 'fa-hourglass-half', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' }
      ].map(k => `
              <div style="background:${escapeHtml(k.bg)}; border:1px solid ${escapeHtml(k.color)}33; border-radius:14px; padding:16px; text-align:center; transition:0.2s;"
                   onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px ${k.color}22'"
                   onmouseout="this.style.transform=''; this.style.boxShadow=''">
                <div style="font-size:1.6rem; color:${escapeHtml(k.color)}; margin-bottom:6px;"><i class="fas ${escapeHtml(k.icon)}"></i></div>
                <div id="${escapeHtml(k.id)}" style="font-size:1.8rem; font-weight:800; color:${escapeHtml(k.color)};">-</div>
                <div style="font-size:0.7rem; font-weight:600; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-top:4px;">${escapeHtml(k.label)}</div>
              </div>
            `).join('')}
          </div>

          <!-- FİLTRELER & ARAMA -->
          <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; padding:16px; margin-bottom:20px; display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <div style="position:relative; flex:1; min-width:200px;">
              <i class="fas fa-search" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-text-muted);"></i>
              <input type="text" id="invSearchInput" placeholder="Personel, ürün veya seri no ara..."
                oninput="window.inventoryManagementModule.state.searchTerm=this.value; window.inventoryManagementModule.renderTable();"
                style="width:100%; box-sizing:border-box; padding:10px 12px 10px 38px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface-alt,#f8fafc); color:var(--color-text); font-size:14px; outline:none;">
            </div>
            <select id="invTypeFilter" onchange="window.inventoryManagementModule.state.typeFilter=this.value; window.inventoryManagementModule.renderTable();"
              style="padding:10px 14px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; cursor:pointer;">
              <option value="all">📦 Tüm Türler</option>
              <option value="Kalıcı Zimmet">📦 Kalıcı Zimmet</option>
              <option value="Geçici Zimmet">🔄 Geçici Zimmet</option>
              <option value="Sarf Malzeme İhtiyacı">🗂️ Sarf Malzeme</option>
            </select>
            <select id="invPriorityFilter" onchange="window.inventoryManagementModule.state.priorityFilter=this.value; window.inventoryManagementModule.renderTable();"
              style="padding:10px 14px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; cursor:pointer;">
              <option value="all">🎯 Tüm Öncelikler</option>
              <option value="Kritik">🔴 Kritik</option>
              <option value="Yüksek">🟠 Yüksek</option>
              <option value="Orta">🟡 Orta</option>
              <option value="Düşük">🟢 Düşük</option>
            </select>
            <select id="invSortOrder" onchange="window.inventoryManagementModule.state.sortOrder=this.value; window.inventoryManagementModule.renderTable();"
              style="padding:10px 14px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; cursor:pointer;">
              <option value="newest">🕐 En Yeni</option>
              <option value="oldest">🕐 En Eski</option>
            </select>
          </div>

          <!-- ZİMMET TABLOSU -->
          <div style="background:var(--color-surface); border:1px solid var(--color-border); border-radius:14px; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead>
                  <tr style="background:var(--color-surface-alt,#f8fafc); border-bottom:2px solid var(--color-border);">
                    <th style="padding:14px 16px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Personel</th>
                    <th style="padding:14px 16px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Ürün / SN</th>
                    <th style="padding:14px 16px; text-align:center; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Adet</th>
                    <th style="padding:14px 16px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Talep Türü</th>
                    <th style="padding:14px 16px; text-align:center; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Öncelik</th>
                    <th style="padding:14px 16px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Tarih / İade</th>
                    <th style="padding:14px 16px; text-align:center; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">Durum</th>
                    <th style="padding:14px 16px; text-align:center; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">İşlem</th>
                  </tr>
                </thead>
                <tbody id="invTableBody">
                  <tr><td colspan="8" style="padding:40px; text-align:center; color:var(--color-text-muted);">
                    <i class="fas fa-spinner fa-spin fa-2x" style="margin-bottom:10px; display:block;"></i>Veriler yükleniyor...
                  </td></tr>
                </tbody>
              </table>
            </div>
          </div>

        </div>
        `;

    // Zimmet modalı HTML'ini body'e ekle (eğer yoksa)
    this._injectAssignModal();

    // Veri yükle
    this.renderTable();
  },

  // ──────────────────────────────────────────
  // 5. TABLO RENDER
  // ──────────────────────────────────────────
  renderTable: function () {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;

    const allAssignments = this.getNormalizedAssignments();
    this.updateKPIs(allAssignments);

    const filtered = this.applyFilters(allAssignments);

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:48px; text-align:center; color:var(--color-text-muted);">
              <i class="fas fa-inbox fa-3x" style="display:block; margin-bottom:12px; opacity:0.3;"></i>
              Filtrelere uyan zimmet kaydı bulunamadı.
            </td></tr>`;
      return;
    }

    const priorityColors = {
      'Kritik': { bg: '#fee2e2', text: '#c0392b', icon: '🔴' },
      'Yüksek': { bg: '#fde8d8', text: '#d35400', icon: '🟠' },
      'Orta': { bg: '#fef9c3', text: '#d4a017', icon: '🟡' },
      'Düşük': { bg: '#d1fae5', text: '#16a34a', icon: '🟢' }
    };

    const typeColors = {
      'Kalıcı Zimmet': { bg: '#ede9fe', text: '#7c3aed', icon: '📦' },
      'Geçici Zimmet': { bg: '#dbeafe', text: '#1d4ed8', icon: '🔄' },
      'Sarf Malzeme İhtiyacı': { bg: '#f0fdf4', text: '#166534', icon: '🗂️' }
    };

    tbody.innerHTML = filtered.map((a, i) => {
      const pColor = priorityColors[a.oncelik] || priorityColors['Orta'];
      const tColor = typeColors[a.talepTuru] || typeColors['Kalıcı Zimmet'];
      const durumBadge = a.iadeEdildi
        ? `<span style="background:#d1fae5; color:#065f46; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">✅ İade Edildi</span>`
        : `<span style="background:#dbeafe; color:#1e40af; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">📌 Zimmetli</span>`;

      const returnDateInfo = a.talepTuru === 'Geçici Zimmet' && a.iadeTarihi
        ? `<br><small style="color:var(--color-warning); font-weight:600;">📅 İade: ${escapeHtml(a.iadeTarihi)}</small>`
        : '';

      const actionBtn = a.iadeEdildi
        ? `<span style="color:var(--color-text-muted); font-size:12px;">✔ Tamamlandı</span>`
        : `<button onclick="window.inventoryManagementModule.removeAssignment(${jsArg(String(a._id))}, ${jsArg(String(a._source))})"
                    style="padding:6px 12px; background:#e74c3c; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; transition:0.2s;"
                    onmouseover="this.style.background='#c0392b'" onmouseout="this.style.background='#e74c3c'">
                    <i class="fas fa-undo"></i> Zimmetten Düş
                  </button>`;

      // [G] SN varsa Cihaz Geçmişi butonu
      const historyBtn = (a.sn && a.sn !== '-')
        ? `<button onclick="window.inventoryManagementModule.showDeviceHistory(${jsArg(String(a.sn))})"
                    title="Bu cihazın tüm zimmet geçmişini gör"
                    style="padding:5px 10px; background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; margin-top:4px; display:flex; align-items:center; gap:4px; transition:0.2s;"
                    onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                    <i class="fas fa-history"></i> Geçmiş
                  </button>`
        : '';

      return `
            <tr style="border-bottom:1px solid var(--color-border); transition:0.15s;" onmouseover="this.style.background='var(--color-surface-alt,#f8fafc)'" onmouseout="this.style.background=''">
              <td style="padding:12px 16px;">
                <div style="font-weight:700; color:var(--color-text);">${escapeHtml(a.personel)}</div>
                <div style="font-size:11px; color:var(--color-text-muted);">${escapeHtml(a._source === 'request' ? '📋 Talep' : '📤 Doğrudan Çıkış')}</div>
              </td>
              <td style="padding:12px 16px;">
                <div style="font-weight:600; color:var(--color-text);">${escapeHtml(a.ürün)}</div>
                ${a.sn && a.sn !== '-' ? `<div style="font-size:11px; color:var(--color-text-muted); font-family:monospace;">SN: <b>${escapeHtml(a.sn)}</b></div>` : ''}
              </td>
              <td style="padding:12px 16px; text-align:center; font-weight:700; color:var(--color-text);">${escapeHtml(a.adet)}</td>
              <td style="padding:12px 16px;">
                <span style="background:${tColor.bg}; color:${tColor.text}; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">
                  ${tColor.icon} ${escapeHtml(a.talepTuru)}
                </span>
              </td>
              <td style="padding:12px 16px; text-align:center;">
                <span style="background:${pColor.bg}; color:${pColor.text}; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">
                  ${pColor.icon} ${escapeHtml(a.oncelik)}
                </span>
              </td>
              <td style="padding:12px 16px;">
                <div style="font-size:12px; color:var(--color-text-muted);">${escapeHtml(a.tarih)}</div>
                ${returnDateInfo}
              </td>
              <td style="padding:12px 16px; text-align:center;">${durumBadge}</td>
              <td style="padding:12px 16px; text-align:center;">
                <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                  ${actionBtn}
                  ${historyBtn}
                </div>
              </td>
            </tr>
            `;
    }).join('');
  },

  // ──────────────────────────────────────────
  // 6. ZİMMET MODAL — HTML ENJEKSIYONU
  // ──────────────────────────────────────────
  _injectAssignModal: function () {
    if (document.getElementById('assignInventoryModal')) return;

    const modal = document.createElement('div');
    modal.id = 'assignInventoryModal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(15,23,42,0.65); backdrop-filter:blur(8px); z-index:10500; align-items:center; justify-content:center;';
    modal.innerHTML = `
        <div style="background:var(--color-surface,#fff); border:1px solid var(--color-border); border-radius:20px; width:680px; max-width:96vw; max-height:90vh; overflow-y:auto; box-shadow:0 24px 64px rgba(0,0,0,0.4); position:relative;">

          <!-- BAŞLIK -->
          <div style="padding:20px 24px; border-bottom:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:var(--color-surface,#fff); z-index:1; border-radius:20px 20px 0 0;">
            <div>
              <h4 style="margin:0; font-weight:800; font-size:1.2rem; color:var(--color-text);">
                <i class="fas fa-plus-circle" style="color:var(--color-primary); margin-right:8px;"></i>Toplu Zimmet Yap
              </h4>
              <small style="color:var(--color-text-muted);">B1 / B2 deposundan personele zimmet ata</small>
            </div>
            <button onclick="window.inventoryManagementModule.closeAssignModal()"
              style="background:none; border:none; font-size:22px; cursor:pointer; color:var(--color-text-muted); width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:0.2s;"
              onmouseover="this.style.background='var(--color-border)'" onmouseout="this.style.background=''">×</button>
          </div>

          <!-- FORM ALANI -->
          <div style="padding:24px;">

            <!-- Personel Seçimi -->
            <div style="margin-bottom:18px;">
              <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-muted); display:block; margin-bottom:6px;">Personel *</label>
              <div style="display:flex; gap:8px; align-items:center;">
                <select id="assignPersonnel" style="flex:1; padding:12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px;">
                  <option value="">-- Personel Seçiniz --</option>
                </select>
                <button onclick="window.inventoryManagementModule.quickAddPersonnel()"
                  title="Yeni Personel Ekle"
                  style="flex-shrink:0; padding:10px 14px; background:#f0fdf4; color:#16a34a; border:1px solid #86efac; border-radius:10px; cursor:pointer; font-size:13px; font-weight:700; white-space:nowrap; transition:0.2s;"
                  onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
                  <i class="fas fa-user-plus"></i> Yeni
                </button>
              </div>
            </div>

            <!-- Zimmet Türü ve Öncelik -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:18px;">
              <div>
                <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-muted); display:block; margin-bottom:6px;">Zimmet Türü</label>
                <select id="assignType" style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px;"
                  onchange="window.inventoryManagementModule._toggleAssignReturnDate()">
                  <option value="Kalıcı Zimmet">📦 Kalıcı Zimmet</option>
                  <option value="Geçici Zimmet">🔄 Geçici Zimmet</option>
                  <option value="Sarf Malzeme İhtiyacı">🗂️ Sarf Malzeme</option>
                </select>
              </div>
              <div>
                <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-muted); display:block; margin-bottom:6px;">Öncelik</label>
                <select id="assignPriority" style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px;">
                  <option value="Düşük">🟢 Düşük</option>
                  <option value="Orta" selected>🟡 Orta</option>
                  <option value="Yüksek">🟠 Yüksek</option>
                  <option value="Kritik">🔴 Kritik</option>
                </select>
              </div>
            </div>

            <!-- İade Tarihi (Geçici için) -->
            <div id="assignReturnDateContainer" style="display:none; margin-bottom:18px;">
              <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-warning); display:block; margin-bottom:6px;">📅 Planlanan İade Tarihi</label>
              <input type="date" id="assignReturnDate" style="width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px;">
            </div>

            <!-- Ürün Satırları -->
            <div style="margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-muted);">Zimmet Edilecek Ürünler</label>
                <div style="display:flex; gap:8px;">
                  <button onclick="window.inventoryManagementModule.quickAddProduct()"
                    style="padding:6px 12px; background:#eff6ff; color:#1d4ed8; border:1px solid #93c5fd; border-radius:8px; cursor:pointer; font-size:12px; font-weight:700; display:flex; align-items:center; gap:4px; transition:0.2s;"
                    onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                    <i class="fas fa-box"></i> Yeni Ürün
                  </button>
                  <button onclick="window.inventoryManagementModule.addAssignRow()"
                    style="padding:6px 14px; background:var(--color-primary); color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px; font-weight:700; display:flex; align-items:center; gap:4px;">
                    <i class="fas fa-plus"></i> Satır Ekle
                  </button>
                </div>
              </div>
              <div id="assignRowsContainer">
                <!-- Dinamik satırlar buraya eklenir -->
              </div>
            </div>

            <!-- Not -->
            <div style="margin-bottom:20px;">
              <label style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:var(--color-text-muted); display:block; margin-bottom:6px;">Not / Açıklama</label>
              <textarea id="assignNote" rows="2" placeholder="İsteğe bağlı açıklama..."
                style="width:100%; box-sizing:border-box; padding:12px; border-radius:10px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:14px; resize:vertical;"></textarea>
            </div>

            <!-- KAYDET -->
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button onclick="window.inventoryManagementModule.closeAssignModal()"
                style="padding:12px 24px; background:none; border:1px solid var(--color-border); border-radius:10px; cursor:pointer; font-weight:600; color:var(--color-text-muted);">
                İptal
              </button>
              <button onclick="window.inventoryManagementModule.saveAssignment()"
                style="padding:12px 28px; background:var(--color-primary); color:white; border:none; border-radius:10px; cursor:pointer; font-weight:700; font-size:14px; display:flex; align-items:center; gap:8px; transition:0.2s;"
                onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                <i class="fas fa-save"></i> Zimmeti Kaydet
              </button>
            </div>
          </div>
        </div>
        `;

    document.body.appendChild(modal);
  },

  // ──────────────────────────────────────────
  // 7. ZİMMET MODAL — AÇMA / KAPAMA
  // ──────────────────────────────────────────
  openAssignModal: function () {
    this._injectAssignModal();
    const modal = document.getElementById('assignInventoryModal');
    if (!modal) return;

    // Personel listesini doldur
    const select = document.getElementById('assignPersonnel');
    if (select) {
      const personeller = window.data?.personel || [];
      select.innerHTML = '<option value="">-- Personel Seçiniz --</option>' +
        personeller.map(p => `<option value="${escapeHtml(p.name || p.adSoyad)}">${escapeHtml(p.name || p.adSoyad)}</option>`).join('');
    }

    // Formu sıfırla
    const assignType = document.getElementById('assignType');
    const assignPriority = document.getElementById('assignPriority');
    const assignNote = document.getElementById('assignNote');
    const assignReturnDate = document.getElementById('assignReturnDate');
    if (assignType) assignType.value = 'Kalıcı Zimmet';
    if (assignPriority) assignPriority.value = 'Orta';
    if (assignNote) assignNote.value = '';
    if (assignReturnDate) assignReturnDate.value = '';
    this._toggleAssignReturnDate();

    // İlk satırı ekle
    const rowsContainer = document.getElementById('assignRowsContainer');
    if (rowsContainer) {
      rowsContainer.innerHTML = '';
      this.addAssignRow();
    }

    modal.style.display = 'flex';
  },

  closeAssignModal: function () {
    const modal = document.getElementById('assignInventoryModal');
    if (modal) modal.style.display = 'none';
  },

  _toggleAssignReturnDate: function () {
    const type = document.getElementById('assignType')?.value;
    const container = document.getElementById('assignReturnDateContainer');
    if (container) container.style.display = (type === 'Geçici Zimmet') ? 'block' : 'none';
  },

  // ──────────────────────────────────────────
  // 8. DİNAMİK ÜRÜN SATIRLARI
  // ──────────────────────────────────────────
  addAssignRow: function () {
    const container = document.getElementById('assignRowsContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'assign-product-row';
    // [B] SN alanı eklendi: grid 5 kolonlu
    row.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 1fr 80px 36px; gap:8px; margin-bottom:12px; align-items:center; background:var(--color-surface-alt,#f8fafc); border:1px solid var(--color-border); border-radius:10px; padding:10px;';
    row.innerHTML = `
          <select class="assign-warehouse-sel" onchange="window.inventoryManagementModule.onWarehouseChange(this)"
            style="padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px;">
            <option value="">-- Depo Seç --</option>
            <option value="b1">B1 Deposu</option>
            <option value="b2">B2 Deposu</option>
          </select>
          <select class="assign-product-sel" onchange="window.inventoryManagementModule.onProductChange(this)"
            style="padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px;">
            <option value="">-- Önce Depo Seç --</option>
          </select>
          <input type="text" class="assign-sn-inp" placeholder="Seri No / SN"
            style="padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; font-family:monospace;">
          <input type="number" class="assign-qty-inp" value="1" min="1"
            style="padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; text-align:center;"
            placeholder="Adet">
          <button onclick="window.inventoryManagementModule.removeAssignRow(this)"
            style="padding:8px; background:#fee2e2; color:#c0392b; border:none; border-radius:8px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center;">
            <i class="fas fa-times"></i>
          </button>
        `;
    container.appendChild(row);
  },

  removeAssignRow: function (btn) {
    const container = document.getElementById('assignRowsContainer');
    if (!container || container.children.length <= 1) return;
    btn.closest('.assign-product-row').remove();
  },

  onWarehouseChange: function (select) {
    const row = select.closest('.assign-product-row');
    const productSel = row.querySelector('.assign-product-sel');
    const warehouse = select.value;

    if (!warehouse) {
      productSel.innerHTML = '<option value="">-- Önce Depo Seç --</option>';
      return;
    }

    const products = window.data?.[warehouse] || [];
    // [B] DEMIRBAŞ FİLTRESİ: Sadece isDemirbas:true olan ürünler zimmetlenebilir
    const fixtures = products.filter(p => {
      const hasStock = (p.adet || 0) > 0;
      const isDem = p.isDemirbas === true || p.isDemirbas === 'true';
      return hasStock && isDem;
    });

    if (fixtures.length === 0) {
      productSel.innerHTML = '<option value="">Bu depoda zimmetlenebilir demirbaş yok</option>';
      return;
    }

    productSel.innerHTML = '<option value="">-- Ürün Seç --</option>' +
      fixtures
        .map((p, origIdx) => {
          return `<option value="${escapeHtml(p.id)}" data-max="${escapeHtml(p.adet)}">${escapeHtml(p.ürün || p.name)} (Stok: ${escapeHtml(p.adet)})</option>`;
        })
        .join('');
  },

  onProductChange: function (select) {
    const row = select.closest('.assign-product-row');
    const qtyInp = row.querySelector('.assign-qty-inp');
    const opt = select.options[select.selectedIndex];
    if (!opt || !opt.dataset.max) return;
    qtyInp.max = parseInt(opt.dataset.max) || 999;
  },

  // ──────────────────────────────────────────
  // 9. ZİMMET KAYDET
  // ──────────────────────────────────────────
  // [WHY]: Zimmet atama istemci tarafında stok düşüyor, ondalıklı id üretiyor, tüm DB'yi yazıyor ve her durumda başarı diyordu;
  //        ürün dizi indeksiyle seçildiği için modal açıkken sıralama değişirse yanlış ürüne zimmet yapılıyordu (ZIM-01, ZIM-03).
  // [HOW]: Ürün id ile çözülür; satırlar doğrulanıp aynı ürün birleştirilir; stok runStockTransaction ile atomik düşülür ve
  //        hata olursa geri alınır; yalnız b3 + assignments yazılır; çift tıklama kilidi.
  saveAssignment: async function () {
    if (this._savingAssignment) return;
    const alert = (m, t) => { if (typeof showAppAlert === 'function') showAppAlert(m, t); };
    const personnelName = document.getElementById('assignPersonnel')?.value?.trim();
    const talepTuru = document.getElementById('assignType')?.value || 'Kalıcı Zimmet';
    const oncelik = document.getElementById('assignPriority')?.value || 'Orta';
    const iadeTarihi = document.getElementById('assignReturnDate')?.value || null;
    const not = document.getElementById('assignNote')?.value?.trim() || '';

    if (!personnelName) { alert('Lütfen personel seçiniz!', 'warning'); return; }
    if (talepTuru === 'Geçici Zimmet' && !iadeTarihi) { alert('Geçici zimmet için iade tarihi zorunludur!', 'warning'); return; }

    const merged = new Map();
    for (const row of document.querySelectorAll('#assignRowsContainer .assign-product-row')) {
      const warehouse = row.querySelector('.assign-warehouse-sel')?.value;
      const productId = row.querySelector('.assign-product-sel')?.value;
      if (!warehouse || !productId) continue;
      const qty = Number(row.querySelector('.assign-qty-inp')?.value);
      if (!Number.isInteger(qty) || qty < 1) { alert('Adet en az 1 olan tam sayı olmalıdır.', 'warning'); return; }
      const product = (window.data?.[warehouse] || []).find(p => String(p.id) === String(productId));
      if (!product) { alert('Seçilen ürün bulunamadı; liste güncellenmiş olabilir. Satırı yeniden seçin.', 'error'); return; }
      const sn = row.querySelector('.assign-sn-inp')?.value?.trim() || '-';
      const key = `${warehouse}|${product.id}`;
      const prev = merged.get(key);
      if (prev) { prev.qty += qty; if (sn !== '-') prev.sn = prev.sn === '-' ? sn : `${prev.sn}, ${sn}`; }
      else merged.set(key, { warehouse, product, qty, sn });
    }
    const items = [...merged.values()];
    if (items.length === 0) { alert('Lütfen en az bir ürün ekleyiniz!', 'warning'); return; }
    for (const it of items) {
      const stock = Number(it.product.adet ?? it.product.qty ?? 0);
      if (it.qty > stock) { alert(`${it.product.ürün || it.product.name} için yeterli stok yok! (Mevcut: ${stock}, İstenen: ${it.qty})`, 'error'); return; }
    }

    this._savingAssignment = true;
    const deducted = [];
    const rollback = async () => {
      for (const d of deducted.reverse()) {
        try { await window.runStockTransaction(d.warehouse, d.product.id, d.qty); } catch (e) { console.error('❌ Stok geri alma hatası:', e); }
      }
    };
    try {
      for (const it of items) {
        await window.runStockTransaction(it.warehouse, it.product.id, -it.qty);
        deducted.push(it);
      }

      const now = typeof getTurkiyeTarihi === 'function' ? getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR');
      const baseId = Date.now();
      const b3Entries = [], assignmentEntries = [];
      items.forEach((it, i) => {
        const id = baseId + i;
        const common = {
          sn: it.sn, talepTuru, oncelik, isDemirbas: true, iadeEdildi: false,
          productId: it.product.id, sourceRepo: it.warehouse,
          ...(iadeTarihi ? { iadeTarihi } : {}),
        };
        b3Entries.push({
          id, ...common,
          shelfNo: it.product.raf || '-',
          productType: it.product.ürün || it.product.name || '-',
          description: it.product.açıklama || '-',
          sarfAdet: it.qty,
          note: not || `Admin Zimmeti (${talepTuru})`,
          alanKisi: personnelName,
          date: now,
        });
        assignmentEntries.push({
          id, ...common,
          ürün: it.product.ürün || it.product.name || '-',
          personel: personnelName, tarih: now, adet: it.qty, not, tip: 'zimmet',
        });
      });

      if (await window.saveData('b3', [...b3Entries, ...(window.data.b3 || [])]) === false) {
        await rollback();
        alert('Zimmet kaydedilemedi; stok geri alındı.', 'error');
        return;
      }
      if (await window.saveData('assignments', [...assignmentEntries, ...(window.data.assignments || [])]) === false) {
        alert('Zimmet oluşturuldu ancak zimmet geçmişi (assignments) yazılamadı.', 'warning');
      } else {
        alert(`${personnelName} adına ${items.length} kalem zimmet başarıyla oluşturuldu.`, 'success');
      }
      this.closeAssignModal();
      this.renderTable();
    } catch (err) {
      console.error('Zimmet kayıt hatası:', err);
      await rollback();
      alert(`Zimmet kaydedilemedi: ${err.message}`, 'error');
    } finally {
      this._savingAssignment = false;
    }
  },

  // ──────────────────────────────────────────
  // 10. ZİMMETTEN DÜŞME & İADE
  // ──────────────────────────────────────────
  // [WHY]: Seçilen depo talep zimmetlerinde yok sayılıyordu; b3 stoku ürün adıyla bulunup istemcide artırılıyordu;
  //        assignments hiç güncellenmiyordu; planlanan iade tarihi eziliyordu; "Vazgeç" yine zimmeti kapatıyordu (ZIM-02).
  // [HOW]: Depo sorusu yalnız stok bağlantısı olan (b1/b2 kaynaklı) zimmette sorulur; ürün productId ile (eski kayıtlarda
  //        hedef depoda tek eşleşen adla) bulunur ve runStockTransaction(+adet) ile atomik artırılır; iptal gerçekten iptaldir;
  //        gerçekleşen iade ayrı alana yazılır; b3, assignments ve bağlı talep güncellenir.
  removeAssignment: async function (id, sourceTable) {
    const alert = (m, t) => { if (typeof showAppAlert === 'function') showAppAlert(m, t); };
    const today = typeof getTurkiyeTarihi === 'function' ? getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR');
    const sameId = x => String(x.id) === String(id);

    if (sourceTable === 'request') {
      const req = (window.data.requests || []).find(sameId);
      if (!req) { alert('Kayıt bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
      if (req.iadeEdildi) { alert('Bu zimmet zaten iade edilmiş.', 'info'); return; }
      const ok = await (typeof showCustomConfirm === 'function'
        ? showCustomConfirm('Zimmetten Düş', 'Talep kaynaklı zimmet kapatılacak (stok bağlantısı olmadığı için depo stoğu değişmez). Onaylıyor musunuz?')
        : Promise.resolve(window.confirm('Talep kaynaklı zimmet kapatılsın mı?')));
      if (!ok) return;
      const updated = { ...req, iadeEdildi: true, iadeEdildiTarihi: today };
      const saved = await window.saveData('requests', window.data.requests.map(r => sameId(r) ? updated : r));
      if (saved === false) { alert('İade kaydedilemedi.', 'error'); return; }
      this.renderTable();
      alert('Zimmet kaydı kapatıldı.', 'success');
      return;
    }

    const item = (window.data.b3 || []).find(sameId);
    if (!item) { alert('Kayıt bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    if (item.iadeEdildi) { alert('Bu zimmet zaten iade edilmiş.', 'info'); return; }

    const qty = Number(item.sarfAdet || item.adet || 1);
    const stockLinked = item.sourceRepo === 'b1' || item.sourceRepo === 'b2';
    let target = null;
    if (stockLinked) {
      const choice = await window.showWarehousePromptModal({ allowNoReturn: true });
      if (choice === null) { alert('İşlem iptal edildi.', 'info'); return; }
      target = choice === 'none' ? null : choice;
    } else {
      const ok = await (typeof showCustomConfirm === 'function'
        ? showCustomConfirm('Zimmetten Düş', 'Bu zimmetin stok bağlantısı yok; yalnız kayıt kapatılacak. Onaylıyor musunuz?')
        : Promise.resolve(window.confirm('Zimmet kaydı kapatılsın mı?')));
      if (!ok) return;
    }

    let product = null;
    if (target) {
      const list = window.data[target] || [];
      product = item.productId != null ? list.find(p => String(p.id) === String(item.productId)) : null;
      if (!product) {
        const name = String(item.productType || item.ürünTürü || '').trim().toLocaleLowerCase('tr-TR');
        const byName = list.filter(p => String(p.ürün || p.name || '').trim().toLocaleLowerCase('tr-TR') === name);
        if (byName.length === 1) product = byName[0];
      }
      if (!product) { alert(`${target.toUpperCase()} deposunda bu ürün tek ve kesin olarak bulunamadı; iade yapılmadı.`, 'error'); return; }
      try {
        await window.runStockTransaction(target, product.id, qty);
      } catch (e) {
        alert(`Stok iadesi başarısız: ${e.message}`, 'error');
        return;
      }
    }

    const updatedItem = { ...item, iadeEdildi: true, iadeDepo: target, iadeEdildiTarihi: today };
    if (await window.saveData('b3', window.data.b3.map(b => sameId(b) ? updatedItem : b)) === false) {
      if (target && product) { try { await window.runStockTransaction(target, product.id, -qty); } catch (e) { console.error(e); } }
      alert('İade kaydedilemedi; stok değişikliği geri alındı.', 'error');
      return;
    }

    const assignments = window.data.assignments || [];
    if (assignments.some(sameId)) {
      await window.saveData('assignments', assignments.map(a => sameId(a) ? { ...a, iadeEdildi: true, iadeDepo: target, iadeEdildiTarihi: today } : a));
    }
    if (item.requestId != null) {
      const reqs = window.data.requests || [];
      if (reqs.some(r => String(r.id) === String(item.requestId))) {
        await window.saveData('requests', reqs.map(r => String(r.id) === String(item.requestId) ? { ...r, iadeEdildi: true, iadeEdildiTarihi: today } : r));
      }
    }

    this.renderTable();
    alert(target ? `Zimmet düşüldü ve ${target.toUpperCase()} deposuna iade edildi.` : 'Zimmet kaydı kapatıldı (depo iadesi yapılmadı).', 'success');
  },

  // ──────────────────────────────────────────
  // 11. EXCEL DIŞA AKTARIM
  // ──────────────────────────────────────────
  exportToExcel: function () {
    if (typeof XLSX === 'undefined') {
      if (typeof showAppAlert === 'function') showAppAlert('XLSX kütüphanesi yüklenemedi!', 'error');
      return;
    }

    const allAssignments = this.getNormalizedAssignments();
    const filtered = this.applyFilters(allAssignments);

    if (filtered.length === 0) {
      if (typeof showAppAlert === 'function') showAppAlert('Aktarılacak kayıt bulunamadı!', 'warning');
      return;
    }

    const rows = filtered.map((a, i) => ({
      'Sıra': i + 1,
      'Personel': a.personel,
      'Ürün': a.ürün,
      'Adet': a.adet,
      'Seri No': a.sn,
      'Talep Türü': a.talepTuru,
      'Öncelik': a.oncelik,
      'Zimmet Tarihi': a.tarih,
      'Planlanan İade Tarihi': a.iadeTarihi || '-',
      'Durum': a.iadeEdildi ? 'İade Edildi' : 'Zimmetli',
      'Not': a.not,
      'Kaynak': a._source === 'request' ? 'Talep Onayı' : 'Doğrudan Çıkış'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Sütun genişlikleri
    ws['!cols'] = [
      { wch: 5 }, { wch: 20 }, { wch: 25 }, { wch: 8 }, { wch: 18 },
      { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 25 }, { wch: 18 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Zimmet Listesi');

    const today = new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
    XLSX.writeFile(wb, `Zimmet_Raporu_${today}.xlsx`);

    if (typeof showAppAlert === 'function') showAppAlert(`${rows.length} kayıt Excel'e aktarıldı.`, 'success');
  },

  // ──────────────────────────────────────────
  // 12. [G] CİHAZ GEÇMİŞİ MODALI
  // ──────────────────────────────────────────

  /**
   * [G] SN numarasına göre o cihazın tüm zimmet/iade geçmişini gösterir.
   * B3, requests ve assignments koleksiyonlarını tarar.
   */
  showDeviceHistory: function (sn) {
    if (!sn || sn === '-') {
      if (typeof showAppAlert === 'function') showAppAlert('Bu cihaz için seri no kaydı bulunamadı.', 'warning');
      return;
    }

    const snNorm = sn.trim().toUpperCase();

    // Tüm kaynakları tara
    const events = [];

    // 1. assignments koleksiyonu (en güvenilir)
    (window.data?.assignments || []).forEach(a => {
      if ((a.sn || '').trim().toUpperCase() === snNorm) {
        events.push({
          tarih: a.tarih || '-',
          tip: a.iadeEdildi ? '✅ İade Edildi' : '📌 Zimmetlendi',
          personel: a.personel || '-',
          ürün: a.ürün || '-',
          not: a.not || '-',
          kaynak: 'assignments',
          ts: a.id || 0
        });
      }
    });

    // 2. B3 çıkış logları
    (window.data?.b3 || []).forEach(b => {
      if ((b.sn || '').trim().toUpperCase() === snNorm) {
        events.push({
          tarih: b.date || b.tarih || '-',
          tip: b.iadeEdildi ? '✅ İade Edildi' : '📌 Zimmetlendi',
          personel: b.alanKisi || b.person || b.personel || '-',
          ürün: b.productType || b.ürün || '-',
          not: b.note || b.not || '-',
          kaynak: 'b3',
          ts: b.id || 0
        });
      }
    });

    // 3. Talepler (onaylananlar)
    (window.data?.requests || []).forEach(r => {
      if ((r.sn || '').trim().toUpperCase() === snNorm) {
        events.push({
          tarih: r.tarih || '-',
          tip: r.iadeEdildi ? '✅ İade Edildi' : '📋 Talep Onayı',
          personel: r.personel || '-',
          ürün: r.ürün || '-',
          not: r.not || '-',
          kaynak: 'talep',
          ts: r.id || 0
        });
      }
    });

    // Tarihe göre eskiden yeniye sırala
    events.sort((a, b) => a.ts - b.ts);

    // Mevcut modal varsa temizle
    let modal = document.getElementById('deviceHistoryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'deviceHistoryModal';
      modal.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.7); backdrop-filter:blur(8px); z-index:10600; display:flex; align-items:center; justify-content:center;';
      document.body.appendChild(modal);
    }

    const eventRows = events.length === 0
      ? `<tr><td colspan="5" style="text-align:center; padding:32px; color:var(--color-text-muted);"><i class="fas fa-search fa-2x" style="display:block; margin-bottom:12px; opacity:0.3;"></i>Bu seri numarasiyla eslesen kayit bulunamadi.</td></tr>`
      : events.map((ev, i) => `
          <tr style="border-bottom:1px solid var(--color-border);">
            <td style="padding:10px 14px; font-size:12px; color:var(--color-text-muted); white-space:nowrap;">${i + 1}. ${escapeHtml(ev.tarih)}</td>
            <td style="padding:10px 14px;"><span style="font-size:12px; font-weight:700;">${escapeHtml(ev.tip)}</span></td>
            <td style="padding:10px 14px; font-weight:600; color:var(--color-text);">${escapeHtml(ev.personel)}</td>
            <td style="padding:10px 14px; color:var(--color-text-muted); font-size:12px;">${escapeHtml(ev.ürün)}</td>
            <td style="padding:10px 14px; color:var(--color-text-muted); font-size:11px;">${escapeHtml(ev.not)}</td>
          </tr>
        `).join('');

    modal.innerHTML = `
      <div style="background:var(--color-surface,#fff); border:1px solid var(--color-border); border-radius:20px; width:780px; max-width:96vw; max-height:88vh; overflow-y:auto; box-shadow:0 24px 64px rgba(0,0,0,0.4);">
        <div style="padding:20px 24px; border-bottom:1px solid var(--color-border); display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:var(--color-surface,#fff); z-index:1; border-radius:20px 20px 0 0;">
          <div>
            <h4 style="margin:0; font-weight:800; font-size:1.15rem; color:var(--color-text);">
              <i class="fas fa-history" style="color:var(--color-primary); margin-right:8px;"></i>Cihaz Zimmet Gecmisi
            </h4>
            <div style="margin-top:4px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:13px; color:var(--color-text-muted);">Seri No:</span>
              <code style="background:var(--color-surface-alt,#f3f4f6); padding:3px 10px; border-radius:6px; font-size:13px; font-weight:700; color:var(--color-primary); letter-spacing:0.5px;">${escapeHtml(sn)}</code>
              <span style="background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700;">${events.length} Kayit</span>
            </div>
          </div>
          <button onclick="document.getElementById('deviceHistoryModal').remove()"
            style="background:none; border:none; font-size:22px; cursor:pointer; color:var(--color-text-muted); width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>
        <div style="padding:20px 24px;">
          ${ events.length > 0 ? `
          <div style="margin-bottom:16px; padding:12px 16px; background:#f0fdf4; border:1px solid #86efac; border-radius:10px; display:flex; align-items:center; gap:8px;">
            <i class="fas fa-info-circle" style="color:#16a34a;"></i>
            <span style="font-size:13px; color:#166534;">Bu cihaz <b>${events.length}</b> kez islem gormust. Kronolojik sirayla listelenmektedir.</span>
          </div>` : '' }
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="background:var(--color-surface-alt,#f8fafc); border-bottom:2px solid var(--color-border);">
                  <th style="padding:10px 14px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px;">Tarih</th>
                  <th style="padding:10px 14px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px;">Durum</th>
                  <th style="padding:10px 14px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px;">Personel</th>
                  <th style="padding:10px 14px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px;">Urun</th>
                  <th style="padding:10px 14px; text-align:left; font-weight:700; color:var(--color-text-muted); text-transform:uppercase; font-size:11px;">Not</th>
                </tr>
              </thead>
              <tbody>${eventRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.remove();
    }, { once: true });
  },

  // 13. HIZLI EKLEME KISA YOLLARI [E][F]
  quickAddPersonnel: function () {
    if (typeof window.openPersonelModal === 'function') {
      window.openPersonelModal();
    } else if (typeof window.openPersonnelModal === 'function') {
      window.openPersonnelModal();
    } else {
      if (typeof showAppAlert === 'function') showAppAlert('Personel ekleme modali bu sayfada mevcut degil.', 'warning');
      return;
    }
    const modal = document.getElementById('personelModal') || document.getElementById('personnelModal');
    if (!modal) return;
    const obs = new MutationObserver(() => {
      if (modal.style.display === 'none' || !modal.style.display) {
        obs.disconnect();
        setTimeout(() => {
          const select = document.getElementById('assignPersonnel');
          if (!select) return;
          const personeller = window.data?.personel || [];
          const current = select.value;
          select.innerHTML = '<option value="">-- Personel Seciniz --</option>' +
            personeller.map(p => `<option value="${escapeHtml(p.name || p.adSoyad)}">${escapeHtml(p.name || p.adSoyad)}</option>`).join('');
          if (personeller.length > 0) {
            const last = personeller[personeller.length - 1];
            select.value = last.name || last.adSoyad || current;
          }
        }, 300);
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['style'] });
  },

  quickAddProduct: function () {
    if (typeof window.openProductModal === 'function') {
      window.openProductModal();
    } else {
      if (typeof showAppAlert === 'function') showAppAlert('Urun ekleme modali bu sayfada mevcut degil.', 'warning');
      return;
    }
    const modal = document.getElementById('productModal');
    if (!modal) return;
    const obs = new MutationObserver(() => {
      if (modal.style.display === 'none' || !modal.style.display) {
        obs.disconnect();
        setTimeout(() => {
          document.querySelectorAll('#assignRowsContainer .assign-warehouse-sel').forEach(sel => {
            if (sel.value) window.inventoryManagementModule.onWarehouseChange(sel);
          });
        }, 300);
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['style'] });
  }
};

// showAdminTab INTERCEPTOR
(function attachInventoryTabHook() {
  function doHook() {
    if (typeof window.showAdminTab !== 'function') { setTimeout(doHook, 150); return; }
    if (window._inventoryTabHooked) return;
    window._inventoryTabHooked = true;
    const previousShowAdminTab = window.showAdminTab;
    window.showAdminTab = function (tabId) {
      if (typeof previousShowAdminTab === 'function') previousShowAdminTab(tabId);
      if (tabId === 'inventoryManagementTab') {
        if (window.data && window.inventoryManagementModule) {
          window.inventoryManagementModule.renderAdminInventoryTab();
        } else {
          setTimeout(() => { if (window.inventoryManagementModule) window.inventoryManagementModule.renderAdminInventoryTab(); }, 600);
        }
      }
    };
  }
  doHook();
})();
