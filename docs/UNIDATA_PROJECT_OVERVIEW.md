# UNIDATA PRO — Inventario técnico del proyecto

**Para:** Mauro (responsable migración AWS)
**Última actualización:** 2026-05-22
**Propósito:** Documento de referencia exhaustivo de QUÉ ES UNIDATA hoy. Leer junto con [AWS_MIGRATION_SPEC.md](AWS_MIGRATION_SPEC.md) (que define cómo y a dónde migrar).

---

## 0. TL;DR ejecutivo

UNIDATA es una plataforma BI interna del grupo Unistore que **consume** datos operativos de 3 unidades de negocio (Unistore retail, Unidrop dropshipping, Unidev) y los presenta en dashboards + workflows operativos (Customer Success queue, alertas IT, notas por dropshipper, recordatorios, sincronización Meta Ads, generación de pedidos a WMS DigiP, etc).

| | |
|---|---|
| **Hoy corre en** | Railway (3 services) + Supabase (datos propios) |
| **Lee datos de** | 3 RDS PostgreSQL en AWS via SSH tunnel a 2 bastiones EC2 |
| **Tamaño** | ~69k LOC · ~6.000 archivos · ~250 endpoints REST · ~104 páginas Next.js · 31 MCP tools |
| **Integraciones externas** | Mercado Libre, Tienda Nube, DigiP WMS, Contabilium, Meta Ads, Jira, Confluence, Teams, Gemini, Talo, Unidrop API |
| **Tiempo en producción** | ~7 meses · ~30 usuarios activos |
| **URL prod** | https://app.unidatacenter.com.ar |

**Lo que hay que migrar a AWS:**
1. Backend FastAPI (Railway → ECS Fargate)
2. Frontend Next.js 16 (Railway → Amplify Hosting)
3. MCP server FastMCP (Railway → ECS Fargate, requiere SSE timeouts altos)
4. **Datos**: Supabase PostgreSQL → RDS PostgreSQL nuevo en AWS
5. ~40 env vars (DBs, JWT, OAuth tokens, API keys de 8 integraciones)
6. SSH keys de bastiones (hoy inyectadas base64) → SSM Parameter Store / Secrets Manager

**Lo que NO se migra (queda donde está):**
- Los 3 RDS productivos de las unidades de negocio (Unistore, Unidrop, Unidev) — UNIDATA solo los lee como BI
- Los 2 bastiones EC2 — UNIDATA seguirá usando SSH tunnel o (preferible) conexión VPC directa si quedan en la misma cuenta AWS
- Cloudflare DNS — opcional moverlo, pero no requerido

---

## 1. Arquitectura actual

```
┌──────────────────────────────────────────────────────────────────────┐
│                          USUARIOS (~30)                               │
│              Browser · Claude Desktop / Claude Code (MCP)             │
└──────────────────────┬───────────────────────────────┬───────────────┘
                       │                               │
                       ▼                               ▼
        ┌─────────────────────────┐    ┌──────────────────────────────┐
        │  FRONTEND (Railway)     │    │  MCP SERVER (Railway)        │
        │  Next.js 16 · React 19  │    │  FastMCP · HTTP/SSE          │
        │  app.unidatacenter.ar   │    │  mcp-production-b8c5...      │
        └────────────┬────────────┘    └──────────────┬───────────────┘
                     │                                │
                     │   HTTPS · JWT Bearer           │
                     └──────────────┬─────────────────┘
                                    ▼
                  ┌──────────────────────────────────────┐
                  │  BACKEND (Railway)                   │
                  │  FastAPI · Python 3.12 · uvicorn     │
                  │  api.unidatacenter.com.ar            │
                  │  ~250 endpoints · 25 routers         │
                  └────┬────────────┬────────────────┬───┘
                       │            │                │
                       │            │                │
                       ▼            ▼                ▼
        ┌─────────────────┐   ┌───────────┐   ┌───────────────────────┐
        │  SUPABASE       │   │ APIs EXT  │   │  AWS RDS PROD (×3)    │
        │  PostgreSQL     │   │  · MELI   │   │  via SSH tunnel a     │
        │  (datos UNIDATA)│   │  · TN     │   │  bastiones EC2:       │
        │                 │   │  · DigiP  │   │  · 3.139.209.227      │
        │  · users        │   │  · CB     │   │  · 18.191.119.38      │
        │  · cs_actions   │   │  · Meta   │   │                       │
        │  · it_alerts    │   │  · Jira   │   │  Schemas:             │
        │  · notes        │   │  · Teams  │   │  · unistore_api       │
        │  · reminders    │   │  · Gemini │   │  · unidrop_api        │
        │  · meta_ads_*   │   │  · Talo   │   │  · unidev             │
        │                 │   │  · Unidrop│   │                       │
        └─────────────────┘   └───────────┘   └───────────────────────┘
                                                          ▲
                              ┌───────────────────────────┘
                              │ MIGRA A AWS:
                              │ Supabase → RDS PostgreSQL nuevo
                              │ Mantener acceso a RDS prod
```

