import { assert, assertEqual, test } from './harness.js';
import { lineChart, niceTicks } from '../js/chart.js';
import {
  activeSession,
  backupFileName,
  backupReminder,
  buildBackup,
  buildEntry,
  buildSession,
  METRICS,
  changedEquipment,
  collectSets,
  counterText,
  dayNameError,
  defaultEquipmentId,
  equipmentError,
  equipmentUseCount,
  e1rm,
  evaluateCards,
  exerciseNameError,
  exerciseSeries,
  formatDateTime,
  formatDay,
  formatDuration,
  formatMetric,
  finishedSessions,
  formatSet,
  formatSets,
  formatTarget,
  hasProgress,
  itemOptionsError,
  itemTitle,
  lastDoneDate,
  lastPerformance,
  liveProgressText,
  machinesWithRecords,
  metricValue,
  movedDay,
  movedItem,
  nextDayId,
  parseBackup,
  parseTarget,
  parseReps,
  parseWeight,
  progressCounter,
  progressIndex,
  programTarget,
  renamedDay,
  renamedExercise,
  resetProgram,
  restoreError,
  restoredEquipment,
  sessionSummary,
  suggestOption,
  suggestionText,
  upgradeProgram,
  usedEquipmentIds,
  validationMessage,
  withDay,
  withEquipment,
  withExercise,
  withItem,
  withoutDay,
  withoutEquipment,
  withoutItem,
} from '../js/logic.js';
import { program as seed } from '../js/seed.js';

const KEY = { dayId: 'push', exerciseId: 'rope-pushdown', equipmentId: 'kablo' };

function session({
  id,
  date,
  dayId = 'push',
  exerciseId = 'rope-pushdown',
  equipmentId = 'kablo',
  unit = 'kg',
  sets = [{ weight: 50, reps: 12 }],
  finished = true,
}) {
  return {
    id,
    dayId,
    dayName: dayId,
    startedAt: date,
    finishedAt: finished ? date : null,
    entries: [
      {
        exerciseId,
        equipmentId,
        name: exerciseId,
        equipmentName: equipmentId,
        unit,
        options: [exerciseId],
        target: { sets: 3, repMin: 12, repMax: 15 },
        sets,
      },
    ],
  };
}

// ---------------------------------------------------------------- Başlangıç programı

test('başlangıç programı: satır sayıları, sıra ve hedefler yapıştırılan programla aynı', () => {
  const counts = Object.fromEntries(seed.days.map((day) => [day.name, day.items.length]));
  assertEqual(counts, { Push: 6, Pull: 8, Legs: 8, Upper: 6, Lower: 6 });
  const push = seed.days[0].items.map((item) => `${itemTitle(item, seed.exercises)} ${formatTarget(item)}`);
  assertEqual(push, [
    'Machine Chest Press 3 × 12',
    'Cable Fly 3 × 15',
    'Seated Lateral Raise 4 × 15',
    'Machine Shoulder Press 3 × 12',
    'Rope Pushdown 3 × 15',
    'Overhead Rope Extension 2 × 15',
  ]);
  const upper = seed.days.find((day) => day.id === 'upper');
  assertEqual(formatTarget(upper.items.at(-1)), '3 × 15', 'Upper’daki Overhead Rope Extension');
  const pull = seed.days.find((day) => day.id === 'pull');
  assertEqual(itemTitle(pull.items.at(-1), seed.exercises), 'Wrist Curl / Reverse Curl');
});

test('başlangıç programı: hareketler makinesiz başlıyor; satırlar var olan hareketlere bağlı', () => {
  const exercises = Object.entries(seed.exercises);
  assertEqual(exercises.length, 34);
  for (const [id, exercise] of exercises) assertEqual(exercise.equipment, [], id);
  for (const day of seed.days) {
    for (const item of day.items) {
      for (const option of item.options) assert(seed.exercises[option], `${day.id}: ${option} katalogda yok`);
    }
  }
});

// ---------------------------------------------------------------- Geçen sefer ve günler

test('aynı gün, hareket ve makinede en yeni kaydı buluyor', () => {
  const sessions = [
    session({ id: 'eski', date: '2026-09-15T12:00:00.000Z', sets: [{ weight: 45, reps: 12 }] }),
    session({ id: 'yeni', date: '2026-09-22T12:00:00.000Z', sets: [{ weight: 50, reps: 12 }] }),
    session({ id: 'orta', date: '2026-09-18T12:00:00.000Z', sets: [{ weight: 47.5, reps: 12 }] }),
  ];
  const last = lastPerformance(sessions, KEY);
  assertEqual(last.sessionId, 'yeni');
  assertEqual(last.sets, [{ weight: 50, reps: 12 }]);
});

test('diğer makinenin kaydını getirmiyor', () => {
  const sessions = [
    session({ id: 'kablo', date: '2026-09-15T12:00:00.000Z' }),
    session({ id: 'kablo-2', date: '2026-09-22T12:00:00.000Z', equipmentId: 'kablo-2', unit: 'level', sets: [{ weight: 10, reps: 12 }] }),
  ];
  assertEqual(lastPerformance(sessions, KEY).sessionId, 'kablo');
});

test('Legs ve Lower kayıtları birbirine karışmıyor', () => {
  const calf = { exerciseId: 'standing-calf-raise', equipmentId: 'makine' };
  const sessions = [
    session({ id: 'legs', date: '2026-09-15T12:00:00.000Z', dayId: 'legs', ...calf, sets: [{ weight: 60, reps: 15 }] }),
    session({ id: 'lower', date: '2026-09-22T12:00:00.000Z', dayId: 'lower', ...calf, sets: [{ weight: 40, reps: 15 }] }),
  ];
  assertEqual(lastPerformance(sessions, { dayId: 'legs', ...calf }).sessionId, 'legs');
  assertEqual(lastPerformance(sessions, { dayId: 'lower', ...calf }).sessionId, 'lower');
});

test('kayıt yoksa null döndürüyor; bitmemiş antrenman sayılmıyor', () => {
  assertEqual(lastPerformance([], KEY), null);
  const sessions = [
    session({ id: 'bitti', date: '2026-09-15T12:00:00.000Z' }),
    session({ id: 'devam', date: '2026-09-22T12:00:00.000Z', finished: false }),
  ];
  assertEqual(lastPerformance(sessions, KEY).sessionId, 'bitti');
});

test('sıradaki gün: son bitirilen günden sonraki gün, sonuncudan sonra başa dönüyor', () => {
  assertEqual(nextDayId(seed, []), 'push');
  assertEqual(nextDayId(seed, [session({ id: 'a', date: '2026-09-15T12:00:00.000Z', dayId: 'push' })]), 'pull');
  assertEqual(
    nextDayId(seed, [
      session({ id: 'a', date: '2026-09-15T12:00:00.000Z', dayId: 'lower' }),
      session({ id: 'b', date: '2026-09-10T12:00:00.000Z', dayId: 'legs' }),
    ]),
    'push',
  );
  assertEqual(nextDayId(seed, [session({ id: 'a', date: '2026-09-15T12:00:00.000Z', dayId: 'silinmis-gun' })]), 'push');
  assertEqual(
    nextDayId(seed, [
      session({ id: 'a', date: '2026-09-15T12:00:00.000Z', dayId: 'push' }),
      session({ id: 'b', date: '2026-09-16T12:00:00.000Z', dayId: 'pull', finished: false }),
    ]),
    'pull',
    'bitmemiş antrenman sırayı ilerletmez',
  );
});

