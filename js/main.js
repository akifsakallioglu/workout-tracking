// Açılış ve yönlendirme: #/ ana ekran, #/antrenman/<gün> antrenman ekranı, #/gecmis geçmiş,
// #/gecmis/<kimlik> antrenmanın ayrıntısı, #/gecmis/<kimlik>/duzenle düzenleme, #/ilerleme ilerleme
// listesi, #/ilerleme/<gün>/<hareket> grafik, #/program program düzenleyici, #/program/<gün> gün,
// #/program/<gün>/<satır> satır (yeni satır: #/program/<gün>/yeni), #/ayarlar ayarlar.
import { initStore, waitForWrites } from './store.js';
import { renderHistory, renderSessionDetail } from './views/history.js';
import { renderHome } from './views/home.js';
import { renderDayEditor, renderItemEditor, renderProgram } from './views/program.js';
import { renderProgressDetail, renderProgressList } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { renderWorkout } from './views/workout.js';

const app = document.getElementById('app');
let view = null; // { beforeLeave?(), flush?(), hasUnsavedChanges?(), destroy?() }
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
  const hash = location.hash;
  const workout = hash.match(/^#\/antrenman\/([\w-]+)$/);
  const history = hash.match(/^#\/gecmis\/([\w-]+)(\/duzenle)?$/);
  const progress = hash.match(/^#\/ilerleme\/([\w-]+)\/([\w-]+)$/);
  const programPath = hash.match(/^#\/program(?:\/([\w-]+)(?:\/([\w-]+))?)?$/);
  let shown;
  if (workout) shown = await renderWorkout(container, { dayId: workout[1], navigate });
  else if (history?.[2]) shown = await renderWorkout(container, { editSessionId: history[1], navigate });
  else if (history) shown = await renderSessionDetail(container, { sessionId: history[1], navigate, flash: message });
  else if (hash === '#/gecmis') shown = await renderHistory(container, { flash: message });
  else if (progress) shown = await renderProgressDetail(container, { dayId: progress[1], exerciseId: progress[2], navigate });
  else if (hash === '#/ilerleme') shown = await renderProgressList(container);
  else if (programPath?.[2]) shown = await renderItemEditor(container, { dayId: programPath[1], itemId: programPath[2], navigate });
  else if (programPath?.[1]) shown = await renderDayEditor(container, { dayId: programPath[1], navigate, flash: message });
  else if (programPath) shown = await renderProgram(container, { navigate, flash: message });
  else if (hash === '#/ayarlar') shown = await renderSettings(container);
  else shown = await renderHome(container, { flash: message });
  // Bu ekran yüklenirken adres yeniden değiştiyse geç kalan ekran yenisinin yerine geçmesin.
  if (token === showCount) view = shown;
  else shown?.destroy?.();
}

// Ekran değişmeden önce açık ekran bekleyen değişikliğini yazar; gerekirse kullanıcıya sorar.
window.addEventListener('hashchange', () => {
  if (location.hash === shownHash) return; // aşağıda geri alınan adres
  if (view?.beforeLeave && !view.beforeLeave()) {
    location.hash = shownHash;
    return;
  }
  show();
});

// Sayfa kapanırken ya da yenilenirken: bekleyen değişiklik hemen yazılmaya başlar; bekleyen ya da
// başarısız bir yazma varsa tarayıcı uyarı gösterir (her tarayıcı desteklemez).
window.addEventListener('beforeunload', (event) => {
  view?.flush?.();
  if (view?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// Service worker uygulama dosyalarını telefonda saklar (internetsiz açılış). Yayında hep açıktır;
// bilgisayarda (localhost) yalnızca adreste ?sw=1 varsa: geliştirirken eski kod önbellekten gelmesin.
async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    return;
  }
  const registration = await navigator.serviceWorker.register('sw.js');
  const offer = (worker) => showUpdateBanner(worker);
  if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker.addEventListener('statechange', () => {
      // İlk kurulumda değil, eski bir sürüm çalışırken yeni sürüm hazır olunca sorulur.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
}

let updating = false;

// "Güncelle": önce bekleyen kayıtlar yazılır; yazma başarısız olduysa güncellenmez.
function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  const text = document.getElementById('update-text');
  const button = document.getElementById('update-button');
  banner.hidden = false;
  button.onclick = async () => {
    button.disabled = true;
    text.textContent = 'Kayıtlar tamamlanıyor…';
    view?.flush?.();
    if (!(await waitForWrites())) {
      text.textContent = 'Son değişiklikler kaydedilemediği için güncellenmedi. Önce kaydı tamamlayın.';
      button.disabled = false;
      return;
    }
    updating = true;
    worker.postMessage('skip-waiting');
  };
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (updating) location.reload();
});

try {
  await initStore();
  await show();
  setupServiceWorker().catch((error) => console.warn('Service worker kurulamadı', error));
} catch (error) {
  console.error(error);
  const message = document.createElement('p');
  message.className = 'fatal';
  message.textContent =
    'Uygulama açılamadı: tarayıcı veritabanına erişilemiyor. Gizli sekmede ya da site verileri engelliyken bu olabilir.';
  app.replaceChildren(message);
}
