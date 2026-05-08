# UNIDATA — Plan Jira

> **Estructura:** un solo Epic (UNIDATA) que contiene User Stories (lo que la herramienta permite a los usuarios) y Tasks tecnicas (implementacion). Los User Stories son la vista de producto; los Tasks son la vista de ingenieria. Cada US se cumple con uno o mas Tasks.

---

# 🎯 EPIC — UNIDATA: Plataforma de Analitica Interna del Grupo Unistore

**Objetivo:** habilitar a colaboradores de Unistore / Unidev / Unidrop a consultar datos productivos de forma autoservicio, segura y auditable, sin necesidad de pedir reportes al equipo de datos.

**Owner:** Daniel Marmol
**Stakeholders:** Gerencia, Analistas, Equipo IT (Mauro Candia)
**Stack:** FastAPI (Python) + Next.js 16 + PostgreSQL (Supabase) + Railway + AWS RDS (read-only)

---

## 📚 USER STORIES — Lo que UNIDATA permite

### US-01 — Login a la plataforma
> **Como** colaborador de Unistore
> **Quiero** loguearme con mi mail corporativo y password
> **Para** acceder a los dashboards segun mi rol

**Criterios de aceptacion:**
- Login con email + password contra `users` en Supabase
- JWT emitido valido por 12 hs
- Roles: `admin`, `gerencia`, `analista`, `lector`, `user`
- Lockout suave despues de 5 intentos fallidos (Sprint 2)

**Tasks asociadas:** AUTH-01, AUTH-02, INFRA-05

---

### US-02 — Registrarme con mi mail @unistore.ar
> **Como** colaborador nuevo
> **Quiero** registrarme yo solo en UNIDATA con mi mail corporativo
> **Para** no tener que esperar que el admin me cree la cuenta

**Criterios de aceptacion:**
- Form `/register` valida que email termine en `@unistore.ar`
- Crea cuenta con rol default `lector` (admin puede promover despues)
- Primer login obliga a setear password
- Si el email ya existe -> mensaje claro de "usa /login"

**Tasks asociadas:** AUTH-03, AUTH-04, AUTH-05, AUTH-06

**Migracion futura:** integracion con Microsoft 365 SSO (Sprint 3+).

---

### US-03 — Ver KPIs de "Hoy" en las 3 unidades de negocio
> **Como** analista o gerente
> **Quiero** ver los KPIs del dia (ventas, ordenes, clientes activos) de Unistore, Unidev y Unidrop
> **Para** saber el pulso del negocio en tiempo real

**Criterios de aceptacion:**
- Dashboard "HOY" con tiles segmentadas por unidad
- Datos en vivo desde RDS (via SSH tunnel + bastions)
- Refresh manual + auto cada 60s
- Comparacion vs ayer / vs mismo dia semana anterior

**Tasks asociadas:** AWS-01, INFRA-05, INFRA-06, DB-* (acceso a engines.py)

---

### US-04 — Filtrar metricas por rango de fechas
> **Como** analista
> **Quiero** elegir periodos custom (hoy / ultimos 7d / mes / custom)
> **Para** comparar evolucion temporal

**Criterios de aceptacion:**
- Selector de rango global que afecta todos los dashboards
- TZ siempre AR (UTC-3)
- Persistencia del filtro en sessionStorage

**Tasks asociadas:** ya implementado en frontend (verificar)

---

### US-05 — Hacer drilldown sobre una metrica
> **Como** analista
> **Quiero** clickear sobre cualquier numero del dashboard
> **Para** ver el detalle de las filas que lo componen

**Criterios de aceptacion:**
- Drilldowns disponibles: ordenes, productos, clientes, provincias, payment accounts
- Cada drilldown abre un modal con tabla paginada
- Click en order_id linkea a `unistore8.mitiendanube.com/admin/orders/...`

**Tasks asociadas:** endpoints `/api/drilldowns/*` ya implementados

