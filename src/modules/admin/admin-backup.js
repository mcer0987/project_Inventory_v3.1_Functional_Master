/**
 * modules/admin/admin-backup.js — Birleşik Yedekleme Servisi (Faz 5 · K3 · 5.3 · ADM-06)
 * index.html'de klasik script, admin.html'de admin-main.js'ten içe aktarılır (her iki bağlamda çalışır; global sızdırmaz).
 *
 * [WHY]: İki ayrı yedek aracı iki ayrı biçim üretiyordu: index'teki "Yedek Al" {timestamp, version:'1.0', data} yazıyor,
 *        VIP "1-Tık DB Snapshot" ise window.data'nın ham dökümünü (sarmalayıcısız; auditLogs gibi uygulama dışı anahtarlar
 *        dahil) indiriyordu. Hiçbiri hangi ortamdan (canlı lifeserver_master / demo inventory_demo) alındığını yazmıyordu;
 *        içe aktarma tek bir confirm() ile, neyin değişeceği gösterilmeden, demo yedeğini canlıya basabiliyordu. Ölü bir
 *        restoreFirebaseBackup da şema muhafızını atlayıp doğrudan setDoc yazıyordu (_backupTemp hiç atanmıyordu).
 * [HOW]: Tek kanonik biçim: { version: '3.2', root, timestamp, source, data }. data yalnız uygulama koleksiyonlarını
 *        (firebase-handler COLLECTIONS) taşır — auditLogs ve bilinmeyen anahtarlar asla yedeğe girmez/geri yüklenmez (J4 · M14).
 *        Geri yükleme: (1) ayrıştır + eski biçimleri tanı (v1.0 sarmalı, VIP ham dökümü), (2) ortam denetimi: kanonik yedeğin
 *        root'u aktif köke eşit değilse REDDEDİLİR; root'suz eski biçim yalnız ayrı bir "ortam doğrulanamadı" uyarısıyla,
 *        (3) koleksiyon bazında önizleme (yedekte / şu an / eklenecek / silinecek) onay diyaloğunda gösterilir,
 *        (4) onaylanırsa restoreCollections hepsi-ya-da-hiçbiri yazar (şema muhafızı dahil; Faz 5 denetimi · P0 —
 *        bkz. src/services/atomic-writer.js); başarısızlıkta Firestore da bellek de işlem öncesi hâlindedir.
 *        Saf fonksiyonlar (parseBackup, diffSummary, checkRoot) window'a dokunmaz → tests/unit/backup.test.mjs.
 */
