# Reporte de estado del proyecto — Flujo de Fondos

> ERP web de flujo de fondos para un grupo económico argentino (4 razones sociales / 3 unidades de negocio / 5 bancos). Migración de un simulador Excel preexistente. El objetivo del modelo es proyectar el saldo de caja día a día detectando "estreñimiento del flujo" (días bajo umbral saludable).

Fecha del reporte: 2026-05-14. Branch: `master`. Última commit: `6deb4b1`.

---

## 1. Pantallas y rutas

### Aplicación protegida (`/(app)/*`) — requieren login

| Ruta | Propósito | Notas |
|---|---|---|
| `/` | **Inicio (Dashboard)**. Banner de "procesar hoy / setup", KPIs de operación (Pendiente / En curso / Pagado / Atrasadas), gráfico de facturación real vs proyectada con tabs por unidad y consolidado, mini-gráfico de proyección 30d con primer día de atasco, top 5 proveedores pendientes con barras, donut de distribución de gastos del mes, acuerdos urgentes, KPIs de datos maestros. | Server component con 6 funciones de query en paralelo (`Promise.all`). Página pesada en queries. |
| `/erogaciones` | **Inbox de erogaciones**. Listado filtrable por estado (pendiente / en_curso / pagado / cancelado / rechazado), empresa, banco, proveedor, rango de fechas. Chips de vistas predefinidas (Atrasadas / Hoy / Próx 7d / Próx 30d). Acciones por fila: editar (✏️), borrar (🗑️), cambiar estado (dropdown). Botón "Importar Excel" → /importar. Export CSV con BOM UTF-8. | Tabla server-rendered con paginación cliente. Click en fila abre sheet de detalle. |
| `/ingresos-puntuales` | **CRUD de ingresos puntuales** (cobros de cheques, préstamos, devoluciones, aportes de socios, venta de activos, otros). Tabla con buscador, KPIs (total registrado / total a futuro), dialog para crear/editar. Vinculado a empresa y opcionalmente banco. | Tabla separada `ingresos_puntuales` (no se mezcla con facturación recurrente). |
| `/recurrencias` | Gastos recurrentes (alquiler, sueldos, servicios) con frecuencia y cuotas. Genera erogaciones automáticas a futuro. | Mensual / semanal / quincenal / trimestral / anual / custom. |
| `/acuerdos` | Promesas a proveedores con ciclo de vida (pendiente → cumplido / incumplido). Filtros por estado, tipo, proveedor. KPIs consolidados. | Tipo: diferimiento / pago_parcial / plan_cuotas / otro. |
| `/calendario` | **Calendario de caja mensual**. Grilla 7×6 con heatmap por neto del día (verde = positivo, rojo = negativo). Cada celda muestra ingreso proyectado, egreso comprometido, neto, contador de pagos/ingresos puntuales, indicador azul si hay ingreso puntual. Click en día abre sheet con detalle: ingresos proyectados por unidad, ingresos puntuales, erogaciones, saldo proyectado al cierre. Selector de mes + filtro por empresa. | Considera tanto facturación promedio + ingresos puntuales del día. |
| `/saldos` | **Saldos iniciales** de cada banco + card de "Saldo total de hoy" (banco virtual "Total consolidado"). Tabla por banco con historial colapsable. KPI de saldo consolidado total = consolidado + por banco. Alerta si se combinan ambos modos (suman). | Crear/editar/borrar saldo por (banco, fecha). Unique index `(fecha, banco_id)`. |
| `/facturacion` | **Facturación diaria CRUD**. Gráfico de línea con tabs por unidad o consolidado (líneas multicolor sobrepuestas). Tabla filtrable con fecha, unidad, empresa, monto, tipo (normal / evento puntual). Crear/editar/borrar inline. Export CSV. Filtro de rango de fechas (default últimos 90 días). | Eventos puntuales se excluyen del cálculo de promedios. |
| `/proyeccion` | **Motor de proyección de saldo**. Stats strip (saldo inicial / proyectado al final / peor saldo / días en rojo). Controles: horizonte (7/15/30/60/90/180/365d), umbral de estreñimiento, saldo manual override. Gráfico de área del saldo proyectado con línea de umbral. Composición del saldo inicial por banco. Tabla detalle día por día (fecha, ingreso, egreso, saldo al cierre, estado). | Excluye erogaciones pagadas/canceladas/rechazadas del cálculo. Día 0 (hoy) no suma promedio. |
| `/promedios` | Promedios ponderados por día de semana y unidad de negocio. Filtros: ventana en semanas, decay. Muestra eventos puntuales excluidos. | Decay default 0.85. Ventana default 12 semanas. |
| `/precision` | Compara ingreso real vs proyectado con datos pasados (sin data leakage). Métrica de cuán bueno es el modelo de promedios. | Por unidad de negocio y rango configurable. |
| `/analisis` | **Análisis de gastos**. Distribución por empresa / banco / proveedor (top 15) / categoría. Serie temporal mes a mes. Filtros: período, estado. | Períodos: este mes / mes pasado / últimos 30 / 90 / 365 / todo. |
| `/sugerencias` | Detecta patrones recurrentes en erogaciones (mismo proveedor, montos similares, frecuencia regular) y sugiere convertirlos en recurrencias. | Heurístico simple. |
| `/empresas`, `/unidades-negocio`, `/bancos`, `/proveedores`, `/proveedores/[id]` | CRUDs simples de datos maestros. La ficha del proveedor muestra erogaciones, acuerdos, saldo pendiente, contacto. | Bancos filtran el banco virtual "Total consolidado" del listado. |
| `/importar` | **Importar Excel** con 4 tabs: 1) Plantilla erogaciones, 2) Plantilla ingresos puntuales, 3) Plantilla facturación, 4) Excel del simulador original (legado). Para cada uno: drag-drop o file picker, "Analizar" → preview con KPIs (total / nuevas / ya en base / con error) + errores agrupados por motivo + tabla con filtro "solo errores" → "Aplicar". | Detección de duplicados via clave (fecha + empresa + banco + monto + descripción normalizada). Server action body limit 20MB. |

