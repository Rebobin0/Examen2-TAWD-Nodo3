// Panel administrativo del cajero. Lo que llega del servidor se escribe con textContent.

const $ = (id) => document.getElementById(id);
const dinero = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const TIPOS = { deposito: 'Depósito', retiro: 'Retiro', transferencia: 'Transferencia' };
const ORIGEN = {
  terminal: 'guardado en esta terminal',
  entorno: 'tomado de la variable BANCO_API_KEY',
};

function el(etiqueta, atributos = {}, contenido = []) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
  for (const hijo of [].concat(contenido)) nodo.append(hijo);
  return nodo;
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`/api${ruta}`, {
    method: opciones.method || 'GET',
    headers: opciones.body ? { 'Content-Type': 'application/json' } : {},
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await respuesta.json();

  if (!respuesta.ok) {
    const error = new Error(datos.error || 'Ocurrió un error.');
    error.sinSesion = datos.codigo === 'SIN_SESION';
    throw error;
  }
  return datos;
}

function avisar(texto, tipo = 'ok') {
  $('aviso').textContent = texto;
  $('aviso').className = `aviso ${tipo}`;
  $('aviso').hidden = false;
}

function vista(nombre) {
  $('v-login').hidden = nombre !== 'login';
  $('v-panel').hidden = nombre !== 'panel';
  $('salir').hidden = nombre !== 'panel';
  if (nombre === 'login') $('usuario').textContent = '';
}

async function intentar(accion, formulario) {
  const boton = formulario?.querySelector('button[type=submit]');
  if (boton) boton.disabled = true;
  try {
    await accion();
  } catch (e) {
    if (e.sinSesion) vista('login');
    else avisar(e.message, 'error');
  } finally {
    if (boton) boton.disabled = false;
  }
}

function tarjeta(etiqueta, valor) {
  return el('div', { class: 'tarjeta' }, [el('div', { class: 'etiqueta' }, etiqueta), el('div', { class: 'valor' }, valor)]);
}

async function cargar() {
  const e = await api('/admin/estado');
  vista('panel');
  $('usuario').textContent = e.usuario;

  const estado = $('estado');
  estado.replaceChildren();
  $('tarjetas').replaceChildren();
  $('movimientos').replaceChildren();

  $('multiplo').value = e.reglas.multiplo;
  $('retiro_maximo').value = e.reglas.retiro_maximo;
  $('deposito_maximo').value = e.reglas.deposito_maximo;

  if (e.origen === 'ninguno') {
    estado.append(el('div', { class: 'aviso alerta' }, 'El cajero no tiene API Key. Créalo en el panel del Banco Central y pega aquí su API Key.'));
    return;
  }
  if (e.error) {
    estado.append(el('div', { class: 'aviso error' }, `API Key ${e.api_key} (${ORIGEN[e.origen]}): ${e.error}`));
    return;
  }
  if (e.nodo.tipo !== 'cajero') {
    estado.append(el('div', { class: 'aviso error' }, `El API Key ${e.api_key} pertenece a una sucursal, no a un cajero.`));
    return;
  }

  $('nombre').textContent = e.nodo.nombre;
  estado.append(el('div', { class: 'aviso ok' }, `Conectado como «${e.nodo.nombre}». API Key ${e.api_key}, ${ORIGEN[e.origen]}.`));

  $('tarjetas').append(
    tarjeta('Efectivo en el cajero', dinero(e.nodo.efectivo_disponible)),
    tarjeta('Responsable', e.nodo.responsable || 'Sin asignar'),
    tarjeta('Estado', e.nodo.estado === 'activo' ? 'Activo' : 'Inactivo'),
  );

  if (e.movimientos.length === 0) {
    $('movimientos').append(el('div', { class: 'vacio' }, 'Aún no hay movimientos en este cajero.'));
    return;
  }

  const celdas = (valores, etiqueta, numericas = []) => el('tr', {}, valores.map((v, i) =>
    el(etiqueta, numericas.includes(i) ? { class: 'num' } : {}, v)));

  $('movimientos').append(el('div', { class: 'tabla-scroll' }, el('table', {}, [
    el('thead', {}, celdas(['ID', 'Fecha', 'Tipo', 'Monto', 'Cuenta'], 'th', [3])),
    el('tbody', {}, e.movimientos.map((t) => celdas([
      String(t.id),
      new Date(t.timestamp).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }),
      TIPOS[t.tipo] || t.tipo,
      dinero(t.monto),
      el('span', { class: 'mono' }, t.cuenta_origen || t.cuenta_destino || '—'),
    ], 'td', [3]))),
  ])));
}

$('form-login').addEventListener('submit', (evento) => {
  evento.preventDefault();
  $('aviso').hidden = true;

  intentar(async () => {
    await api('/admin/login', { method: 'POST', body: { usuario: $('l-usuario').value, password: $('l-password').value } });
    evento.target.reset();
    await cargar();
  }, evento.target);
});

$('form-key').addEventListener('submit', (evento) => {
  evento.preventDefault();
  $('aviso').hidden = true;

  intentar(async () => {
    await api('/admin/config', { method: 'PUT', body: { api_key: $('api_key').value } });
    evento.target.reset();
    await cargar();
    avisar('API Key verificado y guardado en esta terminal.');
  }, evento.target);
});

$('form-reglas').addEventListener('submit', (evento) => {
  evento.preventDefault();
  $('aviso').hidden = true;

  intentar(async () => {
    await api('/admin/config', {
      method: 'PUT',
      body: {
        multiplo: Number($('multiplo').value),
        retiro_maximo: Number($('retiro_maximo').value),
        deposito_maximo: Number($('deposito_maximo').value),
      },
    });
    await cargar();
    avisar('Reglas guardadas en esta terminal.');
  }, evento.target);
});

$('borrar').addEventListener('click', () => intentar(async () => {
  await api('/admin/config', { method: 'DELETE' });
  await cargar();
  avisar('Se quitó la configuración de esta terminal.', 'alerta');
}));

$('salir').addEventListener('click', async () => {
  await api('/admin/logout', { method: 'POST' });
  $('aviso').hidden = true;
  vista('login');
});

intentar(cargar);
