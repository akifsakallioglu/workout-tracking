// Ekranların ortak yardımcıları.

// Kullanıcının yazdığı metin sayfaya kod olarak değil, düz metin olarak basılsın.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function errorReason(error) {
  return error?.name === 'QuotaExceededError' ? 'Depolama alanı dolu.' : 'Tarayıcı veriyi yazamadı.';
}
