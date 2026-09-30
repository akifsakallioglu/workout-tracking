// Parmakla yatay kaydırma: ana ekranlarda sekmeler arasında geçiş için. Dokunma olaylarını yalnızca
// dinler (passive); dikey kaydırmaya ve dokunuşlara karışmaz.

export const SWIPE_MIN = 70; // sayılması için en az yatay yol (px)
export const SWIPE_EDGE = 24; // ekranın kenarından başlayan kaydırma telefonundur (geri/ileri)
export const SWIPE_TIME = 800; // daha yavaş hareket kaydırma sayılmaz (ms)

// Başlangıç ve bitiş noktasından ({ x, y, time }) yön: 'left' (parmak sola: sıradaki sekme),
// 'right' (önceki sekme) ya da kaydırma değilse null. width, ekranın genişliğidir.
export function swipeDirection(start, end, width) {
  if (start.x < SWIPE_EDGE || start.x > width - SWIPE_EDGE) return null;
  if (end.time - start.time > SWIPE_TIME) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

// element üzerinde tek parmakla yapılan kaydırmada onSwipe(yön, dokunmanın başladığı öğe) çağrılır.
export function listenForSwipes(element, onSwipe) {
  let start = null;
  element.addEventListener('touchstart', (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null; // ikinci parmak kaydırmayı bozar
    start = touch && { x: touch.clientX, y: touch.clientY, time: event.timeStamp, target: event.target };
  }, { passive: true });
  element.addEventListener('touchend', (event) => {
    if (!start) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(start, { x: touch.clientX, y: touch.clientY, time: event.timeStamp }, window.innerWidth);
    const { target } = start;
    start = null;
    if (direction) onSwipe(direction, target);
  }, { passive: true });
  element.addEventListener('touchcancel', () => {
    start = null;
  }, { passive: true });
}
