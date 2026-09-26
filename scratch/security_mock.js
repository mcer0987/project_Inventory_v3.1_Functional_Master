const SecurityConfig = {
    // Tüm gizli hash ve salt verileri Backend'e (Cloud Functions) taşındı.
    // Artık kaynak kodda hiçbir şifre veya tuz görünmüyor!

    async authenticate(password) {
        try {
            // 1. Firebase Cloud Functions'ı çağır
            const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js");
            const functions = getFunctions(window.app); // window.app'in firebase-handler.js içinde tanımlandığını varsayıyoruz
            const verifyAdminAuth = httpsCallable(functions, 'verifyAdminAuth');

            // 2. Şifreyi backend'e yolla
            const result = await verifyAdminAuth({ password: password });
            const customToken = result.data.token;

            // 3. Dönen Token ile Firebase oturumu aç
            const { getAuth, signInWithCustomToken } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(window.app);
            
            await signInWithCustomToken(auth, customToken);
            console.log("✅ Custom Token ile Firebase oturumu başarıyla açıldı.");
            return true;
        } catch (error) {
            console.error("Yetkisiz Giriş veya Sunucu Hatası:", error.message);
            return false;
        }
    },
    
    async logout() {
        try {
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(window.app);
            await signOut(auth);
            console.log("Oturum kapatıldı.");
        } catch (e) {
            console.error("Çıkış yapılırken hata:", e);
        }
    }
};

window.SecurityConfig = SecurityConfig;
