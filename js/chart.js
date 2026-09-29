// Kütüphanesiz SVG çizgi grafik: tek seri, her nokta bir antrenman (eşit aralıklı). Dokununca,
// sürükleyince ya da fareyle üzerine gelince en yakın nokta seçilir ve dikey takip çizgisi oraya
// kayar; klavyede ← → Home End. Seçilen noktanın ayrıntısını ekran gösterir (onSelect).
const SVG = 'http://www.w3.org/2000/svg';
const TOP = 12;
const BOTTOM = 28; // tarih etiketleri
const RIGHT = 10;
const INSET = 8; // uçtaki noktalar ve halkaları kırpılmasın

// values: sayılar (eskiden yeniye); firstLabel/lastLabel: x ekseninin iki ucundaki tarihler.
export function lineChart({ values, firstLabel, lastLabel, formatTick, integer, label, selected, onSelect, width, height = 200 }) {
  const ticks = niceTicks(Math.min(...values), Math.max(...values), integer);
  const tickTexts = ticks.map(formatTick);
  const left = Math.max(28, Math.max(...tickTexts.map((text) => text.length)) * 7 + 12);
  const plotLeft = left + INSET;
  const plotRight = width - RIGHT - INSET;
  const plotBottom = height - BOTTOM;
  const step = values.length > 1 ? (plotRight - plotLeft) / (values.length - 1) : 0;
  const xOf = (index) => (values.length > 1 ? plotLeft + index * step : (plotLeft + plotRight) / 2);
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const yOf = (value) => plotBottom - ((value - low) / (high - low)) * (plotBottom - TOP);

  const svg = element('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': label,
  });

  ticks.forEach((tick, index) => {
    const y = round(yOf(tick));
    svg.append(element('line', { class: 'grid', x1: left, x2: width - RIGHT, y1: y, y2: y }));
    svg.append(element('text', { class: 'tick', x: left - 8, y, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, tickTexts[index]));
  });
  svg.append(element('text', { class: 'tick', x: left, y: height - 8, 'text-anchor': 'start' }, firstLabel));
  if (values.length > 1) svg.append(element('text', { class: 'tick', x: width - RIGHT, y: height - 8, 'text-anchor': 'end' }, lastLabel));

  const crosshair = element('line', { class: 'crosshair', y1: TOP, y2: plotBottom });
  svg.append(crosshair);
  const points = values.map((value, index) => `${round(xOf(index))},${round(yOf(value))}`);
  svg.append(element('polyline', { class: 'line', points: points.join(' ') }));
  values.forEach((value, index) => {
    svg.append(element('circle', { class: 'dot', cx: round(xOf(index)), cy: round(yOf(value)), r: 4 }));
  });
  // Seçili noktanın büyük işareti en üstte: halkası komşu noktaların üstünde kalır.
  const marker = element('circle', { class: 'marker', r: 6 });
  svg.append(marker);

  let current = -1;
  function select(index, notify = true) {
    const next = Math.min(values.length - 1, Math.max(0, index));
    if (next === current) return;
    current = next;
    const x = round(xOf(current));
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    marker.setAttribute('cx', x);
    marker.setAttribute('cy', round(yOf(values[current])));
    if (notify) onSelect?.(current);
  }

  // Parmak ya da fare hangi noktaya en yakınsa o seçilir; tam noktanın üstüne basmak gerekmez.
  function pick(event) {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) * width) / box.width;
    select(step ? Math.round((x - plotLeft) / step) : 0);
  }
  svg.addEventListener('pointerdown', (event) => {
    svg.setPointerCapture?.(event.pointerId);
    pick(event);
  });
  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse' || event.buttons) pick(event);
  });
  svg.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: values.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key]);
  });

  // İlk seçim ekrana bildirilmez: ekran seçili noktayı zaten biliyor.
  select(selected ?? values.length - 1, false);
  return svg;
}

// Eksen için yuvarlak değerler: 1, 2, 2,5 ya da 5'in katları (tamsayı ölçülerde 2,5 yok); 3–5 çizgi.
export function niceTicks(min, max, integer = false) {
  if (min === max) {
    const pad = integer ? Math.max(1, Math.ceil(Math.abs(min) * 0.1)) : Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factors = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let size = factors.map((factor) => factor * magnitude).find((candidate) => candidate >= raw);
  if (integer) size = Math.max(1, Math.round(size));
  const start = Math.max(0, Math.floor(min / size) * size);
  const end = Math.ceil(max / size) * size;
  const ticks = [];
  for (let value = start; value <= end + size / 2; value += size) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

function element(name, attributes, text) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
