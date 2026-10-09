// Sesión del administrador (cookie firmada) y configuración de la terminal
// (cookie cifrada). No se usa disco: en Vercel los archivos no persisten.
const crypto = require('crypto');

const COOKIE_SESION = 'atm_admin';
const COOKIE_CONFIG = 'atm_config';
const SESION_MS = 2 * 60 * 60 * 1000;
const CONFIG_MS = 365 * 24 * 60 * 60 * 1000;

// Debe ser igual en todas las instancias del servidor, por eso no es aleatorio:
// si falta SESSION_SECRET se deriva de la contraseña del administrador.
function secreto() {
  const base = process.env.SESSION_SECRET || `atm:${process.env.ATM_ADMIN_PASSWORD || ''}`;
  return crypto.createHash('sha256').update(base).digest();
}

const firmar = (texto) => crypto.createHmac('sha256', secreto()).update(texto).digest('base64url');

function iguales(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function leerCookie(req, nombre) {
  const par = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${nombre}=`));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

const opciones = (req, maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge, path: '/' });

// ---------- Sesión del administrador ----------

function credencialesValidas(usuario, password) {
  const esperado = process.env.ATM_ADMIN_PASSWORD;
  if (!esperado) return false; // sin contraseña configurada nadie entra

  return iguales(usuario, process.env.ATM_ADMIN_USUARIO || 'admin') && iguales(password, esperado);
}

function iniciarSesion(req, res, usuario) {
  const datos = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + SESION_MS })).toString('base64url');
  res.cookie(COOKIE_SESION, `${datos}.${firmar(datos)}`, opciones(req, SESION_MS));
}

function cerrarSesion(res) {
  res.clearCookie(COOKIE_SESION, { path: '/' });
}

function leerSesion(req) {
  const [datos, firma] = (leerCookie(req, COOKIE_SESION) || '').split('.');
  if (!datos || !firma || !iguales(firma, firmar(datos))) return null;

  try {
    const sesion = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return sesion.exp > Date.now() ? sesion : null;
  } catch {
    return null;
  }
}

function requiereAdmin(req, res, next) {
  const sesion = leerSesion(req);
  if (!sesion) return res.status(401).json({ error: 'Inicia sesión como administrador.', codigo: 'SIN_SESION' });

  req.admin = sesion.u;
  next();
}

// ---------- Configuración de la terminal (AES-256-GCM) ----------

function guardarConfig(req, res, config) {
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', secreto(), iv);
  const cifrado = Buffer.concat([cifrador.update(JSON.stringify(config), 'utf8'), cifrador.final()]);
  const valor = [iv, cifrador.getAuthTag(), cifrado].map((b) => b.toString('base64url')).join('.');

  res.cookie(COOKIE_CONFIG, valor, opciones(req, CONFIG_MS));
}

function leerConfig(req) {
  const partes = (leerCookie(req, COOKIE_CONFIG) || '').split('.');
  if (partes.length !== 3) return null;

  try {
    const [iv, etiqueta, cifrado] = partes.map((p) => Buffer.from(p, 'base64url'));
    const descifrador = crypto.createDecipheriv('aes-256-gcm', secreto(), iv);
    descifrador.setAuthTag(etiqueta);
    return JSON.parse(Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8'));
  } catch {
    return null; // cookie alterada o cifrada con otro secreto
  }
}

function borrarConfig(res) {
  res.clearCookie(COOKIE_CONFIG, { path: '/' });
}

module.exports = {
  credencialesValidas, iniciarSesion, cerrarSesion, leerSesion, requiereAdmin,
  guardarConfig, leerConfig, borrarConfig,
};
