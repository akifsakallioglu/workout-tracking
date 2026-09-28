// Aşama 1 ekranı: tek gün ve tek hareket için makine seçimi, geçen seferki performans ve
// bugünkü setlerin kaydı.
import {
  UNIT_LABELS,
  buildSession,
  collectSets,
  formatDate,
  formatSets,
  formatTarget,
  formatWeight,
  lastPerformance,
  parseReps,
  parseWeight,
  validationMessage,
} from '../logic.js';
import { program } from '../seed.js';
import { createId, getSaveStatus, loadSessions, onSaveStatus, saveSession } from '../store.js';

const day = program.days[0];
const item = day.items[0];
const exerciseId = item.options[0];
const exercise = program.exercises[exerciseId];

export async function renderExerciseLogger(root) {
  const state = {
    sessions: await loadSessions(),
    equipmentId: exercise.equipment[0].id,
    rows: emptyRows(),
    problems: [],
    message: '',
    pendingId: null, // kaydı başarısız olan antrenmanın kimliği; tekrar denemede aynısı kullanılır
    saving: false,
    status: getSaveStatus(),
    savedDismissed: false,
  };

  const currentEquipment = () => exercise.equipment.find((equipment) => equipment.id === state.equipmentId);

  function render() {
    const equipment = currentEquipment();
    const { unit } = equipment;
    const last = lastPerformance(state.sessions, { dayId: day.id, exerciseId, equipmentId: equipment.id });

    root.innerHTML = `
      <section class="card">
        <header class="card-head">
          <div>
            <p class="eyebrow">${escapeHtml(day.name)}</p>
            <h1>${escapeHtml(exercise.name)}</h1>
          </div>
          <p class="target">Hedef ${formatTarget(item)}</p>
        </header>

        <fieldset class="machines">
          <legend>Makine</legend>
          ${exercise.equipment.map((option) => `
            <label class="machine">
              <input type="radio" name="equipment" value="${escapeHtml(option.id)}"${option.id === equipment.id ? ' checked' : ''}>
              ${escapeHtml(option.name)} · ${UNIT_LABELS[option.unit]}
            </label>`).join('')}
        </fieldset>

        <p id="last-time" class="last${last ? '' : ' empty'}">${last
          ? `Geçen sefer — ${formatDate(last.date)}: ${escapeHtml(formatSets(last.sets, last.unit))}`
          : 'Bu makinede önceki kayıt yok'}</p>

        <table class="sets">
          <thead>
            <tr>
              <th scope="col">Set</th>
              ${unit === 'none' ? '' : `<th scope="col">${unit === 'level' ? 'Kademe' : 'Ağırlık (kg)'}</th>`}
              <th scope="col">Tekrar</th>
            </tr>
          </thead>
          <tbody>
            ${state.rows.map((row, index) => rowHtml(row, index, unit, last?.sets[index])).join('')}
          </tbody>
        </table>

        <p id="form-message" class="message" role="alert">${escapeHtml(state.message)}</p>
        <div class="actions">
          <button type="button" class="button primary" data-action="save"${state.saving ? ' disabled' : ''}>Kaydet</button>
          <div id="save-status" class="save-status" role="status"></div>
        </div>
      </section>`;
    renderStatus();
  }

  function rowHtml(row, index, unit, hint) {
    const number = index + 1;
    const weightCell = unit === 'none' ? '' : `
      <td><input type="text" inputmode="decimal" autocomplete="off"
        aria-label="${number}. set ağırlık (${UNIT_LABELS[unit]})" data-row="${index}" data-field="weight"
        value="${escapeHtml(row.weight)}" placeholder="${hint ? escapeHtml(formatWeight(hint.weight)) : ''}"${invalidAttr(index, 'weight')}></td>`;
    return `
      <tr>
        <td>${number}</td>${weightCell}
        <td><input type="text" inputmode="numeric" autocomplete="off"
          aria-label="${number}. set tekrar" data-row="${index}" data-field="reps"
          value="${escapeHtml(row.reps)}" placeholder="${hint ? hint.reps : ''}"${invalidAttr(index, 'reps')}></td>
      </tr>`;
  }

  // Yarım satırda eksik kutu, geçersiz satırda hatalı kutu işaretlenir.
  function invalidAttr(index, field) {
    const problem = state.problems.find((candidate) => candidate.row === index);
    if (!problem) return '';
    const value = state.rows[index][field];
    const parsed = field === 'weight' ? parseWeight(value) : parseReps(value);
    const invalid = problem.kind === 'half' ? parsed === null : Number.isNaN(parsed);
    return invalid ? ' aria-invalid="true"' : '';
  }

  function renderStatus() {
    const element = root.querySelector('#save-status');
    if (!element) return;
    const { state: saveState, error } = state.status;
    element.dataset.state = saveState;
    if (saveState === 'saving') {
      element.textContent = 'Kaydediliyor…';
    } else if (saveState === 'saved' && !state.savedDismissed) {
      element.textContent = 'Kaydedildi ✓';
    } else if (saveState === 'error') {
      element.innerHTML = `
        <span>Kaydedilemedi. ${escapeHtml(errorReason(error))} Uygulamayı kapatmayın; değerler ekranda duruyor.</span>
        <button type="button" class="button secondary" data-action="retry">Tekrar dene</button>`;
    } else {
      element.textContent = '';
    }
  }

  async function save() {
    if (state.saving) return;
    const equipment = currentEquipment();
    const { sets, problems } = collectSets(state.rows, equipment.unit);
    state.problems = problems;
    state.message = validationMessage(sets, problems);
    if (state.message) {
      render();
      return;
    }

    const session = buildSession({
      id: state.pendingId ?? createId(),
      now: new Date().toISOString(),
      day,
      item,
      exerciseId,
      exercise,
      equipment,
      sets,
    });
    state.pendingId = session.id;
    state.saving = true;
    render();
    try {
      await saveSession(session);
      state.sessions = [...state.sessions.filter((existing) => existing.id !== session.id), session];
      state.rows = emptyRows();
      state.pendingId = null;
    } catch (error) {
      // Değerler kutularda kalır; kayıt durumu hatayı ve "Tekrar dene" düğmesini gösterir.
      console.warn('Kaydedilemedi', error);
    } finally {
      state.saving = false;
      render();
    }
  }

  onSaveStatus((status) => {
    state.status = status;
    state.savedDismissed = false;
    renderStatus();
  });

  root.addEventListener('input', (event) => {
    const { row, field } = event.target.dataset;
    if (field === undefined) return;
    state.rows[Number(row)][field] = event.target.value;
    event.target.removeAttribute('aria-invalid');
    // "Kaydedildi ✓" son kaydı anlatır; yeni değer yazılınca yanıltmasın diye gizlenir.
    if (state.status.state === 'saved' && !state.savedDismissed) {
      state.savedDismissed = true;
      renderStatus();
    }
  });

  root.addEventListener('change', (event) => {
    if (event.target.name !== 'equipment') return;
    state.equipmentId = event.target.value;
    state.problems = [];
    state.message = '';
    render();
  });

  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'save' || action === 'retry') save();
  });

  render();
}

function emptyRows() {
  return Array.from({ length: item.sets }, () => ({ weight: '', reps: '' }));
}

function errorReason(error) {
  return error?.name === 'QuotaExceededError' ? 'Depolama alanı dolu.' : 'Tarayıcı veriyi yazamadı.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
