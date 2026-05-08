# UNIDATA — Arquitectura

Referencia tecnica de como funciona la plataforma. Sirve de onboarding para nuevos
devs y de checklist cuando algo se rompe.

---

## Modelo de unidades de negocio

> **Importante:** UNIDATA respeta la separacion de unidades de negocio del
> grupo Unistore. Las unidades **NO se mezclan** en ningun dashboard ni
> query — cada vista muestra datos de una sola unidad.

```
┌──────────────────────────────────────────────────────────────────┐
│  GRUPO UNISTORE                                                  │
│                                                                  │
│  ┌────────────────────────────────────┐   ┌──────────────────┐  │
│  │ UNIDAD: UNISTORE                   │   │ UNIDAD: UNIDROP  │  │
│  │ DB principal: unistore_api         │   │ DB: unidrop      │  │
│  │ Schema relacionado: unidev (DB)    │   │                  │  │
│  │   └─ Devoluciones                  │   │ Especifico:      │  │
│  │ Especifico:                        │   │  · Dropshippers  │  │
│  │  · Tienda Nube (canal e-commerce)  │   │  · TaloPay       │  │
│  │  · Suscripciones MELI              │   │  · SaaS metrics  │  │
│  │  · Costos de importacion           │   │                  │  │
│  └────────────────────────────────────┘   └──────────────────┘  │
│                                                                  │
│  Bastion EC2 separado por unidad. RDS Postgres separadas.       │
└──────────────────────────────────────────────────────────────────┘
```

### Reglas clave

1. **Cada dashboard / query muestra una unidad a la vez.** Si un usuario
   quiere ver "ventas de Unistore" y "ventas de Unidrop", ve dos pantallas
   separadas o un selector de unidad — nunca un agregado sumado.

2. **Hay metricas que solo existen en una unidad.** Por ejemplo:
   - `Pagos Talo` y `SaaS Metrics` -> solo Unidrop (en Unistore no hay TaloPay)
   - `Suscripciones MELI` y `Costos de importacion` -> solo Unistore
   - `Devoluciones` -> solo Unistore (gestionadas en la DB `unidev`)

3. **Unidev es una DB separada dentro del mismo Postgres de Unistore**, no
   una tercera unidad. Tecnicamente el backend la trata como connection
   independiente (porque es un nombre de DB distinto), pero conceptualmente
   forma parte del dominio de Unistore — es donde se manejan devoluciones.

4. **Si en el futuro hace falta una vista comparativa cross-unit** (ej.
   "ventas Unistore vs Unidrop"), se construye explicitamente como dashboard
   "Cross-Unit Comparison" — nunca se mezclan implicitamente.

### Implicaciones tecnicas

- `app/services/sales_unistore.py` y `app/services/sales_unidrop.py` son
  funciones separadas, cada una abre su tunel SSH y ejecuta queries solo
  contra su RDS.
- Los endpoints `/api/dashboards/<area>/<unidad>` siempre tienen `unidad`
  como path param obligatorio.
- El frontend `/dashboard/home` lista los tiles e indica la unidad de cada
  uno en la descripcion (`solo Unidrop`, `Unistore`, `vista por unidad`).
- El SQL libre y Explorador piden elegir unidad antes de correr queries —
  no se puede ejecutar una query "sobre las 3 bases" simultaneamente.

### Regla de oro para devs (REGLA DE NO-MEZCLA)

> Cualquier dev que sume datos de Unistore + Unidrop en una misma metrica
> esta violando la arquitectura. Esto NO se hace.

#### Patron correcto (lo que ya hace el dashboard "Gerencial")

```python
# Cada KPI declara su unidad en el label y usa su propio engine.
# Las cards se muestran lado-a-lado en la UI, nunca sumadas.

blocks = [
    {"label": "GMV Unistore",           "engine": "unistore"},  # ✅
    {"label": "GMV Unidrop",            "engine": "unidrop"},   # ✅
    {"label": "Pagos Talo (Unidrop)",   "engine": "unidrop"},   # ✅
    {"label": "Devoluciones (Unidev)",  "engine": "unidev"},    # ✅
]
```

#### Anti-patron prohibido

