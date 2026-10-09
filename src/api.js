const express = require('express');
const banco = require('./banco');
const seguridad = require('./seguridad');
const cajero = require('./cajero');

const router = express.Router();

/** Error detectado por el propio cajero, sin llegar al Banco Central. */
class RechazoLocal extends Error {
  constructor(mensaje, pasos, status = 422) {
    super(mensaje);
    this.status = status;
    this.pasos = pasos;
  }
}

const paso = (pasos, donde, texto) => pasos.push({ donde, texto });

// =====================================================================
// CLIENTES DEL CAJERO
// =====================================================================

// Estado del cajero para la pantalla de bienvenida
router.get('/cajero', async (req, res) => {
  const { apiKey, reglas } = cajero.configuracion(req);
  if (!apiKey) return res.json({ en_servicio: false, motivo: 'Cajero sin configurar.' });

  try {
    const nodo = await banco.rpc(apiKey, 'nodo_info');
    if (nodo.tipo !== 'cajero') return res.json({ en_servicio: false, motivo: 'El API Key no corresponde a un cajero.' });

    res.json({ en_servicio: true, nombre: nodo.nombre, reglas });
  } catch (e) {
    if (!(e instanceof banco.ErrorBanco)) throw e;
    res.json({ en_servicio: false, motivo: e.message });
  }
});

/** Lee y valida el número de cuenta de la petición. */
function cuentaDe(req) {
  const numero = String(req.body?.numero_cuenta || '').trim();
  if (!cajero.cuentaValida(numero)) throw new RechazoLocal('Escribe un número de cuenta válido.', [], 400);
  return numero;
}

// Consulta de saldo en el Banco Central
router.post('/cajero/saldo', async (req, res) => {
  const { apiKey } = cajero.configuracion(req);
  const cuenta = await banco.rpc(apiKey, 'consultar_saldo', { p_numero_cuenta: cuentaDe(req) });

  res.json(cuenta);
});

// Retiro: primero la lógica local del cajero y solo después la transacción central
router.post('/cajero/retiro', async (req, res) => {
  const { apiKey, reglas } = cajero.configuracion(req);
  const numero = cuentaDe(req);
  const monto = Number(req.body?.monto);
  const pasos = [];

  // 1) Reglas locales (billetes y límite por operación)
  const motivo = cajero.validarRetiro(monto, reglas);
  if (motivo) throw new RechazoLocal(motivo, pasos);
  paso(pasos, 'cajero', `Monto válido: múltiplo de ${cajero.pesos(reglas.multiplo)} y dentro del límite de ${cajero.pesos(reglas.retiro_maximo)}.`);

  // 2) Efectivo disponible en este cajero
  const nodo = await banco.rpc(apiKey, 'nodo_info');
  if (Number(nodo.efectivo_disponible) < monto) {
    throw new RechazoLocal('Este cajero no tiene efectivo suficiente para ese monto. Intenta con una cantidad menor.', pasos, 409);
  }
  paso(pasos, 'cajero', 'El cajero tiene efectivo suficiente.');

  // 3) Saldo de la cuenta en el Banco Central
  const cuenta = await banco.rpc(apiKey, 'consultar_saldo', { p_numero_cuenta: numero });
  if (cuenta.estado !== 'activa') throw new RechazoLocal('La cuenta está bloqueada.', pasos, 403);
  if (Number(cuenta.saldo) < monto) {
    throw new RechazoLocal(`Fondos insuficientes. Tu saldo es ${cajero.pesos(cuenta.saldo)}.`, pasos, 409);
  }
  paso(pasos, 'banco', 'La cuenta tiene fondos suficientes.');

  // 4) Transacción central (el banco vuelve a validar todo de forma atómica)
  const resultado = await banco.rpc(apiKey, 'retirar', { p_numero_cuenta: numero, p_monto: monto });
  paso(pasos, 'banco', `Retiro autorizado. Transacción #${resultado.transaccion_id}.`);

  res.json({
    transaccion_id: resultado.transaccion_id,
    tipo: 'retiro',
    numero_cuenta: numero,
    nombre_titular: cuenta.nombre_titular,
    monto: resultado.monto,
    saldo: resultado.saldo,
    cajero: nodo.nombre,
    fecha: new Date().toISOString(),
    pasos,
  });
});

