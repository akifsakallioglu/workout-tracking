// Başlangıç programı: ilk açılışta veritabanına yazılır. Her hareket, adından tahmin edilen tek
// makineyle başlar; başka makineleri kullanıcı kendisi ekler. SEED_VERSION artınca kayıtlı
// programa yeni gün ve hareketler eklenir, kullanıcının eklediği makineler korunur.
export const SEED_VERSION = 2;

const MAKINE = { slug: 'makine', name: 'Makine', unit: 'kg' };
const KABLO = { slug: 'kablo', name: 'Kablo', unit: 'kg' };
const DAMBIL = { slug: 'dambil', name: 'Dambıl', unit: 'kg' };
const BAR = { slug: 'bar', name: 'Bar', unit: 'kg' };
const VUCUT = { slug: 'vucut-agirligi', name: 'Vücut ağırlığı', unit: 'none' };

const EXERCISES = {
  'machine-chest-press': ['Machine Chest Press', MAKINE],
  'cable-fly': ['Cable Fly', KABLO],
  'seated-lateral-raise': ['Seated Lateral Raise', DAMBIL],
  'machine-shoulder-press': ['Machine Shoulder Press', MAKINE],
  'rope-pushdown': ['Rope Pushdown', KABLO],
  'overhead-rope-extension': ['Overhead Rope Extension', KABLO],
  'lat-pulldown-wide-grip': ['Lat Pulldown (wide grip)', MAKINE],
  'cable-row': ['Cable Row', KABLO],
  'dumbbell-pullover': ['Dumbbell Pullover', DAMBIL],
  'rear-delt-machine': ['Rear Delt Machine', MAKINE],
  'face-pull': ['Face Pull', KABLO],
  'incline-dumbbell-curl': ['Incline Dumbbell Curl', DAMBIL],
  'dumbbell-shrug': ['Dumbbell Shrug', DAMBIL],
  'wrist-curl': ['Wrist Curl', DAMBIL],
  'reverse-curl': ['Reverse Curl', BAR],
  'leg-press': ['Leg Press', MAKINE],
  'leg-extension': ['Leg Extension', MAKINE],
  'lying-leg-curl': ['Lying Leg Curl', MAKINE],
  'hip-thrust': ['Hip Thrust', BAR],
  'standing-calf-raise': ['Standing Calf Raise', MAKINE],
  'seated-calf-raise': ['Seated Calf Raise', MAKINE],
  'ab-crunch-machine': ['Ab Crunch Machine', MAKINE],
  'cable-chop': ['Cable Chop', KABLO],
  'reverse-cable-chop': ['Reverse Cable Chop', KABLO],
  'incline-dumbbell-press': ['Incline Dumbbell Press', DAMBIL],
  'seated-cable-row': ['Seated Cable Row', KABLO],
  'cable-lateral-raise': ['Cable Lateral Raise', KABLO],
  'pec-deck': ['Pec Deck', MAKINE],
  'concentration-curl': ['Concentration Curl', DAMBIL],
  'romanian-deadlift': ['Romanian Deadlift', BAR],
  'step-up': ['Step-Up', DAMBIL],
  'seated-hamstring-curl': ['Seated Hamstring Curl', MAKINE],
  hyperextension: ['Hyperextension', VUCUT],
  'ab-wheel-roll-out': ['Ab Wheel Roll-Out', VUCUT],
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
  exercises: Object.fromEntries(
    Object.entries(EXERCISES).map(([id, [name, machine]]) => [
      id,
      { name, equipment: [{ id: `${id}-${machine.slug}`, name: machine.name, unit: machine.unit }] },
    ]),
  ),
  days: DAYS.map(([id, name, items]) => ({
    id,
    name,
    items: items.map(([exercises, sets, repMin, repMax = repMin]) => {
      const options = [exercises].flat();
      return { id: `${id}-${options.join('-')}`, options, sets, repMin, repMax };
    }),
  })),
};
