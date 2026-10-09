# Cajero automático · Servidor ATM (Nodo 3)

Backend ligero en Express con la interfaz del cajero para clientes y un panel
administrativo. No tiene base de datos ni archivos: todo se pide al Banco Central
(Supabase) mediante funciones RPC, identificándose con el API Key del cajero.

## Funcionalidades

| Requisito del examen | Dónde está |
|---|---|
| Interfaz de acciones básicas para clientes | `/` : saldo, retiro, depósito |
| Consultar saldo central y retirar si hay fondos | `POST /api/cajero/retiro` (paso 3 y 4) |
| Abonos a la cuenta central | `POST /api/cajero/deposito` |
| Lógica local independiente | `src/cajero.js` y pasos 1 y 2 del retiro |
| Panel para configurar el cajero con su API Key | `/admin` |

## Cómo se autoriza un retiro

1. **Cajero:** el monto es múltiplo de la denominación y no supera el límite por retiro.
2. **Cajero:** hay efectivo suficiente en este cajero.
3. **Banco Central:** la cuenta está activa y tiene fondos.
4. **Banco Central:** se ejecuta `retirar`, que vuelve a validar todo de forma atómica.

Si falla el paso 1 o 2 no se envía ninguna transacción al banco. La respuesta
incluye `pasos` con lo que se verificó y `rechazado_por` (`cajero` o `banco`).

## Instalación local

Requiere Node 20 o superior.

```bash
npm install
cp .env.example .env
```

Editar `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (clave anon, nunca service_role),
`ATM_ADMIN_PASSWORD` y `SESSION_SECRET`.

```bash
npm start        # o: npm run dev
```

1. Abrir http://localhost:3001/admin e iniciar sesión.
2. Pegar el API Key que muestra el panel del Banco Central al crear el cajero.
3. Abrir http://localhost:3001 y operar con un número de cuenta.

## Dónde se guarda la configuración

- **Desde `/admin`:** en una cookie cifrada (AES-256-GCM) del navegador donde se
  configuró. Ese navegador queda como la terminal del cajero; otro navegador no la ve.
- **Variable `BANCO_API_KEY`:** configuración por defecto para cualquier navegador.
  Conviene definirla en Vercel para que el enlace público funcione sin configurar nada.

No se usa disco porque en Vercel los archivos no persisten entre peticiones.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/cajero` | Estado del cajero y reglas locales |
| POST | `/api/cajero/saldo` | `{ numero_cuenta }` |
| POST | `/api/cajero/retiro` | `{ numero_cuenta, monto }` |
| POST | `/api/cajero/deposito` | `{ numero_cuenta, monto }` |
| POST | `/api/admin/login` | `{ usuario, password }` |
| POST | `/api/admin/logout` | Cierra la sesión |
| GET | `/api/admin/estado` | Configuración, datos del nodo y últimos movimientos |
| PUT | `/api/admin/config` | `{ api_key?, multiplo?, retiro_maximo?, deposito_maximo? }` |
| DELETE | `/api/admin/config` | Quita la configuración de la terminal |
| GET | `/api/salud` | Comprobación de vida |

Códigos de error: 400 datos mal formados, 401 API Key o sesión inválida, 403 cuenta
bloqueada o cajero inactivo, 404 cuenta inexistente, 409 sin fondos o sin efectivo,
422 monto rechazado por las reglas locales, 503 cajero sin configurar o sin conexión.

## Estructura

| Archivo | Qué hace |
|---|---|
| `server.js` | Arranque local |
| `api/index.js` | Entrada en Vercel |
| `vercel.json` | Envía `/api/*` a la función; `public/` se sirve como estático |
| `src/app.js` | Express: middlewares y manejo de errores |
| `src/api.js` | Rutas del cajero y del panel |
| `src/cajero.js` | Lógica local: configuración vigente y reglas de montos |
| `src/banco.js` | Cliente de Supabase: llamadas RPC y traducción de errores |
| `src/seguridad.js` | Sesión del administrador y cookie cifrada de configuración |
| `public/` | Interfaz del cajero y panel (HTML, CSS y JavaScript sin frameworks) |

## Despliegue en Vercel

1. Importar el repositorio de GitHub en Vercel (Framework Preset: **Other**).
2. Variables de entorno: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BANCO_API_KEY`,
   `ATM_ADMIN_USUARIO`, `ATM_ADMIN_PASSWORD`, `SESSION_SECRET`.
3. Cada `git push` a `main` vuelve a desplegar.

## Límites conocidos

- El cliente se identifica solo con su número de cuenta: el esquema del banco no tiene NIP.
- No hay límite de intentos por cliente.
- Hay un solo usuario administrador, definido en variables de entorno.
