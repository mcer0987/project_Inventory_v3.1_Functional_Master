const SecurityConfig = {
    // [WHY]: Blaze planına (ücretli) geçmemek için Backend (Cloud Functions) mimarisini iptal ettik.
    // [HOW]: Bunun yerine 'Görünmez E-posta İllüzyonu' kullanıyoruz. Kullanıcı arayüzde sadece şifre giriyor, sistem bunu sabit bir e-posta ile birleştirip standart Firebase Auth Email/Password girişine dönüştürüyor.

    AUTH_SDK: "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js",
    MIN_PASSWORD_LENGTH: 12,

    // Son başarısız girişin kullanıcıya gösterilecek nedeni (null = genel "hatalı parola").
    lastErrorMessage: null,

    _signInPending: false,
    _ending: null,

    // [WHY]: Faz 4 · J3 (SEC-02 arayüz, M11) — Firebase en az 6 karakter istediği için 5 haneli koda "0" ekleniyordu; arayüz de
    //        5 karakterle sınırlıydı. Parola ≥12 karaktere döndürülecek, ama Auth proje genelidir: yeni parola deploy günü
    //        verilir (T14), o güne kadar bugünkü 5 haneli kod çalışmaya devam etmeli.
    // [HOW]: 5 karakter → eski "0"+kod biçimi (geçiş dalı; sahibinin rotasyon teyidinden sonra Faz 4 kapanış hotfix'inde
    //        kalkar) · ≥12 → olduğu gibi · 6-11 → ağa gitmeden ret ("en az 12 karakter") · diğerleri → hatalı parola.
    normalizeAdminPassword(raw) {
        const pw = raw == null ? '' : String(raw);
        if (pw.length === 5) return { ok: true, value: '0' + pw, legacy: true };
        if (pw.length >= this.MIN_PASSWORD_LENGTH) return { ok: true, value: pw, legacy: false };
        if (pw.length > 5) return { ok: false, error: `Yönetici parolası en az ${this.MIN_PASSWORD_LENGTH} karakter olmalıdır.` };
        return { ok: false, error: null };
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
