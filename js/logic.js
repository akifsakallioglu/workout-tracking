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

// Ağırlık hareket başına bir kez girilir ve tekrarı girilen her sete uygulanır; boş tekrar
// kutuları atlanır. Hiçbir kutusu dolu olmayan hareket "atlandı" sayılır: set de sorun da yoktur.
// Önceki değerler (ipuçları) bu fonksiyona hiç gelmez, bu yüzden bugünkü setleri dolduramaz.
// Sorun varsa set döndürülmez.
export function collectSets({ weight: weightText, reps: repsTexts }, unit) {
  const problems = [];
  const weight = unit === 'none' ? null : parseWeight(weightText);
  if (Number.isNaN(weight)) problems.push({ field: 'weight', kind: 'invalid' });
  const reps = [];
  repsTexts.forEach((text, index) => {
    const value = parseReps(text);
    if (value === null) return;
    if (Number.isNaN(value)) problems.push({ field: 'reps', row: index, kind: 'invalid' });
    else reps.push(value);
  });
  if (unit !== 'none') {
    if (weight === null && reps.length > 0) problems.push({ field: 'weight', kind: 'missing' });
    // Yalnızca ağırlık yazılmışsa sessizce atlanmasın; kullanıcı tekrarları unutmuş olabilir.
    if (typeof weight === 'number' && !Number.isNaN(weight) && reps.length === 0 && !problems.length) {
      problems.push({ field: 'reps', kind: 'missing' });
    }
  }
  const sets = problems.length ? [] : reps.map((count) => ({ weight, reps: count }));
  return { sets, problems };
}