### Dominios y URLs actuales

| Componente | URL | Apunta a |
|---|---|---|
| Frontend | `app.unidatacenter.com.ar` | Cloudflare → Railway frontend service |
| Backend | `api.unidatacenter.com.ar` | Cloudflare → Railway backend service |
| MCP | `unidata-mcp.unidatacenter.com.ar` + `mcp-production-b8c5.up.railway.app` | Cloudflare → Railway mcp service |

---

## 2. Backend (FastAPI)

### 2.1 Stack

| Componente | Versión | Notas |
|---|---|---|
| FastAPI | 0.115+ | Uvicorn 0.32+ |
| Python | 3.12 | Dockerfile: `python:3.12-slim` |
| ORM | SQLAlchemy 2.0+ | psycopg2-binary 2.9+ |
| SSH Tunnel | sshtunnel 0.4+ | paramiko 3.4-3.99 (key management) |
| Auth | PyJWT 2.9+ | HS256, bcrypt rounds=12, pyotp 2.9+ |
| Scheduling | APScheduler 3.10 | BackgroundScheduler in-process |
| HTTP Client | httpx 0.27+, requests | async + sync mixto |
| Rate Limiting | slowapi 0.1.9+ | Solo en /auth/login y /auth/register |
| Cache | cachetools 5.5+ | TTLCache in-memory, 180s |
| Data tools | pandas 2.2+, openpyxl 3.1+, reportlab 4.2+ | Excel/CSV/PDF generation |
| Crypto | cryptography 42.0+ | Fernet AES-128 para TOTP secrets |
| LLM | google-genai 1.0.0+ | Gemini 2.5 Flash (Jira Flow) |

### 2.2 Estructura

```
backend/
├── app/
│   ├── main.py                # FastAPI app, 25 routers, cache middleware, security headers, CORS
│   ├── config.py              # Settings (env vars, units config)
│   ├── auth/
│   │   ├── security.py        # JWT, current_user, require_area, MCP token (90d)
│   │   └── totp_cipher.py     # Fernet para secrets TOTP en DB (legacy plaintext support)
│   ├── api/                   # 25 routers
│   │   ├── auth.py            # login, register, 2FA, mcp-token
│   │   ├── admin.py           # CRUD usuarios + áreas
│   │   ├── dashboards/        # routers.py (~40 endpoints), executive.py, gerencia.py, sales.py
│   │   ├── cs_actions.py · cs_templates.py · cs_cron.py
│   │   ├── exports.py         # Excel/CSV downloads
│   │   ├── meta_ads.py        # Meta Ads sync + queries
│   │   ├── jira_flow.py       # Jira + Confluence + Teams + Gemini
│   │   ├── logistica.py       # Estado fulfillment
│   │   ├── flujo_fondos.py    # Cash flow reporting
│   │   ├── people.py · people_hr.py · personal.py · aprende.py
│   │   ├── refund_requests.py # Devoluciones workflow
│   │   ├── reminders.py · dropshipper_notes.py · notifications.py
│   │   └── ... (más)
│   ├── db/                    # 25+ módulos, uno por dominio
│   │   ├── engines.py         # SSH tunnels + 3 SQLAlchemy engines (CRÍTICO)
│   │   ├── local_persistence.py  # psycopg2 ThreadedConnectionPool a Supabase
│   │   ├── users_db.py · areas_db.py · costs_db.py · audit_db.py
│   │   ├── cs_actions_db.py · mcp_tokens_db.py · meta_sync_runs_db.py
│   │   └── ... (más)
│   ├── services/              # 50+ módulos, business logic (~27k LOC)
│   │   ├── _utils.py          # q() wrapper con retry + error swallowing
│   │   ├── meta_ads.py · dropshippers.py (~3900L) · products.py (~2000L)
│   │   ├── drilldowns.py · sku_omnichannel.py · sku_360_extras.py
│   │   ├── logistica/carga_digip.py  # TN+MELI → DigiPWMS loader (1100L)
│   │   ├── jira_flow/ · refund_requests/ · meta_ads/
│   │   └── ... (más)
│   ├── jobs/
│   │   └── scheduler.py       # APScheduler: auto-cumpleaños 09:00 ART
│   └── scripts/
│       └── run_perf_indexes.py  # DB maintenance (manual)
├── Dockerfile                 # Single-stage python:3.12-slim + openssh-client + libpq5
├── entrypoint.sh              # Materializa SSH keys desde env vars base64 a /app/keys/
├── requirements.txt           # 26 deps principales
└── .env.example               # Template (40+ vars)
```