```python
# ❌ PROHIBIDO: sumar datos de unidades diferentes en una sola metrica.
total_gmv = gmv_unistore + gmv_unidrop  # NUNCA HACER ESTO

# ❌ PROHIBIDO: queries que asuman tablas comunes.
sql = "SELECT * FROM ventas"  # cada DB tiene sus propias tablas
```

#### Excepcion controlada — comparativa explicita

Si una vista DELIBERADAMENTE muestra ambas unidades para comparar (no para
sumar), debe:

1. Llamarse de forma explicita: `Comparativa cross-unidad`, `Vista comparativa`,
   nunca solo `Total grupo` o similar (sugiere agregacion).
2. Cada metrica/columna lleva chip visible con la unidad de origen.
3. NO debe haber un "Total" sumado abajo.
4. Documentado como `# CROSS-UNIT-VIEW` en el codigo para que devs futuros
   sepan que es excepcion intencional.

#### Razones de negocio para esta regla

- **Modelos de negocio diferentes:** Unistore vende productos propios via Tienda
  Nube y MELI. Unidrop opera dropshipping con TaloPay. Sumar GMV de ambos no
  significa nada — es como sumar ventas de un retailer con ingresos de una
  fintech.
- **Comparaciones engañosas:** un mes Unidrop puede tener picos por adquisicion
  de dropshippers, otro mes Unistore por Black Friday. Si las sumas, no entendes
  que cambio.
- **Auditoria:** finanzas y contabilidad ya consolidan cada unidad por separado
  con sus propias reglas. UNIDATA no debe inventar consolidaciones paralelas.

---

## Vision general

```
                    [Internet]
                         |
                         v
            +--------------------------+
            |  Railway Edge (HTTPS)    |
            +--------------------------+
                  |              |
                  v              v
          +-------------+   +-------------+
          |  frontend   |   |   backend   |
          |  Next.js 16 |   |  FastAPI    |
          |  port 3000  |-->|  port 8000  |
          +-------------+   +-------------+
                                  |
              +-------------------+-------------------+
              |                   |                   |
              v                   v                   v
      +--------------+   +-----------------+   +--------------+
      | Supabase PG  |   | AWS Bastion SSH |   | Health/Diag  |
      | (us-west-1)  |   | (us-east-2)     |   | endpoints    |
      | users/audit/ |   | -> RDS Postgres |   |              |
      | costs        |   |    privadas     |   |              |
      +--------------+   +-----------------+   +--------------+
```

---

## Componentes

### 1. Frontend (`frontend/`)

- **Stack:** Next.js 16 (Turbopack) + Tailwind + React Query + Recharts + react-simple-maps + d3-geo.
- **Auth state:** JWT en `localStorage` (`unidata.token`), user en `localStorage` (`unidata.user`).
- **API client:** `lib/api.ts` envuelve `fetch` con bearer token automatico, manejo de 401 -> redirect a `/login`.
- **Rutas:**
  - `/` redirect a `/login` o `/dashboard/home` segun haya token.
  - `/login` — form login.
  - `/register` — wizard 2 pasos (email/nombre -> password).
  - `/dashboard/home` — landing post-login.
  - `/dashboard/<unidad>/<vista>` — dashboards.
  - `/admin/usuarios` — CRUD usuarios (solo admin).
  - `/admin/auditoria` — audit log (solo admin).
  - `/queries` — editor SQL libre.
- **Build:** Dockerfile multi-stage (`deps` -> `builder` -> `runner`). Usa `NEXT_PUBLIC_API_URL` como `ARG` (bake-time, no runtime).

### 2. Backend (`backend/`)

- **Stack:** FastAPI + SQLAlchemy 2.0 + sshtunnel + psycopg2 + pandas + bcrypt + PyJWT.
- **Routers:**
  - `app/api/auth.py` — `/api/auth/login`, `/register`, `/set-initial-password`, `/check`, `/me`, `/change-password`.
  - `app/api/admin.py` — `/api/admin/users` CRUD.
  - `app/api/sources.py` — `/api/sources/<unit>/...` (introspection schemas/tables).
  - `app/api/queries.py` — `/api/queries/<unit>/run` (SQL libre read-only).
  - `app/api/dashboards/*` — endpoints especificos de cada vista.
  - `app/api/drilldowns.py` — endpoints de drilldown.
  - `app/api/reports.py` — exports.
  - `app/api/costs.py` — gestion de catalogo de costos.
