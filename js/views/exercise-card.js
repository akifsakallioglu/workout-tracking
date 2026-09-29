// Antrenman kartı: bir program satırı için hareket (dönüşümlü satırda seçim), makine seçimi ve
// ekleme, geçen seferki performans, tek ağırlık kutusu ve her set için tekrar kutusu.
import {
  UNIT_LABELS,
  collectSets,
  counterText,
  formatDate,
  formatSets,
  formatTarget,
  formatWeight,
  itemTitle,
  lastPerformance,
  liveProgressText,
  progressCounter,
  suggestOption,
  suggestionText,
  usedEquipmentIds,
} from '../logic.js';
import { escapeHtml } from '../ui.js';

// context: { day, program, sessions, busy, before, editing }. Geçmiş bir antrenman düzenlenirken
// before o antrenmanın başlangıcıdır: "geçen sefer" ve sayaç ondan önceki kayıtlara göre hesaplanır.
export function cardHtml(card, index, { day, program, sessions, busy, before = null, editing = false }) {
  const exercise = program.exercises[card.exerciseId];
  // Düzenlenen kaydın makinesi sonradan silindiyse (arşivlendiyse) o kart için seçilebilir kalır.
  const machines = exercise.equipment.filter((option) => !option.archived || option.id === card.keepEquipmentId);
  const equipment = machines.find((option) => option.id === card.equipmentId);
  const active = machines.filter((option) => !option.archived);

  return `
    <section class="card" data-card="${index}" aria-labelledby="card-title-${index}">
      <header class="card-head">
        <h2 id="card-title-${index}">${escapeHtml(itemTitle(card.item, program.exercises))}</h2>
        <p class="target">Hedef ${formatTarget(card.item)}</p>
      </header>
      ${card.extra ? `
        <div class="extra-row">
          <p class="muted">Yalnızca bu antrenmana eklendi</p>
          <button type="button" class="button small" data-action="remove-card"
            aria-label="${escapeHtml(itemTitle(card.item, program.exercises))} hareketini bu antrenmandan kaldır"${busy ? ' disabled' : ''}>Kaldır</button>
        </div>` : ''}

      ${card.item.options.length > 1 ? `
        <fieldset class="options">
          <legend>Bugün</legend>
          <div class="chips">
            ${card.item.options.map((exerciseId) =>
              radioChip(`option-${index}`, exerciseId, program.exercises[exerciseId].name, exerciseId === card.exerciseId)).join('')}
          </div>
          ${editing ? '' : `<p class="suggestion">${escapeHtml(suggestionText(suggestOption(sessions, day.id, card.item.options), program.exercises))}</p>`}
        </fieldset>` : ''}

      <fieldset class="machines">
        <legend>Makine</legend>
        ${machines.length ? '' : '<p class="muted no-machine">Bu hareket için henüz makine yok. Kullandığınız makineyi ekleyin.</p>'}
        ${card.editingMachines ? machineListHtml(card, index, exercise, usedEquipmentIds(sessions), busy) : `
          <div class="chips">
            ${machines.map((option) =>
              radioChip(`equipment-${index}`, option.id, machineLabel(option), option.id === equipment?.id)).join('')}
            ${card.machineForm ? '' : '<button type="button" class="chip add" data-action="open-machine-form">+ Makine</button>'}
            ${exercise.equipment.length && !card.machineForm ? '<button type="button" class="chip edit" data-action="edit-machines">Düzenle</button>' : ''}
          </div>`}
      </fieldset>
      ${card.machineForm ? machineFormHtml(card.machineForm, index, busy) : ''}
      ${equipment ? logHtml(card, index, equipment, day, sessions, before) : ''}
      <p class="message card-message" role="alert">${escapeHtml(card.message)}</p>
    </section>`;
}

// Seçili makinede geçen seferki performans, ağırlık kutusu ve tekrar kutuları.
function logHtml(card, index, equipment, day, sessions, before) {
  const { unit } = equipment;
  const key = { dayId: day.id, exerciseId: card.exerciseId, equipmentId: equipment.id };
  const last = lastPerformance(sessions, key, before);
  const weightInvalid = isInvalid(card, 'weight');
  const counter = counterText(progressCounter(sessions, key, before));

  return `
      <p class="last${last ? '' : ' empty'}">${last
        ? `Geçen sefer — ${formatDate(last.date)}: ${escapeHtml(formatSets(last.sets, last.unit))}`
        : 'Bu makinede önceki kayıt yok'}</p>
      ${counter ? `<p class="counter">${counter}</p>` : ''}
      <p class="progress-live" aria-live="polite">${cardLiveText(card, equipment, last)}</p>

      ${unit === 'none' ? '' : `
        <div class="field weight">
          <label for="weight-${index}">${unit === 'level' ? 'Kademe' : 'Ağırlık (kg)'}</label>
          <input id="weight-${index}" type="text" inputmode="decimal" autocomplete="off" data-field="weight"
            value="${escapeHtml(card.weight)}" placeholder="${last ? escapeHtml(formatWeight(last.sets[0].weight)) : ''}"${weightInvalid ? ' aria-invalid="true"' : ''}>
        </div>`}

      <fieldset class="reps">
        <legend>Tekrarlar</legend>
        <div class="rep-grid">
          ${card.reps.map((value, row) => `
            <label class="rep">
              <span>${row + 1}. set</span>
              <input type="text" inputmode="numeric" autocomplete="off" aria-label="${row + 1}. set tekrar"
                data-field="reps" data-row="${row}" value="${escapeHtml(value)}"
                placeholder="${last?.sets[row] ? last.sets[row].reps : ''}"${isInvalid(card, 'reps', row) ? ' aria-invalid="true"' : ''}>
            </label>`).join('')}
        </div>
        <div class="set-buttons">
          <button type="button" class="button small" data-action="add-set">+ Set</button>
          <button type="button" class="button small" data-action="remove-set"${card.reps.length <= 1 ? ' disabled' : ''}>− Set</button>
        </div>
      </fieldset>`;
}

