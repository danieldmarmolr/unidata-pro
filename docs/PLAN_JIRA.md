# UNIDATA — Plan de tickets Jira

Plan separado por epic / categoria, con tickets listos para que tu agente los expanda. Foco: **acciones, pruebas, deploy**. Sin sobre-detalle.

---

## EPIC 1 — Infraestructura cloud (deploy base)

### [INFRA-01] Setup workspace Railway + Pro Plan
**Estado:** ✅ HECHO
**Resumen:** Workspace creada en Railway, upgrade a Pro plan ($20/mes) para acceder a Static Outbound IPs.
**Pruebas:** N/A — verificable en `https://railway.com/account/plans`.

### [INFRA-02] Crear servicios backend + frontend en Railway (proyecto unidata-pro)
**Estado:** ✅ HECHO
**Resumen:** Dos servicios en una misma project: `backend` (FastAPI, Dockerfile) y `frontend` (Next.js 16, Dockerfile multi-stage). Monorepo con `--path-as-root`.
**Pruebas:** Ambos servicios `Online` en `railway status`.

### [INFRA-03] Static Outbound IP en backend
**Estado:** ✅ HECHO
**Resumen:** Toggle activado, redeploy hecho, IP fija asignada.
**IP asignada:** `162.220.232.99` (region us-west-2)
**Pruebas:** `GET /api/_meta/outbound-ip` devuelve la IP fija.

### [INFRA-04] Volumen persistente para datos de la app
**Estado:** ⚠️ TRANSITORIO — se elimina en EPIC 4
**Resumen:** Volumen 1GB montado en `/app/data` (hoy aloja `users.db`, `costs.db`, `audit.db` de SQLite).
**Nota:** se desmonta cuando migremos a Supabase.

### [INFRA-05] Variables de entorno backend (27 vars)
**Estado:** ✅ HECHO
**Resumen:** JWT_SECRET, ADMIN_*, ALLOWED_ORIGINS, BASTION_* y PROD_DB_* para Unistore/Unidev/Unidrop. Llaves SSH inyectadas como base64.
**Pruebas:** App arranca sin KeyError.

### [INFRA-06] Variables de entorno frontend
**Estado:** ✅ HECHO
**Resumen:** `NEXT_PUBLIC_API_URL` apuntando al backend de Railway.

---

## EPIC 2 — AWS / Networking (allowlist bastions)

### [AWS-01] Ticket a Mauro: allowlistar IP de Railway en SG de bastions
**Estado:** 🔴 PENDIENTE — accion del usuario
**Resumen:** Agregar regla inbound SSH/22 con source `162.220.232.99/32` en los 2 SG:
- Bastion Unistore: `3.139.209.227`
- Bastion Unidrop:  `18.191.119.38`
**Asignado a:** Mauro Candia (data engineer)
**Detalle completo:** `docs/TICKET_AWS_BASTION.md`
**Pruebas (las hace Daniel post-allowlist):**
- `GET /api/sources/unistore/schemas` con JWT devuelve lista (no timeout)
- Idem `/api/sources/unidrop/schemas`

### [AWS-02] (Opcional, futuro) Crear users PostgreSQL read-only en cada DB
**Estado:** 🟡 BACKLOG
**Resumen:** Hoy UNIDATA usa los users de produccion (`unistore`, `unidrop`). Pedir a Mauro crear users dedicados con permisos `SELECT-only` para reducir riesgo.
**Pruebas:** intento `INSERT` desde UNIDATA debe fallar con permission denied.

---

## EPIC 3 — Persistencia propia de UNIDATA (migrar SQLite -> Supabase Postgres)

### [DB-01] Crear proyecto Supabase
**Estado:** 🔴 PENDIENTE — accion del usuario
**Resumen:** Cuenta Supabase free tier, region West US (proximidad con Railway us-west-2).
**Output:** `DATABASE_URL` de Postgres (puerto 6543, pooler) entregada al equipo backend.

### [DB-02] Refactor `users_db.py` de SQLite a Postgres
**Estado:** 🔴 PENDIENTE
**Cambios principales:**
- `sqlite3` -> `psycopg2`
- Parametros `?` -> `%s`
- `INTEGER PRIMARY KEY AUTOINCREMENT` -> `BIGSERIAL PRIMARY KEY`
- `COLLATE NOCASE` -> indice `LOWER(email)` o `CITEXT`
- Migracion inicial idempotente al boot
**Pruebas:**
- Login con `daniel.marmol@unistor.ar` despues del redeploy
- Crear usuario nuevo desde Admin -> persiste tras redeploy
- Constraint UNIQUE en email funciona (intentar duplicado falla)

### [DB-03] Refactor `costs_db.py` de SQLite a Postgres
**Estado:** 🔴 PENDIENTE
**Cambios:** mismo patron que DB-02.
**Pruebas:** crear/editar/borrar costo desde UI, persiste tras redeploy.

### [DB-04] Refactor `audit.py` (servicio audit log) de SQLite a Postgres
**Estado:** 🔴 PENDIENTE
**Cambios:** mismo patron.
**Pruebas:** correr una query desde la UI, verificar entry en tabla `audit_log` con timestamp + user + sql.

