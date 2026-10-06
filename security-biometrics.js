// [SECURITY_GUARD] Premium OS-Level Biometric Verification Module
// Implements WebAuthn-based biometric authentication with localStorage hardening

// [SECURITY_GUARD] Check if biometric authentication is available on this device
export async function isBiometricAvailable() {
    if (!window.PublicKeyCredential) {
        return false;
    }
    try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return available;
    } catch (e) {
        return false;
    }
}

// [SECURITY_GUARD] Request OS-level biometric verification (Windows Hello, TouchID, FaceID)
// [WHY]: Faz 4 · J4 (4.5 · AUTH-03, M13) — donanım yoksa ya da WebAuthn hata verirse "_fallbackChallenge"a düşülüyordu: bir
//        prompt açılıyor ve HER 5 karakterlik girdiyi kabul ediyordu (doğrulama yoktu). Kayıtlı kimlik bilgisi de yoktu
//        (allowCredentials: []), yani başarı yalnız cihazın bir şey döndürmesine bağlıydı.
// [HOW]: Session Store bayrağı (ENABLE_BIOMETRIC_LOGIN) kapalıyken her zaman false. Açık olsa bile hiçbir yedek yol yok:
//        donanım yok / hata / iptal → false. Admin'in kendi kaydını onaylaması parola yeniden doğrulamasıyla (KJ-3, security.js).
export async function verifyBiometrics(options = {}) {
    if (!(window.AppModules && window.AppModules.Session && window.AppModules.Session.ENABLE_BIOMETRIC_LOGIN === true)) return false;
    if (!await isBiometricAvailable()) return false;
    try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        // [BUGFIX] Bug 7: platform (OS) doğrulayıcısı zorunlu — aksi halde WebAuthn önce USB anahtarı arıyor.
        const credential = await navigator.credentials.get({
            publicKey: {
                challenge,
                timeout: options.timeout || 30000,
                userVerification: 'required',
                rpId: window.location.hostname,
                allowCredentials: [],
                authenticatorAttachment: "platform"
            }
        });
        return !!(credential && credential.type === 'public-key');
    } catch (error) {
        console.warn('[security-biometrics] Biyometrik doğrulama başarısız:', error.name);
        return false;
    }
}

// [WHY]: activeUser formatının tek sahibi Session Store (src/utils/session-store.js); ikinci bir maskeleme uygulaması formatları ayrıştırıyordu.
// [HOW]: Bu dört fonksiyon yalnızca Session Store'a delege eden uyumluluk sarmalayıcılarıdır.
const _session = () => window.AppModules.Session;

export function maskUserData(obj) {
    return _session().maskUserData(obj);
}

export function unmaskUserData(str) {
    return _session().unmaskUserData(str);
}

export async function secureStore(key, data) {
    if (key === 'activeUser') return _session().setActiveUser(data);
    const masked = maskUserData(data);
    if (!masked) return false;
    localStorage.setItem(key, masked);
    return true;
}

export function secureRetrieve(key) {
    if (key === 'activeUser') return _session().getActiveUser();
    return unmaskUserData(localStorage.getItem(key));
}


// Attach functions to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.isBiometricAvailable = isBiometricAvailable;
    window.verifyBiometrics = verifyBiometrics;
    window.maskUserData = maskUserData;
    window.unmaskUserData = unmaskUserData;
    window.secureStore = secureStore;
    window.secureRetrieve = secureRetrieve;
}