// İlerleme: kaydı olan hareketlerin günlere göre listesi ve her gün + hareket + makine için grafik.
// Grafiğin üstünde sayaç, altında aynı değerlerin tablosu durur.
import { lineChart } from '../chart.js';
import {
  METRICS,
  counterText,
  exerciseSeries,
  finishedSessions,
  formatDate,
  formatDay,
  formatMetric,
  formatSets,
  formatWeight,
  machinesWithRecords,
  progressCounter,
  progressIndex,
} from '../logic.js';
import { loadProgram, loadSessions } from '../store.js';
import { escapeHtml } from '../ui.js';
import { machineLabel, radioChip } from './exercise-card.js';

export async function renderProgressList(container) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const { days, other } = progressIndex(program, sessions);
  const groups = days.filter((day) => day.exercises.length);
  const link = (record, prefix = '') => `
    <li>
      <a class="day" href="#/ilerleme/${escapeHtml(record.dayId)}/${escapeHtml(record.exerciseId)}">
        <span class="day-name">${escapeHtml(record.name)}</span>
        <span class="muted">${prefix}${record.count} antrenman · son: ${formatDate(record.lastDate)}</span>
      </a>
    </li>`;

  container.innerHTML = `
    <header class="page-head">
      <a class="back" href="#/">← Günler</a>
      <h1>İlerleme</h1>
    </header>
    ${groups.length || other.length ? `
      ${groups.map((day) => `
        <h2 class="section-title">${escapeHtml(day.name)}</h2>
        <ul class="days">${day.exercises.map((record) => link(record)).join('')}</ul>`).join('')}
      ${other.length ? `
        <h2 class="section-title">Programda olmayan</h2>
        <ul class="days">${other.map((record) => link(record, `${escapeHtml(record.dayName)} · `)).join('')}</ul>` : ''}`
    : '<p class="muted empty-state">Henüz bitmiş antrenman yok. Grafikler antrenman bitirdikçe burada görünür.</p>'}`;
  return {};
}

export async function renderProgressDetail(container, { dayId, exerciseId, navigate }) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const machines = machinesWithRecords(sessions, program, dayId, exerciseId);
  if (!machines.length) {
    navigate('#/ilerleme');
    return {};
  }
  const latest = finishedSessions(sessions).find(
    (session) => session.dayId === dayId && session.entries.some((entry) => entry.exerciseId === exerciseId && entry.sets.length),
  );
  const name = program.exercises[exerciseId]?.name ?? latest.entries.find((entry) => entry.exerciseId === exerciseId).name;
  const dayName = program.days.find((day) => day.id === dayId)?.name ?? latest.dayName;

  let equipmentId = machines[0].equipmentId; // en son kullanılan makine
  let metricId = METRICS[machines[0].unit][0].id;
  let selected = null; // seçili nokta; ilk çizimde en son antrenman
  let series = [];
  let chartWidth = 0;

  const machine = () => machines.find((option) => option.equipmentId === equipmentId);
  const metric = () => METRICS[machine().unit].find((option) => option.id === metricId);
  const integer = () => metricId === 'reps' || metricId === 'maxReps' || machine().unit === 'level';

  function render() {
    const current = machine();
    series = exerciseSeries(sessions, { dayId, exerciseId, equipmentId }, metricId);
    if (selected === null || selected >= series.length) selected = series.length - 1;
    const counter = counterText(progressCounter(sessions, { dayId, exerciseId, equipmentId }));
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/ilerleme">← İlerleme</a>
        <h1>${escapeHtml(name)}</h1>
        <p class="muted">${escapeHtml(dayName)}</p>
      </header>
      <section class="card progress-card">
        <fieldset>
          <legend>Makine</legend>
          <div class="chips">
            ${machines.map((option) => radioChip('machine', option.equipmentId, machineLabel(option), option.equipmentId === equipmentId)).join('')}
          </div>
        </fieldset>
        <p id="progress-counter" class="progress-counter">${escapeHtml(counter || 'Tek kayıt var: ilerleme ikinci antrenmandan sonra hesaplanır.')}</p>
        <fieldset class="metrics">
          <legend>Ölçü</legend>
          <div class="chips">
            ${METRICS[current.unit].map((option) => radioChip('metric', option.id, option.label, option.id === metricId)).join('')}
          </div>
        </fieldset>
        <div id="readout" class="readout" aria-live="polite">${readoutHtml()}</div>
        <div class="chart-host"></div>
      </section>
      <section class="card records-card">
        <h2>Kayıtlar</h2>
        <table class="records">
          <thead><tr><th scope="col">Tarih</th><th scope="col">${escapeHtml(metric().label)}</th><th scope="col">Setler</th></tr></thead>
          <tbody>
            ${series.map((point) => `
              <tr>
                <td>${formatDay(point.date)}</td>
                <td class="number">${formatMetric(point.value, metricId, point.unit)}</td>
                <td>${escapeHtml(formatSets(point.sets, point.unit))}</td>
              </tr>`).reverse().join('')}
          </tbody>
        </table>
      </section>`;
    drawChart();
  }

  function readoutHtml() {
    const point = series[selected];
    return `
      <p class="readout-head">
        <strong class="readout-value">${formatMetric(point.value, metricId, point.unit)}</strong>
        <span class="muted">${formatDay(point.date)}</span>
      </p>
      <p class="readout-sets">${escapeHtml(formatSets(point.sets, point.unit))}</p>`;
  }

  function drawChart() {
    const host = container.querySelector('.chart-host');
    if (!host) return;
    chartWidth = host.clientWidth;
    if (series.length < 2) {
      host.innerHTML = '<p class="muted chart-note">Grafik ikinci antrenmandan sonra çizilir.</p>';
      return;
    }
    host.replaceChildren(
      lineChart({
        values: series.map((point) => point.value),
        firstLabel: formatDate(series[0].date),
        lastLabel: formatDate(series[series.length - 1].date),
        formatTick: formatWeight,
        integer: integer(),
        label: `${metric().label} grafiği, ${series.length} antrenman. Değerler aşağıdaki tabloda.`,
        selected,
        width: chartWidth,
        onSelect(index) {
          selected = index;
          container.querySelector('#readout').innerHTML = readoutHtml();
        },
      }),
    );
  }

  container.addEventListener('change', (event) => {
    const input = event.target;
    if (input.name === 'machine') {
      equipmentId = input.value;
      metricId = METRICS[machine().unit][0].id;
      selected = null;
    } else if (input.name === 'metric') {
      metricId = input.value;
    } else {
      return;
    }
    render();
  });

  // Telefon yan çevrilince grafik yeni genişliğe göre yeniden çizilir.
  const onResize = () => {
    const host = container.querySelector('.chart-host');
    if (host && host.clientWidth !== chartWidth) drawChart();
  };
  window.addEventListener('resize', onResize);

  render();
  return { destroy: () => window.removeEventListener('resize', onResize) };
}
