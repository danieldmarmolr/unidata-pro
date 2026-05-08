# Guia para conectar Unifull (Railway) a las BBDD del grupo Unistore en AWS

> Doc respondido con la info concreta de Unistore. Pensado para pasarle a la persona que esta desarrollando **unifull** y que necesita la misma habilitacion que UNIDATA ya consiguio.

---

## TL;DR — lo que tu app necesita

1. Las BBDD de Unistore estan **privadas en una VPC de AWS**, accesibles solo via **bastion host SSH** (no son publicas y no se van a hacer publicas).
2. Hay **2 bastions** (uno por unidad de negocio): Unistore y Unidrop.
3. Tu backend en Railway tiene que abrir **SSH tunnels** a esos bastions y conectarse al Postgres a traves del tunel.
4. Para que AWS deje pasar a Railway, la **IP estatica de Railway** tiene que estar **allowlistada** en los Security Groups de los 2 bastions.
5. Esa habilitacion la hace **Mauro Candia** (data engineer) con un ticket de Jira. Lo hace una sola vez y queda fijo.

---

## Respuestas concretas al doc que te pasaron

### 1. ¿RDS publica o privada?
**Privada.** Las RDS de Unistore viven dentro de una VPC privada en `us-east-2 (Ohio)`. No son accesibles desde internet ni se van a hacer publicas. Olvidate de la "Opcion (a)" del doc generico — para Unistore aplica solo la **Opcion (b): bastion host**.

### 2. ¿Hay bastion disponible?
**Si, dos:**

| Bastion | IP publica | Region | Sirve para |
|---|---|---|---|
| Unistore | `3.139.209.227` | `us-east-2` | DB unistore + DB unidev (misma instancia RDS) |
| Unidrop  | `18.191.119.38` | `us-east-2` | DB unidrop |

### 3. ¿Engine, endpoint, puerto?

| | Engine | Endpoint RDS | Puerto |
|---|---|---|---|
| Unistore | PostgreSQL 14 | `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com` | 5432 |
| Unidev   | PostgreSQL 14 | `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com` (mismo Postgres, distinta DB) | 5432 |
| Unidrop  | PostgreSQL 14 | `unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com` | 5432 |

### 4. ¿Nombre de la DB?

| App | DB name |
|---|---|
| Unistore | `unistore_api` |
| Unidev | `unidev` |
| Unidrop | `unidrop` |

### 5. ¿User/password?

A pedirle a Mauro Candia formalmente. Hoy se usan los **users de produccion** existentes (no son read-only — esto es subóptimo y deberia evolucionar). Pedi explicitamente:

- Un user PostgreSQL **read-only** dedicado a Unifull, con permisos solo `SELECT` en los schemas que necesites.
- Idealmente uno por DB (Unistore, Unidev, Unidrop).

Si Mauro no puede crear user nuevo, te va a dar el de prod (mismo que usa UNIDATA). En ese caso, **bloquea por codigo** cualquier query que no empiece con `SELECT` o `WITH`, para no romper prod por accidente.

### 6. ¿La conexion va por SSH tunnel?
**Si.** Tu app tiene que:
1. Levantar un `SSHTunnelForwarder` (libreria `sshtunnel` en Python; equivalentes en Node) usando la llave `.pem` del bastion.
2. Mappear el puerto remoto 5432 (RDS) a un puerto local cualquiera (ej `5433`).
3. Conectarse al Postgres apuntando a `localhost:5433`.

Pedile a Mauro las llaves `.pem`:
- `unistore-bastion-key.pem` (sirve para Unistore + Unidev)
- `unidrop-bastion-key.pem`

### 7. ¿Tu IP de oficina ya esta allowlistada?
Probablemente **si** (asi te conectas desde DBeaver durante desarrollo). Si no, pedile a Mauro que tambien sume tu IP publica actual al SG mientras desarrollas. La sacas en https://whatismyip.com — la mandas como `<TU_IP>/32`.

### 8. ¿Como obtengo la IP estatica de Railway para produccion?
**Plan Pro (USD 20/mes la workspace) requerido.**