(function () {
    const BACKUP_VERSION = '3.2';

    const appCollections = () => (window.COLLECTIONS || []);
    const clone = v => JSON.parse(JSON.stringify(v));
    const notify = (msg, type) => { if (typeof window.showAppAlert === 'function') window.showAppAlert(msg, type); else alert(msg); };

    // ─── Saf yardımcılar ───────────────────────────────────────────────────────────────────────────────

    /** Kanonik yedek nesnesi. data yalnız `collections` listesindeki ve dizi olan anahtarları taşır. */
    function buildBackup({ data, root, collections, source = 'admin', now = new Date() }) {
        const out = { version: BACKUP_VERSION, root: root || null, timestamp: now.toISOString(), source, data: {} };
        collections.forEach(k => { if (Array.isArray(data && data[k])) out.data[k] = clone(data[k]); });
        return out;
    }

    /**
     * Yedek metnini/nesnesini kanonik biçime ayrıştırır. Tanınan biçimler:
     *   'canonical'  → { version:'3.2', root, timestamp, data }
     *   'legacy-v1'  → { version:'1.0', timestamp, data }        (eski "Yedek Al")
     *   'legacy-raw' → { b1:[…], b2:[…], … }                      (eski VIP "1-Tık DB Snapshot", sarmalayıcısız)
     * @returns {{ok:boolean, errors:string[], warnings:string[], format?:string, backup?:object}}
     */
    function parseBackup(input, { collections }) {
        const errors = [], warnings = [];
        let obj = input;
        if (typeof input === 'string') {
            try { obj = JSON.parse(input); } catch (e) { return { ok: false, errors: ['Dosya geçerli bir JSON değil.'], warnings }; }
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['Yedek bir JSON nesnesi olmalı.'], warnings };

        let format, raw;
        if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
            format = obj.version === BACKUP_VERSION ? 'canonical' : 'legacy-v1';
            raw = obj.data;
            if (format === 'canonical' && !obj.root) errors.push('Kanonik yedekte ortam (root) bilgisi yok.');
        } else if (collections.some(k => Array.isArray(obj[k]))) {
            format = 'legacy-raw';
            raw = obj;
        } else {
            return { ok: false, errors: ['Tanınan bir yedek biçimi değil (data alanı ya da uygulama koleksiyonu yok).'], warnings };
        }

        const data = {};
        Object.keys(raw).forEach(k => {
            if (!collections.includes(k)) { warnings.push(`"${k}" uygulama koleksiyonu değil; atlandı.`); return; }
            if (!Array.isArray(raw[k])) { errors.push(`"${k}" bir dizi değil.`); return; }
            const items = raw[k].filter(it => it && typeof it === 'object' && !Array.isArray(it));
            if (items.length !== raw[k].length) warnings.push(`"${k}": ${raw[k].length - items.length} geçersiz (nesne olmayan) kayıt atlandı.`);
            data[k] = items;
        });
        if (!Object.keys(data).length && !errors.length) errors.push('Yedekte geri yüklenecek uygulama koleksiyonu yok.');
        if (format !== 'canonical') warnings.push('Eski biçimli yedek: hangi ortamdan alındığı doğrulanamıyor.');

        const backup = {
            version: format === 'canonical' ? BACKUP_VERSION : String(obj.version || 'ham'),
            root: format === 'canonical' ? obj.root : null,
            timestamp: obj.timestamp || null,
            source: obj.source || null,
            data,
        };
        return { ok: errors.length === 0, errors, warnings, format, backup };
    }

    /** Ortam denetimi: kanonik yedeğin kökü aktif köke eşit olmalı; kökü olmayan eski yedek "doğrulanamadı" (engel değil). */
    function checkRoot(backup, activeRoot) {
        if (!backup.root) return { ok: true, verified: false, reason: `Yedekte ortam bilgisi yok; aktif ortam "${activeRoot}".` };
        if (backup.root !== activeRoot) {
            return { ok: false, verified: true, reason: `Bu yedek "${backup.root}" ortamından alınmış; aktif ortam "${activeRoot}". Farklı ortama geri yükleme engellendi.` };
        }
        return { ok: true, verified: true, reason: `Ortam eşleşiyor ("${activeRoot}").` };
    }

    /**
     * Faz 5 denetimi (P1): b1/b2 tam 'set' sözleşmesi geri yüklemede de zorunlu. Eski yedeklerdeki takma adlı / eksik
     * alanlı stok kayıtları Schema.toCanonicalStock ile kanonik hâle getirilir (değerler korunur, alan adları düzelir);
     * kanonik kayıt değişmez. Yedeği yerinde değiştirmez.
     * @returns {{data:object, converted:{col:string, count:number}[]}}
     */
    function canonicalizeStock(data, toCanonicalStock) {
        const out = { ...data }, converted = [];
        ['b1', 'b2'].forEach(col => {
            if (!Array.isArray(data[col])) return;
            let count = 0;
            out[col] = data[col].map(p => {
                const c = toCanonicalStock(p, col);
                if (JSON.stringify(Object.entries(c).sort()) !== JSON.stringify(Object.entries(p).sort())) count++;
                return c;
            });
            if (count) converted.push({ col, count });
        });
        return { data: out, converted };
    }

    /** Koleksiyon bazında önizleme: yedekteki kayıt sayısı, şu anki sayı, eklenecek ve silinecek id sayısı. */
    function diffSummary(backup, currentData) {
        return Object.keys(backup.data).map(col => {
            const next = backup.data[col];
            const cur = (currentData && Array.isArray(currentData[col])) ? currentData[col] : [];
            const curIds = new Set(cur.map(x => String(x && x.id)));
            const nextIds = new Set(next.map(x => String(x && x.id)));
            return {
                col, backup: next.length, current: cur.length,
                added: [...nextIds].filter(id => !curIds.has(id)).length,
                removed: [...curIds].filter(id => !nextIds.has(id)).length,
            };
        });
    }

    // ─── Tarayıcı tarafı ───────────────────────────────────────────────────────────────────────────────

    // Test kancası: flow-tests indirme yerine yakalar (BackupService._download değiştirilebilir).
    function download(filename, json) {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /** Kanonik yedeği indirir; yedeği döndürür. source: 'admin' (index "Yedek Al") | 'vip' (VIP snapshot). */
    function exportBackup({ source = 'admin' } = {}) {
        const backup = buildBackup({ data: window.data, root: window.COLLECTION_ROOT, collections: appCollections(), source });
        const stamp = backup.timestamp.slice(0, 19).replace(/:/g, '-');
        Service._download(`medipol-yedek-v${BACKUP_VERSION}-${backup.root || 'bilinmiyor'}-${stamp}.json`, JSON.stringify(backup, null, 2));
        return backup;
    }

    // Önizleme DOM düğümü olarak kurulur (showCustomConfirm Node kabul eder) — innerHTML yok, metin kaçışı gerekmez.
    function previewNode(parsed, rootCheck, summary) {
        const wrap = document.createElement('div');
        const line = (text, style) => { const p = document.createElement('div'); p.textContent = text; if (style) p.style.cssText = style; wrap.appendChild(p); return p; };
        const b = parsed.backup;
        line(`Biçim: ${parsed.format === 'canonical' ? 'Kanonik v' + b.version : 'Eski biçim (' + b.version + ')'}`);
        line(`Yedek tarihi: ${b.timestamp || 'bilinmiyor'}${b.source ? ' · kaynak: ' + b.source : ''}`);
        line(rootCheck.reason, rootCheck.verified ? 'color:#16a34a; font-weight:600;' : 'color:#d97706; font-weight:700;');
        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; margin:10px 0; font-size:12px; text-align:left;';
        const row = (cells, head) => {
            const tr = document.createElement('tr');
            cells.forEach(c => { const td = document.createElement(head ? 'th' : 'td'); td.textContent = String(c); td.style.cssText = 'padding:3px 6px; border-bottom:1px solid #e2e8f0;'; tr.appendChild(td); });
            table.appendChild(tr);
        };
        row(['Koleksiyon', 'Yedekte', 'Şu an', 'Eklenecek', 'Silinecek'], true);
        summary.forEach(s => row([s.col, s.backup, s.current, s.added, s.removed]));
        wrap.appendChild(table);
        parsed.warnings.forEach(w => line('⚠ ' + w, 'color:#d97706; font-size:12px;'));
        const totalRemoved = summary.reduce((n, s) => n + s.removed, 0);
        line(`Yedekte olmayan ${totalRemoved} kayıt KALICI olarak silinecek. Bu işlem geri alınamaz.`, 'color:#dc2626; font-weight:700; margin-top:8px;');
        return wrap;
    }

    /**
     * Yedek metnini doğrular, ortamı denetler, önizleme onayı alır ve geri yükler.
     * @returns {Promise<{status:'forbidden'|'invalid'|'wrong-root'|'cancelled'|'failed'|'restored', message?:string, summary?:object[]}>}
     */
    async function restoreFromText(text) {
        if (typeof window.requireDbAdmin === 'function' && !window.requireDbAdmin('Yedekten geri yükleme')) return { status: 'forbidden' };
        const parsed = parseBackup(text, { collections: appCollections() });
        if (!parsed.ok) { notify('Yedek dosyası geçersiz: ' + parsed.errors[0], 'error'); return { status: 'invalid', message: parsed.errors[0] }; }

        const activeRoot = window.COLLECTION_ROOT;
        const rootCheck = checkRoot(parsed.backup, activeRoot);
        if (!rootCheck.ok) { notify(rootCheck.reason, 'error'); return { status: 'wrong-root', message: rootCheck.reason }; }

        if (window.Schema && typeof window.Schema.toCanonicalStock === 'function') {
            const c = canonicalizeStock(parsed.backup.data, window.Schema.toCanonicalStock);
            parsed.backup.data = c.data;
            c.converted.forEach(x => parsed.warnings.push(`"${x.col}": ${x.count} eski biçimli stok kaydı kanonik şemaya dönüştürülecek (değerler korunur).`));
        }

        const summary = diffSummary(parsed.backup, window.data);
        const ok = typeof window.showCustomConfirm === 'function'
            ? await window.showCustomConfirm('Yedekten Geri Yükle — Önizleme', previewNode(parsed, rootCheck, summary),
                { confirmText: rootCheck.verified ? 'Geri Yükle' : 'Doğrulanmamış Yedeği Geri Yükle', danger: true })
            : window.confirm('Yedek geri yüklenecek; yedekte olmayan kayıtlar silinecek. Emin misiniz?');
        if (ok !== true) return { status: 'cancelled', summary };

        // [Faz 5 denetimi · P0]: saveData parça parça (bağımsız batch'ler) yazdığı için ara bir hatada Firestore'da yarım
        // veri kalıyordu. restoreCollections (atomic-writer.js) hepsi-ya-da-hiçbiri: tek batch'e sığmayan iş günlüklenir,
        // hata olursa yazılan parçalar geri alınır. Yalnız yedekteki koleksiyonlar değişir; window.data yalnız başarıda değişir.
        // Eski yedeklerdeki b3 kayıtlarına göçteki gevşeklik tanınır (b3Legacy) — şema muhafızı yine çalışır.
        try {
            await window.restoreCollections(clone(parsed.backup.data), { b3Legacy: true });
        } catch (e) {
            const code = (e && e.code) || 'write-failed';
            const message = (e && e.message) || 'bilinmeyen hata';
            const text = code === 'rollback-pending'
                ? 'Geri yükleme yarıda kaldı ve geri alma henüz tamamlanamadı. Veritabanı yazmaya kilitlendi; yönetici oturumunda geri alma otomatik tamamlanacak. ' + message
                : code === 'rolled-back'
                    ? 'Yedek geri yüklenemedi; yazılan kısımlar geri alındı, veritabanı işlem öncesi hâlinde. ' + message
                    : 'Yedek geri yüklenemedi; hiçbir değişiklik yazılmadı. ' + message;
            notify(text, 'error');
            return { status: 'failed', code, message, summary };
        }
        notify('Yedek geri yüklendi', 'success');
        if (Service.reloadAfterRestore) setTimeout(() => location.reload(), 800);
        return { status: 'restored', summary };
    }

    const Service = {
        BACKUP_VERSION, buildBackup, parseBackup, checkRoot, diffSummary, canonicalizeStock,
        exportBackup, restoreFromText, _download: download, reloadAfterRestore: true,
    };
    window.AppModules = window.AppModules || {};
    window.AppModules.Backup = Service;
    window.BackupService = Service;

    // ─── Eski giriş noktaları (index.html UAB düğmeleri) → tek servis ──────────────────────────────────
    window.exportFirebaseBackup = function () {
        if (typeof window.checkIsAdmin === 'function' && !window.checkIsAdmin()) { notify('Sadece admin yedek alabilir', 'error'); return; }
        try {
            const b = exportBackup({ source: 'admin' });
            notify(`Yedek indirildi (v${b.version}, ${b.root})`, 'success');
        } catch (err) {
            console.error('Backup error:', err);
            notify('Yedek alınamadı', 'error');
        }
    };

    window.importFirebaseBackup = function (event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => { restoreFromText(e.target.result).catch(err => { console.error(err); notify('Yedek yüklenemedi', 'error'); }); };
        reader.readAsText(file);
        input.value = '';   // aynı dosya ikinci kez seçilebilsin
    };

    // ─── admin.html VIP paneli: snapshot düğmesinin yanına "Yedekten Geri Yükle" (aynı servis) ──────────
    // admin.html'e işaretleme eklenmez; düğme VIP "1-Tık DB Snapshot" düğmesinin yanına çalışma zamanında yerleştirilir.
    function injectVipRestore() {
        const snapBtn = document.querySelector('button[onclick*="vipBackupDatabase"]');
        if (!snapBtn || document.getElementById('vipRestoreBtn')) return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json'; input.id = 'vipRestoreInput'; input.style.display = 'none';
        input.addEventListener('change', window.importFirebaseBackup);
        const btn = snapBtn.cloneNode(false);
        btn.id = 'vipRestoreBtn';
        btn.removeAttribute('onclick');
        btn.style.color = 'var(--vip-warning, #f59e0b)';
        btn.style.borderColor = 'var(--vip-warning, #f59e0b)';
        btn.style.background = 'rgba(245,158,11,0.1)';
        const icon = document.createElement('i'); icon.className = 'fas fa-undo me-2';
        btn.append(icon, 'Yedekten Geri Yükle');
        btn.addEventListener('click', () => input.click());
        snapBtn.after(btn, input);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectVipRestore);
    else injectVipRestore();
})();
