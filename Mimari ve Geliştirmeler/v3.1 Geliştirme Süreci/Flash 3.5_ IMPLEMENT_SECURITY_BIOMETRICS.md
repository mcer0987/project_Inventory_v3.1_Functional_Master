# security-biometrics.js Implementasyon Kılavuzu

## Neden? (WHY)

Modern web uygulamalarında, şifre tabanlı kimlik doğlulama tek başına yeterli olmaya başladı. Kullanıcılar `localStorage` içinde saklanan rol bilgilerini kolayca düzenleyebilir. Bu durum, yetkisiz erişim riskine yol açar.

**Çözüm:** İki faktörlü kimlik doğrulama (2FA) ve veri maskelenmesi:
1. **Biyometrik doğrulama** - OS seviyesinde (Windows Hello, TouchID, FaceID)
2. **Veri masking** - localStorage'da saklanan kullanıcı verilerini XOR + Base64 ile şifreleme

## Nasıl? (HOW)

### 1. Biyometrik Doğrulama Akışı

```
Kullanıcı Erişim Talebi
        ↓
5 Haneli Kod Kontrolü
        ↓
Biyometrik Donanım Kontrolü (isBiometricAvailable)
        ↓
┌─────────────────┴─────────────────┐
│                                   │
WebAuthn (navigator.credentials.get)  Desteklenmiyor → Fallback Prompt
        ↓                             │
Platform Kimlik Doğrulaması          5 Haneli Güvenlik Kodu
(Windows Hello / TouchID / FaceID)        ↓
        ↓                        Kullanıcı Doğrulandı mı?
    Başarılı → true                     ↓
    Başarısız → false              Başarılı → true
                                   Başarısız → false
```

### 2. WebAuthn API Kullanımı

```javascript
// [SECURITY_GUARD] WebAuthn talebi oluşturulur
const publicKeyRequest = {
    challenge: challenge,           // Rastgele 32 byte challenge
    timeout: 30000,                 // 30 saniye zaman aşımı
    userVerification: 'required',    // Platform doğrulaması zorunlu
    rpId: window.location.hostname,  // Origin kontrolü
    allowCredentials: []            // Yeni kimlik doğrulama
};

const credential = await navigator.credentials.get({ publicKey: publicKeyRequest });
```

### 3. Veri Masking Mekanizması

```
Kullanıcı Objesi
    ↓
{personel: "Ahmet", role: "admin", ...password, ...token}
    ↓   [SECURITY_GUARD] Şifre/token silinir
{personel: "Ahmet", role: "admin"}
    ↓   [XOR Şifreleme] Her karakter salt ile XOR'lanır
Şifreli String
    ↓   [Base64] Base64'e dönüştürülür
"aV5k9..." (localStorage)
```

### 4. Hata Yönetimi

| Hata Türü | İşlem |
|-----------|-------|
| `NotAllowedError` | Kullanıcı iptal etti → false döner |
| `SecurityError` | Context hatası → Fallback aktif |
| `TypeError` | API desteklenmiyor → Fallback aktif |

## Entegrasyon Noktaları

### HTML Entegrasyonu
```html
<script type="module" src="security-biometrics.js?v=1.0.0"></script>
```

### Kullanım Örnekleri

**Biyometrik kontrol:**
```javascript
if (await window.verifyBiometrics()) {
    // Yetkili işlem
}
```

**Veri saklama:**
```javascript
const masked = window.maskUserData({name: "Ahmet", role: "admin"});
localStorage.setItem('activeUser', masked);
```

**Veri okuma:**
```javascript
const userData = window.unmaskUserData(localStorage.getItem('activeUser'));
```

## API Referansı

| Fonksiyon | Parametre | Dönüş | Açıklama |
|-----------|-----------|-------|----------|
| `verifyBiometrics(options)` | `{timeout: number}` | `Promise<boolean>` | OS seviyesinde doğrulama |
| `isBiometricAvailable()` | - | `Promise<boolean>` | Cihaz uyumluluk kontrolü |
| `maskUserData(obj)` | `Object` | `string\|null` | Veriyi şifreler |
| `unmaskUserData(str)` | `string` | `Object\|null` | Şifreyi çözer |
| `secureStore(key, data)` | `string, Object` | `Promise<boolean>` | Şifreli saklama |
| `secureRetrieve(key)` | `string` | `Object\|null` | Şifreli okuma |
| `authenticateWith2FA(code, expected)` | `string, string` | `Promise<{success, error}>` | 2FA akışı |
| `generateBiometricChallenge()` | - | `string` | 5 haneli challenge kodu |