- **Auth middleware:** `app/auth/security.py` valida JWT, inyecta `current_user` como dependency.
- **DB de negocio:** `app/db/engines.py` abre `SSHTunnelForwarder` por unidad y devuelve un SQLAlchemy `Engine` con `statement_timeout=30000` y query parser que bloquea DML/DDL.
- **DB propia:** `app/db/local_persistence.py` (pool `psycopg2.pool.ThreadedConnectionPool`, 1-10 conns, `RealDictCursor`).
- **Modulos de persistencia propia:**
  - `app/db/users_db.py` — usuarios + roles.
  - `app/db/costs_db.py` — costos.
  - `app/services/audit.py` — query audit log.
- **Entrypoint:** `entrypoint.sh` materializa SSH keys desde env vars base64 y arranca uvicorn en `$PORT`.

### 3. Persistencia propia (Supabase)

- **Region:** West US (North California, `us-west-1`).
- **Plan:** Free tier (500 MB, suficiente para >100 users + 1 ano de audit log).
- **Conexion:** **Session pooler** IPv4 (puerto 5432) para compatibilidad con Railway (que no soporta IPv6 outbound por default).
- **Tablas:**
  - `users` (id, email, name, password_hash, role, is_active, created_at, updated_at, created_by)
  - `cost_lote` + `cost_item` + `usd_rate_cache` (catalogo de costos importados)
  - `query_runs` (audit log de SQL)
- **Backups:** automaticos diarios por Supabase. Para Sprint 2 sumar export semanal off-site (S3).

### 4. Persistencia de negocio (AWS RDS)

- **Acceso:** SSH tunnel a traves de **bastion EC2** -> RDS Postgres privada.
- **Bastions:**
  - Unistore + Unidev: `3.139.209.227` (`us-east-2`)
  - Unidrop: `18.191.119.38` (`us-east-2`)
- **DBs:** `unistore_api`, `unidev`, `unidrop` — todas read-only desde UNIDATA.
- **Allowlisting:** la IP estatica de Railway (`162.220.232.99`) tiene que estar en el SG de inbound de cada bastion. Lo gestiona el data engineer del grupo (Mauro).

---

## Flujos clave

### Auth - Login normal
```
[Browser] -> POST /api/auth/login {email, password}
[Backend] -> users_db.authenticate(email, password)
              -> Postgres: SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active
              -> bcrypt.checkpw(password, password_hash)
              -> issue_token(user_id, email, role) -> JWT firmado HS256, exp 12h
[Backend] -> 200 {access_token, user}
[Browser] -> setToken + setUser en localStorage -> redirect a /dashboard/home
```

### Auth - Self-registration (Camino A)
```
[Browser] -> POST /api/auth/register {email, name}
[Backend] -> users_db.register_pending(email, name)
              -> validar dominio @unistore.ar
              -> INSERT INTO users (..., password_hash=NULL, role='lector')
              -> RETURN row
[Backend] -> 201 {user, requires_password_setup: true}
[Browser] -> step "password"
[Browser] -> POST /api/auth/set-initial-password {email, new_password}
[Backend] -> users_db.set_initial_password(email, new_password)
              -> UPDATE users SET password_hash=hash($1) WHERE email=$2 AND password_hash IS NULL
              -> issue_token(...) -> JWT
[Backend] -> 200 {access_token, user}
[Browser] -> auto-login -> redirect a /dashboard/home
```

### Query SQL libre (US-10)
```
[Browser] -> POST /api/queries/<unit>/run {sql} (con JWT)
[Backend] -> validar JWT (current_user)
[Backend] -> validar SQL: solo SELECT/WITH (regex parser)
[Backend] -> get_engine(unit) -> abre SSH tunnel si no esta abierto
[Backend] -> ejecutar SQL con statement_timeout=30s
[Backend] -> truncar a 5000 filas si pasa
[Backend] -> audit.log_query(user, unit, sql, rows, duration_ms, error)
[Backend] -> 200 {columns, rows, truncated, duration_ms}
```

---

## Variables de entorno

### Backend (Railway service `backend`)

