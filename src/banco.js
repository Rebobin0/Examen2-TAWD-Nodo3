// Cliente del Banco Central. El cajero nunca toca tablas: solo llama a las
// funciones RPC, que validan el API Key del nodo en cada operación.
const { createClient } = require('@supabase/supabase-js');

const MENSAJES = {
  API_KEY_INVALIDA: 'El API Key del cajero no es válido.',
  NODO_INACTIVO: 'El Banco Central desactivó este cajero.',
  CUENTA_NO_ENCONTRADA: 'La cuenta no existe.',
  CUENTA_BLOQUEADA: 'La cuenta está bloqueada.',
  MONTO_INVALIDO: 'El monto no es válido.',
  FONDOS_INSUFICIENTES: 'Fondos insuficientes en la cuenta.',
  EFECTIVO_INSUFICIENTE_EN_NODO: 'El cajero no tiene efectivo suficiente.',
};

class ErrorBanco extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

let cliente;

function supabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new ErrorBanco(500, 'SIN_CONFIGURAR', 'Faltan SUPABASE_URL o SUPABASE_ANON_KEY en las variables de entorno.');
  }

  cliente ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cliente;
}

/** Llama a una función del Banco Central identificándose con el API Key del cajero. */
async function rpc(apiKey, funcion, parametros = {}) {
  if (!apiKey) {
    throw new ErrorBanco(503, 'SIN_API_KEY', 'El cajero aún no está configurado.');
  }

  const args = { p_api_key: apiKey };
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null) args[clave] = valor;
  }

  let respuesta;
  try {
    respuesta = await supabase().rpc(funcion, args);
  } catch (e) {
    if (e instanceof ErrorBanco) throw e;
    throw new ErrorBanco(503, 'SIN_CONEXION', 'No se pudo conectar con el Banco Central.');
  }

  const { data, error, status } = respuesta;

  if (error) {
    if (!status) {
      throw new ErrorBanco(503, 'SIN_CONEXION', 'No se pudo conectar con el Banco Central.');
    }

    const codigo = error.message || 'ERROR_DESCONOCIDO';
    throw new ErrorBanco(status, codigo, MENSAJES[codigo] || `El Banco Central respondió con un error: ${codigo}`);
  }

  return data;
}

module.exports = { rpc, ErrorBanco };