### Pantallas auxiliares

| Ruta | Propósito | Notas |
|---|---|---|
| `/login` | Email + contraseña contra Supabase Auth. | Redirige a `/` si ya está logueado. |
| `/presentacion` | **Dashboard público ejecutivo** (presumiblemente para mostrar a externos sin login). Saldo inicial consolidado, sumas por estado, atrasadas, críticos próximos 7d, acuerdos vencidos, proyección 30d. | Ruta pública. ⚠️ Ver "Cosas raras" abajo. |

### API routes (`/api/*`)

| Ruta | Método | Propósito |
|---|---|---|
| `/api/health` | GET | Health check. |
| `/api/plantilla-erogaciones` | GET | Descarga Excel plantilla con ejemplos + hoja de instrucciones. |
| `/api/plantilla-facturacion` | GET | Idem para facturación. |
| `/api/plantilla-ingresos-puntuales` | GET | Idem para ingresos puntuales. |
| `/api/parsear-ingresos-puntuales` | POST | Recibe FormData con Excel, devuelve preview con filas validadas. **Migrada de server action a API route** por problemas de bundling. |
| `/api/aplicar-ingresos-puntuales` | POST | Recibe JSON con filas, inserta en la base. **Migrada de server action a API route**. |

---

## 2. Spec original vs implementado

La spec original tenía 15 secciones y un **roadmap en 5 fases (F0-F5)**:

### Fase 0 — Cimientos ✅ COMPLETA
- [x] Stack Next.js 16 + Supabase + Drizzle
- [x] Esquema de base de datos (10 tablas + ingresos_puntuales agregada después)
- [x] Auth con roles admin/user (vía perfiles)
- [x] CRUD de entidades maestras
- [x] Inbox de erogaciones
- [x] Importar Excel (estaba en F1, se adelantó)

### Fase 1 — Paridad con Excel ✅ COMPLETA
- [x] Promedios ponderados por día de semana con decay exponencial
- [x] Calendario de caja con heatmap
- [x] Motor de proyección de saldo
- [x] Detector de "estreñimiento del flujo" (días bajo umbral)
- [x] Recurrencias

