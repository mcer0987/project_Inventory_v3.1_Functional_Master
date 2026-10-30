(function () {
    const STORAGE_KEY = 'adminQuickUnlock.v1';
    const PIN_ITERATIONS = 600000;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let standardUnlockAdmin = null;
    // v3.3 Aşama 5 (Denetim P2-01): PIN düğmesi/Enter VE tam parola düğmesi/Enter'ın HEPSİ aynı alttaki
    // standardUnlockAdmin()'i çağırır; hiçbiri diğerini bekleyen bir kilit görmüyordu — düğme disabled olsa da Enter
    // yeniden çağrı başlatabiliyordu. Tek, paylaşılan bayrak: hangi yoldan gelirse gelsin, bir giriş denemesi sürerken
    // ikincisi sessizce yok sayılır (buton/Enter arasında VE PIN/tam parola yolları arasında ortak).
    let authInFlight = false;

    function setStatus(message, isError = false) {
        const status = document.getElementById('adminQuickUnlockStatus');
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? '#f87171' : 'var(--color-text-muted, #94a3b8)';
    }

    function readVault() {
        let raw;
        try {
            raw = sessionStorage.getItem(STORAGE_KEY);
        } catch (error) {
            console.error('[AdminQuickUnlock] Sekme kasasına erişilemedi:', error);
            setStatus('Sekme kasasına erişilemedi. Tam parolanızla devam edin.', true);
            return null;
        }
        if (!raw) return null;
        try {
            const vault = JSON.parse(raw);
            if (vault.version !== 1 || typeof vault.salt !== 'string' ||
                typeof vault.iv !== 'string' || typeof vault.ciphertext !== 'string' ||
                !Number.isInteger(vault.failedAttempts) || vault.failedAttempts < 0 ||
                (vault.uid !== undefined && vault.uid !== null && typeof vault.uid !== 'string')) {
                throw new Error('Hızlı PIN kasası biçimi geçersiz.');
            }
            return vault;
        } catch (error) {
            try {
                sessionStorage.removeItem(STORAGE_KEY);
            } catch (removeError) {
                console.error('[AdminQuickUnlock] Geçersiz kasa kaydı silinemedi:', removeError);
            }
            console.error('[AdminQuickUnlock] Kasa okunamadı; kayıt temizlendi:', error);
            setStatus('Hızlı PIN kaydı okunamadı ve temizlendi. Tam parolanızla devam edin.', true);
            return null;
        }
    }

    function refreshQuickUnlock() {
        const quickSection = document.getElementById('adminQuickUnlockQuickSection');
        if (!quickSection) return;
        quickSection.hidden = !readVault();
        quickSection.style.display = quickSection.hidden ? 'none' : 'grid';
    }

    function bytesToBase64(bytes) {
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    function base64ToBytes(value) {
        return Uint8Array.from(atob(value), character => character.charCodeAt(0));
    }

    async function deriveKey(pin, salt) {
        const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function saveVault(pin, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(pin, salt);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(password));
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 1,
            salt: bytesToBase64(salt),
            iv: bytesToBase64(iv),
            ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
            failedAttempts: 0,
            uid: null,   // P2-02: onAuthReady ilk admin UID'sini görünce bağlanır (bkz. onAuthUidChanged)
        }));
        refreshQuickUnlock();
        setStatus('Hızlı PIN bu sekme için kaydedildi. Paylaşılan cihazlarda kullanmayın.');
    }

    function clearVault() {
        sessionStorage.removeItem(STORAGE_KEY);
        refreshQuickUnlock();
    }

    // v3.3 Aşama 5 (Denetim P2-02): kasanın açık yaşam döngüsü sözleşmesi — hangi admin UID'sine ait olduğu kayıtlı
    // değildi; "hesap değişimi"nde (ör. ikinci admin hesabı ya da bu sekmede bir personel oturumu) PIN sessizce ÖNCEKİ
    // hesabın parolasını açmaya devam ederdi.
    // [HOW]: Kasa kaydedilirken uid YAZILMAZ (signInWithEmailAndPassword'un onAuthStateChanged'ı tetiklemesi asenkron;
    //        o an window.userAuth henüz güncellenmemiş olabilir) — bunun yerine bu fonksiyon, oturum durumu HER
    //        bildirildiğinde (onAuthReady) çalışır: kasa henüz bir UID'ye bağlı değilse (uid: null/undefined, ör. yeni
    //        kaydedildi ya da bu değişiklikten ÖNCEKİ bir sürümden kalma) BU oturuma bağlanır (lazy adopt). Anonim
    //        olmayan FARKLI bir uid görülürse (başka bir admin ya da personel hesabı bu sekmede oturum açtı) kasa
    //        kendini imha eder. Anonim oturum (açık çıkış ya da kilit sonrası beklenen ara durum — her iki de tam
    //        signOut() yapar, bkz. SecurityConfig.endAdminSession) imha TETİKLEMEZ; aksi halde PIN her kilitte silinir.
    function onAuthUidChanged(uid, isAnonymous) {
        if (isAnonymous || !uid) return;
        let vault;
        try {
            vault = readVault();
        } catch (error) {
            return;   // readVault zaten geçersiz kaydı temizledi ve kullanıcıyı bilgilendirdi
        }
        if (!vault) return;
        if (vault.uid == null) {
            vault.uid = uid;
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
            } catch (error) {
                console.error('[AdminQuickUnlock] Kasa UID\'ye bağlanamadı:', error);
            }
            return;
        }
        if (vault.uid !== uid) {
            clearVault();
            setStatus('Farklı bir hesap bu sekmede oturum açtı; hızlı PIN kasası güvenlik nedeniyle silindi.', true);
        }
    }

    function getLockPassword() {
        return window._dx ? window._dx._g('lock-val-node') : document.getElementById('lock-val-node')?.value || '';
    }

    function setLockPassword(password) {
        const input = document.getElementById('lock-val-node');
        if (window._dx && window._dx._b) {
            window._dx._b['lock-val-node'] = password;
            if (input) input.value = '•'.repeat(password.length);
        } else if (input) {
            input.value = password;
        }
    }

    function offerPinSetup(password) {
        if (readVault()) return Promise.resolve(false);
        if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
            console.warn('[AdminQuickUnlock] WebCrypto desteklenmiyor; hızlı PIN kurulumu atlandı.');
            return Promise.resolve(false);
        }

        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'admin-quick-pin-setup-overlay';
            overlay.setAttribute('role', 'presentation');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:14000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(8,15,30,.68);backdrop-filter:blur(7px);';

            const dialog = document.createElement('section');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'adminQuickPinSetupTitle');
            dialog.style.cssText = 'width:min(420px,100%);padding:26px;border:1px solid var(--color-border,#dbe3ee);border-radius:20px;background:var(--color-surface,#fff);color:var(--color-text,#1e293b);box-shadow:0 28px 80px rgba(2,8,23,.38);';

            const eyebrow = document.createElement('small');
            eyebrow.textContent = 'ADMIN · OTURUM KOLAYLIĞI';
            eyebrow.style.cssText = 'color:var(--color-primary,#2563eb);font-size:.68rem;font-weight:800;letter-spacing:.12em;';
            const title = document.createElement('h2');
            title.id = 'adminQuickPinSetupTitle';
            title.textContent = 'Bu sekme için Hızlı PIN?';
            title.style.cssText = 'margin:8px 0;color:var(--color-text,#1e293b);font-size:1.25rem;';
            const description = document.createElement('p');
            description.textContent = 'Daha sonra oturum kilitlendiğinde tam parolanız yerine 4 haneli PIN kullanabilirsiniz. PIN yalnız bu sekmede şifreli saklanır.';
            description.style.cssText = 'margin:0 0 16px;color:var(--color-text-muted,#64748b);font-size:.88rem;line-height:1.5;';
            const input = createInput('adminQuickPinFirstSetup', '4 haneli PIN');
            input.style.letterSpacing = '.3em';
            const warning = document.createElement('small');
            warning.textContent = 'Düşük güvenlikli kolaylıktır; ortak cihazlarda ayarlamayın.';
            warning.style.cssText = 'display:block;margin-top:8px;color:var(--color-text-muted,#64748b);font-size:.72rem;line-height:1.4;';
            const error = document.createElement('p');
            error.setAttribute('role', 'alert');
            error.style.cssText = 'display:none;margin:10px 0 0;color:#dc2626;font-size:.78rem;';
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;';
            const skip = document.createElement('button');
            skip.type = 'button';
            skip.textContent = 'Şimdi değil';
            skip.style.cssText = 'padding:10px 13px;border:1px solid var(--color-border,#dbe3ee);border-radius:10px;background:transparent;color:var(--color-text,#1e293b);cursor:pointer;';
            const save = document.createElement('button');
            save.type = 'button';
            save.textContent = 'PIN’i Kaydet';
            save.style.cssText = 'padding:10px 14px;border:0;border-radius:10px;background:var(--color-primary,#2563eb);color:#fff;font-weight:700;cursor:pointer;';
            actions.append(skip, save);
            dialog.append(eyebrow, title, description, input, warning, error, actions);
            overlay.append(dialog);
            document.body.append(overlay);

            let settled = false;
            // v3.3 Aşama 5 (P2-08): Escape artık DialogStack'e devredilir (bu diyalog kilit kartı üstünde açılır;
            // DialogStack yoksa eski document-level Escape dinleyicisine düşülür). Enter→Kaydet kısayolu DialogStack'in
            // kapsamı dışında (yığın/odak hapsiyle ilgisi yok) — ayrı, dar bir dinleyici olarak kalır.
            const finish = value => {
                if (settled) return;
                settled = true;
                if (window.DialogStack) window.DialogStack.close(dialog);
                document.removeEventListener('keydown', onEnterKeydown);
                if (!window.DialogStack) document.removeEventListener('keydown', onEscapeFallback);
                overlay.remove();
                resolve(value);
            };
            const onEnterKeydown = event => {
                if (event.key === 'Enter' && document.activeElement === input) save.click();
            };
            const onEscapeFallback = event => {
                if (event.key === 'Escape') finish(false);
            };
            skip.addEventListener('click', () => finish(false));
            overlay.addEventListener('click', event => {
                if (event.target === overlay) finish(false);
            });
            document.addEventListener('keydown', onEnterKeydown);
            if (window.DialogStack) window.DialogStack.open(dialog, { onEscape: () => finish(false), initialFocus: input });
            else document.addEventListener('keydown', onEscapeFallback);

            const savePin = async () => {
                const pin = input.value;
                if (!/^\d{4}$/.test(pin)) {
                    error.textContent = 'PIN tam olarak 4 rakam olmalıdır.';
                    error.style.display = 'block';
                    input.focus();
                    return;
                }
                save.disabled = true;
                try {
                    await saveVault(pin, password);
                    finish(true);
                } catch (saveError) {
                    console.error('[AdminQuickUnlock] İlk girişte PIN kaydedilemedi:', saveError);
                    error.textContent = 'PIN kaydedilemedi. Hızlı PIN olmadan devam edebilirsiniz.';
                    error.style.display = 'block';
                    save.disabled = false;
                }
            };
            save.addEventListener('click', savePin);
            if (!window.DialogStack) input.focus();
        });
    }

    function createInput(id, placeholder) {
        const input = document.createElement('input');
        input.id = id;
        input.type = 'password';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.maxLength = 4;
        input.pattern = '[0-9]{4}';
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;background:var(--color-surface-alt,#1a2535);color:var(--color-text,#e2e8f0);border:1px solid var(--color-border,#334155);border-radius:8px;font-size:14px;letter-spacing:0.25em;text-align:center;';
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 4);
        });
        return input;
    }

    function createUI() {
        const card = document.getElementById('adminLockCard');
        if (!card || document.getElementById('adminQuickUnlockPanel')) return;

        const panel = document.createElement('section');
        panel.id = 'adminQuickUnlockPanel';
        panel.style.cssText = 'display:grid;gap:10px;margin:0 0 16px;text-align:left;';

        const setupLabel = document.createElement('label');
        setupLabel.htmlFor = 'adminQuickUnlockSetupPin';
        setupLabel.textContent = 'Bu sekmede Hızlı PIN tanımla (isteğe bağlı)';
        setupLabel.style.cssText = 'font-size:0.8rem;color:var(--color-text-muted,#94a3b8);';
        const setupPin = createInput('adminQuickUnlockSetupPin', 'Yeni 4 haneli PIN');
        const note = document.createElement('small');
        note.textContent = '4 haneli PIN düşük güvenlikli yerel kolaylıktır; yalnız bu sekmede şifreli saklanır. Ortak cihazlarda kullanmayın.';
        note.style.cssText = 'font-size:0.72rem;line-height:1.4;color:var(--color-text-muted,#94a3b8);';

        const quickSection = document.createElement('div');
        quickSection.id = 'adminQuickUnlockQuickSection';
        quickSection.hidden = true;
        quickSection.style.cssText = 'display:grid;gap:8px;padding-top:8px;border-top:1px solid var(--color-border,#334155);';
        const quickLabel = document.createElement('label');
        quickLabel.htmlFor = 'adminQuickUnlockPin';
        quickLabel.textContent = 'Hızlı PIN ile Aç';
        quickLabel.style.cssText = 'font-size:0.8rem;color:var(--color-text-muted,#94a3b8);';
        const quickRow = document.createElement('div');
        quickRow.style.cssText = 'display:flex;gap:8px;';
        const quickPin = createInput('adminQuickUnlockPin', '4 haneli PIN');
        const quickButton = document.createElement('button');
        quickButton.type = 'button';
        quickButton.textContent = 'PIN ile Aç';
        quickButton.style.cssText = 'flex:0 0 auto;padding:8px 10px;background:#334155;color:#fff;border:0;border-radius:8px;cursor:pointer;font-size:0.8rem;';
        quickRow.append(quickPin, quickButton);
        quickSection.append(quickLabel, quickRow);

        const status = document.createElement('p');
        status.id = 'adminQuickUnlockStatus';
        status.setAttribute('role', 'status');
        status.style.cssText = 'min-height:1em;margin:0;font-size:0.75rem;';
        panel.append(setupLabel, setupPin, note, quickSection, status);

        const unlockButton = card.querySelector('button[onclick*="unlockAdmin"]');
        if (unlockButton) card.insertBefore(panel, unlockButton);
        else card.append(panel);

        quickButton.addEventListener('click', () => unlockWithPin(quickPin, quickButton));
        quickPin.addEventListener('keydown', event => {
            if (event.key === 'Enter') unlockWithPin(quickPin, quickButton);
        });
        refreshQuickUnlock();
    }

    async function unlockWithPin(pinInput, button) {
        // P2-01: düğme devre dışıyken Enter (ya da çift tıklama) yeniden çağrı başlatmasın; tam parola yoluyla da ortak.
        if (authInFlight) return;
        const pin = pinInput.value;
        if (!/^\d{4}$/.test(pin)) {
            setStatus('PIN tam olarak 4 rakam olmalıdır.', true);
            return;
        }
        if (typeof standardUnlockAdmin !== 'function') {
            setStatus('Güvenlik sistemi henüz hazır değil. Biraz bekleyin veya tam parolanızı kullanın.', true);
            return;
        }

        let vault;
        try {
            vault = readVault();
        } catch (error) {
            console.error('[AdminQuickUnlock] Kasa okunamadı:', error);
            setStatus('Hızlı PIN kasasına erişilemedi. Tam parolanızla devam edin.', true);
            return;
        }
        if (!vault) {
            setStatus('Kayıtlı PIN bulunamadı. Tam parolanızla devam edin.', true);
            return;
        }

        authInFlight = true;
        button.disabled = true;
        let password = '';
        try {
            try {
                const salt = base64ToBytes(vault.salt);
                const iv = base64ToBytes(vault.iv);
                const ciphertext = base64ToBytes(vault.ciphertext);
                const key = await deriveKey(pin, salt);
                const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
                password = decoder.decode(plaintext);
            } catch (error) {
                vault.failedAttempts += 1;
                if (vault.failedAttempts >= 3) {
                    clearVault();
                    pinInput.value = '';
                    setStatus('Üç hatalı PIN denemesi nedeniyle hızlı PIN silindi. Tam parolanızla açın.', true);
                    return;
                }
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
                setStatus(`PIN hatalı. ${3 - vault.failedAttempts} deneme hakkı kaldı.`, true);
                return;
            }

            vault.failedAttempts = 0;
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
            setLockPassword(password);
            await standardUnlockAdmin.call(window);
            const lockModal = document.getElementById('adminLockModal');
            if (lockModal?.style.display === 'none') {
                pinInput.value = '';
                document.getElementById('adminQuickUnlockSetupPin').value = '';
                setStatus('Firebase yönetici oturumu başarıyla yenilendi.');
            } else {
                setStatus(window.SecurityConfig?.lastErrorMessage || 'Firebase oturumu açılamadı. Tam parolanızla deneyin.', true);
            }
        } catch (error) {
            console.error('[AdminQuickUnlock] Hızlı açma başarısız:', error);
            setStatus('Hızlı açma sırasında beklenmeyen bir hata oluştu. Tam parolanızla devam edin.', true);
        } finally {
            password = '';
            button.disabled = false;
            authInFlight = false;
        }
    }

    function installUnlockHook() {
        if (typeof window.unlockAdmin !== 'function' || window.unlockAdmin._quickUnlockWrapped) return;
        standardUnlockAdmin = window.unlockAdmin;
        const wrappedUnlockAdmin = async function (...args) {
            // P2-01: Hızlı PIN isteği sürerken tam parola yolu (Enter/düğme) — ya da tersi — sessizce yok sayılır.
            if (authInFlight) return undefined;
            authInFlight = true;
            try {
                const password = getLockPassword();
                const pin = document.getElementById('adminQuickUnlockSetupPin')?.value || '';
                const result = await standardUnlockAdmin.apply(this, args);
                if (document.getElementById('adminLockModal')?.style.display === 'none' && pin) {
                    if (!/^\d{4}$/.test(pin)) {
                        setStatus('PIN kaydedilmedi: 4 rakam girin.', true);
                    } else {
                        try {
                            await saveVault(pin, password);
                            document.getElementById('adminQuickUnlockSetupPin').value = '';
                        } catch (error) {
                            console.error('[AdminQuickUnlock] PIN kasası kaydedilemedi:', error);
                            setStatus('PIN kaydedilemedi. Tarayıcı şifreleme veya sekme depolama desteğini kontrol edin.', true);
                        }
                    }
                }
                return result;
            } finally {
                authInFlight = false;
            }
        };
        wrappedUnlockAdmin._quickUnlockWrapped = true;
        window.unlockAdmin = wrappedUnlockAdmin;
    }

    try {
        createUI();
        if (document.readyState === 'complete') installUnlockHook();
        else window.addEventListener('load', installUnlockHook, { once: true });

        window.addEventListener('onAppLogout', event => {
            if (event.detail?.reason === 'logout') {
                try {
                    clearVault();
                    setStatus('Oturum kapatıldı; hızlı PIN kasası silindi.');
                } catch (error) {
                    console.error('[AdminQuickUnlock] Çıkışta kasa silinemedi:', error);
                    setStatus('Çıkışta hızlı PIN kasası silinemedi. Bu sekmeyi kapatın.', true);
                }
            }
        });
        // P2-02: oturum durumu her bildirildiğinde (giriş, hesap değişimi) kasa UID bağını denetler/kurar.
        window.addEventListener('onAuthReady', event => {
            try {
                onAuthUidChanged(event && event.detail && event.detail.uid, !!(event && event.detail && event.detail.isAnonymous));
            } catch (error) {
                console.error('[AdminQuickUnlock] Kasa UID denetimi başarısız:', error);
            }
        });
        window.AdminQuickUnlock = { offerPinSetup, saveForSession: saveVault };
    } catch (error) {
        console.error('[AdminQuickUnlock] Yardımcı arayüz başlatılamadı:', error);
    }
})();
