window.exportFirebaseBackup = async function() {

    if (!window.checkIsAdmin()) {
        alert("Sadece admin yedek alabilir");
        return;
    }

    try {

        const backup = {
            timestamp: new Date().toISOString(),
            version: "1.0",
            data: {}
        };

        // tüm koleksiyonları al
        Object.keys(window.data).forEach(key => {
            backup.data[key] = window.data[key];
        });

        const json = JSON.stringify(backup, null, 2);

        const blob = new Blob([json], { type: "application/json" });

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;

        const date = new Date().toISOString().slice(0,19).replace(/:/g,"-");

        a.download = `firebase-backup-${date}.json`;

        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log("✅ Firebase backup indirildi");
        showAppAlert("Firebase yedeği indirildi", "success");

    } catch (err) {
        console.error("Backup error:", err);
        showAppAlert("Yedek alınamadı", "danger");
    }
};

window.importFirebaseBackup = async function(event) {

    if (!window.checkIsAdmin()) return;

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async function(e) {

        try {

            const backup = JSON.parse(e.target.result);

            if (!backup.data) {
                alert("Geçersiz backup dosyası");
                return;
            }

            if (!confirm("Tüm veriler geri yüklenecek. Emin misiniz?")) return;

            Object.keys(backup.data).forEach(key => {
                window.data[key] = backup.data[key];
            });

            // Kullanıcı onaylı tam geri yükleme: yedekte olmayan kayıtlar silinir, bu yüzden toplu silme kilidi bilinçli
            // olarak açılır (Faz 3.1). Kayıt başarısızsa "geri yüklendi" denmez.
            if (typeof window.saveData === 'function') {
                const res = await window.saveData(window.data, { allowBulkDelete: true });
                if (res === false) { showAppAlert("Yedek geri yüklenemedi; hiçbir değişiklik yazılmadı.", "error"); return; }
            }

            showAppAlert("Yedek geri yüklendi", "success");

            setTimeout(()=> location.reload(), 800);

        } catch (err) {
            console.error(err);
            alert("Backup yüklenemedi");
        }

    };

    reader.readAsText(file);
};

// [WHY]: Database version 2 uses a sub-collection schema (inventory_v2/{colName}/items/{id}) to avoid the 1MB Firestore document limit.
// [HOW]: Updated restoreFirebaseBackup to write each item to doc(window.fireDb, COLLECTION_ROOT, key, "items", id) instead of the root collection path.
// [ENV_GUARD] restoreFirebaseBackup artık window.COLLECTION_ROOT'u devralır.
//             Bu, firebase-handler.js'nin yükleme anında belirlediği ortamı (localhost=demo, prod=v2)
//             backup geri yükleme işlemine de uygular. localhost'tan yanlışlıkla
//             production'a restore yapılması artık imkânsızdır.
window.restoreFirebaseBackup = async function() {

    if (!window.checkIsAdmin?.()) return;

    if (!window._backupTemp) {
        alert("Önce backup yükle");
        return;
    }

    if (!confirm("TÜM VERİLER ÜZERİNE YAZILACAK. Emin misin?"))
        return;

    try {

        const { collection, doc, setDoc } = window.FirebaseModules;

        const data = window._backupTemp;

        for (const key in data) {

            const col = data[key];

            if (!Array.isArray(col)) continue;

            for (const item of col) {

                const id = item.id || crypto.randomUUID();

                // [ENV_GUARD] Aktif ortam root'una yazılır; doğrudan "inventory_v2" yerine
                // window.COLLECTION_ROOT kullanılır. Fallback: COLLECTION_ROOT henüz yüklenmemişse
                // "inventory_v2" güvenli varsayılan olarak kullanılır.
                const activeRoot = window.COLLECTION_ROOT || "inventory_v2";
                await setDoc(
                    doc(window.fireDb, activeRoot, key, "items", id),
                    item
                );
            }
        }

        showAppAlert("Backup geri yüklendi", "success");

    } catch(err) {

        console.error(err);
        showAppAlert("Restore hatası", "danger");

    }
};