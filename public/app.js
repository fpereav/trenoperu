(function () {
  'use strict';

  var ACCENT = '#FF4670';
  var IMG = 'assets/img/';
  var CART_KEY = 'treno.cart';
  var FAVS_KEY = 'treno.favs';

  var COLORS = window.TRENO_COLORS;
  var PRICE_RANGES = { low: [0, 70], mid: [70, 150], high: [150, Infinity] };
  var COLOR_IMAGES = window.TRENO_COLOR_IMAGES || {};
  var EXTRA_IMAGES = window.TRENO_EXTRA_IMAGES || {};
  var VIDEOS = window.TRENO_VIDEOS || {};
  var VIDEO_DIR = 'assets/video/';
  var SIZE_IMAGES = window.TRENO_SIZE_IMAGES || {};
  var PRODUCT_HASH = /^#producto\/([A-Z0-9]+)$/;
  var HEART = 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var products = [];
  var state = {
    cat: 'Todo', color: null, sort: 'rel', query: '', prices: {}, onlyFavs: false,
    favs: load(FAVS_KEY, {}), cart: load(CART_KEY, []), picked: {}, loadError: false,
    detailId: null, detailPhoto: null, loaded: false, pickedVariants: {}, cardColors: {}, cartStep: 'items', group: null
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

  // In the catalog each option has its own card, so each remembers its own color.
  function cardKey(p, variant) { return p.id + ':' + variant.id; }

  function pickedColor(p, variant) {
    var own = variant && state.cardColors[cardKey(p, variant)];
    if (own && p.colors.indexOf(own) >= 0) return own;
    if (!variant && state.picked[p.id] && p.colors.indexOf(state.picked[p.id]) >= 0) return state.picked[p.id];
    return state.color && p.colors.indexOf(state.color) >= 0 ? state.color : p.colors[0];
  }

  function pickedVariant(p) {
    var variants = p.variants || [];
    return variants.find(function (v) { return v.id === state.pickedVariants[p.id]; }) || variants[0] || null;
  }

  function addToCart(p, chosenVariant, chosenColor) {
    var color = chosenColor || pickedColor(p);
    var variant = chosenVariant || pickedVariant(p);
    var cart = state.cart.slice();
    byId('cart-done').hidden = true;
    state.cartStep = 'items';
    var line = cart.find(function (l) {
      return l.id === p.id && l.color === color && (l.variant || null) === (variant ? variant.id : null);
    });
    if (line) {
      cart[cart.indexOf(line)] = Object.assign({}, line, { qty: Math.min(line.qty + 1, 20) });
    } else {
      var added = { id: p.id, color: color, qty: 1 };
      if (variant) added.variant = variant.id;
      cart.push(added);
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

  // Photo of the chosen presentation, when its weight has one. Uploaded color photos win.
  function sizePhoto(p, color, chosenVariant) {
    var config = SIZE_IMAGES[p.id];
    var variant = chosenVariant || pickedVariant(p);
    if (!config || !variant || config.colors.indexOf(color) < 0) return null;
    if (urlsOf((p.photos || {})[color]).length) return null;
    var match = /(\d+(?:[.,]\d+)?)\s*kg/i.exec(variant.label);
    var weight = match ? Number(match[1].replace(',', '.')) : NaN;
    if (config.sizes.indexOf(weight) < 0) return null;
    return IMG + config.prefix + '-' + color + '-' + weight + '.jpg';
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
    var size = sizePhoto(p, color);
    // A weight's photo replaces the main ones, which show a different weight.
    var list = size
      ? [size].concat(urlsOf((p.photos || {}).principal), (EXTRA_IMAGES[p.id] || []).filter(function (extra) {
        return !extra.color;
      }).map(function (extra) { return IMG + extra.file; }))
      : colorPhotos(p, color).concat(generalPhotos(p));
    return list.filter(function (src, index) { return list.indexOf(src) === index; });
  }

  function productLink(p, className, child, title) {
    var link = el('a', className);
    link.href = '/producto/' + p.id;
    link.dataset.product = p.id;
    link.setAttribute('aria-label', 'Ver ' + title);
    link.appendChild(child);
    return link;
  }

  function productTile(p, variant, title) {
    var fav = !!state.favs[p.id];
    var tile = el('div', 'tile');

    var img = el('img');
    var color = pickedColor(p, variant);
    var size = variant ? sizePhoto(p, color, variant) : null;
    var ownPhotos = size ? [size] : colorPhotos(p, color);
    img.src = ownPhotos[0] || generalPhotos(p)[0] || (p.img ? missingPhoto(p) : fallbackPhoto(p));
    img.alt = title;
    img.loading = 'lazy';
    img.addEventListener('error', function () {
      img.parentNode.replaceChild(el('div', 'tile__empty', 'Foto próximamente'), img);
    });
    tile.appendChild(productLink(p, 'tile__link', img, title));
    if (variant && SIZE_IMAGES[p.id] && !size && !urlsOf((p.photos || {})[color]).length) {
      tile.appendChild(el('span', 'tile__note', 'Foto referencial'));
    } else if (hasColorPhotos(p) && !ownPhotos.length) {
      tile.appendChild(el('span', 'tile__note', 'Foto en otro color'));
    }

    var favButton = button('tile__fav', undefined, function () {
      var favs = Object.assign({}, state.favs);
      if (favs[p.id]) delete favs[p.id]; else favs[p.id] = true;
      save(FAVS_KEY, favs);
      setState({ favs: favs });
    });
    favButton.setAttribute('aria-pressed', String(fav));
    favButton.setAttribute('aria-label', (fav ? 'Quitar de favoritos: ' : 'Agregar a favoritos: ') + title);
    favButton.appendChild(heartIcon(fav));
    tile.appendChild(favButton);

    if (!p.inStock) tile.appendChild(el('span', 'tile__badge tile__badge--out', 'Agotado'));
    else if (variant ? variant.low : p.low) tile.appendChild(el('span', 'tile__badge tile__badge--low', 'Últimas unidades'));
    else if (p.top && !variant) tile.appendChild(el('span', 'tile__badge tile__badge--top', 'Más vendido'));
    return tile;
  }

  function productCard(entry) {
    var p = entry.product;
    var variant = entry.variant;
    var title = variant ? p.name + ' ' + variant.label : p.name;
    var color = pickedColor(p, variant);
    var card = el('article', 'card');
    card.dataset.product = p.id;
    if (variant) card.dataset.variant = variant.id;
    card.dataset.color = color;
    card.appendChild(productTile(p, variant, title));
    var heading = el('h3', 'card__name');
    var titleLink = el('a', '', title);
    titleLink.href = '/producto/' + p.id;
    titleLink.dataset.product = p.id;
    heading.appendChild(titleLink);
    card.appendChild(heading);
    card.appendChild(el('div', 'card__meta', p.cat + ' · ' + COLORS[color][0]));
    card.appendChild(fillPrice(el('div', 'card__price'), variant || p));

    var swatches = el('div', 'swatches');
    p.colors.forEach(function (key) {
      var swatch = button('swatch', undefined, function () {
        if (variant) {
          var colors = Object.assign({}, state.cardColors);
          colors[cardKey(p, variant)] = key;
          setState({ cardColors: colors });
        } else {
          var picked = Object.assign({}, state.picked);
          picked[p.id] = key;
          setState({ picked: picked });
        }
      });
      window.trenoPaint(swatch, COLORS[key][1]);
      swatch.title = COLORS[key][0];
      swatch.setAttribute('aria-label', 'Color ' + COLORS[key][0] + ' para ' + title);
      swatch.setAttribute('aria-pressed', String(key === color));
      swatches.appendChild(swatch);
    });
    card.appendChild(swatches);

    var add = button('button button--outline', p.inStock ? 'Agregar' : 'Agotado', function () {
      addToCart(p, variant, color);
    });
    add.disabled = !p.inStock;
    add.setAttribute('aria-label', (p.inStock ? 'Agregar al carrito: ' : 'Agotado: ') + title);
    card.appendChild(add);
    return card;
  }

  // Current price, plus the previous one crossed out when there is a discount.
  function fillPrice(node, p) {
    var nodes = [document.createTextNode((p.priceFrom ? 'Desde ' : '') + money(p.price))];
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

    var video = VIDEOS[p.id];
    var videoSrc = video ? VIDEO_DIR + video.file : null;
    var showVideo = !!videoSrc && state.detailPhoto === videoSrc;
    var player = byId('product-video');
    var main = byId('product-image');
    main.alt = p.name;
    main.hidden = showVideo;
    byId('product-image-empty').hidden = true;
    if (main.getAttribute('src') !== mainSrc) main.src = mainSrc;
    if (showVideo) {
      if (player.getAttribute('src') !== videoSrc) {
        player.poster = VIDEO_DIR + video.poster;
        player.src = videoSrc;
      }
    } else if (player.getAttribute('src')) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    player.hidden = !showVideo;
    var note = byId('product-color-note');
    var otherColor = hasColorPhotos(p) && !colorPhotos(p, color).length;
    var otherSize = SIZE_IMAGES[p.id] && (p.variants || []).length && !sizePhoto(p, color) && !urlsOf((p.photos || {})[color]).length;
    note.textContent = otherSize ? 'Foto referencial de otro tamaño' : 'Foto en otro color';
    note.hidden = !(otherColor || otherSize);

    var thumbs = gallery.length < 2 && !videoSrc ? [] : gallery.map(function (src, index) {
      var thumb = button('product__thumb', undefined, function () { setState({ detailPhoto: src }); });
      thumb.setAttribute('aria-label', 'Ver imagen ' + (index + 1) + ' de ' + gallery.length);
      thumb.setAttribute('aria-pressed', String(!showVideo && src === mainSrc));
      var image = el('img');
      image.src = src;
      image.alt = '';
      image.addEventListener('error', function () { thumb.remove(); });
      thumb.appendChild(image);
      return thumb;
    });
    if (videoSrc) {
      var videoThumb = button('product__thumb product__thumb--video', undefined, function () { setState({ detailPhoto: videoSrc }); });
      videoThumb.setAttribute('aria-label', 'Ver video del producto');
      videoThumb.setAttribute('aria-pressed', String(showVideo));
      var poster = el('img');
      poster.src = VIDEO_DIR + video.poster;
      poster.alt = '';
      videoThumb.appendChild(poster);
      thumbs.push(videoThumb);
    }
    fill(byId('product-thumbs'), thumbs);

    byId('product-name').textContent = p.name;
    byId('product-meta').textContent = p.cat + ' · ' + COLORS[color][0];
    var variant = pickedVariant(p);
    fillPrice(byId('product-price'), variant || p);
    var optionsBox = byId('product-options');
    optionsBox.hidden = !variant;
    fill(byId('product-variants'), (p.variants || []).map(function (option) {
      var chip = button('option-chip', option.label, function () {
        var picked = Object.assign({}, state.pickedVariants);
        picked[p.id] = option.id;
        setState({ pickedVariants: picked, detailPhoto: null });
      });
      chip.setAttribute('aria-pressed', String(variant && option.id === variant.id));
      return chip;
    }));
    var description = byId('product-description');
    description.textContent = p.description;
    description.hidden = !p.description;

    var badge = byId('product-badge');
    badge.textContent = !p.inStock ? 'Agotado' : (variant ? variant.low : p.low) ? 'Últimas unidades' : '';
    badge.hidden = !badge.textContent;

    fill(byId('product-swatches'), p.colors.map(function (key) {
      var swatch = button('swatch swatch--large', undefined, function () { selectColor(p, key); });
      window.trenoPaint(swatch, COLORS[key][1]);
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

  // Catalog groups, in display order, detected from the product name.
  var PRODUCT_GROUPS = [
    ['Packs', /\bpacks?\b/],
    ['Pesas rusas', /pesas? rusas?|kettlebell/],
    ['Mancuernas', /mancuerna/],
    ['Chalecos con peso', /chaleco/],
    ['Tobilleras', /tobillera/],
    ['Funcional', /\btrx\b|rueda abdominal/],
    ['Mats', /\bmats?\b/],
    ['Bandas de resistencia', /\bbandas?\b/],
    ['Sogas para saltar', /\bsogas?\b/],
    ['Steps', /\bsteps?\b/],
    ['Guantes de box', /guantes?/],
    ['Rollers', /\brollers?\b/]
  ];

  // Products that match no group fall under their category, after the known groups.
  function groupNameOf(p) {
    var name = normalize(p.name);
    var match = PRODUCT_GROUPS.find(function (group) { return group[1].test(name); });
    return match ? match[0] : p.cat;
  }

  function groupedEntries(list) {
    var groups = [];
    list.forEach(function (entry) {
      var name = groupNameOf(entry.product);
      var group = groups.find(function (g) { return g.name === name; });
      if (!group) {
        group = { name: name, entries: [] };
        groups.push(group);
      }
      group.entries.push(entry);
    });
    function rank(group) {
      var index = PRODUCT_GROUPS.findIndex(function (known) { return known[0] === group.name; });
      return index < 0 ? PRODUCT_GROUPS.length : index;
    }
    return groups.sort(function (a, b) { return rank(a) - rank(b); });
  }

  function groupPhoto(entry) {
    var p = entry.product;
    var color = pickedColor(p, entry.variant);
    var size = entry.variant ? sizePhoto(p, color, entry.variant) : null;
    return size || colorPhotos(p, color)[0] || generalPhotos(p)[0] || fallbackPhoto(p);
  }

  function renderGroups() {
    var groups = groupedEntries(catalogEntries());
    var section = byId('groups');
    section.hidden = groups.length === 0 || hasActiveFilters();
    fill(byId('groups-grid'), groups.map(function (group) {
      var tile = button('group-tile', undefined, function () { pickGroup(group.name); });
      var media = el('span', 'group-tile__media');
      var image = el('img');
      image.src = groupPhoto(group.entries[0]);
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', function () { image.remove(); });
      media.appendChild(image);
      tile.appendChild(media);
      tile.appendChild(el('span', 'group-tile__name', group.name));
      tile.appendChild(el('span', 'group-tile__count', group.entries.length + (group.entries.length === 1 ? ' producto' : ' productos')));
      return tile;
    }));
  }

  // The menu lists the same groups as the home tiles, after "Conócenos".
  var navGroupNames = '';
  function renderNav() {
    var groups = groupedEntries(catalogEntries());
    var names = groups.map(function (group) { return group.name; });
    var container = byId('nav-groups');
    if (names.join('|') !== navGroupNames) {
      navGroupNames = names.join('|');
      fill(container, names.map(function (name) {
        var link = el('a', undefined, name);
        link.href = '#catalogo';
        link.dataset.group = name;
        link.addEventListener('click', function (event) {
          event.preventDefault();
          clearFilters();
          pickGroup(name);
        });
        return link;
      }));
    }
    container.querySelectorAll('a').forEach(function (link) {
      if (link.dataset.group === state.group) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  // Promo banners that change by themselves. Each one needs its pack on sale.
  var heroIndex = 0;
  var heroPaused = false;
  var heroChangedAt = Date.now();
  function heroSlides() {
    return Array.prototype.filter.call(document.querySelectorAll('.hero__slide'), function (slide) { return !slide.hidden; });
  }

  function showSlide(index) {
    var slides = heroSlides();
    if (!slides.length) return;
    heroIndex = (index + slides.length) % slides.length;
    heroChangedAt = Date.now();
    byId('hero-track').style.transform = 'translateX(' + (-100 * heroIndex) + '%)';
    slides.forEach(function (slide, i) {
      slide.setAttribute('aria-label', (i + 1) + ' de ' + slides.length);
      slide.inert = i !== heroIndex;
    });
    byId('hero-dots').querySelectorAll('button').forEach(function (dot, i) {
      dot.setAttribute('aria-pressed', String(i === heroIndex));
    });
  }

  // Drag with the mouse or swipe with a finger to change banners. Trackpads scroll sideways.
  function bindHeroSwipe() {
    var viewport = document.querySelector('.hero__viewport');
    var track = byId('hero-track');
    var startX = 0, startY = 0, dx = 0, dragging = false, moved = false, pointerId = null;

    function moveTo(offset) {
      track.style.transform = 'translateX(calc(' + (-100 * heroIndex) + '% + ' + offset + 'px))';
    }

    viewport.addEventListener('pointerdown', function (event) {
      if (heroSlides().length < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
      dragging = true; moved = false; dx = 0; pointerId = event.pointerId;
      startX = event.clientX; startY = event.clientY;
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!dragging || event.pointerId !== pointerId) return;
      dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!moved) {
        // A mostly vertical move is a page scroll, not a banner swipe.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) { dragging = false; return; }
        if (Math.abs(dx) < 8) return;
        moved = true;
        track.classList.add('is-dragging');
        viewport.setPointerCapture(pointerId);
      }
      event.preventDefault();
      moveTo(dx);
      heroChangedAt = Date.now();
    });
    function finish() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-dragging');
      if (!moved) return;
      var threshold = Math.min(80, viewport.clientWidth * 0.15);
      if (dx < -threshold) showSlide(heroIndex + 1);
      else if (dx > threshold) showSlide(heroIndex - 1);
      else showSlide(heroIndex);
    }
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
    // After a drag, the release must not open a link or press a button.
    viewport.addEventListener('click', function (event) {
      if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
    }, true);
    viewport.addEventListener('dragstart', function (event) { event.preventDefault(); });

    var wheelLock = 0;
    viewport.addEventListener('wheel', function (event) {
      if (heroSlides().length < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (Date.now() < wheelLock || Math.abs(event.deltaX) < 20) return;
      wheelLock = Date.now() + 700;
      showSlide(heroIndex + (event.deltaX > 0 ? 1 : -1));
    }, { passive: false });
  }

  var heroKey = '';
  function renderHero() {
    var available = 0;
    document.querySelectorAll('.hero__slide').forEach(function (slide) {
      var pack = products.find(function (p) { return p.id === slide.dataset.pack; });
      // Before the catalog loads, keep the first banner only.
      slide.hidden = state.loaded ? !pack : slide !== document.querySelector('.hero__slide');
      slide.querySelector('[data-pack-add]').disabled = !pack;
      if (!slide.hidden) available += 1;
    });
    byId('promo').hidden = hasActiveFilters() || available === 0;
    var key = heroSlides().map(function (slide) { return slide.dataset.pack; }).join('|');
    if (key === heroKey) return;
    heroKey = key;
    var slides = heroSlides();
    var dots = byId('hero-dots');
    dots.hidden = slides.length < 2;
    fill(dots, slides.map(function (slide, i) {
      var dot = button('hero__dot', undefined, function () { showSlide(i); });
      dot.setAttribute('aria-label', 'Promoción ' + (i + 1));
      return dot;
    }));
    showSlide(0);
  }

  function pickGroup(name) {
    setState({ group: name, cat: 'Todo' });
    byId('catalogo').scrollIntoView();
  }

  // One catalog entry per option, or one for a product without options.
  function catalogEntries() {
    var entries = [];
    products.forEach(function (p) {
      var variants = p.variants || [];
      if (!variants.length) entries.push({ product: p, variant: null, price: p.price, text: p.name + ' ' + p.cat });
      variants.forEach(function (variant) {
        entries.push({ product: p, variant: variant, price: variant.price, text: p.name + ' ' + variant.label + ' ' + p.cat });
      });
    });
    return entries;
  }

  function visibleProducts() {
    var query = normalize(state.query.trim());
    var ranges = activePriceRanges();
    var list = catalogEntries().filter(function (entry) {
      var p = entry.product;
      if (state.group && groupNameOf(p) !== state.group) return false;
      if (state.cat !== 'Todo' && p.cat !== state.cat) return false;
      if (state.color && p.colors.indexOf(state.color) < 0) return false;
      if (state.onlyFavs && !state.favs[p.id]) return false;
      if (query && normalize(entry.text).indexOf(query) < 0) return false;
      return !ranges.length || ranges.some(function (k) {
        return entry.price >= PRICE_RANGES[k][0] && entry.price < PRICE_RANGES[k][1];
      });
    });
    if (state.sort === 'asc') list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (state.sort === 'desc') list = list.slice().sort(function (a, b) { return b.price - a.price; });
    return list;
  }

  function renderFilters() {
    // The same groups as the home tiles and the menu, only those with something on sale.
    var names = groupedEntries(catalogEntries()).map(function (group) { return group.name; });
    if (state.group && names.indexOf(state.group) < 0) names.push(state.group);
    // "Todo" only makes sense inside a search, favorites or a color or price filter.
    var otherFilters = !!state.query.trim() || state.onlyFavs || !!state.color || activePriceRanges().length > 0;
    fill(byId('cats'), (otherFilters ? ['Todo'] : []).concat(names).map(function (name) {
      var all = name === 'Todo';
      var chip = button('chip', name, function () { setState({ group: all ? null : name, cat: 'Todo' }); });
      chip.setAttribute('aria-pressed', String(all ? !state.group && state.cat === 'Todo' : state.group === name));
      return chip;
    }));

    fill(byId('color-filters'), Object.keys(COLORS).map(function (key) {
      var on = state.color === key;
      var dot = button('dot', undefined, function () { setState({ color: on ? null : key }); });
      window.trenoPaint(dot, COLORS[key][1]);
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
    return !!state.group || state.cat !== 'Todo' || !!state.color || !!state.query.trim() || state.onlyFavs ||
      activePriceRanges().length > 0;
  }

  function renderProducts() {
    var list = visibleProducts();
    fill(byId('grid'), list.map(productCard));
    renderGroups();
    renderNav();
    // The home shows only the groups. The product list appears after a group, a search or favorites is chosen.
    var browsing = hasActiveFilters();
    byId('catalogo').hidden = !browsing && !state.loadError;
    var title = byId('catalog-title');
    if (state.group) title.textContent = state.group;
    else if (state.query.trim()) title.textContent = 'Resultados de “' + state.query.trim() + '”';
    else if (state.onlyFavs) title.textContent = 'Tus favoritos';
    else fill(title, [document.createTextNode('Nuestro '), el('span', undefined, 'catálogo')]);
    byId('show-all').hidden = !browsing;
    renderHero();
    byId('count').textContent = products.length ? list.length + (list.length === 1 ? ' producto' : ' productos') : '';
    byId('empty').hidden = state.loadError || !state.loaded || list.length !== 0;
    byId('load-error').hidden = !state.loadError;

    var favCount = Object.keys(state.favs).length;
    var favBadge = byId('fav-badge');
    favBadge.hidden = favCount === 0;
    favBadge.textContent = favCount;
  }

  function cartLines() {
    return state.cart.map(function (line) {
      var product = products.find(function (p) { return p.id === line.id; });
      var variant = product && (product.variants || []).find(function (v) { return v.id === line.variant; });
      return { line: line, product: product, variant: variant, price: variant ? variant.price : product && product.price };
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
    info.appendChild(el('div', 'cart-line__name', entry.variant ? p.name + ' · ' + entry.variant.label : p.name));
    info.appendChild(el('div', 'cart-line__color', COLORS[line.color] ? COLORS[line.color][0] : line.color));
    top.appendChild(info);
    top.appendChild(el('div', 'cart-line__price', money(entry.price * line.qty)));
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
    var total = lines.reduce(function (sum, e) { return sum + e.line.qty * e.price; }, 0);

    var cartBadge = byId('cart-badge');
    cartBadge.hidden = units === 0;
    cartBadge.textContent = units;
    byId('cart-button').setAttribute('aria-label', 'Carrito, ' + units + (units === 1 ? ' producto' : ' productos'));

    fill(byId('cart-lines'), lines.map(cartLine));

    // Step 1 shows the products; only step 2 asks for the customer's details.
    var hasLines = lines.length > 0;
    var askingDetails = hasLines && state.cartStep === 'details';
    byId('cart-empty').hidden = hasLines || !byId('cart-done').hidden;
    byId('cart-lines').hidden = askingDetails;
    byId('cart-summary').hidden = !hasLines || askingDetails;
    byId('checkout').hidden = !askingDetails;
    var showingPayment = !hasLines && !byId('cart-done').hidden;
    byId('cart-title').textContent = askingDetails ? 'Tus datos' : showingPayment ? 'Tu pedido' : 'Tu carrito';
    byId('cart-total').textContent = money(total);
    byId('checkout-total').textContent = money(total);
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
      state.cartStep = 'items';
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
        if (!product || product.colors.indexOf(line.color) < 0) return false;
        var variants = product.variants || [];
        return variants.length
          ? variants.some(function (v) { return v.id === line.variant; })
          : !line.variant;
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
    setState({ cat: 'Todo', group: null, color: null, query: '', prices: {}, onlyFavs: false });
  }

  function bindEvents() {
    byId('clear-color').addEventListener('click', function () { setState({ color: null }); });
    byId('clear-filters').addEventListener('click', clearFilters);
    function setHelpOpen(open) {
      byId('wa-panel').hidden = !open;
      byId('wa-toggle').setAttribute('aria-expanded', String(open));
    }
    byId('wa-toggle').addEventListener('click', function () { setHelpOpen(byId('wa-panel').hidden); });
    byId('wa-close').addEventListener('click', function () {
      setHelpOpen(false);
      byId('wa-toggle').focus();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !byId('wa-panel').hidden) {
        setHelpOpen(false);
        byId('wa-toggle').focus();
      }
    });
    byId('show-all').addEventListener('click', function () {
      clearFilters();
      byId('groups').scrollIntoView();
    });
    byId('search').addEventListener('input', function (e) { setState({ query: e.target.value }); });
    byId('sort').addEventListener('change', function (e) { setState({ sort: e.target.value }); });
    byId('favs-toggle').addEventListener('click', function () { setState({ onlyFavs: !state.onlyFavs }); });
    byId('cart-button').addEventListener('click', function () {
      // Keep the payment QR available if the shopper closed the cart before paying.
      renderCart();
      openCart();
    });
    byId('cart-close').addEventListener('click', function () { byId('cart').close(); });
    document.querySelectorAll('[data-pack-add]').forEach(function (button) {
      button.addEventListener('click', function () {
        var pack = products.find(function (p) { return p.id === button.dataset.packAdd; });
        if (pack && pack.inStock) addToCart(pack);
      });
    });
    var hero = byId('promo');
    // Pause only while a keyboard user is on a banner button, so it can be read and used.
    hero.addEventListener('focusin', function (event) { heroPaused = event.target.matches(':focus-visible'); });
    hero.addEventListener('focusout', function () { heroPaused = false; });
    bindHeroSwipe();
    setInterval(function () {
      var slides = heroSlides();
      if (heroPaused || document.hidden || slides.length < 2 || hero.hidden) return;
      if (Date.now() - heroChangedAt < 5500) return;
      showSlide(heroIndex + 1);
    }, 1000);
    byId('checkout').addEventListener('submit', submitOrder);
    byId('cart-continue').addEventListener('click', function () {
      setState({ cartStep: 'details' });
      byId('cart').scrollTop = 0;
      byId('checkout').elements.name.focus();
    });
    byId('checkout-back').addEventListener('click', function () {
      setState({ cartStep: 'items' });
      byId('cart').scrollTop = 0;
    });
    byId('cart-keep-shopping').addEventListener('click', function () { byId('cart').close(); });
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
      // Open the product on the option and color shown in this card.
      var pickedVariants = Object.assign({}, state.pickedVariants);
      if (card.dataset.variant) pickedVariants[card.dataset.product] = Number(card.dataset.variant);
      var picked = Object.assign({}, state.picked);
      picked[card.dataset.product] = card.dataset.color;
      state.pickedVariants = pickedVariants;
      state.picked = picked;
      location.hash = '#producto/' + card.dataset.product;
    });
    byId('product-close').addEventListener('click', closeDetail);
    // Covers Esc. The event can arrive late, so ignore it if another product opened meanwhile.
    byId('product').addEventListener('close', function () {
      byId('product-video').pause();
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
