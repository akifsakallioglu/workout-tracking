// Saf fonksiyonlar: aynı girdiye her zaman aynı sonucu verir; ekrana ve veritabanına dokunmaz.

export const UNIT_LABELS = { kg: 'kg', level: 'kademe', none: 'ağırlıksız' };

const WEIGHT_PATTERN = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const REPS_PATTERN = /^\d+$/;
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

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
// listedeki ilk makine. Hareketin hiç makinesi yoksa null.
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
  return (used ?? available[0])?.id ?? null;
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

// Devam eden (bitmemiş) antrenman; birden çok varsa en son başlayanı. Yoksa null.
export function activeSession(sessions) {
  let latest = null;
  for (const session of sessions) {
    if (!session.finishedAt && (!latest || session.startedAt > latest.startedAt)) latest = session;
  }
  return latest;
}

// Kartlardaki değerleri denetler ve sorunsuz kartlardan kayıt girişleri üretir. Makinesi olmayan
// ya da boş kart atlanır. Kart: { item, exerciseId, equipmentId, weight, reps }.
export function evaluateCards(cards, exercises) {
  const entries = [];
  let hasProblems = false;
  const results = cards.map((card) => {
    const exercise = exercises[card.exerciseId];
    const equipment = exercise?.equipment.find((option) => option.id === card.equipmentId && !option.archived);
    if (!equipment) return { problems: [], message: '' };
    const { sets, problems } = collectSets({ weight: card.weight, reps: card.reps }, equipment.unit);
    if (problems.length) hasProblems = true;
    else if (sets.length) entries.push(buildEntry({ item: card.item, exerciseId: card.exerciseId, exercise, equipment, sets }));
    return { problems, message: validationMessage(problems, equipment.unit) };
  });
  return { results, entries, hasProblems };
}

// Kayıtlarda kullanılmış makinelerin kimlikleri.
export function usedEquipmentIds(sessions) {
  return new Set(sessions.flatMap((session) => session.entries.map((entry) => entry.equipmentId)));
}

