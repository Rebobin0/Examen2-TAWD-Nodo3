# Nodo 3 · Servidor de cajero automático (ATM)

Backend ligero y pantalla del cajero del **Sistema Bancario Distribuido**
(Examen 2 Práctico): consulta de saldo, retiros y depósitos, con su panel de configuración.

## Enlaces

| Nodo | Aplicación desplegada | Tecnología |
|---|---|---|
| 1 · Banco Central | https://examen2-tawd-nodo1.onrender.com | Laravel + Supabase |
| 2 · Sucursal | https://examen2-tawd-nodo2.onrender.com | Express |
| **3 · Cajero automático** | https://examen2-tawd-nodo3.onrender.com | Express |
| Panel administrativo del cajero | https://examen2-tawd-nodo3.onrender.com/admin | |

La aplicación está en el plan gratuito de Render: si lleva un rato sin uso, la primera
carga tarda cerca de un minuto.

## Arquitectura del nodo

El cajero no tiene base de datos. Aplica primero su lógica local y, si la operación
pasa, la envía al Banco Central (Supabase) identificándose con el API Key del cajero.

```mermaid
flowchart LR
    cliente([Cliente])
    admin([Administrador del cajero])

    subgraph nodo3 [Nodo 3 · Cajero en Render]
        atm["Pantalla del cajero<br/>public/index.html"]
        panel["Panel administrativo<br/>public/admin.html"]
        api["API REST<br/>src/api.js"]
        local["Lógica local<br/>src/cajero.js"]
        seg["Sesión y configuración cifrada<br/>src/seguridad.js"]
        banco["Cliente del banco<br/>src/banco.js"]
        atm --> api
        panel --> api
        api --> local
        api --> seg
        api --> banco
    end

    subgraph supabase [Supabase · Banco Central]
        rpc["Funciones RPC<br/>valida el API Key"]
        db[("PostgreSQL")]
        rpc --> db
    end

    n1["Nodo 1 · Banco Central"]

    cliente --> atm
    admin --> panel
    banco -- "supabase-js + API Key" --> rpc
    n1 -. "genera el API Key<br/>del cajero" .-> seg
```

| Función | Dónde | Ruta del nodo | Función en el Banco Central |
|---|---|---|---|
| Consultar saldo | Pantalla del cajero | `POST /api/cajero/saldo` | `consultar_saldo` |
| Retirar efectivo | Pantalla del cajero | `POST /api/cajero/retiro` | `nodo_info`, `consultar_saldo`, `retirar` |
| Abonar a una cuenta | Pantalla del cajero | `POST /api/cajero/deposito` | `consultar_saldo`, `depositar` |
| Configurar el API Key y las reglas | Panel `/admin` | `PUT /api/admin/config` | `nodo_info` |
| Ver efectivo y movimientos del cajero | Panel `/admin` | `GET /api/admin/estado` | `nodo_info`, `historial` |

### Lógica local del cajero

Un retiro pasa por cuatro verificaciones. Las dos primeras las hace el cajero por su
cuenta; si alguna falla, no se envía nada al banco.

```mermaid
flowchart TB
    inicio([Cliente pide un retiro]) --> p1{"1 · Cajero<br/>¿Múltiplo de $100 y<br/>dentro del límite?"}
    p1 -- no --> r1["Rechazado por el cajero"]
    p1 -- sí --> p2{"2 · Cajero<br/>¿Hay efectivo<br/>en este cajero?"}
    p2 -- no --> r1
    p2 -- sí --> p3{"3 · Banco Central<br/>¿Cuenta activa<br/>y con fondos?"}
    p3 -- no --> r2["Rechazado: sin fondos<br/>o cuenta bloqueada"]
    p3 -- sí --> p4["4 · Banco Central<br/>retirar: descuenta saldo y efectivo,<br/>registra la transacción"]
    p4 --> fin([Entrega efectivo y comprobante])
```

El comprobante muestra los cuatro pasos y quién verificó cada uno. Las reglas
(denominación, retiro máximo y depósito máximo) se cambian desde el panel.

### Configuración del cajero

1. El administrador del banco crea el cajero en el nodo 1 y obtiene su API Key (`bk_atm_…`).
2. El API Key se define en la variable `BANCO_API_KEY`, o se pega en el panel `/admin`.
3. El panel lo verifica contra el banco, rechaza los que son de sucursal y lo guarda
   cifrado (AES-256-GCM) en una cookie del navegador, que queda como terminal del cajero.

El cliente se identifica con su número de cuenta; el esquema del banco no incluye NIP.

## OpenAPI

[`openapi.yaml`](openapi.yaml) documenta las rutas de este servidor: operaciones del
cajero y panel administrativo, con sus códigos de error.

Para verlo como documentación interactiva, abrir https://editor.swagger.io y pegar el
contenido del archivo.

## Despliegue

Web Service de Node en Render, con despliegue automático en cada `git push` a `main`.

| Paso | Valor |
|---|---|
| Construcción | `npm install` |
| Arranque | `npm start` |

Variables de entorno: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BANCO_API_KEY`,
`ATM_ADMIN_USUARIO`, `ATM_ADMIN_PASSWORD`, `SESSION_SECRET`.

El pipeline completo y el flujo entre los tres nodos están explicados en el README del nodo 1.

## Ejecución local

Requiere Node 20 o superior.

```bash
npm install
cp .env.example .env
npm start
```

Abrir http://localhost:3001 (cajero) y http://localhost:3001/admin (panel).