### 2.3 Routers principales

| Router | Endpoints aprox. | Notas |
|---|---|---|
| `dashboards/routers.py` | ~40 | **MASIVO** — endpoints dashboard + label PDF downloads |
| `exports` | 8-10 | Excel/CSV exports |
| `auth` | 5-6 | login + register + 2FA + mcp-token |
| `admin` | 5-8 | CRUD users + áreas |
| `cs_actions` | 6-8 | Queue management |
| `meta_ads` | 6-8 | Sync + queries Meta |
| `jira_flow` | 5-6 | Issue creation + flow |
| `refund_requests` | 4-6 | Devoluciones |
| `people` + `people_hr` + `personal` | 15+ | HR module |
| (otros 15 routers) | variable | Dominios específicos |

**Endpoints sensibles a recursos:**
- `GET /api/dashboards/orders/{ml|tn}/{id}/label` → streaming PDF binario (potencial memory spike)
- `GET /api/exports/*` → pandas DataFrame en memoria, hasta 5000 rows
- `POST /api/marketing/meta/sync` → puede correr 5-30 minutos paginando ~10k items (long-running)

---

## 3. Frontend (Next.js)

### 3.1 Stack

| Componente | Versión | Notas |
|---|---|---|
| Next.js | 16.2.4 | **App Router** (no Pages Router) |
| React | 19.2.4 | |
| TypeScript | 5.x | strict mode |
| Tailwind CSS | 4.x | @tailwindcss/postcss |
| TanStack Query | 5.100.9 | Data fetching + cache |
| Zustand | 5.0.13 | Estado global (period filters) + localStorage persistence |
| Recharts | 3.8.1 | Charts (Area, Bar, Pie, Line) |
| Lucide React | 1.14.0 | 64 iconos en uso |
| React Simple Maps + d3-geo + topojson | 3.x | Mapa Argentina + drill por provincia |
| @xyflow/react + @dagrejs/dagre | 12.x, 3.x | Diagramas (jira-flow, ER) |
| Monaco Editor | 4.7.0 | Editor SQL embedded |

### 3.2 Estructura

```
frontend/
├── app/                       # App Router · 104 page.tsx · 20+ layout.tsx
│   ├── dashboard/             # 97 páginas (todas las features)
│   │   ├── home · gerencia · ventas · cs · finanzas (×18) · productos (×2)
│   │   ├── dropshipper/[id]/page.tsx  # 1887 LÍNEAS · vista 360 (página más pesada)
│   │   ├── productos/[sku]/page.tsx   # 556L · SKU detail omnichannel
│   │   ├── finanzas/flujo-fondos/     # ~2000L total entre subrutas
│   │   ├── people/ (×23)              # HR module: legajo, kudos, 1-on-1, encuestas, etc
│   │   ├── logistica/ · marketing/ · mapa · exports · catalog · audit
│   │   ├── jira-flow/ (×7) · admin/users/ · account
│   │   └── ... (más)
│   ├── login · register · dev-suscripcion
│   └── layout.tsx (root)
├── components/                # 64 .tsx · ~16.9k líneas
│   ├── sidebar.tsx            # RBAC: filter por role + area_slug
│   ├── generic-table.tsx · kpi-card.tsx · order-status-pipeline.tsx
│   ├── people/ · personal/ · sku-*/ · cs-*/
│   └── ... (charts, modals, exports)
├── lib/                       # 10 .ts · ~850 líneas
│   ├── api.ts                 # Fetch wrapper + Bearer auth + 401 redirect
│   ├── store.ts               # Zustand (period filters)
│   ├── types.ts · utils.ts · dates.ts · export.ts
│   └── use-sku-enrichment.ts · use-unit-from-query.ts
├── Dockerfile                 # Multi-stage: deps → builder → runner (node:20-alpine)
├── next.config.ts             # Minimal (sin redirects activos)
├── railway.toml               # builder = DOCKERFILE, healthcheck /
└── .env.example               # NEXT_PUBLIC_API_URL
```

### 3.3 Auth + RBAC en frontend

- **JWT en localStorage** (`unidata.token`) + user data (`unidata.user`)
- Login: `POST /api/auth/login` con email + password + (opcional) `totp_code`
- 2FA: si `Requires2FAError`, re-prompt para código TOTP
- 401 handling: `api()` intercepta, limpia localStorage, redirige a `/login`
- Sidebar lee role + area_slug del user para decidir qué nav items mostrar
- Admin/gerencia/is_admin=true bypass todas las restricciones de área

### 3.4 Aspectos críticos

- **Polling activo en 2 páginas**:
  - `logistica/carga-digip`: setInterval cada N segundos hasta status="done"
  - `marketing/meta`: refresh visual cada 1 segundo (clock-based)