### [DB-05] Setear `DATABASE_URL` en Railway + redeploy
**Estado:** 🔴 PENDIENTE
**Pruebas:** logs muestran `engine connected to postgres` (no a sqlite). Endpoints leen/escriben en Supabase.

### [DB-06] Limpieza: remover volumen Railway + symlinks SQLite en entrypoint
**Estado:** 🔴 PENDIENTE
**Cambios:** quitar `ln -sf` del `entrypoint.sh`, eliminar volumen del servicio backend en Railway.
**Pruebas:** redeploy sin volumen, app arranca normal.

---

## EPIC 4 — Hardening produccion (post go-live)

### [SEC-01] Backups automaticos diarios de Supabase
**Estado:** 🟡 BACKLOG
**Resumen:** Supabase free tier hace backups diarios automaticos por defecto, validar que esten activos. Pro tier extiende retencion.
**Pruebas:** validar en panel Supabase que hay snapshot reciente.

### [SEC-02] Rate limiting en `/api/auth/login`
**Estado:** 🟡 BACKLOG
**Resumen:** 5 intentos / 5 min por IP en login. Libreria: `slowapi`.
**Pruebas:** 6 intentos seguidos → 429 Too Many Requests.

### [SEC-03] 2FA para roles `admin`
**Estado:** 🟡 BACKLOG
**Resumen:** TOTP con `pyotp`, QR para enrolarse.
**Pruebas:** admin no puede loguearse sin segundo factor.

### [SEC-04] Rotar `JWT_SECRET` y passwords expuestas en chat
**Estado:** 🟡 BACKLOG (recordatorio)
**Resumen:** Las credenciales productivas (`unistore` / `UyMLpZzxwfuS`, etc.) fueron compartidas en chat. Rotarlas con Mauro.

### [SEC-05] HTTPS forzado + headers de seguridad
**Estado:** ✅ Auto (Railway provee HTTPS por default). Validar headers HSTS / CSP.

---

## EPIC 5 — Smoke tests + Go-live

### [TEST-01] Smoke test: backend health + login
**Estado:** ✅ HECHO
**Pruebas verificadas:**
- `/api/health` -> `{"status": "ok"}`
- Login devuelve JWT valido

### [TEST-02] Smoke test: endpoints que tocan BBDD via SSH (post-AWS allowlist)
**Estado:** 🔴 BLOQUEADO por AWS-01
**Pruebas:**
- `/api/sources/unistore/schemas` con JWT -> lista real
- `/api/sources/unidrop/schemas` con JWT -> lista real
- Dashboard "HOY" del frontend muestra valores no-cero
- Mapa Argentina renderiza con 24 provincias y datos

### [TEST-03] Smoke test: persistencia post-Supabase
**Estado:** 🔴 BLOQUEADO por DB-05
**Pruebas:**
- Crear usuario nuevo desde Admin
- Redeploy del backend
- Usuario sigue existiendo y puede loguearse
- Audit log muestra registros viejos

### [TEST-04] Remover endpoint diagnostico `/api/_meta/outbound-ip`
**Estado:** 🔴 PENDIENTE — al final
**Resumen:** se agrego solo para descubrir la IP. Sacar antes del lanzamiento.

### [TEST-05] Go-live: anuncio interno + onboarding primeros usuarios
**Estado:** 🔴 PENDIENTE
**Pruebas:** 2-3 usuarios reales (gerencia / analistas) acceden a paneles segmentados por rol.

---

## EPIC 6 — Documentacion

### [DOC-01] Guia de deploy actualizada
**Estado:** ✅ HECHO -> `docs/DEPLOY.md`

### [DOC-02] Guia para equipo Unifull (proyecto paralelo en Railway)
**Estado:** ✅ HECHO -> `docs/GUIA_UNIFULL_AWS_RAILWAY.md`

### [DOC-03] Ticket AWS bastion para Mauro
**Estado:** ✅ HECHO -> `docs/TICKET_AWS_BASTION.md`

### [DOC-04] README operativo
**Estado:** 🟡 PENDIENTE — refrescar para que indique los pasos post go-live (rotacion creds, agregar usuarios, ver logs).

---

## Resumen ejecutivo del estado actual

```
INFRA       ████████████████████  100% (6/6)
AWS         ░░░░░░░░░░░░░░░░░░░░    0% (0/2)  <- bloqueante
DB / Persistencia ░░░░░░░░░░░░░░░░░░░░    0% (0/6)  <- en curso
Hardening   ░░░░░░░░░░░░░░░░░░░░    0% (0/5)  <- post go-live
Tests       ████░░░░░░░░░░░░░░░░   20% (1/5)
Docs        ███████████████░░░░░   75% (3/4)

Total: ~30% — bloqueado por AWS-01 y DB-01
```

## Ruta critica para go-live

1. **DB-01** (vos) — crear Supabase
2. **DB-02..05** (yo) — refactor SQLite -> Postgres + deploy
3. **AWS-01** (Mauro, en paralelo desde ahora) — allowlist
4. **TEST-02 + TEST-03** (yo) — smoke tests
5. **TEST-04** (yo) — limpiar endpoint diagnostico
6. **TEST-05** (vos) — onboarding inicial

Tiempo estimado a go-live: **24-48 hs** (depende de Mauro y Supabase).
