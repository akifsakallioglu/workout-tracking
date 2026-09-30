// Program düzenleyici: günler (ekleme, adlandırma, sıralama, silme), günün satırları (ekleme,
// düzenleme, sıralama, silme) ve "Programı sıfırla". Her değişiklik hemen kaydedilir; satır
// düzenleme ekranı "Kaydet" ile kaydeder. Devam eden antrenman kendi kopyasıyla sürer.
import {
  UNIT_LABELS,
  activeSession,
  dayNameError,
  exerciseNameError,
  formatTarget,
  itemOptionsError,
  itemTitle,
  movedDay,
  movedItem,
  parseTarget,
  renamedDay,
  renamedExercise,
  resetProgram,
  withDay,
  withExercise,
  withItem,
  withoutDay,
  withoutItem,
} from '../logic.js';
import { program as seedProgram } from '../seed.js';
import { createId, loadProgram, loadSessions, saveProgram } from '../store.js';
import { errorReason, escapeHtml } from '../ui.js';

const NEW = '+yeni'; // seçim kutusunda "+ Yeni hareket"
const failed = (error) => `Program kaydedilemedi. ${errorReason(error)}`;

export async function renderProgram(container, { navigate, flash }) {
  const [loaded, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  const state = { program: loaded, form: null, message: '', flash, busy: false };

  function render(focus = null) {
    const { program, busy } = state;
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/" data-nav="up">← Ana Sayfa</a>
        <h1>Program</h1>
        <p class="muted">Günlerin sırası "Sıradaki" gününün sırasıdır.</p>
      </header>
      ${state.flash ? `<p id="flash" class="flash" role="status">${escapeHtml(state.flash)}</p>` : ''}
      <ul class="program-list">
        ${program.days.map((day, index) => `
          <li class="program-row">
            <a class="program-link" href="#/program/${escapeHtml(day.id)}">
              <span class="day-name">${escapeHtml(day.name)}</span>
              <span class="muted">${day.items.length} hareket</span>
            </a>
            ${moveButtons('day', day.id, day.name, index, program.days.length, busy)}
          </li>`).join('')}
      </ul>
      ${state.form ? `
        <form class="card program-form" data-form="day" novalidate>
          <div class="field">
            <label for="day-name">Yeni günün adı</label>
            <input id="day-name" name="name" type="text" maxlength="30" autocomplete="off" placeholder="ör. Arms"
              value="${escapeHtml(state.form.name)}"${state.form.error ? ' aria-invalid="true"' : ''}>
          </div>
          <p class="message" role="alert">${escapeHtml(state.form.error)}</p>
          <div class="actions">
            <button type="submit" class="button primary"${busy ? ' disabled' : ''}>Ekle</button>
            <button type="button" class="button secondary" data-action="close-day-form">Vazgeç</button>
          </div>
        </form>` : `
        <div class="actions">
          <button type="button" class="button add block" data-action="open-day-form">+ Gün ekle</button>
        </div>`}
      <p id="program-message" class="message" role="alert">${escapeHtml(state.message)}</p>
      <section class="card reset-section" aria-labelledby="reset-title">
        <h2 id="reset-title">Programı sıfırla</h2>
        <p class="muted">Günler, satırlar, hedefler ve hareket adları başlangıç programına döner. Makineler ve geçmiş kayıtlar korunur.</p>
        <div class="actions">
          <button type="button" class="button danger block" data-action="reset"${busy ? ' disabled' : ''}>Programı sıfırla</button>
        </div>
      </section>`;
    if (focus) container.querySelector(focus)?.focus();
  }

  async function save(next, done) {
    state.busy = true;
    state.message = '';
    try {
      await saveProgram(next);
      state.program = next;
      done?.();
    } catch (error) {
      console.warn('Program kaydedilemedi', error);
      state.message = failed(error);
    }
    state.busy = false;
  }

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || state.busy) return;
    const { action } = button.dataset;
    if (action === 'open-day-form' || action === 'close-day-form') {
      state.form = action === 'open-day-form' ? { name: '', error: '' } : null;
      render(state.form ? '#day-name' : '[data-action="open-day-form"]');
    } else if (action === 'move-day') {
      const { id, delta } = button.dataset;
      state.flash = '';
      await save(movedDay(state.program, id, Number(delta)));
      render(moveFocus('day', id, delta, state.program.days.map((day) => day.id)));
    } else if (action === 'reset') {
      if (activeSession(sessions)) {
        state.message = 'Devam eden antrenman varken program sıfırlanamaz. Önce antrenmanı bitirin ya da silin.';
        render();
        return;
      }
      if (!confirm('Program başlangıç hâline dönsün mü? Günler, satırlar, hedefler ve hareket adları sıfırlanır; makineler ve geçmiş kayıtlar korunur.')) return;
      await save(resetProgram(state.program, seedProgram), () => {
        state.flash = 'Program sıfırlandı ✓';
      });
      render();
    }
  });

  container.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const name = event.target.elements.name.value;
    const error = dayNameError(state.program, name);
    if (error) {
      state.form = { name, error };
      render('#day-name');
      return;
    }
    const id = `day-${createId()}`;
    await save(withDay(state.program, id, name), () => navigate(`#/program/${id}`, 'Gün eklendi ✓ Şimdi satır ekleyin.'));
    if (state.message) {
      state.form = { name, error: '' };
      render();
    }
  });

  render();
  return {};
}