- **Timezone hardcoded** `America/Argentina/Buenos_Aires` en 10+ componentes
- **Downloads PDF/Excel/CSV**: PDF servido por backend, Excel/CSV generados client-side
- **No virtual scrolling** en tablas → potencial problema con 10k+ rows
- **No image optimization** activa (next.config.ts mínimo)

---

## 4. MCP Server (FastMCP)

### 4.1 Stack y estructura

| Componente | Versión |
|---|---|
| FastMCP | 1.2+ (mcp[cli]) |
| Python | 3.12-slim |
| Starlette | 0.37+ (ASGI para HTTP/SSE) |
| Uvicorn | 0.30+ |
| httpx | 0.27+ |

```
mcp/
├── unidata_mcp/
│   ├── server.py              # FastMCP instance + 31 tools registradas
│   ├── http_server.py         # Starlette app + AuthMiddleware (extrae JWT del header)
│   ├── client.py              # httpx AsyncClient wrapper
│   ├── config.py              # env vars: UNIDATA_API_URL, UNIDATA_TOKEN, UNIDATA_TIMEOUT_S
│   └── __main__.py            # stdio entry point
├── Dockerfile                 # python:3.12-slim, pip install -e ., CMD unidata-mcp-http
├── pyproject.toml             # entrypoints unidata-mcp (stdio) + unidata-mcp-http (HTTP)
└── railway.toml               # DOCKERFILE, /health, port 8765
```

### 4.2 Tools (31 total)

**Read (11):** `whoami`, `list_dropshippers`, `get_dropshipper`, `get_dropshipper_unified_orders`, `get_executive_dashboard`, `get_unit_dashboard`, `list_orders`, `run_sql`, `list_tables`, `preview_table`, `describe_table`

**Write (20):**
- CS actions (6): `list/take/complete/cancel/create/update_cs_action`
- Alertas (3): `list/resolve/unresolve_alert`
- Dropshipper notes (3): `add/list/archive_dropshipper_note`
- Reminders (3): `list_my_reminders`, `create_reminder`, `complete_reminder`
- Meta Ads (5): `get_meta_spend`, `list_meta_campaigns`, `get_meta_ad_performance`, `get_meta_unidrop_impact`, `trigger_meta_sync`

### 4.3 Transport y arquitectura crítica

**Dual mode:**
- **stdio** (Claude Desktop / Claude Code local): singleton UnidataClient con token de env
- **HTTP/SSE** (Railway remoto): per-request JWT isolation via `contextvars.ContextVar`

**HTTP/SSE flow:**
1. `AuthMiddleware` extrae `Authorization: Bearer <jwt>` del request
2. Lo deposita en `contextvars.ContextVar("unidata_mcp_request_token")`
3. `get_client()` en server.py:
   - Si contextvar tiene valor → crea UnidataClient nuevo con ese token (HTTP mode)
   - Si está vacío → usa singleton con env var (stdio mode)
4. Cada tool corre con el cliente correspondiente → RBAC aplica por usuario

**Gotchas críticos para Fargate + ALB:**
- SSE keep-alive: ALB idle timeout debe ser **≥4000s**, no el default 60s
- ulimit -n debe ser **≥2048** para múltiples conexiones SSE concurrentes
- Si ALB mata conexión, Claude Desktop auto-reconecta (no es fatal pero degrada UX)
- contextvars + uvicorn async: thread-safe, no hay token leakage entre requests

---

## 5. Bases de datos

UNIDATA habla con **3 grupos de bases de datos distintas**. Esta es la parte más crítica de la migración.

### 5.1 Supabase PostgreSQL (datos propios de UNIDATA) — **SE MIGRA**

**Conexión:** `DATABASE_URL` env var → `psycopg2.pool.ThreadedConnectionPool` (1-10 conns) en `backend/app/db/local_persistence.py`

**Tablas:**
| Tabla | Propósito |
|---|---|
| `users` | Identidad UNIDATA + bcrypt password + 2FA TOTP secret (Fernet encrypted) |
| `user_areas` | RBAC junction: user_id ↔ area_id |
| `it_alerts` | Alertas IT (integraciones caídas, pedidos atascados, tokens vencidos) |
| `cs_actions` | Cola de tareas Customer Success (pending/doing/done/cancelled) |
| `cs_templates` | Templates de acciones CS |
| `dropshipper_notes` | Notas del equipo por dropshipper (7 categorías) |
| `reminders` | Recordatorios personales |
| `mcp_tokens` | Token revocation tracking (jti + last_used + revoked) |
| `meta_ads_*` (varias) | Datos Meta Ads sincronizados diariamente |
| `people_*` (varias) | HR data: legajo, kudos, eventos, encuestas |
| `flujo_fondos.*` (11 tablas) | Cash flow data (migrado desde Supabase Pedro vía `_migrate-flujo-fondos.py`) |