Pasos:
1. Upgradeas tu workspace a Pro: https://railway.com/account/plans
2. En tu service backend → **Settings** → seccion **Networking**.
3. Activas el toggle **Enable Static IPs**.
4. Te muestra la IP (formato `XXX.XXX.XXX.XXX`).
5. **Re-deployas el service** (Railway lo aclara con un warning amarillo: "Re-deploy to take effect").
6. Verificas que la IP nueva este efectiva. Forma rapida: agregas un endpoint temporal a tu backend:

   ```python
   @app.get("/api/_meta/outbound-ip")
   def outbound_ip():
       import urllib.request
       with urllib.request.urlopen("https://api.ipify.org", timeout=5) as r:
           return {"outbound_ip": r.read().decode().strip()}
   ```

   `curl https://<tu-backend>.up.railway.app/api/_meta/outbound-ip` debe devolver la misma IP que mostro Railway. Si no coincide, no se hizo el redeploy.

7. **Esa IP es la que va al ticket de Jira para Mauro.**

### 9. ¿Que le mando a Mauro?
Un ticket de Jira con esta estructura (template del ticket de UNIDATA, te puedo pasar el archivo):

- **Title:** `[Unifull] Allowlistar IP estatica de Railway en SG de bastions Unistore + Unidrop`
- **Pedido:** sumar `<TU_IP_RAILWAY>/32` al inbound SG (SSH/22) de los 2 bastions (`3.139.209.227` y `18.191.119.38`).
- **Notas:** mismo patron que ya hizo para UNIDATA (Daniel Marmol). Cero cambios en RDS, passwords ni llaves.

Tiempo de Mauro: 5-10 min por proyecto.

---

## Recomendacion practica: ticket consolidado

**Coordina con Daniel Marmol** para que UNIDATA + Unifull vayan en **un solo ticket de Jira con las 2 IPs**. Asi Mauro hace todo en una sola sesion y los dos proyectos quedan habilitados juntos.

Daniel ya tiene el ticket de UNIDATA listo para mandar. Si vos pasas tu IP estatica antes de mandarlo, suma la tuya y queda un solo pedido para los dos.

---

## Riesgos y compromisos a entender

1. **Si no pagas Pro Plan en Railway, la IP es dinamica** y puede cambiar. Cada vez que cambia hay que reabrir ticket con Mauro. **No es viable para produccion** — paga el Pro y olvidate.
2. **Si eliminas el service de Railway o lo recreas, la IP cambia.** No toques el service una vez desplegado.
3. **Tu PC (la de desarrollo)** tiene su propia IP allowlistada — la de Railway es independiente. Ambas tienen que estar.
4. **Las passwords que te pase Mauro son sensibles.** Nunca las commiteas a git. Usalas como variables de entorno en Railway (cifradas) y en tu `.env` local (gitignored).
5. **Si la red de tu oficina cambia de IP saliente** (DHCP), perdes acceso desde DBeaver hasta que Mauro actualice el SG. Conviene tener IP fija en oficina o pedirle a Mauro que allowlistee un rango mas amplio (ej `/24` de tu ISP).

---

## Stack sugerido (lo que uso UNIDATA, podes copiar)

- **Backend:** FastAPI + SQLAlchemy 2.0 + `sshtunnel` + `psycopg2-binary` + `python-dotenv`
- **Frontend:** Next.js 16 (Turbopack) — o el framework que prefieras
- **Persistencia local:** SQLite con volumen Railway montado en `/app/data` (para users, audit logs, cache)
- **Auth:** JWT con bcrypt (PyJWT + passlib)
- **Deploy:** Dockerfile multi-stage, monorepo con `--path-as-root` por servicio en Railway
- **CORS:** `ALLOWED_ORIGINS` desde env var (lista del dominio del frontend)

Si queres ver implementacion real, el repo de UNIDATA es referencia: `github.com/danieldmarmolr/unidata-pro`

---

## Contacto

- **Daniel Marmol** — `daniel.marmol@unistor.ar` — autor de UNIDATA, ya hizo este flujo end-to-end
- **Mauro Candia** — data engineer / AWS — ejecuta el ticket
