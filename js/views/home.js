// Ana ekran: devam eden antrenman, sıradaki gün ve tüm günler.
import { activeSession, backupReminder, formatDate, formatDateTime, lastDoneDate, nextDayId } from '../logic.js';
import { loadProgram, loadSessions, loadSettings } from '../store.js';
import { escapeHtml } from '../ui.js';

export async function renderHome(container, { flash }) {
  const [program, sessions, settings] = await Promise.all([loadProgram(), loadSessions(), loadSettings()]);
  const active = activeSession(sessions);
  const reminder = backupReminder(settings.lastBackupAt, sessions);
  const next = program.days.find((day) => day.id === nextDayId(program, sessions));
  const summary = (day) => {
    if (active?.dayId === day.id) return `${day.items.length} hareket · devam ediyor`;
    const date = lastDoneDate(sessions, day.id);
    return `${day.items.length} hareket · ${date ? `son: ${formatDate(date)}` : 'henüz yapılmadı'}`;
  };

  container.innerHTML = `
    <header class="page-head home-head">
      <h1>Antrenman Takibi</h1>
      <nav class="head-links" aria-label="Diğer ekranlar">
        <a class="head-link" href="#/gecmis">Geçmiş</a>
        <a class="head-link" href="#/ayarlar">Ayarlar</a>
      </nav>
    </header>
    ${flash ? `<p id="flash" class="flash" role="status">${escapeHtml(flash)}</p>` : ''}
    ${reminder ? `
      <p id="backup-reminder" class="reminder">
        ${reminder.never ? 'Henüz yedek almadınız.' : `Son yedek ${reminder.days} gün önce alındı.`}
        Verileriniz yalnızca bu cihazda duruyor. <a href="#/ayarlar">Yedek al</a>
      </p>` : ''}

    ${active ? `
      <section class="card resume" aria-labelledby="resume-title">
        <p class="eyebrow">Devam eden antrenman</p>
        <h2 id="resume-title">${escapeHtml(active.dayName)}</h2>
        <p class="muted">Başlangıç: ${formatDateTime(active.startedAt)}</p>
        <a class="button primary" href="#/antrenman/${escapeHtml(active.dayId)}">Devam et</a>
      </section>` : ''}

    ${active?.dayId === next.id ? '' : `
      <section class="card next" aria-labelledby="next-title">
        <p class="eyebrow">Sıradaki</p>
        <h2 id="next-title">${escapeHtml(next.name)}</h2>
        <p class="muted">${summary(next)}</p>
        <a class="button ${active ? 'secondary' : 'primary'}" href="#/antrenman/${escapeHtml(next.id)}">Başla</a>
      </section>`}

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