---

### US-06 — Resumen ejecutivo de ventas
> **Como** gerente
> **Quiero** un dashboard "Ventas" con totales / margenes / rentabilidad
> **Para** tomar decisiones sin pedir reportes ad-hoc

**Criterios de aceptacion:**
- Dashboard `Ventas` accesible para roles `admin`, `gerencia`, `analista`
- Lectores no tienen acceso (segmentacion por rol)
- Mapa Argentina con 24 provincias coloreadas por volumen

**Tasks asociadas:** ya implementado, falta validar post-allowlist

---

### US-07 — Exportar resultados a CSV o PDF
> **Como** cualquier usuario
> **Quiero** descargar la tabla actual a CSV / Excel / PDF
> **Para** compartir con stakeholders externos

**Criterios de aceptacion:**
- Boton "Exportar" en cada tabla
- CSV abre bien en Excel con encoding correcto
- PDF respeta branding de Unistore

**Tasks asociadas:** ya implementado para CSV; PDF parcial

---

### US-08 — Gestionar usuarios y roles (admin)
> **Como** admin
> **Quiero** crear, editar, desactivar usuarios y asignar roles
> **Para** controlar quien accede a que

**Criterios de aceptacion:**
- Pagina `/admin/usuarios` accesible solo a admins
- CRUD completo de users
- Reset de password (manda al user al flujo de set-initial)
- Ver estado: activo / pendiente de password / desactivado

**Tasks asociadas:** ya implementado (CRUD basico) + AUTH-06 (estado pendiente)

---

### US-09 — Ver analytics de uso de UNIDATA
> **Como** admin
> **Quiero** ver como los colaboradores usan UNIDATA
> **Para** entender adopcion, descubrir features no usadas, planear mejoras

**Criterios de aceptacion:**
- Pagina `/admin/analytics` accesible solo a admins
- Top users / top dashboards / funnel login->drilldown->export
- Lista de descargas con user, fecha, archivo
- Filtro de rango: 7d / 30d / 90d

**Tasks asociadas:** ANL-01..07 (Sprint 2)

---

### US-10 — Correr SQL ad-hoc (read-only)
> **Como** analista
> **Quiero** un editor SQL libre con limite de tiempo y solo `SELECT`
> **Para** responder preguntas que no estan en los dashboards

**Criterios de aceptacion:**
- Pagina `/queries` con editor + tabla de resultados
- Solo permite `SELECT` y `WITH` (DML/DDL bloqueados a nivel parser)
- Statement timeout 30s
- Cada query queda en audit log con user + sql + duracion

**Tasks asociadas:** ya implementado (`/api/queries/*`)

---

### US-11 — Saber que mis acciones quedan auditadas
> **Como** colaborador con permisos sensibles
> **Quiero** que cada query y descarga quede registrada
> **Para** auditoria y compliance interna

**Criterios de aceptacion:**
- Tabla `query_runs` en Supabase con user, sql, ts, rows, duration_ms
- Admin ve audit log via `/admin/auditoria`
- Retencion: 1 ano (cron mensual borra mas viejos)

**Tasks asociadas:** ya implementado para queries; ANL-04 agrega downloads

---

## 🛠 TASKS TECNICAS

> Agrupadas por area. Cada task asociada a una o mas US arriba.

### A. Infraestructura cloud (deploy base)

| ID | Estado | Descripcion |
|---|---|---|
| INFRA-01 | ✅ DONE | Workspace Railway + upgrade a Pro plan |
| INFRA-02 | ✅ DONE | Crear servicios `backend` (FastAPI) y `frontend` (Next.js) |
| INFRA-03 | ✅ DONE | Static Outbound IP en backend (`162.220.232.99`, us-west-2) |
| INFRA-04 | 🟡 TRANSITORIO | Volumen `/app/data` (legacy SQLite, removable post-migracion) |
| INFRA-05 | ✅ DONE | 27 env vars del backend (JWT, ADMIN_*, BASTION_*, PROD_DB_*) |
| INFRA-06 | ✅ DONE | `NEXT_PUBLIC_API_URL` del frontend apuntando al backend |
| INFRA-07 | ✅ DONE | Dockerfile multistage + `railway.json` con healthcheck 300s |