export async function renderDayEditor(container, { dayId, navigate, flash }) {
  const [loaded, sessions] = await Promise.all([loadProgram(), loadSessions()]);
  if (!loaded.days.some((day) => day.id === dayId)) {
    navigate('#/program', '', 'replace');
    return {};
  }
  const active = activeSession(sessions);
  const state = { program: loaded, nameError: '', message: '', flash, busy: false };
  const currentDay = () => state.program.days.find((day) => day.id === dayId);

  function render(focus = null) {
    const { program, busy } = state;
    const day = currentDay();
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/program" data-nav="up">← Program</a>
        <h1>${escapeHtml(day.name)}</h1>
      </header>
      ${state.flash ? `<p id="flash" class="flash" role="status">${escapeHtml(state.flash)}</p>` : ''}
      ${active?.dayId === dayId ? `
        <p class="reminder">Bu günün devam eden antrenmanı var; o antrenman başladığı hâliyle sürer. Değişiklikler sonraki antrenmanda geçerli olur.</p>` : ''}
      <form class="program-form inline-form" data-form="day-name" novalidate>
        <div class="field">
          <label for="day-name">Gün adı</label>
          <input id="day-name" name="name" type="text" maxlength="30" autocomplete="off" value="${escapeHtml(day.name)}"${state.nameError ? ' aria-invalid="true"' : ''}>
        </div>
        <button type="submit" class="button secondary"${busy ? ' disabled' : ''}>Kaydet</button>
      </form>
      <p class="message" role="alert">${escapeHtml(state.nameError)}</p>

      <h2 class="section-title">Satırlar</h2>
      ${day.items.length ? `
        <ol class="program-list">
          ${day.items.map((item, index) => `
            <li class="program-row">
              <a class="program-link" href="#/program/${escapeHtml(dayId)}/${escapeHtml(item.id)}">
                <span class="day-name">${escapeHtml(itemTitle(item, program.exercises))}</span>
                <span class="muted">Hedef ${formatTarget(item)}</span>
              </a>
              ${moveButtons('item', item.id, itemTitle(item, program.exercises), index, day.items.length, busy)}
            </li>`).join('')}
        </ol>` : '<p class="muted empty-state">Bu günde henüz satır yok.</p>'}
      <div class="actions">
        <a class="button add block" href="#/program/${escapeHtml(dayId)}/yeni">+ Satır ekle</a>
      </div>
      <p id="day-message" class="message" role="alert">${escapeHtml(state.message)}</p>
      <div class="page-actions">
        <button type="button" class="button danger block" data-action="delete-day"${busy ? ' disabled' : ''}>Günü sil</button>
      </div>`;
    if (focus) container.querySelector(focus)?.focus();
  }

  async function save(next) {
    state.busy = true;
    state.message = '';
    try {
      await saveProgram(next);
      state.program = next;
      return true;
    } catch (error) {
      console.warn('Program kaydedilemedi', error);
      state.message = failed(error);
      return false;
    } finally {
      state.busy = false;
    }
  }

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || state.busy) return;
    const day = currentDay();
    if (button.dataset.action === 'move-item') {
      const { id, delta } = button.dataset;
      state.flash = '';
      await save(movedItem(state.program, dayId, id, Number(delta)));
      render(moveFocus('item', id, delta, currentDay().items.map((item) => item.id)));
    } else if (button.dataset.action === 'delete-day') {
      if (state.program.days.length === 1) state.message = 'Programda en az bir gün olmalı.';
      else if (active?.dayId === dayId) state.message = 'Bu günün devam eden antrenmanı var. Önce antrenmanı bitirin ya da silin.';
      else if (confirm(`"${day.name}" günü silinsin mi? Bu günün geçmiş kayıtları silinmez.`)) {
        if (await save(withoutDay(state.program, dayId))) {
          navigate('#/program', `"${day.name}" günü silindi.`, 'up');
          return;
        }
      } else return;
      render();
    }
  });

  container.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const name = event.target.elements.name.value;
    state.flash = '';
    state.nameError = dayNameError(state.program, name, dayId);
    if (!state.nameError && name.trim() !== currentDay().name) {
      if (await save(renamedDay(state.program, dayId, name))) state.flash = 'Gün adı kaydedildi ✓';
    }
    render(state.nameError ? '#day-name' : null);
  });

  render();
  return {};
}

export async function renderItemEditor(container, { dayId, itemId, navigate }) {
  const program = await loadProgram();
  const day = program.days.find((candidate) => candidate.id === dayId);
  const existing = day?.items.find((item) => item.id === itemId);
  if (!day || (itemId !== 'yeni' && !existing)) {
    navigate(day ? `#/program/${dayId}` : '#/program', '', 'replace');
    return {};
  }
  const state = {
    program,
    form: {
      first: existing?.options[0] ?? '',
      firstName: '',
      second: existing?.options[1] ?? '',
      secondName: '',
      sets: String(existing?.sets ?? 3),
      repMax: existing ? String(existing.repMax) : '',
    },
    rename: null, // { field, name, error }: "Adı düzelt" formu açıkken
    error: '',
    field: null, // hatalı kutu
    notice: '',
    dirty: false,
    saved: false,
    busy: false,
  };

  function render(focus = null) {
    const { form, busy } = state;
    container.innerHTML = `
      <header class="page-head">
        <a class="back" href="#/program/${escapeHtml(dayId)}" data-nav="up">← ${escapeHtml(day.name)}</a>
        <h1>${existing ? 'Satırı düzenle' : 'Yeni satır'}</h1>
      </header>
      <form class="card program-form" data-form="item" novalidate>
        ${exerciseFieldHtml('first', 'Hareket', form.first, form.firstName)}
        ${exerciseFieldHtml('second', 'İkinci hareket (isteğe bağlı)', form.second, form.secondName)}
        <p class="muted field-hint">İkinci hareket seçilirse satır dönüşümlü olur: iki hareket antrenmandan antrenmana sırayla yapılır.
          Makineler antrenman ekranında, hareketin kartından eklenir ve "Düzenle" ile değiştirilir.</p>
        <fieldset class="target-fieldset">
          <legend>Hedef</legend>
          <div class="target-fields">
            ${numberFieldHtml('sets', 'Set', form.sets)}
            ${numberFieldHtml('repMax', 'En çok tekrar', form.repMax)}
          </div>
        </fieldset>
        <p id="item-message" class="message" role="alert">${escapeHtml(state.error)}</p>
        <p id="item-notice" class="status-message" role="status">${escapeHtml(state.notice)}</p>
        <div class="actions">
          <button type="submit" class="button primary"${busy ? ' disabled' : ''}>Kaydet</button>
          <a class="button secondary" href="#/program/${escapeHtml(dayId)}" data-nav="up">Vazgeç</a>
        </div>
      </form>
      ${existing ? `
        <div class="page-actions">
          <button type="button" class="button danger block" data-action="delete-item"${busy ? ' disabled' : ''}>Satırı sil</button>
        </div>` : ''}`;
    if (focus) container.querySelector(focus)?.focus();
  }

  function exerciseFieldHtml(field, label, value, newName) {
    const exercises = Object.entries(state.program.exercises).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'tr'));
    const invalid = state.field === field ? ' aria-invalid="true"' : '';
    const rename = state.rename?.field === field ? state.rename : null;
    return `
      <div class="field exercise-field">
        <label for="${field}">${label}</label>
        <select id="${field}" name="${field}"${invalid}>
          <option value=""${value ? '' : ' selected'}>${field === 'first' ? 'Hareket seçin' : 'Yok'}</option>
          ${exercises.map(([id, exercise]) =>
            `<option value="${escapeHtml(id)}"${id === value ? ' selected' : ''}>${escapeHtml(exercise.name)}</option>`).join('')}
          <option value="${NEW}"${value === NEW ? ' selected' : ''}>+ Yeni hareket</option>
        </select>
        ${value === NEW ? `
          <label class="sub-label" for="${field}-name">Yeni hareketin adı</label>
          <input id="${field}-name" name="${field}Name" type="text" maxlength="60" autocomplete="off"
            value="${escapeHtml(newName)}"${state.field === `${field}Name` ? ' aria-invalid="true"' : ''}>` : ''}
        ${value && value !== NEW ? `<p class="muted machine-summary">${machineSummary(state.program.exercises[value])}</p>` : ''}
        ${value && value !== NEW && !rename ? `
          <button type="button" class="link-button" data-action="open-rename" data-field="${field}">Adı düzelt</button>` : ''}
        ${rename ? `
          <div class="rename-form">
            <label class="sub-label" for="${field}-rename">Yeni ad (her günde değişir; geçmiş kayıtlar eski adla kalır)</label>
            <input id="${field}-rename" data-rename type="text" maxlength="60" autocomplete="off"
              value="${escapeHtml(rename.name)}"${rename.error ? ' aria-invalid="true"' : ''}>
            <p class="message" role="alert">${escapeHtml(rename.error)}</p>
            <div class="actions">
              <button type="button" class="button small" data-action="save-rename"${state.busy ? ' disabled' : ''}>Adı kaydet</button>
              <button type="button" class="button small" data-action="close-rename">Vazgeç</button>
            </div>
          </div>` : ''}
      </div>`;
  }

  function numberFieldHtml(name, label, value) {
    return `
      <div class="field">
        <label for="${name}">${label}</label>
        <input id="${name}" name="${name}" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(value)}"
          ${state.field === name ? ' aria-invalid="true"' : ''}>
      </div>`;
  }

  // Kutulardaki değerler her değişiklikte durumda tutulur: ekran yeniden çizilince kaybolmasın.
  container.addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (event.target.matches('[data-rename]')) state.rename.name = value;
    else if (name in state.form) {
      state.form[name] = value;
      state.dirty = true;
    }
  });

  container.addEventListener('change', (event) => {
    if (event.target.tagName !== 'SELECT') return;
    state.form[event.target.name] = event.target.value;
    state.dirty = true;
    state.rename = null;
    state.error = '';
    state.field = null;
    render(event.target.value === NEW ? `#${event.target.name}-name` : `#${event.target.name}`);
  });

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || state.busy) return;
    const { action, field } = button.dataset;
    if (action === 'open-rename') {
      state.rename = { field, name: state.program.exercises[state.form[field]].name, error: '' };
      state.notice = '';
      render(`#${field}-rename`);
    } else if (action === 'close-rename') {
      const closed = state.rename.field;
      state.rename = null;
      render(`#${closed}`);
    } else if (action === 'save-rename') {
      await saveRename();
    } else if (action === 'delete-item') {
      const title = itemTitle(existing, state.program.exercises);
      if (!confirm(`"${title}" satırı silinsin mi? Geçmiş kayıtlar silinmez.`)) return;
      await save(withoutItem(state.program, dayId, existing.id), 'Satır silindi.');
    }
  });

  container.addEventListener('keydown', (event) => {
    // Ad kutusunda Enter, satır formunu değil adı kaydeder.
    if (event.key === 'Enter' && event.target.matches('[data-rename]')) {
      event.preventDefault();
      if (!state.busy) saveRename();
    }
  });

  container.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const result = buildItem();
    if (result.error) {
      state.error = result.error;
      state.field = result.field;
      render(result.field ? `#${result.field.replace('Name', '-name')}` : null);
      return;
    }
    await save(result.program, 'Satır kaydedildi ✓');
  });

  // "Adı düzelt": hareketin adı hemen kaydedilir (satır formundaki değişiklikler ekranda kalır).
  async function saveRename() {
    const { field, name } = state.rename;
    const exerciseId = state.form[field];
    const error = exerciseNameError(state.program, name, exerciseId);
    if (error) {
      state.rename.error = error;
      render(`#${field}-rename`);
      return;
    }
    const next = renamedExercise(state.program, exerciseId, name);
    state.busy = true;
    try {
      await saveProgram(next);
      state.program = next;
      state.rename = null;
      state.notice = 'Hareketin adı değiştirildi ✓';
    } catch (error) {
      console.warn('Ad kaydedilemedi', error);
      state.rename.error = failed(error);
    }
    state.busy = false;
    render(state.rename ? `#${field}-rename` : `#${field}`);
  }

  // Formdan satır: kutular yukarıdan aşağı denetlenir; "+ Yeni hareket" seçildiyse hareket oluşturulur.
  function buildItem() {
    const { form } = state;
    let next = state.program;
    const options = [];
    for (const field of ['first', 'second']) {
      let exerciseId = form[field];
      if (!exerciseId) {
        if (field === 'first') return { error: 'Bir hareket seçin.', field };
        continue;
      }
      if (exerciseId === NEW) {
        const error = exerciseNameError(next, form[`${field}Name`]);
        if (error) return { error, field: `${field}Name` };
        exerciseId = `ex-${createId()}`;
        next = withExercise(next, exerciseId, form[`${field}Name`]);
      }
      options.push(exerciseId);
    }
    const error = itemOptionsError(next, dayId, existing?.id ?? null, options);
    if (error) return { error, field: 'first' };
    const parsed = parseTarget(form);
    if (parsed.error) return parsed;
    const item = { id: existing?.id ?? `item-${createId()}`, options, ...parsed.target };
    return { program: withItem(next, dayId, item) };
  }

  async function save(next, message) {
    state.busy = true;
    state.error = '';
    state.field = null;
    render();
    try {
      await saveProgram(next);
      state.saved = true;
      navigate(`#/program/${dayId}`, message, 'up');
    } catch (error) {
      console.warn('Program kaydedilemedi', error);
      state.error = failed(error);
      state.busy = false;
      render();
    }
  }

  render();
  const unsaved = () => state.dirty && !state.saved;
  return {
    beforeLeave: () => !unsaved() || confirm('Satırdaki değişiklikler kaydedilmedi. Çıkılsın mı?'),
    hasUnsavedChanges: unsaved,
  };
}

