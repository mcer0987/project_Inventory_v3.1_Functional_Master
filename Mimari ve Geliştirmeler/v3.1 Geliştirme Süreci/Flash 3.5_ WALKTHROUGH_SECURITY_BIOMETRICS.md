# security-biometrics.js - Adım Adım Kullanım Kılavuzu

## Giriş

Bu belge, `security-biometrics.js` modülünün nasıl kullanılacağını, adım adım gösterir. Amacımız: **Kullanıcıların localStorage'daki rol bilgilerini manipüle etmesini engellemek** ve **OS seviyesinde biyometrik güvenlik katmanı eklemek**.

---

## Bölüm 1: Biyometrik Doğrulama İşlemi

### Adım 1: Donanım Kontrolü

İlk olarak, cihazınızda biyometrik doğrulama desteklenip desteklenmediğini kontrol edin:

```javascript
const available = await window.isBiometricAvailable();
console.log('Biyometrik donanım:', available ? 'Var' : 'Yok');
```

**Neden önemli?**  
- Windows Hello, TouchID, FaceID gibi platform özellikleri sadece belirli cihazlarda çalışır.
- Bu kontrol olmadan `navigator.credentials.get` hata verebilir.

### Adım 2: Doğrulama Talebi

Kullanıcıdan biyometrik doğrulama alın:

```javascript
const result = await window.verifyBiometrics({ timeout: 60000 });
if (result) {
    console.log('✅ Doğrulama başarılı! Kullanıcı kimlikli.');
} else {
    console.log('❌ Doğrulama başarısız veya kullanıcı iptal etti.');
}
```

**Ne olur?**  
- **Destekli cihazda:** OS seviyesinde doğrulama penceresi açılır.
- **Desteksiz cihazda:** 5 haneli güvenlik kodu istenir.

---

## Bölüm 2: Veri Maskelenmesi (localStorage Hardening)

### Problem Tanımı

LocalStorage'da şu şekilde saklanan veri:
```javascript
{
    "name": "Ahmet Yılmaz",
    "role": "admin",
    "code": "12345"
}
```

Kullanıcı bu veriyi `localStorage.getItem('activeUser')` ile alıp, `role: "user"` yaparsa admin yetkisi kazanmış olur!

### Çözüm: MaskUserData

```javascript
// Veriyi maskelle
const userData = { name: "Ahmet", role: "admin" };
const masked = window.maskUserData(userData);
localStorage.setItem('activeUser', masked);

// Sonuç: "YVd01Wk..." gibi okunamaz bir string
```

### Çözüm: UnmaskUserData

```javascript
// Maskeli veriyi geri çıkart
const stored = localStorage.getItem('activeUser');
const original = window.unmaskUserData(stored);

console.log(original); // { name: "Ahmet", role: "admin" }
```

**Neden bu karmaşık?**  
- XOR şifrelemesi + Base64, veriyi insanların kolayca düzenleyememesini sağlar.
- `BIOMETRIC_SALT` değeri değiştirildikçe, eski veriler geçersiz olur.

---

## Bölüm 3: İki Faktörlü Doğrulama Akışı

### Akış Şeması

```
1. Kullanıcı 5 haneli kodu girer
        ↓
2. Kod doğru mu kontrol edilir
        ↓
3. Biyometrik doğrulama istenir
        ↓
4. Her iki doğrulama da başarılıysa → Giriş izni
```

### Kod Örneği

```javascript
async function handlePremiumLogin(inputCode) {
    const expectedCode = '12345'; // Sistemdeki doğru kod
    
    const result = await window.authenticateWith2FA(inputCode, expectedCode);
    
    if (result.success) {
        showAppAlert('Hoş geldiniz!', 'success');
        // Kullanıcıyı giriş yapmış olarak işaretle
    } else {
        showAppAlert(result.error, 'error');
    }
}
```

---

## Bölüm 4: Fallback Mekanizması

### Senaryo: Biyometrik Donanım Yok

1. `isBiometricAvailable()` `false` döner
2. `_fallbackChallenge()` devreye girer
3. Kullanıcıya 5 haneli güvenlik kodu istenir
4. Kod doğruysa `true` döner

### Challenge Kodu Oluşturma

```javascript
const challenge = window.generateBiometricChallenge();
// sessionStorage'a 5 haneli kod kaydedilir
```

---

## Bölüm 5: Güvenlik İpuçları

### 🔐 Veri Saklama
```javascript
// ✓ Doğru: Şifreli saklama
window.secureStore('activeUser', { name: 'Ahmet', role: 'user' });

// ✗ Yanlış: Düz metin
localStorage.setItem('activeUser', JSON.stringify({ name: 'Ahmet', role: 'user' }));
```

### ⏱️ Zaman Aşımı
```javascript
window.verifyBiometrics({ timeout: 60000 }); // 60 saniye
```

### 🔄 Hata Yönetimi
```javascript
try {
    const ok = await window.verifyBiometrics();
} catch (e) {
    console.error('Doğrulama hatası:', e);
    // Fallback otomatik çalışır
}
```

---

## Bölüm 6: Entegrasyon Kontrol Listesi

- [ ] `index.html`'ye script etiketi eklendi
- [ ] `script.js` içinde `window.secureRetrieve` ile kullanıcı verisi okunuyor
- [ ] Admin işlemleri için `window.verifyBiometrics()` çağrısı yapıldı
- [ ] `BIOMETRIC_SALT` değiştirildi (prod ortamı için)

---

## SSS (Sık Sorulan Sorular)

**S: WebAuthn localhost'ta çalışır mı?**  
C: Evet, ancak `https` gerekir. Geliştirme için `localhost` istisnadır.

**S: XOR şifrelemesi ne kadar güvenli?**  
C: Yüksek güvenlik için değil, veri manipülasyonunu engellemek için yeterlidir. Gerçek şifreleme için `SubtleCrypto` kullanılabilir.

**S: Kullanıcı birden fazla parmak izi/k facialar kaydetmişse?**  
C: WebAuthn otomatik olarak platform varsayılanını kullanır.