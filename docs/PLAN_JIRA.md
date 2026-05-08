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

### E2. Modelo de unidades de negocio (separacion estricta)

> Politica: las unidades **Unistore** y **Unidrop** se mantienen separadas en
> dashboards, queries y exports. **Unidev** es una DB tecnica (devoluciones)
> dentro del dominio Unistore, NO una tercera unidad. Toda mezcla cross-unit
> debe ser explicita y opt-in.

| ID | Estado | Descripcion |
|---|---|---|
| UNIT-01 | ✅ DONE | Backend: servicios separados por unidad (`*_unistore`, `*_unidrop`). No hay queries que mezclen datos. |
| UNIT-02 | ✅ DONE | Frontend: labels de tiles aclaran cual unidad (`solo Unidrop`, `vista por unidad`, `Unistore (esquema Unidev)`). |
| UNIT-03 | ✅ DONE | Documentar modelo en `ARCHITECTURE.md` seccion "Modelo de unidades de negocio". |
| UNIT-04 | 🟡 SPRINT 2 | Refactor de `/dashboard/home`: card top-level por unidad, sub-tiles dentro. Devoluciones queda como tab dentro de Unistore. |
| UNIT-05 | 🟡 SPRINT 2 | Tile "Gerencial" -> renombrar a "Comparativa cross-unidad" y aclarar que muestra ambos lado-a-lado, no agregados sumados. |
| UNIT-06 | 🟡 BACKLOG | Indicador de unidad permanente en topbar (badge visible mientras navegas, asi siempre sabes que estas viendo). |
| UNIT-07 | 🟡 BACKLOG | Audit log: filtro por unidad para que admins vean queries por unidad. |

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
- **People Module Fase 2:** US-12 (Mi perfil enriquecido) - wizard de onboarding rico
- **Mejoras de producto:** segun feedback de los primeros 5 usuarios

## Sprint 3+ (mes 2)

- **People Module Fase 3:** US-13 (Discovery + similitudes) - red social interna
- **People Module Fase 4:** US-14 (Dashboard People Analytics RRHH)
- **M365 SSO** (reemplaza/coexiste con self-registration)
- **Read-only DB users** (AWS-02)
- **PostHog** integration para session replay (opcional)
- **PDF export** branded

## Mes 3+ (consolidacion)

- **People Module Fase 5:** US-15 (Timeline de hitos), US-16 (Privacidad granular)
- **Network graph** interactivo
- **Mentor matching** automatico
- **Integracion M365 calendar / Azure AD** para auto-fill de perfil

---

## 📚 USER STORIES — People Module (Fase 2-5, diseno guardado)

> Guardado por confirmacion del 2026-05-08. Implementacion arranca **proxima semana**
> tras anuncio interno y primer feedback de usuarios.

### US-12 — Mi perfil enriquecido
> **Como** colaborador
> **Quiero** completar mi perfil con datos profesionales y personales (area, posicion, skills, idiomas, intereses)
> **Para** que UNIDATA me conecte con colegas similares y RRHH tenga data viva del equipo

**Criterios de aceptacion:**
- Wizard de onboarding de 3 pasos al primer login (puede saltearse)
- Pagina `/perfil` editable despues
- Campos opcionales por defecto, visibilidad granular por campo
- Catalogos: departments, positions, offices, skills (~50 skills iniciales), languages
- Default visibility: area + posicion + skills publicos; telefono y datos personales solo a uno mismo + RRHH

**Tasks asociadas:** PEOPLE-01..06

### US-13 — Encontrar colegas similares / red interna
> **Como** colaborador
> **Quiero** descubrir colegas con skills o intereses similares
> **Para** colaborar en proyectos cross-funcionales

**Criterios de aceptacion:**
- Pagina `/equipo` con cards filtrables por area / skill / oficina
- Sugerencias "colegas similares a vos" (cosine similarity de skills + areas)
- Search "quien sabe X en Unistore?"
- Network graph (D3 o react-force-graph)

**Tasks asociadas:** PEOPLE-07..09

### US-14 — People Analytics (dashboard RRHH)
> **Como** gerencia de People
> **Quiero** un dashboard con metricas del equipo
> **Para** decisiones de talento, capacitacion y retencion basadas en datos

**Criterios de aceptacion:**
- `/admin/people` accesible para roles `admin` y `gerencia`
- Headcount por area / modalidad / seniority / tenure
- Skills heatmap
- Adopcion UNIDATA por area (engagement)
- Onboarding funnel
- Cumpleanios / aniversarios del mes
- Cross-functional usage (gente de area A consulta data area B)

**Tasks asociadas:** PEOPLE-10..13

### US-15 — Timeline de hitos del colaborador
> **Como** colaborador y como manager
> **Quiero** ver una timeline de hitos profesionales (ingreso, promocion, certificaciones)
> **Para** trayectoria visible y celebrar logros

**Criterios de aceptacion:**
- Tabla `people_events` con event_type, date, description
- Feed personal en `/perfil`
- Feed publico (con visibilidad opt-in) en `/equipo/<user>`
- Notificaciones in-app de aniversarios