// Set girilirken görünen anlık ilerleme durumu (kutulardaki geçerli değerlere göre).
export function cardLiveText(card, equipment, last) {
  const { sets } = collectSets({ weight: card.weight, reps: card.reps }, equipment.unit);
  return liveProgressText(last?.sets ?? null, sets, equipment.unit);
}

export function machineLabel(option) {
  return `${option.name} · ${UNIT_LABELS[option.unit]}${option.archived ? ' (silinmiş)' : ''}`;
}

// Düzenleme modunda makineler: her birinin yanında "Değiştir" (ad ve birim) ve "Sil"; silinmiş
// (arşivlenmiş) makineler ayrı listede "Geri al" ile. Kaydı olan makinenin birimi kilitlidir.
function machineListHtml(card, index, exercise, used, busy) {
  const active = exercise.equipment.filter((option) => !option.archived);
  const archived = exercise.equipment.filter((option) => option.archived);
  const disabled = busy ? ' disabled' : '';
  return `
    ${active.length ? `
      <ul class="machine-list">
        ${active.map((option) => (card.machineEdit?.equipmentId === option.id
          ? `<li class="editing">${machineEditHtml(card.machineEdit, option, index, used.has(option.id), busy)}</li>`
          : `
            <li>
              <span>${escapeHtml(option.name)} · ${UNIT_LABELS[option.unit]}</span>
              <span class="machine-actions">
                <button type="button" class="button small" data-action="edit-machine" data-equipment="${escapeHtml(option.id)}"
                  aria-label="${escapeHtml(option.name)} makinesini değiştir"${disabled}>Değiştir</button>
                <button type="button" class="button small danger" data-action="delete-machine" data-equipment="${escapeHtml(option.id)}"
                  aria-label="${escapeHtml(option.name)} makinesini sil"${disabled}>Sil</button>
              </span>
            </li>`)).join('')}
      </ul>` : ''}
    ${archived.length ? `
      <p class="form-title archived-title">Silinmiş makineler</p>
      <ul class="machine-list archived">
        ${archived.map((option) => `
          <li>
            <span>${escapeHtml(option.name)} · ${UNIT_LABELS[option.unit]}</span>
            <button type="button" class="button small" data-action="restore-machine" data-equipment="${escapeHtml(option.id)}"
              aria-label="${escapeHtml(option.name)} makinesini geri al"${disabled}>Geri al</button>
          </li>`).join('')}
      </ul>` : ''}
    <button type="button" class="button small" data-action="done-editing">Bitti</button>`;
}

function machineEditHtml({ name, unit, error }, option, index, locked, busy) {
  return `
    <form class="machine-edit" data-form="machine-edit" novalidate>
      <div class="field">
        <label for="machine-edit-name-${index}">Makinenin adı</label>
        <input id="machine-edit-name-${index}" name="editName" type="text" maxlength="40" autocomplete="off" value="${escapeHtml(name)}">
      </div>
      ${locked
        ? `<p class="muted unit-locked">Birim: ${UNIT_LABELS[option.unit]} (bu makinede kayıt olduğu için değiştirilemez)</p>`
        : `
          <fieldset class="units">
            <legend>Birim</legend>
            <div class="chips">
              ${Object.entries(UNIT_LABELS).map(([value, label]) => radioChip(`edit-unit-${index}`, value, label, unit === value)).join('')}
            </div>
          </fieldset>`}
      <p class="message machine-message" role="alert">${escapeHtml(error)}</p>
      <div class="actions">
        <button type="submit" class="button primary"${busy ? ' disabled' : ''}>Kaydet</button>
        <button type="button" class="button secondary" data-action="cancel-machine-edit">Vazgeç</button>
      </div>
    </form>`;
}

// Kartın bir kutusu işaretli mi: ağırlık sorunu ağırlık kutusunu, geçersiz tekrar kendi kutusunu,
// eksik tekrarlar bütün tekrar kutularını işaretler.
export function isInvalid(card, field, row) {
  return card.problems.some((problem) =>
    problem.field === field && (field === 'weight' || problem.kind === 'missing' || problem.row === row));
}

function machineFormHtml({ name, unit, error }, index, busy) {
  return `
    <form class="machine-form" data-form="machine" novalidate>
      <p class="form-title">Yeni makine</p>
      <div class="field">
        <label for="machine-name-${index}">Ad</label>
        <input id="machine-name-${index}" name="name" type="text" maxlength="40" autocomplete="off"
          list="machine-names" placeholder="ör. Kablo 2" value="${escapeHtml(name)}">
      </div>
      <fieldset class="units">
        <legend>Birim</legend>
        <div class="chips">
          ${Object.entries(UNIT_LABELS).map(([value, label]) => radioChip(`unit-${index}`, value, label, unit === value)).join('')}
        </div>
      </fieldset>
      <p class="message machine-message" role="alert">${escapeHtml(error)}</p>
      <div class="actions">
        <button type="submit" class="button primary"${busy ? ' disabled' : ''}>Ekle</button>
        <button type="button" class="button secondary" data-action="close-machine-form">Vazgeç</button>
      </div>
    </form>`;
}

export function radioChip(name, value, label, checked) {
  return `
    <label class="chip">
      <input type="radio" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''}>
      ${escapeHtml(label)}
    </label>`;
}
