// Veri erişim katmanı: ekranlar veritabanına yalnızca buradan ulaşır.
import { getAll, openDatabase, put } from './db.js';

let db = null;
let queue = Promise.resolve();
let pending = 0;
let status = { state: 'idle', error: null }; // idle | saving | saved | error
const listeners = new Set();

export async function initStore() {
  db = await openDatabase();
}

export function loadSessions() {
  return getAll(db, 'sessions');
}

// Tüm yazmalar tek sıradan geçer: aynı anda tek yazma olur. "Kaydedildi" durumu, sıradaki
// bütün yazmalar bitince gelir; bir yazma başarısız olursa durum "error" olur.
export function saveSession(session) {
  pending++;
  setStatus({ state: 'saving', error: null });
  const write = queue.then(() => put(db, 'sessions', session));
  queue = write.catch(() => {});
  return write.then(
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
