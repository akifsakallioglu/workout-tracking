// Veri erişim katmanı: ekranlar veritabanına yalnızca buradan ulaşır.
import { get, getAll, openDatabase, put, remove, replaceAll } from './db.js';
import { equipmentInUse, upgradeProgram } from './logic.js';
import { program as seedProgram } from './seed.js';

let db = null; // açık bağlantı; kapanınca null olur, bir sonraki işlem yeniden açar (withDatabase)
let opening = null; // açılmakta olan bağlantı: aynı anda tek açma
let queue = Promise.resolve();
let pending = 0;
let status = { state: 'idle', error: null }; // idle | saving | saved | error
let screen = 0; // açık ekranın sırası; başarısız yazma hangi ekranda istendiğini taşır
let stopped = false; // uygulama başka bir pencerede açıldı: bu pencere artık yazmaz (stopWrites)
const listeners = new Set();

export async function initStore() {
  await connect();
}

// İlk açılışta başlangıç programı veritabanına yazılır; sonra hep veritabanındaki hâli kullanılır.
// Kayıtlı program başlangıç programının eski bir sürümündense yükseltilip yeniden yazılır. Yazılamazsa
// da kullanılır (uygulama açılır); bir sonraki okumada yeniden yazılmaya çalışılır.
export async function loadProgram() {
  await queue; // okumalar, daha önce istenen bütün yazmaları görür
  const stored = await withDatabase((database) => get(database, 'meta', 'program'));
  let program;
  if (stored) {
    const { key, ...saved } = stored;
    if ((saved.seedVersion ?? 1) >= seedProgram.seedVersion) return saved;
    const used = equipmentInUse(await withDatabase((database) => getAll(database, 'sessions')));
    program = upgradeProgram(saved, structuredClone(seedProgram), used);
  } else {
    program = structuredClone(seedProgram);
  }
  try {
    await enqueue((database) => put(database, 'meta', { key: 'program', ...program }));
  } catch (error) {
    console.warn('Program yazılamadı; bir sonraki açılışta yeniden denenecek', error);
  }
  return program;
}

export async function loadSessions() {
  await queue; // örneğin ekrandan çıkarken başlatılan taslak yazması bitmeden okunmasın
  return withDatabase((database) => getAll(database, 'sessions'));
}

export function saveProgram(program) {
  return trackedWrite((database) => put(database, 'meta', { key: 'program', ...program }));
}

export function saveSession(session) {
  return trackedWrite((database) => put(database, 'sessions', session));
}

export function deleteSession(id) {
  return trackedWrite((database) => remove(database, 'sessions', id));
}

// Sırada bekleyen ya da yazılmakta olan bir değişiklik var mı.
export function hasPendingWrites() {
  return pending > 0;
}

// Sıradaki bütün yazmaların bitmesini bekler. Son yazma başarılıysa ya da başarısız yazma önceki bir
// ekranda istendiyse true: o ekranın kaydedilemeyen değerleri ekranla birlikte gitti (antrenman
// ekranı çıkmadan önce sorar), beklemek onları geri getirmez.
export async function waitForWrites() {
  await queue;
  return status.state !== 'error' || status.screen !== screen;
}

// Ekran değişti (main.js, show).
export function screenChanged() {
  screen++;
}

// Uygulama başka bir pencerede açıldı (main.js, claimWindow): bu pencerenin sıradaki yazmaları yapılmaz,
// iki pencere birbirinin kaydını ezmesin.
export function stopWrites() {
  stopped = true;
}

// Ayarlar (bu cihaza özel, yedeğe girmez): { lastBackupAt }
export async function loadSettings() {
  await queue;
  const { key, ...settings } = (await withDatabase((database) => get(database, 'meta', 'settings'))) ?? {};
  return settings;
}

export function saveSettings(settings) {
  return trackedWrite((database) => put(database, 'meta', { key: 'settings', ...settings }));
}

// Yedeği geri yükler: program ve bütün antrenmanlar tek adımda değiştirilir. Programın depolama
// anahtarı yedekten gelmez (yedekteki bir "key" alanı onu değiştiremez).
export function restoreBackup(program, sessions) {
  return trackedWrite((database) => replaceAll(database, { ...program, key: 'program' }, sessions));
}

// Tarayıcının verileri kendiliğinden (örneğin yer darlığında) silmemesi. Sonuç: true (kalıcı),
// false (değil) ya da null (tarayıcı desteklemiyor).
export async function isStoragePersisted() {
  if (!navigator.storage?.persisted) return null;
  return navigator.storage.persisted();
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

// Açık bağlantı; yoksa açılır. Açılamazsa hata "DatabaseUnavailable" adını taşır (ui.js, errorReason).
function connect() {
  if (db) return Promise.resolve(db);
  opening ??= openDatabase()
    .then(
      (connection) => {
        // Tarayıcı bağlantıyı kendisi kapatırsa bir sonraki işlem yeniden açar.
        connection.addEventListener('close', () => {
          if (db === connection) db = null;
        });
        db = connection;
        return connection;
      },
      (error) => {
        throw Object.assign(new Error('Veritabanı açılamadı', { cause: error }), { name: 'DatabaseUnavailable' });
      },
    )
    .finally(() => {
      opening = null;
    });
  return opening;
}

// İşlemi açık bağlantıyla yapar. Bağlantı kapanmışsa (InvalidStateError) bağlantı bir kez yeniden
// açılıp işlem bir kez daha denenir: kapalı bağlantıda işlem başlamaz ya da geri alınır, yani iki kez
// uygulanmaz. Kota ya da geçersiz veri hatası olduğu gibi döner.
async function withDatabase(operation) {
  const current = await connect();
  try {
    return await operation(current);
  } catch (error) {
    if (error?.name !== 'InvalidStateError') throw error;
    if (db === current) db = null;
    return operation(await connect());
  }
}

// Tüm yazmalar tek sıradan geçer: aynı anda tek yazma olur.
function enqueue(write) {
  const result = queue.then(() => {
    if (stopped) throw Object.assign(new Error('Uygulama başka bir pencerede açık'), { name: 'WindowPaused' });
    return withDatabase(write);
  });
  queue = result.catch(() => {});
  return result;
}

// Kullanıcının yaptığı değişikliklerin yazması: kayıt durumu güncellenir. "Kaydedildi" durumu
// sıradaki bütün yazmalar bitince gelir; bir yazma başarısız olursa durum "error" olur.
function trackedWrite(write) {
  const requestedOn = screen;
  pending++;
  setStatus({ state: 'saving', error: null });
  return enqueue(write).then(
    () => {
      pending--;
      if (pending === 0) setStatus({ state: 'saved', error: null });
    },
    (error) => {
      pending--;
      setStatus({ state: 'error', error, screen: requestedOn });
      throw error;
    },
  );
}

export function getSaveStatus() {
  return status;
}

export function onSaveStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next) {
  status = next;
  for (const listener of listeners) listener(status);
}

export function createId() {
  // randomUUID yalnızca güvenli bağlamda (https ya da localhost) var; telefondan yerel ağ
  // adresiyle açıldığında yedek yöntem kullanılır.
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
