// Açılış ve yönlendirme: #/ ana ekran, #/antrenman/<gün> antrenman ekranı, #/gecmis geçmiş,
// #/gecmis/<kimlik> antrenmanın ayrıntısı, #/gecmis/<kimlik>/duzenle düzenleme, #/ilerleme ilerleme
// listesi, #/ilerleme/<gün>/<hareket> grafik, #/program program düzenleyici, #/program/<gün> gün,
// #/program/<gün>/<satır> satır (yeni satır: #/program/<gün>/yeni), #/ayarlar ayarlar.
// Tarayıcı geçmişi telefona yüklenen bir uygulamadaki gibi tutulur (navigate); dört ana ekranda
// parmakla kaydırınca sekme değişir.
import { initStore, screenChanged, stopWrites, waitForWrites } from './store.js';
import { listenForSwipes, stretch } from './swipe.js';
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
let paused = false; // uygulama başka bir pencerede açıldı: bu pencere durdu (claimWindow)
let shownHash = null;
let shownRoute = null; // açık ekranın rotası; ana sayfa boş ve bilinmeyen adreste de '#/'
let shownTab = null; // açık ana ekranın sekmesi; alt ekranlarda null
let shownFrom = null; // açık ekrana hangi ekrandan gelindi (geçmiş kaydında da yazılı)
let replacing = null; // yerine geçme sürüyor: yeni kayıt, eskisinin geldiği yeri devralır
let slide = ''; // kaydırmayla açılan ekranın giriş yönü: 'left' ya da 'right'
let settling = false; // parmak kalktı, içerik kayıyor: yeni sürükleme başlamaz
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
  if (paused) return;
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
  // Sekmeye dokunarak (ya da geri hareketiyle) başka ana ekrana geçerken sekme çizgisi eski yerinden
  // kayar. Kaydırmayla geçişte çizgi zaten yeni sekmeye varmıştır.
  const indicatorFrom = slide || !motionAllowed() ? null : activeTabBox(app);
  // Her ekran yeni bir kaba çizilir; eski ekranın olay dinleyicileri onunla birlikte gider.
  const container = document.createElement('div');
  // Kaydırmayla açılan ekranın içeriği kaydırma yönünden kayarak gelir ("hareketi azalt" açıksa
  // gelmez); kayma bitince sınıf kalkar.
  if (slide && motionAllowed()) {
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
  if (token === showCount) {
    view = shown;
    if (indicatorFrom) slideIndicator(container.querySelector('.tabs'), indicatorFrom);
  } else shown?.destroy?.();
}

