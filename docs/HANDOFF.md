# Handoff a equipo IT — Flujo de Fondos

Este documento es la guía completa para que el equipo de IT pueda hacerse cargo
del proyecto **flujo-fondos** (también llamado "Simulador de Flujo de Fondos" en
la UI). Está pensado para ser leído sin haber participado del desarrollo previo.

**Owner del negocio (contacto único)**: Pedro Abbiati — `pedro.abbiati@unistore.ar`

**Repo**: https://github.com/pedroabba123/flujo-fondos
**Branch principal**: `master`
**Producción actual**: https://flujo-fondos.vercel.app (hosting Vercel, región `gru1` São Paulo)

---

## 1. Qué es la aplicación

ERP web de **flujo de fondos** para un grupo económico argentino con:
- 4 razones sociales (FOX ELECTRONICS, TABB IMPORTS, UNISTORE, TOMAS ABBIATI)
  que comparten una sola tesorería.
- 3 unidades de negocio: Unistore Mayorista, Mercado Libre, Unidrop.
- 5 bancos/medios de pago: CREDICOOP, SUPERVIELLE, NACIÓN, MERCADO PAGO,
  "CUALQUIERA" (comodín a eliminar).

**Pregunta central que responde**:
> "Si hoy tengo $X en caja, ¿cómo evoluciona el saldo en los próximos N días
> considerando lo que tengo que pagar y lo que históricamente facturo cada
> día de la semana?"

**Funcionalidades clave**:
- Carga de erogaciones (pagos pendientes) y facturación real.
- Proyección de saldo día a día por hasta 90 días.
- Calendario de caja mensual.
- Pagos atrasados con sugerencia automática de re-fecha.
- Escenarios "what-if" con ocultar/mostrar erogaciones sin destruirlas.
- Importadores masivos desde Excel (plantillas para erogaciones, facturación,
  ingresos puntuales).
- KPIs en el home (top proveedores pendientes, distribución de gastos, etc.).

---

## 2. Stack técnico

| Capa | Tecnología | Notas |
|---|---|---|
| Framework | **Next.js 16.2.6** (App Router) | Atención: tiene breaking changes vs Next 14/15 — leer `AGENTS.md` |
| Lenguaje | TypeScript 5 estricto | `tsconfig.json` con `strict: true` |
| Frontend | React 19.2.4 | Server components por defecto |
| Estilos | Tailwind CSS v4 + `tw-animate-css` | `@tailwindcss/postcss` |
| UI primitives | `@base-ui/react` (no Radix), shadcn registry custom | Cuidado: muchas instancias de `Menu` crashean el browser, ver §9 |
| Forms | `react-hook-form` + `zod` (resolvers en `@hookform/resolvers`) | Validación isomorfica |
| Gráficos | `recharts` 3.x | Recharts no resuelve `oklch(var(--X))` en SVG, usar hex |
| Tablas | `@tanstack/react-table` | |
| Fechas | `date-fns` v4 + `date-fns/locale` (es) | Cuidado UTC vs local, ver §9 |
| Auth | **Supabase Auth** (vía `@supabase/ssr` y `@supabase/supabase-js`) | Única dependencia externa real |
| DB | **Postgres** (hoy en Supabase) | Compatible con Postgres standard ≥14 |
| ORM | **Drizzle ORM** 0.45 + driver `postgres-js` 3.4 | `prepare: false` obligatorio para pooler |
| Migraciones | `drizzle-kit` 0.31 | `npm run db:generate`, `db:migrate`, `db:push`, `db:studio` |
| Excel | `xlsx` (SheetJS) 0.18 | Lectura/escritura de plantillas |
| Iconos | `lucide-react` | |
| Toast / notificaciones | `sonner` | |
| Linter | ESLint 9 + `eslint-config-next` | `npm run lint` |
| Hosting actual | Vercel | Región `gru1` (São Paulo) |

**Dependencias externas en runtime**:
1. **Supabase Auth** (login con email/password). Es lo único que ata el
   proyecto a Supabase como servicio. Ver §11 para opciones de reemplazo.