**Acción de migración:**
- `pg_dump` desde Supabase → `pg_restore` a RDS PostgreSQL nuevo en AWS
- Validar integridad fila por fila (sample) antes del cutover
- Mantener Supabase como source-of-truth en standby hasta confirmar AWS estable 1 semana

### 5.2 AWS RDS productivo de unidades de negocio — **NO SE MIGRA, queda donde está**

UNIDATA solo **lee** estos RDS para alimentar dashboards y workflows.

| Engine | RDS Host | DB | Bastión EC2 | Local port |
|---|---|---|---|---|
| `unistore` | `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432` | `unistore_api` | `3.139.209.227:22` (ec2-user) | 5433 |
| `unidrop` | `unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432` | `unidrop_api` | `18.191.119.38:22` (ec2-user) | 5434 |
| `unidev` | (mismo que unistore o variant) | `unidev` | (bastion unistore o propio) | 5435 |

**Schemas relevantes por engine:**
- **unistore**: `tienda_nube` (orders Unistore retail), `meli`, `digip` (WMS), `contabilium` (ERP), `public`
- **unidrop**: `public` (PaymentIntent Talo, suscripciones, denormalización TN), `mercado_libre_dev` (OML), `contabilium_dev`, `digip_dev`, `cresium`
- **unidev**: custom para operaciones internas

**Pool config por engine:**
- `pool_size=15`, `max_overflow=10`, `pool_timeout=20s`, `pool_pre_ping=True`, `pool_recycle=300s`
- `statement_timeout=30000ms`, `timezone=America/Argentina/Buenos_Aires`
- SSH `set_keepalive=30s`

**Total potencial de conexiones simultáneas:** 3 engines × 25 conns = 75 hacia los RDS productivos.

**Acción de migración:**
- **Si los RDS prod viven en cuenta `soporte.it.unistore`**: el backend AWS habla por **VPC privada directa** (eliminar SSH tunnel) — debe verificar Mauro
- **Si viven en otra cuenta AWS**: opciones:
  - VPC peering / Transit Gateway entre cuentas (cleanest)
  - Mantener el SSH tunnel actual desde Fargate (más simple, menor cambio)
  - AWS Systems Manager Session Manager (sin SSH key management)

### 5.3 SQLite locales (legacy en transición) — **MIGRAR A RDS NUEVO**

Hoy viven en volumen persistente de Railway en `/app/data`. **No están backed up**.

| Archivo | Tablas | Estado |
|---|---|---|
| `users.db` | users (legacy) | Deprecated · ya migrado a Supabase |
| `audit.db` | audit_logs (queries run_sql ejecutadas) | Activo |
| `costs.db` | import_costs, sku_costs | Activo |

**Acción de migración:**
- `audit.db` y `costs.db` → migrar al mismo RDS PostgreSQL nuevo (no usar EBS en Fargate)
- Script de migración one-shot: lee SQLite local → INSERT en RDS PostgreSQL

---

## 6. Integraciones externas (10 APIs)

| Servicio | Endpoint | Auth | Env vars | Crítico |
|---|---|---|---|---|
| **Mercado Libre** | `api.mercadolibre.com/orders`, `/shipments`, `/oauth/token` | OAuth2 (Bearer + refresh) | `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REFRESH_TOKEN`, `ML_ACCESS_TOKEN`, `ML_USER_ID` | Sí — sync órdenes Unidrop |
| **Tienda Nube** | `api.tiendanube.com/v1/stores/{id}/orders` | Bearer | `TN_UNI_STORE_ID`, `TN_UNI_ACCESS_TOKEN` | Sí (vía RDS, no llamadas directas) |
| **DigiP WMS** | `api.v2.digipwms.com`, `api.patagoniawms.com` | `X-API-KEY` header | `DIGIP_API_KEY` | Sí — carga pedidos a WMS |
| **Contabilium** | OAuth2 + invoices API | OAuth2 | `CB_CLIENT_ID`, `CB_CLIENT_SECRET` | Sí — facturas |
| **Meta Ads** | `graph.facebook.com/v21.0` | Query param `access_token` | `META_ACCESS_TOKEN`, `META_API_VERSION`, `META_AD_ACCOUNT_IDS`, `META_ACCOUNT_UNIT_MAP` | Sí — marketing dashboard |
| **Jira** | `unistore-it.atlassian.net` | Basic (email + token) | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Sí — jira_flow |
| **Confluence** | misma instancia Atlassian | misma auth Jira | (compartido) | Sí — auto-docs |
| **Teams** | webhook MessageCard | URL secreta | `TEAMS_WEBHOOK_URL` | Sí — notificaciones |
| **Gemini (Google)** | `generativelanguage.googleapis.com` | API key | `GEMINI_API_KEY`, `GEMINI_MODEL` | Sí — jira_flow LLM |
| **Unidrop API (interno)** | `api.unidrop.com.ar/mercado-libre/subscriptions/unassign/{email}` | Bearer JWT admin | `UNIDROP_API_URL`, `UNIDROP_API_TOKEN` | Sí — refund flow |