| Var | Ejemplo | Notas |
|---|---|---|
| `JWT_SECRET` | `<256 hex chars>` | Generado con `openssl rand -hex 64` |
| `ADMIN_EMAIL` | `admin@unistore.ar` | Seed admin si tabla `users` esta vacia |
| `ADMIN_PASSWORD` | `unidata2026.` | Cambiar al primer login |
| `ADMIN_NAME` | `Admin Test` | |
| `ALLOWED_ORIGINS` | `https://frontend-production-7d1c.up.railway.app,https://data.unistore.ar` | CSV |
| `DATABASE_URL` | `postgresql://postgres.PROJ:PASS@aws-1-us-west-1.pooler.supabase.com:5432/postgres` | Supabase pooler IPv4 |
| `BASTION_HOST_<UNIT>` | `3.139.209.227` | EC2 publico |
| `BASTION_USER_<UNIT>` | `ec2-user` | |
| `BASTION_KEY_<UNIT>_BASE64` | `<base64 encoded .pem>` | El entrypoint lo decodifica |
| `PROD_DB_HOST_<UNIT>` | `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com` | |
| `PROD_DB_NAME_<UNIT>` | `unistore_api` | |
| `PROD_DB_USER_<UNIT>` | `unistore` | (read-only ideal pero hoy es prod user) |
| `PROD_DB_PASSWORD_<UNIT>` | `<password>` | |
| `LOCAL_PORT_<UNIT>` | `5433`/`5434`/`5435` | Puerto local del tunnel |

`<UNIT>` = `UNISTORE` / `UNIDROP` / `UNIDEV`. Unidev reusa el bastion + RDS host de Unistore (distinto DB name).

### Frontend (Railway service `frontend`)

| Var | Ejemplo |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://backend-production-c1ee.up.railway.app` |

---

## Seguridad

| Capa | Mecanismo |
|---|---|
| HTTPS | Railway edge automatico |
| Auth | JWT HS256 + bcrypt 12 rounds |
| CORS | Whitelist explicita en backend (`ALLOWED_ORIGINS`) |
| SQL injection (UNIDATA propio) | Parametrized queries (psycopg2 `%s`) |
| SQL injection (queries de usuario) | Parser bloquea DML/DDL antes de ejecutar |
| Statement timeout | 30s en cada engine de negocio |
| Auditoria | Cada query queda en `query_runs` con user + sql + ts |
| Network (RDS) | Privada en VPC AWS, accesible solo via bastion |
| Bastion | Allowlist por IP estatica + key SSH |
| Secretos | Env vars en Railway (cifradas at-rest), .env gitignored |

---

## Performance / capacidad

- **Free tier Supabase:** 500 MB DB, 5 GB bandwidth, conexiones limitadas a 60.
  - Para 20 users y 1 ano de uso: <50 MB esperados.
- **Railway Pro:** 2 vCPU + 1 GB RAM por replica (default), escalable a 8/8.
- **SSH tunnels:** 1 por unidad, persistentes con auto-recovery (paramiko / sshtunnel).
- **Pool psycopg2:** 1-10 conns hacia Supabase, suficiente para concurrencia esperada.

---

## Observabilidad

- **Logs Railway:** `railway logs --service <name>` (stream).
- **Audit DB:** `query_runs` muestra todas las queries SQL.
- **Health:** `GET /api/health` -> `{"status":"ok"}`.
- **Metrics Railway:** CPU, memory, network, disk en panel.

Para Sprint 2 sumar Sentry para errores backend + frontend.

---

## Disaster recovery

| Escenario | Recuperacion |
|---|---|
| Railway se cae | Cambiar a otro provider (Render, Fly.io) — Dockerfile + railway.json son portables. |
| Supabase se cae | Backup diario automatico. Restaurar en otra Postgres y apuntar `DATABASE_URL`. |
| Volumen Railway corrupto | N/A — ya migramos a Supabase. |
| AWS bastion caido | UNIDATA sigue funcional (auth + UI), solo dashboards de negocio quedan vacios. |
| Cuenta GitHub comprometida | Rotar `JWT_SECRET`, cambiar passwords Supabase + Railway, revocar tokens. |

---

## Como agregar una nueva unidad de negocio

1. Setear vars `BASTION_*_<NEW_UNIT>` y `PROD_DB_*_<NEW_UNIT>` en Railway.
2. Inyectar la SSH key como `BASTION_KEY_<NEW_UNIT>_BASE64`.
3. Agregar la unit al config en `app/config.py` (linea ~60-70).
4. Pedir a Mauro que allowlistee el bastion nuevo.
5. Redeploy backend.