2. **Supabase Postgres**. Es Postgres puro; se puede mover a cualquier
   instancia que IT levante.

---

## 3. Estructura del proyecto

```
src/
├── app/
│   ├── (app)/                # Rutas autenticadas (layout chequea sesion)
│   │   ├── layout.tsx        # Sidebar + verificacion de sesion via Supabase
│   │   ├── page.tsx          # Home / dashboard con KPIs y graficos
│   │   ├── erogaciones/      # Pagos a realizar (CRUD + bulk + filtros)
│   │   ├── pagos-atrasados/  # Re-programacion sugerida de pagos vencidos
│   │   ├── ingresos-puntuales/ # Plata extraordinaria (prestamos, cheques, etc.)
│   │   ├── recurrencias/     # Pagos recurrentes (alquiler, sueldos, etc.)
│   │   ├── acuerdos/         # Acuerdos con proveedores
│   │   ├── calendario/       # Vista mensual de caja
│   │   ├── saldos/           # Carga de saldos iniciales por banco
│   │   ├── proyeccion/       # Proyeccion de saldo dia a dia (motor central)
│   │   ├── facturacion/      # Carga manual de facturacion diaria
│   │   ├── promedios/        # Visualizacion de promedios ponderados por DOW
│   │   ├── analisis/         # Analisis agregado de gastos por categoria/empresa
│   │   ├── precision/        # Comparacion real vs proyectado (calibracion)
│   │   ├── sugerencias/      # Detector automatico de patrones (recurrencias)
│   │   ├── empresas/         # Maestro de empresas (4 razones sociales)
│   │   ├── unidades-negocio/ # Maestro de unidades (3 canales)
│   │   ├── bancos/           # Maestro de bancos/medios de pago
│   │   ├── proveedores/      # Maestro de proveedores
│   │   ├── importar/         # Carga masiva desde plantillas Excel
│   │   └── home-*.tsx        # Componentes del dashboard del home
│   ├── (presentacion)/       # Landing publica /presentacion
│   ├── login/                # Login con email+password (Supabase Auth)
│   ├── api/                  # API routes (POST handlers para parsers Excel,
│   │                         # y GET endpoints para descargar plantillas)
│   ├── layout.tsx            # Layout root (theme provider)
│   └── globals.css           # Tailwind v4 base + tokens de design
├── components/
│   ├── app-sidebar.tsx       # Sidebar principal con navegacion
│   ├── command-palette.tsx   # Cmd+K busqueda global
│   ├── theme-provider.tsx    # next-themes
│   ├── theme-toggle.tsx
│   └── ui/                   # Componentes shadcn (Button, Card, Dialog, etc.)
├── db/
│   ├── index.ts              # Cliente Drizzle (postgres-js + prepare:false)
│   └── schema/               # Tablas Drizzle (1 archivo por entidad)
│       ├── index.ts          # Re-exporta todas
│       ├── empresas.ts
│       ├── unidades-negocio.ts
│       ├── bancos.ts
│       ├── proveedores.ts
│       ├── erogaciones.ts    # La tabla central
│       ├── facturacion-diaria.ts
│       ├── saldos-iniciales.ts
│       ├── ingresos-puntuales.ts
│       ├── recurrencias.ts
│       ├── acuerdos.ts
│       ├── perfiles.ts       # Datos de usuario (linkea con auth.users)
│       └── enums.ts
└── lib/
    ├── proyeccion.ts         # Funciones compartidas de proyeccion
    ├── pagos-atrasados.ts    # Algoritmo de sugerencia de re-fechas
    ├── detectar-patrones.ts  # Detector de recurrencias automaticas
    ├── busqueda-global.ts    # Cmd+K
    ├── supabase/             # Clientes Supabase (server / browser / middleware)
    └── utils.ts              # cn() helper de Tailwind
```

```
drizzle/                       # Migraciones generadas (0000-0010)
docs/
├── REPORTE_ESTADO.md          # Auditoría de estado del proyecto (mayo 2026)
└── HANDOFF.md                 # Este archivo
```

