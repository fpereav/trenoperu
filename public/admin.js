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

  function showLogin(message) {
    byId('panel').hidden = true;
    byId('logout').hidden = true;
    byId('login').hidden = false;
    var error = byId('login-error');
    error.hidden = !message;
    error.textContent = message || '';
    byId('password').focus();
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
      byId('panel').hidden = false;
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
      body: JSON.stringify({ password: password.value })
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
  loadOrders();
})();
