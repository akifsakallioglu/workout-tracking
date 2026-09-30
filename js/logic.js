// Saf fonksiyonlar: aynı girdiye her zaman aynı sonucu verir; ekrana ve veritabanına dokunmaz.

export const UNIT_LABELS = { kg: 'kg', level: 'kademe', none: 'ağırlıksız' };

const WEIGHT_PATTERN = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const REPS_PATTERN = /^\d+$/;
const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });
const monthYearFormat = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const dayNumberFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric' });

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

// Dönüşümlü satırda öneri: aynı günün bitmiş antrenmanlarında bu satırın hareketlerinden en son
// yapılanın (seti girilmiş) bir sonrakisi; liste bitince başa döner, hiç kayıt yoksa ilk hareket.
// Atlanan hareket "yapıldı" sayılmadığı için sırayı ilerletmez; öneri elle değiştirildiyse gerçekte
// yapılan hareket esas alınır. Sonuç: { exerciseId, last: { exerciseId, date } | null }
export function suggestOption(sessions, dayId, options) {
  let last = null;
  for (const session of sessions) {
    if (!session.finishedAt || session.dayId !== dayId) continue;
    const entry = session.entries.find((candidate) => options.includes(candidate.exerciseId) && candidate.sets.length > 0);
    if (entry && (!last || session.startedAt > last.date)) last = { exerciseId: entry.exerciseId, date: session.startedAt };
  }
  const exerciseId = last ? options[(options.indexOf(last.exerciseId) + 1) % options.length] : options[0];
  return { exerciseId, last };
}