```
package.json, drizzle.config.ts, tsconfig.json, next.config.ts,
postcss.config.mjs, eslint.config.mjs, components.json (shadcn)
```

---

## 4. Variables de entorno

Crear `.env.local` (NO commitear) con:

| Variable | Para qué | Cómo se obtiene |
|---|---|---|
| `DATABASE_URL` | Conexión runtime (queries de la app) | Pooler de Postgres puerto 6543 con `prepare: false`. En Supabase: Settings → Database → Connection string → Transaction pooler |
| `DIRECT_URL` | Conexión directa para `drizzle-kit` (migraciones) | Conexión directa puerto 5432 (no pooler). drizzle-kit NO funciona con el pooler |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase (cliente browser) | Supabase: Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Anon key pública (cliente browser) | Supabase: Project Settings → API → `anon public` |
| `SUPABASE_SECRET_KEY` | Service role key (SERVER ONLY, ignora RLS) | Supabase: Project Settings → API → `service_role`. **NUNCA exponer al cliente** |

**Si se reemplaza Supabase Auth** (escenario B en §11), las tres variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y
`SUPABASE_SECRET_KEY` desaparecen y se reemplazan por las del nuevo proveedor
de auth.

---

## 5. Setup local

```bash
# 1. Clonar
git clone https://github.com/pedroabba123/flujo-fondos.git
cd flujo-fondos

# 2. Instalar
npm install

# 3. Crear .env.local con las variables del §4

# 4. Aplicar migraciones a tu base de datos
npm run db:migrate

# 5. Levantar dev server
npm run dev
# http://localhost:3000

# 6. (Opcional) Inspeccionar DB con drizzle studio
npm run db:studio
```

Comandos del `package.json`:
- `npm run dev` — dev server
- `npm run build` — build producción
- `npm run start` — start producción
- `npm run lint` — ESLint
- `npm run db:generate` — genera nueva migración a partir de cambios en schema
- `npm run db:migrate` — aplica migraciones pendientes a la DB apuntada por `DIRECT_URL`
- `npm run db:push` — push directo del schema sin migración (solo dev)
- `npm run db:studio` — Drizzle Studio GUI

---

## 6. Base de datos

**Motor**: Postgres ≥ 14 (probado en Supabase Postgres 15).

**Tablas principales** (con sus archivos de schema):
- `empresas` — 4 razones sociales
- `unidades_negocio` — 3 canales de facturación
- `bancos_medios_pago` — 5 bancos + 1 virtual ("Total consolidado")
- `proveedores` — maestro de proveedores
- `erogaciones` — **tabla central**. Cada pago/gasto. Incluye flags
  `prioridad_atraso`, `fecha_sugerida_tentativa`, `oculto`
- `facturacion_diaria` — facturación real cargada por día × unidad de negocio
- `saldos_iniciales` — saldos diarios por banco (input del usuario)
- `ingresos_puntuales` — entradas extraordinarias (préstamos, cheques)
- `recurrencias` — definiciones de pagos recurrentes
- `acuerdos` — acuerdos comerciales con proveedores
- `perfiles` — datos de usuario, link 1-a-1 con `auth.users` de Supabase

**RLS (Row Level Security)**: todas las tablas tienen RLS habilitada con una
policy abierta para `authenticated`:
```sql
CREATE POLICY "Usuarios autenticados acceso total"
  ON <tabla> FOR ALL TO authenticated USING (true) WITH CHECK (true);
```
Es decir, **cualquier usuario logueado puede leer/escribir todo**. No hay
multi-tenancy. Si IT necesita aislar usuarios o empresas, hay que rediseñar
estas policies.

**Migraciones**: están versionadas en `/drizzle/0000_*.sql` a `/drizzle/0010_*.sql`.
Para aplicar:
```bash
npm run db:migrate
```
Para generar una nueva tras cambiar `src/db/schema/`:
```bash
npm run db:generate
# luego revisar el archivo SQL generado y ajustar si hace falta
npm run db:migrate
```

