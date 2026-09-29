// Ana ekran: sıradaki gün ve tüm günler.
import { formatDate, lastDoneDate, nextDayId } from '../logic.js';
import { loadProgram, loadSessions } from '../store.js';
import { escapeHtml } from '../ui.js';

export async function renderHome(container, { flash }) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const next = program.days.find((day) => day.id === nextDayId(program, sessions));
  const summary = (day) => {
    const date = lastDoneDate(sessions, day.id);
    return `${day.items.length} hareket · ${date ? `son: ${formatDate(date)}` : 'henüz yapılmadı'}`;
  };

  container.innerHTML = `
    <header class="page-head">
      <h1>Antrenman Takibi</h1>
    </header>
    ${flash ? `<p id="flash" class="flash" role="status">${escapeHtml(flash)}</p>` : ''}

    <section class="card next" aria-labelledby="next-title">
      <p class="eyebrow">Sıradaki</p>
      <h2 id="next-title">${escapeHtml(next.name)}</h2>
      <p class="muted">${summary(next)}</p>
      <a class="button primary" href="#/antrenman/${escapeHtml(next.id)}">Başla</a>
    </section>

    <h2 class="section-title">Günler</h2>
    <ul class="days">
      ${program.days.map((day) => `
        <li>
          <a class="day" href="#/antrenman/${escapeHtml(day.id)}">
            <span class="day-name">${escapeHtml(day.name)}</span>
            <span class="muted">${summary(day)}</span>
          </a>
        </li>`).join('')}
    </ul>`;
  return {};
}
