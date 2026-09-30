// Parmakla yatay sürükleme: ana ekranlarda sekmeler arasında geçiş için. Hareketin yönü ilk birkaç
// pikselde belirlenir. Yatay başladıysa parmak kalkana kadar sayfa dikey kaymaz (touchmove engellenir);
// dikey başladıysa sayfa olağan kayar ve sürükleme olmaz. Kararlar saf fonksiyonlardadır (birim testi).

export const SWIPE_EDGE = 24; // ekranın kenarından başlayan kaydırma telefonundur (geri/ileri)
export const AXIS_LOCK = 6; // yön bu kadar hareketten sonra belirlenir (px); tarayıcı kaydırmaya başlamadan önce
export const SWIPE_RATIO = 0.25; // ekran genişliğinin bu kadarı sürüklenirse bırakınca geçer
export const FLICK_MIN = 30; // hızlı fırlatmada yetecek en kısa yol (px)
export const FLICK_SPEED = 0.5; // hızlı fırlatma sayılan hız (px/ms)
export const STRETCH = 0.3; // sekmenin olmadığı yönde içerik parmağın bu kadarını izler (esneme)
export const STRETCH_MAX = 64; // esnemenin en çok yolu (px)
const SPEED_WINDOW = 100; // hız, son bu kadar milisaniyedeki hareketten hesaplanır

// Hareketin ekseni: 'x', 'y' ya da henüz belli değilse null.
export function gestureAxis(dx, dy) {
  if (Math.hypot(dx, dy) < AXIS_LOCK) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

// Parmak kalkınca: 'left' (parmak sola: sıradaki sekme), 'right' (önceki sekme) ya da yerine dönüş
// (null). velocity, son anlardaki yatay hızdır (px/ms); width, ekranın genişliğidir.
export function swipeResult(dx, velocity, width) {
  const direction = dx < 0 ? 'left' : 'right';
  if (Math.abs(dx) >= width * SWIPE_RATIO) return direction;
  const flick = Math.abs(velocity) >= FLICK_SPEED && Math.sign(velocity) === Math.sign(dx);
  return flick && Math.abs(dx) >= FLICK_MIN ? direction : null;
}

// Sekmenin olmadığı yöne sürüklenince içeriğin yolu: parmağın gerisinde kalır, en çok STRETCH_MAX.
export function stretch(dx) {
  return Math.sign(dx) * Math.min(Math.abs(dx) * STRETCH, STRETCH_MAX);
}

// element'te tek parmakla yatay sürükleme. handlers:
// - start(target): sürükleme bu dokunuşta başlayabilir mi (ör. yalnızca ana ekranlarda).
// - move(dx): yatay sürükleme sürüyor; dx, başlangıçtan bu yana yatay yol.
// - end(result): parmak kalktı; result swipeResult'ın sonucudur (dokunma iptal edildiyse null).
export function listenForSwipes(element, handlers) {
  let track = null; // { x, y, axis, samples }
  const cancel = () => {
    if (track?.axis === 'x') handlers.end(null);
    track = null;
  };
  element.addEventListener('touchstart', (event) => {
    cancel(); // ikinci parmak sürüklemeyi bırakır
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    if (!touch || touch.clientX < SWIPE_EDGE || touch.clientX > window.innerWidth - SWIPE_EDGE) return;
    if (!handlers.start(event.target)) return;
    track = { x: touch.clientX, y: touch.clientY, axis: null, samples: [{ x: touch.clientX, time: event.timeStamp }] };
  }, { passive: true });

  element.addEventListener('touchmove', (event) => {
    if (!track) return;
    const touch = event.touches[0];
    const dx = touch.clientX - track.x;
    if (!track.axis) {
      track.axis = gestureAxis(dx, touch.clientY - track.y);
      if (!track.axis) return;
      if (track.axis === 'y') {
        track = null; // dikey: sayfa olağan kayar
        return;
      }
    }
    if (event.cancelable) event.preventDefault(); // yatay: parmak kalkana kadar sayfa dikey kaymaz
    track.samples.push({ x: touch.clientX, time: event.timeStamp });
    while (track.samples.length > 2 && event.timeStamp - track.samples[0].time > SPEED_WINDOW) track.samples.shift();
    handlers.move(dx);
  }, { passive: false });

  element.addEventListener('touchend', (event) => {
    if (track?.axis !== 'x') {
      track = null;
      return;
    }
    const touch = event.changedTouches[0];
    // Hız, son anlardaki hareketten; parmak durup öyle kalktıysa hız yoktur.
    const first = track.samples.find((sample) => event.timeStamp - sample.time <= SPEED_WINDOW);
    const velocity = first ? (touch.clientX - first.x) / Math.max(1, event.timeStamp - first.time) : 0;
    const dx = touch.clientX - track.x;
    track = null;
    handlers.end(swipeResult(dx, velocity, window.innerWidth));
  }, { passive: true });

  element.addEventListener('touchcancel', cancel, { passive: true });
}
