// Başlangıç programı: ilk açılışta veritabanına yazılır. Aşama 1'de tek gün ve tek hareket var;
// Aşama 2'de yapıştırılan programın tamamı gelecek. Her hareket tek makineyle başlar; başka
// makineleri kullanıcı kendisi ekler.
export const program = {
  exercises: {
    'rope-pushdown': {
      name: 'Rope Pushdown',
      equipment: [{ id: 'rope-pushdown-kablo', name: 'Kablo', unit: 'kg' }],
    },
  },
  days: [
    {
      id: 'push',
      name: 'Push',
      items: [{ id: 'push-rope-pushdown', options: ['rope-pushdown'], sets: 3, repMin: 12, repMax: 15 }],
    },
  ],
};