### B. AWS Networking

| ID | Estado | Descripcion |
|---|---|---|
| AWS-01 | 🔴 EN MAURO | Allowlistar `162.220.232.99/32` en SG bastions Unistore + Unidrop. Ticket en `docs/TICKET_AWS_BASTION.md` |
| AWS-02 | 🟡 BACKLOG | Crear users PostgreSQL **read-only** dedicados para UNIDATA (hoy se usan los users de prod) |
| AWS-03 | 🟡 BACKLOG | (Opcional) Coordinar habilitacion conjunta para Unifull (`docs/GUIA_UNIFULL_AWS_RAILWAY.md`) |

### C. Persistencia propia (Supabase Postgres)

| ID | Estado | Descripcion |
|---|---|---|
| DB-01 | ✅ DONE | Crear proyecto Supabase `unidata-pro` (free tier, us-west-1) |
| DB-02 | ✅ DONE | Refactor `users_db.py` SQLite -> Postgres |
| DB-03 | ✅ DONE | Refactor `costs_db.py` SQLite -> Postgres |
| DB-04 | ✅ DONE | Refactor `audit.py` SQLite -> Postgres |
| DB-05 | 🟠 EN PROGRESO | Setear `DATABASE_URL` en Railway + redeploy (URL pooler IPv4) |
| DB-06 | 🔴 PENDIENTE | Cleanup volumen Railway + symlinks SQLite del entrypoint |

### D. Autenticacion (MVP V1)

| ID | Estado | Descripcion | US |
|---|---|---|---|
| AUTH-01 | ✅ DONE | Login con email/password + JWT 12h | US-01 |
| AUTH-02 | ✅ DONE | Seed admin desde `ADMIN_EMAIL`/`ADMIN_PASSWORD` | US-01 |
| AUTH-03 | 🔴 MVP V1 | Endpoint `POST /api/auth/register` con dominio `@unistore.ar` | US-02 |
| AUTH-04 | 🔴 MVP V1 | Endpoint `POST /api/auth/set-initial-password` | US-02 |
| AUTH-05 | 🔴 MVP V1 | Frontend `/register` + flujo primer-login | US-02 |
| AUTH-06 | 🟡 BACKLOG | Admin > Usuarios: badge "Pendiente de password" + boton reset | US-08 |

### E. Analytics interna (Sprint 2)

| ID | Estado | Descripcion | US |
|---|---|---|---|
| ANL-01 | 🟡 BACKLOG | Tablas `usage_events` y `user_sessions` en Supabase | US-09 |
| ANL-02 | 🟡 BACKLOG | Endpoint `POST /api/track` autenticado | US-09 |
| ANL-03 | 🟡 BACKLOG | Hook `useTracker()` en frontend con `session_id` | US-09 |
| ANL-04 | 🟡 BACKLOG | Instrumentar 9 eventos clave (page_view, query_run, export_csv, etc) | US-09, US-11 |
| ANL-05 | 🟡 BACKLOG | Endpoints agregados `/api/admin/analytics/*` | US-09 |
| ANL-06 | 🟡 BACKLOG | Frontend `/admin/analytics` con charts | US-09 |
| ANL-07 | 🟡 BACKLOG | Cron rotacion eventos > 1 ano | US-11 |

### F. Hardening produccion

