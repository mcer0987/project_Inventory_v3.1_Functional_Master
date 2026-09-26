// db.js - IndexedDB wrapper
window.db = null;
const request = indexedDB.open('InventoryDB', 2);

// db.js içindeki onupgradeneeded kısmına bunları ekle
request.onupgradeneeded = (event) => {
    db = event.target.result;
    if (!db.objectStoreNames.contains('b1')) db.createObjectStore('b1', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('b2')) db.createObjectStore('b2', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('b3')) db.createObjectStore('b3', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('personel')) db.createObjectStore('personel', { keyPath: 'id', autoIncrement: true });
    
    if (!db.objectStoreNames.contains('productTypes')) db.createObjectStore('productTypes', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('requests')) db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
    if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
};

request.onsuccess = (event) => {
    window.db = event.target.result; // Global değişkene ata
    console.log("✅ IndexedDB Bağlantısı Başarılı.");
};

function saveToDB(storeName, dataArray) {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();  // Eski veriyi temizle
    dataArray.forEach(item => store.add(item));
}

window.loadFromDB = function(storeName) {
    return new Promise((resolve, reject) => {
        if (!window.db) {
            reject("Veritabanı henüz hazır değil");
            return;
        }
        const transaction = window.db.transaction([storeName], "readonly");
        const objectStore = transaction.objectStore(storeName);
        const getAllRequest = objectStore.getAll();

        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        getAllRequest.onerror = () => reject("Veri çekilemedi");
    });
};

window.saveToDB = saveToDB; // Mevcut fonksiyonu global yap