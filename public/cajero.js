// Interfaz del cliente. Lo que llega del servidor se escribe con textContent.

const $ = (id) => document.getElementById(id);
const dinero = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

let cuenta = null;   // { numero_cuenta, nombre_titular }
let reglas = null;   // reglas locales del cajero
let operacion = null; // 'retiro' | 'deposito'

function pantalla(nombre) {
  for (const seccion of document.querySelectorAll('.pantalla > section')) {
    seccion.hidden = seccion.id !== `p-${nombre}`;
  }
  $(`p-${nombre}`).querySelector('input')?.focus();
}

async function api(ruta, cuerpo) {
  const respuesta = await fetch(`/api${ruta}`, cuerpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : undefined);
  const datos = await respuesta.json();

  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
  return datos;
}

function mostrarError(id, texto) {
  $(id).textContent = texto;
  $(id).hidden = false;
}

/** Deshabilita los botones de la pantalla mientras se espera al servidor. */
async function ocupado(seccion, accion) {
  const botones = [...$(seccion).querySelectorAll('button')];
  botones.forEach((b) => { b.disabled = true; });
  try {
    await accion();
  } finally {
    botones.forEach((b) => { b.disabled = false; });
  }
}

// ---------- Arranque ----------

async function iniciar() {
  cuenta = null;
  $('form-inicio').reset();
  $('error-inicio').hidden = true;

  let estado;
  try {
    estado = await api('/cajero');
  } catch {
    estado = { en_servicio: false, motivo: 'No hay conexión con el servidor del cajero.' };
  }

  $('luz').classList.toggle('activa', estado.en_servicio);
  $('estado').textContent = estado.en_servicio ? 'En servicio' : 'Fuera de servicio';

  if (!estado.en_servicio) {
    $('motivo-fuera').textContent = estado.motivo;
    return pantalla('fuera');
  }

  reglas = estado.reglas;
  $('nombre-cajero').textContent = estado.nombre;
  pantalla('inicio');
}

$('reintentar').addEventListener('click', iniciar);

// ---------- Identificación ----------

$('form-inicio').addEventListener('submit', (evento) => {
  evento.preventDefault();
  $('error-inicio').hidden = true;

  ocupado('p-inicio', async () => {
    try {
      const datos = await api('/cajero/saldo', { numero_cuenta: $('cuenta').value.trim() });
      if (datos.estado !== 'activa') throw new Error('La cuenta está bloqueada. Acude a tu sucursal.');

      cuenta = { numero_cuenta: datos.numero_cuenta, nombre_titular: datos.nombre_titular };
      $('saludo').textContent = `Hola, ${datos.nombre_titular}`;
      pantalla('menu');
    } catch (e) {
      mostrarError('error-inicio', e.message);
    }
  });
});

// ---------- Menú y navegación ----------

document.querySelector('.pantalla').addEventListener('click', (evento) => {
  const destino = evento.target.dataset?.ir;
  if (!destino) return;

  if (destino === 'salir') return iniciar();
  if (destino === 'menu') return pantalla('menu');
  if (destino === 'saldo') return verSaldo();
  pedirMonto(destino);
});

function verSaldo() {
  ocupado('p-menu', async () => {
    try {
      const datos = await api('/cajero/saldo', { numero_cuenta: cuenta.numero_cuenta });
      $('saldo-cuenta').textContent = `Cuenta ${datos.numero_cuenta}`;
      $('saldo-valor').textContent = dinero(datos.saldo);
      pantalla('saldo');
    } catch (e) {
      mostrarRechazo('No se pudo consultar el saldo', e.message);
    }
  });
}

// ---------- Retiro y depósito ----------

function pedirMonto(tipo) {
  operacion = tipo;
  const esRetiro = tipo === 'retiro';

  $('monto-titulo').textContent = esRetiro ? 'Retirar efectivo' : 'Depositar';
  $('monto-ayuda').textContent = esRetiro
    ? `Múltiplos de ${dinero(reglas.multiplo)}. Máximo ${dinero(reglas.retiro_maximo)} por retiro.`
    : `Múltiplos de ${dinero(reglas.deposito_multiplo)}. Máximo ${dinero(reglas.deposito_maximo)} por depósito.`;
  $('error-monto').hidden = true;
  $('form-monto').reset();

  const base = esRetiro ? reglas.multiplo : 100;
  const maximo = esRetiro ? reglas.retiro_maximo : reglas.deposito_maximo;
  const rapidos = [1, 2, 5, 10].map((n) => n * base).filter((m) => m <= maximo);

  $('montos-rapidos').replaceChildren(...rapidos.map((monto) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tecla';
    boton.textContent = dinero(monto);
    boton.addEventListener('click', () => ejecutar(monto));
    return boton;
  }));

  pantalla('monto');
}

$('form-monto').addEventListener('submit', (evento) => {
  evento.preventDefault();
  ejecutar(Number($('monto').value));
});

function ejecutar(monto) {
  $('error-monto').hidden = true;

  ocupado('p-monto', async () => {
    const respuesta = await fetch(`/api/cajero/${operacion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero_cuenta: cuenta.numero_cuenta, monto }),
    }).catch(() => null);

    const datos = respuesta ? await respuesta.json() : { error: 'No hay conexión con el servidor del cajero.' };
    if (!respuesta?.ok) return mostrarError('error-monto', datos.error);

    mostrarRecibo(datos);
  });
}

function fila(etiqueta, valor) {
  const div = document.createElement('div');
  const a = document.createElement('span');
  const b = document.createElement('span');
  a.textContent = etiqueta;
  b.textContent = valor;
  div.append(a, b);
  return div;
}

function mostrarRecibo(r) {
  const esRetiro = r.tipo === 'retiro';

  $('recibo-titulo').textContent = esRetiro ? 'Retira tu efectivo' : 'Depósito recibido';
  $('recibo-sub').textContent = esRetiro ? 'Operación autorizada por el Banco Central.' : 'El abono ya está en tu cuenta.';
  $('recibo').replaceChildren(
    fila('Transacción', `#${r.transaccion_id}`),
    fila('Cuenta', r.numero_cuenta),
    fila(esRetiro ? 'Retiro' : 'Depósito', dinero(r.monto)),
    fila('Saldo actual', dinero(r.saldo)),
    fila('Cajero', r.cajero),
    fila('Fecha', new Date(r.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })),
  );

  // Verificaciones que se hicieron, y dónde (cajero o banco)
  $('pasos').replaceChildren(...r.pasos.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = p.donde === 'cajero' ? 'Cajero: ' : 'Banco Central: ';
    li.append(b, p.texto);
    return li;
  }));

  pantalla('recibo');
}

function mostrarRechazo(titulo, texto) {
  $('recibo-titulo').textContent = titulo;
  $('recibo-sub').textContent = texto;
  $('recibo').replaceChildren();
  $('pasos').replaceChildren();
  pantalla('recibo');
}

iniciar();
