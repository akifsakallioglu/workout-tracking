// Başlangıç programı: ilk açılışta veritabanına yazılır. Hareketler makinesiz başlar; her hareketin
// makinelerini (adı ve birimiyle) kullanıcı kendisi ekler. SEED_VERSION artınca kayıtlı program
// yükseltilir: günler yeni programdan gelir, kullanıcının eklediği makineler korunur.
export const SEED_VERSION = 3;

const EXERCISES = {
  'machine-chest-press': 'Machine Chest Press',
  'cable-fly': 'Cable Fly',
  'seated-lateral-raise': 'Seated Lateral Raise',
  'machine-shoulder-press': 'Machine Shoulder Press',
  'rope-pushdown': 'Rope Pushdown',
  'overhead-rope-extension': 'Overhead Rope Extension',
  'lat-pulldown-wide-grip': 'Lat Pulldown (wide grip)',
  'cable-row': 'Cable Row',
  'dumbbell-pullover': 'Dumbbell Pullover',
  'rear-delt-machine': 'Rear Delt Machine',
  'face-pull': 'Face Pull',
  'incline-dumbbell-curl': 'Incline Dumbbell Curl',
  'dumbbell-shrug': 'Dumbbell Shrug',
  'wrist-curl': 'Wrist Curl',
  'reverse-curl': 'Reverse Curl',
  'leg-press': 'Leg Press',
  'leg-extension': 'Leg Extension',
  'lying-leg-curl': 'Lying Leg Curl',
  'hip-thrust': 'Hip Thrust',
  'standing-calf-raise': 'Standing Calf Raise',
  'seated-calf-raise': 'Seated Calf Raise',
  'ab-crunch-machine': 'Ab Crunch Machine',
  'cable-chop': 'Cable Chop',
  'reverse-cable-chop': 'Reverse Cable Chop',
  'incline-dumbbell-press': 'Incline Dumbbell Press',
  'seated-cable-row': 'Seated Cable Row',
  'cable-lateral-raise': 'Cable Lateral Raise',
  'pec-deck': 'Pec Deck',
  'concentration-curl': 'Concentration Curl',
  'romanian-deadlift': 'Romanian Deadlift',
  'step-up': 'Step-Up',
  'seated-hamstring-curl': 'Seated Hamstring Curl',
  hyperextension: 'Hyperextension',
  'ab-wheel-roll-out': 'Ab Wheel Roll-Out',
};

// [hareket (dönüşümlü satırda iki hareket), set, en az tekrar, en çok tekrar (yoksa en azla aynı)]
const DAYS = [
  ['push', 'Push', [
    ['machine-chest-press', 3, 10, 12],
    ['cable-fly', 3, 12, 15],
    ['seated-lateral-raise', 4, 15],
    ['machine-shoulder-press', 3, 10, 12],
    ['rope-pushdown', 3, 12, 15],
    ['overhead-rope-extension', 2, 15],
  ]],
  ['pull', 'Pull', [
    ['lat-pulldown-wide-grip', 3, 10],
    ['cable-row', 3, 12],
    ['dumbbell-pullover', 3, 12, 15],
    ['rear-delt-machine', 3, 15],
    ['face-pull', 2, 15],
    ['incline-dumbbell-curl', 3, 12, 15],
    ['dumbbell-shrug', 3, 12],
    [['wrist-curl', 'reverse-curl'], 2, 15],
  ]],
  ['legs', 'Legs', [
    ['leg-press', 4, 12],
    ['leg-extension', 3, 15],
    ['lying-leg-curl', 3, 12, 15],
    ['hip-thrust', 3, 12],
    ['standing-calf-raise', 4, 15],
    ['seated-calf-raise', 3, 15],
    ['ab-crunch-machine', 3, 20],
    [['cable-chop', 'reverse-cable-chop'], 2, 15],
  ]],
  ['upper', 'Upper', [
    ['incline-dumbbell-press', 3, 10, 12],
    ['seated-cable-row', 3, 12],
    ['cable-lateral-raise', 3, 15],
    ['pec-deck', 3, 12, 15],
    ['concentration-curl', 3, 12, 15],
    ['overhead-rope-extension', 3, 12, 15],
  ]],
  ['lower', 'Lower', [
    ['romanian-deadlift', 3, 10],
    ['step-up', 3, 12],
    ['seated-hamstring-curl', 3, 12, 15],
    ['hyperextension', 3, 15],
    ['standing-calf-raise', 4, 15],
    ['ab-wheel-roll-out', 3, 12, 15],
  ]],
];

export const program = {
  seedVersion: SEED_VERSION,
  exercises: Object.fromEntries(Object.entries(EXERCISES).map(([id, name]) => [id, { name, equipment: [] }])),
  days: DAYS.map(([id, name, items]) => ({
    id,
    name,
    items: items.map(([exercises, sets, repMin, repMax = repMin]) => {
      const options = [exercises].flat();
      return { id: `${id}-${options.join('-')}`, options, sets, repMin, repMax };
    }),
  })),
};
