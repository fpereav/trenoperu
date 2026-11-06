(function () {
  'use strict';

  var STATUSES = ['pendiente', 'pagado', 'entregado', 'cancelado'];
  var LABELS = { pendiente: 'Pendientes', pagado: 'Pagados', entregado: 'Entregados', cancelado: 'Cancelados' };
  var STATUS_NAMES = { pendiente: 'Pendiente', pagado: 'Pagado', entregado: 'Entregado', cancelado: 'Cancelado' };
  var COLOR_LIST = window.TRENO_COLORS;
  var LOW_STOCK = 2;
  var NEW_CATEGORY = '__nueva__';
  var MAX_PHOTO_SIDE = 1000;
  var MAX_SOURCE_BYTES = 25 * 1024 * 1024;
  var dateFormat = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' });

  var orders = [];
  var products = [];
  var orderFilter = '';
  var openProducts = {};

  function byId(id) { return document.getElementById(id); }

  function money(amount) { return 'S/ ' + amount.toFixed(2); }

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

  function normalize(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || 'Ocurrió un problema.');
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function jsonRequest(method, data) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  /* Discounts */

  function roundMoney(value) { return Math.round(value * 100) / 100; }

  // Keeps percent, amount and final price in step. Empty discount fields mean no discount.
  function bindDiscount(priceInput, percentInput, amountInput, finalOutput, onChange) {
    function refresh() {
      var price = Number(priceInput.value);
      var amount = Number(amountInput.value) || 0;
      var valid = price > 0 && amount >= 0 && roundMoney(amount) < price;
      finalOutput.textContent = valid ? money(roundMoney(price - amount))
        : price > 0 ? 'El descuento debe ser menor que el precio' : '—';
      finalOutput.classList.toggle('is-invalid', price > 0 && !valid);
      if (onChange) onChange(valid);
    }
    function fromPercent() {
      var price = Number(priceInput.value);
      amountInput.value = percentInput.value === '' ? '' : roundMoney(price * Number(percentInput.value) / 100).toFixed(2);
    }
    percentInput.addEventListener('input', function () {
      fromPercent();
      refresh();
    });
    amountInput.addEventListener('input', function () {
      var price = Number(priceInput.value);
      percentInput.value = amountInput.value === '' || !(price > 0) ? ''
        : String(roundMoney(Number(amountInput.value) * 100 / price));
      refresh();
    });
    // A new price keeps the same percentage.
    priceInput.addEventListener('input', function () {
      if (percentInput.value !== '') fromPercent();
      refresh();
    });
    refresh();
    return refresh;
  }

  /* Session and navigation */

  function showLogin(message) {
    byId('tabs').hidden = true;
    byId('stock-panel').hidden = true;
    byId('panel').hidden = true;
    byId('logout').hidden = true;
    byId('login').hidden = false;
    var error = byId('login-error');
    error.hidden = !message;
    error.textContent = message || '';
    byId('username').focus();
  }

  function showApp() {
    byId('login').hidden = true;
    byId('tabs').hidden = false;
    byId('logout').hidden = false;
  }

  function showTab(name) {
    var stock = name === 'stock';
    byId('panel').hidden = stock;
    byId('stock-panel').hidden = !stock;
    byId('tab-orders').setAttribute('aria-pressed', String(!stock));
    byId('tab-stock').setAttribute('aria-pressed', String(stock));
    return stock ? loadProducts() : loadOrders();
  }

  /* Orders */

  function statusSelect(order) {
    var select = el('select', 'select');
    select.setAttribute('aria-label', 'Estado del pedido ' + order.id);
    STATUSES.forEach(function (status) {
      var option = el('option', '', STATUS_NAMES[status]);
      option.value = status;
      select.appendChild(option);
    });
    select.value = order.status;
    select.disabled = order.status === 'cancelado';
    select.addEventListener('change', function () {
      var next = select.value;
      if (next === 'cancelado' && !window.confirm('¿Cancelar el pedido #' + order.id + '? Su stock se devolverá y no se podrá reabrir.')) {
        select.value = order.status;
        return;
      }
      byId('panel-error').hidden = true;
      select.disabled = true;
      api('/api/admin/orders/' + order.id, jsonRequest('PATCH', { status: next })).then(function () {
        order.status = next;
        renderOrders();
      }).catch(function (error) {
        if (error.status === 401) return showLogin('Tu sesión expiró.');
        var box = byId('panel-error');
        box.textContent = error.message;
        box.hidden = false;
        renderOrders();
      });
    });
    return select;
  }

  function orderCard(order) {
    var card = el('article', 'order order--' + order.status);

    var summary = el('div');
    var heading = el('div', 'order__heading');
    heading.appendChild(el('span', 'order__id', '#' + order.id));
    heading.appendChild(el('span', 'order__muted', dateFormat.format(new Date(order.createdAt))));
    summary.appendChild(heading);
    summary.appendChild(el('div', 'order__total', money(order.total)));
    card.appendChild(summary);

    var customer = el('div');
    customer.appendChild(el('div', 'order__label', 'Cliente'));
    customer.appendChild(el('div', '', order.name));
    var contact = el('div', 'order__contact');
    var phone = el('a', '', order.phone);
    phone.href = 'tel:' + order.phone.replace(/[^0-9+]/g, '');
    contact.appendChild(phone);
    var digits = order.phone.replace(/[^0-9]/g, '');
    var whatsapp = el('a', '', 'WhatsApp');
    whatsapp.href = 'https://wa.me/' + (digits.length === 9 ? '51' + digits : digits);
    contact.appendChild(whatsapp);
    customer.appendChild(contact);
    customer.appendChild(el('div', 'order__address', order.address + ', ' + order.city));
    card.appendChild(customer);

    var items = el('div');
    items.appendChild(el('div', 'order__label', 'Productos'));
    var list = el('ul', 'order__items');
    order.items.forEach(function (item) {
      var colorName = COLOR_LIST[item.color] ? COLOR_LIST[item.color][0] : item.color;
      list.appendChild(el('li', '', item.qty + ' × ' + item.name + ' (' + colorName + ')'));
    });
    items.appendChild(list);
    if (order.notes) items.appendChild(el('div', 'order__note', 'Nota: ' + order.notes));
    card.appendChild(items);

    var status = el('div');
    status.appendChild(el('div', 'order__label', 'Estado'));
    status.appendChild(statusSelect(order));
    card.appendChild(status);
    return card;
  }

  function statButton(label, status, list) {
    var total = list.reduce(function (sum, order) { return sum + order.total; }, 0);
    var stat = button('stat', undefined, function () {
      orderFilter = orderFilter === status ? '' : status;
      renderOrders();
    });
    stat.setAttribute('aria-pressed', String(orderFilter === status));
    stat.appendChild(el('span', 'stat__label', label));
    stat.appendChild(el('span', 'stat__value', String(list.length)));
    stat.appendChild(el('span', 'stat__amount', money(total)));
    return stat;
  }

  function renderOrders() {
    byId('stats').replaceChildren.apply(byId('stats'), STATUSES.map(function (status) {
      return statButton(LABELS[status], status, orders.filter(function (o) { return o.status === status; }));
    }));

    var query = normalize(byId('order-search').value.trim());
    var shown = orders.filter(function (order) {
      if (orderFilter && order.status !== orderFilter) return false;
      return !query || normalize(order.id + ' #' + order.id + ' ' + order.name + ' ' + order.phone).indexOf(query) >= 0;
    });
    byId('count').textContent = shown.length + (shown.length === 1 ? ' pedido' : ' pedidos');
    byId('none').hidden = shown.length > 0;
    byId('rows').replaceChildren.apply(byId('rows'), shown.map(orderCard));
  }

  function loadOrders() {
    return api('/api/admin/orders').then(function (list) {
      orders = list;
      showApp();
      renderOrders();
    }).catch(function (error) {
      showLogin(error.status === 401 ? '' : error.message);
    });
  }

  /* Product photos */

  // Shrink in the browser so every upload stays small, whatever the camera produced.
  function toJpeg(file) {
    if (file.size > MAX_SOURCE_BYTES) return Promise.reject(new Error('La foto pesa demasiado. Usa una de menos de 25 MB.'));
    return createImageBitmap(file).catch(function () {
      throw new Error('No se pudo leer la foto. Usa un archivo JPG, PNG o WebP.');
    }).then(function (bitmap) {
      var scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      var context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('No se pudo procesar la foto.'));
        }, 'image/jpeg', 0.85);
      });
    });
  }

  function builtInPhotos(product, slot) {
    var extras = (window.TRENO_EXTRA_IMAGES || {})[product.id] || [];
    var color = slot === 'principal' ? undefined : slot;
    var colorMap = (window.TRENO_COLOR_IMAGES || {})[product.id];
    // Without per-color photos, the product's main photo is a general one.
    var main = color ? (colorMap || {})[color] : (colorMap ? undefined : product.img);
    return (main ? [main] : []).concat(extras.filter(function (extra) { return extra.color === color; }).map(function (extra) {
      return extra.file;
    }));
  }

  function listPhotoOf(product) {
    var slots = product.colors.concat('principal');
    for (var i = 0; i < slots.length; i++) {
      var uploaded = product.photos[slots[i]];
      if (uploaded && uploaded.length) return uploaded[0].url;
      var builtIn = builtInPhotos(product, slots[i]);
      if (builtIn.length) return 'assets/img/' + builtIn[0];
    }
    return 'assets/img/' + product.img;
  }

  function photoItem(src, alt, caption) {
    var item = el('div', 'photo');
    var image = el('img');
    image.src = src;
    image.alt = alt;
    image.loading = 'lazy';
    image.addEventListener('error', function () { image.replaceWith(el('div', 'photo__empty', 'Sin foto')); });
    item.appendChild(image);
    if (caption) item.appendChild(caption);
    return item;
  }

  /* Options such as 10 kg or 20 kg */

  function totalStock(product) {
    if (!product.variants.length) return product.stock;
    return product.variants.reduce(function (sum, variant) { return sum + variant.stock; }, 0);
  }

  function numberInput(step, min, ariaLabel, value) {
    var input = el('input', 'input');
    input.type = 'number';
    input.step = step;
    input.min = min;
    input.setAttribute('aria-label', ariaLabel);
    if (value !== undefined) input.value = value;
    return input;
  }

  function labelled(text, input) {
    var label = el('label', 'field', text);
    label.appendChild(input);
    return label;
  }

  function allCategories() {
    var names = [];
    products.forEach(function (p) { if (names.indexOf(p.cat) < 0) names.push(p.cat); });
    return names.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  }

  // A list of existing categories plus a "new category" choice with its own field.
  function categoryPicker(current, ariaLabel) {
    var node = el('div', 'category-picker');
    var label = el('label', 'field', 'Categoría');
    var select = el('select', 'select');
    select.setAttribute('aria-label', ariaLabel);
    allCategories().forEach(function (name) {
      var option = el('option', '', name);
      option.value = name;
      select.appendChild(option);
    });
    var addOption = el('option', '', '+ Nueva categoría…');
    addOption.value = NEW_CATEGORY;
    select.appendChild(addOption);
    select.value = current;
    label.appendChild(select);
    node.appendChild(label);

    var otherLabel = el('label', 'field', 'Nombre de la nueva categoría');
    var other = el('input', 'input');
    other.type = 'text';
    other.maxLength = 40;
    other.setAttribute('aria-label', 'Nueva categoría para ' + ariaLabel);
    otherLabel.appendChild(other);
    otherLabel.hidden = true;
    node.appendChild(otherLabel);

    var listeners = [];
    select.addEventListener('change', function () {
      otherLabel.hidden = select.value !== NEW_CATEGORY;
      if (!otherLabel.hidden) other.focus();
      listeners.forEach(function (listener) { listener(); });
    });
    other.addEventListener('input', function () {
      listeners.forEach(function (listener) { listener(); });
    });
    return {
      node: node,
      value: function () { return select.value === NEW_CATEGORY ? other.value.trim() : select.value; },
      onChange: function (listener) { listeners.push(listener); }
    };
  }

  function variantEditor(product, variant, row) {
    var isNew = !variant;
    var ownerLabel = isNew ? 'nueva presentación de ' + product.name : variant.label + ' de ' + product.name;
    var box = el('div', 'variant' + (isNew ? ' variant--new' : ''));

    var label = el('input', 'input');
    label.type = 'text';
    label.maxLength = 40;
    label.placeholder = 'Ej.: 10 kg';
    label.value = isNew ? '' : variant.label;
    label.setAttribute('aria-label', 'Nombre de ' + ownerLabel);
    box.appendChild(labelled('Presentación', label));

    var price = numberInput('0.01', '0.01', 'Precio de ' + ownerLabel, isNew ? undefined : variant.price.toFixed(2));
    box.appendChild(labelled('Precio (S/)', price));
    var percent = numberInput('0.01', '0', 'Descuento en porcentaje de ' + ownerLabel,
      !isNew && variant.discount > 0 ? String(roundMoney(variant.discount * 100 / variant.price)) : '');
    percent.placeholder = '0';
    box.appendChild(labelled('Dcto. (%)', percent));
    var amount = numberInput('0.01', '0', 'Descuento en soles de ' + ownerLabel,
      !isNew && variant.discount > 0 ? variant.discount.toFixed(2) : '');
    amount.placeholder = '0.00';
    box.appendChild(labelled('Dcto. (S/)', amount));

    var finalBox = el('div', 'final-price', 'Final');
    var finalOutput = el('output');
    finalOutput.setAttribute('aria-label', 'Precio final de ' + ownerLabel);
    finalBox.appendChild(finalOutput);
    box.appendChild(finalBox);

    var stock = numberInput('1', '0', 'Stock de ' + ownerLabel, isNew ? undefined : variant.stock);
    box.appendChild(labelled('Stock', stock));

    var actions = el('div', 'variant__actions');
    var save = button('btn' + (isNew ? ' btn--primary' : ''), isNew ? 'Agregar' : 'Guardar', function () {
      save.disabled = true;
      var data = {
        label: label.value,
        price: Number(price.value),
        discount: Number(amount.value) || 0,
        stock: Number(stock.value)
      };
      var request = isNew
        ? api('/api/admin/products/' + product.id + '/variants', jsonRequest('POST', data))
        : api('/api/admin/products/' + product.id + '/variants/' + variant.id, jsonRequest('PATCH', Object.assign({ expected: variant.stock }, data)));
      request.then(function (body) {
        product.variants = body.variants;
        refreshRow(product, row, isNew ? 'Presentación agregada.' : 'Presentación guardada.');
      }).catch(function (error) {
        sync();
        handleError(error, row);
      });
    });
    save.setAttribute('aria-label', (isNew ? 'Agregar ' : 'Guardar ') + ownerLabel);
    actions.appendChild(save);
    if (!isNew) {
      var remove = button('link link--danger', 'Eliminar', function () {
        if (!window.confirm('¿Eliminar la presentación ' + variant.label + ' de ' + product.name + '? Se perderá su stock.')) return;
        api('/api/admin/products/' + product.id + '/variants/' + variant.id, { method: 'DELETE' }).then(function (body) {
          product.variants = body.variants;
          refreshRow(product, row, 'Presentación eliminada.');
        }).catch(function (error) { handleError(error, row); });
      });
      remove.setAttribute('aria-label', 'Eliminar ' + ownerLabel);
      actions.appendChild(remove);
    }
    box.appendChild(actions);

    var discountValid = true;
    function sync() {
      var filled = label.value.trim() !== '' && Number(price.value) > 0 && stock.value !== '' && Number(stock.value) >= 0;
      var unchanged = !isNew && label.value === variant.label && Number(price.value) === variant.price &&
        roundMoney(Number(amount.value) || 0) === variant.discount && Number(stock.value) === variant.stock;
      save.disabled = !filled || !discountValid || unchanged;
    }
    bindDiscount(price, percent, amount, finalOutput, function (valid) {
      discountValid = valid;
      sync();
    });
    label.addEventListener('input', sync);
    stock.addEventListener('input', sync);
    return box;
  }

  function variantsSection(product, row) {
    var section = el('div', 'variants');
    section.appendChild(el('h3', 'panel__title', 'Presentaciones (peso o tamaño)'));
    section.appendChild(el('p', 'variants__help', product.variants.length
      ? 'Cada presentación tiene su propio precio, descuento y stock.'
      : 'Opcional. Agrégalas si el producto se vende en varios pesos o tamaños, por ejemplo 10 kg, 15 kg y 20 kg.'));
    product.variants.forEach(function (variant) {
      section.appendChild(variantEditor(product, variant, row));
    });
    section.appendChild(variantEditor(product, null, row));
    return section;
  }

  /* Product rows */

  function setStatus(row, message, isError) {
    var status = row.querySelector('.status');
    status.textContent = message;
    status.className = 'status' + (isError ? ' status--error' : '');
  }

  function handleError(error, row) {
    if (error.status === 401) return showLogin('Tu sesión expiró.');
    setStatus(row, error.message, true);
  }

  function refreshRow(product, row, message) {
    var fresh = productRow(product);
    // Another save may have redrawn this row while an upload was running.
    var current = document.querySelector('.product[data-product="' + product.id + '"]') || row;
    current.replaceWith(fresh);
    if (message) setStatus(fresh, message);
    return fresh;
  }

  function uploadFiles(product, slot, files, row) {
    var list = Array.prototype.slice.call(files);
    var chain = Promise.resolve();
    list.forEach(function (file, index) {
      chain = chain.then(function () {
        setStatus(row, 'Subiendo foto ' + (index + 1) + ' de ' + list.length + '…');
        return toJpeg(file);
      }).then(function (blob) {
        return api('/api/admin/products/' + product.id + '/photos/' + slot, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob
        });
      }).then(function (body) {
        product.photos = body.photos;
      });
    });
    chain.then(function () {
      refreshRow(product, row, list.length === 1 ? 'Foto guardada.' : 'Fotos guardadas.');
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      // Photos uploaded before the failure are saved; show them with the error.
      handleError(error, refreshRow(product, row));
    });
  }

  function saveColors(product, colors, row, message) {
    api('/api/admin/products/' + product.id + '/colors', jsonRequest('PATCH', { colors: colors })).then(function (body) {
      product.colors = body.colors;
      product.photos = body.photos;
      refreshRow(product, row, message);
    }).catch(function (error) { handleError(error, row); });
  }

  function photoGroup(product, slot, row) {
    var isColor = slot !== 'principal';
    var colorName = isColor ? COLOR_LIST[slot][0] : 'Fotos generales';
    var group = el('section', 'photo-group');
    var head = el('div', 'photo-group__head');
    if (isColor) {
      var dot = el('span', 'dot');
      dot.style.backgroundColor = COLOR_LIST[slot][1];
      head.appendChild(dot);
    }
    head.appendChild(el('span', '', colorName));
    if (isColor) {
      var remove = button('link link--danger', 'Eliminar color', function () {
        if (product.colors.length === 1) {
          setStatus(row, 'El producto debe tener al menos un color.', true);
          return;
        }
        if (!window.confirm('¿Eliminar el color ' + colorName + ' de ' + product.name + '? También se borrarán las fotos que subiste para este color.')) return;
        saveColors(product, product.colors.filter(function (color) { return color !== slot; }), row, 'Color eliminado.');
      });
      remove.setAttribute('aria-label', 'Eliminar color ' + colorName + ' de ' + product.name);
      head.appendChild(remove);
    }
    group.appendChild(head);

    var photos = el('div', 'photos');
    var uploaded = product.photos[slot] || [];
    uploaded.forEach(function (photo, index) {
      var removePhoto = button('link', 'Quitar', function () {
        if (!window.confirm('¿Quitar esta foto de ' + product.name + '?')) return;
        api('/api/admin/products/' + product.id + '/images/' + photo.id, { method: 'DELETE' }).then(function (body) {
          product.photos = body.photos;
          refreshRow(product, row, 'Foto quitada.');
        }).catch(function (error) { handleError(error, row); });
      });
      removePhoto.setAttribute('aria-label', 'Quitar foto ' + (index + 1) + ' de ' + colorName);
      photos.appendChild(photoItem(photo.url, 'Foto ' + (index + 1) + ' de ' + product.name, removePhoto));
    });
    if (!uploaded.length) {
      builtInPhotos(product, slot).forEach(function (file) {
        photos.appendChild(photoItem('assets/img/' + file, 'Foto actual de ' + product.name, el('span', 'photo__caption', 'Actual')));
      });
    }

    var upload = el('label', 'add-photo', '+ Agregar fotos');
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/jpeg,image/png,image/webp';
    input.setAttribute('aria-label', 'Agregar fotos a ' + colorName + ' de ' + product.name);
    input.addEventListener('change', function () {
      if (input.files.length) uploadFiles(product, slot, input.files, row);
    });
    upload.appendChild(input);
    photos.appendChild(upload);
    group.appendChild(photos);
    return group;
  }

  function colorAdder(product, row) {
    var available = Object.keys(COLOR_LIST).filter(function (color) { return product.colors.indexOf(color) < 0; });
    var adder = el('div', 'color-adder');
    var label = el('label', 'field', 'Agregar color');
    var select = el('select', 'select');
    select.setAttribute('aria-label', 'Agregar color a ' + product.name);
    available.forEach(function (color) {
      var option = el('option', '', COLOR_LIST[color][0]);
      option.value = color;
      select.appendChild(option);
    });
    label.appendChild(select);
    adder.appendChild(label);
    var add = button('btn', 'Agregar', function () {
      saveColors(product, product.colors.concat(select.value), row, 'Color agregado.');
    });
    add.disabled = !available.length;
    add.setAttribute('aria-label', 'Agregar el color elegido a ' + product.name);
    adder.appendChild(add);
    return adder;
  }

  function productPanel(product, row) {
    var panel = el('div', 'product__panel');

    var info = el('div');
    info.appendChild(el('h3', 'panel__title', 'Información'));
    var fields = el('div', 'panel__fields');
    var nameLabel = el('label', 'field', 'Nombre');
    var name = el('input', 'input');
    name.type = 'text';
    name.maxLength = 120;
    name.value = product.name;
    name.setAttribute('aria-label', 'Nombre de ' + product.name);
    nameLabel.appendChild(name);
    fields.appendChild(nameLabel);
    var priceLabel = el('label', 'field', 'Precio (S/)');
    var price = el('input', 'input');
    price.type = 'number';
    price.min = '0.01';
    price.max = '100000';
    price.step = '0.01';
    price.value = product.price.toFixed(2);
    price.setAttribute('aria-label', 'Precio de ' + product.name);
    priceLabel.appendChild(price);

    var priceGrid = el('div', 'price-grid');
    // With options, price and discount are set per option.
    priceGrid.hidden = product.variants.length > 0;
    priceGrid.appendChild(priceLabel);
    var finalBox = el('div', 'final-price', 'Precio final');
    var finalOutput = el('output');
    finalOutput.setAttribute('aria-label', 'Precio final de ' + product.name);
    finalBox.appendChild(finalOutput);
    priceGrid.appendChild(finalBox);
    var percentLabel = el('label', 'field', 'Descuento (%)');
    var percent = el('input', 'input');
    percent.type = 'number';
    percent.min = '0';
    percent.max = '99.99';
    percent.step = '0.01';
    percent.placeholder = '0';
    percent.value = product.discount > 0 ? String(roundMoney(product.discount * 100 / product.price)) : '';
    percent.setAttribute('aria-label', 'Descuento en porcentaje de ' + product.name);
    percentLabel.appendChild(percent);
    priceGrid.appendChild(percentLabel);
    var amountLabel = el('label', 'field', 'Descuento (S/)');
    var amount = el('input', 'input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = '0.01';
    amount.placeholder = '0.00';
    amount.value = product.discount > 0 ? product.discount.toFixed(2) : '';
    amount.setAttribute('aria-label', 'Descuento en soles de ' + product.name);
    amountLabel.appendChild(amount);
    priceGrid.appendChild(amountLabel);
    fields.appendChild(priceGrid);
    var category = categoryPicker(product.cat, 'Categoría de ' + product.name);
    fields.appendChild(category.node);
    var descriptionLabel = el('label', 'field', 'Descripción');
    var description = el('textarea', 'textarea');
    description.rows = 5;
    description.maxLength = 500;
    description.value = product.description;
    description.placeholder = 'Medidas, material y uso del producto';
    description.setAttribute('aria-label', 'Descripción de ' + product.name);
    descriptionLabel.appendChild(description);
    fields.appendChild(descriptionLabel);
    var save = button('btn btn--primary', 'Guardar información', function () {
      save.disabled = true;
      api('/api/admin/products/' + product.id + '/details', jsonRequest('PATCH', {
        name: name.value,
        description: description.value,
        category: category.value(),
        price: Number(price.value),
        discount: Number(amount.value) || 0
      })).then(function (body) {
        product.name = body.name;
        product.description = body.description;
        product.cat = body.cat;
        product.price = body.price;
        product.discount = body.discount;
        refreshRow(product, row, 'Información guardada.');
      }).catch(function (error) {
        save.disabled = false;
        handleError(error, row);
      });
    });
    save.disabled = true;
    function detailsChanged() {
      var unchanged = name.value === product.name && description.value === product.description &&
        category.value() === product.cat && Number(price.value) === product.price &&
        roundMoney(Number(amount.value) || 0) === product.discount;
      save.disabled = unchanged || !discountValid || !category.value().trim();
    }
    var discountValid = true;
    bindDiscount(price, percent, amount, finalOutput, function (valid) {
      discountValid = valid;
      if (save) detailsChanged();
    });
    category.onChange(detailsChanged);
    name.addEventListener('input', detailsChanged);
    description.addEventListener('input', detailsChanged);
    fields.appendChild(save);
    info.appendChild(fields);
    panel.appendChild(info);

    panel.appendChild(variantsSection(product, row));

    var media = el('div');
    media.appendChild(el('h3', 'panel__title', 'Colores y fotos'));
    product.colors.concat('principal').forEach(function (slot) {
      media.appendChild(photoGroup(product, slot, row));
    });
    media.appendChild(colorAdder(product, row));
    panel.appendChild(media);
    return panel;
  }

  function productRow(product) {
    var row = el('article', 'product');
    row.dataset.product = product.id;
    var isOpen = !!openProducts[product.id];

    var top = el('div', 'product__row');
    var thumb = el('img', 'product__thumb');
    thumb.src = listPhotoOf(product);
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.addEventListener('error', function () {
      thumb.replaceWith(el('div', 'product__thumb product__thumb--empty', 'Sin foto'));
    });
    top.appendChild(thumb);

    var info = el('div');
    info.appendChild(el('div', 'product__name', product.name));
    var meta = el('div', 'product__meta');
    meta.appendChild(el('span', '', product.cat));
    var dots = el('span', 'product__dots');
    product.colors.forEach(function (color) {
      var dot = el('span', 'dot');
      dot.style.backgroundColor = COLOR_LIST[color][1];
      dot.title = COLOR_LIST[color][0];
      dots.appendChild(dot);
    });
    meta.appendChild(dots);
    var hasVariants = product.variants.length > 0;
    var total = totalStock(product);
    if (hasVariants) meta.appendChild(el('span', '', product.variants.length + (product.variants.length === 1 ? ' presentación' : ' presentaciones')));
    if (total === 0) meta.appendChild(el('span', 'badge badge--out', 'Sin stock · oculto'));
    else if (total <= LOW_STOCK) meta.appendChild(el('span', 'badge badge--low', 'Stock bajo'));
    info.appendChild(meta);
    top.appendChild(info);

    var finals = product.variants.map(function (v) { return roundMoney(v.price - v.discount); });
    var priceBox = el('div', 'product__price', hasVariants
      ? (Math.min.apply(null, finals) === Math.max.apply(null, finals) ? '' : 'Desde ') + money(Math.min.apply(null, finals))
      : money(roundMoney(product.price - product.discount)));
    if (!hasVariants && product.discount > 0) {
      priceBox.appendChild(document.createElement('br'));
      priceBox.appendChild(el('s', 'price-was', money(product.price)));
      priceBox.appendChild(document.createTextNode(' '));
      priceBox.appendChild(el('span', 'price-off', '-' + roundMoney(product.discount * 100 / product.price) + '%'));
    }
    top.appendChild(priceBox);

    var stockBox = el('div', 'product__stock');
    var stock = el('input', 'input');
    stock.type = 'number';
    stock.min = '0';
    stock.max = '100000';
    stock.step = '1';
    stock.value = product.stock;
    stock.setAttribute('aria-label', 'Stock de ' + product.name);
    stock.hidden = hasVariants;
    if (hasVariants) stockBox.appendChild(el('span', 'product__stock-total', 'Stock: ' + total));
    stockBox.appendChild(stock);
    var saveStock = button('btn', 'Guardar', function () {
      saveStock.disabled = true;
      api('/api/admin/products/' + product.id, jsonRequest('PATCH', {
        stock: Number(stock.value),
        expected: product.stock
      })).then(function (body) {
        product.stock = body.stock;
        refreshRow(product, row, 'Stock guardado.');
      }).catch(function (error) {
        saveStock.disabled = false;
        handleError(error, row);
      });
    });
    saveStock.disabled = true;
    saveStock.hidden = hasVariants;
    saveStock.setAttribute('aria-label', 'Guardar stock de ' + product.name);
    stock.addEventListener('input', function () {
      saveStock.disabled = stock.value === String(product.stock);
    });
    stockBox.appendChild(saveStock);
    top.appendChild(stockBox);

    var toggle = button('btn product__toggle', isOpen ? 'Cerrar' : 'Editar', function () {
      openProducts[product.id] = !openProducts[product.id];
      refreshRow(product, row);
    });
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', (isOpen ? 'Cerrar ' : 'Editar ') + product.name);
    top.appendChild(toggle);
    row.appendChild(top);

    var status = el('p', 'status');
    status.setAttribute('role', 'status');
    row.appendChild(status);

    if (isOpen) row.appendChild(productPanel(product, row));
    return row;
  }

  function hasDiscount(product) {
    return product.variants.length
      ? product.variants.some(function (variant) { return variant.discount > 0; })
      : product.discount > 0;
  }

  function fillProductFilters() {
    var select = byId('filter-category');
    var selected = select.value;
    var options = [select.options[0]].concat(allCategories().map(function (name) {
      var option = el('option', '', name);
      option.value = name;
      return option;
    }));
    select.replaceChildren.apply(select, options);
    select.value = selected;
    // A category with no products left falls back to "Todas".
    if (select.selectedIndex < 0) select.value = '';

    var colors = byId('filter-color');
    if (colors.options.length === 1) {
      Object.keys(COLOR_LIST).forEach(function (color) {
        var option = el('option', '', COLOR_LIST[color][0]);
        option.value = color;
        colors.appendChild(option);
      });
    }
  }

  function renderProducts() {
    var query = normalize(byId('product-search').value.trim());
    var stockFilter = byId('product-filter').value;
    var category = byId('filter-category').value;
    var color = byId('filter-color').value;
    var discount = byId('filter-discount').value;
    var variants = byId('filter-variants').value;
    var shown = products.filter(function (product) {
      var total = totalStock(product);
      if (stockFilter === 'in' && total === 0) return false;
      if (stockFilter === 'out' && total !== 0) return false;
      if (stockFilter === 'low' && (total === 0 || total > LOW_STOCK)) return false;
      if (category && product.cat !== category) return false;
      if (color && product.colors.indexOf(color) < 0) return false;
      if (discount === 'yes' && !hasDiscount(product)) return false;
      if (discount === 'no' && hasDiscount(product)) return false;
      if (variants === 'yes' && !product.variants.length) return false;
      if (variants === 'no' && product.variants.length) return false;
      return !query || normalize(product.name + ' ' + product.cat).indexOf(query) >= 0;
    });
    byId('clear-product-filters').hidden = !(query || stockFilter || category || color || discount || variants);
    byId('product-count').textContent = shown.length + (shown.length === 1 ? ' producto' : ' productos');
    byId('products-none').hidden = shown.length > 0;
    byId('stock-rows').hidden = shown.length === 0;
    byId('stock-rows').replaceChildren.apply(byId('stock-rows'), shown.map(productRow));
  }

  function clearProductFilters() {
    byId('product-search').value = '';
    ['product-filter', 'filter-category', 'filter-color', 'filter-discount', 'filter-variants'].forEach(function (id) {
      byId(id).value = '';
    });
  }

  function loadProducts() {
    var box = byId('stock-error');
    box.hidden = true;
    return api('/api/admin/products').then(function (list) {
      products = list;
      fillProductFilters();
      renderProducts();
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      box.textContent = error.message;
      box.hidden = false;
    });
  }

  /* New product */

  var refreshNewFinal = bindDiscount(byId('new-price'), byId('new-discount-percent'), byId('new-discount-amount'), byId('new-final'));

  function openNewForm() {
    var form = byId('new-form');
    form.reset();
    byId('new-error').hidden = true;

    var select = byId('new-category');
    select.replaceChildren.apply(select, allCategories().map(function (name) {
      var option = el('option', '', name);
      option.value = name;
      return option;
    }).concat([(function () {
      var option = el('option', '', '+ Nueva categoría…');
      option.value = NEW_CATEGORY;
      return option;
    })()]));
    syncNewCategory();

    refreshNewFinal();

    byId('new-colors').replaceChildren.apply(byId('new-colors'), Object.keys(COLOR_LIST).map(function (color) {
      var choice = el('label', 'color-choice');
      var box = el('input');
      box.type = 'checkbox';
      box.value = color;
      choice.appendChild(box);
      var dot = el('span', 'dot');
      dot.style.backgroundColor = COLOR_LIST[color][1];
      choice.appendChild(dot);
      choice.appendChild(document.createTextNode(COLOR_LIST[color][0]));
      return choice;
    }));

    form.hidden = false;
    byId('new-name').focus();
  }

  function closeNewForm() {
    byId('new-form').hidden = true;
  }

  function syncNewCategory() {
    var isNew = byId('new-category').value === NEW_CATEGORY;
    byId('new-category-other').hidden = !isNew;
    byId('new-category-name').required = isNew;
  }

  function submitNewProduct(event) {
    event.preventDefault();
    var errorBox = byId('new-error');
    errorBox.hidden = true;
    var colors = Array.prototype.map.call(byId('new-colors').querySelectorAll('input:checked'), function (box) {
      return box.value;
    });
    if (!colors.length) {
      errorBox.textContent = 'Elige al menos un color.';
      errorBox.hidden = false;
      return;
    }
    var select = byId('new-category');
    var submit = byId('new-submit');
    submit.disabled = true;
    api('/api/admin/products', jsonRequest('POST', {
      name: byId('new-name').value,
      description: byId('new-description').value,
      category: select.value === NEW_CATEGORY ? byId('new-category-name').value : select.value,
      price: Number(byId('new-price').value),
      discount: Number(byId('new-discount-amount').value) || 0,
      stock: Number(byId('new-stock').value),
      colors: colors
    })).then(function (product) {
      closeNewForm();
      products.push(product);
      openProducts[product.id] = true;
      clearProductFilters();
      fillProductFilters();
      renderProducts();
      var row = document.querySelector('.product[data-product="' + product.id + '"]');
      setStatus(row, 'Producto creado. Ahora agrega sus fotos.');
      row.scrollIntoView({ block: 'center' });
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }).finally(function () {
      submit.disabled = false;
    });
  }

  /* Excel import */

  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var importFile = null;

  function importRequest(mode) {
    return api('/api/admin/import/' + mode, {
      method: 'POST',
      headers: { 'Content-Type': XLSX_TYPE },
      body: importFile
    });
  }

  function closeImport() {
    importFile = null;
    byId('import-panel').hidden = true;
    byId('import-excel').value = '';
  }

  function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

  function showImportResult(result, summary) {
    var errors = byId('import-errors');
    var changes = byId('import-changes');
    errors.hidden = result.errorCount === 0;
    errors.replaceChildren.apply(errors, result.errors.map(function (error) {
      return el('li', '', 'Fila ' + error.row + ': ' + error.message);
    }));
    changes.hidden = result.changeCount === 0 || result.errorCount > 0;
    changes.replaceChildren.apply(changes, result.changes.map(function (change) { return el('li', '', change); }));
    byId('import-summary').textContent = summary;
    byId('import-warning').hidden = !result.changes.some(function (change) { return change.indexOf(': stock ') >= 0; }) || result.applied;
    byId('import-apply').hidden = result.applied || result.errorCount > 0 || result.changeCount === 0;
    byId('import-panel').hidden = false;
  }

  function showImportMessage(message) {
    showImportResult({ errors: [], errorCount: 0, changes: [], changeCount: 0, applied: false }, message);
  }

  function previewImport(file) {
    importFile = file;
    showImportMessage('Revisando ' + file.name + '…');
    importRequest('preview').then(function (result) {
      var summary;
      if (result.errorCount) summary = plural(result.errorCount, 'error', 'errores') + ' en el archivo. Corrígelos y vuelve a importarlo; no se aplicó nada.';
      else if (!result.changeCount) summary = 'El archivo no tiene cambios (' + plural(result.rows, 'fila', 'filas') + ').';
      else summary = plural(result.changeCount, 'cambio', 'cambios') + ' por aplicar. Revísalos antes de confirmar.';
      showImportResult(result, summary);
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      showImportMessage(error.message);
    });
  }

  function applyImport() {
    var applyButton = byId('import-apply');
    applyButton.disabled = true;
    importRequest('apply').then(function (result) {
      if (result.applied) {
        showImportResult(result, 'Listo: ' + plural(result.changeCount, 'cambio aplicado', 'cambios aplicados') + '.');
        importFile = null;
        byId('import-excel').value = '';
        return loadProducts();
      }
      // The data changed after the preview; nothing was saved.
      showImportResult(result, 'No se aplicó nada: ' + plural(result.errorCount, 'error', 'errores') + ' en el archivo.');
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      showImportMessage(error.message);
    }).finally(function () {
      applyButton.disabled = false;
    });
  }

  /* Events */

  byId('login').addEventListener('submit', function (event) {
    event.preventDefault();
    var password = byId('password');
    api('/api/admin/login', jsonRequest('POST', {
      username: byId('username').value,
      password: password.value
    })).then(function () {
      password.value = '';
      return loadOrders();
    }).then(function () {
      if (byId('login').hidden) showTab('orders');
    }).catch(function (error) {
      showLogin(error.message);
    });
  });

  byId('logout').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).then(function () {
      orders = [];
      products = [];
      byId('rows').replaceChildren();
      byId('stock-rows').replaceChildren();
      showLogin('');
    });
  });

  byId('import-excel').addEventListener('change', function (event) {
    if (event.target.files[0]) previewImport(event.target.files[0]);
  });
  byId('import-apply').addEventListener('click', applyImport);
  byId('import-cancel').addEventListener('click', closeImport);
  byId('new-product').addEventListener('click', openNewForm);
  byId('new-cancel').addEventListener('click', closeNewForm);
  byId('new-category').addEventListener('change', syncNewCategory);
  byId('new-form').addEventListener('submit', submitNewProduct);
  byId('order-search').addEventListener('input', renderOrders);
  byId('product-search').addEventListener('input', renderProducts);
  ['product-filter', 'filter-category', 'filter-color', 'filter-discount', 'filter-variants'].forEach(function (id) {
    byId(id).addEventListener('change', renderProducts);
  });
  byId('clear-product-filters').addEventListener('click', function () {
    clearProductFilters();
    renderProducts();
  });
  byId('tab-orders').addEventListener('click', function () { showTab('orders'); });
  byId('tab-stock').addEventListener('click', function () { showTab('stock'); });

  loadOrders().then(function () {
    if (byId('login').hidden) byId('panel').hidden = false;
  });
})();
