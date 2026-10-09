// Lógica LOCAL del cajero: configuración de la terminal y reglas que se
// revisan aquí, antes de pedirle nada al Banco Central.
const { leerConfig } = require('./seguridad');

const DEPOSITO_MULTIPLO = 50; // el cajero recibe billetes, no monedas

const entero = (valor, porDefecto) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
};

/**
 * Configuración vigente para la terminal que hace la petición.
 * Prioridad: lo guardado desde /admin en esta terminal; si no hay, variables de entorno.
 */
function configuracion(req) {
  const terminal = leerConfig(req) || {};

  return {
    apiKey: terminal.api_key || process.env.BANCO_API_KEY || '',
    origen: terminal.api_key ? 'terminal' : process.env.BANCO_API_KEY ? 'entorno' : 'ninguno',
    reglas: {
      multiplo: entero(terminal.multiplo, entero(process.env.ATM_MULTIPLO, 100)),
      retiro_maximo: entero(terminal.retiro_maximo, entero(process.env.ATM_RETIRO_MAXIMO, 8000)),
      deposito_maximo: entero(terminal.deposito_maximo, entero(process.env.ATM_DEPOSITO_MAXIMO, 20000)),
      deposito_multiplo: DEPOSITO_MULTIPLO,
    },
  };
}

const pesos = (n) => `$${Number(n).toLocaleString('es-MX')}`;

/** Devuelve el motivo del rechazo, o null si el monto se puede dispensar. */
function validarRetiro(monto, reglas) {
  if (!Number.isFinite(monto) || monto <= 0) return 'Escribe un monto válido.';
  if (!Number.isInteger(monto) || monto % reglas.multiplo !== 0) {
    return `Este cajero solo entrega múltiplos de ${pesos(reglas.multiplo)}.`;
  }
  if (monto > reglas.retiro_maximo) return `El máximo por retiro es ${pesos(reglas.retiro_maximo)}.`;
  return null;
}

function validarDeposito(monto, reglas) {
  if (!Number.isFinite(monto) || monto <= 0) return 'Escribe un monto válido.';
  if (!Number.isInteger(monto) || monto % reglas.deposito_multiplo !== 0) {
    return `Este cajero solo recibe billetes: múltiplos de ${pesos(reglas.deposito_multiplo)}.`;
  }
  if (monto > reglas.deposito_maximo) return `El máximo por depósito es ${pesos(reglas.deposito_maximo)}.`;
  return null;
}

const cuentaValida = (numero) => /^\d{4,20}$/.test(numero);

module.exports = { configuracion, validarRetiro, validarDeposito, cuentaValida, pesos };
