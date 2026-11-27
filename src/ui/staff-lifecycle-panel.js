/**
 * ui/staff-lifecycle-panel.js — v3.8 · VP-3 · Personel Hesap Yaşam Döngüsü Arayüzü.
 * Klasik script; iki sayfada klasik zincirden sonra yüklenir → window.AppModules.StaffLifecyclePanel.
 * Veri yalnız window.AppModules.StaffLifecycleService üzerinden (Firebase SDK yok); DOM API / textContent (innerHTML yok).
 *
 * [WHY]: Giriş ekranında 24 saat limitli şifre sıfırlama talebi ve geçici PIN sonrası zorunlu yeni kod belirleme;
 *        yönetici panelinde açık taleplerin tek tıkla çözülmesi, tek seferlik güvenli kopyalama penceresi ve
 *        geçmişi bozmadan hesap askıya alma / yeniden aktifleştirme akışları tek erişilebilir arayüz modülünde toplanır.
 * [HOW]: - AGENTS.md: her panel/pencere kısa görünür açıklama + erişilebilir ⓘ yardım alanı taşır.
 *        - CTO Güvenlik Direktifi: tek seferlik kod penceresi kapandığında bellek değişkeni sıfırlanır ve DOM temizlenir.
 *        - Oturumsuz sıfırlama talebi tek tip nötr mesaj gösterir (hesap varlığı / 24s durumu sızdırılmaz).
 */
