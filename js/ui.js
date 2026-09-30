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
// değişirken beforeLeave yine çalışır. Ana Sayfa'da uygulama adı sayfanın başlığıdır (h1).
export function appHeader(current) {
  const tag = current === '#/' ? 'h1' : 'p';
  return `
    <header class="app-head">
      <${tag} class="app-title">Antrenman Takibi</${tag}>
      <nav class="tabs" aria-label="Ana gezinme">
        ${TABS.map(([href, label]) =>
          `<a class="tab" href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
    </header>`;
}

// Satır içi SVG simgeler. Süstürler; adı yanlarındaki yazı verir. Renk yazıdan gelir (currentColor).
const ICONS = {
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

// Başka ekrana götüren liste öğesi: başlık, altında bilgi, sağda ok. Adres, başlık ve bilgi HTML
// olarak gelir; kullanıcının yazdığı metin çağıran yerde escapeHtml'den geçer.
export function linkItem(href, titleHtml, metaHtml) {
  return `
    <li>
      <a class="day" href="${href}">
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
