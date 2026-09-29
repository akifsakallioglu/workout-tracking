// Antrenman ekranı: günün bütün hareketleri kartlarla girilir. İlk değer yazılınca antrenman
// "devam ediyor" olarak kaydedilir ve her değişiklik kendiliğinden kaydedilir; "Bitir" antrenmanı
// bitirir, "İptal" siler. Seti girilmeyen hareket atlanır ve kayda yazılmaz.
import {
  activeSession,
  buildSession,
  defaultEquipmentId,
  equipmentError,
  evaluateCards,
  formatDateTime,
  withEquipment,
} from '../logic.js';
import {
  createId,
  deleteSession,
  hasPendingWrites,
  loadProgram,
  loadSessions,
  onSaveStatus,
  saveProgram,
  saveSession,
} from '../store.js';
import { errorReason, escapeHtml } from '../ui.js';
import { cardHtml, isInvalid } from './exercise-card.js';

// Yazmayı bırakınca kaydetmeden önce beklenen süre.
const SAVE_DELAY = 500;

// Kayıt durumunun metni, son yazmanın neyi kaydettiğine göre değişir.
const STATUS_TEXT = {
  session: {
    saving: 'Kaydediliyor…',
    saved: 'Kaydedildi ✓',
    error: 'Kaydedilemedi.',
    keep: 'değerler ekranda duruyor ve her değişiklikte yeniden denenecek.',
  },
  finish: {
    saving: 'Kaydediliyor…',
    saved: 'Kaydedildi ✓',
    error: 'Antrenman bitirilemedi.',
    keep: 'değerler ekranda duruyor.',
  },
  cancel: {
    saving: 'Siliniyor…',
    saved: 'Silindi',
    error: 'Antrenman silinemedi.',
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
  const active = activeSession(sessions);
  if (active && active.dayId !== day.id) return renderConflict(container, { active, day, program, navigate });

  const available = (exercise, equipmentId) =>
    exercise.equipment.some((equipment) => equipment.id === equipmentId && !equipment.archived);
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
  // Devam eden antrenmanın taslağından kart; hedef, antrenman başlarken kopyalanan hâlidir.
  const cardFromDraft = (draft) => {
    const exercise = program.exercises[draft.exerciseId];
    return {
      ...newCard(draft.item),
      exerciseId: draft.exerciseId,
      equipmentId: available(exercise, draft.equipmentId)
        ? draft.equipmentId
        : defaultEquipmentId(sessions, day.id, draft.exerciseId, exercise),
      weight: draft.weight,
      reps: [...draft.reps],
    };
  };

  const state = {
    program,
    sessions,
    sessionId: active?.id ?? createId(),
    startedAt: active?.startedAt ?? new Date().toISOString(),
    persisted: Boolean(active), // antrenman veritabanında "devam ediyor" olarak var mı
    cards: active?.draft ? active.draft.cards.map(cardFromDraft) : day.items.map(newCard),
    message: '',
    busy: false,
    ending: false, // bitirme ya da silme sürüyor: taslak artık kaydedilmez
    saved: false, // bitirildi ya da silindi
    timer: null,
    retry: null, // "Tekrar dene"nin yeniden çalıştıracağı işlem
    writeContext: 'session',
    status: { state: 'idle', error: null },
  };

  const exerciseOf = (card) => state.program.exercises[card.exerciseId];
  // Seçili makine; hareketin henüz makinesi yoksa undefined.
  const equipmentOf = (card) =>
    exerciseOf(card).equipment.find((equipment) => equipment.id === card.equipmentId && !equipment.archived);
  const cardContext = () => ({ day, program: state.program, sessions: state.sessions, busy: state.busy });
  const hasValues = () => state.cards.some((card) => card.weight.trim() || card.reps.some((value) => value.trim()));

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
      </div>
      <div class="page-actions">
        <button type="button" class="button danger" data-action="cancel"${state.busy ? ' disabled' : ''}>Antrenmanı iptal et</button>
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

  // Bekleyen (henüz yazılmaya başlanmamış) değişiklik de "Kaydediliyor…" sayılır.
  function renderStatus() {
    const element = container.querySelector('#save-status');
    if (!element) return;
    const saveState = state.timer ? 'saving' : state.status.state;
    const text = STATUS_TEXT[state.timer ? 'session' : state.writeContext];
    element.dataset.state = saveState;
    if (saveState === 'saving') {
      element.textContent = text.saving;
    } else if (saveState === 'saved') {
      element.textContent = text.saved;
    } else if (saveState === 'error') {
      element.innerHTML = `
        <span>${text.error} ${escapeHtml(errorReason(state.status.error))} Uygulamayı kapatmayın; ${text.keep}</span>
        <button type="button" class="button secondary" data-action="retry">Tekrar dene</button>`;
    } else {
      element.textContent = '';
    }
  }

  // Değişiklikten sonra kaydı ister: yazarken kısa bir bekleme, yapısal değişiklikte hemen.
  // Hiç değer girilmemiş ve henüz kaydedilmemiş antrenman kaydedilmez (yalnızca göz atılmıştır).
  // context, kayıt durumunda hangi metnin görüneceğini belirler.
  function requestSave(immediate = false, context = 'session') {
    if (state.saved || state.ending) return;
    if (!state.persisted && !hasValues()) return;
    clearTimeout(state.timer);
    state.timer = null;
    if (immediate) {
      saveNow(context);
      return;
    }
    state.timer = setTimeout(saveNow, SAVE_DELAY);
    renderStatus();
  }

  async function saveNow(context = 'session') {
    clearTimeout(state.timer);
    state.timer = null;
    if (state.saved || state.ending || (!state.persisted && !hasValues())) {
      renderStatus();
      return;
    }
    state.writeContext = context;
    try {
      await saveSession(draftSession());
      state.persisted = true;
      if (state.retry === saveNow) state.retry = null;
    } catch (error) {
      // Değerler ekranda kalır; bir sonraki değişiklikte ya da "Tekrar dene" ile yeniden yazılır.
      console.warn('Kaydedilemedi', error);
      state.retry = saveNow;
    }
  }

  function draftSession() {
    return {
      ...buildSession({ id: state.sessionId, startedAt: state.startedAt, finishedAt: null, day, entries: [] }),
      draft: {
        cards: state.cards.map(({ item, exerciseId, equipmentId, weight, reps }) => ({
          item,
          exerciseId,
          equipmentId,
          weight,
          reps: [...reps],
        })),
      },
    };
  }

  // Bekleyen değişikliği hemen yazmaya başlar (ekrandan çıkarken, uygulama arka plana geçerken).
  function flush() {
    if (state.timer && !state.saved) saveNow();
  }

  async function finish() {
    if (state.busy) return;
    clearTimeout(state.timer);
    state.timer = null;
    const { results, entries, hasProblems } = evaluateCards(state.cards, state.program.exercises);
    state.cards.forEach((card, index) => {
      card.problems = results[index].problems;
      card.message = results[index].message;
    });
    if (hasProblems) state.message = 'Bazı hareketlerde düzeltilmesi gereken değerler var.';
    else if (!entries.length) state.message = 'En az bir hareket için set girin.';
    else state.message = '';
    if (state.message) {
      render();
      container.querySelector('[aria-invalid="true"]')?.focus();
      saveNow(); // bitirilemeyen antrenmanın son hâli taslak olarak kalsın
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
    state.ending = true;
    state.busy = true;
    render();
    try {
      // Yazmalar tek sıradan geçtiği için bekleyen taslak yazmaları bu yazmadan önce biter.
      await saveSession(session);
      state.saved = true;
      navigate('#/', `${day.name} antrenmanı kaydedildi ✓`);
    } catch (error) {
      console.warn('Antrenman bitirilemedi', error);
      state.retry = finish;
      state.ending = false;
      state.busy = false;
      render();
    }
  }

  async function cancel(confirmed = false) {
    if (state.busy) return;
    const hasData = state.persisted || hasValues();
    if (hasData && !confirmed && !confirm('Bu antrenman silinecek; girdiğiniz değerler geri gelmez. Emin misiniz?')) return;
    clearTimeout(state.timer);
    state.timer = null;
    if (!hasData) {
      state.saved = true;
      navigate('#/');
      return;
    }
    state.writeContext = 'cancel';
    state.ending = true;
    state.busy = true;
    render();
    try {
      // Yazılmakta olan bir taslak varsa silme ondan sonra yapılır.
      await deleteSession(state.sessionId);
      state.saved = true;
      navigate('#/', 'Antrenman iptal edildi.');
    } catch (error) {
      console.warn('Antrenman silinemedi', error);
      state.retry = () => cancel(true);
      state.ending = false;
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
      requestSave(true, 'machine'); // kartın seçili makinesi değişti; durum "Makine eklendi ✓" kalsın
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
    requestSave();
  });

  container.addEventListener('change', (event) => {
    const { target } = event;
    const cardElement = target.closest('[data-card]');
    if (!cardElement) return;
    const index = Number(cardElement.dataset.card);
    const card = state.cards[index];
    if (target.dataset.field) {
      // Kutudan çıkınca bekleyen değişiklik hemen yazılır.
      if (state.timer) saveNow();
    } else if (target.name === `unit-${index}` && card.machineForm) {
      card.machineForm.unit = target.value;
    } else if (target.name === `equipment-${index}`) {
      card.equipmentId = target.value;
      clearProblems(card);
      renderCard(index);
      requestSave(true);
    } else if (target.name === `option-${index}`) {
      card.exerciseId = target.value;
      card.equipmentId = defaultEquipmentId(state.sessions, day.id, card.exerciseId, exerciseOf(card));
      card.machineForm = null;
      clearProblems(card);
      renderCard(index);
      requestSave(true);
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
      case 'cancel':
        cancel();
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
        requestSave(true);
        break;
      case 'remove-set':
        if (card.reps.length <= 1) break;
        card.reps.pop();
        card.problems = card.problems.filter((problem) => problem.row === undefined || problem.row < card.reps.length);
        renderCard(index);
        requestSave(true);
        break;
    }
  });

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flush);

  render();

  return {
    // Uygulama içinde başka ekrana geçerken: bekleyen değişiklik hemen yazılır. Son yazma
    // başarısız olduysa kullanıcıya sorulur.
    beforeLeave() {
      if (state.saved) return true;
      const failed = state.status.state === 'error';
      flush();
      return !failed || confirm('Son değişiklikler kaydedilemedi ve kaybolabilir. Yine de çıkmak istiyor musunuz?');
    },
    flush,
    // Sayfa kapanırken ya da yenilenirken tarayıcı uyarı göstersin mi.
    hasUnsavedChanges: () => !state.saved && (state.timer !== null || hasPendingWrites() || state.status.state === 'error'),
    destroy() {
      clearTimeout(state.timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
    },
  };
}

// Başka bir günün antrenmanı devam ederken yeni gün açılınca: devam et, bitir ya da sil.
function renderConflict(container, { active, day, program, navigate }) {
  let message = '';
  let busy = false;

  function render() {
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/">← Günler</a>
      </header>
      <section class="card conflict" aria-labelledby="conflict-title">
        <p class="eyebrow">Devam eden antrenman var</p>
        <h1 id="conflict-title">${escapeHtml(active.dayName)} antrenmanı bitmedi</h1>
        <p class="muted">Başlangıç: ${formatDateTime(active.startedAt)}. ${escapeHtml(day.name)} antrenmanına başlamadan önce ne yapılsın?</p>
        <div class="conflict-actions">
          <a class="button primary" href="#/antrenman/${escapeHtml(active.dayId)}">Devam et</a>
          <button type="button" class="button secondary" data-action="finish-active"${busy ? ' disabled' : ''}>Bitir ve ${escapeHtml(day.name)} antrenmanına başla</button>
          <button type="button" class="button danger" data-action="delete-active"${busy ? ' disabled' : ''}>Sil ve ${escapeHtml(day.name)} antrenmanına başla</button>
        </div>
        <p id="conflict-message" class="message" role="alert">${escapeHtml(message)}</p>
      </section>`;
  }

  async function run(operation, failure) {
    busy = true;
    render();
    try {
      await operation();
      navigate(location.hash); // aynı adres yeniden açılır; artık devam eden antrenman yok
    } catch (error) {
      console.warn(failure, error);
      message = `${failure} ${errorReason(error)} Tekrar deneyin.`;
      busy = false;
      render();
    }
  }

  container.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || busy) return;
    if (action === 'finish-active') {
      const { entries, hasProblems } = evaluateCards(active.draft?.cards ?? [], program.exercises);
      if (hasProblems || !entries.length) {
        message = hasProblems
          ? `${active.dayName} antrenmanında eksik ya da hatalı değerler var. Düzeltmek için antrenmana devam edin.`
          : `${active.dayName} antrenmanında kaydedilecek set yok. Silip ${day.name} antrenmanına başlayabilirsiniz.`;
        render();
        return;
      }
      const finished = buildSession({
        id: active.id,
        startedAt: active.startedAt,
        finishedAt: new Date().toISOString(),
        day: { id: active.dayId, name: active.dayName },
        entries,
      });
      run(() => saveSession(finished), `${active.dayName} antrenmanı bitirilemedi.`);
    } else if (action === 'delete-active') {
      if (!confirm(`${active.dayName} antrenmanındaki bütün değerler silinecek. Emin misiniz?`)) return;
      run(() => deleteSession(active.id), `${active.dayName} antrenmanı silinemedi.`);
    }
  });

  render();
  return {};
}