**Quirks documentados (descubiertos a la mala):**
- **DigiP "Ya existe" 400** → reintentar con sufijo `-1`, `-2`, ... max 9
- **DigiP "sequence contains more than one element" 400** → bug DigiP, retry list existentes
- **DigiP `observacion` truncado a 250 chars** → smart truncate en pipe `|`
- **Meta Ads paginación** → max 50 pages hardcoded (truncado si cuenta tiene 100k ads)

---

## 7. Variables de entorno (consolidado)

### 7.1 Backend (~40 vars)

**Core:**
- `DATABASE_URL` (Supabase) **★**
- `JWT_SECRET` (64+ chars HS256) **★**
- `JWT_ALGORITHM` (default HS256)
- `JWT_EXPIRES_HOURS` (default 12)
- `ALLOWED_ORIGINS` (csv)
- `TOTP_CIPHER_KEY` (Fernet base64)
- `PORT` (default 8000)
- `PEOPLE_SCHEDULER_DISABLED` (set "1" para deshabilitar APScheduler)

**Bastiones SSH (por engine: UNISTORE, UNIDROP, UNIDEV):**
- `BASTION_HOST_{ENGINE}` (IP pública EC2) **★**
- `BASTION_PORT_{ENGINE}` (22)
- `BASTION_USER_{ENGINE}` (ec2-user) **★**
- `BASTION_KEY_PATH_{ENGINE}` (path .pem para dev local) o
- `BASTION_KEY_{ENGINE}_BASE64` (base64 de .pem para Railway) **★**
- `LOCAL_PORT_{ENGINE}` (5433/5434/5435) **★**

**RDS productivos (por engine):**
- `PROD_DB_HOST_{ENGINE}` **★**
- `PROD_DB_PORT_{ENGINE}` (5432) **★**
- `PROD_DB_NAME_{ENGINE}` **★**
- `PROD_DB_USER_{ENGINE}` **★**
- `PROD_DB_PASSWORD_{ENGINE}` **★**

**Integraciones externas:** (sección 6 — ~20 vars)

**Seed admin:**
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` (solo se usan en primer arranque para crear admin)

### 7.2 Frontend (1 var)

- `NEXT_PUBLIC_API_URL` — apunta al backend (build-time, inyectada por Railway en Docker build)

### 7.3 MCP (4 vars)

- `UNIDATA_API_URL` (default `https://api.unidatacenter.com.ar`)
- `UNIDATA_TOKEN` (JWT largo si se usa en stdio; en HTTP viene del request)
- `UNIDATA_TIMEOUT_S` (default 30)
- `PORT` (default 8765)

**★ = obligatorias para arranque (sin estas, el backend no levanta)**

---

## 8. Build & deploy actual (Railway)

### 8.1 Backend
- **Dockerfile**: `python:3.12-slim` + `openssh-client` + `libpq5` + pip install + entrypoint.sh + uvicorn
- **entrypoint.sh**: materializa `BASTION_KEY_*_BASE64` → `/app/keys/*.pem` (chmod 600)
- **Healthcheck**: `GET /api/health` 200 dentro de 60s
- **Volumen persistente**: `/app/data` para SQLite files (NO backed up)
- **Auto-deploy**: push a `main` → Railway webhook → build → deploy

### 8.2 Frontend
- **Dockerfile**: multi-stage `node:20-alpine` (deps → builder → runner)
- **Build arg**: `NEXT_PUBLIC_API_URL` inyectado en build time
- **Healthcheck**: `GET /` timeout 60s
- **Restart policy**: ON_FAILURE max 5 retries
- **User**: `nextjs` (no-root)

### 8.3 MCP
- **Dockerfile**: `python:3.12-slim` + `pip install -e .` → `unidata-mcp-http`
- **Puerto**: 8765
- **Healthcheck**: `GET /health` 200 dentro de 30s

### 8.4 Comando de deploy
```powershell
cd backend && railway up --detach && cd ..
cd frontend && railway up --detach && cd ..
cd mcp && railway up --detach && cd ..
```

**Anti-pattern conocido:** NUNCA usar `railway up <path> --path-as-root --service <name>` — corrompe el snapshot (312KB vs 13MB esperados) y rompe todos los deploys subsiguientes.

---

## 9. Jobs background y scheduling

**APScheduler in-process en backend:**
- Auto-cumpleaños 09:00 ART todos los días → `people_hr_db.auto_post_today_birthdays()`
- Marker idempotente en DB previene duplicados si escala a múltiples instancias