---

## 7. Auth (lo importante)

**Hoy**: Supabase Auth con email + password. El layout `src/app/(app)/layout.tsx`
verifica sesión en cada request (server component) y redirige a `/login` si
no hay user.

**Flujo**:
1. Usuario va a `/login` y se autentica.
2. Supabase devuelve cookies HttpOnly que persisten la sesión.
3. Cada request al `(app)` layout hace `supabase.auth.getUser()` server-side.
4. Si hay user, carga el perfil de la tabla `perfiles` y renderiza el sidebar.
5. RLS en Postgres se activa con esa sesión vía conexión con cookie/JWT.

**Clientes Supabase**:
- `src/lib/supabase/server.ts` — para server components / actions (lee cookies)
- `src/lib/supabase/browser.ts` — para client components
- `src/lib/supabase/middleware.ts` — para refresh de cookies en middleware
- `src/proxy.ts` — middleware de Next que llama al refresh

---

## 8. Deploy actual

**Hosting**: Vercel proyecto `flujo-fondos`, conectado al repo GitHub.
- Region: `gru1` (São Paulo) — misma región que Supabase para minimizar latencia.
- Auto-deploy en cada push a `master`.
- Env vars cargadas en Vercel → Settings → Environment Variables.

**Para hacer un deploy manual**:
- Vercel → Deployments → último → "Redeploy".

**DB hosting**: Supabase free tier, proyecto `pedroabba123's Project`,
región sa-east-1 (São Paulo).

---

## 9. Decisiones técnicas / trampas conocidas

Estas las aprendimos a los golpes durante el desarrollo. Documentar es
crítico porque no son obvias:

1. **Pooler vs conexión directa de Postgres**:
   - `DATABASE_URL` debe apuntar al **transaction pooler** (puerto 6543) para
     que la app serverless tenga buena latencia.
   - `DIRECT_URL` debe apuntar a la **conexión directa** (puerto 5432) porque
     `drizzle-kit` no funciona con el pooler.
   - El cliente `postgres-js` está configurado con `prepare: false` (obligatorio
     para el pooler).

2. **UTC vs hora local**:
   - `new Date().toISOString().slice(0,10)` devuelve fecha **UTC**, no local.
     En Argentina (UTC-3), de tarde/noche eso da el día siguiente.
   - Para fechas relativas a "hoy" / "ayer" SIEMPRE usar la función `hoyISO()`
     de `src/app/(app)/erogaciones/utils.ts` (calcula con `getFullYear`/`getMonth`/`getDate`).
   - Hubo bugs reales por esto en filtros y KPIs.

3. **`@base-ui/react` y muchos Menus**:
   - Renderizar muchas instancias de `DropdownMenu` (uno por fila × 327 filas)
     **crashea el navegador**. Por eso /erogaciones está paginado a 50 filas y
     usa `<select>` nativo en lugar de menus en algunos lugares.

4. **Recharts y CSS variables OKLCH**:
   - Recharts no resuelve `stroke="oklch(var(--success))"` dentro de SVG.
     Usar hex literales (`#16a34a`, `#f59e0b`, etc.) en `stroke`/`fill`.
   - Para que las líneas se vean bien: `connectNulls={true}` + `dot={{ r: 2.5, ... }}` visible.

5. **Drizzle y arrays**:
   - `sql\`... = ANY(${array})\`` se expande como tupla, NO como array binding.
     Usar `inArray(column, array)` en lugar.

6. **Server actions y archivos grandes**:
   - Los server actions de Next 16 devuelven respuestas raras con archivos
     > ~1 MB en Vercel ("An unexpected response was received from the server").
   - Por eso TODOS los parsers de plantillas Excel pasaron de server actions
     a **API routes** (`src/app/api/parsear-*`, `src/app/api/aplicar-*`).
     Patrón replicable si aparece otro archivo grande.

7. **Doble cómputo de `calcularProyeccionTodas`**:
   - El home llamaba esa función 2 veces en el mismo render. Está memoizada
     con `React.cache()` por fecha ISO (en `src/lib/proyeccion.ts`). No mover
     a otro patrón sin saber qué se pierde.