| ID | Estado | Descripcion |
|---|---|---|
| SEC-01 | 🟡 BACKLOG | Validar backups automaticos diarios de Supabase |
| SEC-02 | 🟡 BACKLOG | Rate limiting en `/api/auth/login` (5/5min) con `slowapi` |
| SEC-03 | 🟡 BACKLOG | 2FA TOTP para roles `admin` |
| SEC-04 | 🟡 BACKLOG | Rotar `JWT_SECRET` y passwords expuestas en chat |
| SEC-05 | 🟡 BACKLOG | Headers de seguridad (HSTS, CSP) |

### G. Smoke tests / Go-live

| ID | Estado | Descripcion |
|---|---|---|
| TEST-01 | ✅ DONE | `/api/health` + login |
| TEST-02 | 🔴 BLOQUEADO POR AWS-01 | Endpoints que tocan BBDD via SSH (sources/dashboards) |
| TEST-03 | 🟠 EN PROGRESO | Persistencia post-Postgres: registrar user, redeploy, sigue existiendo |
| TEST-04 | 🔴 PENDIENTE | Remover endpoint diagnostico `/api/_meta/outbound-ip` |
| TEST-05 | 🔴 MVP V1 | Test de registracion + set-initial-password end-to-end |
| TEST-06 | 🔴 PENDIENTE | Anuncio interno + onboarding 2-3 usuarios reales |

### H. Documentacion

| ID | Estado | Descripcion |
|---|---|---|
| DOC-01 | ✅ DONE | Guia deploy `docs/DEPLOY.md` |
| DOC-02 | ✅ DONE | Guia para Unifull `docs/GUIA_UNIFULL_AWS_RAILWAY.md` |
| DOC-03 | ✅ DONE | Ticket AWS para Mauro `docs/TICKET_AWS_BASTION.md` |
| DOC-04 | 🟡 BACKLOG | README operativo para usuarios (como pedir acceso, como reportar bugs) |

---

## 🚀 RUTA CRITICA AL MVP V1 (proximos 60 min)

```
[ahora]
  ↓
DB-05 (Postgres URL pooler) -> ETA 5 min
  ↓
AUTH-03 + AUTH-04 (endpoints register/set-password) -> 25 min
  ↓
AUTH-05 (frontend /register) -> 20 min
  ↓
TEST-04 (cleanup endpoint diagnostico) -> 5 min
  ↓
TEST-05 (smoke test E2E) -> 5 min
  ↓
🎉 MVP V1 LIVE — colaboradores pueden registrarse y explorar UNIDATA

[paralelo, sin bloquear]
AWS-01 -> Mauro (cuando responda, los datos de negocio empiezan a fluir)
```

## Resumen ejecutivo del estado actual

```
A. Infra Cloud      ████████████████████  100%  ✅ (7/7)
B. AWS Networking   ░░░░░░░░░░░░░░░░░░░░    0%  ⏳ Mauro (1/3 in progress)
C. Persistencia DB  ████████████████░░░░   83%  🟠 (5/6)
D. Auth (MVP V1)    ███████░░░░░░░░░░░░░   33%  🔴 (2/6) -- foco hora siguiente
E. Analytics        ░░░░░░░░░░░░░░░░░░░░    0%  🟡 Sprint 2 (0/7)
F. Hardening        ░░░░░░░░░░░░░░░░░░░░    0%  🟡 backlog (0/5)
G. Tests / Go-live  ████░░░░░░░░░░░░░░░░   17%  🟠 (1/6)
H. Documentacion    ███████████████░░░░░   75%  🟢 (3/4)
```

## Sprint 2 (post MVP V1, proxima semana)

- **Auth completo:** AUTH-06 (admin reset password)
- **Analytics interna:** ANL-01..07 (tracking + admin panel)
- **Hardening:** SEC-02 (rate limit), SEC-03 (2FA), SEC-01 (backups)
- **Mejoras de producto:** segun feedback de los primeros 5 usuarios

## Sprint 3+ (mes 2)

- **M365 SSO** (reemplaza/coexiste con self-registration)
- **Read-only DB users** (AWS-02)
- **PostHog** integration para session replay (opcional)
- **PDF export** branded