// Abono a la cuenta central
router.post('/cajero/deposito', async (req, res) => {
  const { apiKey, reglas } = cajero.configuracion(req);
  const numero = cuentaDe(req);
  const monto = Number(req.body?.monto);
  const pasos = [];

  const motivo = cajero.validarDeposito(monto, reglas);
  if (motivo) throw new RechazoLocal(motivo, pasos);
  paso(pasos, 'cajero', `Monto válido: billetes de ${cajero.pesos(reglas.deposito_multiplo)} o más, dentro del límite de ${cajero.pesos(reglas.deposito_maximo)}.`);

  const cuenta = await banco.rpc(apiKey, 'consultar_saldo', { p_numero_cuenta: numero });
  if (cuenta.estado !== 'activa') throw new RechazoLocal('La cuenta está bloqueada.', pasos, 403);
  paso(pasos, 'banco', 'La cuenta existe y está activa.');

  const resultado = await banco.rpc(apiKey, 'depositar', { p_numero_cuenta: numero, p_monto: monto });
  paso(pasos, 'banco', `Depósito registrado. Transacción #${resultado.transaccion_id}.`);

  const nodo = await banco.rpc(apiKey, 'nodo_info');

  res.json({
    transaccion_id: resultado.transaccion_id,
    tipo: 'deposito',
    numero_cuenta: numero,
    nombre_titular: cuenta.nombre_titular,
    monto: resultado.monto,
    saldo: resultado.saldo,
    cajero: nodo.nombre,
    fecha: new Date().toISOString(),
    pasos,
  });
});

// =====================================================================
// PANEL ADMINISTRATIVO
// =====================================================================

router.post('/admin/login', (req, res) => {
  const { usuario, password } = req.body || {};

  if (!process.env.ATM_ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Falta ATM_ADMIN_PASSWORD en las variables de entorno.' });
  }
  if (!seguridad.credencialesValidas(usuario, password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  seguridad.iniciarSesion(req, res, usuario);
  res.json({ usuario });
});

router.post('/admin/logout', (req, res) => {
  seguridad.cerrarSesion(res);
  res.json({ ok: true });
});

router.use('/admin', seguridad.requiereAdmin);

const prefijo = (apiKey) => (apiKey ? `${apiKey.slice(0, 12)}…` : '');

// Configuración vigente, datos del nodo y últimos movimientos hechos en este cajero
router.get('/admin/estado', async (req, res) => {
  const { apiKey, origen, reglas } = cajero.configuracion(req);
  const estado = { usuario: req.admin, origen, api_key: prefijo(apiKey), reglas };

  if (!apiKey) return res.json(estado);

  try {
    estado.nodo = await banco.rpc(apiKey, 'nodo_info');
    estado.movimientos = await banco.rpc(apiKey, 'historial', { p_limite: 20 });
  } catch (e) {
    if (!(e instanceof banco.ErrorBanco)) throw e;
    estado.error = e.message;
  }

  res.json(estado);
});

// Guarda la configuración en esta terminal. El API Key se verifica contra el banco.
router.put('/admin/config', async (req, res) => {
  const actual = seguridad.leerConfig(req) || {};
  const nuevoKey = String(req.body?.api_key || '').trim();
  const config = { ...actual };

  if (nuevoKey) {
    const nodo = await banco.rpc(nuevoKey, 'nodo_info');
    if (nodo.tipo !== 'cajero') {
      return res.status(400).json({ error: 'Ese API Key pertenece a una sucursal, no a un cajero.' });
    }
    config.api_key = nuevoKey;
  }

  for (const campo of ['multiplo', 'retiro_maximo', 'deposito_maximo']) {
    if (req.body?.[campo] === undefined || req.body[campo] === '') continue;

    const valor = Number(req.body[campo]);
    if (!Number.isInteger(valor) || valor <= 0 || valor > 1000000) {
      return res.status(400).json({ error: 'Las reglas del cajero deben ser números enteros positivos.' });
    }
    config[campo] = valor;
  }

  const multiplo = config.multiplo ?? cajero.configuracion(req).reglas.multiplo;
  const maximo = config.retiro_maximo ?? cajero.configuracion(req).reglas.retiro_maximo;
  if (maximo % multiplo !== 0) {
    return res.status(400).json({ error: 'El retiro máximo debe ser múltiplo de la denominación.' });
  }

  seguridad.guardarConfig(req, res, config);
  res.json({ ok: true });
});

// Borra la configuración de esta terminal (vuelve a las variables de entorno)
router.delete('/admin/config', (req, res) => {
  seguridad.borrarConfig(res);
  res.json({ ok: true });
});

module.exports = { router, RechazoLocal };