8. **`force-dynamic` en todas las páginas**:
   - Cada página de `(app)/*` tiene `export const dynamic = 'force-dynamic'`
     para que los datos siempre estén frescos. Esto desactiva todo cache de
     Next. Si IT quiere optimizar, hay que pasar a `revalidate = N` o
     usar `revalidatePath`/`revalidateTag` selectivos.

9. **Diferimiento de Unistore Mayorista**:
   - Lo facturado el día X se cobra el día X+1 (es así por como funciona el
     canal). El shift está hardcodeado en `DIFERIMIENTO_POR_UNIDAD` en
     `src/app/(app)/promedios/calcular.ts`. Si aparecen más unidades con
     diferimientos, agregarlos ahí.

10. **Banco virtual "Total consolidado"**:
    - Hay un registro en `bancos_medios_pago` con nombre "Total consolidado"
      que NO es un banco real. Se usa para que el usuario cargue un saldo
      total sin tener que desagregar por banco. Está filtrado de listados
      con `ne(bancosMediosPago.nombre, BANCO_CONSOLIDADO_NOMBRE)`.

11. **Configuración local de git**:
    - El repo tiene config LOCAL (no global) para `user.email`. No tocar la
      config global de git en la máquina si el handoff sigue usando esta
      misma checkout.

12. **Conventions de idioma**:
    - Todo el código y la UI están en español argentino (es-AR).
    - Moneda ARS formato `$ 1.234.567,89`. Fechas `DD/MM/YYYY`.
    - Concepto de negocio: "estreñimiento del flujo" = caja se contrae bajo
      umbrales saludables. Acuñado por el dueño, usar la frase si aplica.

---

## 10. Funcionalidades — qué hace cada pantalla

| Ruta | Qué hace |
|---|---|
| `/` (home) | Dashboard con: KPIs (setup completo, pendiente, en curso, pagado, atrasadas, próximas), gráfico de proyección 30d (mini), gráfico de tendencia de facturación 60d con bache marcado, top 5 proveedores pendientes, distribución de gastos del mes |
| `/erogaciones` | CRUD completo de pagos. Filtros por estado, empresa, banco, proveedor, fechas, búsqueda libre. Acciones bulk (marcar pagado/en_curso, cambiar fecha, ocultar de proyección, borrar). Importación masiva por Excel. Exportación CSV. Cmd+K |
| `/pagos-atrasados` | Lista de pendientes con fecha_pago vencida. Cada uno tiene prioridad "normal" o "laxo". Sistema sugiere primer día viable para re-programar (manteniendo saldo > colchón configurable). Sugerencias se aplican como **tentativas** (no destructivo). Confirmar copia a fecha_pago real; Cancelar revierte |
| `/ingresos-puntuales` | Plata extraordinaria que entra (cobros de cheques, préstamos, devoluciones, etc.). NO contamina los promedios de facturación |
| `/recurrencias` | Definiciones de pagos recurrentes (alquiler, sueldos). Generan erogaciones automáticamente |
| `/acuerdos` | Acuerdos con proveedores |
| `/calendario` | Vista mensual de caja. Cada día muestra ingresos proyectados, egresos comprometidos, neto, alerta de tentativas. Detalle del día en sheet lateral |
| `/saldos` | Saldos iniciales por banco. Card destacado para "Saldo total de hoy" (banco virtual consolidado) |
| `/proyeccion` | Motor central: proyección día a día por hasta 90 días con horizonte configurable. Gráfico de área + tabla. Saldo manual override. Umbral de "estreñimiento" configurable. Descarga CSV del detalle |
| `/facturacion` | Carga manual diaria + gráfico de línea. Diferenciación entre real y proyectado |
| `/promedios` | Visualización de los promedios ponderados por día de semana × unidad de negocio |
| `/analisis` | Agregados de gastos por categoría / empresa / período |
| `/precision` | Comparación entre lo proyectado y lo real para calibrar el modelo |
| `/sugerencias` | Detector automático de patrones: identifica candidatos a recurrencia entre las erogaciones cargadas |
| `/empresas`, `/unidades-negocio`, `/bancos`, `/proveedores` | Maestros (CRUD) |
| `/importar` | Carga masiva: 4 tabs (Plantilla erogaciones, Plantilla ingresos puntuales, Plantilla facturación, Excel del simulador legacy) |