**Tasks asociadas:** PEOPLE-14..16

### US-16 — Privacidad granular
> **Como** colaborador
> **Quiero** controlar exactamente que datos mios son visibles a quien
> **Para** sentir seguridad de aportar mas data sabiendo que la controlo yo

**Criterios de aceptacion:**
- Toggle por campo: yo / mi equipo / RRHH / todos
- Audit log: ver quien vio mi perfil y cuando (`profile_access_log`)
- Boton "Descargar mis datos" -> JSON con todo lo que UNIDATA tiene del user
- Boton "Borrar mi perfil enriquecido" -> deja al user en estado basico
- Texto de consentimiento en wizard inicial (cumple Habeas Data Argentina Ley 25.326)

**Tasks asociadas:** PEOPLE-17..19

---

## 🛠 TASKS People Module (PEOPLE-* serie)

### Fase 2: Mi perfil (Sprint 2)

| ID | Estado | Descripcion |
|---|---|---|
| PEOPLE-01 | 🟡 BACKLOG | Tablas: `departments`, `positions`, `offices`, `skills`, `languages` (catalogos) |
| PEOPLE-02 | 🟡 BACKLOG | Tabla `user_profiles` (1:1 con users) + `user_skills` + `user_languages` |
| PEOPLE-03 | 🟡 BACKLOG | Seed inicial de catalogos (50 skills, areas tipicas Unistore) |
| PEOPLE-04 | 🟡 BACKLOG | Endpoints `GET/PATCH /api/me/profile` + `GET /api/catalogs/*` |
| PEOPLE-05 | 🟡 BACKLOG | Wizard onboarding 3 pasos al primer login (skipable) |
| PEOPLE-06 | 🟡 BACKLOG | Pagina `/perfil` editable con visibilidad por campo |

### Fase 3: Discovery (Sprint 3)

| ID | Estado | Descripcion |
|---|---|---|
| PEOPLE-07 | 🟡 BACKLOG | Algoritmo similarity (cosine sobre skills + areas) |
| PEOPLE-08 | 🟡 BACKLOG | Pagina `/equipo` con cards + filtros |
| PEOPLE-09 | 🟡 BACKLOG | Network graph interactivo |

### Fase 4: People Analytics (Sprint 3-4)

| ID | Estado | Descripcion |
|---|---|---|
| PEOPLE-10 | 🟡 BACKLOG | Endpoints `/api/admin/people/*` (headcount, skills, etc) |
| PEOPLE-11 | 🟡 BACKLOG | Pagina `/admin/people` con charts |
| PEOPLE-12 | 🟡 BACKLOG | Cross-functional usage analysis |
| PEOPLE-13 | 🟡 BACKLOG | Cumpleanios + aniversarios feed |

### Fase 5: Timeline + Privacidad (Sprint 4-5)

| ID | Estado | Descripcion |
|---|---|---|
| PEOPLE-14 | 🟡 BACKLOG | Tabla `people_events` + endpoints |
| PEOPLE-15 | 🟡 BACKLOG | Feed timeline en `/perfil` |
| PEOPLE-16 | 🟡 BACKLOG | Notificaciones in-app de aniversarios |
| PEOPLE-17 | 🟡 BACKLOG | Audit log de accesos a perfiles + viewer en `/perfil` |
| PEOPLE-18 | 🟡 BACKLOG | Export "mis datos" (GDPR-style) |
| PEOPLE-19 | 🟡 BACKLOG | Texto consentimiento + checkbox en onboarding |

---

## 📚 USER STORIES — Sistema de notificaciones inteligentes

> Vision: que UNIDATA no solo permita "ir a buscar la data", sino que la data
> encuentre al usuario cuando algo relevante ocurre. Tres niveles de
> sofisticacion, evolutivos.

### US-17 — Recibir notificaciones de eventos relevantes
> **Como** colaborador con permisos sobre un area de negocio
> **Quiero** recibir notificaciones automaticas cuando algo importante pasa en los datos
> **Para** enterarme en el momento sin tener que estar mirando dashboards

**Criterios de aceptacion:**
- Bell icon en topbar con badge de notificaciones no leidas
- Feed `/notifications` con historico
- Eventos tipicos: compra VIP (>$300k), stock critico, SKU trending, devoluciones altas, cliente premium nuevo
- Click en notificacion -> abre el drilldown relacionado (orden, producto, cliente)
- Marcar como leida / dismissar individuales o todas
- Sonido opcional (toggle en perfil)

**Tasks asociadas:** ALERTS-01..05

---

### US-18 — Configurar mis propias alertas (admin/gerencia)
> **Como** admin o gerencia
> **Quiero** crear y configurar reglas de alerta sobre los datos
> **Para** ajustar UNIDATA a las preocupaciones especificas de mi area

**Criterios de aceptacion:**
- Pagina `/admin/alerts` para CRUD de reglas
- Reglas tipo "threshold" (compra > X) y "frequency" (SKU vendido > N veces en ventana de tiempo)
- Activar/pausar reglas individualmente
- Elegir canal de delivery: in-app / Slack / email
- Elegir audiencia: todos los admins / todos los gerentes / users especificos
- Test de regla en datos historicos para validar antes de activar