(function () {
    'use strict';

    const PANEL_DESC = 'Personelin giriş ekranından gönderdiği 24 saat limitli şifre sıfırlama taleplerini yönetin, seçili aktif personele tek kullanımlık süreli geçici PIN tanımlayın veya geçmiş EBYS/zimmet kayıtlarını bozmadan hesapları askıya alın.';
    const PANEL_HELP = [
        ['24 saatlik talep sınırı', 'Personel giriş ekranından aynı kurumsal kimlik (PRI) için 24 saatte en fazla 1 şifre sıfırlama talebi bırakabilir. Sınır sunucu kurallarıyla zorlanır; oturumsuz ekrana hesap bilgisi sızmaz.'],
        ['Geçici PIN (sekme kilidinden bağımsız)', 'Burada üretilen 6 haneli tek kullanımlık geçici PIN, yönetici panelindeki sekme kilidi PIN\'inden tamamen bağımsızdır. Personel ilk girişte kendi kişisel kodunu belirlemek zorundadır; süre dolduğunda kod sunucuda geçersiz olur.'],
        ['Tek seferlik kopyalama', 'Üretilen geçici PIN veya sıfırlama kodu veritabanına, loglara veya URL\'ye yazılmaz. Yalnız oluşturulduğu anda bir kez gösterilir; pencere kapatıldığında bellekten ve ekrandan silinir.'],
        ['Askıya alma ve geçmiş koruma', 'Hesap silinmez (deleteDoc yasaktır). Askıya alınan hesap anında oturum dışı kalır; geçmiş zimmet, talep, B3 ve EBYS evrak sahipliği eksiksiz korunur. Yönetici yetkili hesaplara yalnız ana yönetici dokunabilir.'],
    ];

    const el = (tag, css, text) => {
        const n = document.createElement(tag);
        if (css) n.style.cssText = css;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
    };

    const fmtTs = ms => {
        if (!ms) return '-';
        try {
            return new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        } catch (_) {
            return '-';
        }
    };

    const getSL = () => (window.AppModules && window.AppModules.StaffLifecycle) || window.StaffLifecycle || null;
    const getSvc = () => (window.AppModules && window.AppModules.StaffLifecycleService) || null;
    const notify = (msg, type = 'info') => {
        if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type);
        else window.alert(msg);
    };

    // [WHY]: v3.8 HF-2 · --color-card ve --color-input-bg projede tanımlı olmadığı için [data-theme="dark"] (Space Titanium)
    //        altında modal kartları, select/input kutuları ve bilgi alanları #ffffff beyaz zemine düşüyordu.
    // [HOW]: Aktif temayı (data-theme="dark") okuyup projenin gerçek --color-surface / --color-surface-alt / --color-border
    //        değişkenlerini yüksek kontrastlı Space Titanium / Warm Platinum yedekleriyle döndürür.
    function isDarkTheme() {
        if (typeof document === 'undefined') return false;
        const rootTheme = document.documentElement && document.documentElement.getAttribute('data-theme');
        const bodyTheme = document.body && document.body.getAttribute('data-theme');
        return rootTheme === 'dark' || bodyTheme === 'dark';
    }

    function getThemePalette() {
        const dark = isDarkTheme();
        return dark ? {
            dark: true,
            overlayBg: 'rgba(2, 6, 23, 0.78)',
            cardBg: 'var(--color-surface, #161f30)',
            surfaceAlt: 'var(--color-surface-alt, #0f172a)',
            inputBg: 'var(--color-surface-alt, #0f172a)',
            optionBg: '#0f172a',
            optionText: '#f1f5f9',
            text: 'var(--color-text, #f1f5f9)',
            textMuted: 'var(--color-text-muted, #94a3b8)',
            border: 'var(--color-border, #334155)',
            shadow: '0 24px 64px rgba(2, 6, 23, 0.65)',
            infoBg: 'rgba(59, 130, 246, 0.16)',
            infoBorder: 'rgba(96, 165, 250, 0.45)',
            infoText: '#60a5fa',
            warnBg: 'rgba(245, 158, 11, 0.16)',
            warnBorder: 'rgba(251, 191, 36, 0.45)',
            warnText: '#fbbf24',
            okBg: 'rgba(16, 185, 129, 0.16)',
            okBorder: 'rgba(52, 211, 153, 0.45)',
            okText: '#34d399',
            dangerText: '#f87171',
            doneBtnBg: '#334155',
            doneBtnBorder: '1px solid #475569',
        } : {
            dark: false,
            overlayBg: 'rgba(15, 23, 42, 0.62)',
            cardBg: 'var(--color-surface, #ffffff)',
            surfaceAlt: 'var(--color-surface-alt, #f8fafc)',
            inputBg: 'var(--color-surface, #ffffff)',
            optionBg: '#ffffff',
            optionText: '#0f172a',
            text: 'var(--color-text, #0f172a)',
            textMuted: 'var(--color-text-muted, #475569)',
            border: 'var(--color-border, #cbd5e1)',
            shadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
            infoBg: 'rgba(37, 99, 235, 0.08)',
            infoBorder: '#2563eb',
            infoText: '#2563eb',
            warnBg: 'rgba(217, 119, 6, 0.1)',
            warnBorder: 'rgba(217, 119, 6, 0.4)',
            warnText: '#b45309',
            okBg: 'rgba(22, 163, 74, 0.1)',
            okBorder: 'rgba(22, 163, 74, 0.35)',
            okText: '#15803d',
            dangerText: '#dc2626',
            doneBtnBg: '#0f172a',
            doneBtnBorder: 'none',
        };
    }

    function styleSelectOptions(selectEl, pal) {
        if (!selectEl || !pal) return;
        Array.from(selectEl.options || []).forEach(opt => {
            opt.style.backgroundColor = pal.optionBg;
            opt.style.color = pal.optionText;
        });
    }

    // [WHY]: Her modalda erişilebilir kapatma, odak temizliği ve Escape desteği tek yerden sağlanmalı.
    // [HOW]: Sabit z-index'li backdrop + kart oluşturur; cleanup çağrılınca DOM düğümü tamamen kaldırılır.
    function createModalShell({ id, titleText, descText, helpItems, maxWidth = '540px', onClose }) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        const pal = getThemePalette();

        const overlay = el('div', `position:fixed; inset:0; background:${pal.overlayBg}; backdrop-filter:blur(4px); z-index:11200; display:flex; align-items:center; justify-content:center; padding:16px;`);
        overlay.id = id;
        overlay.className = 'slp-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', `${id}Title`);

        const card = el('div', `width:min(100%, ${maxWidth}); max-height:90vh; overflow-y:auto; background:${pal.cardBg}; color:${pal.text}; border:1px solid ${pal.border}; border-radius:14px; padding:20px; box-shadow:${pal.shadow};`);
        card.className = 'slp-modal';

        const head = el('div', 'display:flex; align-items:flex-start; gap:12px; margin-bottom:8px;');
        const h = el('h4', `margin:0; font-size:1.1rem; font-weight:800; flex:1; color:${pal.text};`, titleText);
        h.id = `${id}Title`;
        const closeBtn = el('button', `padding:6px 12px; background:${pal.surfaceAlt}; border:1px solid ${pal.border}; border-radius:8px; cursor:pointer; color:${pal.text}; font-weight:600;`, 'Kapat');
        closeBtn.type = 'button';
        head.append(h, closeBtn);
        card.appendChild(head);

        if (descText) {
            card.appendChild(el('p', `margin:0 0 10px; font-size:13px; line-height:1.45; color:${pal.textMuted};`, descText));
        }

        if (Array.isArray(helpItems) && helpItems.length) {
            const helpId = `${id}Help`;
            const helpBtn = el('button', `margin-bottom:10px; padding:4px 10px; border-radius:999px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.infoText}; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px;`);
            helpBtn.type = 'button';
            helpBtn.setAttribute('aria-expanded', 'false');
            helpBtn.setAttribute('aria-controls', helpId);
            const icon = el('i');
            icon.className = 'fas fa-info-circle';
            icon.setAttribute('aria-hidden', 'true');
            helpBtn.append(icon, document.createTextNode(' Nasıl çalışır?'));

            const helpBox = el('div', `margin:0 0 12px; padding:10px 12px; border-radius:10px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:12px; line-height:1.5;`);
            helpBox.id = helpId;
            helpBox.hidden = true;
            const ul = el('ul', 'margin:0; padding-left:18px;');
            helpItems.forEach(([k, v]) => {
                const li = el('li', 'margin-bottom:4px;');
                li.append(el('strong', null, `${k}: `), document.createTextNode(v));
                ul.appendChild(li);
            });
            helpBox.appendChild(ul);
            helpBtn.addEventListener('click', () => {
                const open = helpBox.hidden;
                helpBox.hidden = !open;
                helpBtn.setAttribute('aria-expanded', String(open));
            });
            card.append(helpBtn, helpBox);
        }

        const body = el('div', 'display:flex; flex-direction:column; gap:12px;');
        card.appendChild(body);
        overlay.appendChild(card);

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey);
            if (typeof onClose === 'function') {
                try { onClose(); } catch (_) { /* yoksay */ }
            }
            overlay.textContent = '';
            overlay.remove();
        };
        const onKey = e => { if (e.key === 'Escape') close(); };
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(overlay);
        return { overlay, card, body, close, closeBtn };
    }

    async function copyToClipboard(text, btn, defaultLabel) {
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
                btn.textContent = '✓ Kopyalandı';
                setTimeout(() => { if (btn.isConnected) btn.textContent = defaultLabel; }, 1800);
                return;
            }
        } catch (_) { /* yedek yol */ }
        notify('Tarayıcı otomatik kopyalamaya izin vermedi; metni kutudan elle seçip kopyalayın.', 'warning');
    }

    // ─── 1. Yalnız 1 Kez Görünen Güvenli Kopyalama Penceresi (CTO Direktifi #3) ──────────────────────
    // [WHY]: Üretilen geçici PIN veya sıfırlama kodu DB/log'da saklanmaz; yalnız bir kez gösterilip kapanınca silinmelidir.
    // [HOW]: Kapatma anında secretCode değişkeni '' yapılır, kod ve komut kutularının textContent'i boşaltılıp DOM kaldırılır.
    function showOneTimeSecretModal(result) {
        return new Promise(resolve => {
            let secretCode = String((result && result.oneTimeCode) || '');
            let offlineCmd = String((result && result.offlineCommand) || '');
            if (result && typeof result === 'object') result.oneTimeCode = '';

            const isPin = !result || result.mode !== 'resetCode';
            const SL = getSL();
            const ttlText = SL && result && result.ttlMinutes ? SL.formatTtlLabel(result.ttlMinutes) : '1 saat';
            const expText = fmtTs(result && result.expiresAtMs);

            let codeDisplay = null;
            let cmdDisplay = null;

            const shell = createModalShell({
                id: 'vp3OneTimeSecretModal',
                titleText: isPin ? '🔑 Geçici PIN Oluşturuldu (Yalnız 1 Kez Gösterilir)' : '🔑 Yeni Giriş Kodu Üretildi (Yalnız 1 Kez Gösterilir)',
                descText: 'Bu kodu personele güvenli bir kanaldan iletin. Kod sistemde saklanmaz; bu pencere kapatıldığında bir daha görüntülenemez.',
                helpItems: [
                    ['Tek kullanımlık kilit', 'Personel bu kodla giriş yaptığında uygulama açılmadan önce kendi kişisel yeni giriş kodunu belirlemek zorundadır.'],
                    ['Sekme kilidinden bağımsız', 'Bu kod yalnızca personelin giriş oturumu içindir; yönetici sekme kilidi PIN\'ini etkilemez.'],
                ],
                maxWidth: '520px',
                onClose: () => {
                    secretCode = '';
                    offlineCmd = '';
                    if (codeDisplay) codeDisplay.textContent = '';
                    if (cmdDisplay) cmdDisplay.textContent = '';
                    resolve();
                },
            });

            const pal = getThemePalette();
            const meta = el('div', `padding:10px 12px; border-radius:10px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:13px; line-height:1.5;`);
            meta.append(
                el('div', null, `Personel: ${(result && result.name) || '-'}`),
                el('div', null, `Kurumsal Kimlik (PRI): ${(result && result.pri) || '-'}`),
                el('div', null, `Geçerlilik Süresi: ${ttlText} (Son kullanım: ${expText})`)
            );
            shell.body.appendChild(meta);

            const codeWrap = el('div', `padding:14px; border-radius:12px; background:${pal.infoBg}; border:1px dashed ${pal.infoBorder}; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;`);
            codeWrap.className = 'slp-secret-box';
            codeDisplay = el('code', `font-size:1.45rem; font-weight:800; letter-spacing:0.12em; user-select:all; color:${pal.text};`, secretCode);
            const copyBtn = el('button', 'padding:8px 14px; border-radius:8px; border:none; background:#2563eb; color:#fff; font-weight:700; cursor:pointer;', 'Kodu Kopyala');
            copyBtn.type = 'button';
            copyBtn.addEventListener('click', () => copyToClipboard(secretCode, copyBtn, 'Kodu Kopyala'));
            codeWrap.append(codeDisplay, copyBtn);
            shell.body.appendChild(codeWrap);

            if (result && result.authUpdated) {
                shell.body.appendChild(el('div', `padding:10px 12px; border-radius:10px; background:${pal.okBg}; border:1px solid ${pal.okBorder}; color:${pal.okText}; font-size:13px; font-weight:600;`,
                    '✔ Firebase Auth parolası doğrudan güncellendi ve ilk girişte zorunlu kod değişimi etkinleştirildi.'));
            } else if (result && result.offlineRequired) {
                const warnBox = el('div', `padding:12px; border-radius:10px; background:${pal.warnBg}; border:1px solid ${pal.warnBorder}; color:${pal.text}; font-size:12.5px; line-height:1.5;`);
                warnBox.className = 'slp-cmd-box';
                warnBox.append(
                    el('div', `font-weight:700; color:${pal.warnText}; margin-bottom:6px;`, '⚠ Spark Planı Auth Adımı Gerekli (Eski Kod Bilinmiyor)'),
                    el('p', 'margin:0 0 8px;', 'Veritabanında geçici kod kilidi (mustChangeCode) ve denetim kaydı işlendi. Eski parola girilmediği için Firebase Auth parolasını UID bozulmadan uygulamak üzere yerel yönetici terminalinde aşağıdaki parolasız komutu çalıştırıp yukarıdaki kodu gizli isteme yapıştırın:')
                );
                cmdDisplay = el('pre', 'margin:0 0 8px; padding:8px 10px; border-radius:8px; background:rgba(15,23,42,0.92); color:#e2e8f0; border:1px solid rgba(148,163,184,0.25); font-size:11.5px; overflow-x:auto; white-space:pre-wrap; word-break:break-all;', offlineCmd);
                const copyCmdBtn = el('button', `padding:6px 12px; border-radius:8px; border:1px solid ${pal.warnText}; background:transparent; color:${pal.warnText}; font-weight:700; font-size:12px; cursor:pointer;`, 'Komutu Kopyala');
                copyCmdBtn.type = 'button';
                copyCmdBtn.addEventListener('click', () => copyToClipboard(offlineCmd, copyCmdBtn, 'Komutu Kopyala'));
                warnBox.append(cmdDisplay, copyCmdBtn);
                shell.body.appendChild(warnBox);
            }

            const foot = el('div', 'display:flex; justify-content:flex-end; margin-top:4px;');
            const doneBtn = el('button', `padding:9px 18px; border-radius:8px; border:${pal.doneBtnBorder}; background:${pal.doneBtnBg}; color:#fff; font-weight:700; cursor:pointer;`, 'Kodu Aldım, Pencereyi Temizle');
            doneBtn.type = 'button';
            doneBtn.addEventListener('click', shell.close);
            foot.appendChild(doneBtn);
            shell.body.appendChild(foot);
        });
    }

    // ─── 2. Personel Zorunlu İlk Giriş Kod Değiştirme Modalı (index.html) ────────────────────────────
    // [WHY]: Geçici PIN ile giriş yapan personel kendi yeni gizli kodunu belirlemeden uygulama verilerine erişemez.
    // [HOW]: Kendi Auth oturumunda updatePassword + staffAccounts self-clear + auditLogs çalıştırır; kapanınca inputları sıfırlar.
    function promptMandatoryCodeChange({ pri = '', currentCode = '', expiresAtMs = null } = {}) {
        return new Promise(resolve => {
            let resolved = false;
            const finish = ok => {
                if (resolved) return;
                resolved = true;
                resolve(ok);
            };

            const inp1 = document.createElement('input');
            const inp2 = document.createElement('input');
            const shell = createModalShell({
                id: 'vp3MandatoryCodeModal',
                titleText: '🔐 Yeni Giriş Kodunuzu Belirleyin',
                descText: 'Geçici kodunuz doğrulandı. Hesabınızın açılması için şimdi yalnız sizin bileceğiniz yeni bir giriş kodu belirlemelisiniz.',
                helpItems: [
                    ['Güçlü kod kuralı', 'En az 4 karakter, boşluksuz olmalı; 12345, 00000 veya ardışık/tekrarlı zayıf kalıplar kabul edilmez.'],
                    ['Tek kullanımlık geçici kod', 'Yeni kodunuz kaydedildiği anda eski geçici PIN geçersiz olur ve sistem doğrudan açılır.'],
                ],
                maxWidth: '460px',
                onClose: () => {
                    inp1.value = '';
                    inp2.value = '';
                    finish(false);
                },
            });

            const pal = getThemePalette();
            if (pri || expiresAtMs) {
                const info = el('div', `padding:8px 12px; border-radius:8px; background:${pal.infoBg}; border:1px solid ${pal.border}; color:${pal.text}; font-size:12.5px;`);
                info.textContent = `Hesap: ${pri || '-'}${expiresAtMs ? ` · Geçici kod son geçerlilik: ${fmtTs(expiresAtMs)}` : ''}`;
                shell.body.appendChild(info);
            }

            const form = document.createElement('form');
            form.autocomplete = 'off';
            form.style.cssText = 'display:flex; flex-direction:column; gap:10px;';

            const lbl1 = el('label', `font-size:13px; font-weight:700; color:${pal.text};`, 'Yeni giriş kodunuz');
            inp1.type = 'password';
            inp1.className = 'slp-input';
            inp1.autocomplete = 'new-password';
            inp1.placeholder = 'En az 4 karakter (güçlü kod)';
            inp1.required = true;
            inp1.style.cssText = `width:100%; padding:10px 12px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.inputBg}; color:${pal.text};`;

            const lbl2 = el('label', `font-size:13px; font-weight:700; color:${pal.text};`, 'Yeni giriş kodu (tekrar)');
            inp2.type = 'password';
            inp2.className = 'slp-input';
            inp2.autocomplete = 'new-password';
            inp2.placeholder = 'Yeni kodu tekrar girin';
            inp2.required = true;
            inp2.style.cssText = inp1.style.cssText;

            const statusEl = el('div', 'font-size:12.5px; min-height:18px;');
            statusEl.setAttribute('aria-live', 'polite');

            const actions = el('div', 'display:flex; justify-content:flex-end; gap:8px; margin-top:4px;');
            const cancelBtn = el('button', `padding:9px 14px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; cursor:pointer; font-weight:600;`, 'Çıkış Yap');
            cancelBtn.type = 'button';
            cancelBtn.addEventListener('click', shell.close);
            const saveBtn = el('button', 'padding:9px 18px; border-radius:8px; border:none; background:#2563eb; color:#fff; font-weight:700; cursor:pointer;', 'Yeni Kodu Kaydet ve Gir');
            saveBtn.type = 'submit';
            actions.append(cancelBtn, saveBtn);

            form.append(lbl1, inp1, lbl2, inp2, statusEl, actions);
            shell.body.appendChild(form);

            form.addEventListener('submit', async e => {
                e.preventDefault();
                const SL = getSL();
                const svc = getSvc();
                const c1 = inp1.value.trim();
                const c2 = inp2.value.trim();
                if (c1 !== c2) {
                    statusEl.style.color = '#dc2626';
                    statusEl.textContent = 'Girilen iki kod eşleşmiyor.';
                    return;
                }
                if (SL) {
                    const v = SL.validateNewCode(c1, { forbidden: currentCode ? [currentCode] : [] });
                    if (!v.ok) {
                        statusEl.style.color = '#dc2626';
                        statusEl.textContent = v.message;
                        return;
                    }
                }
                if (!svc) {
                    statusEl.style.color = '#dc2626';
                    statusEl.textContent = 'Hesap yaşam döngüsü servisi hazır değil.';
                    return;
                }
                saveBtn.disabled = true;
                statusEl.style.color = '#2563eb';
                statusEl.textContent = '⏳ Yeni kodunuz kaydediliyor…';
                try {
                    await svc.completeMandatoryCodeChange(c1, { currentCode });
                    inp1.value = '';
                    inp2.value = '';
                    finish(true);
                    shell.close();
                } catch (err) {
                    saveBtn.disabled = false;
                    statusEl.style.color = '#dc2626';
                    statusEl.textContent = (err && err.message) || 'Yeni kod kaydedilemedi.';
                }
            });

            setTimeout(() => inp1.focus(), 50);
        });
    }

    // ─── 3. Giriş Ekranı 24 Saat Limitli Şifre Sıfırlama Talebi (index.html) ─────────────────────────
    // [WHY]: Personel şifresini unuttuğunda oturum açmadan güvenli talep bırakabilmeli; hesap varlığı sızmamalı.
    // [HOW]: #loginResetToggleBtn ile açılır; tek tip nötr mesaj döner.
    function bindLoginResetTrigger() {
        const toggleBtn = document.getElementById('loginResetToggleBtn');
        const panel = document.getElementById('loginResetPanel');
        if (!toggleBtn || !panel || toggleBtn.dataset.vp3Bound === '1') return;
        toggleBtn.dataset.vp3Bound = '1';

        const helpBtn = document.getElementById('loginResetHelpBtn');
        const helpBox = document.getElementById('loginResetHelp');
        const priInp = document.getElementById('loginResetPri');
        const noteInp = document.getElementById('loginResetNote');
        const submitBtn = document.getElementById('loginResetSubmitBtn');
        const cancelBtn = document.getElementById('loginResetCancelBtn');
        const statusEl = document.getElementById('loginResetStatus');

        const setOpen = open => {
            panel.hidden = !open;
            toggleBtn.setAttribute('aria-expanded', String(open));
            if (open) {
                const loginPri = document.getElementById('login-pri');
                if (priInp && !priInp.value && loginPri && loginPri.value) priInp.value = loginPri.value.trim();
                if (statusEl) statusEl.textContent = '';
                if (priInp) priInp.focus();
            }
        };

        toggleBtn.addEventListener('click', () => setOpen(panel.hidden));
        if (cancelBtn) cancelBtn.addEventListener('click', () => setOpen(false));
        if (helpBtn && helpBox) {
            helpBtn.addEventListener('click', () => {
                const open = helpBox.hidden;
                helpBox.hidden = !open;
                helpBtn.setAttribute('aria-expanded', String(open));
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', async () => {
                const svc = getSvc();
                if (!svc) {
                    if (statusEl) { statusEl.style.color = '#dc2626'; statusEl.textContent = 'Talep servisi henüz yüklenmedi; sayfayı yenileyin.'; }
                    return;
                }
                submitBtn.disabled = true;
                if (statusEl) { statusEl.style.color = '#2563eb'; statusEl.textContent = '⏳ Talebiniz iletiliyor…'; }
                try {
                    const res = await svc.submitPasswordResetRequest({
                        pri: priInp ? priInp.value : '',
                        note: noteInp ? noteInp.value : '',
                    });
                    if (statusEl) {
                        statusEl.style.color = res.ok ? '#15803d' : '#dc2626';
                        statusEl.textContent = res.message;
                    }
                    if (res.ok && noteInp) noteInp.value = '';
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }
    }

    // ─── 4. Yönetici: Hesap Askıya Alma / Yeniden Aktifleştirme Diyaloğu (admin.html) ────────────────
    function openSuspendDialog(personelId, { suspend = true } = {}) {
        const list = (window.data && window.data.personel) || [];
        const person = list.find(p => String(p.id) === String(personelId));
        if (!person) { notify('Personel kaydı bulunamadı.', 'error'); return; }

        const reasonInp = document.createElement('textarea');
        const shell = createModalShell({
            id: 'vp3SuspendModal',
            titleText: suspend ? '⛔ Personel Hesabını Askıya Al' : '✅ Personel Hesabını Yeniden Aktifleştir',
            descText: suspend
                ? `"${person.name || '-'}" hesabı askıya alınacak ve sistem erişimi kapatılacak. Geçmiş zimmet, talep, B3 ve EBYS kayıtları kesinlikle silinmez.`
                : `"${person.name || '-'}" hesabının erişimi yeniden açılacak ve personel mevcut kurumsal kimliğiyle giriş yapabilecektir.`,
            helpItems: [
                ['Silme yerine askıya alma', 'Personel kayıtları silinmez (deleteDoc yasaktır). Tüm tarihsel evrak ve zimmet sahipliği (ownerUid / personelId) korunur.'],
                ['Denetim izi', 'Gerekçeniz değiştirilemez Güvenlik Raporu\'na (auditLogs) kaydedilir ve yönetici parolanız yeniden doğrulanır.'],
            ],
            maxWidth: '480px',
            onClose: () => { reasonInp.value = ''; },
        });

        const pal = getThemePalette();
        const info = el('div', `padding:8px 12px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:12.5px;`);
        info.textContent = `Personel: ${person.name || '-'} · PRI: ${person.pri || 'yok'} · UID: ${person.uid || 'hesap yok'}`;

        const lbl = el('label', `font-size:13px; font-weight:700; color:${pal.text};`, 'İşlem gerekçesi (en az 5 karakter)');
        reasonInp.rows = 3;
        reasonInp.maxLength = 300;
        reasonInp.className = 'slp-input';
        reasonInp.placeholder = suspend ? 'Örn: Görev değişikliği / ayrılış nedeniyle erişim kapatıldı' : 'Örn: Göreve dönüş sonrası erişim yeniden açıldı';
        reasonInp.style.cssText = `width:100%; padding:10px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.inputBg}; color:${pal.text}; resize:vertical;`;

        const statusEl = el('div', 'font-size:12.5px; min-height:18px;');
        const actions = el('div', 'display:flex; justify-content:flex-end; gap:8px;');
        const cancelBtn = el('button', `padding:8px 14px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; cursor:pointer; font-weight:600;`, 'Vazgeç');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', shell.close);
        const submitBtn = el('button', `padding:8px 16px; border-radius:8px; border:none; background:${suspend ? '#dc2626' : '#16a34a'}; color:#fff; font-weight:700; cursor:pointer;`, suspend ? 'Hesabı Askıya Al' : 'Yeniden Aktifleştir');
        submitBtn.type = 'button';
        actions.append(cancelBtn, submitBtn);

        shell.body.append(info, lbl, reasonInp, statusEl, actions);

        submitBtn.addEventListener('click', async () => {
            const svc = getSvc();
            if (!svc) { statusEl.style.color = '#dc2626'; statusEl.textContent = 'Servis yüklenmemiş.'; return; }
            submitBtn.disabled = true;
            statusEl.style.color = '#2563eb';
            statusEl.textContent = '⏳ İşlem uygulanıyor…';
            try {
                await svc.setStaffAccountSuspended(person.id, { suspend, reason: reasonInp.value });
                shell.close();
                if (typeof window.renderPersonelTable === 'function') window.renderPersonelTable();
                renderAdminLifecyclePanel();
                notify(suspend ? `"${person.name}" hesabı askıya alındı.` : `"${person.name}" hesabı yeniden aktifleştirildi.`, 'success');
            } catch (err) {
                submitBtn.disabled = false;
                statusEl.style.color = '#dc2626';
                statusEl.textContent = (err && err.message) || 'İşlem başarısız.';
            }
        });

        setTimeout(() => reasonInp.focus(), 50);
    }

    // ─── 5. Yönetici: Süreli Geçici PIN / Kod Yenileme Diyaloğu (admin.html) ─────────────────────────
    function openTempPinDialog(personelId, { mode = 'tempPin', resolveResetPri = '' } = {}) {
        const list = (window.data && window.data.personel) || [];
        const person = list.find(p => String(p.id) === String(personelId));
        if (!person) { notify('Personel kaydı bulunamadı.', 'error'); return; }
        if (!person.uid) { notify('Bu personelin giriş hesabı yok; önce "Hesap Aç" düğmesini kullanın.', 'warning'); return; }

        const currentInp = document.createElement('input');
        const reasonInp = document.createElement('input');

        const shell = createModalShell({
            id: 'vp3TempPinModal',
            titleText: '🔑 Geçici PIN / Giriş Kodu Yenile',
            descText: `"${person.name || '-'}" için süreli ve tek kullanımlık kriptografik giriş kodu üretin. Kod ekranda yalnız bir kez gösterilir; yönetici sekme kilidi PIN'inden tamamen bağımsızdır.`,
            helpItems: [
                ['Bilinen eski/geçici kod', 'Personelin mevcut veya önceki geçici kodunu biliyorsanız aşağıya girin; Firebase Auth parolası tarayıcıdan anında güncellenir (yönetici oturumunuz etkilenmez).'],
                ['Eski kod tamamen unutulduysa', 'Mevcut kod alanını boş bırakın. Veritabanında geçici kod kilidi açılır ve UID\'yi koruyan güvenli yerel CLI komutu (parolasız) hazırlanır.'],
                ['İlk giriş zorunluluğu', 'Personel geçici kodla giriş yaptığında uygulama açılmadan önce kendi yeni kişisel kodunu belirlemek zorundadır.'],
            ],
            maxWidth: '520px',
            onClose: () => {
                currentInp.value = '';
                reasonInp.value = '';
            },
        });

        const pal = getThemePalette();
        const info = el('div', `padding:8px 12px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:12.5px;`);
        info.textContent = `Personel: ${person.name || '-'} · PRI: ${person.pri || '-'}${resolveResetPri ? ' · Sıfırlama talebi otomatik çözülecek' : ''}`;

        const modeSel = document.createElement('select');
        modeSel.className = 'slp-input';
        modeSel.style.cssText = `width:100%; padding:9px 10px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.inputBg}; color:${pal.text};`;
        modeSel.append(
            new Option('Geçici PIN (6 haneli tek kullanımlık sayısal PIN)', 'tempPin'),
            new Option('Şifre Sıfırlama Kodu (8 karakter alfasayısal güçlü kod)', 'resetCode')
        );
        modeSel.value = mode === 'resetCode' ? 'resetCode' : 'tempPin';
        styleSelectOptions(modeSel, pal);

        const ttlSel = document.createElement('select');
        ttlSel.className = 'slp-input';
        ttlSel.style.cssText = modeSel.style.cssText;
        ttlSel.append(
            new Option('15 dakika', '15'),
            new Option('1 saat (Önerilen)', '60'),
            new Option('4 saat', '240'),
            new Option('24 saat (En uzun süre)', '1440')
        );
        ttlSel.value = '60';
        styleSelectOptions(ttlSel, pal);

        currentInp.type = 'password';
        currentInp.className = 'slp-input';
        currentInp.autocomplete = 'off';
        currentInp.placeholder = 'Opsiyonel: biliniyorsa mevcut/önceki kod (boş = çevrimdışı Spark betiği)';
        currentInp.style.cssText = modeSel.style.cssText;

        reasonInp.type = 'text';
        reasonInp.className = 'slp-input';
        reasonInp.maxLength = 300;
        reasonInp.value = resolveResetPri ? 'Personelin 24 saat limitli şifre sıfırlama talebi karşılandı' : '';
        reasonInp.placeholder = 'Gerekçe (en az 5 karakter, ör. Giriş kodu unutuldu)';
        reasonInp.style.cssText = modeSel.style.cssText;

        const statusEl = el('div', 'font-size:12.5px; min-height:18px;');
        const actions = el('div', 'display:flex; justify-content:flex-end; gap:8px;');
        const cancelBtn = el('button', `padding:8px 14px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; cursor:pointer; font-weight:600;`, 'Vazgeç');
        cancelBtn.type = 'button';
        cancelBtn.addEventListener('click', shell.close);
        const submitBtn = el('button', 'padding:8px 16px; border-radius:8px; border:none; background:#2563eb; color:#fff; font-weight:700; cursor:pointer;', 'Tek Kullanımlık Kod Üret');
        submitBtn.type = 'button';
        actions.append(cancelBtn, submitBtn);

        shell.body.append(
            info,
            el('label', `font-size:12.5px; font-weight:700; color:${pal.text};`, 'Kod Türü'), modeSel,
            el('label', `font-size:12.5px; font-weight:700; color:${pal.text};`, 'Geçerlilik Süresi (TTL)'), ttlSel,
            el('label', `font-size:12.5px; font-weight:700; color:${pal.text};`, 'Mevcut / Önceki Giriş Kodu (Opsiyonel)'), currentInp,
            el('label', `font-size:12.5px; font-weight:700; color:${pal.text};`, 'Denetim Gerekçesi'), reasonInp,
            statusEl,
            actions
        );

        submitBtn.addEventListener('click', async () => {
            const svc = getSvc();
            if (!svc) { statusEl.style.color = '#dc2626'; statusEl.textContent = 'Servis yüklenmemiş.'; return; }
            submitBtn.disabled = true;
            statusEl.style.color = '#2563eb';
            statusEl.textContent = '⏳ Güvenli tek kullanımlık kod oluşturuluyor…';
            try {
                const res = await svc.issueTemporaryPinOrReset(person.id, {
                    mode: modeSel.value,
                    ttlMinutes: Number(ttlSel.value),
                    currentCode: currentInp.value,
                    reason: reasonInp.value,
                    resolveResetPri,
                });
                currentInp.value = '';
                shell.close();
                await showOneTimeSecretModal(res);
                renderAdminLifecyclePanel();
            } catch (err) {
                submitBtn.disabled = false;
                statusEl.style.color = '#dc2626';
                statusEl.textContent = (err && err.message) || 'Geçici kod üretilemedi.';
            }
        });

        setTimeout(() => reasonInp.focus(), 50);
    }

    // ─── 6. Yönetici Paneli: Şifre Sıfırlama Talepleri & Yaşam Döngüsü Kartı (admin.html) ───────────
    async function renderAdminLifecyclePanel(containerId = 'staffLifecycleContainer') {
        const host = document.getElementById(containerId);
        if (!host) return;
        const svc = getSvc();
        if (!svc) return;
        if (!(typeof window.isDbAdmin === 'function' && window.isDbAdmin())) {
            host.textContent = '';
            return;
        }

        host.textContent = '';
        const pal = getThemePalette();
        const card = el('div', `background:${pal.cardBg}; color:${pal.text}; border:1px solid ${pal.border}; border-radius:14px; padding:16px 18px; box-shadow:0 4px 16px rgba(15,23,42,0.08);`);
        card.className = 'slp-card';

        const head = el('div', 'display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:6px;');
        const titleWrap = el('div', 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;');
        titleWrap.appendChild(el('h5', `margin:0; font-weight:800; font-size:1rem; color:${pal.text};`, '🔑 Şifre Sıfırlama Talepleri & Geçici PIN'));
        const badge = el('span', `padding:2px 9px; border-radius:999px; font-size:11.5px; font-weight:700; background:${pal.infoBg}; color:${pal.infoText};`, 'Yükleniyor…');
        titleWrap.appendChild(badge);
        const spamBadge = el('span', `padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; background:${pal.surfaceAlt}; border:1px solid ${pal.border}; color:${pal.textMuted}; display:none;`);
        titleWrap.appendChild(spamBadge);

        const refreshBtn = el('button', `padding:5px 12px; border-radius:8px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:12px; font-weight:600; cursor:pointer;`, '↻ Yenile');
        refreshBtn.type = 'button';
        refreshBtn.addEventListener('click', () => renderAdminLifecyclePanel(containerId));
        head.append(titleWrap, refreshBtn);

        const desc = el('p', `margin:0 0 8px; font-size:12.5px; color:${pal.textMuted}; line-height:1.45;`, PANEL_DESC);

        const helpBtn = el('button', 'margin-bottom:10px;');
        helpBtn.type = 'button';
        helpBtn.className = 'panel-help-trigger';
        helpBtn.setAttribute('data-panel-help', '');
        helpBtn.setAttribute('aria-expanded', 'false');
        helpBtn.setAttribute('aria-controls', 'staffLifecycleHelp');
        const helpIcon = el('i');
        helpIcon.className = 'fas fa-info-circle';
        helpIcon.setAttribute('aria-hidden', 'true');
        helpBtn.append(helpIcon, document.createTextNode(' Nasıl çalışır?'));

        const helpBox = el('div');
        helpBox.id = 'staffLifecycleHelp';
        helpBox.className = 'panel-help';
        helpBox.hidden = true;
        const ul = el('ul');
        PANEL_HELP.forEach(([k, v]) => {
            const li = el('li');
            li.append(el('strong', null, `${k}: `), document.createTextNode(v));
            ul.appendChild(li);
        });
        helpBox.appendChild(ul);

        const listArea = el('div', 'margin-top:8px; overflow-x:auto;');
        card.append(head, desc, helpBtn, helpBox, listArea);
        host.appendChild(card);

        try {
            const [rawRequests, states] = await Promise.all([
                svc.listPasswordResetRequests(),
                svc.listStaffAccountStates(),
            ]);
            window._staffAccountStates = states;
            if (typeof window.renderPersonelTable === 'function') window.renderPersonelTable();

            const SL = getSL();
            const analysis = (SL && typeof SL.analyzeResetRequests === 'function')
                ? SL.analyzeResetRequests(rawRequests)
                : { requests: rawRequests, totalLocalBlocked: 0 };
            const requests = analysis.requests || rawRequests;

            if (analysis.totalLocalBlocked > 0) {
                spamBadge.style.display = 'inline-flex';
                spamBadge.textContent = `🛡️ ${analysis.totalLocalBlocked} mükerrer deneme yerelde engellendi`;
            }

            const pending = requests.filter(r => r.status === 'pending');
            badge.textContent = pending.length ? `${pending.length} bekleyen talep` : 'Bekleyen talep yok';
            if (pending.length) {
                badge.style.background = pal.warnBg;
                badge.style.color = pal.warnText;
            } else {
                badge.style.background = pal.okBg;
                badge.style.color = pal.okText;
            }

            if (!requests.length) {
                listArea.appendChild(el('div', `font-size:13px; color:${pal.textMuted}; padding:6px 0;`,
                    'Henüz şifre sıfırlama talebi yok. Aşağıdaki personel tablosundan da herhangi bir aktif personel için doğrudan "Geçici PIN / Kod" veya "Askıya Al" işlemini kullanabilirsiniz.'));
                return;
            }

            const personelList = (window.data && window.data.personel) || [];
            const table = el('table', `width:100%; min-width:620px; border-collapse:collapse; font-size:12.5px; color:${pal.text};`);
            table.className = 'modern-table slp-table';
            const thead = document.createElement('thead');
            const hr = document.createElement('tr');
            const COLS = ['Kurumsal Kimlik (PRI)', 'Eşleşen Personel', 'Talep Zamanı', 'Not', 'Durum', 'İşlemler'];
            COLS.forEach(label => {
                hr.appendChild(el('th', `text-align:left; padding:7px 8px; border-bottom:1px solid ${pal.border}; font-weight:700; color:${pal.text};`, label));
            });
            thead.appendChild(hr);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            const CELL = `padding:7px 8px; border-bottom:1px solid ${pal.border}; vertical-align:middle;`;
            requests.forEach(req => {
                const tr = document.createElement('tr');
                tr.className = 'slp-row';
                const matched = personelList.find(p => String(p.pri || '').toLowerCase() === String(req.pri || '').toLowerCase());
                const tdPri = el('td', CELL);
                tdPri.setAttribute('data-label', COLS[0]);
                tdPri.appendChild(el('code', null, req.pri));
                if (req.source === 'local-demo-fallback') {
                    tdPri.appendChild(el('div', `font-size:10.5px; font-weight:700; color:${pal.warnText}; margin-top:2px;`, '[Lokal Demo Modu — Kurallar Deploy Edilene Kadar]'));
                }

                const tdName = el('td', CELL, matched ? `${matched.name || '-'}${matched.active === false ? ' (Askıda)' : ''}` : 'Eşleşen kayıt yok');
                tdName.setAttribute('data-label', COLS[1]);
                const tdTime = el('td', CELL + ' white-space:nowrap;', fmtTs(req.requestedAtMs));
                tdTime.setAttribute('data-label', COLS[2]);
                if (req.localBlockedCount > 0) {
                    tdTime.appendChild(el('div', `font-size:10.5px; font-weight:700; color:${pal.infoText};`, `🛡️ +${req.localBlockedCount} mükerrer tık engellendi`));
                }
                const tdNote = el('td', CELL, req.note || '-');
                tdNote.setAttribute('data-label', COLS[3]);

                const tdStatus = el('td', CELL);
                tdStatus.setAttribute('data-label', COLS[4]);
                const statusMap = {
                    pending: ['Beklemede', pal.warnText],
                    resolved: ['Çözüldü', pal.okText],
                    dismissed: ['Kapatıldı', pal.textMuted],
                };
                const [stLabel, stColor] = statusMap[req.status] || [req.status, pal.textMuted];
                tdStatus.appendChild(el('span', `font-weight:700; color:${stColor};`, stLabel));
                if (req.resolutionNote) {
                    tdStatus.appendChild(el('div', `font-size:11px; color:${pal.textMuted};`, req.resolutionNote));
                }

                const tdAct = el('td', CELL + ' white-space:nowrap;');
                tdAct.setAttribute('data-label', COLS[5]);
                if (req.status === 'pending') {
                    if (matched && matched.uid && matched.active !== false) {
                        const pinBtn = el('button', 'padding:4px 10px; margin-right:6px; border-radius:6px; border:none; background:#2563eb; color:#fff; font-size:12px; font-weight:600; cursor:pointer;', 'Geçici PIN / Kod');
                        pinBtn.type = 'button';
                        pinBtn.addEventListener('click', () => openTempPinDialog(matched.id, { mode: 'resetCode', resolveResetPri: req.pri }));
                        tdAct.appendChild(pinBtn);
                    }
                    const dismissBtn = el('button', `padding:4px 10px; border-radius:6px; border:1px solid ${pal.border}; background:${pal.surfaceAlt}; color:${pal.text}; font-size:12px; cursor:pointer; font-weight:600;`, 'Kapat');
                    dismissBtn.type = 'button';
                    dismissBtn.addEventListener('click', async () => {
                        try {
                            await svc.resolvePasswordResetRequest(req.pri, {
                                status: 'dismissed',
                                resolutionNote: matched ? 'Yönetici tarafından kapatıldı' : 'Eşleşen aktif hesap bulunamadı',
                            });
                            renderAdminLifecyclePanel(containerId);
                            notify('Talep kapatıldı.', 'info');
                        } catch (err) {
                            notify((err && err.message) || 'Talep kapatılamadı.', 'error');
                        }
                    });
                    tdAct.appendChild(dismissBtn);
                } else {
                    tdAct.textContent = fmtTs(req.resolvedAtMs);
                }

                tr.append(tdPri, tdName, tdTime, tdNote, tdStatus, tdAct);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            listArea.appendChild(table);
        } catch (err) {
            badge.textContent = 'Okunamadı';
            listArea.appendChild(el('div', `font-size:12.5px; color:${pal.dangerText};`, (err && err.message) || 'Sıfırlama talepleri yüklenemedi.'));
        }
    }

    // Köprüler (personel.js ve admin.html inline aksiyonları için)
    window.togglePersonelSuspend = function (id, suspend) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Personel hesap durumu')) return;
        openSuspendDialog(id, { suspend: !!suspend });
    };
    window.openPersonelTempPin = function (id) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Geçici PIN / Kod')) return;
        openTempPinDialog(id, { mode: 'tempPin' });
    };

    const StaffLifecyclePanel = Object.freeze({
        bindLoginResetTrigger,
        promptMandatoryCodeChange,
        showOneTimeSecretModal,
        openSuspendDialog,
        openTempPinDialog,
        renderAdminLifecyclePanel,
    });

    window.AppModules = window.AppModules || {};
    window.AppModules.StaffLifecyclePanel = StaffLifecyclePanel;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindLoginResetTrigger, { once: true });
    } else {
        bindLoginResetTrigger();
    }

    // [WHY]: v3.8 HF-2 · Yönetici panelinde dark/light tema değiştirildiğinde yaşam döngüsü kartı renklerini anında yenile.
    if (typeof MutationObserver === 'function' && document.documentElement) {
        const themeObs = new MutationObserver(() => {
            const host = document.getElementById('staffLifecycleContainer');
            if (host && host.childElementCount > 0) renderAdminLifecyclePanel('staffLifecycleContainer');
        });
        themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
})();