---

## 11. Opciones de hosting on-premise

### Opción A — Mismo stack, hosting híbrido (recomendado para empezar)

IT levanta **Postgres + Next.js** en el data center, pero **Supabase Auth se queda**.

**Ventajas**:
- Cambio mínimo: el código de auth no se toca.
- Supabase Auth es gratis y muy estable.
- IT controla los datos sensibles (la DB) y el código.

**Pasos**:
1. Levantar Postgres ≥ 14 en el data center.
2. Importar el dump de la DB de Supabase (ver §12).
3. Configurar Next.js como proceso (PM2, Docker, systemd, lo que prefieran):
   - Build: `npm run build`
   - Start: `npm run start` (default port 3000)
   - Recomendado: detrás de un reverse proxy (nginx, Caddy) con TLS.
4. Configurar env vars con los nuevos `DATABASE_URL` y `DIRECT_URL`
   (apuntando a su Postgres) y dejar las `NEXT_PUBLIC_SUPABASE_*` y
   `SUPABASE_SECRET_KEY` apuntando al mismo Supabase de antes.
5. RLS: las policies actuales son abiertas para `authenticated`. Si IT quiere
   multi-tenancy o aislamiento por usuario, hay que rediseñarlas.
6. Importante: Supabase Auth y el Postgres on-prem son ahora dos servicios
   distintos. La validación de RLS server-side ya funciona porque la app usa
   `SUPABASE_SECRET_KEY` para conectar a la DB (ignora RLS), pero si quieren
   habilitar RLS real con JWT de Supabase apuntando a otro Postgres es
   bastante setup adicional.

### Opción B — Todo on-premise (sin Supabase para nada)

IT levanta Postgres + Next.js + un nuevo sistema de auth.

**Ventajas**:
- Cero dependencias externas.
- Soberanía total sobre los datos.

**Costos**:
- Reemplazar Supabase Auth requiere refactor del código de:
  - `src/lib/supabase/*` (clientes server/browser/middleware)
  - `src/app/login/` (formulario y action de login)
  - `src/app/(app)/layout.tsx` (verificación de sesión)
  - `src/proxy.ts` (middleware de refresh)
  - Tabla `perfiles` (hoy linkea con `auth.users` de Supabase)

**Opciones de reemplazo de auth**:
1. **Auth.js (NextAuth v5)** — librería de auth open-source para Next.js.
   Es el reemplazo más natural. Soporta múltiples proveedores.
2. **Lucia Auth** — más liviana, control total.
3. **Keycloak / Authentik** — solución dedicada de auth on-premise, con SSO.
   Más pesado pero enterprise-ready.
4. **JWT custom** — implementación propia. Más simple si el alcance es chico.

**Pasos sugeridos**:
1. Levantar Postgres en el data center.
2. Migrar la data (dump + restore, ver §12).
3. Crear una tabla `usuarios` propia (o adaptar `perfiles`) que no dependa de
   `auth.users`.
4. Refactorizar los archivos del bullet anterior usando Auth.js (o lo que
   elijan).
5. Configurar env vars sin las de Supabase, agregar las del nuevo sistema.

Estimación de esfuerzo: dependiendo de la solución elegida y la familiaridad
del equipo, entre 1 y 3 semanas de un dev senior para migrar y testear.

---

## 12. Migración de datos

### Exportar desde Supabase

**Opción 1 — Via Supabase UI**:
1. Supabase Dashboard → Project Settings → Database → Backups.
2. "Download" en el último backup automático.

