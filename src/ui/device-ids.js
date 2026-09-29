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

        // Çıkış modalı: seçili ürün demirbaşsa serbest "SN / BioPro / Itsm" alanı yerine adet kadar kimlik satırı.
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

    window.DeviceIds = DeviceIds;
    window.AppModules = window.AppModules || {};
    window.AppModules.DeviceIds = DeviceIds;
})();
