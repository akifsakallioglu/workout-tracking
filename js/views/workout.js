// Antrenman ekranı: günün bütün hareketleri kartlarla girilir ve "Bitir" ile tek seferde
// kaydedilir. Seti girilmeyen hareket atlanır ve kayda yazılmaz.
import {
  buildEntry,
  buildSession,
  collectSets,
  defaultEquipmentId,
  equipmentError,
  validationMessage,
  withEquipment,
} from '../logic.js';
import { createId, loadProgram, loadSessions, onSaveStatus, saveProgram, saveSession } from '../store.js';
import { errorReason, escapeHtml } from '../ui.js';
import { cardHtml, isInvalid } from './exercise-card.js';

// Kayıt durumunun metni, son yazmanın neyi kaydettiğine göre değişir.
const STATUS_TEXT = {
  finish: {
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

export async function renderWorkout(container, { dayId, navigate }) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const day = program.days.find((candidate) => candidate.id === dayId);
  if (!day) {
    navigate('#/');
    return {};
  }

  const newCard = (item) => {
    const exerciseId = item.options[0];
    return {
      item,
      exerciseId,
      equipmentId: defaultEquipmentId(sessions, day.id, exerciseId, program.exercises[exerciseId]),
      weight: '',
      reps: Array.from({ length: item.sets }, () => ''),
      problems: [],
      message: '',
      machineForm: null, // { name, unit, error }: açıkken yeni makine formu görünür
    };
  };

  const state = {
    program,
    sessions,
    sessionId: createId(),
    startedAt: new Date().toISOString(),
    cards: day.items.map(newCard),
    message: '',
    busy: false,
    saved: false,
    retry: null, // "Tekrar dene"nin yeniden çalıştıracağı işlem
    writeContext: 'finish',
    status: { state: 'idle', error: null },
    savedDismissed: false,
  };

  const exerciseOf = (card) => state.program.exercises[card.exerciseId];
  // Seçili makine; hareketin henüz makinesi yoksa undefined.
  const equipmentOf = (card) =>
    exerciseOf(card).equipment.find((equipment) => equipment.id === card.equipmentId && !equipment.archived);
  const cardContext = () => ({ day, program: state.program, sessions: state.sessions, busy: state.busy });

  function render() {
    container.innerHTML = `
      <header class="topbar">
        <div class="topbar-row">
          <a class="back" href="#/">← Günler</a>
          <h1>${escapeHtml(day.name)}</h1>
          <button type="button" class="button primary" data-action="finish"${state.busy ? ' disabled' : ''}>Bitir</button>
        </div>
        <div id="save-status" class="save-status" role="status"></div>
      </header>
      <p id="workout-message" class="message" role="alert">${escapeHtml(state.message)}</p>
      <datalist id="machine-names">${machineNameOptions()}</datalist>
      <div class="cards">
        ${state.cards.map((card, index) => cardHtml(card, index, cardContext())).join('')}
      </div>`;
    renderStatus();
  }

  function renderCard(index) {
    container.querySelector(`[data-card="${index}"]`).outerHTML = cardHtml(state.cards[index], index, cardContext());
  }

  // Makine adı önerileri: bütün hareketlerde kullanılan makine adları.
  function machineNameOptions() {
    const names = new Set(Object.values(state.program.exercises).flatMap((exercise) => exercise.equipment.map((equipment) => equipment.name)));
    return [...names]
      .sort((a, b) => a.localeCompare(b, 'tr'))
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join('');
  }

  function renderStatus() {
    const element = container.querySelector('#save-status');
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

  async function finish() {
    if (state.busy) return;
    const entries = [];
    let hasProblems = false;
    for (const card of state.cards) {
      const equipment = equipmentOf(card);
      if (!equipment) continue; // makinesi olmayan hareketin kutusu yok; atlanır
      const { sets, problems } = collectSets({ weight: card.weight, reps: card.reps }, equipment.unit);
      card.problems = problems;
      card.message = validationMessage(problems, equipment.unit);
      if (problems.length) hasProblems = true;
      else if (sets.length) entries.push(buildEntry({ item: card.item, exerciseId: card.exerciseId, exercise: exerciseOf(card), equipment, sets }));
    }
    if (hasProblems) state.message = 'Bazı hareketlerde düzeltilmesi gereken değerler var.';
    else if (!entries.length) state.message = 'En az bir hareket için set girin.';
    else state.message = '';
    if (state.message) {
      render();
      container.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    const session = buildSession({
      id: state.sessionId,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      day,
      entries,
    });
    state.writeContext = 'finish';
    state.busy = true;
    render();
    try {
      await saveSession(session);
      state.saved = true;
      navigate('#/', `${day.name} antrenmanı kaydedildi ✓`);
    } catch (error) {
      // Değerler kutularda kalır; kayıt durumu hatayı ve "Tekrar dene" düğmesini gösterir.
      console.warn('Kaydedilemedi', error);
      state.retry = finish;
      state.busy = false;
      render();
    }
  }

  async function addMachine(index) {
    const card = state.cards[index];
    if (state.busy || !card.machineForm) return;
    const form = card.machineForm;
    form.error = equipmentError(exerciseOf(card), form.name, form.unit);
    if (form.error) {
      renderCard(index);
      return;
    }

    const equipment = { id: `eq-${createId()}`, name: form.name.trim(), unit: form.unit };
    const next = withEquipment(state.program, card.exerciseId, equipment);
    state.writeContext = 'machine';
    state.busy = true;
    renderCard(index);
    try {
      await saveProgram(next);
      state.program = next;
      card.equipmentId = equipment.id;
      // Aynı hareketi kullanan ve henüz makinesi olmayan kartlarda da yeni makine seçili gelsin.
      for (const other of state.cards) {
        if (other.exerciseId === card.exerciseId && !equipmentOf(other)) other.equipmentId = equipment.id;
      }
      card.machineForm = null;
      card.problems = [];
      card.message = '';
      state.retry = null;
    } catch (error) {
      // Form açık kalır; kayıt durumu hatayı ve "Tekrar dene" düğmesini gösterir.
      console.warn('Makine eklenemedi', error);
      state.retry = () => addMachine(index);
    } finally {
      state.busy = false;
      // Aynı hareketi kullanan kartlar ve makine adı önerileri de güncellensin.
      render();
    }
  }

  // Düzeltilen kutuların işareti kalkar; kalan sorunların işaretleri durur.
  function syncInvalidMarks(cardElement, card) {
    for (const input of cardElement.querySelectorAll('input[data-field]')) {
      const invalid = isInvalid(card, input.dataset.field, Number(input.dataset.row));
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearProblems(card) {
    card.problems = [];
    card.message = '';
  }

  const unsubscribe = onSaveStatus((status) => {
    state.status = status;
    state.savedDismissed = false;
    renderStatus();
  });

  container.addEventListener('input', (event) => {
    const { target } = event;
    const cardElement = target.closest('[data-card]');
    if (!cardElement) return;
    const card = state.cards[Number(cardElement.dataset.card)];
    if (target.name === 'name' && card.machineForm) {
      card.machineForm.name = target.value;
      return;
    }
    const { field } = target.dataset;
    const row = Number(target.dataset.row);
    if (field === 'weight') card.weight = target.value;
    else if (field === 'reps') card.reps[row] = target.value;
    else return;
    // Kullanıcı düzeltmeye başlayınca uyarılar kalkar; kalan sorunlar "Bitir"de yeniden denetlenir.
    card.problems = card.problems.filter(
      (problem) => problem.field !== field || (field === 'reps' && problem.kind === 'invalid' && problem.row !== row),
    );
    syncInvalidMarks(cardElement, card);
    if (card.message) {
      card.message = '';
      cardElement.querySelector('.card-message').textContent = '';
    }
    if (state.message) {
      state.message = '';
      container.querySelector('#workout-message').textContent = '';
    }
    // "Kaydedildi ✓" son yazmayı anlatır; yeni değer yazılınca yanıltmasın diye gizlenir.
    if (state.status.state === 'saved' && !state.savedDismissed) {
      state.savedDismissed = true;
      renderStatus();
    }
  });

  container.addEventListener('change', (event) => {
    const { target } = event;
    const cardElement = target.closest('[data-card]');
    if (!cardElement) return;
    const index = Number(cardElement.dataset.card);
    const card = state.cards[index];
    if (target.name === `unit-${index}` && card.machineForm) {
      card.machineForm.unit = target.value;
    } else if (target.name === `equipment-${index}`) {
      card.equipmentId = target.value;
      clearProblems(card);
      renderCard(index);
    } else if (target.name === `option-${index}`) {
      card.exerciseId = target.value;
      card.equipmentId = defaultEquipmentId(state.sessions, day.id, card.exerciseId, exerciseOf(card));
      card.machineForm = null;
      clearProblems(card);
      renderCard(index);
    }
  });

  container.addEventListener('submit', (event) => {
    event.preventDefault();
    const cardElement = event.target.closest('[data-card]');
    if (cardElement && event.target.dataset.form === 'machine') addMachine(Number(cardElement.dataset.card));
  });

  container.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const cardElement = actionElement.closest('[data-card]');
    const index = cardElement ? Number(cardElement.dataset.card) : -1;
    const card = state.cards[index];
    switch (actionElement.dataset.action) {
      case 'finish':
        finish();
        break;
      case 'retry':
        state.retry?.();
        break;
      case 'open-machine-form':
        card.machineForm = { name: '', unit: '', error: '' };
        renderCard(index);
        container.querySelector(`#machine-name-${index}`).focus();
        break;
      case 'close-machine-form':
        card.machineForm = null;
        renderCard(index);
        break;
      case 'add-set':
        card.reps.push('');
        renderCard(index);
        container.querySelector(`[data-card="${index}"] input[data-row="${card.reps.length - 1}"]`).focus();
        break;
      case 'remove-set':
        if (card.reps.length <= 1) break;
        card.reps.pop();
        card.problems = card.problems.filter((problem) => problem.row === undefined || problem.row < card.reps.length);
        renderCard(index);
        break;
    }
  });

  render();

  return {
    hasUnsavedChanges: () =>
      !state.saved && state.cards.some((card) => card.weight.trim() || card.reps.some((value) => value.trim())),
    destroy: unsubscribe,
  };
}