**Tasks asociadas:** ALERTS-06..09

---

### US-19 — Recibir notificaciones por Slack / email
> **Como** usuario que no esta todo el dia mirando UNIDATA
> **Quiero** recibir las alertas criticas por Slack o email
> **Para** estar al tanto sin abrir la app

**Criterios de aceptacion:**
- Conectar workspace Slack via webhook (Slack App de Unistore)
- Conectar email via Resend (free tier 100/dia, despues paga si crece)
- Cada user define en su `/perfil` que canales prefiere por severity (info/warn/critical)
- Mensajes formateados con titulo + 1 linea de contexto + link a UNIDATA

**Tasks asociadas:** ALERTS-10..12

---

### US-20 — Alertas inteligentes con anomaly detection
> **Como** gerencia
> **Quiero** que UNIDATA me avise solo cuando algo es REALMENTE anomalo
> **Para** no recibir falsos positivos en epocas de spike normal (Black Friday, fin de mes)

**Criterios de aceptacion:**
- Modelo de time-series forecast (Prophet) entrenado con 12 meses de historia
- Alertas se disparan cuando `actual` esta fuera del intervalo de confianza al 95%
- El modelo aprende estacionalidad automaticamente (dia de semana, mes, feriado)
- Re-entrenamiento semanal automatico
- Vista admin de "modelo health": precision/recall, falsos positivos esperados

**Tasks asociadas:** ALERTS-13..16

---

### US-21 — Resumen ejecutivo diario en lenguaje natural (IA)
> **Como** gerente
> **Quiero** recibir cada manana un resumen narrativo de lo que paso ayer
> **Para** entender el negocio en 30 segundos sin abrir 5 dashboards

**Criterios de aceptacion:**
- Cron diario 8:00 AM Argentina
- Pasa metricas + alertas del dia anterior a Claude API
- Genera resumen de 3-4 parrafos en castellano natural
- Enviado por email + posteado en Slack
- Tono conversacional, no bullet points
- Mencion explicita de eventos extraordinarios (compras VIP, stockouts, etc)

**Tasks asociadas:** ALERTS-17..19

---

## 🛠 TASKS Notification System (ALERTS-* serie)

### Capa 1: Reglas configurables (Sprint 3)

| ID | Estado | Descripcion |
|---|---|---|
| ALERTS-01 | 🟡 BACKLOG | Tablas: `alert_rules`, `alert_events`, `user_notifications` |
| ALERTS-02 | 🟡 BACKLOG | Cron worker que evalua reglas cada 5 min |
| ALERTS-03 | 🟡 BACKLOG | Engine de evaluacion para tipo "threshold" (operadores >, <, =, !=) |
| ALERTS-04 | 🟡 BACKLOG | Engine para tipo "frequency" (count en ventana de tiempo) |
| ALERTS-05 | 🟡 BACKLOG | Frontend: bell icon + feed + badge unread |

### Capa 2: Configuracion + Delivery (Sprint 3-4)

| ID | Estado | Descripcion |
|---|---|---|
| ALERTS-06 | 🟡 BACKLOG | Pagina `/admin/alerts` para CRUD de reglas |
| ALERTS-07 | 🟡 BACKLOG | Test de reglas en datos historicos |
| ALERTS-08 | 🟡 BACKLOG | Reglas seedeadas tipicas (VIP buy, stock critico, etc) |
| ALERTS-09 | 🟡 BACKLOG | Preferencias del user en `/perfil` (canales por severity) |
| ALERTS-10 | 🟡 BACKLOG | Integracion Slack (webhook) |
| ALERTS-11 | 🟡 BACKLOG | Integracion email via Resend |
| ALERTS-12 | 🟡 BACKLOG | Integracion MS Teams (post-Slack si hay demanda) |

### Capa 3: ML Anomaly Detection (Sprint 5-6)

| ID | Estado | Descripcion |
|---|---|---|
| ALERTS-13 | 🟡 BACKLOG | Pipeline de extract de metricas historicas (12 meses) |
| ALERTS-14 | 🟡 BACKLOG | Modelo Prophet por metrica clave (revenue, orders, units) |
| ALERTS-15 | 🟡 BACKLOG | Engine de evaluacion tipo "anomaly" (fuera del CI 95%) |
| ALERTS-16 | 🟡 BACKLOG | Re-entrenamiento semanal automatico + dashboard model health |

### Capa 4: IA generativa (Mes 4+)

| ID | Estado | Descripcion |
|---|---|---|
| ALERTS-17 | 🟡 BACKLOG | Cron 8 AM AR: extrae snapshot del dia anterior |
| ALERTS-18 | 🟡 BACKLOG | Llamada a Claude API con prompt + datos -> resumen narrativo |
| ALERTS-19 | 🟡 BACKLOG | Distribucion automatica del resumen (email + Slack) a gerencia |
