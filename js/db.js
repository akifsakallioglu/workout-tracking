// IndexedDB yardımcıları: tarayıcının içindeki veritabanını açma, okuma ve yazma.
const DB_NAME = 'antrenman-takibi';
const DB_VERSION = 1;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Başka bir sekme veritabanını yeni sürüme yükseltmek isterse bağlantıyı bırak.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

export function get(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Söz (promise), tarayıcı yazmanın diske işlendiğini bildirince tamamlanır ("strict" dayanıklılık).
export function put(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite', { durability: 'strict' });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Yazma iptal edildi'));
    transaction.objectStore(storeName).put(value);
  });
}