// Kaydetmeyi engelleyen bir sorun varsa kullanıcıya gösterilecek mesaj; yoksa boş metin.
export function validationMessage(problems, unit) {
  const level = unit === 'level';
  if (problems.some((problem) => problem.field === 'weight' && problem.kind === 'invalid')) {
    return level ? 'Kademe geçersiz. 10 gibi bir sayı girin.' : 'Ağırlık geçersiz. 22,5 gibi bir sayı girin.';
  }
  const invalidReps = problems
    .filter((problem) => problem.field === 'reps' && problem.kind === 'invalid')
    .map((problem) => problem.row + 1);
  if (invalidReps.length) return `Geçersiz tekrar: ${ordinalList(invalidReps)} set. 12 gibi bir tam sayı girin.`;
  if (problems.some((problem) => problem.field === 'weight' && problem.kind === 'missing')) {
    return level ? 'Kademeyi girin.' : 'Ağırlığı girin.';
  }
  if (problems.some((problem) => problem.field === 'reps' && problem.kind === 'missing')) {
    return level ? 'Tekrarları girin ya da kademeyi silin.' : 'Tekrarları girin ya da ağırlığı silin.';
  }
  return '';
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

// O gün bu harekette en son kullanılan makine; yoksa (ya da o makine artık listede değilse)
// listedeki ilk makine.
export function defaultEquipmentId(sessions, dayId, exerciseId, exercise) {
  const available = exercise.equipment.filter((equipment) => !equipment.archived);
  let latest = null;
  for (const session of sessions) {
    if (!session.finishedAt || session.dayId !== dayId) continue;
    const entry = session.entries.find((candidate) => candidate.exerciseId === exerciseId && candidate.sets.length > 0);
    if (entry && (!latest || session.startedAt > latest.date)) {
      latest = { date: session.startedAt, equipmentId: entry.equipmentId };
    }
  }
  const used = latest && available.find((equipment) => equipment.id === latest.equipmentId);
  return (used ?? available[0]).id;
}

// Son bitirilen antrenmandan sonraki gün, program sırasına göre (sonuncudan sonra başa döner).
// Hiç antrenman yoksa ya da son günün programda karşılığı yoksa ilk gün.
export function nextDayId(program, sessions) {
  let latest = null;
  for (const session of sessions) {
    if (session.finishedAt && session.entries.length && (!latest || session.startedAt > latest.startedAt)) {
      latest = session;
    }
  }
  const index = latest ? program.days.findIndex((day) => day.id === latest.dayId) : -1;
  return program.days[(index + 1) % program.days.length].id;
}

// Günün en son yapıldığı antrenmanın tarihi; hiç yapılmadıysa null.
export function lastDoneDate(sessions, dayId) {
  let latest = null;
  for (const session of sessions) {
    if (session.finishedAt && session.dayId === dayId && session.entries.length && (!latest || session.startedAt > latest)) {
      latest = session.startedAt;
    }
  }
  return latest;
}

// Dönüşümlü satırın başlığı: "Wrist Curl / Reverse Curl"
export function itemTitle(item, exercises) {
  return item.options.map((exerciseId) => exercises[exerciseId].name).join(' / ');
}

// Bir hareketin kaydı. Hareket adı, makine adı, birim ve hedef kayda kopyalanır; program sonradan
// değişse de bu kayıt kendi hedefini taşır.
export function buildEntry({ item, exerciseId, exercise, equipment, sets }) {
  return {
    exerciseId,
    equipmentId: equipment.id,
    name: exercise.name,
    equipmentName: equipment.name,
    unit: equipment.unit,
    options: [...item.options],
    target: { sets: item.sets, repMin: item.repMin, repMax: item.repMax },
    sets,
  };
}

export function buildSession({ id, startedAt, finishedAt, day, entries }) {
  return { id, dayId: day.id, dayName: day.name, startedAt, finishedAt, entries };
}

// Kayıtlı program, başlangıç programının eski bir sürümündense yükseltilir: günler yeni
// programdan gelir, eksik hareketler ve başlangıç makineleri eklenir; kullanıcının eklediği
// makineler korunur. Sürüm güncelse program olduğu gibi döner.
export function upgradeProgram(stored, seed) {
  if ((stored.seedVersion ?? 1) >= seed.seedVersion) return stored;
  const exercises = { ...stored.exercises };
  for (const [id, exercise] of Object.entries(seed.exercises)) {
    const existing = stored.exercises[id];
    if (!existing) {
      exercises[id] = exercise;
      continue;
    }
    const known = new Set(existing.equipment.map((equipment) => equipment.id));
    exercises[id] = {
      ...existing,
      equipment: [...existing.equipment, ...exercise.equipment.filter((equipment) => !known.has(equipment.id))],
    };
  }
  return { ...stored, seedVersion: seed.seedVersion, exercises, days: seed.days };
}

// Yeni makinenin adı ve birimi için denetim; sorun yoksa boş metin. Birimi kullanıcı seçer:
// aynı salondaki iki kablo makinesinin ikisi de kg olabilir.
export function equipmentError(exercise, name, unit) {
  const trimmed = name.trim();
  if (!trimmed) return 'Makineye bir ad verin.';
  if (trimmed.length > 40) return 'Ad en fazla 40 karakter olabilir.';
  const key = trimmed.toLocaleLowerCase('tr');
  if (exercise.equipment.some((equipment) => equipment.name.trim().toLocaleLowerCase('tr') === key)) {
    return 'Bu adda bir makine zaten var.';
  }
  if (!Object.hasOwn(UNIT_LABELS, unit)) return 'Birimi seçin: kg, kademe ya da ağırlıksız.';
  return '';
}

// Programı değiştirmeden, hareketin makine listesine yeni makinenin eklendiği bir kopyasını döndürür.
export function withEquipment(program, exerciseId, equipment) {
  const exercise = program.exercises[exerciseId];
  return {
    ...program,
    exercises: {
      ...program.exercises,
      [exerciseId]: { ...exercise, equipment: [...exercise.equipment, equipment] },
    },
  };
}

export function formatWeight(value) {
  return numberFormat.format(value);
}

// kg: "50 kg", kademe: "10k"
export function formatWeightWithUnit(value, unit) {
  return unit === 'level' ? `${formatWeight(value)}k` : `${formatWeight(value)} kg`;
}

// Tek set: kg "50×12", kademe "10k×12", ağırlıksız "15"
export function formatSet({ weight, reps }, unit) {
  if (unit === 'none') return String(reps);
  return `${formatWeight(weight)}${unit === 'level' ? 'k' : ''}×${reps}`;
}

// Setlerin ağırlığı aynıysa "50 kg × 12 · 12 · 11" ya da "10k × 12 · 12 · 10"; ağırlıksızda
// "15 · 14". Ağırlıklar farklıysa her set ayrı yazılır: "50×12 · 52,5×10".
export function formatSets(sets, unit) {
  const reps = sets.map((set) => set.reps).join(' · ');
  if (unit === 'none') return reps;
  if (sets.every((set) => set.weight === sets[0].weight)) return `${formatWeightWithUnit(sets[0].weight, unit)} × ${reps}`;
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
