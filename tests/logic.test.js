import { assert, assertEqual, test } from './harness.js';
import {
  buildSession,
  collectSets,
  formatSet,
  formatTarget,
  lastPerformance,
  parseReps,
  parseWeight,
  validationMessage,
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

const rows = (...values) => values.map(([weight, reps]) => ({ weight, reps }));

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

test('boş kutulardan set oluşmuyor; yalnızca girilen satırlar set olur', () => {
  assertEqual(collectSets(rows(['', ''], ['', ''], ['', '']), 'kg'), { sets: [], problems: [] });
  assertEqual(collectSets(rows(['50', '12'], ['', ''], ['', '']), 'kg').sets, [{ weight: 50, reps: 12 }]);
  assertEqual(validationMessage([], []), 'En az bir tam set girin.');
});

test('yarım satır set sayılmıyor ve uyarı üretiyor; ağırlıksızda tekrar yeter', () => {
  const result = collectSets(rows(['50', ''], ['50', '12'], ['', '10']), 'kg');
  assertEqual(result.sets, [{ weight: 50, reps: 12 }]);
  assertEqual(result.problems, [{ row: 0, kind: 'half' }, { row: 2, kind: 'half' }]);
  assertEqual(validationMessage(result.sets, result.problems), 'Yarım set: 1. ve 3. set. Ağırlığı ve tekrarı birlikte girin ya da satırı boşaltın.');
  assertEqual(collectSets(rows(['', '15']), 'none').sets, [{ weight: null, reps: 15 }]);
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
  assertEqual(collectSets(rows(['abc', '12']), 'kg').problems, [{ row: 0, kind: 'invalid' }]);
});

test('setler birime göre yazılıyor', () => {
  assertEqual(formatSet({ weight: 50, reps: 12 }, 'kg'), '50×12');
  assertEqual(formatSet({ weight: 52.5, reps: 10 }, 'kg'), '52,5×10');
  assertEqual(formatSet({ weight: 10, reps: 12 }, 'level'), '10k×12');
  assertEqual(formatSet({ weight: null, reps: 15 }, 'none'), '15');
  assertEqual(formatTarget({ sets: 3, repMin: 12, repMax: 15 }), '3 × 12–15');
  assertEqual(formatTarget({ sets: 4, repMin: 15, repMax: 15 }), '4 × 15');
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
