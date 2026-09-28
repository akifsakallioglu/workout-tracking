// Aşama 1 için geçici sabit veri: tek gün, tek hareket ve iki makine.
// Aşama 2'de yapıştırılan programın tamamıyla değiştirilecek.
export const program = {
  exercises: {
    'rope-pushdown': {
      name: 'Rope Pushdown',
      equipment: [
        { id: 'rope-pushdown-kablo', name: 'Kablo', unit: 'kg' },
        { id: 'rope-pushdown-kablo-2', name: 'Kablo 2', unit: 'level' },
      ],
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
