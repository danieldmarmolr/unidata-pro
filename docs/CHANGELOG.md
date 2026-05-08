# UNIDATA — Changelog

Historia de cambios versionada. Sigue [Keep a Changelog](https://keepachangelog.com/) y [SemVer](https://semver.org/).

---

## [1.0.0-mvp] — 2026-05-08

> **MVP V1 — Primera version en produccion.**
> Plataforma de analitica interna del grupo Unistore con auth, persistencia
> profesional y dashboards de las 3 unidades de negocio.

### Added — Funcionalidad

- **Self-registration con dominio @unistore.ar.** Cualquier colaborador con email corporativo puede crear su cuenta sola, sin pedir permiso al admin. Rol default: `lector` (admin puede promover despues a `analista`, `gerencia` o `admin`).
- **Set-initial-password + auto-login.** Wizard de 2 pasos que crea la cuenta y entra automaticamente al dashboard.
- **JWT auth con bcrypt.** Tokens validos 12 hs, password hasheado con bcrypt (12 rounds).
- **Roles segmentados:** `admin`, `gerencia`, `analista`, `lector`, `user`. Cada rol ve un subconjunto distinto de dashboards.
- **Dashboards "HOY" para Unistore, Unidev, Unidrop** con KPIs en tiempo real.
- **Drilldowns** en cada metrica (ordenes, productos, clientes, provincias, payment accounts).
- **Editor SQL libre** read-only con statement timeout 30s y bloqueo de DML/DDL a nivel parser.
- **Audit log** de cada query corrida (quien / que SQL / cuando / cuanto tardo).
- **Mapa Argentina** con 24 provincias coloreadas por volumen.
- **Export CSV** de cualquier tabla.
- **Admin > Usuarios** con CRUD completo + reset de password.

### Added — Infraestructura

- **Backend FastAPI** deployado en Railway (Pro plan).
- **Frontend Next.js 16 (Turbopack)** deployado en Railway.
- **PostgreSQL en Supabase** (free tier, 500 MB) para persistencia propia (users, audit log, costs).
- **Static Outbound IP** (`162.220.232.99`, region us-west-2) para integracion con AWS bastions.
- **Auto-deploy** desde GitHub `main` a Railway.
- **CORS** configurado entre frontend y backend con whitelisting explicito.
- **HTTPS** automatico por Railway edge.

### Changed — Migraciones

- **SQLite -> PostgreSQL.** Las 3 BBDD locales (`users.db`, `audit.db`, `costs.db`) migradas a Supabase Postgres con SQLAlchemy-friendly schemas. Soporte para case-insensitive email + indices LOWER().
- **IPv4 pooler de Supabase** en vez de direct (que resuelve a IPv6 y Railway no soporta IPv6 outbound por default).

### Fixed

- Build de Next.js fallaba por tipos en `recharts.Tooltip.formatter`. Cambiado a `(v: unknown)` con cast.
- Build de Next.js fallaba por falta de `@types/react-simple-maps`. Agregada declaration file local.
- Backend Dockerfile no respetaba `$PORT` de Railway. Cambiado a shell-form CMD con expansion.
- Backend healthcheck timeout 30s era muy agresivo. Extendido a 300s via `railway.json`.
- Dockerfile tenia `VOLUME` directive no soportado por Railway. Removido.
- Faltaba var `BASTION_KEY_PATH_UNIDEV` en entrypoint (Unidev usa la misma instancia EC2 de Unistore).
- Frontend NEXT_PUBLIC_API_URL no se bakeaba en build. Agregado `ARG NEXT_PUBLIC_API_URL` al Dockerfile.
- Typo de dominio: `unistor.ar` -> `unistore.ar` (correcto) en codigo, frontend, env vars y docs.

### Documentation

- `docs/DEPLOY.md` — guia completa de deploy a Railway.
- `docs/TICKET_AWS_BASTION.md` — ticket Jira listo para data engineer.
- `docs/GUIA_UNIFULL_AWS_RAILWAY.md` — guia para proyecto paralelo (Unifull).
- `docs/PLAN_JIRA.md` — Epic UNIDATA + 16 User Stories + 70+ tasks tecnicas.
- `docs/CHANGELOG.md` — este archivo.
- `docs/ARCHITECTURE.md` — referencia tecnica.
- `docs/OPERATIONS.md` — runbook day-2.
- `docs/launch/*` — material de lanzamiento.

### Known limitations (pre-AWS allowlist)

- **Datos de negocio en cero** hasta que el equipo de IT (Mauro Candia, AWS) allowlistee la IP `162.220.232.99/32` en los Security Groups de los bastions Unistore (`3.139.209.227`) y Unidrop (`18.191.119.38`). Una vez aprobado, los datos fluyen automaticamente sin redeploy.

### Stack final

| Capa | Tecnologia |
|---|---|
| Backend API | FastAPI (Python 3.12) |
| Frontend | Next.js 16 (Turbopack) + Tailwind |
| Auth | JWT + bcrypt (PyJWT, passlib) |
| DB propia | PostgreSQL (Supabase free tier) |
| DB de negocio | PostgreSQL via AWS RDS (read-only via SSH bastion) |
| Container | Docker multi-stage |
| Hosting | Railway (Pro plan) |
| Repo | GitHub `danieldmarmolr/unidata-pro` |

---

## Next releases (planificadas)

### [1.1.0] — Sprint 2 (proxima semana)

- **People Module Fase 2:** Mi perfil enriquecido (US-12) — wizard de onboarding con area, posicion, skills, idiomas.
- **AUTH-06:** boton admin "reset password" para casos de olvido.
- **ANL-01..04:** analytics interna basica (page_view, query_run, export tracking).
- **SEC-02:** rate limiting en `/api/auth/login`.

### [1.2.0] — Sprint 3 (mes 2)

- **People Module Fase 3:** Discovery — encontrar colegas similares (US-13).
- **People Module Fase 4:** Dashboard `/admin/people` para gerencia de RRHH (US-14).
- **M365 SSO** opcional (coexiste con self-registration).

### [2.0.0] — Mes 3+

- **People Module Fase 5:** Timeline de hitos + privacidad granular (US-15, US-16).
- **Network graph** interactivo.
- **Integracion M365** (auto-fill perfil desde Azure AD).
- **PDF export** branded.
