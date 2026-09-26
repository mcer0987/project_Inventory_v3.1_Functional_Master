const SecurityConfig = {
    // [WHY]: Blaze planına (ücretli) geçmemek için Backend (Cloud Functions) mimarisini iptal ettik.
    // [HOW]: Bunun yerine 'Görünmez E-posta İllüzyonu' kullanıyoruz. Kullanıcı arayüzde sadece şifre giriyor, sistem bunu sabit bir e-posta ile birleştirip standart Firebase Auth Email/Password girişine dönüştürüyor.
    
    async authenticate(password) {
        try {
            const { getAuth, signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(window.app || window.firebaseApp);
            
            // Görünmez E-posta İllüzyonu (Firebase Console'dan bu e-postayı ve şifresini oluşturmalısınız)
            const adminEmail = "admin@medipol.local";
            
            // Firebase Auth şifreleri en az 6 karakter olmasını şart koşar. 
            // 5 haneli yapımızı korumak için kullanıcının girdiği şifrenin başına sabit bir '0' ekliyoruz (Padding).
            const paddedPassword = "0" + password; 
            
            await signInWithEmailAndPassword(auth, adminEmail, paddedPassword);
            console.log("✅ Görünmez E-posta İllüzyonu ile Firebase Admin oturumu başarıyla açıldı.");
            return true;
        } catch (error) {
            console.error("Yetkisiz Giriş veya Yanlış Şifre:", error.message);
            // Şifre yanlışsa sistem firebase-handler'ın açtığı Anonim Oturumda (Sadece Okuma) kalmaya devam eder.
            return false;
        }
    },
    
    async logout() {
        try {
            const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            const auth = getAuth(window.app || window.firebaseApp);
            await signOut(auth);
            console.log("Oturum kapatıldı.");
        } catch (e) {
            console.error("Çıkış yapılırken hata:", e);
        }
    }
};

window.SecurityConfig = SecurityConfig;