test('günün en son yapıldığı tarih', () => {
  const sessions = [
    session({ id: 'a', date: '2026-09-15T12:00:00.000Z', dayId: 'push' }),
    session({ id: 'b', date: '2026-09-22T12:00:00.000Z', dayId: 'push' }),
    session({ id: 'c', date: '2026-09-25T12:00:00.000Z', dayId: 'pull' }),
  ];
  assertEqual(lastDoneDate(sessions, 'push'), '2026-09-22T12:00:00.000Z');
  assertEqual(lastDoneDate(sessions, 'legs'), null);
});

test('o gün en son kullanılan makine seçili gelir; başka gün ve listede olmayan makine sayılmaz', () => {
  const exercise = {
    name: 'Standing Calf Raise',
    equipment: [{ id: 'makine', name: 'Makine', unit: 'kg' }, { id: 'calf-2', name: 'Calf 2', unit: 'kg' }],
  };
  const calf = (id, date, dayId, equipmentId) => session({ id, date, dayId, exerciseId: 'standing-calf-raise', equipmentId });
  assertEqual(defaultEquipmentId([], 'legs', 'standing-calf-raise', exercise), 'makine');
  const sessions = [
    calf('a', '2026-09-15T12:00:00.000Z', 'legs', 'calf-2'),
    calf('b', '2026-09-22T12:00:00.000Z', 'lower', 'makine'),
  ];
  assertEqual(defaultEquipmentId(sessions, 'legs', 'standing-calf-raise', exercise), 'calf-2');
  assertEqual(defaultEquipmentId(sessions, 'lower', 'standing-calf-raise', exercise), 'makine');
  const removed = [calf('c', '2026-09-29T12:00:00.000Z', 'legs', 'eski-makine')];
  assertEqual(defaultEquipmentId(removed, 'legs', 'standing-calf-raise', exercise), 'makine');
  const noMachine = { name: 'Leg Press', equipment: [] };
  assertEqual(defaultEquipmentId([], 'legs', 'leg-press', noMachine), null, 'makinesi olmayan hareket');
  const archivedOnly = { name: 'Leg Press', equipment: [{ id: 'a', name: 'Makine', unit: 'kg', archived: true }] };
  assertEqual(defaultEquipmentId([], 'legs', 'leg-press', archivedOnly), null, 'arşivlenmiş makine seçilmez');
});

test('devam eden antrenman: bitmemiş antrenmanların en son başlayanı', () => {
  assertEqual(activeSession([]), null);
  const sessions = [
    session({ id: 'bitti', date: '2026-09-25T12:00:00.000Z' }),
    session({ id: 'eski-devam', date: '2026-09-20T12:00:00.000Z', finished: false }),
    session({ id: 'devam', date: '2026-09-22T12:00:00.000Z', finished: false }),
  ];
  assertEqual(activeSession(sessions).id, 'devam');
  assertEqual(activeSession([sessions[0]]), null);
});

test('tarih ve saat biçimi: "29 Eyl 18:05"', () => {
  const text = formatDateTime('2026-09-29T15:05:00.000Z', new Date('2026-10-01T00:00:00.000Z'));
  assert(/^29 Eyl \d{2}:05$/.test(text), text);
});

// ---------------------------------------------------------------- Set girişi

test('kartlar denetleniyor: sorunsuz kartlar kayda dönüşüyor, boş ve makinesiz kartlar atlanıyor', () => {
  const exercises = {
    'rope-pushdown': { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg' }] },
    'face-pull': { name: 'Face Pull', equipment: [] },
    'cable-fly': { name: 'Cable Fly', equipment: [{ id: 'k3', name: 'Kablo 3', unit: 'kg' }] },
  };
  const item = (id, sets) => ({ id: `push-${id}`, options: [id], sets, repMin: 12, repMax: 15 });
  const cards = [
    { item: item('rope-pushdown', 3), exerciseId: 'rope-pushdown', equipmentId: 'k1', weight: '50', reps: ['12', '11', ''] },
    { item: item('face-pull', 2), exerciseId: 'face-pull', equipmentId: null, weight: '', reps: ['', ''] },
    { item: item('cable-fly', 3), exerciseId: 'cable-fly', equipmentId: 'k3', weight: '', reps: ['', '', ''] },
  ];
  const valid = evaluateCards(cards, exercises);
  assertEqual(valid.hasProblems, false);
  assertEqual(valid.entries.map((entry) => [entry.name, entry.equipmentName, entry.sets.length]), [['Rope Pushdown', 'Kablo', 2]]);
  assertEqual(valid.entries[0].target, { sets: 3, repMin: 12, repMax: 15 });
  cards[2].weight = '30';
  const invalid = evaluateCards(cards, exercises);
  assertEqual(invalid.hasProblems, true);
  assertEqual(invalid.results[2].message, 'Tekrarları girin ya da ağırlığı silin.');
  assertEqual(invalid.results[1], { problems: [], message: '' });
});

test('ağırlık bir kez girilir ve tekrarı girilen her sete uygulanır', () => {
  assertEqual(collectSets({ weight: '35', reps: ['12', '12', '11'] }, 'kg'), {
    sets: [{ weight: 35, reps: 12 }, { weight: 35, reps: 12 }, { weight: 35, reps: 11 }],
    problems: [],
  });
  assertEqual(collectSets({ weight: '10', reps: ['12', '', ''] }, 'level').sets, [{ weight: 10, reps: 12 }]);
});

test('boş kart atlanır: set de sorun da yok', () => {
  assertEqual(collectSets({ weight: '', reps: ['', '', ''] }, 'kg'), { sets: [], problems: [] });
  assertEqual(collectSets({ weight: '', reps: ['', ''] }, 'none'), { sets: [], problems: [] });
});

test('eksik değerler uyarı veriyor; ağırlıksızda tekrar yeter', () => {
  const noWeight = collectSets({ weight: '', reps: ['12', '12', ''] }, 'kg');
  assertEqual(noWeight, { sets: [], problems: [{ field: 'weight', kind: 'missing' }] });
  assertEqual(validationMessage(noWeight.problems, 'kg'), 'Ağırlığı girin.');
  assertEqual(validationMessage(noWeight.problems, 'level'), 'Kademeyi girin.');
  const noReps = collectSets({ weight: '35', reps: ['', '', ''] }, 'kg');
  assertEqual(noReps, { sets: [], problems: [{ field: 'reps', kind: 'missing' }] });
  assertEqual(validationMessage(noReps.problems, 'kg'), 'Tekrarları girin ya da ağırlığı silin.');
  assertEqual(validationMessage([], 'kg'), '');
  assertEqual(collectSets({ weight: '', reps: ['15', '14'] }, 'none').sets, [
    { weight: null, reps: 15 },
    { weight: null, reps: 14 },
  ]);
});

test('"22,5" ve "22.5" 22.5 oluyor; geçersiz değerler reddediliyor', () => {
  assertEqual(parseWeight('22,5'), 22.5);
  assertEqual(parseWeight('22.5'), 22.5);
  assertEqual(parseWeight(' 50 '), 50);
  assertEqual(parseWeight(''), null);
  for (const text of ['abc', '-5', '0', '1,2,3', '22,5kg']) {
    assert(Number.isNaN(parseWeight(text)), `"${text}" reddedilmeliydi`);
  }
  assertEqual(parseReps('12'), 12);
  for (const text of ['12,5', '0', 'on']) {
    assert(Number.isNaN(parseReps(text)), `"${text}" reddedilmeliydi`);
  }
  assertEqual(collectSets({ weight: 'abc', reps: ['12'] }, 'kg').problems, [{ field: 'weight', kind: 'invalid' }]);
  const badReps = collectSets({ weight: '35', reps: ['12', '12,5', 'on'] }, 'kg');
  assertEqual(badReps.problems, [
    { field: 'reps', row: 1, kind: 'invalid' },
    { field: 'reps', row: 2, kind: 'invalid' },
  ]);
  assertEqual(validationMessage(badReps.problems, 'kg'), 'Geçersiz tekrar: 2. ve 3. set. 12 gibi bir tam sayı girin.');
});

test('setler birime göre yazılıyor', () => {
  const same = (weight, ...reps) => reps.map((count) => ({ weight, reps: count }));
  assertEqual(formatSets(same(50, 12, 12, 11), 'kg'), '50 kg × 12 · 12 · 11');
  assertEqual(formatSets(same(52.5, 10), 'kg'), '52,5 kg × 10');
  assertEqual(formatSets(same(10, 12, 12, 10), 'level'), '10k × 12 · 12 · 10');
  assertEqual(formatSets(same(null, 15, 14), 'none'), '15 · 14');
  assertEqual(formatSets([{ weight: 50, reps: 12 }, { weight: 52.5, reps: 10 }], 'kg'), '50×12 · 52,5×10');
  assertEqual(formatSet({ weight: 10, reps: 12 }, 'level'), '10k×12');
  assertEqual(formatTarget({ sets: 3, repMin: 12, repMax: 15 }), '3 × 15', 'eski aralıklarda en çok tekrar');
  assertEqual(formatTarget({ sets: 4, repMin: 15, repMax: 15 }), '4 × 15');
});

// ---------------------------------------------------------------- Makineler ve program

test('makinenin adını ve birimini kullanıcı seçer; boş ad, aynı ad ve seçilmemiş birim reddedilir', () => {
  const exercise = { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg' }] };
  assertEqual(equipmentError(exercise, '   ', 'kg'), 'Makineye bir ad verin.');
  assertEqual(equipmentError(exercise, ' KABLO ', 'level'), 'Bu adda bir makine zaten var.');
  assertEqual(equipmentError(exercise, 'Kablo 2', ''), 'Birimi seçin: kg, kademe ya da ağırlıksız.');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'toString'), 'Birimi seçin: kg, kademe ya da ağırlıksız.');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'kg'), '', 'ikinci kablo da kg olabilir');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'level'), '');
  const archived = { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg', archived: true }] };
  assertEqual(equipmentError(archived, 'Kablo', 'kg'), '', 'arşivlenmiş makinenin adı yeniden kullanılabilir');
});

