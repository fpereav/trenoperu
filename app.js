(function () {
  'use strict';

  var ACCENT = '#FF4670';
  var IMG = 'assets/img/';

  var COLORS = {
    rosado: ['Rosado', '#F4A6C1'], negro: ['Negro', '#1A1A1A'], rojo: ['Rojo', '#D32F2F'],
    morado: ['Morado', '#7B4FA0'], plomo: ['Plomo', '#8A8D91'], verde: ['Verde', '#3E9B5A'],
    fucsia: ['Fucsia', '#E0197D'], marino: ['Azul marino', '#1F2F5C'], azul: ['Azul', '#2F6FD1'],
    celeste: ['Celeste', '#6EC6E8'], naranja: ['Naranja', '#F28C28'], amarillo: ['Amarillo', '#F2C94C']
  };

  var PRODUCTS = [
    { id: 'KETPVC', name: 'Kettlebell PVC 4 kg', cat: 'Pesas', price: 59, img: 'kettlebell-pvc.jpg', colors: ['rosado', 'negro', 'rojo'], stock: 4, top: true },
    { id: 'MANVIN', name: 'Mancuerna vinilo 1 kg', cat: 'Pesas', price: 69, img: 'mancuerna-vinilo.jpg', colors: ['rosado', 'morado', 'rojo'], stock: 4, top: true },
    { id: 'MATGOM', name: 'Mat goma EVA 8 mm', cat: 'Yoga', price: 69, img: 'mat-goma-eva.jpg', colors: ['rosado', 'fucsia', 'plomo', 'verde', 'marino'], stock: 6 },
    { id: 'TOBPLA', name: 'Tobillera con peso 2 kg', cat: 'Accesorios', price: 69, img: 'tobillera-peso.jpg', colors: ['rosado', 'negro', 'azul'], stock: 8 },
    { id: 'BANLAT', name: 'Bandas de látex arcoíris x5', cat: 'Resistencia', price: 69, img: 'bandas-latex.jpg', colors: ['rojo', 'amarillo', 'verde', 'azul'], stock: 22, top: true },
    { id: 'SOGPVC', name: 'Soga para saltar PVC 2.75 m', cat: 'Cardio', price: 59, img: 'soga-pvc.jpg', colors: ['celeste', 'naranja'], stock: 10 },
    { id: 'CHASIN', name: 'Chaleco con peso 10 kg', cat: 'Accesorios', price: 169, img: 'chaleco-peso.jpg', colors: ['rosado', 'negro', 'verde', 'plomo'], stock: 8 },
    { id: 'ROLPVC', name: 'Roller PVC para masaje', cat: 'Recuperación', price: 69, img: 'roller-pvc.jpg', colors: ['rosado', 'morado', 'negro', 'azul'], stock: 2 },
    { id: 'PESHIE', name: 'Pesa rusa hierro 12 kg', cat: 'Pesas', price: 120, img: 'pesa-rusa-hierro.jpg', colors: ['negro'], stock: 1 },
    { id: 'MANCAU', name: 'Mancuerna hexagonal caucho 2 kg', cat: 'Pesas', price: 119, img: 'mancuerna-hexagonal.jpg', colors: ['negro'], stock: 1 },
    { id: 'STEPVC', name: 'Step PVC 2 niveles', cat: 'Cardio', price: 129, img: 'step-pvc.jpg', colors: ['plomo', 'azul', 'rojo'], stock: 3 },
    { id: 'TRXSIN', name: 'TRX entrenamiento en suspensión', cat: 'Funcional', price: 159, img: 'trx.jpg', colors: ['amarillo'], stock: 4 },
    { id: 'GUAPLA', name: 'Guantes de box 14 oz', cat: 'Box', price: 199, img: 'guantes-box.jpg', colors: ['rojo', 'negro'], stock: 4 }
  ];

  var CATEGORIES = ['Todo', 'Pesas', 'Yoga', 'Cardio', 'Resistencia', 'Accesorios', 'Funcional', 'Box', 'Recuperación'];
  var SORTS = [['rel', 'Destacados'], ['asc', 'Precio ↑'], ['desc', 'Precio ↓']];
  var HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var state = { cat: 'Todo', color: null, sort: 'rel', favs: {} };

  function byId(id) { return document.getElementById(id); }

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chipStyle(on, padding) {
    return 'min-height: 40px; padding: 0 ' + padding + 'px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; ' +
      'border: 1px solid ' + (on ? '#111111' : '#CCCCCC') + '; background: ' + (on ? '#111111' : '#ffffff') + '; color: ' + (on ? '#ffffff' : '#111111');
  }

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function chip(label, on, padding, onClick) {
    var button = el('button', chipStyle(on, padding), label);
    button.setAttribute('aria-pressed', String(on));
    button.addEventListener('click', onClick);
    return button;
  }

  function heartIcon(fav) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', fav ? ACCENT : 'none');
    svg.setAttribute('stroke', fav ? ACCENT : '#111111');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', HEART);
    svg.appendChild(path);
    return svg;
  }

  function badge(text, style) {
    return el('span', 'position: absolute; left: 0; color: #111111; font-size: 12px; font-weight: 700; padding: 6px 10px; text-transform: uppercase; letter-spacing: 0.03em; ' + style, text);
  }

  function productCard(p) {
    var fav = !!state.favs[p.id];
    var card = el('article', 'display: flex; flex-direction: column; min-width: 0');

    var media = el('div', 'position: relative; aspect-ratio: 1 / 1; background: #E6F2F1; overflow: hidden');
    var img = el('img', 'width: 100%; height: 100%; object-fit: cover; display: block');
    img.src = IMG + p.img;
    img.alt = p.name;
    img.loading = 'lazy';
    media.appendChild(img);

    var favButton = el('button', 'position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; border: 0; background: rgba(255,255,255,0.9); cursor: pointer; display: grid; place-items: center');
    favButton.setAttribute('aria-pressed', String(fav));
    favButton.setAttribute('aria-label', 'Agregar a favoritos');
    favButton.appendChild(heartIcon(fav));
    favButton.addEventListener('click', function () {
      var favs = Object.assign({}, state.favs);
      favs[p.id] = !favs[p.id];
      setState({ favs: favs });
    });
    media.appendChild(favButton);

    if (p.stock <= 2) media.appendChild(badge('Últimas unidades', 'bottom: 0; background: ' + ACCENT));
    if (p.top && p.stock > 2) media.appendChild(badge('Más vendido', 'top: 8px; background: #FFC93C'));
    card.appendChild(media);

    var swatches = el('div', 'display: flex; gap: 6px; padding: 10px 0 6px');
    p.colors.forEach(function (key) {
      var swatch = el('span', 'width: 16px; height: 16px; border-radius: 50%; border: 1px solid #BDBDBD; background: ' + COLORS[key][1]);
      swatch.title = COLORS[key][0];
      swatches.appendChild(swatch);
    });
    card.appendChild(swatches);

    card.appendChild(el('div', 'font-size: 15px; font-weight: 700', 'S/ ' + p.price.toFixed(2)));
    card.appendChild(el('h3', 'margin: 4px 0 2px; font-size: 14px; font-weight: 500; line-height: 1.35', p.name));
    card.appendChild(el('div', 'font-size: 13px; color: #555555', p.cat + ' · ' + (p.colors.length === 1 ? '1 color' : p.colors.length + ' colores')));
    return card;
  }

  function visibleProducts() {
    var list = PRODUCTS.filter(function (p) {
      return (state.cat === 'Todo' || p.cat === state.cat) && (!state.color || p.colors.indexOf(state.color) >= 0);
    });
    if (state.sort === 'asc') list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (state.sort === 'desc') list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }

  function renderFilters() {
    byId('cats').replaceChildren.apply(byId('cats'), CATEGORIES.map(function (name) {
      return chip(name, state.cat === name, 16, function () { setState({ cat: name }); });
    }));

    var sorts = byId('sorts');
    var sortLabel = sorts.firstElementChild;
    sorts.replaceChildren.apply(sorts, [sortLabel].concat(SORTS.map(function (s) {
      return chip(s[1], state.sort === s[0], 12, function () { setState({ sort: s[0] }); });
    })));

    byId('color-filters').replaceChildren.apply(byId('color-filters'), Object.keys(COLORS).map(function (key) {
      var on = state.color === key;
      var button = el('button', 'width: 36px; height: 36px; border-radius: 50%; cursor: pointer; padding: 0; background: ' + COLORS[key][1] + '; border: 2px solid #ffffff; box-shadow: 0 0 0 ' + (on ? '2px #111111' : '1px #BDBDBD'));
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', COLORS[key][0]);
      button.title = COLORS[key][0];
      button.addEventListener('click', function () { setState({ color: on ? null : key }); });
      return button;
    }));

    var clear = byId('clear-color');
    clear.hidden = !state.color;
    clear.textContent = state.color ? 'Quitar color: ' + COLORS[state.color][0] : '';
  }

  function renderProducts() {
    var list = visibleProducts();
    var grid = byId('grid');
    var promo = byId('promo');

    grid.replaceChildren.apply(grid, [promo].concat(list.map(productCard)));
    promo.hidden = !(state.cat === 'Todo' && !state.color);
    byId('count').textContent = '[' + list.length + ']';
    byId('empty').hidden = list.length !== 0;

    var favCount = Object.keys(state.favs).filter(function (k) { return state.favs[k]; }).length;
    var favBadge = byId('fav-badge');
    favBadge.hidden = favCount === 0;
    favBadge.textContent = favCount;
  }

  function render() {
    renderFilters();
    renderProducts();
  }

  byId('clear-color').addEventListener('click', function () { setState({ color: null }); });
  render();
})();
