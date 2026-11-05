(function () {
  'use strict';

  var ACCENT = '#FF4670';
  var IMG = 'assets/img/';
  var CART_KEY = 'treno.cart';
  var FAVS_KEY = 'treno.favs';

  var COLORS = {
    rosado: ['Rosado', '#F4A6C1'], negro: ['Negro', '#1A1A1A'], rojo: ['Rojo', '#D32F2F'],
    morado: ['Morado', '#7B4FA0'], plomo: ['Plomo', '#8A8D91'], verde: ['Verde', '#3E9B5A'],
    fucsia: ['Fucsia', '#E0197D'], marino: ['Azul marino', '#1F2F5C'], azul: ['Azul', '#2F6FD1'],
    celeste: ['Celeste', '#6EC6E8'], naranja: ['Naranja', '#F28C28'], amarillo: ['Amarillo', '#F2C94C']
  };
  var CATEGORIES = ['Todo', 'Pesas', 'Yoga', 'Cardio', 'Resistencia', 'Accesorios', 'Funcional', 'Box', 'Recuperación'];
  var SORTS = [['rel', 'Destacados'], ['asc', 'Precio ↑'], ['desc', 'Precio ↓']];
  var PRICE_RANGES = { low: [0, 70], mid: [70, 150], high: [150, Infinity] };
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

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text !== undefined) node.textContent = text;
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

  function chip(label, on, padding, onClick) {
    var button = el('button', 'min-height: 40px; padding: 0 ' + padding + 'px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid ' + (on ? '#111111' : '#CCCCCC') + '; background: ' + (on ? '#111111' : '#ffffff') + '; color: ' + (on ? '#ffffff' : '#111111'), label);
    button.type = 'button';
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

  function pickedColor(p) {
    return state.picked[p.id] && p.colors.indexOf(state.picked[p.id]) >= 0 ? state.picked[p.id] : p.colors[0];
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

  function productCard(p) {
    var fav = !!state.favs[p.id];
    var color = pickedColor(p);
    var card = el('article', 'display: flex; flex-direction: column; min-width: 0');

    var media = el('div', 'position: relative; aspect-ratio: 1 / 1; background: #E6F2F1; overflow: hidden');
    var img = el('img', 'width: 100%; height: 100%; object-fit: cover; display: block');
    img.src = IMG + p.img;
    img.alt = p.name;
    img.loading = 'lazy';
    img.addEventListener('error', function () { img.hidden = true; });
    media.appendChild(img);

    var favButton = el('button', 'position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; border: 0; background: rgba(255,255,255,0.9); cursor: pointer; display: grid; place-items: center');
    favButton.type = 'button';
    favButton.setAttribute('aria-pressed', String(fav));
    favButton.setAttribute('aria-label', (fav ? 'Quitar de favoritos: ' : 'Agregar a favoritos: ') + p.name);
    favButton.appendChild(heartIcon(fav));
    favButton.addEventListener('click', function () {
      var favs = Object.assign({}, state.favs);
      if (favs[p.id]) delete favs[p.id]; else favs[p.id] = true;
      save(FAVS_KEY, favs);
      setState({ favs: favs });
    });
    media.appendChild(favButton);

    if (!p.inStock) media.appendChild(badge('Agotado', 'bottom: 0; background: #E6E6E6'));
    else if (p.low) media.appendChild(badge('Últimas unidades', 'bottom: 0; background: ' + ACCENT));
    if (p.top && p.inStock && !p.low) media.appendChild(badge('Más vendido', 'top: 8px; background: #FFC93C'));
    card.appendChild(media);

    var swatches = el('div', 'display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 0 6px');
    p.colors.forEach(function (key) {
      var on = key === color;
      var swatch = el('button', 'width: 24px; height: 24px; padding: 0; cursor: pointer; border-radius: 50%; border: 2px solid #ffffff; background: ' + COLORS[key][1] + '; box-shadow: 0 0 0 ' + (on ? '2px #111111' : '1px #BDBDBD'));
      swatch.type = 'button';
      swatch.title = COLORS[key][0];
      swatch.setAttribute('aria-label', 'Color ' + COLORS[key][0] + ' para ' + p.name);
      swatch.setAttribute('aria-pressed', String(on));
      swatch.addEventListener('click', function () {
        var picked = Object.assign({}, state.picked);
        picked[p.id] = key;
        setState({ picked: picked });
      });
      swatches.appendChild(swatch);
    });
    card.appendChild(swatches);

    card.appendChild(el('div', 'font-size: 15px; font-weight: 700', money(p.price)));
    card.appendChild(el('h3', 'margin: 4px 0 2px; font-size: 14px; font-weight: 500; line-height: 1.35', p.name));
    card.appendChild(el('div', 'font-size: 13px; color: #555555', p.cat + ' · ' + COLORS[color][0]));

    var add = el('button', 'margin-top: 10px; min-height: 44px; border: 0; font: inherit; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; cursor: ' + (p.inStock ? 'pointer' : 'not-allowed') + '; background: ' + (p.inStock ? '#111111' : '#E6E6E6') + '; color: ' + (p.inStock ? '#ffffff' : '#555555'), p.inStock ? 'Agregar' : 'Agotado');
    add.type = 'button';
    add.disabled = !p.inStock;
    add.setAttribute('aria-label', (p.inStock ? 'Agregar al carrito: ' : 'Agotado: ') + p.name);
    add.addEventListener('click', function () { addToCart(p); });
    card.appendChild(add);
    return card;
  }

  function visibleProducts() {
    var query = normalize(state.query.trim());
    var ranges = Object.keys(state.prices).filter(function (k) { return state.prices[k]; });
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
      return chip(name, state.cat === name, 16, function () { setState({ cat: name }); });
    }));

    var sorts = byId('sorts');
    fill(sorts, [sorts.firstElementChild].concat(SORTS.map(function (s) {
      return chip(s[1], state.sort === s[0], 12, function () { setState({ sort: s[0] }); });
    })));

    fill(byId('color-filters'), Object.keys(COLORS).map(function (key) {
      var on = state.color === key;
      var button = el('button', 'width: 36px; height: 36px; border-radius: 50%; cursor: pointer; padding: 0; background: ' + COLORS[key][1] + '; border: 2px solid #ffffff; box-shadow: 0 0 0 ' + (on ? '2px #111111' : '1px #BDBDBD'));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', COLORS[key][0]);
      button.title = COLORS[key][0];
      button.addEventListener('click', function () { setState({ color: on ? null : key }); });
      return button;
    }));

    var clear = byId('clear-color');
    clear.hidden = !state.color;
    clear.textContent = state.color ? 'Quitar color: ' + COLORS[state.color][0] : '';

    document.querySelectorAll('[data-nav-cat]').forEach(function (link) {
      link.style.borderBottomColor = link.dataset.navCat === state.cat ? ACCENT : 'transparent';
    });
    byId('favs-toggle').setAttribute('aria-pressed', String(state.onlyFavs));
  }

  function renderProducts() {
    var list = visibleProducts();
    var grid = byId('grid');
    var promo = byId('promo');
    var filtered = state.cat !== 'Todo' || state.color || state.query.trim() || state.onlyFavs ||
      state.inStockOnly || Object.keys(state.prices).some(function (k) { return state.prices[k]; });

    fill(grid, [promo].concat(list.map(productCard)));
    promo.hidden = !!filtered;
    byId('count').textContent = '[' + list.length + ']';

    var empty = byId('empty');
    empty.hidden = state.loadError || !products.length || list.length !== 0;
    byId('load-error').hidden = !state.loadError;

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

  function renderCart() {
    var lines = cartLines();
    var units = lines.reduce(function (sum, e) { return sum + e.line.qty; }, 0);
    var total = lines.reduce(function (sum, e) { return sum + e.line.qty * e.product.price; }, 0);

    var cartBadge = byId('cart-badge');
    cartBadge.hidden = units === 0;
    cartBadge.textContent = units;
    byId('cart-button').setAttribute('aria-label', 'Carrito, ' + units + (units === 1 ? ' producto' : ' productos'));

    fill(byId('cart-lines'), lines.map(function (entry) {
      var line = entry.line;
      var p = entry.product;
      var row = el('li', 'display: flex; flex-direction: column; gap: 8px; padding: 14px 0; border-bottom: 1px solid #E6E6E6');
      var top = el('div', 'display: flex; justify-content: space-between; gap: 12px');
      var info = el('div', 'min-width: 0');
      info.appendChild(el('div', 'font-size: 14px; font-weight: 600', p.name));
      info.appendChild(el('div', 'font-size: 13px; color: #555555', COLORS[line.color] ? COLORS[line.color][0] : line.color));
      top.appendChild(info);
      top.appendChild(el('div', 'font-size: 14px; font-weight: 700; white-space: nowrap', money(p.price * line.qty)));
      row.appendChild(top);

      var controls = el('div', 'display: flex; align-items: center; gap: 4px');
      function change(delta) {
        setCart(state.cart.map(function (l) {
          return l === line ? Object.assign({}, l, { qty: l.qty + delta }) : l;
        }).filter(function (l) { return l.qty > 0; }));
      }
      var buttonStyle = 'width: 44px; height: 44px; border: 1px solid #CCCCCC; background: #ffffff; font: inherit; font-size: 18px; cursor: pointer; color: #111111';
      var minus = el('button', buttonStyle, '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Quitar una unidad de ' + p.name);
      minus.addEventListener('click', function () { change(-1); });
      var plus = el('button', buttonStyle, '+');
      plus.type = 'button';
      plus.disabled = line.qty >= 20;
      plus.setAttribute('aria-label', 'Agregar una unidad de ' + p.name);
      plus.addEventListener('click', function () { change(1); });
      var remove = el('button', 'margin-left: auto; min-height: 44px; border: 0; background: transparent; font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; color: #111111', 'Quitar');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Quitar ' + p.name + ' del carrito');
      remove.addEventListener('click', function () { change(-line.qty); });
      controls.appendChild(minus);
      controls.appendChild(el('span', 'min-width: 32px; text-align: center; font-size: 14px; font-weight: 600', String(line.qty)));
      controls.appendChild(plus);
      controls.appendChild(remove);
      row.appendChild(controls);
      return row;
    }));

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

  function showCheckoutError(message) {
    var error = byId('checkout-error');
    error.textContent = message;
    error.hidden = false;
  }

  function submitOrder(event) {
    event.preventDefault();
    var form = event.target;
    var submit = byId('checkout-submit');
    byId('checkout-error').hidden = true;
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
      var offline = error instanceof TypeError;
      showCheckoutError(offline ? 'No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.' : error.message);
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

  function bindEvents() {
    byId('clear-color').addEventListener('click', function () { setState({ color: null }); });
    byId('search').addEventListener('input', function (e) { setState({ query: e.target.value }); });
    byId('in-stock').addEventListener('change', function (e) { setState({ inStockOnly: e.target.checked }); });
    byId('favs-toggle').addEventListener('click', function () { setState({ onlyFavs: !state.onlyFavs }); });
    byId('cart-button').addEventListener('click', function () {
      byId('cart-done').hidden = true;
      renderCart();
      openCart();
    });
    byId('cart-close').addEventListener('click', function () { byId('cart').close(); });
    byId('checkout').addEventListener('submit', submitOrder);
    document.querySelectorAll('[data-price]').forEach(function (box) {
      box.addEventListener('change', function () {
        var prices = Object.assign({}, state.prices);
        prices[box.dataset.price] = box.checked;
        setState({ prices: prices });
      });
    });
    document.querySelectorAll('[data-cat-link]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
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