// Ekran değişmeden önce açık ekran bekleyen değişikliğini yazar; gerekirse kullanıcıya sorar. Yazma
// sürüyorsa beforeLeave söz döner: sonuç gelene kadar açık ekran durur, yeni ekran açılmaz.
window.addEventListener('hashchange', async () => {
  if (paused) return;
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

// ---------------------------------------------------------------- Sekmeler arasında geçişin görünüşü

const motionAllowed = () => matchMedia('(prefers-reduced-motion: no-preference)').matches;
const slideTime = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-slide')) || 200;
let indicatorTimer = null;

function tabBox(tab) {
  return { left: tab.offsetLeft, width: tab.offsetWidth };
}

function activeTabBox(root) {
  const tab = root.querySelector('.tabs [aria-current="page"]');
  return tab ? tabBox(tab) : null;
}

// Durağan çizgi açık sekmenin altındadır (CSS). Hareket sırasında onun yerine kayan çizgi görünür
// (.tabs.moving); hareket bitince durağan çizgiye bırakılır. Böylece kendini yeniden çizen ekranda da
// (ör. Ayarlar) çizgi kaybolmaz.
function moveIndicator(nav, box, animate) {
  clearTimeout(indicatorTimer);
  const line = nav.querySelector('.tab-indicator');
  line.classList.toggle('animate', animate);
  line.style.transform = `translateX(${box.left}px)`;
  line.style.width = `${box.width}px`;
  nav.classList.add('moving');
}

function releaseIndicator(nav, after) {
  indicatorTimer = setTimeout(() => nav.classList.remove('moving'), after);
}

// Yeni ana ekranda çizgi, önceki ekrandaki yerinden açık sekmeye kayar.
function slideIndicator(nav, from) {
  const to = nav && activeTabBox(nav);
  if (!to || (to.left === from.left && to.width === from.width)) return;
  moveIndicator(nav, from, false);
  nav.offsetWidth; // başlangıç yeri uygulansın, sonra kaysın
  moveIndicator(nav, to, true);
  releaseIndicator(nav, slideTime());
}

// Ana ekranlarda parmakla sürükleme: içerik (başlık ve sekmeler hariç) parmağı izler, sekme çizgisi
// yandaki sekmeye doğru yol alır. Bırakınca ekranın dörtte birinden fazla sürüklendiyse ya da hızla
// fırlatıldıysa içerik o yöne kayıp çıkar ve yandaki sekme açılır; değilse yerine döner. Uçlarda
// (Ana Sayfa'da sağa, Ayarlar'da sola) içerik esner. "Hareketi azalt" açıksa sayfa sürüklenmez,
// bırakınca doğrudan geçer. Sayfanın tamamı dinlenir: kısa bir ekranın boş alt kısmı main'in dışında kalır.
const neighbor = (dx) => TABS[TABS.indexOf(shownTab) + (dx < 0 ? 1 : -1)];

listenForSwipes(document, {
  start(target) {
    if (!shownTab || settling || leaving || paused) return false;
    const tabs = target.closest?.('.tabs');
    return !(tabs && tabs.scrollWidth > tabs.clientWidth); // taşan sekme çubuğu kendi içinde kayar
  },

  move(dx) {
    const container = app.firstElementChild;
    if (!motionAllowed() || !container) return;
    const next = neighbor(dx);
    const offset = next ? dx : stretch(dx);
    container.classList.add('swipe-drag');
    container.style.setProperty('--drag-x', `${offset}px`);
    const nav = container.querySelector('.tabs');
    if (!nav) return;
    const links = [...nav.querySelectorAll('.tab')];
    const from = tabBox(links[TABS.indexOf(shownTab)]);
    if (next) {
      const to = tabBox(links[TABS.indexOf(next)]);
      const part = Math.min(Math.abs(dx) / window.innerWidth, 1);
      moveIndicator(nav, { left: from.left + (to.left - from.left) * part, width: from.width + (to.width - from.width) * part }, false);
    } else {
      moveIndicator(nav, { left: from.left + offset / 4, width: from.width }, false);
    }
  },

  end(direction) {
    const next = direction && neighbor(direction === 'left' ? -1 : 1);
    const container = app.firstElementChild;
    if (!container?.classList.contains('swipe-drag')) {
      if (next) navigate(next, '', 'tab'); // "hareketi azalt": doğrudan geçer
      return;
    }
    settling = true;
    container.classList.replace('swipe-drag', 'swipe-settle');
    container.style.setProperty('--drag-x', next ? (direction === 'left' ? '-100%' : '100%') : '0px');
    const nav = container.querySelector('.tabs');
    if (nav) moveIndicator(nav, tabBox(nav.querySelectorAll('.tab')[TABS.indexOf(next ?? shownTab)]), true);
    setTimeout(() => {
      settling = false;
      if (next) {
        slide = direction;
        navigate(next, '', 'tab');
        return;
      }
      container.classList.remove('swipe-settle');
      container.style.removeProperty('--drag-x');
      if (nav) releaseIndicator(nav, 0);
    }, slideTime());
  },
});

let updating = false; // "Güncelle" onaylandı: yeni sürüm etkinleşince sayfa yenilenir
let reloading = false; // güncellemenin yenilemesi: kaydedilmemiş değişiklik "Güncelle"de soruldu

// Sayfa kapanırken ya da yenilenirken: bekleyen değişiklik hemen yazılmaya başlar; bekleyen ya da
// başarısız bir yazma varsa tarayıcı uyarı gösterir (her tarayıcı desteklemez).
window.addEventListener('beforeunload', (event) => {
  view?.flush?.();
  if (!reloading && view?.hasUnsavedChanges?.()) {
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

// "Güncelle": yeni sürüm etkinleşmeden önce açık ekran korunur. Bekleyen kayıtlar yazılır; açık
// ekranın yazması başarısızsa güncellenmez. Kaydedilmemiş düzenleme varsa (geçmiş düzenleme, satır
// formu) ekrandan çıkarken olduğu gibi sorulur; vazgeçilirse güncellenmez, değerler formda kalır.
function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  const text = document.getElementById('update-text');
  const button = document.getElementById('update-button');
  banner.hidden = false;
  const stop = (message) => {
    text.textContent = message;
    button.disabled = false;
  };
  const writesSaved = async () => {
    view?.flush?.();
    return waitForWrites();
  };
  button.onclick = async () => {
    button.disabled = true;
    text.textContent = 'Kayıtlar tamamlanıyor…';
    const failed = 'Son değişiklikler kaydedilemediği için güncellenmedi. Önce kaydı tamamlayın.';
    if (!(await writesSaved())) return stop(failed);
    if (view?.hasUnsavedChanges?.() && !(await (view.beforeLeave?.() ?? true))) return stop('Yeni sürüm var.');
    if (!(await writesSaved())) return stop(failed); // sorarken başlayan yazma da beklenir
    updating = true;
    worker.postMessage('skip-waiting');
  };
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!updating) return;
  reloading = true;
  location.reload();
});

// Uygulama aynı anda tek pencerede çalışır: açılan pencere kilidi önceki pencereden alır, önceki pencere
// durur ve yazmaz. Böylece iki pencere (ör. telefonda uygulama ve tarayıcı sekmesi) birbirinin taslağını
// ve programını ezmez. Tarayıcı kilidi desteklemiyorsa denetim yoktur.
function claimWindow() {
  return new Promise((resolve) => {
    if (!navigator.locks) {
      resolve();
      return;
    }
    navigator.locks
      .request('antrenman-takibi', { steal: true }, () => {
        resolve();
        return new Promise(() => {}); // pencere açık kaldıkça tutulur
      })
      .catch((error) => {
        resolve(); // kilit alınamadıysa uygulama yine açılır
        if (error?.name === 'AbortError') pause(); // kilidi başka pencere aldı
      });
  });
}

// Bu pencere durur: yazma kesilir, açık ekran kapanır. "Burada devam et" sayfayı yeniler; yenilenen
// pencere kilidi geri alır ve bu kez öteki pencere durur.
function pause() {
  if (paused) return;
  paused = true;
  stopWrites();
  view?.destroy?.();
  view = null;
  showCount++; // yüklenmekte olan ekran açılmasın
  const section = document.createElement('section');
  section.className = 'card conflict';
  section.setAttribute('aria-labelledby', 'paused-title');
  section.innerHTML = `
    <h1 id="paused-title">Uygulama başka bir pencerede açık</h1>
    <p class="muted">İki pencere aynı anda kaydedip birbirinin değerlerini silmesin diye bu pencere durdu. Burada devam ederseniz öteki pencere durur.</p>
    <div class="conflict-actions">
      <button type="button" class="button primary">Burada devam et</button>
    </div>`;
  section.querySelector('button').addEventListener('click', () => location.reload());
  app.replaceChildren(section);
}

try {
  await claimWindow();
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
