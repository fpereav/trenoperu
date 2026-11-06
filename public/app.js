(function () {
  'use strict';

  var ACCENT = '#FF4670';
  var IMG = 'assets/img/';
  var PACK_ID = 'PACKCH';
  var CART_KEY = 'treno.cart';
  var FAVS_KEY = 'treno.favs';

  var COLORS = window.TRENO_COLORS;
  var CATEGORIES = ['Todo', 'Packs', 'Pesas', 'Yoga', 'Cardio', 'Resistencia', 'Accesorios', 'Funcional', 'Box', 'Recuperación'];
  var PRICE_RANGES = { low: [0, 70], mid: [70, 150], high: [150, Infinity] };
  var COLOR_IMAGES = window.TRENO_COLOR_IMAGES || {};
  var EXTRA_IMAGES = window.TRENO_EXTRA_IMAGES || {};
  var PRODUCT_HASH = /^#producto\/([A-Z0-9]+)$/;
  var HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var products = [];
  var state = {
    cat: 'Todo', color: null, sort: 'rel', query: '', prices: {}, onlyFavs: false,
    favs: load(FAVS_KEY, {}), cart: load(CART_KEY, []), picked: {}, loadError: false,
    detailId: null, detailPhoto: null, loaded: false
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

  // Not every product has a photo yet: a missing file shows the "Foto próximamente" tile.
  function missingPhoto(p) { return IMG + (p.img || 'sin-foto.jpg'); }

  // Fallback when the chosen color has no photo: show another color's, with a note.
  function fallbackPhoto(p) {
    for (var i = 0; i < p.colors.length; i++) {
      var photos = colorPhotos(p, p.colors[i]);
      if (photos.length) return photos[0];
    }
    return missingPhoto(p);
  }

  function urlsOf(photos) {
    return (photos || []).map(function (photo) { return photo.url; });
  }

  // Photos of one color: uploaded ones replace the built-in ones.
  function colorPhotos(p, color) {
    var uploaded = urlsOf((p.photos || {})[color]);
    if (uploaded.length) return uploaded;
    var builtIn = (COLOR_IMAGES[p.id] || {})[color];
    var extras = (EXTRA_IMAGES[p.id] || []).filter(function (extra) { return extra.color === color; });
    return (builtIn ? [IMG + builtIn] : []).concat(extras.map(function (extra) { return IMG + extra.file; }));
  }

  function generalPhotos(p) {
    var uploaded = urlsOf((p.photos || {}).principal);
    if (uploaded.length) return uploaded;
    var extras = (EXTRA_IMAGES[p.id] || []).filter(function (extra) { return !extra.color; }).map(function (extra) {
      return IMG + extra.file;
    });
    // Without per-color photos, the product's main photo applies to every color.
    // Products created in the admin have no built-in photo at all.
    return COLOR_IMAGES[p.id] || !p.img ? extras : [IMG + p.img].concat(extras);
  }

  function hasColorPhotos(p) {
    return p.colors.some(function (color) { return colorPhotos(p, color).length > 0; });
  }

  // What a shopper sees for the chosen color: its photos first, then the general ones.
  function galleryOf(p, color) {
    var list = colorPhotos(p, color).concat(generalPhotos(p));
    return list.filter(function (src, index) { return list.indexOf(src) === index; });
  }

  function productLink(p, className, child) {
    var link = el('a', className);
    link.href = '/producto/' + p.id;
    link.dataset.product = p.id;
    link.setAttribute('aria-label', 'Ver ' + p.name);
    link.appendChild(child);
    return link;
  }

  function productTile(p) {
    var fav = !!state.favs[p.id];
    var tile = el('div', 'tile');

    var img = el('img');
    var color = pickedColor(p);
    var ownPhotos = colorPhotos(p, color);
    img.src = ownPhotos[0] || generalPhotos(p)[0] || (p.img ? missingPhoto(p) : fallbackPhoto(p));
    img.alt = p.name;
    img.loading = 'lazy';
    img.addEventListener('error', function () {
      img.parentNode.replaceChild(el('div', 'tile__empty', 'Foto próximamente'), img);
    });
    tile.appendChild(productLink(p, 'tile__link', img));
    if (hasColorPhotos(p) && !ownPhotos.length) tile.appendChild(el('span', 'tile__note', 'Foto en otro color'));

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
    card.dataset.product = p.id;
    card.appendChild(productTile(p));
    var title = el('h3', 'card__name');
    var titleLink = el('a', '', p.name);
    titleLink.href = '/producto/' + p.id;
    titleLink.dataset.product = p.id;
    title.appendChild(titleLink);
    card.appendChild(title);
    if (p.description) card.appendChild(el('p', 'card__description', p.description));
    card.appendChild(el('div', 'card__meta', p.cat + ' · ' + COLORS[color][0]));
    card.appendChild(fillPrice(el('div', 'card__price'), p));

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

  // Current price, plus the previous one crossed out when there is a discount.
  function fillPrice(node, p) {
    var nodes = [document.createTextNode(money(p.price))];
    if (p.discountPercent > 0) {
      nodes.push(document.createTextNode(' '));
      nodes.push(el('s', 'price-was', money(p.listPrice)));
      nodes.push(document.createTextNode(' '));
      nodes.push(el('span', 'price-off', '-' + Number(p.discountPercent.toFixed(2)) + '%'));
    }
    fill(node, nodes);
    return node;
  }

  function selectColor(p, color) {
    var picked = Object.assign({}, state.picked);
    picked[p.id] = color;
    setState({ picked: picked, detailPhoto: null });
  }

  function renderDetail() {
    var dialog = byId('product');
    var p = products.find(function (item) { return item.id === state.detailId; });
    if (!p) {
      if (dialog.open) dialog.close();
      return;
    }

    var color = pickedColor(p);
    var gallery = galleryOf(p, color);
    var mainSrc = gallery.indexOf(state.detailPhoto) >= 0 ? state.detailPhoto : gallery[0] || (p.img ? missingPhoto(p) : fallbackPhoto(p));

    var main = byId('product-image');
    main.alt = p.name;
    main.hidden = false;
    byId('product-image-empty').hidden = true;
    if (main.getAttribute('src') !== mainSrc) main.src = mainSrc;
    byId('product-color-note').hidden = !(hasColorPhotos(p) && !colorPhotos(p, color).length);

    fill(byId('product-thumbs'), gallery.length < 2 ? [] : gallery.map(function (src, index) {
      var thumb = button('product__thumb', undefined, function () { setState({ detailPhoto: src }); });
      thumb.setAttribute('aria-label', 'Ver imagen ' + (index + 1) + ' de ' + gallery.length);
      thumb.setAttribute('aria-pressed', String(src === mainSrc));
      var image = el('img');
      image.src = src;
      image.alt = '';
      image.addEventListener('error', function () { thumb.remove(); });
      thumb.appendChild(image);
      return thumb;
    }));

    byId('product-name').textContent = p.name;
    byId('product-meta').textContent = p.cat + ' · ' + COLORS[color][0];
    fillPrice(byId('product-price'), p);
    var description = byId('product-description');
    description.textContent = p.description;
    description.hidden = !p.description;

    var badge = byId('product-badge');
    badge.textContent = !p.inStock ? 'Agotado' : p.low ? 'Últimas unidades' : '';
    badge.hidden = !badge.textContent;

    fill(byId('product-swatches'), p.colors.map(function (key) {
      var swatch = button('swatch swatch--large', undefined, function () { selectColor(p, key); });
      swatch.style.backgroundColor = COLORS[key][1];
      swatch.title = COLORS[key][0];
      swatch.setAttribute('aria-label', 'Color ' + COLORS[key][0]);
      swatch.setAttribute('aria-pressed', String(key === color));
      return swatch;
    }));

    var add = byId('product-add');
    add.disabled = !p.inStock;
    add.textContent = p.inStock ? 'Agregar al carrito' : 'Agotado';
    if (!dialog.open) dialog.showModal();
  }

  function syncDetailWithHash() {
    var match = PRODUCT_HASH.exec(location.hash);
    var id = match ? match[1] : null;
    if (id !== state.detailId) setState({ detailId: id, detailPhoto: null });
    else renderDetail();
  }

  function closeDetail() {
    var dialog = byId('product');
    if (dialog.open) dialog.close();
    if (PRODUCT_HASH.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (state.detailId) setState({ detailId: null, detailPhoto: null });
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
    // Only categories with something on sale.
    var added = [];
    products.forEach(function (p) {
      if (CATEGORIES.indexOf(p.cat) < 0 && added.indexOf(p.cat) < 0) added.push(p.cat);
    });
    fill(byId('cats'), CATEGORIES.concat(added).filter(function (name) {
      return name === 'Todo' || name === state.cat || !state.loaded ||
        products.some(function (p) { return p.cat === name; });
    }).map(function (name) {
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

    var active = activePriceRanges().length + (state.color ? 1 : 0);
    byId('filters-count').textContent = active ? ' (' + active + ')' : '';
    byId('favs-toggle').setAttribute('aria-pressed', String(state.onlyFavs));
  }

  function hasActiveFilters() {
    return state.cat !== 'Todo' || !!state.color || !!state.query.trim() || state.onlyFavs ||
      activePriceRanges().length > 0;
  }

  function renderProducts() {
    var list = visibleProducts();
    fill(byId('grid'), list.map(productCard));
    var pack = products.find(function (p) { return p.id === PACK_ID; });
    // Before the catalog loads, keep the banner; once loaded, it needs the pack on sale.
    byId('promo').hidden = hasActiveFilters() || (state.loaded && !pack);
    byId('count').textContent = products.length ? list.length + (list.length === 1 ? ' producto' : ' productos') : '';
    byId('empty').hidden = state.loadError || !state.loaded || list.length !== 0;
    byId('load-error').hidden = !state.loadError;

    byId('hero-add').disabled = !pack;

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
    renderDetail();
  }

  function openCart() {
    closeDetail();
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
      byId('done-whatsapp').href = 'https://wa.me/51957503022?text=' + encodeURIComponent(
        'Hola, pagué con Yape mi pedido #' + body.order + ' por ' + money(body.total) + '. Adjunto mi constancia.'
      );
      byId('cart-done').hidden = false;
      setCart([]);
      loadProducts();
    }).catch(function (error) {
      errorBox.textContent = error instanceof TypeError ? 'No pudimos conectarnos. Revisa tu internet e inténtalo de nuevo.' : error.message;
      errorBox.hidden = false;
      loadProducts();
    }).finally(function () {
      submit.disabled = false;
      submit.textContent = 'Confirmar y ver QR de Yape';
    });
  }

  function loadProducts() {
    return fetch('/api/products').then(function (response) {
      if (!response.ok) throw new Error('products ' + response.status);
      return response.json();
    }).then(function (list) {
      products = list;
      // Drop cart lines for products no longer on sale or colors no longer offered.
      var validCart = state.cart.filter(function (line) {
        var product = products.find(function (item) { return item.id === line.id; });
        return product && product.colors.indexOf(line.color) >= 0;
      });
      if (validCart.length !== state.cart.length) {
        save(CART_KEY, validCart);
        state.cart = validCart;
      }
      setState({ loadError: false, loaded: true });
      syncDetailWithHash();
    }).catch(function () {
      if (!products.length) setState({ loadError: true });
    });
  }

  function clearFilters() {
    byId('search').value = '';
    document.querySelectorAll('[data-price]').forEach(function (box) { box.checked = false; });
    setState({ cat: 'Todo', color: null, query: '', prices: {}, onlyFavs: false });
  }

  function bindEvents() {
    byId('clear-color').addEventListener('click', function () { setState({ color: null }); });
    byId('clear-filters').addEventListener('click', clearFilters);
    byId('search').addEventListener('input', function (e) { setState({ query: e.target.value }); });
    byId('sort').addEventListener('change', function (e) { setState({ sort: e.target.value }); });
    byId('favs-toggle').addEventListener('click', function () { setState({ onlyFavs: !state.onlyFavs }); });
    byId('cart-button').addEventListener('click', function () {
      // Keep the payment QR available if the shopper closed the cart before paying.
      renderCart();
      openCart();
    });
    byId('cart-close').addEventListener('click', function () { byId('cart').close(); });
    byId('hero-add').addEventListener('click', function () {
      var pack = products.find(function (p) { return p.id === PACK_ID; });
      if (pack && pack.inStock) addToCart(pack);
    });
    byId('checkout').addEventListener('submit', submitOrder);
    window.addEventListener('hashchange', syncDetailWithHash);
    // Links are real pages for search engines; here they open the product in place.
    byId('grid').addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      var link = event.target.closest('a[data-product]');
      // Modified clicks on a link keep opening the product page in a new tab.
      if (link && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
      var card = event.target.closest('.card');
      if (!card) return;
      event.preventDefault();
      location.hash = '#producto/' + card.dataset.product;
    });
    byId('product-close').addEventListener('click', closeDetail);
    // Covers Esc. The event can arrive late, so ignore it if another product opened meanwhile.
    byId('product').addEventListener('close', function () {
      if (!byId('product').open) closeDetail();
    });
    byId('product').addEventListener('click', function (event) {
      if (event.target === byId('product')) closeDetail();
    });
    byId('product-add').addEventListener('click', function () {
      var p = products.find(function (item) { return item.id === state.detailId; });
      if (p && p.inStock) addToCart(p);
    });
    byId('product-image').addEventListener('error', function () {
      byId('product-image').hidden = true;
      byId('product-image-empty').hidden = false;
    });
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
