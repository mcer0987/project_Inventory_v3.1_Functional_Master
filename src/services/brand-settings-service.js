/**
 * services/brand-settings-service.js — v3.8 UX-5 · Marka ayarı (logo, başlık, efekt) Firestore servisi
 * ES modülü; index (main.js) ve admin (admin-main.js) içe aktarır → window.AppModules.BrandSettings.
 * Bu dosya, {root}/system_config/items/brand_settings belgesine dokunan TEK yerdir (SoC). Saf doğrulama / katalog /
 * önbellek / DOM uygulaması src/ui/brand-logo.js'tedir (window.AppModules.BrandLogo).
 *
 * [WHY]: Marka ayarı tüm kullanıcılarda aynı görünmeli; ama giriş yapılmamış ekranda Firestore okuması kural gereği reddedilir
 *        (okuma member(root)). Konsolu permission-denied ile doldurmamalı ve oturumsuzken önbellekteki ayar görünmeye devam etmeli.
 * [HOW]: Dinleyici yalnız oturum açılınca ('onAuthReady' / mevcut window.userAuth) başlar, 'onAppLogout'ta kapanır. Gelen belge
 *        BrandLogo.validate'ten geçerse önbelleğe yazılıp uygulanır (aynı değer tekrar uygulanmaz); belge yoksa varsayılana dönülür.
 *        permission-denied sessizce yutulur (önbellek geçerli kalır). Yazma: kurallar yalnız yönetici + kapalı şemaya izin verir.
 */
import { onSnapshot, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { systemConfigRef } from './firebase-handler.js';

export class BrandSettingsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BrandSettingsError';
        this.code = code;
    }
}

const DOC_ID = 'brand_settings';
const DENIED_TEXT = 'Kayıt reddedildi: bu ayarı yalnız yönetici değiştirebilir; metinlerde etiket benzeri "<" ifadesi olamaz ve özel logo yalnız küçültülmüş PNG, JPEG veya WebP olabilir.';

const logo = () => {
    const mod = window.AppModules && window.AppModules.BrandLogo;
    if (!mod) throw new BrandSettingsError('not-loaded', 'Marka modülü (brand-logo.js) yüklenmemiş; sayfayı yenileyin.');
    return mod;
};
const ref = () => systemConfigRef(DOC_ID);

let unsubscribe = null;
let subscribedUid = null;

function onSnapshotData(snap) {
    const mod = logo();
    if (!snap.exists()) { // ayar silinmiş / hiç yazılmamış → varsayılan görünüm
        mod.clearCache();
        mod.apply(null);
        return;
    }
    const checked = mod.validate(snap.data());
    if (!checked.ok) return; // şema dışı belge: önbellekteki görünüm kalır
    mod.writeCache(checked.value);
    mod.apply(checked.value);
}

function onSnapshotError(error) {
    const code = error && error.code;
    unsubscribe = null;
    subscribedUid = null;
    if (code === 'permission-denied') return; // oturum üye değil / henüz yetkisiz: önbellek kullanılmaya devam eder
    console.warn('[Marka] Ayar dinlenemedi:', code || (error && error.message));
}

/** Oturum açıkken tek belgelik dinleyiciyi başlatır (aynı kullanıcı için tekrar kurmaz). */
export function startBrandSync() {
    const uid = window.userAuth && window.userAuth.uid;
    if (!uid || (unsubscribe && subscribedUid === uid)) return;
    stopBrandSync();
    subscribedUid = uid;
    unsubscribe = onSnapshot(ref(), onSnapshotData, onSnapshotError);
}

export function stopBrandSync() {
    if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch (e) { /* zaten kapalı */ } }
    unsubscribe = null;
    subscribedUid = null;
}

/**
 * Ayarı yazar (yalnız yönetici). input: {emblemId,title,subtitle,effect,customLogo}; customLogo '' ise özel logo yoktur.
 * Belge her yazımda 7 alanın tamamını içerir (firestore.rules › brandSettingsOk hasAll); özel logo ≤45000 karakterlik
 * png/jpeg/webp data URI'dir ve BrandLogo.validate'ten geçmeden yazılmaz.
 */
export async function saveBrandSettings(input) {
    const mod = logo();
    const checked = mod.validate(input);
    if (!checked.ok) throw new BrandSettingsError('invalid', Object.values(checked.errors)[0]);
    const uid = window.userAuth && window.userAuth.uid;
    if (!uid) throw new BrandSettingsError('no-session', 'Oturum bulunamadı; yeniden giriş yapın.');
    try {
        await setDoc(ref(), { ...checked.value, updatedAt: serverTimestamp(), updatedBy: uid });
    } catch (error) {
        if (error && error.code === 'permission-denied') throw new BrandSettingsError('denied', DENIED_TEXT);
        throw new BrandSettingsError('write-failed', 'Kaydedilemedi; bağlantınızı kontrol edip tekrar deneyin.');
    }
    mod.writeCache(checked.value);
    mod.apply(checked.value);
    return checked.value;
}

/** Ayarı siler → herkes varsayılan görünüme döner. */
export async function resetBrandSettings() {
    const mod = logo();
    try {
        await deleteDoc(ref());
    } catch (error) {
        if (error && error.code === 'permission-denied') throw new BrandSettingsError('denied', DENIED_TEXT);
        throw new BrandSettingsError('write-failed', 'Sıfırlanamadı; bağlantınızı kontrol edip tekrar deneyin.');
    }
    mod.clearCache();
    mod.apply(null);
}

window.AppModules = window.AppModules || {};
window.AppModules.BrandSettings = Object.freeze({
    start: startBrandSync, stop: stopBrandSync, save: saveBrandSettings, reset: resetBrandSettings,
});

// Oturum açılınca başlat, çıkışta kapat. Sayfa açılışında oturum zaten varsa hemen başlar.
window.addEventListener('onAuthReady', startBrandSync);
window.addEventListener('onAppLogout', stopBrandSync);
if (window.userAuth) startBrandSync();