// Satır formunda seçili hareketin (silinmemiş) makineleri.
function machineSummary(exercise) {
  const active = exercise.equipment.filter((option) => !option.archived);
  return active.length
    ? `Makineler: ${active.map((option) => escapeHtml(`${option.name} · ${UNIT_LABELS[option.unit]}`)).join(', ')}`
    : 'Henüz makine yok';
}

// Sıralama düğmeleri: yukarı ve aşağı (başta ve sonda kapalı).
function moveButtons(kind, id, label, index, count, busy) {
  const button = (delta, arrow, text, disabled) => `
    <button type="button" class="button small icon" data-action="move-${kind}" data-id="${escapeHtml(id)}" data-delta="${delta}"
      aria-label="${escapeHtml(label)}: ${text}"${disabled || busy ? ' disabled' : ''}>${arrow}</button>`;
  return `
    <div class="move-buttons">
      ${button(-1, '↑', 'yukarı taşı', index === 0)}
      ${button(1, '↓', 'aşağı taşı', index === count - 1)}
    </div>`;
}

// Taşındıktan sonra odak aynı düğmede kalır; düğme uca gelip kapandıysa diğer yöndekine geçer.
function moveFocus(kind, id, delta, order) {
  const index = order.indexOf(id);
  const atEnd = Number(delta) < 0 ? index === 0 : index === order.length - 1;
  const direction = atEnd ? -Number(delta) : Number(delta);
  return `[data-action="move-${kind}"][data-id="${CSS.escape(id)}"][data-delta="${direction}"]`;
}