**Polling de APIs externas:**
- Meta Ads sync: triggered on-demand vía endpoint (no schedule fijo hoy)
- ML/TN/DigiP: sync on-demand desde frontend o n8n workflows externos

**Para AWS migration:**
- Reemplazar APScheduler in-process con **EventBridge + ECS RunTask** (más resiliente que scheduler en container)
- Alternativa: dejar APScheduler tal cual, asumiendo single replica en Fargate

---

## 10. Auth, seguridad, RBAC

### Roles
| Role | Acceso |
|---|---|
| `admin` | Total + panel /admin |
| `is_admin=true` (flag) | Total (puede combinarse con cualquier role) |
| `gerencia` | Cross-area visibility |
| `user` / `analista` / `lector` | Solo su área asignada |

### Áreas (9)
`administracion`, `compras`, `finanzas`, `ventas`, `logistica`, `cs`, `marketing`, `people`, `it_data`

### Security details
- **JWT HS256** · expiración 12h · secret en env var
- **2FA TOTP** opcional por usuario (pyotp + Fernet AES-128 para secret en DB)
- **Bcrypt rounds=12** (~100ms per verify)
- **MCP tokens 90d** · scope=mcp · revocation tracking (jti)
- **Rate limiting** en `/auth/login` y `/auth/register` (slowapi)
- **Security headers**: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy
- **CORS** restrictivo: solo `*.unidatacenter.com.ar` + `*.up.railway.app` + localhost

---

## 11. Aspectos críticos / gotchas

### 1. Query error swallowing (`services/_utils.py`)
El wrapper `q()` traga errores SQL silenciosamente y retorna `[]`. Esto esconde bugs.
**Impacto AWS:** durante la migración, si hay queries que fallan por nombres de columnas o permisos, no van a tirar error visible. Validar con structured logging en CloudWatch.

### 2. SSH tunnel auto-recovery
Si el bastión cae o cambia IP, `get_engine()` intenta reconectar. Si falla 2x, raises.
**Impacto AWS:** los bastiones EC2 existentes deberían quedar — pero si Fargate tiene la VPC correcta, eliminar tunnel y usar VPC privada directa.

### 3. Statement timeout 30s
Queries que pasan 30s → killed. Dashboards complejos (`dropshippers.py` con 10+ JOINs) pueden tocar el límite.
**Mitigation:** índices agresivos o materialized views.

### 4. PDF memory spike en label downloads
`GET /label` decodifica base64 PDF en memoria. Múltiples descargas concurrentes pueden OOM.
**Fix:** streaming response + chunked encoding, o pre-generate a S3.

### 5. SQLite local files
`/app/data/{costs,audit}.db` viven en volumen Railway no-backed-up. Si Fargate stateless → migrar a RDS PostgreSQL.

### 6. APScheduler en múltiples replicas
Cada replica corre su propio scheduler → jobs duplicados.
**Mitigation actual:** marker idempotente en DB. Mejor fix: EventBridge.

### 7. CORS hardcodeado a `*.up.railway.app`
Después de migrar a AWS, hay que sumar `*.amplifyapp.com` o el dominio final al regex de CORS en `main.py`.

### 8. Volumen NO compartido entre replicas
Si Fargate escala horizontalmente, cada task tiene su `/app/data` separado.
**Fix:** todo a RDS, eliminar SQLite local.

### 9. Bcrypt rounds=12 → ~100ms por verify
OK para <1000 logins/min. Si crece, considerar async hash o reducir rounds.

### 10. Meta Ads sync de 5-30 min
Endpoint `POST /api/marketing/meta/sync` puede tardar mucho. En Railway corre síncrono. En Fargate detrás de ALB con timeout default 60s **se va a cortar**.
**Fix:** mover a job async (ECS RunTask + SQS, o EventBridge) y devolver `202 Accepted` con job_id.

---

## 12. Tamaño total

| Componente | LOC | Archivos | Memoria estimada prod |
|---|---|---|---|
| Backend Python | ~53,000 | ~5,000 .py | 300-500 MB |
| Frontend TS/TSX | ~57,000 (app + components + lib) | ~620 .tsx/.ts | 50-100 MB (Node SSR) |
| MCP Python | ~912 | 6 archivos | 50-100 MB |
| Scripts + docs | ~500 | 20+ archivos | — |
| **Total codebase** | **~111,000 LOC** | **~6,000 archivos** | — |

**Volumen actual de datos a migrar (Supabase):**
- Estimar via `pg_dump --schema-only --no-owner --no-acl` para conocer tamaño exacto
- Tablas más grandes probablemente: `meta_ads_*`, `cs_actions` (cola histórica), `flujo_fondos.*` (538 filas + historia)
- Estimado total: **< 5 GB** comprimido (no es una BD masiva)

