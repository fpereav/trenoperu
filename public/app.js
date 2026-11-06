(function () {
  'use strict';

  var ACCENT = '#FF4670';
  var IMG = 'assets/img/';
  var PACK_ID = 'PACKCH';
  var CART_KEY = 'treno.cart';
  var FAVS_KEY = 'treno.favs';

  var COLORS = {
    rosado: ['Rosado', '#F4A6C1'], negro: ['Negro', '#1A1A1A'], rojo: ['Rojo', '#D32F2F'],
    morado: ['Morado', '#7B4FA0'], plomo: ['Plomo', '#8A8D91'], verde: ['Verde', '#3E9B5A'],
    fucsia: ['Fucsia', '#E0197D'], marino: ['Azul marino', '#1F2F5C'], azul: ['Azul', '#2F6FD1'],
    celeste: ['Celeste', '#6EC6E8'], naranja: ['Naranja', '#F28C28'], amarillo: ['Amarillo', '#F2C94C']
  };
  var CATEGORIES = ['Todo', 'Packs', 'Pesas', 'Yoga', 'Cardio', 'Resistencia', 'Accesorios', 'Funcional', 'Box', 'Recuperación'];
  var PRICE_RANGES = { low: [0, 70], mid: [70, 150], high: [150, Infinity] };
  // Photos per product color; a missing color falls back to the main photo with a note.
  var COLOR_IMAGES = {
    KETPVC: { rosado: 'kettlebell-pvc.jpg', negro: 'kettlebell-pvc-negro.jpg', rojo: 'kettlebell-pvc-rojo.jpg' },
    MANVIN: { rosado: 'mancuerna-vinilo.jpg', morado: 'mancuerna-vinilo-morado.jpg', rojo: 'mancuerna-vinilo-rojo.jpg' },
    MATGOM: { rosado: 'mat-goma-eva.jpg', fucsia: 'mat-goma-eva-fucsia.jpg', verde: 'mat-goma-eva-verde.jpg' },
    TOBPLA: { rosado: 'tobillera-peso.jpg', negro: 'tobillera-peso-negro.jpg', azul: 'tobillera-peso-azul.jpg' },
    CHASIN: { rosado: 'chaleco-peso.jpg', negro: 'chaleco-peso-negro.jpg', verde: 'chaleco-peso-verde.jpg', plomo: 'chaleco-peso-plomo.jpg' },
    STEPVC: { azul: 'step-pvc.jpg', plomo: 'step-pvc-plomo.jpg' },
    GUAPLA: { rojo: 'guantes-box.jpg', negro: 'guantes-box-negro.jpg' }
  };
  var HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var products = [];
  var state = {
    cat: 'Todo', color: null, sort: 'rel', query: '', prices: {}, inStockOnly: false, onlyFavs: false,
    favs: load(FAVS_KEY, {}), cart: load(CART_KEY, []), picked: {}, loadError: false
  };

  function load(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function byId(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    var node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function money(amount) { return 'S/ ' + amount.toFixed(2); }

  function fill(parent, children) { parent.replaceChildren.apply(parent, children); }

  function normalize(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function setState(patch) {
    Object.assign(state, patch);
    render();
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

  function pickedColor(p) {
    if (state.picked[p.id] && p.colors.indexOf(state.picked[p.id]) >= 0) return state.picked[p.id];
    return state.color && p.colors.indexOf(state.color) >= 0 ? state.color : p.colors[0];
  }

  function addToCart(p) {
    var color = pickedColor(p);
    var cart = state.cart.slice();
    byId('cart-done').hidden = true;
    var line = cart.find(function (l) { return l.id === p.id && l.color === color; });
    if (line) {
      cart[cart.indexOf(line)] = Object.assign({}, line, { qty: Math.min(line.qty + 1, 20) });
    } else {
      cart.push({ id: p.id, color: color, qty: 1 });
    }
    setCart(cart);
    openCart();
  }

  function setCart(cart) {
    save(CART_KEY, cart);
    setState({ cart: cart });
  }

  function productTile(p) {
    var fav = !!state.favs[p.id];
    var tile = el('div', 'tile');

    var img = el('img');
    var photos = COLOR_IMAGES[p.id];
    var color = pickedColor(p);
    var photo = photos && photos[color];
    img.src = IMG + (photo || p.img);
    img.alt = p.name;
    img.loading = 'lazy';
    img.addEventListener('error', function () {
      tile.replaceChild(el('div', 'tile__empty', 'Foto próximamente'), img);
    });
    tile.appendChild(img);
    if (photos && !photo) tile.appendChild(el('span', 'tile__note', 'Foto en otro color'));

    var favButton = button('tile__fav', undefined, function () {
      var favs = Object.assign({}, state.favs);
      if (favs[p.id]) delete favs[p.id]; else favs[p.id] = true;
      save(FAVS_KEY, favs);
      setState({ favs: favs });
    });
    favButton.setAttribute('aria-pressed', String(fav));
    favButton.setAttribute('aria-label', (fav ? 'Quitar de favoritos: ' : 'Agregar a favoritos: ') + p.name);
    favButton.appendChild(heartIcon(fav));
    tile.appendChild(favButton);

    if (!p.inStock) tile.appendChild(el('span', 'tile__badge tile__badge--out', 'Agotado'));
    else if (p.low) tile.appendChild(el('span', 'tile__badge tile__badge--low', 'Últimas unidades'));
    else if (p.top) tile.appendChild(el('span', 'tile__badge tile__badge--top', 'Más vendido'));
    return tile;
  }

  function productCard(p) {
    var color = pickedColor(p);
    var card = el('article', 'card');
    card.appendChild(productTile(p));
    card.appendChild(el('h3', 'card__name', p.name));
    card.appendChild(el('div', 'card__meta', p.cat + ' · ' + COLORS[color][0]));
    card.appendChild(el('div', 'card__price', money(p.price)));

    var swatches = el('div', 'swatches');
    p.colors.forEach(function (key) {
      var swatch = button('swatch', undefined, function () {
        var picked = Object.assign({}, state.picked);
        picked[p.id] = key;
        setState({ picked: picked });
      });
      swatch.style.backgroundColor = COLORS[key][1];
      swatch.title = COLORS[key][0];
      swatch.setAttribute('aria-label', 'Color ' + COLORS[key][0] + ' para ' + p.name);
      swatch.setAttribute('aria-pressed', String(key === color));
      swatches.appendChild(swatch);
    });
    card.appendChild(swatches);

    var add = button('button button--outline', p.inStock ? 'Agregar' : 'Agotado', function () { addToCart(p); });
    add.disabled = !p.inStock;
    add.setAttribute('aria-label', (p.inStock ? 'Agregar al carrito: ' : 'Agotado: ') + p.name);
    card.appendChild(add);
    return card;
  }

  function activePriceRanges() {
    return Object.keys(state.prices).filter(function (k) { return state.prices[k]; });
  }

  function visibleProducts() {
    var query = normalize(state.query.trim());
    var ranges = activePriceRanges();
    var list = products.filter(function (p) {
      if (state.cat !== 'Todo' && p.cat !== state.cat) return false;
      if (state.color && p.colors.indexOf(state.color) < 0) return false;
      if (state.inStockOnly && !p.inStock) return false;
      if (state.onlyFavs && !state.favs[p.id]) return false;
      if (query && normalize(p.name + ' ' + p.cat).indexOf(query) < 0) return false;
      return !ranges.length || ranges.some(function (k) {
        return p.price >= PRICE_RANGES[k][0] && p.price < PRICE_RANGES[k][1];
      });
    });
    if (state.sort === 'asc') list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (state.sort === 'desc') list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }

  function renderFilters() {
    fill(byId('cats'), CATEGORIES.map(function (name) {
      var chip = button('chip', name, function () { setState({ cat: name }); });
      chip.setAttribute('aria-pressed', String(state.cat === name));
      return chip;
    }));

    fill(byId('color-filters'), Object.keys(COLORS).map(function (key) {
      var on = state.color === key;
      var dot = button('dot', undefined, function () { setState({ color: on ? null : key }); });
      dot.style.backgroundColor = COLORS[key][1];
      dot.setAttribute('aria-pressed', String(on));
      dot.setAttribute('aria-label', COLORS[key][0]);
      dot.title = COLORS[key][0];
      return dot;
    }));

    var clear = byId('clear-color');
    clear.hidden = !state.color;
    clear.textContent = state.color ? 'Quitar color: ' + COLORS[state.color][0] : '';

    var active = activePriceRanges().length + (state.color ? 1 : 0) + (state.inStockOnly ? 1 : 0);
    byId('filters-count').textContent = active ? ' (' + active + ')' : '';
    byId('favs-toggle').setAttribute('aria-pressed', String(state.onlyFavs));
  }

  function hasActiveFilters() {
    return state.cat !== 'Todo' || !!state.color || !!state.query.trim() || state.onlyFavs ||
      state.inStockOnly || activePriceRanges().length > 0;
  }

  function renderProducts() {
    var list = visibleProducts();
    fill(byId('grid'), list.map(productCard));
    byId('promo').hidden = hasActiveFilters();
    byId('count').textContent = products.length ? list.length + (list.length === 1 ? ' producto' : ' productos') : '';
    byId('empty').hidden = state.loadError || !products.length || list.length !== 0;
    byId('load-error').hidden = !state.loadError;

    var pack = products.find(function (p) { return p.id === PACK_ID; });
    var heroAdd = byId('hero-add');
    heroAdd.disabled = !pack || !pack.inStock;
    heroAdd.textContent = pack && !pack.inStock ? 'Agotado' : 'Agregar al carrito';

    var favCount = Object.keys(state.favs).length;
    var favBadge = byId('fav-badge');
    favBadge.hidden = favCount === 0;
    favBadge.textContent = favCount;
  }

  function cartLines() {
    return state.cart.map(function (line) {
      return { line: line, product: products.find(function (p) { return p.id === line.id; }) };
    }).filter(function (entry) { return entry.product; });
  }

  function cartLine(entry) {
    var line = entry.line;
    var p = entry.product;

    function change(delta) {
      setCart(state.cart.map(function (l) {
        return l === line ? Object.assign({}, l, { qty: l.qty + delta }) : l;
      }).filter(function (l) { return l.qty > 0; }));
    }

    var row = el('li', 'cart-line');
    var top = el('div', 'cart-line__top');
    var info = el('div');
    info.appendChild(el('div', 'cart-line__name', p.name));
    info.appendChild(el('div', 'cart-line__color', COLORS[line.color] ? COLORS[line.color][0] : line.color));
    top.appendChild(info);
    top.appendChild(el('div', 'cart-line__price', money(p.price * line.qty)));
    row.appendChild(top);

    var controls = el('div', 'cart-line__controls');
    var minus = button('qty-button', '−', function () { change(-1); });
    minus.setAttribute('aria-label', 'Quitar una unidad de ' + p.name);
    var plus = button('qty-button', '+', function () { change(1); });
    plus.disabled = line.qty >= 20;
    plus.setAttribute('aria-label', 'Agregar una unidad de ' + p.name);
    var remove = button('link-button', 'Quitar', function () { change(-line.qty); });
    remove.setAttribute('aria-label', 'Quitar ' + p.name + ' del carrito');
    controls.appendChild(minus);
    controls.appendChild(el('span', 'qty-value', String(line.qty)));
    controls.appendChild(plus);
    controls.appendChild(remove);
    row.appendChild(controls);
    return row;
  }

  function renderCart() {
    var lines = cartLines();
    var units = lines.reduce(function (sum, e) { return sum + e.line.qty; }, 0);
    var total = lines.reduce(function (sum, e) { return sum + e.line.qty * e.product.price; }, 0);

    var cartBadge = byId('cart-badge');
    cartBadge.hidden = units === 0;
    cartBadge.textContent = units;
    byId('cart-button').setAttribute('aria-label', 'Carrito, ' + units + (units === 1 ? ' producto' : ' productos'));

    fill(byId('cart-lines'), lines.map(cartLine));

    var hasLines = lines.length > 0;
    byId('cart-empty').hidden = hasLines || !byId('cart-done').hidden;
    byId('checkout').hidden = !hasLines;
    byId('cart-total').textContent = money(total);
  }

  function render() {
    renderFilters();
    renderProducts();
    renderCart();
  }

  function openCart() {
    var dialog = byId('cart');
    if (!dialog.open) dialog.showModal();
  }

  function submitOrder(event) {
    event.preventDefault();
    var form = event.target;
    var submit = byId('checkout-submit');
    var errorBox = byId('checkout-error');
    errorBox.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Enviando…';

    var data = new FormData(form);
    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.cart,
        customer: {
          name: data.get('name'), phone: data.get('phone'), address: data.get('address'),
          city: data.get('city'), notes: data.get('notes')
        }
      })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || 'No pudimos registrar tu pedido.');
        return body;
      });
    }).then(function (body) {
      form.reset();
      byId('done-order').textContent = '#' + body.order;
      byId('done-total').textContent = money(body.total);
      byId('cart-done').hidden = false;
      setCart([]);
      loadProducts();
    }).catch(function (error) {
      errorBox.textContent = error instanceof TypeError ? 'No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.' : error.message;
      errorBox.hidden = false;
      loadProducts();
    }).finally(function () {
      submit.disabled = false;
      submit.textContent = 'Confirmar pedido';
    });
  }

  function loadProducts() {
    return fetch('/api/products').then(function (response) {
      if (!response.ok) throw new Error('products ' + response.status);
      return response.json();
    }).then(function (list) {
      products = list;
      setState({ loadError: false });
    }).catch(function () {
      if (!products.length) setState({ loadError: true });
    });
  }

  function clearFilters() {
    byId('search').value = '';
    byId('in-stock').checked = false;
    document.querySelectorAll('[data-price]').forEach(function (box) { box.checked = false; });
    setState({ cat: 'Todo', color: null, query: '', prices: {}, inStockOnly: false, onlyFavs: false });
  }

  function bindEvents() {
    byId('clear-color').addEventListener('click', function () { setState({ color: null }); });
    byId('clear-filters').addEventListener('click', clearFilters);
    byId('search').addEventListener('input', function (e) { setState({ query: e.target.value }); });
    byId('sort').addEventListener('change', function (e) { setState({ sort: e.target.value }); });
    byId('in-stock').addEventListener('change', function (e) { setState({ inStockOnly: e.target.checked }); });
    byId('favs-toggle').addEventListener('click', function () { setState({ onlyFavs: !state.onlyFavs }); });
    byId('cart-button').addEventListener('click', function () {
      byId('cart-done').hidden = true;
      renderCart();
      openCart();
    });
    byId('cart-close').addEventListener('click', function () { byId('cart').close(); });
    byId('hero-add').addEventListener('click', function () {
      var pack = products.find(function (p) { return p.id === PACK_ID; });
      if (pack && pack.inStock) addToCart(pack);
    });
    byId('checkout').addEventListener('submit', submitOrder);
    document.querySelectorAll('[data-price]').forEach(function (box) {
      box.addEventListener('change', function () {
        var prices = Object.assign({}, state.prices);
        prices[box.dataset.price] = box.checked;
        setState({ prices: prices });
      });
    });
    document.querySelectorAll('[data-cat-link]').forEach(function (link) {
      link.addEventListener('click', function () {
        clearFilters();
        setState({ cat: link.dataset.catLink });
      });
    });
    document.querySelectorAll('img[data-optional]').forEach(function (img) {
      function hide() { img.hidden = true; }
      img.addEventListener('error', hide);
      if (img.complete && img.naturalWidth === 0) hide();
    });
  }

  bindEvents();
  render();
  loadProducts();
})();