### Fase 2 — Mejoras diseñadas ✅ MAYORMENTE
- [x] Acuerdos con proveedores (diferimientos, pagos parciales)
- [x] Análisis de gastos (distribuciones)
- [x] Precisión del modelo (comparar real vs proyectado)
- [x] Plantillas Excel descargables + importer con preview/duplicados
- [x] **Ingresos puntuales** (cobros de cheques, préstamos) — entidad nueva no prevista explícitamente en spec original
- [x] **Diferimiento por unidad** (caso Unistore Mayorista: 1 día) — agregado sobre la marcha
- [ ] Saldo auto-actualizable al pagar (no implementado)
- [ ] Workflows matutino/diario/semanal/mensual/crítico documentados

### Fase 3 — Inteligencia 🟡 PARCIAL
- [x] Sugerencias automáticas (detecta patrones en erogaciones)
- [ ] Memoria de decisiones (¿por qué pagué primero a X?)
- [ ] Alertas push / email
- [ ] Simulación what-if (escenarios múltiples)

### Fase 4 — Integraciones ❌ NO INICIADA
- [ ] APIs bancarias
- [ ] Mercado Libre reportes
- [ ] Email/Slack para alertas

### Fase 5 — ML avanzado ❌ NO INICIADA
- [ ] Modelos no lineales para predicción
- [ ] Detección de anomalías

### Las 3 "fugas" del modelo Excel original
La spec mencionaba 3 problemas del Excel que debían resolverse:
1. **`sumar.si.conjunto` mal usado 4 veces** → ✅ resuelto (motor propio en TS).
2. **ML reportes incompletos** → no hay integración con ML todavía.
3. **Cancelaciones contaminando promedios** → ✅ resuelto (estados `cancelado` y `rechazado` se filtran; eventos puntuales también).

---

## 3. Decisiones técnicas tomadas sobre la marcha (NO en spec original)

### Modelado de datos
1. **Tabla separada `ingresos_puntuales`** en lugar de meterlo todo en `facturacion_diaria` o como erogación negativa. Justificación: no contaminar el promedio ponderado.
2. **Banco virtual "Total consolidado"** para permitir cargar un saldo único sin desglose por banco. Hack identificado por nombre exacto del banco. Filtrado en `/bancos` (no aparece en el listado).
3. **Sin tabla de `usuarios` propia** — todo va por Supabase Auth + tabla `perfiles` que extiende.
4. **Columna `tipoCambio` en `erogaciones`** pero no hay UI para multi-moneda. Está reservada.
5. **`saldoActual` en tabla `bancos_medios_pago`** existe pero no se usa — el saldo real vive en `saldos_iniciales` (snapshot por fecha).

### Algoritmo de proyección
6. **Día 0 (hoy) no suma promedio de facturación** — asume que el saldo inicial cargado ya incluye lo que se va a facturar hoy. Evita doble conteo.
7. **Erogaciones pagadas se excluyen del cálculo** — asume que el saldo inicial ya las descontó.
8. **Diferimiento por unidad hardcoded** en `promedios/calcular.ts`:
   ```ts
   const DIFERIMIENTO_POR_UNIDAD = { 'unistore mayorista': 1 };
   ```
   Match por nombre case-insensitive. **No hay UI para configurar** — si se renombra la unidad o aparece otra con retardo, hay que tocar código. Pedro lo pidió así explícitamente.
9. **`proyectarMonto` aplica el shift de diferimiento al consultar el promedio**, no al cargar los datos históricos. Esto significa: el día Y para Unistore Mayorista usa el promedio de DOW(Y-1).

### Importación
10. **Tres plantillas Excel separadas** + un parser para el Excel original del simulador.
11. **Server action body limit elevado a 20MB** en `next.config.ts`.
12. **Detección de duplicados pre-importación** usando una clave normalizada (`fecha|empresa|banco|monto|descripcion-lowercase-trim`).
13. **API routes en lugar de server actions** para ingresos puntuales (2/3 importers). Decisión tomada en caliente por un bug donde el server action no se ejecutaba. Inconsistencia: erogaciones y facturación siguen como server actions.

### UI/UX
14. **shadcn/ui sobre `@base-ui/react`** en lugar de Radix.
15. **Colores hex hardcoded en Recharts** (`#16a34a`, `#f59e0b`, etc.) porque Recharts no resolvía las CSS variables `oklch(var(--success))` dentro del SVG.
16. **`Cmd+K` / `Ctrl+K`** como command palette (cmdk + react-hotkeys-hook).
17. **Sonner toasts** para feedback de acciones.

