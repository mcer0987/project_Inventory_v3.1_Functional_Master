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
  // [HOW] (3.7): Liste zimmet servisinden gelir (personelin Kişi Envanterim ekranıyla aynı kaynak ve kurallar).
  getNormalizedAssignments: function () {
    return window.AssignmentService.getAssignments().map(a => ({
      _source: a._source,
      _id: a._id,
      personel: a.personel,
      personelId: a.personelId,
      ürün: a.urun,
      adet: a.adet,
      tarih: a.tarih,
      not: a.not,
      sn: a.sn,
      envanterNo: a.envanterNo,
      durum: a.iadeEdildi ? 'İade Edildi' : (a._source === 'request' ? (a.teslimAlindi ? 'Teslim Alındı' : 'Onaylandı') : 'Zimmetli'),
      talepTuru: a.talepTuru,
      oncelik: a.oncelik,
      iadeTarihi: a.iadeTarihi,
      iadeEdildi: a.iadeEdildi,
      depo: a.depo,
      rawRef: a.rawRef
    }));
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
                   onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px ${k.color /* xss-ok: sabit KPI renk tablosu (#hex) */}22'"
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

      // Faz 5 · K1 (5.1 · ZIM-04): resmi zimmet tutanağı — personelId'si çözülebilen kayıtlarda (b3 ve eşlenmiş eski
      // talepler). Kişinin ÜZERİNDEKİ TÜM zimmetlerini basar (bu satırla sınırlı değil; AssignmentService.getPersonInventory
      // ile aynı küme), "Zimmetten Düş" gibi satır başına değil kişi başına bir işlemdir.
      const pdfBtn = a.personelId
        ? `<button onclick="window.generatePersonnelZimmetPDF(${jsArg(String(a.personelId))})"
                    title="Bu personelin resmi zimmet tutanağını indir"
                    style="padding:5px 10px; background:#eef2ff; color:#4338ca; border:1px solid #c7d2fe; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; margin-top:4px; display:flex; align-items:center; gap:4px; transition:0.2s;"
                    onmouseover="this.style.background='#e0e7ff'" onmouseout="this.style.background='#eef2ff'">
                    <i class="fas fa-file-pdf"></i> Tutanak
                  </button>`
        : '';

      // [G] Seri No veya Envanter No varsa Cihaz Geçmişi butonu (3.9c: servis/sevk dahil birleşik geçmiş)
      const deviceId = [a.sn, a.envanterNo].find(v => v && v !== '-' && !String(v).includes(','));
      const historyBtn = deviceId
        ? `<button onclick="window.inventoryManagementModule.showDeviceHistory(${jsArg(String(deviceId))})"
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
                ${a.envanterNo && a.envanterNo !== '-' ? `<div style="font-size:11px; color:var(--color-text-muted); font-family:monospace;">Env. No: <b>${escapeHtml(a.envanterNo)}</b></div>` : ''}
              </td>
              <td style="padding:12px 16px; text-align:center; font-weight:700; color:var(--color-text);">${escapeHtml(a.adet)}</td>
              <td style="padding:12px 16px;">
                <span style="background:${escapeHtml(tColor.bg)}; color:${escapeHtml(tColor.text)}; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">
                  ${tColor.icon} ${escapeHtml(a.talepTuru)}
                </span>
              </td>
              <td style="padding:12px 16px; text-align:center;">
                <span style="background:${escapeHtml(pColor.bg)}; color:${escapeHtml(pColor.text)}; padding:4px 10px; border-radius:20px; font-size:11px; font-weight:700;">
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
                  ${pdfBtn}
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
        personeller.map(p => `<option value="${escapeHtml(p.id ?? p.name ?? p.adSoyad)}">${escapeHtml(p.name || p.adSoyad)}</option>`).join('');
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
    // 3.9a: tek serbest SN kutusu yerine ürün ve adet seçilince adet kadar cihaz kimliği satırı (Seri No / Envanter No)
    row.style.cssText = 'display:grid; grid-template-columns:1fr 1fr 80px 36px; gap:8px; margin-bottom:12px; align-items:center; background:var(--color-surface-alt,#f8fafc); border:1px solid var(--color-border); border-radius:10px; padding:10px;';
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
          <input type="number" class="assign-qty-inp" value="1" min="1" oninput="window.inventoryManagementModule._syncAssignDevices(this.closest('.assign-product-row'))"
            style="padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); font-size:13px; text-align:center;"
            placeholder="Adet">
          <button onclick="window.inventoryManagementModule.removeAssignRow(this)"
            style="padding:8px; background:#fee2e2; color:#c0392b; border:none; border-radius:8px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center;">
            <i class="fas fa-times"></i>
          </button>
          <div class="assign-dev-ids" hidden></div>
        `;
    container.appendChild(row);
  },

  _syncAssignDevices: function (row) {
    if (!row) return;
    const box = row.querySelector('.assign-dev-ids');
    const productId = row.querySelector('.assign-product-sel')?.value;
    if (!productId) { window.DeviceIds.hide(box); return; }
    window.DeviceIds.render(box, Number(row.querySelector('.assign-qty-inp')?.value) || 1);
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
    // [B] DEMIRBAŞ FİLTRESİ: yalnız demirbaş ürünler zimmetlenebilir. Karar tek kuraldan (Schema.isDemirbas: ürün türü
    //     tanımı önce) — yalnız kayıttaki bayrağa bakılınca türü demirbaş olan ürünler listelenmiyordu; Pasif/Hurda ürünler
    //     de öneriliyordu (ZIM-06).
    const fixtures = products.filter(p => {
      const hasStock = (p.adet || 0) > 0;
      const durum = window.Schema.normalizeStock(p, warehouse).durum;
      return hasStock && durum !== 'Pasif' && durum !== 'Hurda' && window.Schema.isDemirbas(p);
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
    if (!opt || !opt.dataset.max) { this._syncAssignDevices(row); return; }
    qtyInp.max = parseInt(opt.dataset.max) || 999;
    this._syncAssignDevices(row);
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
    // Personel id ile seçilir (3.7): zimmet kaydı personelId taşır, Kişi Envanterim addan bağımsız eşleşir.
    const personSel = document.getElementById('assignPersonnel')?.value?.trim();
    const personList = window.data?.personel || [];
    const person = personSel ? (personList.find(p => String(p.id) === personSel)
      || personList.find(p => window.Schema.normName(p.name || p.adSoyad) === window.Schema.normName(personSel))) : null;
    const personnelName = person ? String(person.name || person.adSoyad || '').trim() : personSel;
    const personelId = person?.id ?? null;
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
      const ids = window.DeviceIds.read(row.querySelector('.assign-dev-ids'));
      const key = `${warehouse}|${product.id}`;
      const prev = merged.get(key);
      if (prev) { prev.qty += qty; prev.ids.push(...ids); }
      else merged.set(key, { warehouse, product, qty, ids });
    }
    const items = [...merged.values()];
    if (items.length === 0) { alert('Lütfen en az bir ürün ekleyiniz!', 'warning'); return; }
    // 3.9a: her cihaz için Seri No veya Envanter No; aktif zimmette/serviste olan kimlik verilemez; iki satırda aynı cihaz olamaz
    const allIds = [];
    for (const it of items) {
      it.demirbas = window.Schema.isDemirbas(it.product);
      const chk = window.AssignmentService.checkDeviceIds({ demirbas: it.demirbas, qty: it.qty, ids: it.ids, label: `"${it.product.ürün || it.product.name}": ` });
      if (!chk.ok) { alert(chk.errors[0], 'warning'); return; }
      it.ids = chk.ids;
      if (it.demirbas) allIds.push(...chk.ids);
    }
    const dupCheck = window.Schema.validateDeviceIds({ demirbas: true, qty: allIds.length, ids: allIds });
    if (!dupCheck.ok) { alert(dupCheck.errors[0], 'warning'); return; }
    for (const it of items) {
      const stock = Number(it.product.adet ?? it.product.qty ?? 0);
      if (it.qty > stock) { alert(`${it.product.ürün || it.product.name} için yeterli stok yok! (Mevcut: ${stock}, İstenen: ${it.qty})`, 'error'); return; }
    }

    // [WHY] (H3 · 3.4): stok her kalem için ayrı transaction'la düşülüyor, b3 ve assignments ayrı ayrı yazılıyordu; b3
    //        başarısız olunca telafi (stok geri alma) da başarısız olabilir, assignments yazılamazsa zimmet geçmişi eksik kalırdı.
    // [HOW]: Tüm kalemlerin stok düşümü + b3 kayıtları + assignments kayıtları TEK transaction (runStockOps): ya hepsi ya hiçbiri.
    //        b3 ve assignments aynı id'yi paylaşır (iade ikisini birlikte bulur); id makeId ile.
    this._savingAssignment = true;
    try {
      const now = typeof getTurkiyeTarihi === 'function' ? getTurkiyeTarihi() : new Date().toLocaleDateString('tr-TR');
      const stock = [], writes = [];
      items.forEach(it => {
        stock.push({ col: it.warehouse, id: it.product.id, delta: -it.qty });
        // Demirbaş: cihaz başına bir kayıt (adet 1, kendi kimliği). Sarf (eski/elle tanımlı ürün): kalem başına tek kayıt.
        const units = it.demirbas ? it.ids.map(d => ({ adet: 1, ...d })) : [{ adet: it.qty, sn: it.ids[0]?.sn || '-', envanterNo: it.ids[0]?.envanterNo || '-' }];
        units.forEach(u => {
          const id = window.makeId();
          // Kanonik b3 zimmet kaydı (3.6) — talep onayı ve çıkışlarla aynı kurucu; tür/raf/depo yazma anında kopyalanır.
          writes.push({ op: 'set', col: 'b3', item: window.Schema.buildB3Entry({
            id, tip: 'zimmet', product: it.product, col: it.warehouse, adet: u.adet, sn: u.sn, envanterNo: u.envanterNo,
            not: not || `Admin Zimmeti (${talepTuru})`, alanKisi: personnelName, personelId,
            tarih: now, talepTuru, oncelik, iadeTarihi, onaylayan: window.currentUser?.name || 'Admin',
          }) });
          writes.push({ op: 'set', col: 'assignments', item: {
            id, sn: u.sn, envanterNo: u.envanterNo, talepTuru, oncelik, isDemirbas: it.demirbas, iadeEdildi: false,
            productId: it.product.id, sourceRepo: it.warehouse, personelId,
            ...(iadeTarihi ? { iadeTarihi } : {}),
            ürün: it.product.ürün || it.product.name || '-',
            personel: personnelName, tarih: now, adet: u.adet, not, tip: 'zimmet',
          } });
        });
      });

      const res = await window.runStockOps({ stock, writes });
      const changes = res.stock.map(r => `${r.col.toUpperCase()} ${r.name}: ${r.before} → ${r.after}`).join(' · ');
      alert(`${personnelName} adına ${items.length} kalem zimmet başarıyla oluşturuldu. Stok: ${changes}`, 'success');
      this.closeAssignModal();
      this.renderTable();
    } catch (err) {
      console.error('Zimmet kayıt hatası:', err);
      alert(`Zimmet kaydedilemedi; hiçbir şey yazılmadı. ${err.message || ''}`, 'error');
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
    if (!window.requireDbAdmin('Zimmet iadesi')) return;   // Faz 4 · J1 (M5): assignments yalnız admin (depoya dönmeyen dal kapısızdı)
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
      if (!(await window.writeOk(window.updateItem('requests', req.id, { iadeEdildi: true, iadeEdildiTarihi: today })))) { alert('İade kaydedilemedi.', 'error'); return; }
      this.renderTable();
      alert('Zimmet kaydı kapatıldı.', 'success');
      return;
    }

    const item = (window.data.b3 || []).find(sameId);
    if (!item) { alert('Kayıt bulunamadı; liste güncellenmiş olabilir.', 'error'); return; }
    if (item.iadeEdildi) { alert('Bu zimmet zaten iade edilmiş.', 'info'); return; }

    const view = window.Schema.normalizeB3(item);
    const qty = view.adet || 1;
    const stockLinked = view.kaynakDepo === 'b1' || view.kaynakDepo === 'b2';
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
        const name = String(view.urunAciklama === '-' ? '' : view.urunAciklama).trim().toLocaleLowerCase('tr-TR');
        const byName = list.filter(p => String(p.ürün || p.name || '').trim().toLocaleLowerCase('tr-TR') === name);
        if (byName.length === 1) product = byName[0];
      }
      if (!product) { alert(`${target.toUpperCase()} deposunda bu ürün tek ve kesin olarak bulunamadı; iade yapılmadı.`, 'error'); return; }
    }

    // [WHY] (H3 · 3.4): stok iadesi, b3, assignments ve bağlı talep ayrı ayrı yazılıyordu; b3 başarısız olunca stok telafisi de
    //        başarısız olabilirdi, assignments/talep güncellemesi başarısız olursa zimmet yarı kapalı kalırdı.
    // [HOW]: Stok +adet (depoya iade varsa) + b3 + assignments + talep güncellemeleri TEK transaction: ya hepsi ya hiçbiri.
    const closeFields = { iadeEdildi: true, iadeDepo: target, iadeEdildiTarihi: today };
    const writes = [{ op: 'update', col: 'b3', id: item.id, fields: closeFields }];
    if ((window.data.assignments || []).some(sameId)) writes.push({ op: 'update', col: 'assignments', id: item.id, fields: closeFields });
    // Talep, ona bağlı cihazların (3.9a: cihaz başına bir b3 kaydı) hepsi iade edilince kapanır.
    const otherActiveUnits = item.requestId == null ? [] : (window.data.b3 || []).filter(b => String(b.requestId) === String(item.requestId)
      && String(b.id) !== String(item.id) && !window.Schema.normalizeB3(b).iadeEdildi);
    if (item.requestId != null && otherActiveUnits.length === 0 && (window.data.requests || []).some(r => String(r.id) === String(item.requestId))) {
      writes.push({ op: 'update', col: 'requests', id: item.requestId, fields: { iadeEdildi: true, iadeEdildiTarihi: today } });
    }
    let stockChange = null;
    try {
      if (target) {
        const res = await window.runStockOps({ stock: [{ col: target, id: product.id, delta: qty }], writes }, { forbiddenMessage: 'İade işlemi yalnızca sistem yöneticisi tarafından yapılabilir.' });
        stockChange = res.stock[0];
      } else {
        await window.applyItemOps(writes);
      }
    } catch (e) {
      alert(`İade kaydedilemedi; hiçbir değişiklik yapılmadı. ${e.message || ''}`, 'error');
      return;
    }

    this.renderTable();
    alert(target
      ? `Zimmet düşüldü ve ${target.toUpperCase()} deposuna iade edildi.${stockChange ? ` Stok: ${stockChange.before} → ${stockChange.after}` : ''}`
      : 'Zimmet kaydı kapatıldı (depo iadesi yapılmadı).', 'success');
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

  // [HOW] (3.9c): Birleşik cihaz geçmişi (zimmet, iade, çıkış, servis/sevk ve dönüşler) iki sayfada ortak pencereden gösterilir;
  //        kimlik Seri No veya Envanter No olabilir.
  showDeviceHistory: function (identity) {
    window.DeviceIds.showHistory(identity);
  },

  // 13. HIZLI EKLEME KISA YOLLARI [E][F]
  // [WHY] (Faz 5 · K3 · 5.2 · ZIM-05): Bu iki köprü `window.openPersonelModal`/`window.openProductModal`'ı çağırıyordu —
  //       ama o modaller (`#personelModal`, `#productModal`) yalnız index.html'de var; admin.html'de hiç yok. Üstelik
  //       `openProductModal`, yalnız index.html'de yüklenen `UIComponents`/`main.js`'e bağlı (admin.html onu hiç yüklemiyor).
  //       Sonuç: admin panelinde butona basınca ilgili fonksiyon modal bulamayıp sessizce hiçbir şey yapmıyordu.
  // [HOW]: Zimmet modülünün kendi deseni (_injectAssignModal — bir kez document.body'ye enjekte edilen, kendi kendine
  //        yeten modal) burada da tekrarlanır: admin.html'de başka hiçbir dosyaya bağımlı olmayan, kendi minik
  //        modalleri ve kaydetme mantığıyla (appendItem — K2'nin personel/B1/B2 şema sözleşmesinden geçer).
  _injectQuickPersonnelModal: function () {
    if (document.getElementById('quickPersonnelModal')) return;
    const modal = document.createElement('div');
    modal.id = 'quickPersonnelModal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(15,23,42,0.65); z-index:10600; align-items:center; justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--color-surface,#fff); border-radius:16px; width:380px; max-width:92vw; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.4);">
        <h4 style="margin:0 0 16px; font-weight:800; color:var(--color-text);"><i class="fas fa-user-plus" style="color:#16a34a; margin-right:8px;"></i>Yeni Personel Ekle</h4>
        <form id="quickPersonnelForm" autocomplete="off">
          <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Ad Soyad *</label>
          <input type="text" id="qpName" required style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); margin-bottom:14px;">
          <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Oturum Kodu</label>
          <input type="text" id="qpCode" readonly style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface-alt,#f1f5f9); color:var(--color-text-muted); margin-bottom:18px;">
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button type="button" onclick="window.inventoryManagementModule.closeQuickPersonnelModal()" style="padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);">Vazgeç</button>
            <button type="submit" style="padding:9px 18px; background:#16a34a; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">Kaydet</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('quickPersonnelForm').addEventListener('submit', e => {
      e.preventDefault();
      window.inventoryManagementModule._saveQuickPersonnel();
    });
  },

  quickAddPersonnel: function () {
    this._injectQuickPersonnelModal();
    const modal = document.getElementById('quickPersonnelModal');
    document.getElementById('qpName').value = '';
    document.getElementById('qpCode').value = typeof window.getRandomCode === 'function' ? window.getRandomCode() : String(Math.random()).slice(2, 7);
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('qpName')?.focus(), 50);
  },

  closeQuickPersonnelModal: function () {
    const modal = document.getElementById('quickPersonnelModal');
    if (modal) modal.style.display = 'none';
  },

  _saveQuickPersonnel: async function () {
    const alert = (m, t) => { if (typeof showAppAlert === 'function') showAppAlert(m, t); };
    const name = document.getElementById('qpName').value.trim();
    const code = document.getElementById('qpCode').value.trim();
    if (!name) { alert('Ad Soyad boş olamaz.', 'warning'); return; }
    // Faz 4B · J7.5: tek kod kuralı (staff-code-registry.js)
    const check = window.StaffCodeRegistry.validateCode(code, window.data.personel || []);
    if (!check.ok) { alert(check.message, 'warning'); return; }
    // Faz 4B · J7: id önceden üretilir; kayıttan hemen sonra aynı kişiye Auth hesabı açılır (staff-provisioning.js).
    const person = { id: window.makeId(), name, code };
    const res = await window.writeOk(window.appendItem('personel', person));
    if (!res) { alert('Personel eklenemedi.', 'error'); return; }
    this.closeQuickPersonnelModal();
    const acct = await window.StaffProvisioning.provisionWithNotice(person);
    alert(`"${name}" eklendi. ${acct.text}`, acct.ok ? 'success' : 'warning');
    // Zimmet modalındaki personel seçimini tazele ve yeni kişiyi otomatik seç.
    const select = document.getElementById('assignPersonnel');
    if (select) {
      const personeller = window.data?.personel || [];
      select.innerHTML = '<option value="">-- Personel Seçiniz --</option>' +
        personeller.map(p => `<option value="${escapeHtml(p.id ?? p.name ?? p.adSoyad)}">${escapeHtml(p.name || p.adSoyad)}</option>`).join('');
      const created = personeller.find(p => p.name === name && String(p.code) === code);
      if (created) select.value = String(created.id ?? created.name);
    }
  },

  _injectQuickProductModal: function () {
    if (document.getElementById('quickProductModal')) return;
    const modal = document.createElement('div');
    modal.id = 'quickProductModal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(15,23,42,0.65); z-index:10600; align-items:center; justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--color-surface,#fff); border-radius:16px; width:420px; max-width:92vw; padding:22px; box-shadow:0 24px 64px rgba(0,0,0,0.4);">
        <h4 style="margin:0 0 4px; font-weight:800; color:var(--color-text);"><i class="fas fa-box" style="color:#1d4ed8; margin-right:8px;"></i>Yeni Ürün Ekle</h4>
        <small style="color:var(--color-text-muted); display:block; margin-bottom:16px;">Yalnız zimmetlenebilir (demirbaş) ürün eklenir; raf/sütun konumu sonra Envanter sekmesinden düzenlenebilir.</small>
        <form id="quickProductForm" autocomplete="off">
          <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Depo *</label>
          <select id="qpDepo" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); margin-bottom:14px;">
            <option value="b1">B1 Deposu</option>
            <option value="b2">B2 Deposu</option>
          </select>
          <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Tür * (yalnız demirbaş türler listelenir)</label>
          <select id="qpType" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); margin-bottom:14px;"></select>
          <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Ürün Adı *</label>
          <input type="text" id="qpName2" required style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text); margin-bottom:14px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;">
            <div>
              <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Marka</label>
              <input type="text" id="qpBrand" style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text);">
            </div>
            <div>
              <label style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--color-text-muted); display:block; margin-bottom:6px;">Adet *</label>
              <input type="number" id="qpQty" value="1" min="1" required style="width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid var(--color-border); background:var(--color-surface); color:var(--color-text);">
            </div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button type="button" onclick="window.inventoryManagementModule.closeQuickProductModal()" style="padding:9px 16px; background:none; border:1px solid var(--color-border); border-radius:8px; cursor:pointer; color:var(--color-text);">Vazgeç</button>
            <button type="submit" style="padding:9px 18px; background:#1d4ed8; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">Kaydet</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('quickProductForm').addEventListener('submit', e => {
      e.preventDefault();
      window.inventoryManagementModule._saveQuickProduct();
    });
  },

  quickAddProduct: function () {
    this._injectQuickProductModal();
    const modal = document.getElementById('quickProductModal');
    // Zimmet akışı yalnız demirbaşı zimmetlediği için (onWarehouseChange) tür listesi de yalnız demirbaş türlerle sınırlanır.
    const types = (typeof window.getActiveProductTypes === 'function' ? window.getActiveProductTypes() : [])
      .filter(t => t.isDemirbas === true || t.isDemirbas === 'true');
    const typeSel = document.getElementById('qpType');
    typeSel.innerHTML = types.length
      ? types.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')
      : '<option value="">-- Önce Tanımlar\'dan demirbaş tür ekleyin --</option>';
    document.getElementById('qpName2').value = '';
    document.getElementById('qpBrand').value = '';
    document.getElementById('qpQty').value = '1';
    document.getElementById('qpDepo').value = 'b1';
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('qpName2')?.focus(), 50);
  },

  closeQuickProductModal: function () {
    const modal = document.getElementById('quickProductModal');
    if (modal) modal.style.display = 'none';
  },

  _saveQuickProduct: async function () {
    const alert = (m, t) => { if (typeof showAppAlert === 'function') showAppAlert(m, t); };
    const depo = document.getElementById('qpDepo').value;
    const tür = document.getElementById('qpType').value;
    const ürün = document.getElementById('qpName2').value.trim();
    const marka = document.getElementById('qpBrand').value.trim();
    const adet = parseInt(document.getElementById('qpQty').value, 10) || 0;
    if (!tür) { alert('Lütfen bir demirbaş tür seçin (yoksa önce Tanımlar sekmesinden ekleyin).', 'warning'); return; }
    if (!ürün) { alert('Ürün adı boş olamaz.', 'warning'); return; }
    if (!Number.isInteger(adet) || adet < 1) { alert('Adet en az 1 olan tam sayı olmalıdır.', 'warning'); return; }

    const item = {
      id: `${depo}_${window.makeId()}`, sütun: '', raf: '', tür, ürün, marka,
      adet, durumu: 'Kullanıma Hazır', açıklama: '', isDemirbas: true, lastUpdate: Date.now(),
    };
    if (depo === 'b2') item.status = 'Kullanıma Hazır';

    const res = await window.writeOk(window.appendItem(depo, item));
    if (!res) { alert('Ürün eklenemedi.', 'error'); return; }
    this.closeQuickProductModal();
    alert(`"${ürün}" ${depo.toUpperCase()} deposuna eklendi.`, 'success');

    // Zimmet satırlarından BİRİNİ bu yeni ürüne hazırla (depo + ürün seçili gelsin).
    const rows = document.querySelectorAll('#assignRowsContainer .assign-product-row');
    let target = [...rows].find(r => !r.querySelector('.assign-warehouse-sel')?.value);
    if (!target && rows.length) target = rows[rows.length - 1];
    if (target) {
      const wh = target.querySelector('.assign-warehouse-sel');
      wh.value = depo;
      this.onWarehouseChange(wh);
      const ps = target.querySelector('.assign-product-sel');
      if (ps) { ps.value = item.id; this.onProductChange(ps); }
    }
    // Aynı depodaki diğer satırların ürün listelerini de tazele (yeni ürün artık seçilebilir).
    document.querySelectorAll('#assignRowsContainer .assign-warehouse-sel').forEach(sel => {
      if (sel.value && sel !== (target && target.querySelector('.assign-warehouse-sel'))) this.onWarehouseChange(sel);
    });
  },
};

// Faz 5 · K3 (5.7 · ARC-07): showAdminTab'ı sarmalayan eski monkey-patch + 150ms'lik retry döngüsü kaldırıldı.
// script.js'te her zaman hazır olan merkezi kanca siciline (AppModules.AdminTabs) kaydolunuyor.
window.AppModules.AdminTabs.onShow('inventoryManagementTab', () => {
  if (window.data && window.inventoryManagementModule) {
    window.inventoryManagementModule.renderAdminInventoryTab();
  } else {
    setTimeout(() => { if (window.inventoryManagementModule) window.inventoryManagementModule.renderAdminInventoryTab(); }, 600);
  }
});
