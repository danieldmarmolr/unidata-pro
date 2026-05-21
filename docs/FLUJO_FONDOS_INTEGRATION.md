# Flujo de Fondos — port nativo a UNIDATA

## Decisión arquitectónica (2026-05-21)

El proyecto [`pedroabba123/flujo-fondos`](https://github.com/pedroabba123/flujo-fondos) (Next.js + Drizzle + Supabase Auth, dueño Pedro Abbiati) se integra a UNIDATA como **port nativo** (Modo A del skill `port-to-unidata`), NO como sub-app sincronizada (Modo B).

**Por qué port nativo y no sub-app sincronizada**: el usuario decidió que la app debe vivir dentro de UNIDATA bajo `Cross > Finanzas > Flujo de Fondos`, con la look-and-feel del panel (Topbar morado, gradientes UNIDATA, Tailwind tokens), RBAC nativo de UNIDATA (JWT propio + `require_area`), y endpoints FastAPI propios. NO redirect a un sub-dominio externo. Razón: la solapa Finanzas debe ser un único contexto unificado para el área de finanzas, sin "saltos" a otra app.

## Lo que se reutiliza del trabajo previo (Modo B descartado)

**DB ya migrada al Supabase UNIDATA** (no se pierde):

| Tabla | Filas |
|-------|-------|
| empresas | 4 |
| unidades_negocio | 3 |
| bancos_medios_pago | 6 |
| proveedores | 0 |
| recurrencias | 0 |
| erogaciones | 308 |
| acuerdos | 0 |
| facturacion_diaria | 209 |
| ingresos_puntuales | 4 |
| saldos_iniciales | 4 |
| perfiles | 1 |

Las 11 tablas viven en `public` del Supabase UNIDATA (project `pmeuexynoftqyyoeyhyn`). Junto con:
- 9 enums custom (`canal_unidad_negocio`, `estado_erogacion`, `tipo_banco`, etc.)
- 14 foreign keys
- RLS policies (irrelevante en port nativo porque conectamos via SQLAlchemy con role `postgres`, bypass RLS)
- 2 functions (`es_admin`, `handle_new_user`) y 1 trigger en `auth.users` — quedan ahí pero el port nativo NO los usa (auth de UNIDATA es JWT propio, no Supabase Auth)

**Subtree `services/flujo-fondos/`** queda como referencia de código (NO se deploya, NO se edita):
- `src/db/schema/*.ts` — schemas Drizzle (referencia para los modelos SQLAlchemy)
- `src/lib/proyeccion.ts` — motor central de proyección de saldos (por portar)
- `src/lib/pagos-atrasados.ts` — algoritmo de re-fechas (por portar)
- `src/lib/detectar-patrones.ts` — detector de recurrencias (por portar)
- `src/app/(app)/*/page.tsx` — 20 pantallas (referencia de UX, NO se copian — se reimplementan con identidad UNIDATA)
- `drizzle/0000_*.sql` a `0010_*.sql` — migraciones aplicadas (referencia)

**Lo que NO se reutiliza** (descartado del Modo B):
- ❌ Service Railway `flujo-fondos` (eliminado 2026-05-21)
- ❌ Custom domain `caja.unidatacenter.com.ar` (eliminado)
- ❌ CNAME en Cloudflare (eliminado)
- ❌ Login via Supabase Auth (UNIDATA usa JWT propio)
- ❌ Tabla `perfiles` (UNIDATA tiene su propia `users` + `areas`)
- ❌ FK `perfiles.id → auth.users(id)` (Pedro como user de Supabase legacy quedó en `auth.users` pero el port nativo no lo usa)
- ❌ Trigger `on_auth_user_created` (irrelevante para el port nativo)

## Arquitectura del port nativo

### Backend FastAPI

`backend/app/services/flujo_fondos/`:
- `models.py` — SQLAlchemy ORM mapping 1:1 con las 11 tablas en `public`
- `proyeccion.py` — motor de proyección de saldos (port de `src/lib/proyeccion.ts`)
- `pagos_atrasados.py` — sugerencias de re-fechas (port de `src/lib/pagos-atrasados.ts`)
- `excel_importers.py` — parsers de plantillas Excel (port de los API routes de Next.js)

`backend/app/api/flujo_fondos.py`:
- `GET /api/flujo-fondos/health`
- `GET /api/flujo-fondos/kpis` — para home (pendiente, en_curso, atrasadas, etc.)
- `GET/POST/PATCH/DELETE /api/flujo-fondos/erogaciones`
- `GET /api/flujo-fondos/proyeccion?dias=30` — motor central
- `GET/POST /api/flujo-fondos/facturacion-diaria`
- `GET/POST /api/flujo-fondos/ingresos-puntuales`
- `GET /api/flujo-fondos/saldos-iniciales`
- `GET/POST /api/flujo-fondos/empresas` (maestro)
- `GET/POST /api/flujo-fondos/bancos` (maestro)
- `GET/POST /api/flujo-fondos/proveedores` (maestro)
- `GET/POST /api/flujo-fondos/unidades-negocio` (maestro)

Todos los endpoints con `Depends(current_user)` + `require_area(["finanzas", "administracion"])` (admin/gerencia bypass).

### Frontend Next.js (en monorepo UNIDATA)

`frontend/app/dashboard/finanzas/flujo-fondos/`:
- `layout.tsx` — Topbar UNIDATA + tab nav (Home, Erogaciones, Proyección, etc.)
- `page.tsx` — home con KPIs + mini-charts
- `erogaciones/page.tsx` — CRUD completo
- `proyeccion/page.tsx` — gráfico de área + tabla
- (Fase N): calendario, pagos-atrasados, importar, maestros, etc.

`frontend/app/dashboard/finanzas/flujo-fondos/_components/`:
- `KpiCard.tsx`
- `ErogacionForm.tsx`
- `ProyeccionChart.tsx`
- `MoneyArs.tsx` (formato `$ 1.234.567,89`)

### Conexión a la DB

UNIDATA backend ya conecta al Supabase UNIDATA via `app.db.local_persistence.get_conn()`. Para Flujo de Fondos usaremos un engine SQLAlchemy propio apuntando al mismo Supabase pero con sus propios models. **NO mezclar** con las queries de los otros dominios (Unistore/Unidrop/Unidev tienen sus propios engines via SSH tunnel).

## Plan por fases

### Fase 1 (sesión actual) — MVP usable
- Backend: models SQLAlchemy + motor de proyección + ~8 endpoints (CRUD erogaciones, kpis, proyección, maestros básicos)
- Frontend: home + erogaciones (con tabla + filtros básicos + crear/editar) + proyección (gráfico + tabla)
- Sidebar: entry interno `/dashboard/finanzas/flujo-fondos` (ya wireado)

### Fase 2 — features de operación
- Pagos atrasados con sugerencias
- Calendario mensual de caja
- Ingresos puntuales + recurrencias + acuerdos
- Detector de patrones

### Fase 3 — features de importación y maestros
- Importadores Excel (4 plantillas)
- Maestros completos (CRUD de empresas, bancos, proveedores, unidades de negocio)
- Análisis agregado, precisión, promedios

### Fase 4 — paridad con la app original
- Cmd+K búsqueda global
- Bulk operations en erogaciones
- Exportar CSV
- Detalle dropdown lateral en calendario

## Coordinación con Pedro

El subtree `services/flujo-fondos/` sigue viviendo en el repo como referencia. Si Pedro sigue desarrollando en su repo `pedroabba123/flujo-fondos`, podemos correr `pwsh scripts/sync-flujo-fondos.ps1` para tener su última versión como referencia (NO afecta el port nativo).

Pedro queda libre de seguir usando su deploy en Vercel (https://flujo-fondos.vercel.app) hasta que el port nativo cubra suficientes features. Cuando estemos listos, le anunciamos el switch.

**Datos**: los 538 rows + el user de Pedro están en el Supabase UNIDATA. Si Pedro quiere ver/editar a través del port nativo, hay que crearle un user en `users` de UNIDATA con `area_slug='finanzas'` y `is_admin=true`.

## Anti-patterns

- ❌ Editar archivos dentro de `services/flujo-fondos/` — no hace nada, ese subtree no se deploya. Editar `backend/app/services/flujo_fondos/` y `frontend/app/dashboard/finanzas/flujo-fondos/`.
- ❌ Usar Drizzle ORM en el port nativo — usar SQLAlchemy del backend UNIDATA.
- ❌ Usar Supabase Auth — usar JWT propio de UNIDATA (`current_user`).
- ❌ Reescribir RLS policies — el bypass via `SUPABASE_SECRET_KEY` no aplica acá; UNIDATA backend conecta con role `postgres` y bypassea RLS naturalmente.
- ❌ Copiar componentes shadcn de `@base-ui/react` del subtree — UNIDATA usa su propio shadcn registry.

## Referencias

- Skill: `~/.claude/skills/port-to-unidata/SKILL.md` (Modo A — Port nativo)
- Subtree referencia: [`services/flujo-fondos/`](../services/flujo-fondos/)
- Doc original Pedro: [`services/flujo-fondos/docs/HANDOFF.md`](../services/flujo-fondos/docs/HANDOFF.md)
- DB Supabase UNIDATA: project `pmeuexynoftqyyoeyhyn` (las 11 tablas viven en `public`)