### Deploy
18. **Vercel + GitHub** (no GitLab / self-hosted). Región Vercel: `gru1` (São Paulo).
19. **Migraciones SQL aplicadas manualmente** desde local con `npm run db:migrate` contra Supabase. No hay CI/CD para DB.

---

## 4. Sidebar y navegación

El sidebar está en `src/components/app-sidebar.tsx`. Tiene 4 grupos:

```
TABLERO
└── Inicio                    /

OPERACION DIARIA
├── Erogaciones               /erogaciones
├── Ingresos puntuales        /ingresos-puntuales      ← agregado en F2
├── Recurrencias              /recurrencias
├── Acuerdos                  /acuerdos
├── Calendario de caja        /calendario
└── Saldos iniciales          /saldos

MOTOR Y ANALISIS
├── Proyeccion de saldo       /proyeccion
├── Facturacion diaria        /facturacion             ← agregado al final
├── Promedios                 /promedios
├── Analisis de gastos        /analisis
├── Precision del modelo      /precision
└── Sugerencias               /sugerencias

DATOS MAESTROS
├── Empresas                  /empresas
├── Unidades de negocio       /unidades-negocio
├── Bancos                    /bancos
├── Proveedores               /proveedores
└── Importar Excel            /importar
```

Adicionalmente en el sidebar: buscador / command palette (`Ctrl K`), info del perfil, theme toggle (light/dark), botón cerrar sesión.

⚠️ `/facturacion` y `/promedios` ambos usan el ícono `LineChart`. Confuso visualmente.

---

## 5. Componentes UI principales

### Patrones de shadcn/ui usados
- **Card / CardContent / CardHeader / CardTitle / CardDescription** — wrapping de todo.
- **Button + buttonVariants** — todos los botones (`default`, `outline`, `secondary`).
- **Input, Label, Textarea** — forms.
- **Select** — dropdowns.
- **Dialog** — crear/editar entidades.
- **Sheet** — detalle de día en calendario, detalle de erogación.
- **Tabs** — importar (4 tabs), home en gráficos.
- **Badge** — estados de erogación con colores semánticos.
- **DropdownMenu** — menú "cambiar estado" en erogaciones.
- **Separator** — divisiones visuales.
- **Tooltip** — labels de acciones.

### Tablas
- **HTML nativo** (`<table>`) con clases Tailwind, no DataTable. `@tanstack/react-table` está en `package.json` pero no se usa.
- Ordenamiento y filtros vía estado local + recálculo en cliente.

### Forms
- `react-hook-form` + `@hookform/resolvers/zod` + `zod` para todos los forms del CRUD.
- Schemas zod por entidad en `src/app/(app)/<entidad>/schema.ts`.

### Visualización
- **Recharts** para gráficos:
  - `LineChart` (facturación, /facturacion)
  - `AreaChart` (proyección de saldo)
  - `PieChart` con donut interno (distribución de gastos)
  - Bar chart (top proveedores en home)

### Theming
- `next-themes` con soporte light/dark.
- Tailwind v4 con CSS variables (oklch).
- Iconografía: `lucide-react`.

### Sin librería de tablas pesada
- No se usa Material UI, Ant Design, ni TanStack Table en producción.
- Las tablas grandes (erogaciones, facturación) no tienen paginación en servidor — todo el resultado se trae y se filtra en cliente.

---

## 6. Features pendientes / a medio implementar

| Feature | Estado | Detalle |
|---|---|---|
| Saldo auto-actualizable al marcar pagado | ❌ no implementado | Discutido en chat, queda manual. |
| Simulación what-if (múltiples escenarios) | ❌ no implementado | Mencionado en spec F2. |
| Memoria de decisiones (por qué pagué X antes que Y) | ❌ no implementado | Spec F3. |
| Alertas push / email | ❌ no implementado | Spec F3. |
| Integraciones con APIs bancarias / Mercado Libre | ❌ no implementado | Spec F4. |
| ML avanzado para predicción | ❌ no implementado | Spec F5. |
| Multi-moneda | 🟡 parcial | Schema soporta `moneda` y `tipo_cambio`, sin UI. |
| Adjuntos de erogaciones | 🟡 parcial | Schema soporta JSONB de adjuntos, sin UI para subirlos. |
| Roles admin/user | 🟡 parcial | Tabla `perfiles` con rol, pero no se enforce nada en UI. Todos los usuarios pueden todo. |
| `saldoActual` en `bancos_medios_pago` | 🟡 reservado | Columna existe pero nadie escribe ni lee. |
| Pagination en listados | ❌ no implementado | Todos los listados traen el resultado completo. |
| Tests automatizados | ❌ no implementado | Cero tests. |
| Documentación de API | ❌ no implementado | No hay README de las API routes. |
| Diferimiento configurable por UI | ❌ no implementado | Hardcoded en código. Spec lo dejaba abierto. |

