# Flujo de Fondos — integración como sub-app sincronizada en UNIDATA

## Resumen

`flujo-fondos` es un ERP web de tesorería/flujo de caja del grupo Unistore desarrollado por **Pedro Abbiati** (`pedro.abbiati@unistore.ar`) en el repo público [`pedroabba123/flujo-fondos`](https://github.com/pedroabba123/flujo-fondos). Producción actual: https://flujo-fondos.vercel.app (Vercel + Supabase).

UNIDATA lo absorbe como **sub-app sincronizada** (Modo B del skill `port-to-unidata`):

- **Vendoring**: el repo upstream se vendoriza vía `git subtree --squash` en `services/flujo-fondos/`. NO se reescribe a stack UNIDATA.
- **Deploy**: service Railway propio (`flujo-fondos`) con root path `services/flujo-fondos`. Subdominio público `caja.unidatacenter.com.ar` apuntando al service.
- **Sidebar UNIDATA**: item `Cross > Finanzas > Caja (Flujo de Fondos)` con link externo (`target=_blank`).
- **Sync upstream**: `pwsh scripts/sync-flujo-fondos.ps1` hace `git subtree pull --squash` desde `pedroabba123/flujo-fondos:master`.
- **Auth fase 1**: sigue usando Supabase Auth original (login independiente). Coordinar con Pedro si pasamos a bridge JWT.
- **DB**: migrar a Supabase de UNIDATA en schema `flujo_fondos` (decisión 2026-05-21). Pedro mantiene control del schema vía sus migraciones Drizzle.

## Stack vendorizado (no tocar)

| Capa | Tech |
|------|------|
| Framework | Next.js 16.2.6 (App Router) — `AGENTS.md` upstream advierte que tiene breaking changes vs Next 14/15 |
| Lenguaje | TypeScript 5 strict |
| UI | Tailwind v4 · `@base-ui/react` (NO Radix) · shadcn registry custom |
| Forms | `react-hook-form` + `zod` |
| Gráficos | `recharts` 3.x |
| Tablas | `@tanstack/react-table` |
| Auth | Supabase Auth (`@supabase/ssr`, `@supabase/supabase-js`) |
| DB | Postgres (hoy Supabase, pasar a Supabase de UNIDATA schema `flujo_fondos`) |
| ORM | Drizzle ORM 0.45 + driver `postgres-js` 3.4 (`prepare: false` por pooler) |
| Migraciones | `drizzle-kit` 0.31 (`npm run db:migrate`) |
| Excel | `xlsx` (SheetJS) |
| Iconos | `lucide-react` |

Detalle completo en [`services/flujo-fondos/docs/HANDOFF.md`](../services/flujo-fondos/docs/HANDOFF.md).

## Workflow de sync con upstream

### Operación normal — ver qué hay nuevo en upstream

```powershell
pwsh scripts/sync-flujo-fondos.ps1 -DryRun
```

Lista los últimos 20 commits del `master` de Pedro y, si encuentra el commit del último squash en el historial local, también lista solo los commits nuevos desde ese punto.

### Aplicar el sync

```powershell
# Desde una branch dedicada (no main)
git checkout -b chore/sync-flujo-fondos-$(Get-Date -Format yyyy-MM-dd)
pwsh scripts/sync-flujo-fondos.ps1
```

El script:
1. Verifica que `flujo-fondos-upstream` remote exista (lo agrega si falta).
2. `git fetch flujo-fondos-upstream master`.
3. Verifica que el working tree esté limpio.
4. `git subtree pull --prefix=services/flujo-fondos flujo-fondos-upstream master --squash`.
5. Imprime los próximos pasos (revisar diff, validar build, deploy).

Si hay conflictos (ej. alguien editó archivos del subtree localmente — NO recomendado), git los reporta y hay que resolverlos a mano antes de commitear.

### Regla de oro: NO tocar `services/flujo-fondos/` localmente

Toda customización va en archivos hermanos del repo unidata-pro:
- Item del sidebar → `frontend/components/sidebar.tsx`
- Documentación → `docs/FLUJO_FONDOS_INTEGRATION.md`
- Script de sync → `scripts/sync-flujo-fondos.ps1`
- (Futuro) DB schema migration script → `scripts/...`

Si necesitás un cambio dentro de `services/flujo-fondos/` (ej. bridge JWT, fix de bug), abrí PR contra el upstream de Pedro y esperá que mergee. Editar el subtree local crea conflictos en el próximo sync.

## Pasos manuales pendientes (NO automatizables por Claude)

### 1. DB — migración a Supabase de UNIDATA (schema `flujo_fondos`)

Requiere:
- `pg_dump` de la DB actual de flujo-fondos (Pedro tiene el `DIRECT_URL` con password).
- Crear schema `flujo_fondos` en el Supabase de UNIDATA.
- `psql ... < dump.sql` apuntando al schema nuevo.
- Generar nuevas env vars `DATABASE_URL` (transaction pooler 6543) y `DIRECT_URL` (5432) del Supabase UNIDATA con `?options=search_path=flujo_fondos` (o `currentSchema=flujo_fondos`).
- Validar que `npm run db:migrate` no rompa contra la base ya migrada (idealmente la dejamos sin pending migrations).

### 2. Railway — crear service `flujo-fondos`

Desde dashboard de Railway:
1. Settings → Source → Root directory: `services/flujo-fondos`
2. Build command: `npm install && npm run build`
3. Start command: `npm run start`
4. Env vars (todas obligatorias):
   - `DATABASE_URL` (pooler 6543, `prepare: false`)
   - `DIRECT_URL` (directo 5432, solo para drizzle-kit)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`

Setear con:
```bash
railway variables --service flujo-fondos \
  --set "DATABASE_URL=postgres://..." \
  --set "DIRECT_URL=postgres://..." \
  --set "NEXT_PUBLIC_SUPABASE_URL=https://..." \
  --set "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ..." \
  --set "SUPABASE_SECRET_KEY=eyJ..." \
  --skip-deploys
railway redeploy --service flujo-fondos --yes
```

### 3. DNS — subdominio `caja.unidatacenter.com.ar`

1. Railway → service `flujo-fondos` → Settings → Networking → Custom Domain → agregar `caja.unidatacenter.com.ar`.
2. Railway devuelve un CNAME target (`<random>.up.railway.app`).
3. Cloudflare DNS de `unidatacenter.com.ar`: agregar registro **CNAME** `caja` → `<railway target>` con **proxy OFF** (DNS only) para que Railway emita el cert.
4. Esperar 2-5 min y verificar `curl -I https://caja.unidatacenter.com.ar` → 200 o 30x al login de Supabase.

### 4. Coordinación con Pedro

Notificarle por email/Slack/Jira:
- UNIDATA absorbió flujo-fondos en `services/flujo-fondos/` vía `git subtree --squash`.
- El repo upstream sigue siendo la source of truth. UNIDATA hará `git subtree pull` periódicamente.
- Si Pedro va a hacer cambios al sistema de auth (Supabase → otro), avisar primero para sincronizar el bridge JWT que UNIDATA piense hacer en fase 2.
- La DB pasó al Supabase de UNIDATA (si seguimos el plan). Pedro mantiene Drizzle como source of truth del schema, pero las migraciones se aplican apuntando al Supabase UNIDATA.

## Sidebar UNIDATA

Item agregado en `frontend/components/sidebar.tsx` bajo el grupo `Cross > Finanzas`:

```tsx
{
  label: "Caja (Flujo de Fondos)",
  href: "https://caja.unidatacenter.com.ar",
  icon: PiggyBank,
  external: true,
},
```

El renderer del sidebar detecta `external: true` y usa `<a target="_blank" rel="noreferrer">` en lugar de `<Link>`.

## Fase 2 (futuro) — Bridge auth

Cuando IT decida unificar el login:
- Opción 1: cookie cross-subdomain (`Domain=.unidatacenter.com.ar`) que la sub-app lee como JWT en su middleware.
- Opción 2: refactor del auth de la sub-app (`src/lib/supabase/*`) reemplazándolo por un cliente que valida el JWT HS256 de UNIDATA.

Coordinar con Pedro antes de implementar — el cambio toca el subtree y conflicta con sus commits si no se sincroniza.

## Anti-patterns (NO HACER)

- ❌ Editar archivos dentro de `services/flujo-fondos/` directamente — rompe el sync.
- ❌ Hacer un `git subtree pull` sin squash — importa miles de commits ajenos.
- ❌ Levantar el service Railway desde `frontend/` o `backend/` — el subtree debe vivir en `services/`.
- ❌ Reescribir páginas de flujo-fondos al stack UNIDATA (FastAPI + Next.js + Tailwind tokens UNIDATA) — destruye el sync y duplica trabajo cada vez que Pedro mergea algo.
- ❌ Hardcodear el subdominio en código — usar `process.env.NEXT_PUBLIC_FLUJO_FONDOS_URL` si llega a necesitarse desde otros lugares.

## Referencias

- Skill: `~/.claude/skills/port-to-unidata/SKILL.md` (sección "Paso 4b — Ejecutar Modo B")
- Repo upstream: https://github.com/pedroabba123/flujo-fondos
- Doc upstream (handoff a IT): [`services/flujo-fondos/docs/HANDOFF.md`](../services/flujo-fondos/docs/HANDOFF.md)
- Doc upstream (estado proyecto): [`services/flujo-fondos/docs/REPORTE_ESTADO.md`](../services/flujo-fondos/docs/REPORTE_ESTADO.md)