test('yeni makine programın kopyasına eklenir; eski program değişmez', () => {
  const program = {
    exercises: { 'rope-pushdown': { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg' }] } },
    days: [],
  };
  const next = withEquipment(program, 'rope-pushdown', { id: 'k2', name: 'Kablo 2', unit: 'kg' });
  assertEqual(next.exercises['rope-pushdown'].equipment.map((equipment) => equipment.name), ['Kablo', 'Kablo 2']);
  assertEqual(program.exercises['rope-pushdown'].equipment.length, 1);
});

test('Aşama 1 programı yükseltiliyor: günler geliyor, kullanıcının makinesi kalıyor, varsayılan makine gidiyor', () => {
  const phase1 = {
    exercises: {
      'rope-pushdown': {
        name: 'Rope Pushdown',
        equipment: [
          { id: 'rope-pushdown-kablo', name: 'Kablo', unit: 'kg' },
          { id: 'eq-x', name: 'Kablo 2', unit: 'level' },
        ],
      },
    },
    days: [{ id: 'push', name: 'Push', items: [{ id: 'push-rope-pushdown', options: ['rope-pushdown'], sets: 3, repMin: 12, repMax: 15 }] }],
  };
  const upgraded = upgradeProgram(phase1, seed, new Set(['eq-x']));
  assertEqual(upgraded.seedVersion, seed.seedVersion);
  assertEqual(upgraded.days.map((day) => day.items.length), [6, 8, 8, 6, 6]);
  assertEqual(Object.keys(upgraded.exercises).length, 34);
  assertEqual(upgraded.exercises['rope-pushdown'].equipment, [{ id: 'eq-x', name: 'Kablo 2', unit: 'level' }]);
  assertEqual(upgraded.exercises['leg-press'].equipment, []);
  assert(upgradeProgram(upgraded, seed) === upgraded, 'güncel program olduğu gibi dönmeli');
});

test('Aşama 2 programı yükseltiliyor: kaydı olan varsayılan makine arşivleniyor, kaydı olmayan siliniyor', () => {
  const phase2 = {
    seedVersion: 2,
    exercises: {
      'machine-chest-press': { name: 'Machine Chest Press', equipment: [{ id: 'machine-chest-press-makine', name: 'Makine', unit: 'kg' }] },
      'cable-fly': {
        name: 'Cable Fly',
        equipment: [
          { id: 'cable-fly-kablo', name: 'Kablo', unit: 'kg' },
          { id: 'eq-kablo-3', name: 'Kablo 3', unit: 'kg' },
        ],
      },
    },
    days: [],
  };
  const upgraded = upgradeProgram(phase2, seed, new Set(['machine-chest-press-makine', 'eq-kablo-3']));
  assertEqual(upgraded.exercises['machine-chest-press'].equipment, [
    { id: 'machine-chest-press-makine', name: 'Makine', unit: 'kg', archived: true },
  ]);
  assertEqual(upgraded.exercises['cable-fly'].equipment, [{ id: 'eq-kablo-3', name: 'Kablo 3', unit: 'kg' }]);
  assertEqual(upgraded.days.length, 5);
});

test('kayıt; gün, hareket, makine, birim ve hedefin kopyasını taşıyor', () => {
  const item = { id: 'push-rope-pushdown', options: ['rope-pushdown'], sets: 3, repMin: 12, repMax: 15 };
  const entry = buildEntry({
    item,
    exerciseId: 'rope-pushdown',
    exercise: { name: 'Rope Pushdown' },
    equipment: { id: 'kablo-2', name: 'Kablo 2', unit: 'level' },
    sets: [{ weight: 10, reps: 12 }],
  });
  const saved = buildSession({
    id: 'a1',
    startedAt: '2026-09-29T17:00:00.000Z',
    finishedAt: '2026-09-29T18:00:00.000Z',
    day: { id: 'push', name: 'Push' },
    entries: [entry],
  });
  assertEqual([saved.dayId, saved.dayName, saved.startedAt, saved.finishedAt], [
    'push',
    'Push',
    '2026-09-29T17:00:00.000Z',
    '2026-09-29T18:00:00.000Z',
  ]);
  assertEqual(
    [entry.exerciseId, entry.equipmentId, entry.name, entry.equipmentName, entry.unit],
    ['rope-pushdown', 'kablo-2', 'Rope Pushdown', 'Kablo 2', 'level'],
  );
  assertEqual(entry.target, { sets: 3, repMin: 12, repMax: 15 });
  item.repMax = 20; // program sonradan değişse de kayıttaki hedef değişmez
  assertEqual(entry.target.repMax, 15);
});

// ---------------------------------------------------------------- Yedek

function sampleBackup() {
  const program = structuredClone(seed);
  program.exercises['rope-pushdown'].equipment.push({ id: 'eq-1', name: 'Kablo', unit: 'kg' });
  const finished = session({ id: 'bitti', date: '2026-09-22T12:00:00.000Z', equipmentId: 'eq-1' });
  const active = {
    ...session({ id: 'devam', date: '2026-09-29T12:00:00.000Z', finished: false }),
    entries: [],
    draft: {
      cards: [{ item: seed.days[0].items[4], exerciseId: 'rope-pushdown', equipmentId: 'eq-1', weight: '50', reps: ['12', '', ''] }],
    },
  };
  return buildBackup(program, [finished, active], '2026-09-29T18:00:00.000Z');
}

test('yedek JSON’a yazılıp geri okununca aynen geliyor', () => {
  const backup = sampleBackup();
  const { backup: parsed, error } = parseBackup(JSON.stringify(backup));
  assertEqual(error, undefined);
  assertEqual(parsed, backup);
  assertEqual([parsed.app, parsed.backupVersion], ['antrenman-takibi', 1]);
});

test('bozuk ya da yabancı yedek reddediliyor', () => {
  const broken = (change) => {
    const backup = sampleBackup();
    change(backup);
    return parseBackup(JSON.stringify(backup)).error;
  };
  assertEqual(parseBackup('bu bir yedek değil').error, 'Dosya okunamadı: JSON biçiminde bir yedek değil.');
  assertEqual(parseBackup('{"app":"baska-uygulama"}').error, 'Bu dosya bir Antrenman Takibi yedeği değil.');
  assertEqual(broken((backup) => { backup.backupVersion = 99; }), 'Bu yedek uygulamanın daha yeni bir sürümüyle alınmış.');
  assertEqual(broken((backup) => { delete backup.sessions; }), 'Yedek dosyası bozuk: antrenmanlar okunamadı.');
  assertEqual(
    broken((backup) => { backup.program.exercises['rope-pushdown'].equipment[0].unit = 'lb'; }),
    'Yedek dosyası bozuk: Rope Pushdown hareketinin makinesi okunamadı.',
  );
  assertEqual(
    broken((backup) => { backup.program.days[0].items[0].options = ['olmayan-hareket']; }),
    'Yedek dosyası bozuk: Push gününde bir satır okunamadı.',
  );
  assertEqual(broken((backup) => { backup.sessions[0].startedAt = 'dün'; }), 'Yedek dosyası bozuk: 1. antrenman okunamadı.');
  assertEqual(broken((backup) => { backup.sessions[1].id = 'bitti'; }), 'Yedek dosyası bozuk: 2. antrenman okunamadı.');
  assertEqual(broken((backup) => { backup.sessions[0].entries[0].sets[0].reps = 1.5; }), 'Yedek dosyası bozuk: 1. antrenman okunamadı.');
  assertEqual(broken((backup) => { backup.sessions[1].draft.cards[0].reps = [12]; }), 'Yedek dosyası bozuk: 2. antrenman okunamadı.');
});

test('yedek dosyasının adı yerel tarihi taşıyor', () => {
  assertEqual(backupFileName(new Date(2026, 8, 29, 23, 30)), 'antrenman-yedegi-2026-09-29.json');
});

test('yedek hatırlatması: son yedekten ya da ilk antrenmandan bu yana 30 günden fazla geçince', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  const finishedOn = (date) => session({ id: date, date });
  assertEqual(backupReminder(undefined, [], now), null, 'kayıt yoksa hatırlatma yok');
  assertEqual(backupReminder(undefined, [finishedOn('2026-09-19T12:00:00.000Z')], now), null);
  assertEqual(backupReminder(undefined, [finishedOn('2026-08-20T12:00:00.000Z')], now), { days: 40, never: true });
  assertEqual(backupReminder('2026-08-29T12:00:00.000Z', [finishedOn('2026-08-20T12:00:00.000Z')], now), { days: 31, never: false });
  assertEqual(backupReminder('2026-09-24T12:00:00.000Z', [finishedOn('2026-08-20T12:00:00.000Z')], now), null);
  const unfinished = session({ id: 'devam', date: '2026-08-01T12:00:00.000Z', finished: false });
  assertEqual(backupReminder(undefined, [unfinished], now), null, 'bitmemiş antrenman sayılmaz');
});

// ---------------------------------------------------------------- Makine silme

test('kaydı olmayan makine tamamen siliniyor, kaydı olan arşivleniyor', () => {
  const program = {
    exercises: {
      'rope-pushdown': {
        name: 'Rope Pushdown',
        equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg' }, { id: 'k2', name: 'Kablo 2', unit: 'level' }],
      },
    },
    days: [],
  };
  const sessions = [session({ id: 'a', date: '2026-09-22T12:00:00.000Z', equipmentId: 'k1' })];
  const used = usedEquipmentIds(sessions);
  assertEqual(equipmentUseCount(sessions, 'k1'), 1);
  assertEqual(equipmentUseCount(sessions, 'k2'), 0);
  const withoutUnused = withoutEquipment(program, 'rope-pushdown', 'k2', used);
  assertEqual(withoutUnused.exercises['rope-pushdown'].equipment, [{ id: 'k1', name: 'Kablo', unit: 'kg' }]);
  const withoutUsed = withoutEquipment(program, 'rope-pushdown', 'k1', used);
  assertEqual(withoutUsed.exercises['rope-pushdown'].equipment[0], { id: 'k1', name: 'Kablo', unit: 'kg', archived: true });
  assertEqual(program.exercises['rope-pushdown'].equipment.length, 2, 'eski program değişmemeli');
});

// ---------------------------------------------------------------- İlerleme sayacı

const sets = (text) => text.split(', ').map((set) => {
  const [weight, reps] = set.includes('×') ? set.split('×') : [null, set];
  return { weight: weight === null ? null : Number(weight.replace('k', '')), reps: Number(reps) };
});

test('ilerleme örnekleri (plandaki tablo)', () => {
  const cases = [
    ['40×12, 40×11, 40×10', '40×12, 40×12, 40×10', 'kg', true],
    ['40×12, 40×12, 40×12', '45×9, 45×8, 45×8', 'kg', true],
    ['40×12, 40×11, 40×10', '40×12, 40×11, 40×10', 'kg', false],
    ['40×12, 40×11', '40×11, 40×12', 'kg', true],
    ['40×12, 40×11, 40×10', '35×12, 35×12, 35×12', 'kg', false],
    ['10k×12', '11k×8', 'level', true],
    ['15, 14', '15, 15', 'none', true],
  ];
  for (const [before, now, unit, expected] of cases) {
    assertEqual(hasProgress(sets(before), sets(now), unit), expected, `${before} → ${now}`);
  }
  assertEqual(liveProgressText(null, sets('40×12, 40×11, 40×10'), 'kg'), 'İlk kayıt: başlangıç noktası');
  assertEqual(liveProgressText(sets('40×12, 40×11'), sets('40×12, 40×12'), 'kg'), 'Bu antrenmanda ilerledin ✓');
  assertEqual(liveProgressText(sets('40×12, 40×11'), sets('40×12, 40×11'), 'kg'), '');
  assertEqual(liveProgressText(sets('40×12'), [], 'kg'), '');
});

function calfSession(id, date, text, { dayId = 'legs', equipmentId = 'makine', finished = true } = {}) {
  return session({ id, date, dayId, exerciseId: 'standing-calf-raise', equipmentId, sets: sets(text), finished });
}

const CALF = { dayId: 'legs', exerciseId: 'standing-calf-raise', equipmentId: 'makine' };

test('sayaç: son ilerlemeden sonraki antrenman sayısı; ilerleme yoksa ilk kayıttan', () => {
  assertEqual(progressCounter([], CALF), null);
  const first = [calfSession('1', '2026-09-01T12:00:00.000Z', '40×12, 40×11')];
  assertEqual(progressCounter(first, CALF), { count: 0, sinceFirst: true });
  const flat = [...first, calfSession('2', '2026-09-08T12:00:00.000Z', '40×12, 40×11'), calfSession('3', '2026-09-15T12:00:00.000Z', '40×11, 40×11')];
  assertEqual(progressCounter(flat, CALF), { count: 2, sinceFirst: true });
  const progressed = [...flat, calfSession('4', '2026-09-22T12:00:00.000Z', '40×12, 40×12')];
  assertEqual(progressCounter(progressed, CALF), { count: 0, sinceFirst: false });
  const after = [...progressed, calfSession('5', '2026-09-29T12:00:00.000Z', '40×12, 40×12')];
  assertEqual(progressCounter(after, CALF), { count: 1, sinceFirst: false });
});

test('sayaç: başka makine, başka gün, atlanan hareket ve bitmemiş antrenman etkilemez', () => {
  const base = [
    calfSession('1', '2026-09-01T12:00:00.000Z', '40×12'),
    calfSession('2', '2026-09-08T12:00:00.000Z', '40×12'),
  ];
  const noise = [
    calfSession('b', '2026-09-10T12:00:00.000Z', '60×15', { equipmentId: 'makine-b' }),
    calfSession('lower', '2026-09-11T12:00:00.000Z', '80×15', { dayId: 'lower' }),
    session({ id: 'atlandi', date: '2026-09-12T12:00:00.000Z', dayId: 'legs', exerciseId: 'leg-press' }),
    calfSession('devam', '2026-09-13T12:00:00.000Z', '90×20', { finished: false }),
  ];
  assertEqual(progressCounter([...base, ...noise], CALF), progressCounter(base, CALF));
  assertEqual(progressCounter([...base, ...noise], CALF), { count: 1, sinceFirst: true });
  assertEqual(progressCounter(noise, { ...CALF, equipmentId: 'makine-b' }), { count: 0, sinceFirst: true });
});

test('sayaç metni', () => {
  assertEqual(counterText(null), '');
  assertEqual(counterText({ count: 0, sinceFirst: true }), '');
  assertEqual(counterText({ count: 1, sinceFirst: true }), 'Henüz ilerleme yok');
  assertEqual(counterText({ count: 3, sinceFirst: true }), 'Henüz ilerleme yok');
  assertEqual(counterText({ count: 0, sinceFirst: false }), 'Geçen antrenmanda ilerledin');
  assertEqual(counterText({ count: 1, sinceFirst: false }), 'Son ilerleme 2 antrenman önce');
  assertEqual(counterText({ count: 4, sinceFirst: false }), 'Son ilerleme 5 antrenman önce');
});

// ---------------------------------------------------------------- Dönüşümlü hareket önerisi

const WRIST = ['wrist-curl', 'reverse-curl'];

function pullSession(id, date, exerciseId, { finished = true, dayId = 'pull', sets: setList = [{ weight: 10, reps: 15 }] } = {}) {
  return session({ id, date, dayId, exerciseId, equipmentId: `${exerciseId}-makine`, sets: setList, finished });
}

test('dönüşüm: hiç kayıt yokken ilk hareket, Wrist Curl yapıldıysa Reverse Curl önerilir', () => {
  assertEqual(suggestOption([], 'pull', WRIST), { exerciseId: 'wrist-curl', last: null });
  const done = [pullSession('1', '2026-09-22T12:00:00.000Z', 'wrist-curl')];
  assertEqual(suggestOption(done, 'pull', WRIST), {
    exerciseId: 'reverse-curl',
    last: { exerciseId: 'wrist-curl', date: '2026-09-22T12:00:00.000Z' },
  });
  const both = [...done, pullSession('2', '2026-09-25T12:00:00.000Z', 'reverse-curl')];
  assertEqual(suggestOption(both, 'pull', WRIST).exerciseId, 'wrist-curl', 'liste bitince başa döner');
});

test('dönüşüm: atlanan hareket sırayı değiştirmez; elle değiştirilince yapılan hareket esas alınır', () => {
  const wristDone = pullSession('1', '2026-09-15T12:00:00.000Z', 'wrist-curl');
  // Öneri Reverse Curl'dü ama hareket atlandı: o antrenmanda bu satırdan seti girilmiş hareket yok.
  const skipped = session({ id: '2', date: '2026-09-22T12:00:00.000Z', dayId: 'pull', exerciseId: 'lat-pulldown-wide-grip' });
  assertEqual(suggestOption([wristDone, skipped], 'pull', WRIST).exerciseId, 'reverse-curl');
  // Öneri Reverse Curl'ken elle Wrist Curl seçilip yapıldı.
  const manual = pullSession('3', '2026-09-29T12:00:00.000Z', 'wrist-curl');
  assertEqual(suggestOption([wristDone, skipped, manual], 'pull', WRIST).exerciseId, 'reverse-curl');
});

test('dönüşüm: bitmemiş antrenman ve başka gün öneriyi değiştirmez', () => {
  const wristDone = pullSession('1', '2026-09-15T12:00:00.000Z', 'wrist-curl');
  const unfinished = pullSession('2', '2026-09-22T12:00:00.000Z', 'reverse-curl', { finished: false });
  assertEqual(suggestOption([wristDone, unfinished], 'pull', WRIST).exerciseId, 'reverse-curl');
  const chop = ['cable-chop', 'reverse-cable-chop'];
  const pullOnly = [wristDone, pullSession('3', '2026-09-25T12:00:00.000Z', 'cable-chop')];
  assertEqual(suggestOption(pullOnly, 'legs', chop), { exerciseId: 'cable-chop', last: null }, 'Legs grubu Pull kayıtlarından bağımsız');
});

test('öneri metni', () => {
  const exercises = { 'wrist-curl': { name: 'Wrist Curl' }, 'reverse-curl': { name: 'Reverse Curl' } };
  const now = new Date('2026-09-29T12:00:00.000Z');
  assertEqual(suggestionText({ exerciseId: 'wrist-curl', last: null }, exercises, now), 'Henüz kayıt yok · Sıradaki: Wrist Curl');
  assertEqual(
    suggestionText({ exerciseId: 'reverse-curl', last: { exerciseId: 'wrist-curl', date: '2026-09-22T12:00:00.000Z' } }, exercises, now),
    'Son yapılan: Wrist Curl · 22 Eyl · Sıradaki: Reverse Curl',
  );
});

// ---------------------------------------------------------------- Geçmiş ve düzeltme

test('geçmiş: bitmiş antrenmanlar en yeniden eskiye; süre, gün ve özet biçimi', () => {
  const sessions = [
    session({ id: 'eski', date: '2026-09-15T12:00:00.000Z' }),
    session({ id: 'devam', date: '2026-09-29T12:00:00.000Z', finished: false }),
    session({ id: 'yeni', date: '2026-09-22T12:00:00.000Z', sets: [{ weight: 50, reps: 12 }, { weight: 50, reps: 11 }] }),
  ];
  assertEqual(finishedSessions(sessions).map((item) => item.id), ['yeni', 'eski']);
  assertEqual(sessionSummary(finishedSessions(sessions)[0]), '1 hareket · 2 set');
  assertEqual(formatDuration('2026-09-29T15:00:00.000Z', '2026-09-29T15:52:10.000Z'), '52 dk');
  assertEqual(formatDuration('2026-09-29T15:00:00.000Z', '2026-09-29T16:05:00.000Z'), '1 sa 5 dk');
  assertEqual(formatDuration('2026-09-29T15:00:00.000Z', '2026-09-29T17:00:00.000Z'), '2 sa');
  const day = formatDay('2026-09-29T12:00:00.000Z', new Date('2026-10-01T00:00:00.000Z'));
  assert(/^29 Eyl \S+$/.test(day), day);
});

test('geçmiş bir antrenman düzenlenirken sayaç o antrenmandan önceki kayıtlara göre', () => {
  const calf = (id, date, text) =>
    session({ id, date, dayId: 'legs', exerciseId: 'standing-calf-raise', equipmentId: 'makine', sets: sets(text) });
  const all = [
    calf('1', '2026-09-01T12:00:00.000Z', '40×12'),
    calf('2', '2026-09-08T12:00:00.000Z', '40×12'),
    calf('3', '2026-09-15T12:00:00.000Z', '45×10'),
  ];
  assertEqual(progressCounter(all, CALF), { count: 0, sinceFirst: false });
  assertEqual(progressCounter(all, CALF, '2026-09-15T12:00:00.000Z'), { count: 1, sinceFirst: true });
  assertEqual(lastPerformance(all, CALF, '2026-09-15T12:00:00.000Z').sessionId, '2');
});

test('düzenlenen kaydın sonradan silinmiş makinesi kayıtta korunuyor', () => {
  const exercises = {
    'rope-pushdown': { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg', archived: true }] },
  };
  const card = {
    item: { id: 'push-rope-pushdown', options: ['rope-pushdown'], sets: 3, repMin: 12, repMax: 15 },
    exerciseId: 'rope-pushdown',
    equipmentId: 'k1',
    weight: '50',
    reps: ['12', '12', ''],
  };
  assertEqual(evaluateCards([card], exercises).entries, [], 'düzenleme dışında arşivlenmiş makine kullanılmaz');
  const kept = evaluateCards([{ ...card, keepEquipmentId: 'k1' }], exercises).entries;
  assertEqual(kept.map((entry) => [entry.equipmentName, entry.sets.length]), [['Kablo', 2]]);
});

// ---------------------------------------------------------------- Grafikler

test('ölçüler birime göre: kg, kademe ve ağırlıksız', () => {
  assertEqual(METRICS.kg.map((metric) => metric.label), ['Tahmini 1TM', 'En ağır', 'Hacim']);
  assertEqual(METRICS.level.map((metric) => metric.label), ['En yüksek kademe', 'Toplam tekrar']);
  assertEqual(METRICS.none.map((metric) => metric.label), ['Toplam tekrar', 'En çok tekrar']);
});

test('ölçü değerleri: Epley 1TM en iyi setten, en ağır, hacim, toplam ve en çok tekrar', () => {
  const kg = sets('40×12, 40×11, 40×10');
  assertEqual(e1rm(40, 12), 56);
  assertEqual(e1rm(100, 1), 100);
  assertEqual(metricValue(kg, 'e1rm'), 56);
  assertEqual(metricValue(sets('40×12, 45×8'), 'e1rm'), 57);
  assertEqual(metricValue(sets('40×12, 45×8'), 'max'), 45);
  assertEqual(metricValue(kg, 'volume'), 1320);
  assertEqual(metricValue(sets('22.5×10'), 'e1rm'), 30);
  assertEqual(metricValue(sets('10k×12, 11k×8'), 'max'), 11);
  assertEqual(metricValue(sets('10k×12, 11k×8'), 'reps'), 20);
  assertEqual(metricValue(sets('15, 14, 12'), 'reps'), 41);
  assertEqual(metricValue(sets('15, 14, 12'), 'maxReps'), 15);
  assertEqual(formatMetric(56, 'e1rm', 'kg'), '56 kg');
  assertEqual(formatMetric(1320, 'volume', 'kg'), '1.320 kg');
  assertEqual(formatMetric(22.5, 'max', 'kg'), '22,5 kg');
  assertEqual(formatMetric(11, 'max', 'level'), '11k');
  assertEqual(formatMetric(41, 'reps', 'none'), '41');
});

test('grafik serisi: yalnızca aynı gün + hareket + makinenin bitmiş kayıtları, eskiden yeniye', () => {
  const sessions = [
    calfSession('2', '2026-09-08T12:00:00.000Z', '45×10'),
    calfSession('1', '2026-09-01T12:00:00.000Z', '40×12, 40×11'),
    calfSession('b', '2026-09-10T12:00:00.000Z', '60×15', { equipmentId: 'makine-b' }),
    calfSession('lower', '2026-09-11T12:00:00.000Z', '80×15', { dayId: 'lower' }),
    session({ id: 'atlandi', date: '2026-09-12T12:00:00.000Z', dayId: 'legs', exerciseId: 'leg-press' }),
    calfSession('devam', '2026-09-13T12:00:00.000Z', '90×20', { finished: false }),
  ];
  const series = exerciseSeries(sessions, CALF, 'max');
  assertEqual(series.map((point) => [point.sessionId, point.value]), [['1', 40], ['2', 45]]);
  assertEqual(series[0].sets, sets('40×12, 40×11'));
  assertEqual(exerciseSeries(sessions, CALF, 'volume').map((point) => point.value), [920, 450]);
  assertEqual(exerciseSeries(sessions, { ...CALF, equipmentId: 'makine-b' }, 'max').map((point) => point.sessionId), ['b']);
});

test('grafik sekmeleri: kaydı olan makineler, en son kullanılan önce; silinmiş makine adıyla', () => {
  const program = {
    exercises: {
      'standing-calf-raise': {
        name: 'Standing Calf Raise',
        equipment: [
          { id: 'makine', name: 'Calf makinesi', unit: 'kg' },
          { id: 'eski', name: 'Eski makine', unit: 'level', archived: true },
        ],
      },
    },
    days: [],
  };
  const sessions = [
    calfSession('1', '2026-09-01T12:00:00.000Z', '10k×12', { equipmentId: 'eski' }),
    calfSession('2', '2026-09-08T12:00:00.000Z', '40×12'),
    calfSession('3', '2026-09-15T12:00:00.000Z', '15', { equipmentId: 'kalkan' }),
    calfSession('4', '2026-09-22T12:00:00.000Z', '60×15', { dayId: 'lower', equipmentId: 'lower-makine' }),
  ];
  sessions[0].entries[0].unit = 'level';
  sessions[2].entries[0].unit = 'none';
  const machines = machinesWithRecords(sessions, program, 'legs', 'standing-calf-raise');
  assertEqual(
    machines.map((machine) => [machine.equipmentId, machine.name, machine.unit, machine.archived]),
    [
      ['kalkan', 'kalkan', 'none', true],
      ['makine', 'Calf makinesi', 'kg', false],
      ['eski', 'Eski makine', 'level', true],
    ],
  );
});

test('ilerleme listesi: program günlerine göre, programdaki sırayla; programda olmayanlar ayrı', () => {
  const program = {
    exercises: { 'leg-press': { name: 'Leg Press', equipment: [] }, 'standing-calf-raise': { name: 'Standing Calf Raise', equipment: [] } },
    days: [
      { id: 'legs', name: 'Legs', items: [{ options: ['leg-press'] }, { options: ['standing-calf-raise'] }] },
      { id: 'lower', name: 'Lower', items: [{ options: ['standing-calf-raise'] }] },
    ],
  };
  const sessions = [
    calfSession('1', '2026-09-01T12:00:00.000Z', '40×12'),
    calfSession('2', '2026-09-08T12:00:00.000Z', '40×12', { equipmentId: 'makine-b' }),
    session({ id: 'lp', date: '2026-09-09T12:00:00.000Z', dayId: 'legs', exerciseId: 'leg-press' }),
    session({ id: 'eski', date: '2026-09-10T12:00:00.000Z', dayId: 'legs', exerciseId: 'hack-squat' }),
    calfSession('devam', '2026-09-13T12:00:00.000Z', '90×20', { dayId: 'lower', finished: false }),
  ];
  const { days, other } = progressIndex(program, sessions);
  assertEqual(
    days.map((day) => [day.id, day.exercises.map((record) => [record.name, record.count, record.lastDate])]),
    [
      ['legs', [['Leg Press', 1, '2026-09-09T12:00:00.000Z'], ['Standing Calf Raise', 2, '2026-09-08T12:00:00.000Z']]],
      ['lower', []],
    ],
  );
  assertEqual(other.map((record) => [record.dayId, record.exerciseId, record.name]), [['legs', 'hack-squat', 'hack-squat']]);
});

test('grafik ekseni: yuvarlak değerler; tamsayı ölçüde kesirli çizgi yok', () => {
  assertEqual(niceTicks(40, 56), [40, 45, 50, 55, 60]);
  assertEqual(niceTicks(40, 40), [36, 38, 40, 42, 44]);
  assertEqual(niceTicks(10, 12, true), [10, 11, 12]);
  assertEqual(niceTicks(30, 41, true), [30, 35, 40, 45]);
  assertEqual(niceTicks(1, 3), [1, 1.5, 2, 2.5, 3]);
});

test('grafik: her antrenman bir nokta; son nokta seçili; ok tuşları ve dokunma en yakın noktayı seçer', () => {
  const chosen = [];
  const svg = lineChart({
    values: [40, 45, 42],
    firstLabel: '1 Eyl',
    lastLabel: '15 Eyl',
    formatTick: String,
    label: 'Deneme',
    width: 320,
    onSelect: (index) => chosen.push(index),
  });
  document.body.append(svg);
  try {
    const dots = [...svg.querySelectorAll('.dot')];
    assertEqual(dots.length, 3);
    const marker = svg.querySelector('.marker');
    assertEqual([marker.getAttribute('cx'), marker.getAttribute('cy')], [dots[2].getAttribute('cx'), dots[2].getAttribute('cy')]);
    assertEqual(svg.querySelector('.crosshair').getAttribute('x1'), dots[2].getAttribute('cx'));
    assertEqual(chosen, [], 'ilk seçim bildirilmez');
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    assertEqual(chosen, [1, 0], 'başta sola gidilmez');
    const box = svg.getBoundingClientRect();
    const scale = box.width / 320;
    const lastX = Number(dots[2].getAttribute('cx'));
    svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + (lastX - 20) * scale, pointerId: 1 }));
    assertEqual(chosen, [1, 0, 2], 'dokunulan yere en yakın nokta');
    assertEqual([...svg.querySelectorAll('.tick')].map((node) => node.textContent).slice(-2), ['1 Eyl', '15 Eyl']);
  } finally {
    svg.remove();
  }
});

