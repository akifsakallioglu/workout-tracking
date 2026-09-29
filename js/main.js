// Açılış ve yönlendirme: #/ ana ekran, #/antrenman/<gün> antrenman ekranı.
import { initStore } from './store.js';
import { renderHome } from './views/home.js';
import { renderWorkout } from './views/workout.js';

const app = document.getElementById('app');
let view = null; // { hasUnsavedChanges?(), destroy?() }
let shownHash = null;
let flash = '';
let showCount = 0;

function navigate(hash, message = '') {
  flash = message;
  if (location.hash === hash) show();
  else location.hash = hash;
}

async function show() {
  view?.destroy?.();
  view = null;
  shownHash = location.hash;
  const message = flash;
  flash = '';
  // Her ekran yeni bir kaba çizilir; eski ekranın olay dinleyicileri onunla birlikte gider.
  const container = document.createElement('div');
  app.replaceChildren(container);
  const token = ++showCount;
  const workout = location.hash.match(/^#\/antrenman\/([\w-]+)$/);
  const shown = workout
    ? await renderWorkout(container, { dayId: workout[1], navigate })
    : await renderHome(container, { flash: message });
  // Bu ekran yüklenirken adres yeniden değiştiyse geç kalan ekran yenisinin yerine geçmesin.
  if (token === showCount) view = shown;
  else shown?.destroy?.();
}

window.addEventListener('hashchange', () => {
  if (location.hash === shownHash) return; // aşağıda geri alınan adres
  if (view?.hasUnsavedChanges?.() && !confirm('Girdiğiniz değerler kaydedilmedi ve silinecek. Çıkmak istiyor musunuz?')) {
    location.hash = shownHash;
    return;
  }
  show();
});

window.addEventListener('beforeunload', (event) => {
  if (view?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

try {
  await initStore();
  await show();
} catch (error) {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent =
    'Uygulama açılamadı: tarayıcı veritabanına erişilemiyor. Gizli sekmede ya da site verileri engelliyken bu olabilir.';
  app.replaceChildren(message);
}