---

## 7. Bugs conocidos / cosas a pulir

### Reportados recientemente y no resueltos
1. **App lenta en producción** — Pedro reportó hace minutos. Probable cold start de Vercel + queries pesadas en home (15+ queries serializadas a Supabase). Sin investigar a fondo todavía.

### Identificados durante el desarrollo
2. **Lint warnings preexistentes**: imports no usados en `erogaciones-client.tsx`, `proyeccion-client.tsx`, `precision/page.tsx`, `proveedores/[id]/ficha-client.tsx`.
3. **React `set-state-in-effect` warnings** en `command-palette.tsx` y `theme-toggle.tsx`.
4. **Color CSS oklch no resuelve en SVG** de Recharts → workaround con hex hardcoded. Inconsistencia: el resto de la UI usa CSS vars.
5. **Erogaciones atrasadas** (fecha < hoy, estado pendiente) no aparecen en la proyección porque ésta arranca desde hoy. El usuario tiene que re-agendarlas manualmente.
6. **Diferimiento de Unistore Mayorista**: si el usuario carga datos históricos con fecha "de impacto" en lugar de "de facturación", el shift estaría doblemente aplicado. Esto es un supuesto no validado con el usuario.
7. **Banco "CUALQUIERA"** mencionado en la spec original como banco comodín a eliminar — sigue existiendo en la base de Pedro porque viene de la importación del Excel original.
8. **Saldo "Total consolidado" + saldos por banco se suman** — el UI advierte pero permite la mezcla. Riesgo de doble conteo si el usuario no presta atención.
9. **CRLF/LF warnings** en cada commit — falta configurar `.gitattributes`.

### Inconsistencias arquitectónicas
10. **Server actions vs API routes** — ingresos puntuales pasó a API routes, erogaciones y facturación siguen como server actions. Misma lógica, dos patrones distintos.
11. **Dos lugares de cálculo de promedios** — `promedios/calcular.ts` y `lib/proyeccion.ts`. El segundo enriquece al primero (agrega `unidadNombre` y `diasDiferimiento`). Si alguien llama directo a `calcularPromediosUnidad` se pierde el shift.

---

## 8. Dependencias agregadas además del setup inicial

Setup inicial (`create-next-app`): Next 16, React 19, TypeScript, Tailwind v4, ESLint.

### Agregadas durante el desarrollo
| Lib | Uso |
|---|---|
| `@supabase/ssr`, `@supabase/supabase-js` | Auth + DB |
| `drizzle-orm`, `drizzle-kit`, `postgres` | ORM + migraciones |
| `shadcn`, `@base-ui/react` | UI library |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | utilities Tailwind |
| `next-themes` | Light/dark mode |
| `lucide-react` | Iconos |
| `react-hook-form`, `@hookform/resolvers`, `zod` | Forms + validación |
| `@tanstack/react-table` | ⚠️ instalado pero **no se usa** |
| `cmdk`, `react-hotkeys-hook` | Command palette |
| `sonner` | Toasts |
| `recharts` | Gráficos |
| `xlsx` | Parseo y generación de Excel (sheetjs/xlsx 0.18, no la versión más nueva) |
| `date-fns` | Manipulación de fechas |
| `dotenv` | Para scripts de migración |

⚠️ `@tanstack/react-table` está instalado pero no se usa. Candidato a desinstalar o usar.

⚠️ `xlsx 0.18.5` es la versión vieja antes del cambio de licencia. Funciona pero hay vulnerabilidades conocidas en CVE.

---

## 9. Diferencias local vs producción

