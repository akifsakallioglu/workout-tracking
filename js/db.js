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
  return write(db, storeName, (store) => store.put(value));
}

export function remove(db, storeName, key) {
  return write(db, storeName, (store) => store.delete(key));
}

// Programı ve bütün antrenmanları tek adımda değiştirir: ya hepsi yazılır ya hiçbiri.
export function replaceAll(db, program, sessions) {
  return write(db, ['meta', 'sessions'], (meta, sessionStore) => {
    sessionStore.clear();
    for (const session of sessions) sessionStore.put(session);
    meta.put(program);
  });
}

function write(db, storeNames, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, 'readwrite', { durability: 'strict' });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Yazma iptal edildi'));
    try {
      operation(...[storeNames].flat().map((name) => transaction.objectStore(name)));
    } catch (error) {
      // İşlemin yarısı yapılmışken hata çıkarsa hiçbir değişiklik kalmasın.
      transaction.abort();
      reject(error);
    }
  });
}
