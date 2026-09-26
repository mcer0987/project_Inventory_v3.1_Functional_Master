const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// Backend'e taşınan gizli değerler
const ADMIN_HASH = "1bb60d59a9391c265f2969565fbda90f81ef1f13bb3d6f376585ad1ce62f7a85";
const SALT = "Qwerty!489797*";

exports.verifyAdminAuth = functions.https.onCall(async (data, context) => {
    const rawPassword = data.password;

    if (!rawPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'Şifre eksik.');
    }

    // Backend üzerinde güvenli hash işlemi
    const secretString = rawPassword + SALT;
    const hashBuffer = crypto.createHash('sha256').update(secretString).digest('hex');

    if (hashBuffer === ADMIN_HASH) {
        // Hash doğruysa Custom Token üret
        try {
            // "admin_demo" adında sabit bir UID kullanıyoruz
            const customToken = await admin.auth().createCustomToken('admin_demo', { role: 'admin' });
            return { token: customToken, success: true };
        } catch (error) {
            throw new functions.https.HttpsError('internal', 'Token üretilemedi.');
        }
    } else {
        // Hash yanlış
        throw new functions.https.HttpsError('permission-denied', 'Yetkisiz giriş.');
    }
});