| Aspecto | Local | Producción |
|---|---|---|
| Base de datos | Misma Supabase (Pedro no tiene DB local) | Misma Supabase |
| Conexión | `DATABASE_URL` (pooler) | Misma `DATABASE_URL` |
| Auth | Cookies httpOnly de Supabase | Idem |
| Render | `next dev` con Turbopack | `next build` + `next start` |
| Cold start | No (siempre warm) | **Sí** (Vercel Hobby — primera request tras inactividad tarda 2-4s) |
| Logs | Consola local | Vercel Logs (acceso vía `vercel logs`) |
| Variables de entorno | `.env.local` | Vercel dashboard |
| Región | Argentina (latencia ~30ms a Supabase) | Vercel `gru1` São Paulo (~80-150ms a Supabase) |
| Migraciones | `npm run db:migrate` desde local | **No corre automáticamente** — hay que correrlas a mano contra Supabase. Vercel solo deploya el código. |
| Body limit server actions | 20MB | 20MB (configurado en `next.config.ts`) |

### Riesgo operativo
- Si alguien hace un schema change y no corre la migración, la app prod se rompe.
- No hay environment de staging.

---

## 10. Cosas raras / decisiones cuestionables

### Arquitectónicas
1. **Banco virtual "Total consolidado"** es un hack. Lo correcto sería tener una tabla `saldos_consolidados` separada o una columna `tipo` en `saldos_iniciales`. Decisión consciente para evitar migración.
2. **Diferimiento hardcoded por nombre de unidad** (lowercase match). Si renombran "Unistore Mayorista" a "Unistore Mayorista B2B" el feature deja de funcionar silenciosamente.
3. **Server actions vs API routes**: misma lógica de "parse + apply" para los 3 tipos de importación, pero ingresos puntuales fue migrado a API routes y los otros dos no. Inconsistencia que puede confundir.
4. **`/api/plantilla-XXX`** retornan 405 a POST, pero algo en la app está haciendo POST a ellos. Investigado parcialmente: parece prefetch del browser o algo así. No diagnosticado a fondo.
5. **No hay paginación en ninguna tabla**. `/erogaciones` puede tener 1000+ filas y se carga todo. Funciona ahora pero no escala.

### De producto
6. **`/presentacion` es público**. Cualquiera con la URL ve el saldo, atrasadas, etc. ⚠️ **No verificado si esto es deseado** — puede ser un leak importante de información financiera.
7. **Sin "deshacer"** en ninguna acción. Borrás un proveedor, se va junto con sus erogaciones por cascada parcial.
8. **`saldoPendiente` en proveedor** se actualiza manualmente. No hay sync con erogaciones cargadas a ese proveedor.
9. **El supuesto del diferimiento**: el sistema asume que la fecha cargada en facturación es la fecha de FACTURACIÓN (no la fecha de impacto en caja). Si Pedro cargó las fechas con criterio "impacto", el diferimiento está doblemente aplicado. Esto **no fue validado**.
10. **Sin sistema de roles real**: la tabla `perfiles` tiene rol admin/user pero no se enforce en UI ni server actions. Todos los autenticados pueden todo.

### De código
11. **Función `calcularProyeccionTodas` exportada de `/lib/proyeccion.ts`** enriquece los promedios con nombre + diferimiento. Si alguien llama a `calcularPromediosTodas` directo (la función "base" en `promedios/calcular.ts`), el shift no se aplica. Trampa silenciosa.
12. **Lógica de proyección duplicada**: `/proyeccion/page.tsx`, `home/page.tsx` (`getProyeccion30`), `/calendario/page.tsx` cada uno query erogaciones + ingresos puntuales + promedios y llaman a `proyectarSaldo`. Refactor candidato: una sola función helper.
13. **`facturacion_diaria` tiene una columna `es_real` con default `true`** pero no se usa diferenciado. Reservado para futuros datos sintéticos.
14. **El parseo de fechas de Excel** usa `XLSX.SSF.parse_date_code` pero también tiene un fallback con `new Date(string)` que puede dar resultados raros con formatos ambiguos (ej. `01/02/2026` ¿enero o febrero?).
15. **Tres copias del helper `aFechaISOPlantilla`** entre `plantillas-actions.ts`, `parsear-ingresos-puntuales/route.ts` y otros — DRY violado.

