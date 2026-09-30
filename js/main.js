// Açılış ve yönlendirme: #/ ana ekran, #/antrenman/<gün> antrenman ekranı, #/gecmis geçmiş,
// #/gecmis/<kimlik> antrenmanın ayrıntısı, #/gecmis/<kimlik>/duzenle düzenleme, #/ilerleme ilerleme
// listesi, #/ilerleme/<gün>/<hareket> grafik, #/program program düzenleyici, #/program/<gün> gün,
// #/program/<gün>/<satır> satır (yeni satır: #/program/<gün>/yeni), #/ayarlar ayarlar.
// Tarayıcı geçmişi telefona yüklenen bir uygulamadaki gibi tutulur (navigate); dört ana ekranda
// parmakla kaydırınca sekme değişir.
import { initStore, screenChanged, waitForWrites } from './store.js';
import { listenForSwipes } from './swipe.js';
import { renderHistory, renderSessionDetail } from './views/history.js';
import { renderHome } from './views/home.js';
import { renderDayEditor, renderItemEditor, renderProgram } from './views/program.js';
import { renderProgressDetail, renderProgressList } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { renderWorkout } from './views/workout.js';

const app = document.getElementById('app');
const TABS = ['#/', '#/gecmis', '#/ilerleme', '#/ayarlar']; // sekme sırası; kaydırma bu sırayla gezer
let view = null; // { beforeLeave?(), flush?(), hasUnsavedChanges?(), destroy?() }; beforeLeave söz dönebilir
let leaving = false; // açık ekran, çıkmadan önce yazmasının sonucunu bekliyor
let shownHash = null;
let shownRoute = null; // açık ekranın rotası; ana sayfa boş ve bilinmeyen adreste de '#/'
let shownTab = null; // açık ana ekranın sekmesi; alt ekranlarda null
let shownFrom = null; // açık ekrana hangi ekrandan gelindi (geçmiş kaydında da yazılı)
let replacing = null; // yerine geçme sürüyor: yeni kayıt, eskisinin geldiği yeri devralır
let slide = ''; // kaydırmayla açılan ekranın giriş yönü: 'left' ya da 'right'
let flash = '';
let showCount = 0;

// Ekran değiştirir. Geçmiş, telefona yüklenen bir uygulamadaki gibi tutulur: her kayıt hangi ekrandan
// gelindiğini bilir (history.state.from) ve telefonun geri hareketi uygulamadaki "←" ile aynı yere gider.
// - 'push': daha derin bir ekrana giriş (ör. gün → satır); geçmişe kayıt ekler.
// - 'up': üst ekrana dönüş ("←", Bitir, Kaydet, Sil sonrası). Geldiğimiz ekran oysa geri gider ve kayıt
//   eklemez; değilse (ör. adres doğrudan açıldıysa) bulunulan kaydın yerine geçer.
// - 'replace': bulunulan kaydın yerine geçer (ör. bulunamayan kayıttan listeye).
// - 'tab': sekme değişimi. Ana Sayfa'dan başka sekmeye geçerken Ana Sayfa geçmişte altta kalır;
//   sekmeler arasında kayıt eklenmez; Ana Sayfa'ya dönüş 'up'tır.
function navigate(hash, message = '', mode = 'push') {
  if (mode === 'tab') {
    if (hash === shownTab) return;
    mode = hash === '#/' ? 'up' : shownTab === '#/' ? 'push' : 'replace';
  }
  flash = message;
  const from = history.state?.from ?? null;
  if (hash === location.hash) {
    if (!leaving) show(); // açık ekran yazmasını bekliyorsa yeni ekranı bekleme bitince hashchange açar
  } else if (mode === 'up' && from === hash) history.back();
  else if (mode === 'push') location.hash = hash;
  else {
    replacing = { from };
    location.replace(hash);
  }
}

