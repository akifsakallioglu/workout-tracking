// Veri erişim katmanı: ekranlar veritabanına yalnızca buradan ulaşır.
import { get, getAll, openDatabase, put } from './db.js';
import { upgradeProgram } from './logic.js';
import { program as seedProgram } from './seed.js';

let db = null;
let queue = Promise.resolve();
let pending = 0;
let status = { state: 'idle', error: null }; // idle | saving | saved | error
const listeners = new Set();

export async function initStore() {
  db = await openDatabase();
}

// İlk açılışta başlangıç programı veritabanına yazılır; sonra hep veritabanındaki hâli kullanılır.
// Kayıtlı program başlangıç programının eski bir sürümündense yükseltilip yeniden yazılır.
export async function loadProgram() {
  const stored = await get(db, 'meta', 'program');
  let program;
  if (stored) {
    const { key, ...saved } = stored;
    program = upgradeProgram(saved, structuredClone(seedProgram));
    if (program === saved) return saved;
  } else {
    program = structuredClone(seedProgram);
  }
  await enqueue(() => put(db, 'meta', { key: 'program', ...program }));
  return program;
}

export function loadSessions() {
  return getAll(db, 'sessions');
}

export function saveProgram(program) {
  return trackedWrite(() => put(db, 'meta', { key: 'program', ...program }));
}

export function saveSession(session) {
  return trackedWrite(() => put(db, 'sessions', session));
}

// Tüm yazmalar tek sıradan geçer: aynı anda tek yazma olur.
function enqueue(write) {
  const result = queue.then(write);
  queue = result.catch(() => {});
  return result;
}

// Kullanıcının yaptığı değişikliklerin yazması: kayıt durumu güncellenir. "Kaydedildi" durumu
// sıradaki bütün yazmalar bitince gelir; bir yazma başarısız olursa durum "error" olur.
function trackedWrite(write) {
  pending++;
  setStatus({ state: 'saving', error: null });
  return enqueue(write).then(
    () => {
      pending--;
      if (pending === 0) setStatus({ state: 'saved', error: null });
    },
    (error) => {
      pending--;
      setStatus({ state: 'error', error });
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
