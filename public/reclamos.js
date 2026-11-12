(function () {
  var form = document.getElementById('claim-form');
  var errorBox = document.getElementById('claim-error');
  var submit = document.getElementById('claim-submit');
  var LABELS = {
    name: 'Nombre', document: 'Documento', address: 'Domicilio', phone: 'Teléfono', email: 'Correo',
    guardian: 'Apoderado', item: 'Producto o servicio', amount: 'Monto reclamado', order_ref: 'N.º de pedido',
    detail: 'Detalle', request: 'Pedido del consumidor'
  };

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function field(name) { return form.querySelector('[name="' + name + '"]'); }

  function formData() {
    var data = {};
    ['name', 'doc_type', 'doc_number', 'address', 'phone', 'email', 'guardian', 'item', 'amount', 'order_ref', 'detail', 'request']
      .forEach(function (name) { data[name] = field(name).value.trim(); });
    data.item_type = form.querySelector('input[name="item_type"]:checked').value;
    data.kind = form.querySelector('input[name="kind"]:checked').value;
    data.accept = field('accept').checked;
    return data;
  }

  function showSheet(data, result) {
    var date = new Date(result.createdAt).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'long', timeStyle: 'short' });
    document.getElementById('sheet-code').textContent = result.code;
    document.getElementById('sheet-kind').textContent = data.kind;
    var rows = [
      ['N.º de hoja', result.code],
      ['Fecha', date],
      ['Proveedor', 'TRENO PERU SAC · RUC 20606466154'],
      ['Tipo', data.kind === 'reclamo' ? 'Reclamo' : 'Queja'],
      [LABELS.name, data.name],
      [LABELS.document, data.doc_type + ' ' + data.doc_number],
      [LABELS.address, data.address],
      [LABELS.phone, data.phone],
      [LABELS.email, data.email],
      [LABELS.guardian, data.guardian],
      [LABELS.item, (data.item_type === 'producto' ? 'Producto: ' : 'Servicio: ') + data.item],
      [LABELS.amount, data.amount ? 'S/ ' + data.amount : ''],
      [LABELS.order_ref, data.order_ref],
      [LABELS.detail, data.detail],
      [LABELS.request, data.request]
    ].filter(function (row) { return row[1]; });
    var list = document.getElementById('sheet-list');
    list.replaceChildren();
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      list.append(dt, dd);
    });
    var text = 'Hola, registré la hoja ' + result.code + ' en el Libro de Reclamaciones de TRENO (' + date + ').';
    document.getElementById('sheet-whatsapp').href = 'https://wa.me/51957503022?text=' + encodeURIComponent(text);
    form.hidden = true;
    document.getElementById('claim-done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.getElementById('sheet-print').addEventListener('click', function () { window.print(); });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    var data = formData();
    var missing = ['name', 'doc_number', 'address', 'phone', 'email', 'item', 'detail', 'request']
      .filter(function (name) { return !data[name]; });
    if (missing.length) {
      field(missing[0]).focus();
      return showError('Completa todos los campos obligatorios (*).');
    }
    if (!data.accept) return showError('Confirma que tus datos son verdaderos para enviar.');
    submit.disabled = true;
    submit.textContent = 'Enviando...';
    fetch('/api/reclamos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || 'No pudimos registrar tu reclamo.');
        showSheet(data, body);
      });
    }).catch(function (error) {
      showError(error.message === 'Failed to fetch' ? 'Revisa tu conexión e inténtalo de nuevo.' : error.message);
    }).then(function () {
      submit.disabled = false;
      submit.textContent = 'Enviar reclamo';
    });
  });
})();