async function show() {
  view?.destroy?.();
  view = null;
  screenChanged(); // önceki ekranın başarısız yazması "Güncelle"yi artık engellemez (store.js, waitForWrites)
  // Yeni geçmiş kaydına hangi ekrandan gelindiği yazılır; geri ya da ileri ile dönülen kayıtta zaten
  // yazılıdır. Yerine geçen kayıt, eskisinin geldiği yeri devralır.
  if (history.state === null) history.replaceState({ from: replacing ? replacing.from : shownRoute }, '');
  replacing = null;
  shownFrom = history.state.from;
  shownHash = location.hash;
  const message = flash;
  flash = '';
  // Her ekran yeni bir kaba çizilir; eski ekranın olay dinleyicileri onunla birlikte gider.
  const container = document.createElement('div');
  // Kaydırmayla açılan ekran kısa bir kaymayla gelir ("hareketi azalt" açıksa gelmez); kayma bitince
  // sınıf kalkar.
  if (slide && matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    container.className = `slide-${slide}`;
    container.addEventListener('animationend', () => container.removeAttribute('class'), { once: true });
  }
  slide = '';
  app.replaceChildren(container);
  const token = ++showCount;
  const hash = location.hash;
  const workout = hash.match(/^#\/antrenman\/([\w-]+)$/);
  const session = hash.match(/^#\/gecmis\/([\w-]+)(\/duzenle)?$/);
  const progress = hash.match(/^#\/ilerleme\/([\w-]+)\/([\w-]+)$/);
  const programPath = hash.match(/^#\/program(?:\/([\w-]+)(?:\/([\w-]+))?)?$/);
  shownTab = TABS.includes(hash) ? hash : workout || session || progress || programPath ? null : '#/';
  shownRoute = shownTab ?? hash;
  let shown;
  if (workout) shown = await renderWorkout(container, { dayId: workout[1], navigate });
  else if (session?.[2]) shown = await renderWorkout(container, { editSessionId: session[1], navigate });
  else if (session) shown = await renderSessionDetail(container, { sessionId: session[1], navigate, flash: message });
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

// Ekran değişmeden önce açık ekran bekleyen değişikliğini yazar; gerekirse kullanıcıya sorar. Yazma
// sürüyorsa beforeLeave söz döner: sonuç gelene kadar açık ekran durur, yeni ekran açılmaz.
window.addEventListener('hashchange', async () => {
  if (location.hash === shownHash) {
    // Aşağıda geri alınan adres: yeni kayıt, açık ekranın kaydı gibi işaretlenir.
    if (history.state === null) history.replaceState({ from: shownFrom }, '');
    return;
  }
  if (leaving) return; // bekleme bitince o anki adres açılır
  let allowed = view?.beforeLeave?.() ?? true;
  if (allowed instanceof Promise) {
    leaving = true;
    allowed = await allowed;
    leaving = false;
    if (location.hash === shownHash) return; // beklerken açık ekranın adresine dönüldü
  }
  if (!allowed) {
    replacing = null;
    slide = '';
    location.hash = shownHash;
    return;
  }
  show();
});

// data-nav="tab" (sekme) ve data-nav="up" (üst ekrana dönüş) bağlantıları navigate'ten geçer. Diğer
// bağlantılar daha derine götürür ve tarayıcının olağan davranışıyla geçmişe kayıt ekler.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-nav]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(link.getAttribute('href'), '', link.dataset.nav);
});

// Ana ekranlarda kaydırma: sağdan sola sıradaki sekme, soldan sağa önceki; uçlarda bir şey olmaz.
// Sayfanın tamamı dinlenir: kısa bir ekranın boş alt kısmı main'in dışında kalır.
listenForSwipes(document, (direction, target) => {
  if (!shownTab) return;
  const tabs = target.closest?.('.tabs');
  if (tabs && tabs.scrollWidth > tabs.clientWidth) return; // taşan sekme çubuğu kendi içinde kayar
  const next = TABS[TABS.indexOf(shownTab) + (direction === 'left' ? 1 : -1)];
  if (!next) return;
  slide = direction;
  navigate(next, '', 'tab');
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
