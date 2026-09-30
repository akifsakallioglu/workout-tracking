// Antrenman ekranı: günün bütün hareketleri kartlarla girilir. İlk değer yazılınca antrenman
// "devam ediyor" olarak kaydedilir ve her değişiklik kendiliğinden kaydedilir; "Bitir" antrenmanı
// bitirir, "İptal" siler. Seti girilmeyen hareket atlanır ve kayda yazılmaz.
// Düzenleme modu (editSessionId): geçmiş bir antrenman aynı kartlarla düzeltilir; otomatik kaydetme
// yoktur, "Kaydet" ile kaydedilir. "Geçen sefer" ve sayaç o antrenmandan önceki kayıtlara göredir.
// "+ Hareket ekle" programı değiştirmeden yalnızca bu antrenmana hareket ekler.
import {
  activeSession,
  buildSession,
  changedEquipment,
  defaultEquipmentId,
  equipmentError,
  equipmentUseCount,
  evaluateCards,
  exerciseNameError,
  formatDateTime,
  formatDay,
  formatWeight,
  itemTitle,
  lastPerformance,
  parseTarget,
  programTarget,
  restoreError,
  restoredEquipment,
  suggestOption,
  usedEquipmentIds,
  withEquipment,
  withExercise,
  withoutEquipment,
} from '../logic.js';
import {
  createId,
  deleteSession,
  hasPendingWrites,
  loadProgram,
  loadSessions,
  onSaveStatus,
  requestPersistentStorage,
  saveProgram,
  saveSession,
} from '../store.js';
import { errorReason, escapeHtml } from '../ui.js';
import { cardHtml, cardLiveText, isInvalid } from './exercise-card.js';

// Yazmayı bırakınca kaydetmeden önce beklenen süre.
const SAVE_DELAY = 500;
const NEW = '+yeni'; // "+ Hareket ekle" seçim kutusunda "+ Yeni hareket"

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
  machineDelete: {
    saving: 'Makine siliniyor…',
    saved: 'Makine silindi ✓',
    error: 'Makine silinemedi.',
    keep: 'makine listede duruyor.',
  },
  machineEdit: {
    saving: 'Makine kaydediliyor…',
    saved: 'Makine kaydedildi ✓',
    error: 'Makine kaydedilemedi.',
    keep: 'girdiğiniz ad ve birim formda duruyor.',
  },
  machineRestore: {
    saving: 'Makine geri alınıyor…',
    saved: 'Makine geri alındı ✓',
    error: 'Makine geri alınamadı.',
    keep: 'makine silinmiş makineler listesinde duruyor.',
  },
  exercise: {
    saving: 'Hareket ekleniyor…',
    saved: 'Hareket eklendi ✓',
    error: 'Hareket eklenemedi.',
    keep: 'girdiğiniz değerler formda duruyor.',
  },
  edit: {
    saving: 'Kaydediliyor…',
    saved: 'Kaydedildi ✓',
    error: 'Değişiklikler kaydedilemedi.',
    keep: 'değerler ekranda duruyor.',
  },
};

