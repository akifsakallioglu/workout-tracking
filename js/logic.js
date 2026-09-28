// Saf fonksiyonlar: aynı girdiye her zaman aynı sonucu verir; ekrana ve veritabanına dokunmaz.

export const UNIT_LABELS = { kg: 'kg', level: 'kademe', none: 'ağırlıksız' };

const WEIGHT_PATTERN = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const REPS_PATTERN = /^\d+$/;
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });

// Boş kutu → null, geçerli değer → sayı, geçersiz değer → NaN. "22,5" ve "22.5" ikisi de 22.5 olur.
export function parseWeight(text) {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  if (!WEIGHT_PATTERN.test(value)) return NaN;
  const number = Number(value.replace(',', '.'));
  return number > 0 ? number : NaN;
}

// Boş kutu → null, pozitif tam sayı → sayı, geçersiz değer → NaN.
export function parseReps(text) {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  if (!REPS_PATTERN.test(value)) return NaN;
  const number = Number(value);
  return number > 0 ? number : NaN;
}

// Kutulara yazılanları setlere çevirir; boş satırlar atlanır. Önceki değerler (ipuçları) bu
// fonksiyona hiç gelmez, bu yüzden bugünkü setleri dolduramaz.
export function collectSets(rows, unit) {
  const sets = [];
  const problems = [];
  rows.forEach((row, index) => {
    const reps = parseReps(row.reps);
    if (unit === 'none') {
      if (reps === null) return;
      if (Number.isNaN(reps)) problems.push({ row: index, kind: 'invalid' });
      else sets.push({ weight: null, reps });
      return;
    }
    const weight = parseWeight(row.weight);
    if (weight === null && reps === null) return;
    if (Number.isNaN(weight) || Number.isNaN(reps)) problems.push({ row: index, kind: 'invalid' });
    else if (weight === null || reps === null) problems.push({ row: index, kind: 'half' });
    else sets.push({ weight, reps });
  });
  return { sets, problems };
}

// Kaydetmeyi engelleyen bir durum varsa kullanıcıya gösterilecek mesaj; yoksa boş metin.
export function validationMessage(sets, problems) {
  const rowsOf = (kind) => problems.filter((problem) => problem.kind === kind).map((problem) => problem.row + 1);
  const invalid = rowsOf('invalid');
  if (invalid.length) {
    return `Geçersiz değer: ${ordinalList(invalid)} set. Ağırlık için 22,5 gibi, tekrar için 12 gibi bir sayı girin.`;
  }
  const half = rowsOf('half');
  if (half.length) {
    return `Yarım set: ${ordinalList(half)} set. Ağırlığı ve tekrarı birlikte girin ya da satırı boşaltın.`;
  }
  return sets.length ? '' : 'En az bir tam set girin.';
}

function ordinalList(numbers) {
  const parts = numbers.map((number) => `${number}.`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} ve ${parts.at(-1)}`;
}

// Aynı gün + hareket + makinedeki en son kayıt. Bitmemiş antrenmanlar ve seti olmayan girişler
// sayılmaz. before verilirse yalnızca o andan önce başlayan antrenmanlara bakılır.
export function lastPerformance(sessions, { dayId, exerciseId, equipmentId }, before = null) {
  let latest = null;
  for (const session of sessions) {
    if (!session.finishedAt || session.dayId !== dayId) continue;
    if (before && session.startedAt >= before) continue;
    const entry = session.entries.find(
      (candidate) => candidate.exerciseId === exerciseId && candidate.equipmentId === equipmentId && candidate.sets.length > 0,
    );
    if (entry && (!latest || session.startedAt > latest.date)) {
      latest = { sessionId: session.id, date: session.startedAt, unit: entry.unit, sets: entry.sets };
    }
  }
  return latest;
}

// Tek hareketlik, kaydedildiği anda bitmiş bir antrenman. Hareket adı, makine adı, birim ve hedef
// kayda kopyalanır; program sonradan değişse de bu kayıt kendi hedefini taşır.
export function buildSession({ id, now, day, item, exerciseId, exercise, equipment, sets }) {
  return {
    id,
    dayId: day.id,
    dayName: day.name,
    startedAt: now,
    finishedAt: now,
    entries: [
      {
        exerciseId,
        equipmentId: equipment.id,
        name: exercise.name,
        equipmentName: equipment.name,
        unit: equipment.unit,
        options: [...item.options],
        target: { sets: item.sets, repMin: item.repMin, repMax: item.repMax },
        sets,
      },
    ],
  };
}

export function formatWeight(value) {
  return numberFormat.format(value);
}

// kg: "50×12", kademe: "10k×12", ağırlıksız: "15"
export function formatSet({ weight, reps }, unit) {
  if (unit === 'none') return String(reps);
  return `${formatWeight(weight)}${unit === 'level' ? 'k' : ''}×${reps}`;
}

export function formatSets(sets, unit) {
  return sets.map((set) => formatSet(set, unit)).join(' · ');
}

// "3 × 12–15"; alt ve üst sınır aynıysa "4 × 15"
export function formatTarget({ sets, repMin, repMax }) {
  return `${sets} × ${repMin === repMax ? repMin : `${repMin}–${repMax}`}`;
}

// "21 Eyl"; başka bir yıldaysa "21 Eyl 2025"
export function formatDate(iso, now = new Date()) {
  const date = new Date(iso);
  return (date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(date);
}