// Kayıtlı program, başlangıç programının eski bir sürümündense yükseltilir: günler yeni
// programdan gelir, eksik hareketler eklenir, kullanıcının eklediği makineler ("eq-" ile başlar)
// korunur. 3. sürümden önceki başlangıç programı her harekete varsayılan bir makine koyuyordu;
// bunlar kaldırılır, kaydı olanlar ise silinmeden arşivlenir. Sürüm güncelse program olduğu gibi döner.
export function upgradeProgram(stored, seed, used = new Set()) {
  const version = stored.seedVersion ?? 1;
  if (version >= seed.seedVersion) return stored;
  const withoutDefaults = (equipment) => {
    if (version >= 3 || equipment.id.startsWith('eq-')) return [equipment];
    return used.has(equipment.id) ? [{ ...equipment, archived: true }] : [];
  };
  const exercises = { ...stored.exercises };
  for (const [id, exercise] of Object.entries(seed.exercises)) {
    const existing = stored.exercises[id];
    exercises[id] = existing ? { ...existing, equipment: existing.equipment.flatMap(withoutDefaults) } : exercise;
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
  const active = exercise.equipment.filter((equipment) => !equipment.archived);
  if (active.some((equipment) => equipment.name.trim().toLocaleLowerCase('tr') === key)) {
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

// Makineyi siler: kaydı olmayan makine listeden tamamen kalkar; kaydı olan makine, eski kayıtlar
// bozulmasın diye arşivlenir (seçim listesinden kalkar). Programın kopyasını döndürür.
export function withoutEquipment(program, exerciseId, equipmentId, used) {
  const exercise = program.exercises[exerciseId];
  const equipment = used.has(equipmentId)
    ? exercise.equipment.map((option) => (option.id === equipmentId ? { ...option, archived: true } : option))
    : exercise.equipment.filter((option) => option.id !== equipmentId);
  return { ...program, exercises: { ...program.exercises, [exerciseId]: { ...exercise, equipment } } };
}

// Makinenin kullanıldığı bitmiş antrenman sayısı.
export function equipmentUseCount(sessions, equipmentId) {
  return sessions.filter(
    (session) => session.finishedAt && session.entries.some((entry) => entry.equipmentId === equipmentId && entry.sets.length),
  ).length;
}

// ---------------------------------------------------------------- İlerleme

// Bugünkü setler bir önceki kayıtla set set karşılaştırılır (1. set 1. setle...); yalnızca ikisinde
// de bulunan setlere bakılır. Ağırlığı (kademesi) daha yüksek ya da ağırlığı aynı ve tekrarı daha
// yüksek bir set varsa ilerleme vardır. Ağırlıksız makinede yalnızca tekrara bakılır.
export function hasProgress(previousSets, currentSets, unit) {
  const count = Math.min(previousSets.length, currentSets.length);
  for (let index = 0; index < count; index++) {
    const before = previousSets[index];
    const now = currentSets[index];
    if (unit === 'none' || now.weight === before.weight) {
      if (now.reps > before.reps) return true;
    } else if (now.weight > before.weight) {
      return true;
    }
  }
  return false;
}

// Aynı gün + hareket + makinede son ilerlemeden sonra gelen bitmiş antrenman sayısı. Hiç ilerleme
// yoksa ilk kayıt başlangıç noktasıdır (sinceFirst). Kayıt yoksa null. Seti girilmemiş (atlanmış)
// hareket ve bitmemiş antrenman sayılmaz; başka makine ya da gün sayacı etkilemez.
export function progressCounter(sessions, { dayId, exerciseId, equipmentId }) {
  const entries = sessions
    .filter((session) => session.finishedAt && session.dayId === dayId)
    .map((session) => ({
      startedAt: session.startedAt,
      entry: session.entries.find(
        (candidate) => candidate.exerciseId === exerciseId && candidate.equipmentId === equipmentId && candidate.sets.length > 0,
      ),
    }))
    .filter(({ entry }) => entry)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    .map(({ entry }) => entry);
  if (!entries.length) return null;
  let lastProgress = 0;
  for (let index = 1; index < entries.length; index++) {
    if (hasProgress(entries[index - 1].sets, entries[index].sets, entries[index].unit)) lastProgress = index;
  }
  return { count: entries.length - 1 - lastProgress, sinceFirst: lastProgress === 0 };
}

// Kartta "Geçen sefer" satırının altındaki sayaç metni; gösterilecek bir şey yoksa boş metin.
export function counterText(counter) {
  if (!counter) return '';
  if (counter.sinceFirst) return counter.count ? `İlk kayıttan beri ${counter.count} antrenman` : '';
  return counter.count ? `Son ilerlemeden beri ${counter.count} antrenman` : 'Geçen antrenmanda ilerledin';
}

// Set girilirken görünen anlık durum: bir önceki kayda göre artış varsa ya da ilk kayıtsa.
export function liveProgressText(previousSets, currentSets, unit) {
  if (!currentSets.length) return '';
  if (!previousSets) return 'İlk kayıt: başlangıç noktası';
  return hasProgress(previousSets, currentSets, unit) ? 'Bu antrenmanda ilerledin ✓' : '';
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

// "29 Eyl 18:05"
export function formatDateTime(iso, now = new Date()) {
  return `${formatDate(iso, now)} ${timeFormat.format(new Date(iso))}`;
}

// ---------------------------------------------------------------- Yedek

export const BACKUP_APP = 'antrenman-takibi';
export const BACKUP_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// Yedek: programın ve devam eden dahil bütün antrenmanların eksiksiz kopyası.
export function buildBackup(program, sessions, exportedAt) {
  return { app: BACKUP_APP, backupVersion: BACKUP_VERSION, exportedAt, program, sessions };
}

// "antrenman-yedegi-2026-09-29.json" (yerel tarih)
export function backupFileName(now = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  return `antrenman-yedegi-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// Yedek dosyasının metnini okur ve denetler: sorun yoksa { backup }, varsa { error }.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'Dosya okunamadı: JSON biçiminde bir yedek değil.' };
  }
  const error = backupError(data);
  return error ? { error } : { backup: data };
}

// Yedek hatırlatması: son yedekten (hiç yedek yoksa ilk bitirilen antrenmandan) bu yana 30 günden
// fazla geçtiyse { days, never }; yoksa null.
export function backupReminder(lastBackupAt, sessions, now = new Date()) {
  const starts = sessions.filter((session) => session.finishedAt).map((session) => session.startedAt);
  if (!starts.length) return null;
  const since = lastBackupAt ?? starts.reduce((first, start) => (start < first ? start : first));
  const days = Math.floor((now - new Date(since)) / DAY_MS);
  return days > 30 ? { days, never: !lastBackupAt } : null;
}

function backupError(data) {
  if (!isObject(data) || data.app !== BACKUP_APP) return 'Bu dosya bir Antrenman Takibi yedeği değil.';
  if (!Number.isInteger(data.backupVersion) || data.backupVersion < 1) return 'Bu dosya bir Antrenman Takibi yedeği değil.';
  if (data.backupVersion > BACKUP_VERSION) return 'Bu yedek uygulamanın daha yeni bir sürümüyle alınmış.';
  if (!isDate(data.exportedAt)) return corrupt('yedek tarihi okunamadı');

  const { program, sessions } = data;
  if (!isObject(program) || !isObject(program.exercises) || !Array.isArray(program.days)) return corrupt('program okunamadı');
  for (const [id, exercise] of Object.entries(program.exercises)) {
    if (!isObject(exercise) || !isText(exercise.name) || !Array.isArray(exercise.equipment)) {
      return corrupt(`"${id}" hareketi okunamadı`);
    }
    if (!exercise.equipment.every(isEquipment)) return corrupt(`${exercise.name} hareketinin makinesi okunamadı`);
  }
  for (const day of program.days) {
    if (!isObject(day) || !isText(day.id) || !isText(day.name) || !Array.isArray(day.items)) return corrupt('bir gün okunamadı');
    const validItem = (item) =>
      isItem(item) && item.options.every((option) => Object.hasOwn(program.exercises, option));
    if (!day.items.every(validItem)) return corrupt(`${day.name} gününde bir satır okunamadı`);
  }

  if (!Array.isArray(sessions)) return corrupt('antrenmanlar okunamadı');
  const ids = new Set();
  for (const [index, session] of sessions.entries()) {
    if (!isSession(session) || ids.has(session.id)) return corrupt(`${index + 1}. antrenman okunamadı`);
    ids.add(session.id);
  }
  return '';
}

const corrupt = (detail) => `Yedek dosyası bozuk: ${detail}.`;
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.length > 0;
const isDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isCount = (value) => Number.isInteger(value) && value > 0;
const isUnit = (value) => Object.hasOwn(UNIT_LABELS, value);
const isTarget = (target) =>
  isObject(target) && isCount(target.sets) && isCount(target.repMin) && isCount(target.repMax) && target.repMax >= target.repMin;
const isItem = (item) =>
  isTarget(item) && isText(item.id) && Array.isArray(item.options) && item.options.length > 0 && item.options.every(isText);
const isEquipment = (equipment) =>
  isObject(equipment) && isText(equipment.id) && isText(equipment.name) && isUnit(equipment.unit);
const isSet = (set) => isObject(set) && isCount(set.reps) && (set.weight === null || (typeof set.weight === 'number' && set.weight > 0));
const isEntry = (entry) =>
  isObject(entry) &&
  isText(entry.exerciseId) &&
  isText(entry.equipmentId) &&
  isText(entry.name) &&
  isText(entry.equipmentName) &&
  isUnit(entry.unit) &&
  isTarget(entry.target) &&
  Array.isArray(entry.sets) &&
  entry.sets.every(isSet);
const isDraftCard = (card) =>
  isObject(card) &&
  isItem(card.item) &&
  isText(card.exerciseId) &&
  (card.equipmentId === null || isText(card.equipmentId)) &&
  typeof card.weight === 'string' &&
  Array.isArray(card.reps) &&
  card.reps.every((value) => typeof value === 'string');
const isSession = (session) =>
  isObject(session) &&
  isText(session.id) &&
  isText(session.dayId) &&
  isText(session.dayName) &&
  isDate(session.startedAt) &&
  (session.finishedAt === null || isDate(session.finishedAt)) &&
  Array.isArray(session.entries) &&
  session.entries.every(isEntry) &&
  (session.draft === undefined || (isObject(session.draft) && Array.isArray(session.draft.cards) && session.draft.cards.every(isDraftCard)));