export async function renderWorkout(container, { dayId, navigate, editSessionId = null }) {
  const [program, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const editing = editSessionId ? sessions.find((session) => session.id === editSessionId && session.finishedAt) : null;
  if (editSessionId && !editing) {
    navigate('#/gecmis', '', 'replace');
    return {};
  }
  // Düzenlenen antrenmanın günü kayıttaki hâlidir (program sonradan değişmiş olabilir).
  const day = editing
    ? { id: editing.dayId, name: editing.dayName }
    : program.days.find((candidate) => candidate.id === dayId);
  if (!day) {
    navigate('#/', '', 'replace');
    return {};
  }
  const active = editing ? null : activeSession(sessions);
  if (active && active.dayId !== day.id) return renderConflict(container, { active, day, program, navigate });

  const available = (exercise, equipmentId) =>
    exercise.equipment.some((equipment) => equipment.id === equipmentId && !equipment.archived);
  // exercises: antrenman sırasında yeni hareket eklendiyse güncel katalog.
  const newCard = (item, exercises = program.exercises) => {
    // Dönüşümlü satırda önerilen hareket seçili gelir; tek hareketli satırda o hareket.
    const { exerciseId } = suggestOption(sessions, day.id, item.options);
    return {
      item,
      exerciseId,
      equipmentId: defaultEquipmentId(sessions, day.id, exerciseId, exercises[exerciseId]),
      weight: '',
      reps: Array.from({ length: item.sets }, () => ''),
      problems: [],
      message: '',
      machineForm: null, // { name, unit, error }: açıkken yeni makine formu görünür
      editingMachines: false, // açıkken makineler "Değiştir", "Sil" ve "Geri al" düğmeleriyle listelenir
      machineEdit: null, // { equipmentId, name, unit, error }: açıkken o makinenin adı ve birimi değişir
      extra: false, // "+ Hareket ekle" ile yalnızca bu antrenmana eklendi
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
      extra: Boolean(draft.extra),
    };
  };
  // Geçmiş bir kaydın girişinden kart: hedef kayıttaki kopyadır; makine sonradan silindiyse korunur.
  const cardFromEntry = (entry) => ({
    ...newCard({ id: `${day.id}-${entry.options.join('-')}`, options: entry.options, ...entry.target }),
    exerciseId: entry.exerciseId,
    equipmentId: entry.equipmentId,
    keepEquipmentId: entry.equipmentId,
    weight: entry.unit === 'none' ? '' : formatWeight(entry.sets[0].weight),
    reps: entry.sets.map((set) => String(set.reps)),
  });

  let cards;
  if (editing) cards = editing.entries.map(cardFromEntry);
  else if (active?.draft) cards = active.draft.cards.map(cardFromDraft);
  else cards = day.items.map((item) => newCard(item));

  const state = {
    program,
    sessions,
    editing, // düzenlenen geçmiş antrenman; yoksa null
    dirty: false, // düzenleme modunda kaydedilmemiş değişiklik var mı
    sessionId: editing?.id ?? active?.id ?? createId(),
    startedAt: editing?.startedAt ?? active?.startedAt ?? new Date().toISOString(),
    persisted: Boolean(active), // antrenman veritabanında "devam ediyor" olarak var mı
    cards,
    message: '',
    busy: false,
    ending: false, // bitirme ya da silme sürüyor: taslak artık kaydedilmez
    extraForm: null, // "+ Hareket ekle" formu: { exerciseId, name, sets, repMax, targetTouched, error, field }
    saved: false, // bitirildi ya da silindi
    timer: null,
    retry: null, // "Tekrar dene"nin yeniden çalıştıracağı işlem
    writeContext: 'session',
    status: { state: 'idle', error: null },
  };

  const exerciseOf = (card) => state.program.exercises[card.exerciseId];
  // Seçili makine; hareketin henüz makinesi yoksa undefined.
  const equipmentOf = (card) =>
    exerciseOf(card).equipment.find(
      (equipment) => equipment.id === card.equipmentId && (!equipment.archived || equipment.id === card.keepEquipmentId),
    );
  const before = editing?.startedAt ?? null;
  const cardContext = () => ({
    day,
    program: state.program,
    sessions: state.sessions,
    busy: state.busy,
    before,
    editing: Boolean(editing),
  });
  const hasValues = () => state.cards.some((card) => card.weight.trim() || card.reps.some((value) => value.trim()));

  function render() {
    const disabled = state.busy ? ' disabled' : '';
    container.innerHTML = `
      <header class="topbar">
        <div class="topbar-row">
          ${editing
            ? `<a class="back" href="#/gecmis/${escapeHtml(editing.id)}" data-nav="up">← Vazgeç</a>
               <h1>${escapeHtml(day.name)} · ${formatDay(editing.startedAt)}</h1>
               <button type="button" class="button primary" data-action="save-edit"${disabled}>Kaydet</button>`
            : `<a class="back" href="#/" data-nav="up">← Ana Sayfa</a>
               <h1>${escapeHtml(day.name)}</h1>
               <button type="button" class="button primary" data-action="finish"${disabled}>Bitir</button>`}
        </div>
        <div id="save-status" class="save-status" role="status"></div>
      </header>
      <p id="workout-message" class="message" role="alert">${escapeHtml(state.message)}</p>
      <datalist id="machine-names">${machineNameOptions()}</datalist>
      <div class="cards">
        ${state.cards.map((card, index) => cardHtml(card, index, cardContext())).join('')}
      </div>
      ${state.cards.length ? '' : `
        <p class="muted empty-state">Bu günde hareket yok. <a href="#/program/${escapeHtml(day.id)}">Satır ekleyin</a> ya da bu antrenmana hareket ekleyin.</p>`}
      ${state.extraForm ? extraFormHtml() : `
        <div class="add-exercise">
          <button type="button" class="button add block" data-action="open-extra"${disabled}>+ Hareket ekle</button>
        </div>`}
      ${editing ? '' : `
        <div class="page-actions">
          <button type="button" class="button danger block" data-action="cancel"${disabled}>Antrenmanı iptal et</button>
        </div>`}`;
    renderStatus();
  }

  // "+ Hareket ekle": katalogdan (bu antrenmanda olmayan) hareket ya da yeni hareket ve hedefi.
  function extraFormHtml() {
    const form = state.extraForm;
    const inCards = new Set(state.cards.flatMap((card) => card.item.options));
    const choices = Object.entries(state.program.exercises)
      .filter(([id]) => !inCards.has(id))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'tr'));
    const invalid = (field) => (form.field === field ? ' aria-invalid="true"' : '');
    const number = (name, label) => `
      <div class="field">
        <label for="extra-${name}">${label}</label>
        <input id="extra-${name}" name="${name}" type="text" inputmode="numeric" autocomplete="off"
          value="${escapeHtml(form[name])}"${invalid(name)}>
      </div>`;
    return `
      <form class="card extra-form" data-form="extra" novalidate>
        <p class="form-title">Bu antrenmana hareket ekle</p>
        <p class="muted field-hint">Program değişmez; hareket yalnızca bu antrenmana eklenir.</p>
        <div class="field">
          <label for="extra-exercise">Hareket</label>
          <select id="extra-exercise" name="exerciseId"${invalid('exerciseId')}>
            <option value=""${form.exerciseId ? '' : ' selected'}>Hareket seçin</option>
            ${choices.map(([id, exercise]) =>
              `<option value="${escapeHtml(id)}"${id === form.exerciseId ? ' selected' : ''}>${escapeHtml(exercise.name)}</option>`).join('')}
            <option value="${NEW}"${form.exerciseId === NEW ? ' selected' : ''}>+ Yeni hareket</option>
          </select>
        </div>
        ${form.exerciseId === NEW ? `
          <div class="field">
            <label for="extra-name">Yeni hareketin adı</label>
            <input id="extra-name" name="name" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(form.name)}"${invalid('name')}>
          </div>` : ''}
        <fieldset class="target-fieldset">
          <legend>Hedef</legend>
          <div class="target-fields">
            ${number('sets', 'Set')}
            ${number('repMax', 'En çok tekrar')}
          </div>
        </fieldset>
        <p class="message" role="alert">${escapeHtml(form.error)}</p>
        <div class="actions">
          <button type="submit" class="button primary"${state.busy ? ' disabled' : ''}>Ekle</button>
          <button type="button" class="button secondary" data-action="close-extra">Vazgeç</button>
        </div>
      </form>`;
  }

  function renderCard(index) {
    container.querySelector(`[data-card="${index}"]`).outerHTML = cardHtml(state.cards[index], index, cardContext());
  }

  // Makine adı önerileri: bütün hareketlerde kullanılan (silinmemiş) makine adları.
  function machineNameOptions() {
    const names = new Set(
      Object.values(state.program.exercises).flatMap((exercise) =>
        exercise.equipment.filter((equipment) => !equipment.archived).map((equipment) => equipment.name)),
    );
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
    if (state.editing) {
      state.dirty = true; // düzenleme modunda otomatik kaydetme yok; "Kaydet" beklenir
      return;
    }
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
    if (state.editing || state.saved || state.ending || (!state.persisted && !hasValues())) {
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
        cards: state.cards.map(({ item, exerciseId, equipmentId, weight, reps, extra }) => ({
          item,
          exerciseId,
          equipmentId,
          weight,
          reps: [...reps],
          ...(extra ? { extra: true } : {}),
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
      // İlk bitirilen antrenmandan sonra tarayıcıdan verileri kendiliğinden silmemesi istenir.
      requestPersistentStorage().catch((error) => console.warn('Kalıcı depolama istenemedi', error));
      navigate('#/', `${day.name} antrenmanı kaydedildi ✓`, 'up');
    } catch (error) {
      console.warn('Antrenman bitirilemedi', error);
      state.retry = finish;
      state.ending = false;
      state.busy = false;
      render();
    }
  }

  // Düzenleme modu: değerler denetlenir, antrenmanın girişleri yenileriyle değiştirilir. Tarih ve gün
  // aynı kalır; hedefler kayıttaki kopyalardır.
  async function saveEdit() {
    if (state.busy) return;
    const { results, entries, hasProblems } = evaluateCards(state.cards, state.program.exercises);
    state.cards.forEach((card, index) => {
      card.problems = results[index].problems;
      card.message = results[index].message;
    });
    if (hasProblems) state.message = 'Bazı hareketlerde düzeltilmesi gereken değerler var.';
    else if (!entries.length) {
      state.message = 'En az bir hareket için set girin. Antrenmanı tamamen silmek için ayrıntı ekranındaki "Sil"i kullanın.';
    } else state.message = '';
    if (state.message) {
      render();
      container.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    state.writeContext = 'edit';
    state.busy = true;
    render();
    try {
      await saveSession({ ...editing, entries });
      state.saved = true;
      navigate(`#/gecmis/${editing.id}`, 'Değişiklikler kaydedildi ✓', 'up');
    } catch (error) {
      console.warn('Değişiklikler kaydedilemedi', error);
      state.retry = saveEdit;
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
      navigate('#/', '', 'up');
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
      navigate('#/', 'Antrenman iptal edildi.', 'up');
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

  // Silmeden önce onay alınır. Kaydı olmayan makine tamamen silinir; kaydı olan makine arşivlenir:
  // listeden kalkar, eski kayıtlar bozulmaz.
  async function deleteMachine(index, equipmentId, confirmed = false) {
    const card = state.cards[index];
    const equipment = exerciseOf(card).equipment.find((option) => option.id === equipmentId);
    if (state.busy || !equipment) return;
    if (!confirmed) {
      const uses = equipmentUseCount(state.sessions, equipmentId);
      const question = uses
        ? `"${equipment.name}" makinesi silinsin mi? Bu makinede ${uses} kayıtlı antrenman var; o kayıtlar silinmez.`
        : `"${equipment.name}" makinesi silinsin mi?`;
      if (!confirm(question)) return;
    }

    const next = withoutEquipment(state.program, card.exerciseId, equipmentId, usedEquipmentIds(state.sessions));
    state.writeContext = 'machineDelete';
    state.busy = true;
    renderCard(index);
    try {
      await saveProgram(next);
      state.program = next;
      // Silinen makine seçili olan kartlarda başka bir makine (ya da hiçbiri) seçilir.
      for (const other of state.cards) {
        if (other.exerciseId === card.exerciseId && other.equipmentId === equipmentId) {
          other.equipmentId = defaultEquipmentId(state.sessions, day.id, other.exerciseId, exerciseOf(other));
        }
      }
      if (!exerciseOf(card).equipment.some((option) => !option.archived)) card.editingMachines = false;
      state.retry = null;
      requestSave(true, 'machineDelete');
    } catch (error) {
      console.warn('Makine silinemedi', error);
      state.retry = () => deleteMachine(index, equipmentId, true);
    } finally {
      state.busy = false;
      render();
    }
  }

  // Makinenin adı ve birimi değişir; kaydı olan makinenin birimi kilitlidir. Kimlik aynı kaldığı için
  // geçmiş kopmaz.
  async function saveMachineEdit(index) {
    const card = state.cards[index];
    const form = card.machineEdit;
    if (state.busy || !form) return;
    const exercise = exerciseOf(card);
    const current = exercise.equipment.find((option) => option.id === form.equipmentId);
    const unit = usedEquipmentIds(state.sessions).has(current.id) ? current.unit : form.unit;
    form.error = equipmentError(exercise, form.name, unit, current.id);
    if (form.error) {
      renderCard(index);
      container.querySelector(`#machine-edit-name-${index}`)?.focus();
      return;
    }
    if (form.name.trim() === current.name && unit === current.unit) {
      card.machineEdit = null;
      renderCard(index);
      return;
    }

    const next = changedEquipment(state.program, card.exerciseId, current.id, { name: form.name, unit });
    state.writeContext = 'machineEdit';
    state.busy = true;
    renderCard(index);
    try {
      await saveProgram(next);
      state.program = next;
      card.machineEdit = null;
      clearProblems(card);
      state.retry = null;
    } catch (error) {
      console.warn('Makine kaydedilemedi', error);
      state.retry = () => saveMachineEdit(index);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function restoreMachine(index, equipmentId) {
    const card = state.cards[index];
    if (state.busy) return;
    const exercise = exerciseOf(card);
    card.message = restoreError(exercise, equipmentId);
    if (card.message) {
      renderCard(index);
      return;
    }

    const next = restoredEquipment(state.program, card.exerciseId, equipmentId);
    state.writeContext = 'machineRestore';
    state.busy = true;
    renderCard(index);
    try {
      await saveProgram(next);
      state.program = next;
      // Makinesi seçili olmayan kartta geri alınan makine seçili gelir.
      let selected = false;
      for (const other of state.cards) {
        if (other.exerciseId === card.exerciseId && !equipmentOf(other)) {
          other.equipmentId = equipmentId;
          selected = true;
        }
      }
      state.retry = null;
      if (selected) requestSave(true, 'machineRestore');
    } catch (error) {
      console.warn('Makine geri alınamadı', error);
      state.retry = () => restoreMachine(index, equipmentId);
    } finally {
      state.busy = false;
      render();
    }
  }

  // "+ Hareket ekle": kart bu antrenmanın sonuna eklenir; program değişmez. Yeni hareket seçildiyse
  // önce katalogda (makinesiz) oluşturulur.
  async function addExtra() {
    const form = state.extraForm;
    if (state.busy || !form) return;
    const fail = (error, field) => {
      form.error = error;
      form.field = field;
      render();
      container.querySelector(`#extra-${field === 'exerciseId' ? 'exercise' : field}`)?.focus();
    };
    if (!form.exerciseId) return fail('Bir hareket seçin.', 'exerciseId');
    if (form.exerciseId === NEW) {
      const error = exerciseNameError(state.program, form.name);
      if (error) return fail(error, 'name');
    }
    const parsed = parseTarget(form);
    if (parsed.error) return fail(parsed.error, parsed.field);

    let { exerciseId } = form;
    if (exerciseId === NEW) {
      exerciseId = `ex-${createId()}`;
      const next = withExercise(state.program, exerciseId, form.name);
      state.writeContext = 'exercise';
      state.busy = true;
      render();
      try {
        await saveProgram(next);
        state.program = next;
        form.exerciseId = exerciseId; // yeniden denenirse aynı hareket kullanılsın
        state.retry = null;
      } catch (error) {
        console.warn('Hareket eklenemedi', error);
        state.retry = addExtra;
        state.busy = false;
        render();
        return;
      }
      state.busy = false;
    }

    const item = { id: `extra-${createId()}`, options: [exerciseId], ...parsed.target };
    state.cards.push({ ...newCard(item, state.program.exercises), extra: true });
    state.extraForm = null;
    render();
    const added = container.querySelector(`[data-card="${state.cards.length - 1}"]`);
    added.scrollIntoView({ block: 'nearest' });
    added.querySelector('input, button')?.focus();
    requestSave(true);
  }

  // Sonradan eklenen kart kaldırılır; değer girildiyse önce sorulur.
  function removeCard(index) {
    const card = state.cards[index];
    const hasCardValues = card.weight.trim() || card.reps.some((value) => value.trim());
    const title = itemTitle(card.item, state.program.exercises);
    if (hasCardValues && !confirm(`${title} bu antrenmandan kaldırılsın mı? Girdiğiniz değerler silinir.`)) return;
    state.cards.splice(index, 1);
    render();
    container.querySelector('[data-action="open-extra"]')?.focus();
    requestSave(true);
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
    if (target.closest('[data-form="extra"]')) {
      if (target.name in state.extraForm) state.extraForm[target.name] = target.value;
      if (['sets', 'repMax'].includes(target.name)) state.extraForm.targetTouched = true;
      return;
    }
    const cardElement = target.closest('[data-card]');
    if (!cardElement) return;
    const card = state.cards[Number(cardElement.dataset.card)];
    if (target.name === 'name' && card.machineForm) {
      card.machineForm.name = target.value;
      return;
    }
    if (target.name === 'editName' && card.machineEdit) {
      card.machineEdit.name = target.value;
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
    const equipment = equipmentOf(card);
    const live = cardElement.querySelector('.progress-live');
    if (equipment && live) {
      const key = { dayId: day.id, exerciseId: card.exerciseId, equipmentId: equipment.id };
      live.textContent = cardLiveText(card, equipment, lastPerformance(state.sessions, key, before));
    }
    requestSave();
  });

  container.addEventListener('change', (event) => {
    const { target } = event;
    if (target.closest('[data-form="extra"]')) {
      if (target.name !== 'exerciseId') return;
      const form = state.extraForm;
      form.exerciseId = target.value;
      form.error = '';
      form.field = null;
      // Hedef kutularına dokunulmadıysa hareketin programdaki hedefi gelir.
      const planned = programTarget(state.program, target.value);
      if (planned && !form.targetTouched) {
        form.sets = String(planned.sets);
        form.repMax = String(planned.repMax);
      }
      render();
      container.querySelector(form.exerciseId === NEW ? '#extra-name' : '#extra-exercise')?.focus();
      return;
    }
    const cardElement = target.closest('[data-card]');
    if (!cardElement) return;
    const index = Number(cardElement.dataset.card);
    const card = state.cards[index];
    if (target.dataset.field) {
      // Kutudan çıkınca bekleyen değişiklik hemen yazılır.
      if (state.timer) saveNow();
    } else if (target.name === `unit-${index}` && card.machineForm) {
      card.machineForm.unit = target.value;
    } else if (target.name === `edit-unit-${index}` && card.machineEdit) {
      card.machineEdit.unit = target.value;
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
    const { form } = event.target.dataset;
    if (form === 'extra') {
      addExtra();
      return;
    }
    const cardElement = event.target.closest('[data-card]');
    if (!cardElement) return;
    if (form === 'machine') addMachine(Number(cardElement.dataset.card));
    else if (form === 'machine-edit') saveMachineEdit(Number(cardElement.dataset.card));
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
      case 'save-edit':
        saveEdit();
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
      case 'edit-machines':
        card.editingMachines = true;
        card.machineForm = null;
        renderCard(index);
        break;
      case 'done-editing':
        card.editingMachines = false;
        card.machineEdit = null;
        renderCard(index);
        break;
      case 'delete-machine':
        deleteMachine(index, actionElement.dataset.equipment);
        break;
      case 'edit-machine': {
        const equipment = exerciseOf(card).equipment.find((option) => option.id === actionElement.dataset.equipment);
        card.machineEdit = { equipmentId: equipment.id, name: equipment.name, unit: equipment.unit, error: '' };
        renderCard(index);
        container.querySelector(`#machine-edit-name-${index}`).focus();
        break;
      }
      case 'cancel-machine-edit':
        card.machineEdit = null;
        renderCard(index);
        break;
      case 'restore-machine':
        restoreMachine(index, actionElement.dataset.equipment);
        break;
      case 'open-extra':
        state.extraForm = { exerciseId: '', name: '', sets: '3', repMax: '', targetTouched: false, error: '', field: null };
        render();
        container.querySelector('#extra-exercise').focus();
        break;
      case 'close-extra':
        state.extraForm = null;
        render();
        container.querySelector('[data-action="open-extra"]')?.focus();
        break;
      case 'remove-card':
        removeCard(index);
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
      if (state.editing) {
        return !state.dirty || confirm('Değişiklikler kaydedilmedi ve kaybolacak. Çıkmak istiyor musunuz?');
      }
      const failed = state.status.state === 'error';
      flush();
      return !failed || confirm('Son değişiklikler kaydedilemedi ve kaybolabilir. Yine de çıkmak istiyor musunuz?');
    },
    flush,
    // Sayfa kapanırken ya da yenilenirken tarayıcı uyarı göstersin mi.
    hasUnsavedChanges: () =>
      !state.saved && (state.editing ? state.dirty : state.timer !== null || hasPendingWrites() || state.status.state === 'error'),
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
        <a class="back" href="#/" data-nav="up">← Ana Sayfa</a>
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
