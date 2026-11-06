// Colors offered by the store. Keep the keys in sync with COLOR_KEYS in api/index.py.
window.TRENO_COLORS = {
  rosado: ['Rosado', '#F4A6C1'], negro: ['Negro', '#1A1A1A'], rojo: ['Rojo', '#D32F2F'],
  morado: ['Morado', '#7B4FA0'], plomo: ['Plomo', '#8A8D91'], verde: ['Verde', '#3E9B5A'],
  fucsia: ['Fucsia', '#E0197D'], marino: ['Azul marino', '#1F2F5C'], azul: ['Azul', '#2F6FD1'],
  celeste: ['Celeste', '#6EC6E8'], naranja: ['Naranja', '#F28C28'], amarillo: ['Amarillo', '#F2C94C']
};

// Built-in photos per product color, shared by the store and the admin panel.
// Photos uploaded for a color replace that color's built-in photos.
window.TRENO_COLOR_IMAGES = {
  KETPVC: { rosado: 'kettlebell-pvc.jpg', negro: 'kettlebell-pvc-negro.jpg', rojo: 'kettlebell-pvc-rojo.jpg' },
  MANVIN: { rosado: 'mancuerna-vinilo.jpg', morado: 'mancuerna-vinilo-morado.jpg', rojo: 'mancuerna-vinilo-rojo.jpg' },
  MATGOM: { rosado: 'mat-goma-eva.jpg', fucsia: 'mat-goma-eva-fucsia.jpg', verde: 'mat-goma-eva-verde.jpg' },
  TOBPLA: { rosado: 'tobillera-peso.jpg', negro: 'tobillera-peso-negro.jpg', azul: 'tobillera-peso-azul.jpg' },
  CHASIN: { rosado: 'chaleco-peso.jpg', negro: 'chaleco-peso-negro.jpg', verde: 'chaleco-peso-verde.jpg', plomo: 'chaleco-peso-plomo.jpg' },
  SOGPVC: { celeste: 'soga-pvc.jpg', naranja: 'soga-pvc-naranja.jpg' },
  STEPVC: { azul: 'step-pvc.jpg', plomo: 'step-pvc-plomo.jpg' },
  GUAPLA: { rojo: 'guantes-box.jpg', negro: 'guantes-box-negro.jpg' }
};

// Built-in photos per weight, used when a presentation such as "10 kg" is chosen.
window.TRENO_SIZE_IMAGES = {
  KETPVC: { prefix: 'pesa-pvc', colors: ['negro', 'rojo', 'rosado'], sizes: [4, 5, 6, 8, 10, 12, 14, 16, 18, 20] },
  PESHIE: { prefix: 'pesa-hierro', colors: ['negro'], sizes: [4, 6, 8, 10, 12, 14, 16, 18, 20, 22] }
};

// More built-in views. With a color they belong to that color; without one they are general.
window.TRENO_EXTRA_IMAGES = {
  PACKCH: [{ file: 'promo-pack-chaleco.jpg' }],
  TRXSIN: [{ file: 'trx-2.jpg' }, { file: 'trx-3.jpg' }, { file: 'trx-4.jpg' }],
  GUAPLA: [{ file: 'guantes-box-2.jpg', color: 'rojo' }, { file: 'guantes-box-3.jpg', color: 'rojo' }, { file: 'guantes-box-4.jpg', color: 'rojo' }],
  MATGOM: [{ file: 'mat-goma-eva-2.jpg', color: 'rosado' }],
  BANLAT: [{ file: 'bandas-latex-2.jpg' }, { file: 'bandas-latex-3.jpg' }],
  MANCAU: [{ file: 'mancuerna-hexagonal-2.jpg' }],
  SOGPVC: [{ file: 'soga-pvc-naranja-2.jpg', color: 'naranja' }]
};
