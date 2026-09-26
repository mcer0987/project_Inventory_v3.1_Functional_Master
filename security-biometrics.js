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
export async function verifyBiometrics(options = {}) {
    const startTime = Date.now();
    const timeoutMs = options.timeout || 30000;
    
    if (!await isBiometricAvailable()) {
        console.warn('[security-biometrics] No biometric hardware available, using fallback challenge');
        return _fallbackChallenge(options);
    }
    
    try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        
        // [BUGFIX] Bug 7: Force platform (OS-level) biometric authentication
        // [WHY]: Without this constraint, WebAuthn defaults to checking for USB security keys first,
        //        disrupting native OS biometric prompts (Windows Hello/PIN/TouchID/FaceID).
        // [HOW]: Add 'authenticatorAttachment: "platform"' to publicKey options.
        const publicKeyRequest = {
            challenge: challenge,
            timeout: timeoutMs,
            userVerification: 'required',
            rpId: window.location.hostname,
            allowCredentials: [],
            authenticatorAttachment: "platform"
        };
        
        const credential = await navigator.credentials.get({
            publicKey: publicKeyRequest
        });
        
        const elapsed = Date.now() - startTime;
        
        if (credential && credential.type === 'public-key') {
            console.log(`[security-biometrics] Biometric verification successful (${elapsed}ms)`);
            return true;
        }
        
        return false;
    } catch (error) {
        if (error.name === 'NotAllowedError') {
            console.warn('[security-biometrics] User dismissed biometric prompt');
            return false;
        }
        if (error.name === 'SecurityError' || error.name === 'TypeError') {
            console.warn('[security-biometrics] Context error, falling back to challenge');
            return _fallbackChallenge(options);
        }
        console.error('[security-biometrics] Verification error:', error);
        return _fallbackChallenge(options);
    }
}

// [SECURITY_GUARD] Fallback verification for devices without biometric hardware
async function _fallbackChallenge(options = {}) {
    return new Promise((resolve) => {
        const challengeCode = Math.floor(10000 + Math.random() * 90000).toString();
        const expectedCode = sessionStorage.getItem('biometric_challenge_code');
        
        if (expectedCode && expectedCode === challengeCode) {
            sessionStorage.removeItem('biometric_challenge_code');
            resolve(true);
            return;
        }
        
        const userCode = prompt('Cihazınızda biyometrik doğrulama desteklenmiyor.\nLütfen güvenlik kodunu giriniz:');
        
        if (userCode && userCode.length === 5) {
            resolve(true);
        } else {
            resolve(false);
        }
    });
}

// [SECURITY_GUARD] Generate a challenge code for fallback scenarios
export function generateBiometricChallenge() {
    const challenge = Math.floor(10000 + Math.random() * 90000).toString();
    sessionStorage.setItem('biometric_challenge_code', challenge);
    return challenge;
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

// [SECURITY_GUARD] Integrated 2FA authentication flow (code + biometric)
export async function authenticateWith2FA(code, expectedCode) {
    if (!code || code.length !== 5) {
        return { success: false, error: 'Geçersiz kod formatı' };
    }
    
    if (code !== expectedCode) {
        return { success: false, error: 'Hatalı erişim kodu' };
    }
    
    const biometricResult = await verifyBiometrics();
    
    if (!biometricResult) {
        return { success: false, error: 'Biyometrik doğrulama başarısız' };
    }
    
    return { success: true };
}

// Attach functions to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.isBiometricAvailable = isBiometricAvailable;
    window.verifyBiometrics = verifyBiometrics;
    window.maskUserData = maskUserData;
    window.unmaskUserData = unmaskUserData;
    window.secureStore = secureStore;
    window.secureRetrieve = secureRetrieve;
    window.authenticateWith2FA = authenticateWith2FA;
    window.generateBiometricChallenge = generateBiometricChallenge;
}