// Colors offered by the store. Keep the keys in sync with COLOR_KEYS in api/index.py.
window.TRENO_COLORS = {
  rosado: ['Rosado', '#F4A6C1'], negro: ['Negro', '#1A1A1A'], rojo: ['Rojo', '#D32F2F'],
  morado: ['Morado', '#7B4FA0'], plomo: ['Plomo', '#8A8D91'], verde: ['Verde', '#3E9B5A'],
  fucsia: ['Fucsia', '#E0197D'], marino: ['Azul marino', '#1F2F5C'], azul: ['Azul', '#2F6FD1'],
  celeste: ['Celeste', '#6EC6E8'], naranja: ['Naranja', '#F28C28'], amarillo: ['Amarillo', '#F2C94C'],
  multicolor: ['Multicolor', 'conic-gradient(#D32F2F, #F2C94C, #3E9B5A, #2F6FD1, #1A1A1A, #D32F2F)']
};

// Paints a color dot: plain colors as a fill, the multicolor key as a gradient.
window.trenoPaint = function (node, value) {
  if (/gradient\(/.test(value)) node.style.backgroundImage = value;
  else node.style.backgroundColor = value;
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
  PACKCH: [{ file: 'pack-chaleco-tobilleras-info.jpg' }, { file: 'promo-pack-chaleco.jpg' }],
  PACKRO: [{ file: 'pack-chaleco-tobilleras-rosado-info.jpg' }],
  PACK15: [{ file: 'pack-chaleco-15-tobilleras-2-info.jpg' }],
  PACK20: [{ file: 'pack-chaleco-20-tobilleras-2-info.jpg' }],
  PACKPE: [{ file: 'pack-chaleco-pesa-info.jpg' }],
  TRXSIN: [{ file: 'trx-2.jpg' }, { file: 'trx-3.jpg' }, { file: 'trx-4.jpg' }],
  GUAPLA: [{ file: 'guantes-box-2.jpg', color: 'rojo' }, { file: 'guantes-box-3.jpg', color: 'rojo' }, { file: 'guantes-box-4.jpg', color: 'rojo' },
    { file: 'guantes-box-negro-2.jpg', color: 'negro' }, { file: 'guantes-box-negro-3.jpg', color: 'negro' }, { file: 'guantes-box-negro-4.jpg', color: 'negro' }],
  MATGOM: [{ file: 'mat-goma-eva-2.jpg', color: 'rosado' }],
  BANLAT: [{ file: 'bandas-latex-2.jpg' }, { file: 'bandas-latex-3.jpg' }],
  MANCAU: [{ file: 'mancuerna-hexagonal-2.jpg' }],
  SOGPVC: [{ file: 'soga-pvc-2.jpg', color: 'celeste' }, { file: 'soga-pvc-naranja-2.jpg', color: 'naranja' }],
  RUEABD: [2, 3, 4].map(n => ({ file: `rueda-abdominal-ancha-${n}.jpg` })),
  TUBRES: [2, 3, 4, 5, 6, 7].map(n => ({ file: `tubos-resistencia-set-${n}.jpg` }))
};

// How-to video shown above a group's products. Keys are the group names in app.js;
// each step starts at "at" seconds into the video, which shows one photo per step.
window.TRENO_GROUP_VIDEOS = {
  'Pesas rusas': { file: 'uso-pesas-rusas.mp4', poster: 'uso-pesas-rusas.jpg', steps: [
    { at: 0, name: 'Swing', tip: 'Empuja con la cadera y lleva la pesa a la altura del pecho, brazos rectos.' },
    { at: 3.8, name: 'Sentadilla goblet', tip: 'Pesa pegada al pecho, baja con la espalda recta y sube.' }
  ] }
};

// Product videos, shown as the last view of the product gallery.
window.TRENO_VIDEOS = {
  TUBRES: { file: 'tubos-resistencia-set.mp4', poster: 'tubos-resistencia-set.jpg' }
};
