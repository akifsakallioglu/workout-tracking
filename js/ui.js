// Ekranların ortak yardımcıları. Görünüş kuralları: .claude/skills/workout-ui.

// Kullanıcının yazdığı metin sayfaya kod olarak değil, düz metin olarak basılsın.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function errorReason(error) {
  return error?.name === 'QuotaExceededError' ? 'Depolama alanı dolu.' : 'Tarayıcı veriyi yazamadı.';
}

// Ana gezinme: dört ana ekran. Diğer ekranlarda sekme yok, geri bağlantısı var.
const TABS = [
  ['#/', 'Ana Sayfa'],
  ['#/gecmis', 'Geçmiş'],
  ['#/ilerleme', 'İlerleme'],
  ['#/ayarlar', 'Ayarlar'],
];

// Ana ekranların başı: uygulama adı ve sekmeler. current, çizilen ekranın rotasıdır; adres metni
// kullanılmaz, çünkü ana sayfa boş ve bilinmeyen adreslerde de açılır. Açık ekranın sekmesi
// aria-current="page" taşır ve görünüşü de bu öznitelikten gelir. Sekmeler bağlantıdır: ekran
// değişirken beforeLeave yine çalışır; data-nav="tab" ile sekme değişimi geçmişe kayıt eklemez
// (main.js, navigate). Ana Sayfa'da uygulama adı sayfanın başlığıdır (h1).
export function appHeader(current) {
  const tag = current === '#/' ? 'h1' : 'p';
  return `
    <header class="app-head">
      <${tag} class="app-title">Antrenman Takibi</${tag}>
      <nav class="tabs" aria-label="Ana gezinme">
        ${TABS.map(([href, label]) =>
          `<a class="tab" href="${href}" data-nav="tab"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
    </header>`;
}

// Satır içi SVG simgeler. Süstürler; adı yanlarındaki yazı verir. Renk yazıdan gelir (currentColor).
// Yedek için bulut değil indirme simgesi: uygulamada eşitleme yok, yedek cihaza inen bir dosyadır.
const ICONS = {
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  restore: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/>'
    + '<path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

// Başka ekrana götüren liste öğesi: başlık, altında bilgi, sağda ok; leadHtml solda durur (Geçmiş'te
// tarih rozeti). Adres, başlık ve bilgi HTML olarak gelir; kullanıcının yazdığı metin çağıran yerde
// escapeHtml'den geçer.
export function linkItem(href, titleHtml, metaHtml, leadHtml = '') {
  return `
    <li>
      <a class="day" href="${href}">
        ${leadHtml}
        <span class="day-text">
          <span class="day-name">${titleHtml}</span>
          <span class="muted">${metaHtml}</span>
        </span>
        ${icon('chevron-right')}
      </a>
    </li>`;
}

// Başlangıç programındaki günlerin görselleri, gün kimliğine göre (gün adı değişse de kalır).
// Sonradan eklenen günlerde görsel yoktur. Dosyalar tools/render_day_images.py ile üretilir.
const DAY_IMAGES = new Set(['push', 'pull', 'legs', 'upper', 'lower']);

export function dayImage(dayId) {
  return DAY_IMAGES.has(dayId) ? `icons/day-${dayId}.png` : null;
}