// "Son yapılan: Wrist Curl · 22 Eyl · Sıradaki: Reverse Curl"; hiç kayıt yoksa
// "Henüz kayıt yok · Sıradaki: Wrist Curl"
export function suggestionText({ exerciseId, last }, exercises, now = new Date()) {
  const next = `Sıradaki: ${exercises[exerciseId].name}`;
  if (!last) return `Henüz kayıt yok · ${next}`;
  return `Son yapılan: ${exercises[last.exerciseId].name} · ${formatDate(last.date, now)} · ${next}`;
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
// ya da boş kart atlanır. Kart: { item, exerciseId, equipmentId, weight, reps, keepEquipmentId? };
// keepEquipmentId, geçmiş bir kayıt düzenlenirken sonradan silinmiş (arşivlenmiş) makinesidir.
export function evaluateCards(cards, exercises) {
  const entries = [];
  let hasProblems = false;
  const results = cards.map((card) => {
    const exercise = exercises[card.exerciseId];
    const equipment = exercise?.equipment.find(
      (option) => option.id === card.equipmentId && (!option.archived || option.id === card.keepEquipmentId),
    );
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
  // Kullanıcı programı düzenlediyse (customized) günler onun hâlinde kalır.
  return { ...stored, seedVersion: seed.seedVersion, exercises, days: stored.customized ? stored.days : seed.days };
}

// Yeni makinenin adı ve birimi için denetim; sorun yoksa boş metin. Birimi kullanıcı seçer:
// aynı salondaki iki kablo makinesinin ikisi de kg olabilir.
export function equipmentError(exercise, name, unit, equipmentId = null) {
  const trimmed = name.trim();
  if (!trimmed) return 'Makineye bir ad verin.';
  if (trimmed.length > 40) return 'Ad en fazla 40 karakter olabilir.';
  const key = trimmed.toLocaleLowerCase('tr');
  // Değiştirilen makinenin kendi adı sayılmaz.
  const active = exercise.equipment.filter((equipment) => !equipment.archived && equipment.id !== equipmentId);
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
const mapEquipment = (program, exerciseId, equipmentId, change) => {
  const exercise = program.exercises[exerciseId];
  const equipment = exercise.equipment.map((option) => (option.id === equipmentId ? change(option) : option));
  return { ...program, exercises: { ...program.exercises, [exerciseId]: { ...exercise, equipment } } };
};

// Makinenin adı ve birimi değişir. Kimlik aynı kaldığı için geçmiş kopmaz; eski kayıtlar
// antrenmandaki adı gösterir. Kaydı olan makinenin birimini ekran değiştirtmez.
export function changedEquipment(program, exerciseId, equipmentId, { name, unit }) {
  return mapEquipment(program, exerciseId, equipmentId, (option) => ({ ...option, name: name.trim(), unit }));
}

// Silinmiş (arşivlenmiş) makine geri alınır; aynı adda etkin bir makine varsa önce o yeniden adlandırılmalı.
export function restoreError(exercise, equipmentId) {
  const equipment = exercise.equipment.find((option) => option.id === equipmentId);
  const taken = exercise.equipment.some(
    (option) => !option.archived && option.name.trim().toLocaleLowerCase('tr') === equipment.name.trim().toLocaleLowerCase('tr'),
  );
  return taken ? `"${equipment.name}" adında etkin bir makine var. Geri almadan önce onun adını değiştirin.` : '';
}

export function restoredEquipment(program, exerciseId, equipmentId) {
  return mapEquipment(program, exerciseId, equipmentId, ({ archived, ...option }) => option);
}

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
// hareket ve bitmemiş antrenman sayılmaz; başka makine ya da gün sayacı etkilemez. before verilirse
// yalnızca o andan önce başlayan antrenmanlara bakılır (geçmiş bir antrenmanı düzenlerken).
export function progressCounter(sessions, { dayId, exerciseId, equipmentId }, before = null) {
  const entries = sessions
    .filter((session) => session.finishedAt && session.dayId === dayId && (!before || session.startedAt < before))
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

// Kartta "Geçen sefer" satırının altındaki sayaç metni: son ilerlemenin kaç antrenman önce olduğu.
// Son antrenmanda ilerlendiyse "Geçen antrenmanda ilerledin"; hiç ilerleme yoksa "Henüz ilerleme
// yok". Tek kayıt varken (karşılaştırılacak bir şey yokken) boş metin.
export function counterText(counter) {
  if (!counter) return '';
  if (counter.sinceFirst) return counter.count ? 'Henüz ilerleme yok' : '';
  const ago = counter.count + 1;
  return ago === 1 ? 'Geçen antrenmanda ilerledin' : `Son ilerleme ${ago} antrenman önce`;
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

// "3 × 15": set sayısı × en çok tekrar. En az tekrar kullanılmaz; başlangıç programındaki aralıklarda
// (10–12) da yalnızca en çok tekrar gösterilir.
export function formatTarget({ sets, repMax }) {
  return `${sets} × ${repMax}`;
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

export function formatTime(iso) {
  return timeFormat.format(new Date(iso));
}

// "29 Eyl Sal"; başka bir yıldaysa "29 Eyl 2025 Pzt"
export function formatDay(iso, now = new Date()) {
  const date = new Date(iso);
  return `${formatDate(iso, now)} ${weekdayFormat.format(date)}`;
}

// "52 dk", "1 sa 5 dk", "2 sa"
export function formatDuration(startIso, endIso) {
  const minutes = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60_000));
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} sa ${minutes % 60} dk` : `${hours} sa`;
}

// "6 hareket · 18 set"
export function sessionSummary(session) {
  const sets = session.entries.reduce((total, entry) => total + entry.sets.length, 0);
  return `${session.entries.length} hareket · ${sets} set`;
}

// Bitmiş antrenmanlar, en yeniden eskiye.
export function finishedSessions(sessions) {
  return sessions.filter((session) => session.finishedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// Geçmiş listesi için aylara göre gruplar: [{ month: "Eylül 2026", sessions }]. Antrenmanlar en
// yeniden eskiye sıralı gelir, sıra korunur. Ay, antrenmanın başladığı yerel tarihe göredir.
export function sessionsByMonth(sessions) {
  const groups = [];
  for (const session of sessions) {
    const month = monthYearFormat.format(new Date(session.startedAt));
    const last = groups[groups.length - 1];
    if (last?.month === month) last.sessions.push(session);
    else groups.push({ month, sessions: [session] });
  }
  return groups;
}

// Tarih rozeti: gün sayısı ve kısa gün adı ({ day: "29", weekday: "Sal" }); ay ve yıl ay başlığındadır.
export function dateBadge(iso) {
  const date = new Date(iso);
  return { day: dayNumberFormat.format(date), weekday: weekdayFormat.format(date) };
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
  if (!program.days.length) return corrupt('programda gün yok');
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

// ---------------------------------------------------------------- Grafikler

// Birime göre seçilebilen ölçüler; ilki varsayılan.
export const METRICS = {
  kg: [
    { id: 'e1rm', label: 'Tahmini 1TM' },
    { id: 'max', label: 'En ağır' },
    { id: 'volume', label: 'Hacim' },
  ],
  level: [
    { id: 'max', label: 'En yüksek kademe' },
    { id: 'reps', label: 'Toplam tekrar' },
  ],
  none: [
    { id: 'reps', label: 'Toplam tekrar' },
    { id: 'maxReps', label: 'En çok tekrar' },
  ],
};

// Tahmini tek tekrar maksimumu (Epley): ağırlık × (1 + tekrar / 30); tek tekrarda ağırlığın kendisi.
export function e1rm(weight, reps) {
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

// Bir antrenmandaki setlerden ölçünün değeri (bir ondalık basamağa yuvarlanır).
export function metricValue(sets, metricId) {
  const values = {
    e1rm: () => Math.max(...sets.map((set) => e1rm(set.weight, set.reps))),
    max: () => Math.max(...sets.map((set) => set.weight)),
    volume: () => sets.reduce((total, set) => total + set.weight * set.reps, 0),
    reps: () => sets.reduce((total, set) => total + set.reps, 0),
    maxReps: () => Math.max(...sets.map((set) => set.reps)),
  };
  return Math.round(values[metricId]() * 10) / 10;
}

// Ölçünün birimiyle yazılışı: "56 kg", "1.305 kg", "11k", "45"
export function formatMetric(value, metricId, unit) {
  return metricId === 'reps' || metricId === 'maxReps' ? formatWeight(value) : formatWeightWithUnit(value, unit);
}

// Aynı gün + hareket + makinedeki bitmiş antrenmanlar, eskiden yeniye: grafiğin noktaları.
export function exerciseSeries(sessions, { dayId, exerciseId, equipmentId }, metricId) {
  return sessions
    .filter((session) => session.finishedAt && session.dayId === dayId)
    .map((session) => ({
      session,
      entry: session.entries.find(
        (candidate) => candidate.exerciseId === exerciseId && candidate.equipmentId === equipmentId && candidate.sets.length > 0,
      ),
    }))
    .filter(({ entry }) => entry)
    .sort((a, b) => (a.session.startedAt < b.session.startedAt ? -1 : 1))
    .map(({ session, entry }) => ({
      sessionId: session.id,
      date: session.startedAt,
      value: metricValue(entry.sets, metricId),
      sets: entry.sets,
      unit: entry.unit,
    }));
}

// Bir günde bir hareketin kaydı olan makineleri: en son kullanılan önce. Makine programdan
// silinmişse (arşivlenmişse ya da tamamen kalkmışsa) adı kayıttan gelir.
export function machinesWithRecords(sessions, program, dayId, exerciseId) {
  const machines = new Map();
  for (const session of sessions) {
    if (!session.finishedAt || session.dayId !== dayId) continue;
    for (const entry of session.entries) {
      if (entry.exerciseId !== exerciseId || !entry.sets.length) continue;
      const known = machines.get(entry.equipmentId);
      if (!known || session.startedAt > known.lastDate) {
        const equipment = program.exercises[exerciseId]?.equipment.find((option) => option.id === entry.equipmentId);
        machines.set(entry.equipmentId, {
          equipmentId: entry.equipmentId,
          name: equipment?.name ?? entry.equipmentName,
          unit: entry.unit,
          archived: !equipment || Boolean(equipment.archived),
          lastDate: session.startedAt,
        });
      }
    }
  }
  return [...machines.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
}

// İlerleme listesi: program günlerine göre gruplanmış, kaydı olan hareketler (programdaki sırayla).
// Programdan çıkarılmış ya da günü silinmiş kayıtlar "other" grubunda.
export function progressIndex(program, sessions) {
  const records = new Map(); // "gün|hareket" → { dayId, dayName, exerciseId, name, count, lastDate }
  for (const session of sessions) {
    if (!session.finishedAt) continue;
    for (const entry of session.entries) {
      if (!entry.sets.length) continue;
      const key = `${session.dayId}|${entry.exerciseId}`;
      const record = records.get(key) ?? {
        dayId: session.dayId,
        dayName: session.dayName,
        exerciseId: entry.exerciseId,
        name: program.exercises[entry.exerciseId]?.name ?? entry.name,
        count: 0,
        lastDate: session.startedAt,
      };
      record.count++;
      if (session.startedAt > record.lastDate) record.lastDate = session.startedAt;
      records.set(key, record);
    }
  }
  const listed = new Set();
  const days = program.days.map((day) => {
    const exerciseIds = [...new Set(day.items.flatMap((item) => item.options))];
    const exercises = exerciseIds.map((exerciseId) => records.get(`${day.id}|${exerciseId}`)).filter(Boolean);
    exercises.forEach((record) => listed.add(`${record.dayId}|${record.exerciseId}`));
    return { id: day.id, name: day.name, exercises };
  });
  const other = [...records.entries()]
    .filter(([key]) => !listed.has(key))
    .map(([, record]) => record)
    .sort((a, b) => a.dayName.localeCompare(b.dayName, 'tr') || a.name.localeCompare(b.name, 'tr'));
  return { days, other };
}

// ---------------------------------------------------------------- Program düzenleyici

// Programı değiştiren her işlem yeni bir program döndürür ve onu "düzenlendi" (customized) olarak
// işaretler: başlangıç programı sonradan yükseltilse de kullanıcının günleri korunur.
const customized = (program, changes) => ({ ...program, ...changes, customized: true });
const sameName = (a, b) => a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');
const MAX_SETS = 10;
const MAX_REPS = 100;

export function dayNameError(program, name, dayId = null) {
  const trimmed = name.trim();
  if (!trimmed) return 'Güne bir ad verin.';
  if (trimmed.length > 30) return 'Gün adı en fazla 30 karakter olabilir.';
  if (program.days.some((day) => day.id !== dayId && sameName(day.name, trimmed))) return 'Bu adda bir gün zaten var.';
  return '';
}

export function exerciseNameError(program, name, exerciseId = null) {
  const trimmed = name.trim();
  if (!trimmed) return 'Harekete bir ad verin.';
  if (trimmed.length > 60) return 'Hareket adı en fazla 60 karakter olabilir.';
  const taken = Object.entries(program.exercises).some(([id, exercise]) => id !== exerciseId && sameName(exercise.name, trimmed));
  return taken ? 'Bu adda bir hareket zaten var.' : '';
}

// Hedef kutuları: set 1–10, en çok tekrar 1–100. En az tekrar formlarda yoktur; veride en çok
// tekrara eşit tutulur (kayıt biçimi ve eski yedekler değişmesin).
export function parseTarget({ sets, repMax }) {
  const count = (text, max) => {
    const value = parseReps(text);
    return value !== null && value <= max ? value : NaN;
  };
  const target = { sets: count(sets, MAX_SETS), repMax: count(repMax, MAX_REPS) };
  if (Number.isNaN(target.sets)) return { error: `Set sayısı 1 ile ${MAX_SETS} arasında bir tam sayı olmalı.`, field: 'sets' };
  if (Number.isNaN(target.repMax)) return { error: `En çok tekrar 1 ile ${MAX_REPS} arasında bir tam sayı olmalı.`, field: 'repMax' };
  return { target: { sets: target.sets, repMin: target.repMax, repMax: target.repMax } };
}

// Satırın hareketleri: aynı hareket iki kez seçilemez ve bir hareket bir günde yalnızca bir satırda
// olur (geçmişin anahtarı gün + hareket + makine; iki satır aynı kaydı paylaşmasın).
export function itemOptionsError(program, dayId, itemId, options) {
  if (new Set(options).size !== options.length) return 'İki hareket aynı olamaz.';
  const day = program.days.find((candidate) => candidate.id === dayId);
  for (const item of day.items) {
    if (item.id === itemId) continue;
    const duplicate = item.options.find((option) => options.includes(option));
    if (duplicate) return `${program.exercises[duplicate].name} bu günde zaten var.`;
  }
  return '';
}

const mapDays = (program, dayId, change) =>
  customized(program, { days: program.days.map((day) => (day.id === dayId ? change(day) : day)) });

function moved(list, index, delta) {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

// Yeni gün programın sonuna eklenir.
export function withDay(program, id, name) {
  return customized(program, { days: [...program.days, { id, name: name.trim(), items: [] }] });
}

export function renamedDay(program, dayId, name) {
  return mapDays(program, dayId, (day) => ({ ...day, name: name.trim() }));
}

// Gün silinir; o güne ait geçmiş kayıtlar durur (İlerleme'de "Programda olmayan" altında).
export function withoutDay(program, dayId) {
  return customized(program, { days: program.days.filter((day) => day.id !== dayId) });
}

// Günlerin sırası "Sıradaki" gününün sırasıdır. delta: -1 yukarı, +1 aşağı.
export function movedDay(program, dayId, delta) {
  const index = program.days.findIndex((day) => day.id === dayId);
  return customized(program, { days: moved(program.days, index, delta) });
}

// Satır aynı kimlikle varsa yerinde değişir, yoksa günün sonuna eklenir.
export function withItem(program, dayId, item) {
  return mapDays(program, dayId, (day) => ({
    ...day,
    items: day.items.some((candidate) => candidate.id === item.id)
      ? day.items.map((candidate) => (candidate.id === item.id ? item : candidate))
      : [...day.items, item],
  }));
}

export function withoutItem(program, dayId, itemId) {
  return mapDays(program, dayId, (day) => ({ ...day, items: day.items.filter((item) => item.id !== itemId) }));
}

export function movedItem(program, dayId, itemId, delta) {
  return mapDays(program, dayId, (day) => ({
    ...day,
    items: moved(day.items, day.items.findIndex((item) => item.id === itemId), delta),
  }));
}

// Yeni hareket makinesiz başlar; makineleri kullanıcı antrenman kartında ekler. Katalog değişikliği
// günleri değiştirmediği için program "düzenlendi" (customized) sayılmaz.
export function withExercise(program, exerciseId, name) {
  return { ...program, exercises: { ...program.exercises, [exerciseId]: { name: name.trim(), equipment: [] } } };
}

// "Adı düzelt": ad her günde değişir. Kimlik aynı kaldığı için geçmiş kopmaz; eski kayıtlar
// antrenman sırasında kopyalanan adı gösterir.
export function renamedExercise(program, exerciseId, name) {
  const exercise = program.exercises[exerciseId];
  return { ...program, exercises: { ...program.exercises, [exerciseId]: { ...exercise, name: name.trim() } } };
}

// "Programı sıfırla": günler, satırlar, hedefler ve başlangıç hareketlerinin adları başlangıç
// programına döner. Makineler, kullanıcının eklediği hareketler ve geçmiş kayıtlar korunur.
export function resetProgram(program, seed) {
  const exercises = { ...program.exercises };
  for (const [id, exercise] of Object.entries(seed.exercises)) {
    exercises[id] = exercises[id] ? { ...exercises[id], name: exercise.name } : structuredClone(exercise);
  }
  const { customized: _, ...rest } = program;
  return { ...rest, exercises, days: structuredClone(seed.days) };
}

// Hareketin programdaki ilk satırının hedefi; programda yoksa null. "+ Hareket ekle" formunu doldurur.
export function programTarget(program, exerciseId) {
  for (const day of program.days) {
    const item = day.items.find((candidate) => candidate.options.includes(exerciseId));
    if (item) return { sets: item.sets, repMax: item.repMax };
  }
  return null;
}
