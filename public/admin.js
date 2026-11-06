(function () {
  'use strict';

  var STATUSES = ['pendiente', 'pagado', 'entregado', 'cancelado'];
  var LABELS = { pendiente: 'Pendiente', pagado: 'Pagado', entregado: 'Entregado', cancelado: 'Cancelado' };
  var dateFormat = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' });
  var orders = [];

  function byId(id) { return document.getElementById(id); }

  function money(amount) { return 'S/ ' + amount.toFixed(2); }

  function cell(lines) {
    var td = document.createElement('td');
    lines.forEach(function (text) {
      var div = document.createElement('div');
      div.textContent = text;
      td.appendChild(div);
    });
    return td;
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

  function showTab(name) {
    var stock = name === 'stock';
    byId('tabs').hidden = false;
    byId('panel').hidden = stock;
    byId('stock-panel').hidden = !stock;
    byId('tab-orders').setAttribute('aria-pressed', String(!stock));
    byId('tab-stock').setAttribute('aria-pressed', String(stock));
    if (stock) loadStock();
    else loadOrders();
  }

  var MAX_PHOTO_SIDE = 1000;
  var MAX_SOURCE_BYTES = 25 * 1024 * 1024;

  function makeEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

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

  function currentPhoto(product, slot) {
    if (product.photos[slot]) return product.photos[slot];
    if (slot === 'principal') return 'assets/img/' + product.img;
    var builtIn = (window.TRENO_COLOR_IMAGES || {})[product.id] || {};
    return builtIn[slot] ? 'assets/img/' + builtIn[slot] : null;
  }

  function photoSlot(product, slot, editor, status) {
    var wrap = makeEl('div', 'slot');
    wrap.appendChild(makeEl('span', 'slot__name', slot));
    var src = currentPhoto(product, slot);
    var showEmpty = function () { return makeEl('div', 'slot__empty', 'Sin foto'); };
    if (src) {
      var thumb = makeEl('img', 'slot__thumb');
      thumb.src = src;
      thumb.alt = 'Foto ' + slot + ' de ' + product.name;
      thumb.addEventListener('error', function () { thumb.replaceWith(showEmpty()); });
      wrap.appendChild(thumb);
    } else {
      wrap.appendChild(showEmpty());
    }

    var upload = makeEl('label', 'slot__button', product.photos[slot] ? 'Cambiar' : 'Subir');
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.setAttribute('aria-label', 'Subir foto ' + slot + ' de ' + product.name);
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      setStatus(status, 'Subiendo foto…');
      toJpeg(file).then(function (blob) {
        return api('/api/admin/products/' + product.id + '/photos/' + slot, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob
        });
      }).then(function (body) {
        product.photos = body.photos;
        replaceEditor(product, editor, 'Foto guardada.');
      }).catch(function (error) { handleEditorError(error, status); });
    });
    upload.appendChild(input);
    wrap.appendChild(upload);

    if (product.photos[slot]) {
      var remove = makeEl('button', 'slot__remove', 'Quitar');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Quitar foto ' + slot + ' de ' + product.name);
      remove.addEventListener('click', function () {
        if (!window.confirm('¿Quitar esta foto de ' + product.name + '?')) return;
        api('/api/admin/products/' + product.id + '/photos/' + slot, { method: 'DELETE' }).then(function (body) {
          product.photos = body.photos;
          replaceEditor(product, editor, 'Foto quitada.');
        }).catch(function (error) { handleEditorError(error, status); });
      });
      wrap.appendChild(remove);
    }
    return wrap;
  }

  function setStatus(status, message, isError) {
    status.textContent = message;
    status.className = 'editor__status' + (isError ? ' editor__status--error' : '');
  }

  function handleEditorError(error, status) {
    if (error.status === 401) return showLogin('Tu sesión expiró.');
    setStatus(status, error.message, true);
  }

  function replaceEditor(product, editor, message) {
    var fresh = productEditor(product);
    editor.replaceWith(fresh);
    if (message) setStatus(fresh.querySelector('.editor__status'), message);
  }

  function productEditor(product) {
    var editor = makeEl('article', 'editor');
    var title = makeEl('h2', '', product.name);
    title.appendChild(makeEl('span', 'editor__meta', product.cat + ' · ' + money(product.price)));
    if (product.stock <= 2) {
      title.appendChild(makeEl('span', 'stock-low', product.stock === 0 ? 'Agotado' : 'Stock bajo'));
    }
    editor.appendChild(title);

    var fields = makeEl('div', 'editor__fields');
    var nameLabel = makeEl('label', '', 'Nombre');
    var name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 120;
    name.value = product.name;
    name.setAttribute('aria-label', 'Nombre de ' + product.name);
    nameLabel.appendChild(name);
    fields.appendChild(nameLabel);

    var descriptionLabel = makeEl('label', '', 'Descripción');
    var description = document.createElement('textarea');
    description.rows = 3;
    description.maxLength = 500;
    description.value = product.description;
    description.setAttribute('aria-label', 'Descripción de ' + product.name);
    descriptionLabel.appendChild(description);
    fields.appendChild(descriptionLabel);

    var saveDetails = makeEl('button', 'stock-save', 'Guardar nombre y descripción');
    saveDetails.type = 'button';
    saveDetails.disabled = true;
    function detailsChanged() {
      saveDetails.disabled = name.value === product.name && description.value === product.description;
    }
    name.addEventListener('input', detailsChanged);
    description.addEventListener('input', detailsChanged);
    fields.appendChild(saveDetails);

    var stockRow = makeEl('div', 'editor__row');
    var stockLabel = makeEl('label', '', 'Stock');
    var stock = document.createElement('input');
    stock.type = 'number';
    stock.min = '0';
    stock.max = '100000';
    stock.step = '1';
    stock.value = product.stock;
    stock.className = 'stock-input';
    stock.setAttribute('aria-label', 'Stock de ' + product.name);
    stockLabel.appendChild(stock);
    stockRow.appendChild(stockLabel);
    var saveStock = makeEl('button', 'stock-save', 'Guardar stock');
    saveStock.type = 'button';
    saveStock.disabled = true;
    stock.addEventListener('input', function () {
      saveStock.disabled = stock.value === String(product.stock);
    });
    stockRow.appendChild(saveStock);
    fields.appendChild(stockRow);

    var status = makeEl('p', 'editor__status');
    status.setAttribute('role', 'status');
    fields.appendChild(status);
    editor.appendChild(fields);

    saveDetails.addEventListener('click', function () {
      saveDetails.disabled = true;
      api('/api/admin/products/' + product.id + '/details', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, description: description.value })
      }).then(function (body) {
        product.name = body.name;
        product.description = body.description;
        replaceEditor(product, editor, 'Nombre y descripción guardados.');
      }).catch(function (error) {
        detailsChanged();
        handleEditorError(error, status);
      });
    });

    saveStock.addEventListener('click', function () {
      saveStock.disabled = true;
      api('/api/admin/products/' + product.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: Number(stock.value), expected: product.stock })
      }).then(function (body) {
        product.stock = body.stock;
        replaceEditor(product, editor, 'Stock guardado.');
      }).catch(function (error) {
        saveStock.disabled = false;
        handleEditorError(error, status);
      });
    });

    var slots = makeEl('div', 'slots');
    ['principal'].concat(product.colors).forEach(function (slot) {
      slots.appendChild(photoSlot(product, slot, editor, status));
    });
    editor.appendChild(slots);
    return editor;
  }

  function loadStock() {
    return api('/api/admin/products').then(function (products) {
      byId('stock-rows').replaceChildren.apply(byId('stock-rows'), products.map(productEditor));
    }).catch(function (error) {
      if (error.status === 401) return showLogin('Tu sesión expiró.');
      var box = byId('stock-error');
      box.textContent = error.message;
      box.hidden = false;
    });
  }

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

  function statusSelect(order) {
    var select = document.createElement('select');
    select.style.cssText = 'height: 44px; padding: 0 8px; border: 1px solid #8A8D91; background: #ffffff; font: inherit; font-size: 14px';
    select.setAttribute('aria-label', 'Estado del pedido ' + order.id);
    STATUSES.forEach(function (status) {
      var option = document.createElement('option');
      option.value = status;
      option.textContent = LABELS[status];
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
      api('/api/admin/orders/' + order.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      }).then(function () {
        order.status = next;
        render();
      }).catch(function (error) {
        if (error.status === 401) return showLogin('Tu sesión expiró.');
        var box = byId('panel-error');
        box.textContent = error.message;
        box.hidden = false;
        render();
      });
    });
    return select;
  }

  function render() {
    var filter = byId('filter').value;
    var shown = orders.filter(function (o) { return !filter || o.status === filter; });
    byId('count').textContent = '[' + shown.length + ']';
    byId('none').hidden = shown.length > 0;

    byId('rows').replaceChildren.apply(byId('rows'), shown.map(function (order) {
      var row = document.createElement('tr');
      row.appendChild(cell(['#' + order.id]));
      row.appendChild(cell([dateFormat.format(new Date(order.createdAt))]));
      row.appendChild(cell([order.name, order.phone]));
      row.appendChild(cell(order.notes ? [order.address, order.city, 'Nota: ' + order.notes] : [order.address, order.city]));
      row.appendChild(cell(order.items.map(function (item) {
        return item.qty + ' × ' + item.name + ' (' + item.color + ') · ' + money(item.price);
      })));
      row.appendChild(cell([money(order.total)]));
      var status = document.createElement('td');
      status.appendChild(statusSelect(order));
      row.appendChild(status);
      return row;
    }));
  }

  function loadOrders() {
    return api('/api/admin/orders').then(function (list) {
      orders = list;
      byId('login').hidden = true;
      byId('tabs').hidden = false;
      byId('panel').hidden = byId('tab-stock').getAttribute('aria-pressed') === 'true';
      byId('logout').hidden = false;
      render();
    }).catch(function (error) {
      showLogin(error.status === 401 ? '' : error.message);
    });
  }

  byId('login').addEventListener('submit', function (event) {
    event.preventDefault();
    var password = byId('password');
    api('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: byId('username').value, password: password.value })
    }).then(function () {
      password.value = '';
      return loadOrders();
    }).catch(function (error) {
      showLogin(error.message);
    });
  });

  byId('logout').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).then(function () {
      orders = [];
      byId('rows').replaceChildren();
      showLogin('');
    });
  });

  byId('filter').addEventListener('change', render);
  byId('tab-orders').addEventListener('click', function () { showTab('orders'); });
  byId('tab-stock').addEventListener('click', function () { showTab('stock'); });
  loadOrders();
})();
