// Antrenman kartı: bir program satırı için hareket (dönüşümlü satırda seçim), makine seçimi ve
// ekleme, geçen seferki performans, tek ağırlık kutusu ve her set için tekrar kutusu.
import {
  UNIT_LABELS,
  formatDate,
  formatSets,
  formatTarget,
  formatWeight,
  itemTitle,
  lastPerformance,
} from '../logic.js';
import { escapeHtml } from '../ui.js';

export function cardHtml(card, index, { day, program, sessions, busy }) {
  const exercise = program.exercises[card.exerciseId];
  const equipment = exercise.equipment.find((option) => option.id === card.equipmentId);
  const { unit } = equipment;
  const last = lastPerformance(sessions, { dayId: day.id, exerciseId: card.exerciseId, equipmentId: equipment.id });
  const weightInvalid = isInvalid(card, 'weight');

  return `
    <section class="card" data-card="${index}" aria-labelledby="card-title-${index}">
      <header class="card-head">
        <h2 id="card-title-${index}">${escapeHtml(itemTitle(card.item, program.exercises))}</h2>
        <p class="target">Hedef ${formatTarget(card.item)}</p>
      </header>

      ${card.item.options.length > 1 ? `
        <fieldset class="options">
          <legend>Bugün</legend>
          <div class="chips">
            ${card.item.options.map((exerciseId) =>
              radioChip(`option-${index}`, exerciseId, program.exercises[exerciseId].name, exerciseId === card.exerciseId)).join('')}
          </div>
        </fieldset>` : ''}

      <fieldset class="machines">
        <legend>Makine</legend>
        <div class="chips">
          ${exercise.equipment.filter((option) => !option.archived).map((option) =>
            radioChip(`equipment-${index}`, option.id, `${option.name} · ${UNIT_LABELS[option.unit]}`, option.id === equipment.id)).join('')}
          ${card.machineForm ? '' : '<button type="button" class="chip add" data-action="open-machine-form">+ Makine</button>'}
        </div>
      </fieldset>
      ${card.machineForm ? machineFormHtml(card.machineForm, index, busy) : ''}

      <p class="last${last ? '' : ' empty'}">${last
        ? `Geçen sefer — ${formatDate(last.date)}: ${escapeHtml(formatSets(last.sets, last.unit))}`
        : 'Bu makinede önceki kayıt yok'}</p>

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
      </fieldset>

      <p class="message card-message" role="alert">${escapeHtml(card.message)}</p>
    </section>`;
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

function radioChip(name, value, label, checked) {
  return `
    <label class="chip">
      <input type="radio" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''}>
      ${escapeHtml(label)}
    </label>`;
}
