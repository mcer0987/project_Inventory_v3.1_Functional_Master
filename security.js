const SecurityConfig = {
    // [WHY]: Blaze planına (ücretli) geçmemek için Backend (Cloud Functions) mimarisini iptal ettik.
    // [HOW]: Bunun yerine 'Görünmez E-posta İllüzyonu' kullanıyoruz. Kullanıcı arayüzde sadece şifre giriyor, sistem bunu sabit bir e-posta ile birleştirip standart Firebase Auth Email/Password girişine dönüştürüyor.

    AUTH_SDK: "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js",
    MIN_PASSWORD_LENGTH: 12,

    // Son başarısız girişin kullanıcıya gösterilecek nedeni (null = genel "hatalı parola").
    lastErrorMessage: null,

    _signInPending: false,
    _ending: null,

    // [WHY]: Faz 4 · J3 (SEC-02, M11) — eski 5 haneli kod "0" ön ekiyle Firebase'e gidiyordu. Parola deploy günü ≥12 karaktere
    //        döndürüldü (sahibinin teyidi, 07.10.2026); geçiş dalı Faz 4 kapanış hotfix'inde kaldırıldı.
    // [HOW]: ≥12 → olduğu gibi · daha kısa her giriş ağa gitmeden ret ("en az 12 karakter"; eski 5 haneli kodu deneyen yönetici
    //        neden reddedildiğini görür) · boş → hatalı parola.
    normalizeAdminPassword(raw) {
        const pw = raw == null ? '' : String(raw);
        if (pw.length >= this.MIN_PASSWORD_LENGTH) return { ok: true, value: pw };
        if (pw.length > 0) return { ok: false, error: `Yönetici parolası en az ${this.MIN_PASSWORD_LENGTH} karakter olmalıdır.` };
        return { ok: false, error: null };
    },

    // [WHY]: Faz 4 kapanış hotfix'i (saha bulgusu, 07.10.2026) — çıkıştan hemen sonra (F5'siz) yeni anonim oturum henüz yoldayken
    //        yapılan admin girişi, kalıcılık değişimi ve iki oturum işlemiyle yarışabiliyordu (anonim yanıt admin oturumunun üstüne
    //        yazılabilir). Canlıda ağ gecikmesi bu pencereyi saniyelere uzatıyordu.
    // [HOW]: Oturum durumu yerleşene kadar (Firebase'den bir kullanıcı — anonim ya da değil — gelene kadar) beklenir; en fazla ms.
    async waitForAuthSettled(ms = 10000) {
        if (window.userAuth || typeof window.whenAuthReady !== 'function') return !!window.userAuth;
        return Promise.race([window.whenAuthReady().then(() => true), new Promise(r => setTimeout(() => r(false), ms))]);
    },

    async _auth() {
        const sdk = await import(this.AUTH_SDK);
        return { sdk, auth: sdk.getAuth(window.app || window.firebaseApp) };
    },

    // Giriş sürerken (Firebase oturumu açıldı, vize henüz yazılmadı) checkAuth / admin.html kapısı oturumu "bayat" saymasın.
    isSignInPending() {
        return this._signInPending;
    },

    async authenticate(password) {
        this.lastErrorMessage = null;
        const norm = this.normalizeAdminPassword(password);
        if (!norm.ok) {
            this.lastErrorMessage = norm.error;
            return false;
        }
        this._signInPending = true;
        let auth = null, sdk = null;
        try {
            await this.waitForAuthSettled();   // yoldaki anonim oturumla yarışmasın (kapanış hotfix'i)
            ({ sdk, auth } = await this._auth());

            // Görünmez E-posta İllüzyonu (Firebase Console'dan bu e-postayı ve şifresini oluşturmalısınız)
            const adminEmail = "admin@medipol.local";

            // [WHY]: AUTH-05 · T3 — admin Firebase oturumu kalıcıydı (persistence ayarı yoktu): tarayıcı kapatılıp açılınca
            //        vize dolmuş olsa da admin token'ı duruyordu. Oturum sekmeye bağlanır; sekme/tarayıcı kapanınca düşer.
            await sdk.setPersistence(auth, sdk.browserSessionPersistence);
            await sdk.signInWithEmailAndPassword(auth, adminEmail, norm.value);

            // Vize oturumla aynı anda yazılır (onAuthStateChanged → checkAuth bu satırdan ÖNCE çalışır; bkz. isSignInPending).
            window.AppModules.Session.grantAdminVisa();
            console.log("✅ Görünmez E-posta İllüzyonu ile Firebase Admin oturumu başarıyla açıldı.");
            return true;
        } catch (error) {
            console.error("Yetkisiz Giriş veya Yanlış Şifre:", error.message);
            // Şifre yanlışsa sistem firebase-handler'ın açtığı Anonim Oturumda (Sadece Okuma) kalmaya devam eder;
            // anonim oturum yeniden yerel kalıcılığa alınır (personel davranışı değişmesin).
            if (auth && sdk) { try { await sdk.setPersistence(auth, sdk.browserLocalPersistence); } catch (e) { } }
            return false;
        } finally {
            this._signInPending = false;
        }
    },

    // [WHY]: Faz 4 · J4 (KJ-3, M13) — admin kendi talebini/adımını onaylarken "biyometrik imza" isteniyordu; cihazda donanım
    //        yoksa her 5 karakteri kabul eden bir prompt'a düşüyordu (fiilen doğrulama yoktu).
    // [HOW]: Açık admin oturumunda parola yeniden doğrulanır (reauthenticateWithCredential). Oturum değişmez; yanlış parola
    //        yalnız false döner. Parola kuralı girişle aynı (normalizeAdminPassword).
    async reauthenticateAdmin(password) {
        this.lastErrorMessage = null;
        const norm = this.normalizeAdminPassword(password);
        if (!norm.ok) { this.lastErrorMessage = norm.error; return false; }
        try {
            const { sdk, auth } = await this._auth();
            const user = auth.currentUser;
            if (!user || user.isAnonymous || user.email !== "admin@medipol.local") { this.lastErrorMessage = 'Yönetici oturumu yok.'; return false; }
            await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, norm.value));
            return true;
        } catch (e) {
            console.warn('[Security] Parola yeniden doğrulanamadı:', e.code || e.message);
            if (e.code === 'auth/too-many-requests') this.lastErrorMessage = 'Çok fazla deneme. Bir süre sonra tekrar deneyin.';
            return false;
        }
    },

    // Parola penceresi. Sonuç: 'verified' | 'cancelled' (Vazgeç / Esc) | 'failed' (3 hatalı deneme).
    promptAdminReauth({ title = 'Parola ile Doğrulama', message = '' } = {}) {
        return new Promise(resolve => {
            document.getElementById('adminReauthModal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'adminReauthModal';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.style.cssText = 'position:fixed; inset:0; z-index:12500; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center;';
            overlay.innerHTML = `
                <div style="background:var(--color-surface,#fff); color:var(--color-text,#1e293b); border-radius:14px; padding:24px; width:min(380px,92vw); box-shadow:0 20px 50px rgba(0,0,0,0.35);">
                    <h3 id="adminReauthTitle" style="margin:0 0 8px; font-size:1.1rem;"></h3>
                    <p id="adminReauthMessage" style="margin:0 0 16px; font-size:0.9rem; color:var(--color-text-muted,#64748b); white-space:pre-line;"></p>
                    <input type="password" id="adminReauthInput" autocomplete="current-password" placeholder="Yönetici parolası"
                        style="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--color-border,#cbd5e1); border-radius:8px; font-size:14px;">
                    <p id="adminReauthError" style="display:none; color:#e74c3c; font-size:0.8rem; margin:8px 0 0;"></p>
                    <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:18px;">
                        <button type="button" id="adminReauthCancel" style="padding:8px 14px; border-radius:8px; border:1px solid var(--color-border,#cbd5e1); background:transparent; color:inherit; cursor:pointer;">Vazgeç</button>
                        <button type="button" id="adminReauthOk" style="padding:8px 14px; border-radius:8px; border:none; background:#2563eb; color:#fff; cursor:pointer;">Doğrula ve Onayla</button>
                    </div>
                </div>`;
            overlay.querySelector('#adminReauthTitle').textContent = title;
            overlay.querySelector('#adminReauthMessage').textContent = message;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('#adminReauthInput');
            const errorEl = overlay.querySelector('#adminReauthError');
            const okBtn = overlay.querySelector('#adminReauthOk');
            let attempts = 0, busy = false;
            const close = result => { overlay.remove(); resolve(result); };
            const submit = async () => {
                if (busy) return;
                busy = true; okBtn.disabled = true;
                const ok = await this.reauthenticateAdmin(input.value);
                busy = false; okBtn.disabled = false;
                if (ok) return close('verified');
                attempts++;
                if (attempts >= 3) return close('failed');
                errorEl.textContent = (this.lastErrorMessage || 'Parola hatalı.') + ` (${3 - attempts} deneme hakkı kaldı)`;
                errorEl.style.display = 'block';
                input.value = '';
                input.focus();
            };
            okBtn.onclick = submit;
            overlay.querySelector('#adminReauthCancel').onclick = () => close('cancelled');
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') close('cancelled');
            });
            setTimeout(() => input.focus(), 0);
        });
    },

    // [WHY]: Faz 4 · J4 (EBYS-04, T6, M12) — kontrol monkey-patch sarmalayıcıdaydı: yalnız index'te, yalnız çağrı window
    //        üzerinden gelirse çalışıyordu; admin.html'de hiç yoktu; günlük sessionStorage'daydı.
    // [HOW]: confirmRequest ve approveStep'in İÇİNDEN, yetki kontrolünden sonra çağrılır (iki sayfada da). Kendi kaydı değilse
    //        { allowed: true }. Personel → engel + 'blocked'. Admin → parola yeniden doğrulaması; vazgeçerse/başaramazsa
    //        'cancelled'; doğrularsa { allowed: true, self: true, entry } — çağıran kayıt BAŞARILI olunca logApproved(entry) yazar.
    //        ctx: { kind: 'request'|'purchase', record, refCol, type, item, qty }
    async guardSelfApproval(ctx) {
        const actor = (typeof window.getActiveUser === 'function' && window.getActiveUser()) || window.currentUser;
        if (!window.Schema.isSelfApproval({ actor, record: ctx.record, kind: ctx.kind })) return { allowed: true, self: false };
        const entry = {
            type: ctx.type, refCol: ctx.refCol, refId: ctx.record.id, item: ctx.item, qty: ctx.qty,
            actorName: actor && actor.name, actorPersonelId: actor && actor.id,
        };
        const alert = (m, t) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(m, t); };
        if (!window.isDbAdmin()) {
            console.warn(`🛡️ [Self-Approval] Personel kendi kaydını onaylamaya çalıştı: ${entry.actorName}`);
            await window.appendAuditLog({ ...entry, result: 'blocked', reason: 'Personel kendi kaydını onaylayamaz' });
            alert('🛡️ GÜVENLİK ENGELİ: Kendi kaydınızı onaylayamazsınız. Girişim denetim günlüğüne yazıldı.', 'error');
            return { allowed: false, self: true };
        }
        const res = await this.promptAdminReauth({
            title: 'Kendi kaydınızı onaylıyorsunuz',
            message: `"${ctx.item || ctx.record.id}" kaydını siz açtınız. Onay için yönetici parolanızı yeniden girin; işlem denetim günlüğüne yazılır.`,
        });
        if (res !== 'verified') {
            await window.appendAuditLog({ ...entry, result: 'cancelled', reason: res === 'failed' ? 'Parola doğrulanamadı (3 deneme)' : 'Yönetici parola doğrulamasından vazgeçti' });
            alert(res === 'failed' ? 'Parola doğrulanamadı; onay verilmedi.' : 'Onay iptal edildi.', 'warning');
            return { allowed: false, self: true };
        }
        return { allowed: true, self: true, entry };
    },

    async logSelfApproval(guard, saved) {
        if (!guard || !guard.self || !guard.entry) return;
        const r = await window.appendAuditLog({ ...guard.entry, result: saved ? 'approved' : 'cancelled',
            reason: saved ? 'Yönetici parola ile yeniden doğrulandı' : 'Parola doğrulandı ama kayıt başarısız' });
        if (!r.ok && typeof window.showAppAlert === 'function') window.showAppAlert('Onay verildi ancak denetim günlüğüne yazılamadı.', 'warning');
    },

    // Parola girildikten sonra atanan kimlik: personel listesindeki yönetici kaydı, yoksa "Yönetici" etiketi (sanal "Admin" değil).
    resolveAdminIdentity() {
        const personel = (window.data && window.data.personel) || [];
        return personel.find(p => p.name === 'Muhammed Cer' || p.name === 'Admin')
            || { name: 'Yönetici', code: 'ADMIN', role: 'admin', yetki: 'admin' };
    },

    // Düşük seviye: dinleyicileri kapat, vizeyi sil, yerel kalıcılığa dön, Firebase oturumunu kapat. Kimlik (activeUser)
    // ve arayüz bu fonksiyonda değişmez — tam çıkış için endAdminSession kullanılır.
    async logout() {
        try {
            window.AppModules.Session.clearAdminVisa();
            const { sdk, auth } = await this._auth();
            // Sayfa açılışında (F5 + dolmuş vize) oturum henüz geri yüklenmemiş olabilir; önce yüklensin, sonra kapatılsın.
            if (typeof auth.authStateReady === 'function') await auth.authStateReady();
            // Faz 3.8: dinleyiciler oturum kapanmadan önce kapatılır; aksi halde her biri permission-denied ile ölür
            // ve "bağlantı yetkisi yok" göstergesi normal bir çıkışta yanlışlıkla belirir.
            if (typeof window.stopRealtimeSync === 'function') window.stopRealtimeSync();
            // Önce signOut: setPersistence mevcut kullanıcıyı taşır; admin oturumu bir an bile localStorage'a (öteki sekmelerin
            // gördüğü yere) yazılmasın. Ardından AUTH-05: açılacak anonim (personel) oturumu yine yerel kalıcılıkta.
            await sdk.signOut(auth);
            await sdk.setPersistence(auth, sdk.browserLocalPersistence);
            console.log("Oturum kapatıldı.");
        } catch (e) {
            console.error("Çıkış yapılırken hata:", e);
        }
    },

    // [WHY]: Faz 4 · J3 (T3, M9, M10) — vize dolumu, kilit, "Güvenli Çıkış", force logout ve bayat oturum dört-beş ayrı
    //        yoldan kapanıyordu; hiçbiri signOut etmiyordu (admin token'ı kilit kartının arkasında geçerli kalıyordu) ya da
    //        onAppLogout yayınlamıyordu (dinleyiciler kilit açılınca yeniden başlamıyordu).
    // [HOW]: Tek zincir: zamanlayıcılar → clearSession() → await signOut (yerel kalıcılığa dönerek) → onAppLogout →
    //        sayfaya göre arayüz (admin.html: kilit kartı, 'logout' ise index.html; index: main.js giriş ekranını açar).
    //        Eşzamanlı çağrılar aynı işi bekler (aralık kontrolü + zamanlayıcı aynı anda tetiklenebilir).
    async endAdminSession(reason = 'manual') {
        if (this._ending) return this._ending;
        this._ending = (async () => {
            console.warn(`🔒 [Security] Oturum sonlandırılıyor. Sebep: ${reason}`);
            clearTimeout(window.sessionTimer);
            clearTimeout(window.warningTimeout);
            const warningDiv = document.getElementById('sessionWarning');
            if (warningDiv) warningDiv.style.display = 'none';

            if (typeof window.clearSession === 'function') window.clearSession();
            await this.logout();
            window.dispatchEvent(new CustomEvent('onAppLogout', { detail: { reason } }));

            if (document.getElementById('adminLockModal')) {
                if (reason === 'logout') window.location.replace('index.html');
                else if (typeof window.showAdminLock === 'function') window.showAdminLock(reason);
                else document.getElementById('adminLockModal').style.setProperty('display', 'flex', 'important');
            } else if (!document.getElementById('loginModal')) {
                window.location.replace('index.html');
            }
        })();
        try {
            return await this._ending;
        } finally {
            this._ending = null;
        }
    }
};

window.SecurityConfig = SecurityConfig;
