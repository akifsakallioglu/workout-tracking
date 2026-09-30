// Geçmiş: bitmiş antrenmanların listesi ve ayrıntısı (düzenleme ve onaylı silme buradan).
import {
  dateBadge,
  finishedSessions,
  formatDay,
  formatDuration,
  formatSets,
  formatTarget,
  formatTime,
  sessionSummary,
  sessionsByMonth,
} from '../logic.js';
import { deleteSession, loadSessions } from '../store.js';
import { appHeader, errorReason, escapeHtml, linkItem } from '../ui.js';

export async function renderHistory(container, { flash }) {
  const sessions = finishedSessions(await loadSessions());
  container.innerHTML = `
    ${appHeader('#/gecmis')}
    <header class="page-head">
      <h1>Geçmiş</h1>
    </header>
    ${flash ? `<p id="flash" class="flash" role="status">${escapeHtml(flash)}</p>` : ''}
    ${sessions.length ? sessionsByMonth(sessions).map(({ month, sessions: items }) => `
      <h2 class="month-title">${month}</h2>
      <ul class="days history">
        ${items.map((session) => linkItem(
          `#/gecmis/${escapeHtml(session.id)}`,
          escapeHtml(session.dayName),
          `${sessionSummary(session)} · ${formatDuration(session.startedAt, session.finishedAt)}`,
          badgeHtml(session.startedAt),
        )).join('')}
      </ul>`).join('') : '<p class="muted empty-state">Henüz bitmiş antrenman yok.</p>'}`;
  return {};
}

// Tarih rozeti: gün sayısı ve kısa gün adı; ay ve yıl üstteki ay başlığındadır.
function badgeHtml(iso) {
  const { day, weekday } = dateBadge(iso);
  return `<span class="date-badge"><span class="date-badge-day">${day}</span><span class="date-badge-weekday">${weekday}</span></span>`;
}

export async function renderSessionDetail(container, { sessionId, navigate, flash }) {
  const session = finishedSessions(await loadSessions()).find((candidate) => candidate.id === sessionId);
  if (!session) {
    navigate('#/gecmis', '', 'replace');
    return {};
  }
  let message = '';
  let busy = false;

  function render() {
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/gecmis" data-nav="up">← Geçmiş</a>
        <h1>${escapeHtml(session.dayName)} · ${formatDay(session.startedAt)}</h1>
        <p class="muted">Başlangıç ${formatTime(session.startedAt)} · ${formatDuration(session.startedAt, session.finishedAt)} · ${sessionSummary(session)}</p>
      </header>
      ${flash ? `<p id="flash" class="flash" role="status">${escapeHtml(flash)}</p>` : ''}
      <ul class="entries">
        ${session.entries.map((entry) => `
          <li class="card entry">
            <h2>${escapeHtml(entry.name)} · ${escapeHtml(entry.equipmentName)}</h2>
            <p class="entry-sets">${escapeHtml(formatSets(entry.sets, entry.unit))}</p>
            <p class="muted">Hedef ${formatTarget(entry.target)}</p>
          </li>`).join('')}
      </ul>
      <div class="actions detail-actions">
        <a class="button primary" href="#/gecmis/${escapeHtml(session.id)}/duzenle">Düzenle</a>
      </div>
      <div class="page-actions">
        <button type="button" class="button danger block" data-action="delete"${busy ? ' disabled' : ''}>Sil</button>
      </div>
      <p id="detail-message" class="message" role="alert">${escapeHtml(message)}</p>`;
  }

  container.addEventListener('click', async (event) => {
    if (event.target.closest('[data-action]')?.dataset.action !== 'delete' || busy) return;
    if (!confirm(`${session.dayName} · ${formatDay(session.startedAt)} antrenmanı silinsin mi? Bu işlem geri alınamaz.`)) return;
    busy = true;
    render();
    try {
      await deleteSession(session.id);
      navigate('#/gecmis', 'Antrenman silindi.', 'up');
    } catch (error) {
      console.warn('Antrenman silinemedi', error);
      message = `Antrenman silinemedi. ${errorReason(error)}`;
      busy = false;
      render();
    }
  });

  render();
  return {};
}