// ---------------------------------------------------------------- Program düzenleyici

const program = () => structuredClone(seed);

test('gün ekleme, adlandırma, sıralama ve silme; program "düzenlendi" olarak işaretlenir', () => {
  const start = program();
  assertEqual(dayNameError(start, '  '), 'Güne bir ad verin.');
  assertEqual(dayNameError(start, 'push'), 'Bu adda bir gün zaten var.');
  assertEqual(dayNameError(start, 'Push', 'push'), '', 'kendi adı serbest');
  assertEqual(dayNameError(start, 'x'.repeat(31)), 'Gün adı en fazla 30 karakter olabilir.');
  const added = withDay(start, 'day-1', ' Arms ');
  assertEqual(added.days.map((day) => day.name), ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Arms']);
  assertEqual(added.days.at(-1), { id: 'day-1', name: 'Arms', items: [] });
  assertEqual(added.customized, true);
  assert(!start.customized && start.days.length === 5, 'eski program değişmez');
  const up = movedDay(added, 'day-1', -1);
  assertEqual(up.days.map((day) => day.id), ['push', 'pull', 'legs', 'upper', 'day-1', 'lower']);
  assertEqual(movedDay(up, 'push', -1).days.map((day) => day.id), up.days.map((day) => day.id), 'baştaki gün yukarı gitmez');
  assertEqual(renamedDay(up, 'day-1', 'Kol').days[4].name, 'Kol');
  assertEqual(withoutDay(up, 'legs').days.map((day) => day.id), ['push', 'pull', 'upper', 'day-1', 'lower']);
});

test('sıradaki gün programdaki yeni sıraya göre; silinen günden sonra ilk gün', () => {
  const custom = movedDay(withDay(program(), 'day-1', 'Arms'), 'day-1', -1);
  const done = (dayId) => [session({ id: 's', date: '2026-09-20T12:00:00.000Z', dayId })];
  assertEqual(nextDayId(custom, done('upper')), 'day-1');
  assertEqual(nextDayId(custom, done('day-1')), 'lower');
  assertEqual(nextDayId(withoutDay(custom, 'upper'), done('upper')), 'push');
});

test('hedef kutuları: set 1–10, en çok tekrar 1–100; en az tekrar veride en çok tekrara eşit', () => {
  assertEqual(parseTarget({ sets: '3', repMax: '12' }), { target: { sets: 3, repMin: 12, repMax: 12 } });
  assertEqual(parseTarget({ sets: '0', repMax: '12' }).field, 'sets');
  assertEqual(parseTarget({ sets: '11', repMax: '12' }).field, 'sets');
  assertEqual(parseTarget({ sets: '3', repMax: '' }), { error: 'En çok tekrar 1 ile 100 arasında bir tam sayı olmalı.', field: 'repMax' });
  assertEqual(parseTarget({ sets: '3', repMax: '2,5' }).field, 'repMax');
  assertEqual(parseTarget({ sets: '3', repMax: '101' }).field, 'repMax');
});

test('satır ekleme, düzenleme, sıralama, silme; bir hareket bir günde tek satırda', () => {
  const start = program();
  assertEqual(itemOptionsError(start, 'push', null, ['rope-pushdown']), 'Rope Pushdown bu günde zaten var.');
  assertEqual(itemOptionsError(start, 'push', 'push-rope-pushdown', ['rope-pushdown']), '', 'kendi satırı sayılmaz');
  assertEqual(itemOptionsError(start, 'push', null, ['leg-press', 'leg-press']), 'İki hareket aynı olamaz.');
  assertEqual(itemOptionsError(start, 'push', null, ['leg-press', 'cable-fly']), 'Cable Fly bu günde zaten var.');
  assertEqual(itemOptionsError(start, 'legs', null, ['rope-pushdown']), '', 'başka günde olması engel değil');

  const item = { id: 'item-1', options: ['leg-press', 'hip-thrust'], sets: 2, repMin: 8, repMax: 10 };
  const added = withItem(start, 'push', item);
  const push = (value) => value.days[0].items;
  assertEqual(push(added).at(-1), item);
  assertEqual(itemTitle(item, added.exercises), 'Leg Press / Hip Thrust');
  const changed = withItem(added, 'push', { ...item, sets: 4 });
  assertEqual(push(changed).length, 7, 'aynı kimlikli satır yerinde değişir');
  assertEqual(push(changed).at(-1).sets, 4);
  const up = movedItem(changed, 'push', 'item-1', -1);
  assertEqual(push(up).map((row) => row.id).slice(-2), ['item-1', 'push-overhead-rope-extension']);
  assertEqual(push(withoutItem(up, 'push', 'item-1')).length, 6);
  assertEqual(up.days[1], start.days[1], 'diğer günler aynı kalır');
});

test('yeni hareket ve "Adı düzelt": ad bir kez, her yerde; aynı ad reddedilir', () => {
  const start = program();
  assertEqual(exerciseNameError(start, ''), 'Harekete bir ad verin.');
  assertEqual(exerciseNameError(start, 'rope pushdown'), 'Bu adda bir hareket zaten var.');
  assertEqual(exerciseNameError(start, 'Rope Pushdown', 'rope-pushdown'), '');
  const added = withExercise(start, 'ex-1', ' Cable Curl ');
  assertEqual(added.exercises['ex-1'], { name: 'Cable Curl', equipment: [] });
  const renamed = renamedExercise(added, 'overhead-rope-extension', 'Overhead Extension');
  const title = (dayId) => itemTitle(renamed.days.find((day) => day.id === dayId).items.at(-1), renamed.exercises);
  assertEqual([title('push'), title('upper')], ['Overhead Extension', 'Overhead Extension']);
});

test('programı sıfırla: günler ve adlar başlangıca döner; makineler ve eklenen hareketler kalır', () => {
  const machine = { id: 'eq-1', name: 'Kablo', unit: 'kg' };
  let custom = withEquipment(program(), 'rope-pushdown', machine);
  custom = renamedExercise(custom, 'rope-pushdown', 'Triceps Rope');
  custom = withExercise(custom, 'ex-1', 'Cable Curl');
  custom = withoutDay(withDay(custom, 'day-1', 'Arms'), 'push');
  const reset = resetProgram(custom, seed);
  assertEqual(reset.days, seed.days);
  assertEqual(reset.exercises['rope-pushdown'], { name: 'Rope Pushdown', equipment: [machine] });
  assertEqual(reset.exercises['ex-1'].name, 'Cable Curl');
  assertEqual(reset.customized, undefined);
});

test('düzenlenmiş program başlangıç programı yükseltmesinde günlerini korur', () => {
  const custom = { ...withDay(program(), 'day-1', 'Arms'), seedVersion: 3 };
  const newer = { ...program(), seedVersion: 4 };
  newer.days = newer.days.slice(0, 2);
  const upgraded = upgradeProgram(custom, newer);
  assertEqual(upgraded.seedVersion, 4);
  assertEqual(upgraded.days.map((day) => day.id), ['push', 'pull', 'legs', 'upper', 'lower', 'day-1']);
  assertEqual(upgradeProgram({ ...program(), seedVersion: 3 }, newer).days.map((day) => day.id), ['push', 'pull']);
});

test('günü olmayan program yedekten reddedilir', () => {
  const backup = buildBackup({ ...program(), days: [] }, [], '2026-09-29T12:00:00.000Z');
  assertEqual(parseBackup(JSON.stringify(backup)).error, 'Yedek dosyası bozuk: programda gün yok.');
});

// ---------------------------------------------------------------- Makine yönetimi ve "+ Hareket ekle"

test('makinenin adı ve birimi değişiyor; kendi adı serbest, başka etkin makinenin adı değil', () => {
  let custom = withEquipment(program(), 'rope-pushdown', { id: 'eq-1', name: 'Kablo', unit: 'kg' });
  custom = withEquipment(custom, 'rope-pushdown', { id: 'eq-2', name: 'Kablo 2', unit: 'level' });
  const exercise = custom.exercises['rope-pushdown'];
  assertEqual(equipmentError(exercise, 'kablo', 'kg', 'eq-1'), '', 'kendi adı');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'kg', 'eq-1'), 'Bu adda bir makine zaten var.');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'kg'), 'Bu adda bir makine zaten var.', 'yeni makinede kendi yok');
  const changed = changedEquipment(custom, 'rope-pushdown', 'eq-1', { name: ' Halat ', unit: 'level' });
  assertEqual(changed.exercises['rope-pushdown'].equipment, [
    { id: 'eq-1', name: 'Halat', unit: 'level' },
    { id: 'eq-2', name: 'Kablo 2', unit: 'level' },
  ]);
  assertEqual(custom.exercises['rope-pushdown'].equipment[0].name, 'Kablo', 'eski program değişmez');
  assertEqual(changed.customized, undefined, 'makine değişikliği günleri değiştirmez');
});

