import { assert, assertEqual, test } from './harness.js';
import {
  buildSession,
  collectSets,
  equipmentError,
  formatSet,
  formatSets,
  formatTarget,
  lastPerformance,
  parseReps,
  parseWeight,
  validationMessage,
  withEquipment,
} from '../js/logic.js';

const KEY = { dayId: 'push', exerciseId: 'rope-pushdown', equipmentId: 'kablo' };

function session({ id, date, dayId = 'push', equipmentId = 'kablo', unit = 'kg', sets, finished = true }) {
  return {
    id,
    dayId,
    dayName: dayId,
    startedAt: date,
    finishedAt: finished ? date : null,
    entries: [
      {
        exerciseId: 'rope-pushdown',
        equipmentId,
        name: 'Rope Pushdown',
        equipmentName: equipmentId,
        unit,
        options: ['rope-pushdown'],
        target: { sets: 3, repMin: 12, repMax: 15 },
        sets,
      },
    ],
  };
}

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
    session({ id: 'kablo', date: '2026-09-15T12:00:00.000Z', sets: [{ weight: 50, reps: 12 }] }),
    session({ id: 'kablo-2', date: '2026-09-22T12:00:00.000Z', equipmentId: 'kablo-2', unit: 'level', sets: [{ weight: 10, reps: 12 }] }),
  ];
  assertEqual(lastPerformance(sessions, KEY).sessionId, 'kablo');
});

test('aynı hareketin aynı makinede başka bir günde yapılan kaydını getirmiyor', () => {
  const sessions = [
    session({ id: 'push', date: '2026-09-15T12:00:00.000Z', sets: [{ weight: 50, reps: 12 }] }),
    session({ id: 'upper', date: '2026-09-22T12:00:00.000Z', dayId: 'upper', sets: [{ weight: 40, reps: 15 }] }),
  ];
  assertEqual(lastPerformance(sessions, KEY).sessionId, 'push');
});

test('kayıt yoksa "yok" (null) döndürüyor', () => {
  assertEqual(lastPerformance([], KEY), null);
});

test('bitmemiş antrenman "geçen sefer" sayılmıyor', () => {
  const sessions = [
    session({ id: 'bitti', date: '2026-09-15T12:00:00.000Z', sets: [{ weight: 50, reps: 12 }] }),
    session({ id: 'devam', date: '2026-09-22T12:00:00.000Z', sets: [{ weight: 55, reps: 8 }], finished: false }),
  ];
  assertEqual(lastPerformance(sessions, KEY).sessionId, 'bitti');
});

test('ağırlık bir kez girilir ve tekrarı girilen her sete uygulanır', () => {
  assertEqual(collectSets({ weight: '35', reps: ['12', '12', '11'] }, 'kg'), {
    sets: [{ weight: 35, reps: 12 }, { weight: 35, reps: 12 }, { weight: 35, reps: 11 }],
    problems: [],
  });
  assertEqual(collectSets({ weight: '10', reps: ['12', '', ''] }, 'level').sets, [{ weight: 10, reps: 12 }]);
});

test('boş kutulardan set oluşmuyor', () => {
  assertEqual(collectSets({ weight: '', reps: ['', '', ''] }, 'kg'), { sets: [], problems: [] });
  assertEqual(collectSets({ weight: '35', reps: ['', '', ''] }, 'kg'), { sets: [], problems: [] });
  assertEqual(validationMessage([], [], 'kg'), 'En az bir setin tekrar sayısını girin.');
});

test('tekrar girilip ağırlık girilmezse uyarı veriyor; ağırlıksızda tekrar yeter', () => {
  const result = collectSets({ weight: '', reps: ['12', '12', ''] }, 'kg');
  assertEqual(result, { sets: [], problems: [{ field: 'weight', kind: 'missing' }] });
  assertEqual(validationMessage(result.sets, result.problems, 'kg'), 'Ağırlığı girin.');
  assertEqual(validationMessage(result.sets, result.problems, 'level'), 'Kademeyi girin.');
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
  assertEqual(validationMessage(badReps.sets, badReps.problems, 'kg'), 'Geçersiz tekrar: 2. ve 3. set. 12 gibi bir tam sayı girin.');
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

test('makinenin adını ve birimini kullanıcı seçer; boş ad, aynı ad ve seçilmemiş birim reddedilir', () => {
  const exercise = { name: 'Rope Pushdown', equipment: [{ id: 'k1', name: 'Kablo', unit: 'kg' }] };
  assertEqual(equipmentError(exercise, '   ', 'kg'), 'Makineye bir ad verin.');
  assertEqual(equipmentError(exercise, ' KABLO ', 'level'), 'Bu adda bir makine zaten var.');
  assertEqual(equipmentError(exercise, 'Kablo 2', ''), 'Birimi seçin: kg, kademe ya da ağırlıksız.');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'toString'), 'Birimi seçin: kg, kademe ya da ağırlıksız.');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'kg'), '', 'ikinci kablo da kg olabilir');
  assertEqual(equipmentError(exercise, 'Kablo 2', 'level'), '');
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

test('kayıt; gün, hareket, makine, birim ve hedefin kopyasını taşıyor', () => {
  const item = { id: 'push-rope-pushdown', options: ['rope-pushdown'], sets: 3, repMin: 12, repMax: 15 };
  const saved = buildSession({
    id: 'a1',
    now: '2026-09-29T18:00:00.000Z',
    day: { id: 'push', name: 'Push' },
    item,
    exerciseId: 'rope-pushdown',
    exercise: { name: 'Rope Pushdown' },
    equipment: { id: 'kablo-2', name: 'Kablo 2', unit: 'level' },
    sets: [{ weight: 10, reps: 12 }],
  });
  assertEqual(saved.dayId, 'push');
  assertEqual(saved.finishedAt, '2026-09-29T18:00:00.000Z');
  const [entry] = saved.entries;
  assertEqual(
    [entry.exerciseId, entry.equipmentId, entry.name, entry.equipmentName, entry.unit],
    ['rope-pushdown', 'kablo-2', 'Rope Pushdown', 'Kablo 2', 'level'],
  );
  assertEqual(entry.target, { sets: 3, repMin: 12, repMax: 15 });
  item.repMax = 20; // program sonradan değişse de kayıttaki hedef değişmez
  assertEqual(entry.target.repMax, 15);
});