### De setup
16. **`docs/SPEC.md` no existe en el repo** — la spec original vivió en el chat de Pedro y se referencia desde memoria. **Este reporte está en `docs/REPORTE_ESTADO.md` que es el primer archivo `docs/`**.
17. **Sin `.gitattributes`** para manejar CRLF/LF — cada commit muestra warnings.
18. **Migration 0005_auth_setup** es una migración para Supabase Auth específicamente. Es frágil porque depende del schema interno de Supabase.

---

## 11. Estado del schema (Drizzle)

11 tablas en `src/db/schema/`:

| Tabla | Notas |
|---|---|
| `empresas` | 4 razones sociales del grupo |
| `unidades_negocio` | 3 canales (Unistore Mayorista, ML, Unidrop) |
| `bancos_medios_pago` | 5 bancos + "Total consolidado" virtual |
| `proveedores` | Con prioridad alta/media/baja, tags, contacto |
| `recurrencias` | Gastos periódicos |
| `erogaciones` | Gastos comprometidos. **22 columnas**. |
| `facturacion_diaria` | Ingresos diarios por unidad. Unique `(fecha, unidad, empresa)`. |
| `saldos_iniciales` | Snapshots por banco + fecha. Unique `(fecha, banco_id)`. |
| `perfiles` | Extensión de Supabase Auth users con rol |
| `acuerdos` | Promesas a proveedores |
| `ingresos_puntuales` | **Agregada en F2**. Cobros extraordinarios. |

9 migraciones en `drizzle/*.sql`:
- 0000_dark_tarantula (creación inicial 10 tablas)
- 0001_enable_rls_base_tables
- 0002_parched_azazel (refinamientos)
- 0003_enable_rls_transactional_tables
- 0004_gorgeous_blur (más refinamientos)
- 0005_auth_setup
- 0006_cool_ted_forrester (tabla acuerdos)
- 0007_enable_rls_acuerdos
- 0008_tense_mockingbird (tabla ingresos_puntuales + su RLS)

RLS habilitado en todas las tablas con política `Usuarios autenticados acceso total` (ALL FOR authenticated USING true).

---

## 12. Sobre la conexión a la base

- Driver: `postgres` (postgres-js) — no `pg` (node-postgres).
- Connection string vía `DATABASE_URL` (pooler de Supabase, IPv6).
- `prepare: false` para evitar conflicto con el pooler.
- Drizzle migra usando `DIRECT_URL` (conexión directa) — no el pooler.
- Sin connection pool propio del lado de la app — confía en el pooler de Supabase.

---

## 13. Métricas finales

- **22 rutas** (21 protegidas + `/login`).
- **6 API routes**.
- **11 tablas en la base**.
- **9 migraciones SQL**.
- **~25 dependencias de producción**.
- **0 tests automatizados**.
- **0 ambientes de staging**.
- **1 desarrollador (Pedro, no programador)** + asistente IA.

---

## 14. Para el auditor

Áreas donde recomendaría poner el lupa:

1. **Lógica del motor de proyección** (`/src/app/(app)/proyeccion/calcular.ts` + `lib/proyeccion.ts` + `promedios/calcular.ts`). Hay tres lugares con lógica entrelazada y supuestos no documentados (día 0, diferimiento, pagadas).
2. **Consistencia del flujo "saldo cargado → erogaciones excluidas"**. ¿Qué pasa si el usuario carga saldo desactualizado? ¿Y si paga después de cargar?
3. **Performance de la home**. 15+ queries a Supabase desde Vercel. Ver si caching o reducción de queries ayuda.
4. **Ruta `/presentacion` pública**. ¿Es intencional? ¿Qué expone?
5. **Hardcoded `'unistore mayorista'`** en el código. Robustez.
6. **Coexistencia de server actions y API routes** para la misma funcionalidad (importadores).
7. **Sin paginación**. ¿En qué momento `/erogaciones` deja de cargar en tiempo razonable?
8. **Bug del "POST 405 a /api/plantilla-X"** que aparece en logs de Vercel sin explicación obvia.
9. **Riesgo de doble conteo** entre saldo consolidado y saldos por banco.
10. **Supuestos no validados** sobre cómo el usuario cargó datos históricos de facturación (fecha de facturación vs fecha de impacto).
