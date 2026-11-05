/**
 * ui/device-ids.js — Demirbaş cihaz kimliği girişi (Faz 3.9a · saha notu 29.09 #3, ZIM-06)
 * Klasik script; iki sayfada assignment-service.js'ten sonra yüklenir.
 *
 * [WHY]: Demirbaş çıkışlarında seri no hiç sorulmuyor (sevk, talep onayı) ya da tek serbest alana yazılıyordu (sepette tüm
 *        kalemler için bir alan; zimmette aynı ürünün SN'leri virgülle birleşiyordu). Aynı cihaz iki kişiye zimmetlenebiliyordu.
 * [HOW]: Demirbaş kalemde adet kadar satır: her cihaz için Seri No ve Envanter No (en az biri zorunlu — sahibinin kararı,
 *        29.09). Doğrulama AssignmentService.checkDeviceIds (Schema.validateDeviceIds + aktif zimmet/servis kullanımı).
 *        Her cihaz ayrı bir kayıt olarak yazılır (adet 1), böylece tek tek iade/servis/geçmiş izlenebilir.
 */
(function () {
    const MAX_UNITS = 100;
    const esc = s => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s ?? ''));

    function injectStyle() {
        if (document.getElementById('deviceIdsStyle')) return;
        const st = document.createElement('style');
        st.id = 'deviceIdsStyle';
        st.textContent = `
            .dev-ids { border: 1px dashed var(--color-border, #cbd5e1); border-radius: 8px; padding: 8px 10px; margin: 8px 0;
                       background: var(--color-surface-alt, #f8fafc); color: var(--color-text, #1f2937); grid-column: 1 / -1; }
            .dev-ids[hidden] { display: none !important; }
            .dev-ids-head { font-size: 12px; font-weight: 700; color: var(--color-text-muted, #64748b); }
            .dev-ids-row { display: grid; grid-template-columns: 26px 1fr 1fr; gap: 6px; margin-top: 6px; align-items: center; }
            .dev-ids-no { font-size: 12px; font-weight: 700; color: var(--color-text-muted, #64748b); text-align: right; }
            .dev-ids input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; font-size: 13px; font-family: monospace;
                             border: 1px solid var(--color-border, #cbd5e1); background: var(--color-surface, #fff); color: var(--color-text, #1f2937); margin: 0; }
            .dev-ids-hint { font-size: 11px; color: var(--color-text-muted, #64748b); margin-top: 6px; }
            .dev-ids-warn { font-size: 12px; color: var(--color-danger, #e74c3c); margin-top: 6px; }`;
        document.head.appendChild(st);
    }

    const DeviceIds = {
        MAX_UNITS,

        // Konteynere qty kadar satır çizer; mevcut değerler (values ya da ekrandakiler) sırayla korunur.
        render(container, qty, { values, onInput } = {}) {
            if (!container) return;
            injectStyle();
            const prev = values || this.read(container);
            const want = Math.max(0, Number(qty) || 0);
            const n = Math.min(want, MAX_UNITS);
            container.classList.add('dev-ids');
            container.hidden = false;
            let html = `<div class="dev-ids-head">🛡️ Demirbaş · cihaz kimlikleri (${n} cihaz) — her satırda Seri No veya Envanter No, en az biri zorunlu</div>`;
            for (let i = 0; i < n; i++) {
                const v = prev[i] || {};
                html += `<div class="dev-ids-row" data-unit="${i}"><span class="dev-ids-no">${i + 1}.</span>
                    <input type="text" class="dev-sn" placeholder="Seri No" autocomplete="off" value="${esc(v.sn && v.sn !== '-' ? v.sn : '')}">
                    <input type="text" class="dev-env" placeholder="Envanter No" autocomplete="off" value="${esc(v.envanterNo && v.envanterNo !== '-' ? v.envanterNo : '')}"></div>`;
            }
            if (want > MAX_UNITS) html += `<div class="dev-ids-warn">Tek seferde en fazla ${MAX_UNITS} demirbaş cihaz işlenebilir.</div>`;
            container.innerHTML = html;
            if (typeof onInput === 'function') container.oninput = () => onInput(this.read(container));
        },

        read(container) {
            if (!container) return [];
            return [...container.querySelectorAll('.dev-ids-row')].map(r => ({
                sn: (r.querySelector('.dev-sn')?.value || '').trim(),
                envanterNo: (r.querySelector('.dev-env')?.value || '').trim(),
            }));
        },

        hide(container) {
            if (!container) return;
            container.hidden = true;
            container.innerHTML = '';
            container.oninput = null;
        },

        // Çıkış modalı: seçili ürün demirbaşsa serbest "ITSM / Gerekçe" alanı yerine adet kadar kimlik satırı.
        syncExitForm() {
            const box = document.getElementById('exitDeviceIds');
            const sel = document.getElementById('selectedProduct');
            const snInput = document.getElementById('exitSn');
            const snLabel = snInput ? snInput.closest('label') : null;
            const dem = !!sel && sel.dataset.isDemirbas === 'true' && !!sel.dataset.id;
            if (!box) return;
            if (dem) {
                this.render(box, Number(document.getElementById('exitQty')?.value) || 1);
                if (snLabel) snLabel.style.display = 'none';
                if (snInput) snInput.required = false;
            } else {
                this.hide(box);
                if (snLabel) snLabel.style.display = '';
                if (snInput) snInput.required = true;
            }
        },
    };

    // ─── 3.9c · Önceki servis kayıtları (sevk ekranı) ve cihaz geçmişi penceresi (iki sayfada ortak) ───
    DeviceIds.renderServiceHint = function (container, { productId, ids = [] } = {}) {
        if (!container) return;
        const recs = window.AssignmentService.serviceRecordsFor({ productId, ids });
        if (!recs.length) { container.innerHTML = ''; return; }
        const idText = r => [r.sn && r.sn !== '-' ? `SN ${r.sn}` : '', r.envanterNo && r.envanterNo !== '-' ? `Env ${r.envanterNo}` : ''].filter(Boolean).join(' · ');
        const firstId = r => (r.sn && r.sn !== '-' ? r.sn : (r.envanterNo && r.envanterNo !== '-' ? r.envanterNo : ''));
        container.innerHTML = `<div class="dev-ids" style="border-style:solid;">
            <div class="dev-ids-head">🗂️ Önceki servis / sevk kayıtları (${recs.length})</div>
            ${recs.slice(0, 6).map(r => `<div class="dev-ids-hint" style="color:var(--color-text, #1f2937);">• ${esc(r.sevkTarihi || '-')} → ${esc(r.hedef || '-')} · <b>${esc(r.durum || '-')}</b>${r.kapandi ? ` (dönüş ${esc(r.donusTarihi || '-')})` : ''}${idText(r) ? ` · ${esc(idText(r))}` : ''}
                ${firstId(r) ? ` <a href="#" data-history="${esc(firstId(r))}" style="color:var(--color-primary, #3498db);">geçmiş</a>` : ''}</div>`).join('')}
            ${recs.length > 6 ? `<div class="dev-ids-hint">… ve ${recs.length - 6} kayıt daha.</div>` : ''}
        </div>`;
        container.querySelectorAll('[data-history]').forEach(a => { a.onclick = e => { e.preventDefault(); DeviceIds.showHistory(a.dataset.history); }; });
    };

    DeviceIds.showHistory = function (identity) {
        if (!identity || identity === '-') {
            if (typeof window.showAppAlert === 'function') window.showAppAlert('Bu cihaz için Seri No / Envanter No kaydı yok.', 'warning');
            return;
        }
        injectStyle();
        const events = window.AssignmentService.getDeviceHistory(identity);
        document.getElementById('deviceHistoryModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'deviceHistoryModal';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.7); z-index:12000; display:flex; align-items:center; justify-content:center;';
        const th = 'padding:10px 12px; text-align:left; font-weight:700; color:var(--color-text-muted, #64748b); text-transform:uppercase; font-size:11px;';
        const td = 'padding:9px 12px; font-size:12px; color:var(--color-text, #1f2937); border-bottom:1px solid var(--color-border, #e5e7eb);';
        const services = events.filter(e => /sevk/.test(e.tur)).length;
        modal.innerHTML = `
          <div style="background:var(--color-surface, #fff); color:var(--color-text, #1f2937); border:1px solid var(--color-border, #e5e7eb); border-radius:16px; width:860px; max-width:96vw; max-height:88vh; overflow-y:auto; box-shadow:0 24px 64px rgba(0,0,0,0.4);">
            <div style="padding:18px 22px; border-bottom:1px solid var(--color-border, #e5e7eb); display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:var(--color-surface, #fff);">
              <div>
                <h4 style="margin:0; font-weight:800; font-size:1.1rem;">🕘 Cihaz Geçmişi</h4>
                <div style="margin-top:4px; font-size:13px; color:var(--color-text-muted, #64748b);">Seri No / Envanter No: <code style="font-weight:700; color:var(--color-primary, #3498db);">${esc(identity)}</code>
                  · ${events.length} kayıt · ${services} servis/sevk</div>
              </div>
              <button type="button" data-close style="background:none; border:none; font-size:22px; cursor:pointer; color:var(--color-text-muted, #64748b);">&times;</button>
            </div>
            <div style="padding:16px 22px;">
              <table style="width:100%; border-collapse:collapse;">
                <thead><tr><th style="${th}">#</th><th style="${th}">Tarih</th><th style="${th}">Hareket</th><th style="${th}">Kişi</th><th style="${th}">Yer / Hedef</th><th style="${th}">Ürün</th><th style="${th}">Not</th></tr></thead>
                <tbody>${events.length ? events.map((e, i) => `<tr><td style="${td}">${i + 1}</td><td style="${td} white-space:nowrap;">${esc(e.tarih)}</td><td style="${td} font-weight:700;">${esc(e.tur)}</td><td style="${td}">${esc(e.kisi)}</td><td style="${td}">${esc(e.yer)}</td><td style="${td}">${esc(e.urun)}</td><td style="${td}">${esc(e.not)}</td></tr>`).join('')
                    : `<tr><td colspan="7" style="${td} text-align:center; padding:28px;">Bu kimlikle eşleşen kayıt bulunamadı.</td></tr>`}</tbody>
              </table>
            </div>
          </div>`;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('[data-close]').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
    };

    window.DeviceIds = DeviceIds;
    window.AppModules = window.AppModules || {};
    window.AppModules.DeviceIds = DeviceIds;
})();