**Opción 2 — Via `pg_dump`** (recomendada para IT):
```bash
pg_dump "DIRECT_URL_CON_PASSWORD" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file=flujo-fondos-backup.sql
```

Esto exporta:
- Todas las tablas del schema `public`
- Sus datos
- Constraints, índices, defaults
- Las policies de RLS

**No exporta** (es por diseño):
- Usuarios del schema `auth` (si migran a Auth.js van a crear sus propios usuarios igual)
- El schema `storage` (no se usa)

### Importar a Postgres on-prem

```bash
psql "postgres://usuario@host:5432/flujo_fondos" < flujo-fondos-backup.sql
```

### Si quieren mantener los usuarios de Supabase Auth

En el escenario A (Auth se queda en Supabase) **no se migran**. Siguen
apuntando al mismo Supabase Auth de siempre.

En el escenario B (todo on-prem) hay que exportar manualmente la tabla
`auth.users` de Supabase (ver docs de Supabase) y mapear los UUID a la
nueva tabla de usuarios del sistema elegido. El campo `perfiles.id` es un
UUID que hace match con `auth.users.id` — si cambian el sistema de auth,
tienen que decidir si mantienen los UUID o regeneran.

---

## 13. Plantillas Excel

El sistema acepta 4 tipos de imports masivos, todos vía `/importar`:
- **Plantilla erogaciones** (`/api/plantilla-erogaciones`)
- **Plantilla facturación** (`/api/plantilla-facturacion`)
- **Plantilla ingresos puntuales** (`/api/plantilla-ingresos-puntuales`)
- **Excel del simulador legacy** (con hojas Proveedores / Gastos / Facturación)

Cada uno tiene su par de endpoints: `/api/parsear-*` (preview con validación)
y `/api/aplicar-*` (insert masivo en DB con detección de duplicados via
`inArray()`).

---

## 14. Checklist final de handoff

Antes de dar por cerrado el handoff, IT debería:

- [ ] Tener acceso al repo GitHub (`pedroabba123/flujo-fondos`)
- [ ] Tener el dump de la DB de Supabase
- [ ] Tener los **valores reales** de las env vars (transferidos por canal
      seguro, NO por chat ni email)
- [ ] Haber decidido escenario A o B (§11)
- [ ] Haber levantado un entorno de staging y validado:
  - Login funciona
  - Las queries del home cargan
  - La proyección calcula bien (comparar con producción actual)
  - Los importadores Excel funcionan
  - Las migraciones aplican sin error
- [ ] Tener un plan de monitoreo / alertas (la app no tiene observability
      built-in más allá de los logs de Vercel hoy)
- [ ] Tener un plan de backups recurrentes de la nueva DB

---

## 15. Preguntas frecuentes que pueden surgir

**¿Por qué Next.js 16 si recién salió?**
Decisión deliberada al inicio del proyecto. Implica leer `node_modules/next/dist/docs/`
o la doc oficial antes de tocar routing, layouts, server components, fetching —
los patrones de Next 14/15 NO aplican necesariamente.

**¿Por qué `@base-ui/react` y no Radix?**
Shadcn registry custom configurado al inicio. Funciona bien para casi todo,
pero `Menu` tiene un bug de performance con muchas instancias (ver §9).

**¿Hay tests?**
No. El proyecto es muy chico y de un solo usuario; los tests no se priorizaron.
Si IT quiere agregarlos, recomendado Vitest + Playwright.

**¿Hay multi-idioma?**
No. Todo es es-AR. Si necesitan i18n, hay que agregar `next-intl` o similar.

**¿Hay multi-tenant?**
No. Toda la data es de un solo grupo económico. Las policies de RLS son
abiertas. Si necesitan multi-tenant, requiere rediseño de schema + policies.

**¿La app maneja monedas múltiples?**
Casi. La tabla `erogaciones` tiene campo `moneda` y `tipo_cambio` pero la UI
asume ARS. Si necesitan USD u otra, hay que refactorizar formateadores y
proyecciones.

---

**Última actualización del documento**: 2026-05-20
**Generado durante**: handoff inicial del proyecto a equipo IT.