test('silinmiş makine geri alınıyor; aynı adda etkin makine varken alınmıyor', () => {
  let custom = withEquipment(program(), 'rope-pushdown', { id: 'eq-1', name: 'Kablo', unit: 'kg' });
  custom = withoutEquipment(custom, 'rope-pushdown', 'eq-1', new Set(['eq-1']));
  assertEqual(custom.exercises['rope-pushdown'].equipment[0].archived, true);
  assertEqual(restoreError(custom.exercises['rope-pushdown'], 'eq-1'), '');
  assertEqual(restoredEquipment(custom, 'rope-pushdown', 'eq-1').exercises['rope-pushdown'].equipment, [
    { id: 'eq-1', name: 'Kablo', unit: 'kg' },
  ]);
  const clash = withEquipment(custom, 'rope-pushdown', { id: 'eq-2', name: 'kablo', unit: 'level' });
  assertEqual(
    restoreError(clash.exercises['rope-pushdown'], 'eq-1'),
    '"Kablo" adında etkin bir makine var. Geri almadan önce onun adını değiştirin.',
  );
});

test('"+ Hareket ekle": hedef hareketin programdaki ilk satırından; katalog değişikliği programı "düzenlendi" yapmaz', () => {
  assertEqual(programTarget(seed, 'overhead-rope-extension'), { sets: 2, repMax: 15 }, 'ilk bulunduğu gün Push');
  assertEqual(programTarget(seed, 'rope-pushdown'), { sets: 3, repMax: 15 }, 'aralıkta en çok tekrar');
  assertEqual(programTarget(seed, 'reverse-curl'), { sets: 2, repMax: 15 }, 'dönüşümlü satırın ikinci hareketi');
  assertEqual(programTarget(withExercise(program(), 'ex-1', 'Cable Curl'), 'ex-1'), null);
  assertEqual(withExercise(program(), 'ex-1', 'Cable Curl').customized, undefined);
  assertEqual(renamedExercise(program(), 'rope-pushdown', 'Triceps Rope').customized, undefined);
});
