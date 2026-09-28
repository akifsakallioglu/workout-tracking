// Aşama 1 ekranı: tek gün ve tek hareket için makine seçimi ve ekleme, geçen seferki performans
// ve bugünkü setlerin kaydı.
import {
  UNIT_LABELS,
  buildSession,
  collectSets,
  equipmentError,
  formatDate,
  formatSets,
  formatTarget,
  formatWeight,
  lastPerformance,
  validationMessage,
  withEquipment,
} from '../logic.js';
import {
  createId,
  getSaveStatus,
  loadProgram,
  loadSessions,
  onSaveStatus,
  saveProgram,
  saveSession,
} from '../store.js';

// Kayıt durumunun metni, son yazmanın neyi kaydettiğine göre değişir.
const STATUS_TEXT = {
  sets: {
    saving: 'Kaydediliyor…',
    saved: 'Kaydedildi ✓',
    error: 'Kaydedilemedi.',
    keep: 'değerler ekranda duruyor.',
  },
  machine: {
    saving: 'Makine ekleniyor…',
    saved: 'Makine eklendi ✓',
    error: 'Makine eklenemedi.',
    keep: 'girdiğiniz ad ve birim formda duruyor.',
  },
};

export async function renderExerciseLogger(root) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const day = program.days[0];
  const item = day.items[0];
  const exerciseId = item.options[0];
  const emptyReps = () => Array.from({ length: item.sets }, () => '');

  const state = {
    program,
    sessions,
    equipmentId: program.exercises[exerciseId].equipment[0].id,
    weight: '',
    reps: emptyReps(),
    problems: [],
    message: '',
    machineForm: null, // { name, unit, error }: açıkken yeni makine formu görünür
    pendingId: null, // kaydı başarısız olan antrenmanın kimliği; tekrar denemede aynısı kullanılır
    busy: false,
    retry: null, // "Tekrar dene"nin yeniden çalıştıracağı işlem
    writeContext: 'sets',
    status: getSaveStatus(),
    savedDismissed: false,
  };

  const exercise = () => state.program.exercises[exerciseId];
  const currentEquipment = () => exercise().equipment.find((equipment) => equipment.id === state.equipmentId);

  function render() {
    const equipment = currentEquipment();
    const { unit } = equipment;
    const last = lastPerformance(state.sessions, { dayId: day.id, exerciseId, equipmentId: equipment.id });
    const weightInvalid = state.problems.some((problem) => problem.field === 'weight');
    const repsInvalid = (index) => state.problems.some((problem) => problem.field === 'reps' && problem.row === index);

    root.innerHTML = `
      <section class="card">
        <header class="card-head">
          <div>
            <p class="eyebrow">${escapeHtml(day.name)}</p>
            <h1>${escapeHtml(exercise().name)}</h1>
          </div>
          <p class="target">Hedef ${formatTarget(item)}</p>
        </header>

        <fieldset class="machines">
          <legend>Makine</legend>
          <div class="chips">
            ${exercise().equipment.map((option) => `
              <label class="chip">
                <input type="radio" name="equipment" value="${escapeHtml(option.id)}"${option.id === equipment.id ? ' checked' : ''}>
                ${escapeHtml(option.name)} · ${UNIT_LABELS[option.unit]}
              </label>`).join('')}
            ${state.machineForm ? '' : '<button type="button" class="chip add" data-action="open-machine-form">+ Makine</button>'}
          </div>
        </fieldset>
        ${state.machineForm ? machineFormHtml() : ''}

        <p id="last-time" class="last${last ? '' : ' empty'}">${last
          ? `Geçen sefer — ${formatDate(last.date)}: ${escapeHtml(formatSets(last.sets, last.unit))}`
          : 'Bu makinede önceki kayıt yok'}</p>

        <form class="log" data-form="sets" novalidate>
          ${unit === 'none' ? '' : `
            <div class="field weight">
              <label for="weight-input">${unit === 'level' ? 'Kademe' : 'Ağırlık (kg)'}</label>
              <input id="weight-input" type="text" inputmode="decimal" autocomplete="off" data-field="weight"
                value="${escapeHtml(state.weight)}" placeholder="${last ? escapeHtml(formatWeight(last.sets[0].weight)) : ''}"${weightInvalid ? ' aria-invalid="true"' : ''}>
            </div>`}
          <fieldset class="reps">
            <legend>Tekrarlar</legend>
            <div class="rep-grid">
              ${state.reps.map((value, index) => `
                <label class="rep">
                  <span>${index + 1}. set</span>
                  <input type="text" inputmode="numeric" autocomplete="off" aria-label="${index + 1}. set tekrar"
                    data-field="reps" data-row="${index}" value="${escapeHtml(value)}"
                    placeholder="${last?.sets[index] ? last.sets[index].reps : ''}"${repsInvalid(index) ? ' aria-invalid="true"' : ''}>
                </label>`).join('')}
            </div>
          </fieldset>
          <p id="form-message" class="message" role="alert">${escapeHtml(state.message)}</p>
          <div class="actions">
            <button type="submit" class="button primary"${state.busy ? ' disabled' : ''}>Kaydet</button>
            <div id="save-status" class="save-status" role="status"></div>
          </div>
        </form>
      </section>`;
    renderStatus();
  }

  function machineFormHtml() {
    const { name, unit, error } = state.machineForm;
    return `
      <form class="machine-form" data-form="machine" novalidate>
        <p class="form-title">Yeni makine</p>
        <div class="field">
          <label for="machine-name">Ad</label>
          <input id="machine-name" name="name" type="text" maxlength="40" autocomplete="off"
            placeholder="ör. Kablo 2" value="${escapeHtml(name)}">
        </div>
        <fieldset class="units">
          <legend>Birim</legend>
          <div class="chips">
            ${Object.entries(UNIT_LABELS).map(([value, label]) => `
              <label class="chip">
                <input type="radio" name="unit" value="${value}"${unit === value ? ' checked' : ''}>
                ${label}
              </label>`).join('')}
          </div>
        </fieldset>
        <p id="machine-message" class="message" role="alert">${escapeHtml(error)}</p>
        <div class="actions">
          <button type="submit" class="button primary"${state.busy ? ' disabled' : ''}>Ekle</button>
          <button type="button" class="button secondary" data-action="close-machine-form">Vazgeç</button>
        </div>
      </form>`;
  }

  function renderStatus() {
    const element = root.querySelector('#save-status');
    if (!element) return;
    const { state: saveState, error } = state.status;
    const text = STATUS_TEXT[state.writeContext];
    element.dataset.state = saveState;
    if (saveState === 'saving') {
      element.textContent = text.saving;
    } else if (saveState === 'saved' && !state.savedDismissed) {
      element.textContent = text.saved;
    } else if (saveState === 'error') {
      element.innerHTML = `
        <span>${text.error} ${escapeHtml(errorReason(error))} Uygulamayı kapatmayın; ${text.keep}</span>
        <button type="button" class="button secondary" data-action="retry">Tekrar dene</button>`;
    } else {
      element.textContent = '';
    }
  }

  async function save() {
    if (state.busy) return;
    const equipment = currentEquipment();
    const { sets, problems } = collectSets({ weight: state.weight, reps: state.reps }, equipment.unit);
    state.problems = problems;
    state.message = validationMessage(sets, problems, equipment.unit);
    if (state.message) {
      render();
      root.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    const session = buildSession({
      id: state.pendingId ?? createId(),
      now: new Date().toISOString(),
      day,
      item,
      exerciseId,
      exercise: exercise(),
      equipment,
      sets,
    });
    state.pendingId = session.id;
    state.writeContext = 'sets';
    state.busy = true;
    render();
    try {
      await saveSession(session);
      state.sessions = [...state.sessions.filter((existing) => existing.id !== session.id), session];
      state.weight = '';
      state.reps = emptyReps();
      state.pendingId = null;
      state.retry = null;
    } catch (error) {
      // Değerler kutularda kalır; kayıt durumu hatayı ve "Tekrar dene" düğmesini gösterir.
      console.warn('Kaydedilemedi', error);
      state.retry = save;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function addMachine() {
    if (state.busy || !state.machineForm) return;
    const form = state.machineForm;
    form.error = equipmentError(exercise(), form.name, form.unit);
    if (form.error) {
      render();
      return;
    }

    const equipment = { id: `eq-${createId()}`, name: form.name.trim(), unit: form.unit };
    const next = withEquipment(state.program, exerciseId, equipment);
    state.writeContext = 'machine';
    state.busy = true;
    render();
    try {
      await saveProgram(next);
      state.program = next;
      state.equipmentId = equipment.id;
      state.machineForm = null;
      state.problems = [];
      state.message = '';
      state.retry = null;
    } catch (error) {
      // Form açık kalır; kayıt durumu hatayı ve "Tekrar dene" düğmesini gösterir.
      console.warn('Makine eklenemedi', error);
      state.retry = addMachine;
    } finally {
      state.busy = false;
      render();
    }
  }

  onSaveStatus((status) => {
    state.status = status;
    state.savedDismissed = false;
    renderStatus();
  });

  root.addEventListener('input', (event) => {
    const { target } = event;
    if (target.name === 'name' && state.machineForm) {
      state.machineForm.name = target.value;
      return;
    }
    const { field } = target.dataset;
    const row = Number(target.dataset.row);
    if (field === 'weight') state.weight = target.value;
    else if (field === 'reps') state.reps[row] = target.value;
    else return;
    // Kullanıcı düzeltmeye başlayınca uyarı kalkar ve bu kutunun işareti silinir; kalan sorunlar
    // bir sonraki Kaydet'te yeniden denetlenir.
    state.problems = state.problems.filter((problem) => problem.field !== field || (field === 'reps' && problem.row !== row));
    target.removeAttribute('aria-invalid');
    if (state.message) {
      state.message = '';
      root.querySelector('#form-message').textContent = '';
    }
    // "Kaydedildi ✓" son kaydı anlatır; yeni değer yazılınca yanıltmasın diye gizlenir.
    if (state.status.state === 'saved' && !state.savedDismissed) {
      state.savedDismissed = true;
      renderStatus();
    }
  });

  root.addEventListener('change', (event) => {
    const { target } = event;
    if (target.name === 'unit' && state.machineForm) {
      state.machineForm.unit = target.value;
    } else if (target.name === 'equipment') {
      state.equipmentId = target.value;
      state.problems = [];
      state.message = '';
      render();
    }
  });

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.dataset.form === 'sets') save();
    else if (event.target.dataset.form === 'machine') addMachine();
  });

  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'open-machine-form') {
      state.machineForm = { name: '', unit: '', error: '' };
      render();
      root.querySelector('#machine-name').focus();
    } else if (action === 'close-machine-form') {
      state.machineForm = null;
      render();
    } else if (action === 'retry') {
      state.retry?.();
    }
  });

  render();
}

function errorReason(error) {
  return error?.name === 'QuotaExceededError' ? 'Depolama alanı dolu.' : 'Tarayıcı veriyi yazamadı.';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