---

## 13. Documentos relacionados

| Doc | Propósito |
|---|---|
| [AWS_MIGRATION_SPEC.md](AWS_MIGRATION_SPEC.md) | Plan detallado de la migración (qué arquitectura AWS, qué decisiones abiertas, qué docs entregar) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Diseño de componentes (más viejo) |
| [DATA_INVENTORY.md](DATA_INVENTORY.md) | Mapeo de tablas/columnas |
| [LOCAL_DEV.md](LOCAL_DEV.md) | Guía dev local |
| [DEPLOY.md](DEPLOY.md) | Instrucciones deploy actual (Railway) |
| [OPERATIONS.md](OPERATIONS.md) | Runbooks |
| [FLUJO_FONDOS_INTEGRATION.md](FLUJO_FONDOS_INTEGRATION.md) | Migración especial de Flujo de Fondos desde Supabase Pedro |
| [CLAUDE.md](../CLAUDE.md) | Guía para Claude (biblia del proyecto) |
| [JIRA_ROADMAP.md](../JIRA_ROADMAP.md) | Roadmap histórico |

---

## 14. Checklist de entregables para Mauro

### Lectura previa (≥30 min)
- [ ] Este documento (UNIDATA_PROJECT_OVERVIEW.md)
- [ ] AWS_MIGRATION_SPEC.md (especialmente §7 Decisiones abiertas)
- [ ] CLAUDE.md (top-level)

### Accesos
- [ ] Invitación a workspace Railway como viewer (env vars + logs)
- [ ] IAM user en cuenta `soporte.it.unistore` con AdministratorAccess
- [ ] Acceso al repo `unidata-pro` en GitHub
- [ ] Acceso a Supabase project (read-only para hacer `pg_dump`)

### Secretos (via 1Password / Bitwarden — NUNCA por chat/mail)
- [ ] `DATABASE_URL` Supabase
- [ ] `BASTION_KEY_*_BASE64` (las 2-3 SSH keys de bastiones)
- [ ] `PROD_DB_PASSWORD_*` para los 3 RDS
- [ ] `JWT_SECRET`, `TOTP_CIPHER_KEY`
- [ ] OAuth tokens: `ML_*`, `TN_*`, `CB_*`, `META_*`, `UNIDROP_*`
- [ ] API keys: `DIGIP_API_KEY`, `GEMINI_API_KEY`, `JIRA_API_TOKEN`, `TEAMS_WEBHOOK_URL`

### Decisiones a alinear en kick-off
1. ¿Cuenta nueva via AWS Organizations o trabajamos sobre `soporte.it.unistore` con naming convention `unidata-prod-*`?
2. ¿Los RDS productivos de Unistore/Unidrop/Unidev viven en `soporte.it.unistore` o en otra cuenta? (decide cómo conecta backend a esos RDS)
3. ¿Mover nameservers de Cloudflare a Route53, o mantener Cloudflare como proxy y Route53 solo interno?
4. ¿Cómo armar el JWT bridge entre frontend (Amplify) y backend (Fargate) — cookie cross-domain vs Bearer + localStorage tal cual está?
5. ¿Schema dedicado en RDS existente o RDS PostgreSQL propio nuevo para UNIDATA?
6. ¿Reemplazar APScheduler con EventBridge + ECS RunTask, o dejar in-process asumiendo single replica?
7. ¿Meta Ads sync long-running se vuelve async (SQS + ECS RunTask) o se queda síncrono con timeout alto en ALB?

### Entregables esperados (Mauro)
- [ ] Repo `unidata-infra/` con Terraform (o CDK) modular y reutilizable
- [ ] 3 services corriendo en AWS (backend + frontend + mcp)
- [ ] RDS PostgreSQL nuevo con data de Supabase restored y validada
- [ ] Route53 hosted zone + ACM certs + DNS cutover
- [ ] CI/CD GitHub Actions con OIDC (no access keys)
- [ ] CloudWatch dashboards + alarmas críticas
- [ ] 7 docs en `docs/AWS_*.md`:
  - [ ] `AWS_ARCHITECTURE.md` — diagrama final + decisiones
  - [ ] `AWS_DEPLOY.md` — cómo deployar (Daniel solo)
  - [ ] `AWS_RUNBOOK.md` — incidentes comunes + cómo resolverlos
  - [ ] `AWS_SECRETS.md` — cómo agregar/rotar secrets
  - [ ] `AWS_NETWORKING.md` — VPC, subnets, SGs, peering
  - [ ] `AWS_CICD.md` — flow de GitHub Actions
  - [ ] `AWS_COSTS.md` — desglose de costos esperados/observados
- [ ] Handoff session 1h donde Daniel queda operando solo
