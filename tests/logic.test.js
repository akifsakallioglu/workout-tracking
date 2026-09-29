import { assert, assertEqual, test } from './harness.js';
import {
  activeSession,
  buildEntry,
  buildSession,
  collectSets,
  defaultEquipmentId,
  equipmentError,
  evaluateCards,
  formatDateTime,
  formatSet,
  formatSets,
  formatTarget,
  itemTitle,
  lastDoneDate,
  lastPerformance,
  nextDayId,
  parseReps,
  parseWeight,
  upgradeProgram,
  validationMessage,
  withEquipment,
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
    'Machine Chest Press 3 × 10–12',
    'Cable Fly 3 × 12–15',
    'Seated Lateral Raise 4 × 15',
    'Machine Shoulder Press 3 × 10–12',
    'Rope Pushdown 3 × 12–15',
    'Overhead Rope Extension 2 × 15',
  ]);
  const upper = seed.days.find((day) => day.id === 'upper');
  assertEqual(formatTarget(upper.items.at(-1)), '3 × 12–15', 'Upper’daki Overhead Rope Extension');
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
  assertEqual(formatTarget({ sets: 3, repMin: 12, repMax: 15 }), '3 × 12–15');
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
