# UNIDATA PRO — Guía para Claude

## Qué es este proyecto
Plataforma BI interna del grupo Unistore. Centraliza datos de 3 unidades de negocio:
- **Unistore** — e-commerce propio (Tienda Nube + Mercado Libre)
- **Unidrop** — dropshipping (dropshippers que operan bajo la marca)
- **Unidev** — desarrollo / operaciones internas

App productiva en `https://app.unidatacenter.com.ar`

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | FastAPI 0.115 · SQLAlchemy 2 · Python 3.12 |
| Base de datos | PostgreSQL en AWS RDS (acceso vía SSH tunnel a bastión EC2) |
| App DB | PostgreSQL en RDS `unidata-prod-db` (us-east-2, misma VPC que el backend): `users`, `it_alerts`, `cs_actions`, `dropshipper_notes`, `reminders`, flujo de fondos, `meta_*`, `people_*`, etc. Migrada desde Supabase el 2026-06-10 |
| Auth | JWT HS256 · bcrypt · 2FA TOTP (pyotp) · token MCP 90d (scope=mcp) |
| Frontend | Next.js 16 · React 19 · Tailwind 4 · Recharts · TanStack Query 5 |
| Estado global | Zustand (period filters, custom range) con localStorage |
| Deploy | AWS (ECS Fargate `backend`+`mcp` · CloudFront `frontend`) · Cloudflare DNS · CI GitHub Actions |
| MCP | FastMCP (Python) · stdio + HTTP/SSE · `mcp.unidatacenter.com.ar` |
| DBs locales | SQLite: `users.db` (usuarios) · `audit.db` (queries) · `costs.db` (costos importación) |

---

## Servicios desplegados (AWS · prod)

Todo el stack productivo vive en **AWS** (cuenta `043187662940` · región `us-east-2`, infra gestionada por **AWS CDK**). Railway fue solo el MVP y ya no se usa.

| Service | URL | Hosting AWS | Path en repo | Deploy |
|---|---|---|---|---|
| `frontend` | `app.unidatacenter.com.ar` | CloudFront (`d2ax1owqknwl0f.cloudfront.net`) | `frontend/` | CDK (fuera de este repo) |
| `backend` | `api.unidatacenter.com.ar` | ECS Fargate `unidata-prod-backend` (cluster `unidata-prod`) tras ALB `unidata-prod-alb`, Cloudflare delante | `backend/` | GitHub Actions → ECR → ECS (push a main) |
| `mcp` | `mcp.unidatacenter.com.ar` | ECS Fargate `unidata-prod-mcp` (mismo cluster + ALB) | `mcp/` | GitHub Actions → ECR → ECS (push a main) |

**CI/CD (`backend` + `mcp`):** `.github/workflows/deploy-{backend,mcp}.yml`. En cada push a `main` que toque `backend/**` o `mcp/**`: build de la imagen → push a ECR (`unidata-prod-{backend,mcp}`, tags `:<sha>` + `:latest`) → `aws ecs update-service --force-new-deployment`. También se pueden disparar a mano desde la pestaña Actions (`workflow_dispatch`).

> Las credenciales AWS del CI viven en los **GitHub Secrets** del repo (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`), atadas al IAM user `unistore-devops`. Si el deploy falla con `The security token included in the request is invalid`, la access key se rotó/borró → crear una nueva para `unistore-devops` y actualizar esos 3 secrets.

> **Conexión RDS:** las credenciales (`PROD_DB_PASSWORD_*`, etc.) están **inline en el `environment` del task def del backend** (NO Secrets Manager). Para rotar un password: nueva revisión de la task def con el env actualizado + `update-service`.
>
> **App DB (`DATABASE_URL`):** apunta a RDS `unidata-prod-db` (cutover desde Supabase: 2026-06-10, task def rev 6). La URL con el password vigente vive también en el secret `unidata/prod/backend` de Secrets Manager — mantenerlo sincronizado al rotar. El proyecto Supabase queda vivo solo como rollback temporal; no escribirle.

---

## Regla crítica — nunca mezclar unidades de negocio

Cada unidad tiene su propio engine SQLAlchemy con SSH tunnel separado:

```python
from app.db.engines import get_engine
eng = get_engine("unistore")   # o "unidrop" o "unidev"
```

**Nunca** consultar datos de Unistore con el engine de Unidrop o viceversa. Esta es la regla más importante del proyecto.

---

## Ground truth por unidad

| Unidad | Fuente principal de ventas/actividad |
|--------|--------------------------------------|
| Unistore | `tienda_nube.Order` + `mercado_libre.Order` |
| Unidrop | `public.PaymentIntent` (Talo) — NO `OrderMercadoLibre` ni `tienda_nube_orders` |
| Unidev | tablas propias |

Los orders de Unidrop se enriquecen desde OML y TN pero **el conteo y GMV salen de PaymentIntent**.

Linkage canónico dropshipper ↔ orden: `order.number LIKE 'DROP-{dni}-%'` (no user_id).

---

## ⚠️ Schema gotchas en unidrop_api (descubiertos a la mala)

Estos son nombres de columnas que parecen lógicos pero NO existen. Las queries que los referencian fallan silenciosamente porque `q()` traga errores:

| Lo que el código tendría que usar | NO existe (∅) | SÍ existe (✅) |
|---|---|---|
| Link User → ML orders | `MercadoLibreUserAccount.userId` ∅ | `OrderMercadoLibre.userId` ✅ (link directo) o vía `User.mercadoLibreAccountId → MLA.id → MLA.mlUserId → OML.sellerId` |
| ML order ID en OML | `OrderMercadoLibre.mlOrderId` ∅ | `OrderMercadoLibre.id` ✅ (bigint, es el ML order ID externo) |
| Payment GMV de ML | `PaymentMercadoLibre.totalAmount` ∅ | `PaymentMercadoLibre.transaction_amount` ✅ (pero igual mejor usar `OML.totalAmount`) |
| Join TN items ↔ TN orders | `tienda_nube_order_items.order_id` ∅ | `tienda_nube_order_items.tienda_nube_order_id` ✅ → join con `tienda_nube_orders.tienda_nube_id` |
| SKU en OrderItemMercadoLibre | `sellerCustomField`, `seller_sku` ∅ | `sellerSku` ✅ (camelCase, no `sellerSKU`) |
| Type column en items ML | `type` ∅ | `orderType` ✅ |
| Cost column en items ML | `cost` ∅ | `unitCost` ✅ |
| Status column TN orders | `status` enum complejo | `payment_status::text = 'paid'` ✅ |

**Regla:** antes de escribir cualquier query nueva contra `unidrop_api`, hacer `information_schema.columns` para verificar nombres. NO confiar en convenciones — el schema es inconsistente entre tablas.

---

## Linkage de pedidos entre 3 sistemas

Para resolver el "DROP number" de una orden ML necesitamos cruzar:

```
PaymentIntent.mlOrderIds[] → external ML order ID (bigint)
                              ↓
                  OrderMercadoLibre.id (mismo bigint)
                              ↓ tiene .number
                       'DROP-{dni}-{seq}'
```

Para invoice (Contabilium):
```
ContabilliumInvoice.idVentaIntegracion = OrderMercadoLibre.id  (para ML)
                                       = tienda_nube_orders.tienda_nube_id  (para TN)
.linkPublico = URL público de la factura
.numeroComprobante = ej "0001-00068540"
```

Para descargar etiqueta PDF:
```
OrderMercadoLibre.etiqueta_pdf_base64  (ML: FLEXI, ML FLEX, PR, Punto de Retiro)
oca_shipments.etiqueta_pdf_base64       (TN OCA)
lightdata_shipments.etiqueta_pdf_base64 (TN Lightdata)
```

Endpoint serving: `GET /api/dashboards/orders/{ml|tn}/{id}/label` → returns PDF.

---

## Auth y RBAC

### Roles
```
admin      → acceso total + panel /admin (también si is_admin=TRUE en otra role)
gerencia   → acceso cross a todas las áreas + dashboard gerencia
user       → acceso a su área asignada
analista   → igual que user (rol semántico)
lector     → igual que user, solo lectura
```

### Áreas (9)
`administracion · compras · finanzas · ventas · logistica · cs · marketing · people · it_data`

### Regla de acceso
- **admin / is_admin=TRUE / gerencia** → bypass total de restricciones de área
- **Resto** → solo ven dashboards y endpoints de su área asignada

> **Importante:** "Admin" puede ser tanto `role='admin'` (legacy) como `is_admin=TRUE` (flag nuevo). El sidebar y el backend respetan ambos. Esto permite a un user con `role='gerencia' + is_admin=TRUE` administrar usuarios.

### Dependency en endpoints
```python
from app.auth.security import current_user
from typing import Annotated
from fastapi import Depends

@router.get("/mi-endpoint")
def mi_endpoint(user: Annotated[dict, Depends(current_user)]):
    # user = {id, email, name, role, is_admin, area_slug, area_id}
    ...
```

Para endpoints con restricción de área usar `require_area()`:
```python
from app.auth.security import current_user, require_area
@router.get("/ventas/datos")
def ventas_datos(user: Annotated[dict, Depends(current_user)]):
    require_area(user, ["ventas"])  # lanza 403 si no tiene acceso
    ...
```

### MCP tokens (JWT 90d)
- Endpoint: `POST /api/auth/mcp-token` (requiere JWT normal)
- Devuelve token con `scope: "mcp"`, `expires_in_days: 90`
- Frontend: `/dashboard/account` tiene botón "Generar token" + walkthrough
- Mismo JWT secret, mismos claims (role, is_admin, area_slug) → RBAC sigue aplicando

---

## Estructura de directorios

```
unidata-pro/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py                # login, register, 2FA, mcp-token
│   │   │   ├── admin.py               # CRUD usuarios + áreas
│   │   │   ├── notifications.py       # it_alerts CRUD
│   │   │   ├── cs_actions.py          # CS actions (cola tareas)
│   │   │   ├── dropshipper_notes.py   # NUEVO · notas del equipo por dropshipper
│   │   │   ├── reminders.py           # NUEVO · recordatorios personales
│   │   │   ├── dashboards/
│   │   │   │   └── routers.py         # endpoints dashboards + label downloads
│   │   │   └── ...
│   │   ├── auth/
│   │   │   └── security.py            # JWT, current_user, require_area, issue_token(scope=mcp)
│   │   ├── db/
│   │   │   ├── engines.py             # SSH tunnels + SQLAlchemy engines
│   │   │   ├── users_db.py            # users + roles
│   │   │   ├── areas_db.py            # áreas + perfil de usuario
│   │   │   ├── notifications_db.py    # it_alerts CRUD
│   │   │   ├── cs_actions_db.py       # cs_actions CRUD
│   │   │   ├── dropshipper_notes_db.py # NUEVO · CRUD + soft-archive
│   │   │   ├── reminders_db.py        # NUEVO · CRUD + due tracking
│   │   │   └── local_persistence.py   # pool psycopg2 a la app DB (RDS unidata-prod-db)
│   │   ├── services/                  # lógica de negocio (1 archivo por dominio)
│   │   │   ├── rfm_analytics.py
│   │   │   ├── rfm_flows.py
│   │   │   ├── dropshippers.py        # vista 360 dropshippers + unified orders (BIG)
│   │   │   ├── end_consumers_unidrop.py # top clientes TN + ML del dropshipper
│   │   │   ├── sku_omnichannel.py     # SKU vista cross 4 canales
│   │   │   └── ...
│   │   └── main.py                    # FastAPI app + routers + cache middleware 180s
│   ├── .env (NO commitear)
│   ├── .env.example
│   └── Dockerfile
├── frontend/                          # Next.js 16
│   ├── app/
│   │   ├── dashboard/
│   │   │   ├── page.tsx               # executive dashboard
│   │   │   ├── dropshipper/[id]/page.tsx  # vista 360 dropshipper (BIG ~2000 líneas)
│   │   │   ├── productos/[sku]/page.tsx   # producto 360 omnichannel
│   │   │   ├── account/page.tsx       # 2FA + MCP token
│   │   │   ├── admin/users/page.tsx
│   │   │   └── ...
│   │   └── ...
│   ├── components/
│   │   ├── sidebar.tsx                # nav con RBAC (is_admin + role)
│   │   └── ...
│   └── lib/api.ts                     # fetch wrapper con auto-token + 401 redirect
├── mcp/                               # NUEVO · paquete Python MCP server
│   ├── unidata_mcp/
│   │   ├── server.py                  # FastMCP + 24 tools (10 read + 14 write)
│   │   ├── client.py                  # httpx async + auth headers
│   │   ├── config.py                  # env loader
│   │   ├── http_server.py             # transport HTTP/SSE con contextvar per-request
│   │   └── __main__.py                # stdio entry
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── railway.toml
│   └── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── LOCAL_DEV.md
    └── DEPLOY.md
```

---

## Patrón para agregar un endpoint de dashboard

```python
# backend/app/api/dashboards/routers.py
@router.get("/mi-feature")
def get_mi_feature(
    _: Annotated[dict, Depends(current_user)],
    period: Annotated[str, Query()] = "30d",
    unit: Annotated[Literal["unistore", "unidrop"], Query()] = "unistore",
) -> dict:
    if unit == "unidrop":
        return mi_service.mi_feature_unidrop(period)
    return mi_service.mi_feature(period)
```

```typescript
// frontend: TanStack Query
const { data } = useQuery({
  queryKey: ["mi-feature", unit, period],
  queryFn: () => api<MiFeatureResponse>(`/api/dashboards/mi-feature?unit=${unit}&period=${period}`),
  staleTime: 60_000,
})
```

---

## Dropshipper 360 — anatomía

`/dashboard/dropshipper/[id]/page.tsx` (~2000 líneas) muestra:

1. **Header** con identidad + suscripción + canal (MELI/TN/ambos)
2. **KPIs principales (6)**: Ingreso omnicanal (ML+TN), Margen Unidrop, Ticket promedio, Órdenes pagadas, Última venta, Deuda Talo
3. **Segmentación omnicanal** (NUEVO): dos cards (amarillo MELI + cyan TN) con GMV de canal, badge ACTIVO/SIN VENTAS, órdenes y tiendas conectadas
4. **Notas del equipo** (NUEVO): CRUD inline, 7 categorías (general/cs/billing/support/retention/flag/ops), accesible vía MCP
5. **Cuentas Talo** (CBU + alias) + tienda TN credentials + historial suscripción + referidos
6. **Evolución mensual GMV** (12m con barras ML + TN)
7. **Top clientes finales del dropshipper** (NUEVO: TN + ML combinados con columna Canal)
8. **Analítica de productos** (NUEVO): combo vs individual con barras + top 10 SKUs (foto, qty, revenue, combo×N · ind×N) click → producto 360
9. **Tabla unified de órdenes** (BIG): chevron expand + 10 columnas + filtros Canal/Tipo
10. **Últimos pagos Talo** (click → filtra órdenes del PI)

### Modal de detalle de orden

Botones header: **Ver Factura** (link público Contabilium) · **Etiqueta** (download PDF) · **Unidrop** (abrir en panel)

Bloques:
- **Header**: badges (ML/TN, COMBO, FLEXI/PR/FULL, CANCELADA UNIDROP) + tags ML como chips
- **Tabla Productos**: foto, SKU (link), Costo Ud, Precio Ud, Ganancia Ud, totales
- **Pago**: subtotal/descuento/costo mercadería/envío/total Unidrop/ingreso/net revenue + gateway TN con link
- **Envío**: tipo + carrier + estado + tracking number + tracking URL + dirección completa + comentarios + receiver
- **Cliente**: nombre, email, teléfono, DNI, billing si difiere
- **Pipeline 5 nodos** con fechas (Creada/Pagada/Empaquetado/En camino/Entregada) — hover muestra status + fecha + hora
- **Operativa**: etiqueta descargada, notif pack/ship, manual marks
- **Timestamps TN**: paid_at, completed_at, closed_at, cancelled_at
- **Notas TN**: nota cliente + nota dropshipper
- **Factura Contabilium**: tipo, número, fecha, total, CAE, link directo
- **Devoluciones MELI**: status, motivo, monto refund, tracking, fotos discrepancia

### Tabla expandida (row open)
Replica la tabla del modal: foto/SKU/Costo/Precio/Ganancia per línea + totales + chips de envío y devoluciones + botón "Ver detalle completo".

---

## MCP Server

### Conexión remota (recomendada)
Cualquier user genera su token en `/dashboard/account` → "Generar token" → pega en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "unidata": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.unidatacenter.com.ar/sse",
               "--header", "Authorization:Bearer TOKEN"]
    }
  }
}
```

Requiere Node.js. La extensión Claude Code VSCode también lo soporta.

### Tools disponibles (24)

**Read (10):**
- `whoami`, `list_dropshippers`, `get_dropshipper`, `get_dropshipper_unified_orders`
- `get_executive_dashboard`, `get_unit_dashboard`, `list_orders`
- `run_sql`, `list_tables`, `preview_table`, `describe_table`

**Write (14) — todas con JWT per-request, RBAC aplicado:**
- CS actions (6): `list_cs_actions`, `take_cs_action`, `complete_cs_action`, `cancel_cs_action`, `create_cs_action`, `update_cs_action_note`
- IT Alerts (3): `list_alerts`, `resolve_alert`, `unresolve_alert`
- Dropshipper notes (3): `add_dropshipper_note`, `list_dropshipper_notes`, `archive_dropshipper_note`
- Reminders (3): `create_reminder`, `list_my_reminders`, `complete_reminder`

### Arquitectura HTTP/SSE
`http_server.py` define `AuthMiddleware` que extrae `Authorization: Bearer <jwt>` y lo deposita en `_request_token` (contextvars.ContextVar). `get_client()` en `server.py` lee el contextvar y construye un `UnidataClient` per-request con ese token. En stdio el contextvar queda None y cae al singleton con env var.

---

## Sistema de notificaciones / acciones

Tres sistemas distintos, NO mezclarlos:

1. **`it_alerts`** (tabla app DB) — alertas de salud de integraciones
   - Endpoints: `GET/POST /api/notifications` + `/resolve` + `/unresolve`
   - MCP: `list_alerts`, `resolve_alert`, `unresolve_alert`

2. **`cs_actions`** (tabla app DB) — cola de tareas para Customer Success
   - Endpoints: `GET/POST /api/cs-actions/...` + `/take` + `/complete` + `/cancel` + `/note`
   - MCP: 6 tools wraping todo el flow

3. **`dropshipper_notes`** (tabla app DB, NUEVO) — notas del equipo por dropshipper
   - Endpoints: `GET/POST /api/dropshipper-notes` + `PATCH/{id}` + `/archive`
   - MCP: `add_dropshipper_note`, `list_dropshipper_notes`, `archive_dropshipper_note`
   - 7 categorías: `general/cs/billing/support/retention/flag/ops`
   - Visible en el dropshipper 360 inline

4. **`reminders`** (tabla app DB, NUEVO) — recordatorios personales
   - Endpoints: `GET/POST /api/reminders` + `POST/{id}/complete` + `DELETE/{id}`
   - MCP: 3 tools
   - target_type: dropshipper/order/customer/cs_action/alert/general

---

## Timezone

Forzado globalmente a `America/Argentina/Buenos_Aires`:
- PG connection: `connect_args={"options": "-c timezone=America/Argentina/Buenos_Aires"}`
- Frontend: `fmtArDateTime()` en `lib/utils.ts` con `timeZone: "America/Argentina/Buenos_Aires"` explícito

**Nunca** usar `new Date()` sin timezone explícito en el frontend.

---

## Dev local

```bash
# Backend (terminal 1)
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev

# MCP (terminal 3, opcional)
cd mcp
uv pip install -e .
UNIDATA_API_URL=https://api.unidatacenter.com.ar unidata-mcp-http
```

**Advertencia:** la app DB de prod es la RDS `unidata-prod-db`, que es **privada** — para dev local hace falta túnel SSH al bastión unidata (`ssh -i unidata-bastion-key.pem -L 5433:unidata-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432 ec2-user@18.226.5.216`) y `DATABASE_URL` apuntando a `localhost:5433`. Es la misma DB que producción: si se crean usuarios de test, eliminarlos después.

Los SSH tunnels al RDS se abren automáticamente al iniciar el backend si las variables de entorno están seteadas.

---

## Comandos frecuentes

```bash
# Logs de un service ECS (perfil AWS local: unistore-admin)
aws logs tail /ecs/unidata-prod-backend --follow --region us-east-2 --profile unistore-admin
aws logs tail /ecs/unidata-prod-mcp --follow --region us-east-2 --profile unistore-admin

# Deploy: lo normal es push a main (CI buildea + deploya). A mano:
gh workflow run deploy-backend.yml      # o deploy-mcp.yml — dispara el build+deploy
aws ecs update-service --cluster unidata-prod --service unidata-prod-backend \
    --force-new-deployment --region us-east-2 --profile unistore-admin   # redeploy misma imagen

# Salud
curl https://api.unidatacenter.com.ar/api/health
curl https://mcp.unidatacenter.com.ar/health

# Rollback
git revert HEAD && git push origin main

# Estado del servicio / deployments
aws ecs describe-services --cluster unidata-prod --services unidata-prod-backend \
    --region us-east-2 --profile unistore-admin \
    --query "services[0].deployments"
gh run list --workflow=deploy-backend.yml --limit 5
```

---

## Flujo de Fondos — port nativo a UNIDATA (en progreso)

ERP de tesorería del grupo desarrollado por **Pedro Abbiati** (`pedro.abbiati@unistore.ar`) originalmente en [`pedroabba123/flujo-fondos`](https://github.com/pedroabba123/flujo-fondos) (Next.js + Drizzle + Supabase Auth).

**Decisión 2026-05-21**: NO mantenemos como sub-app sincronizada con sub-dominio propio. Lo portamos al stack UNIDATA (FastAPI + Next.js + JWT propio + RBAC nativo) para que viva como una pantalla más bajo `Cross > Finanzas > Flujo de Fondos`.

| Componente | Estado |
|------------|--------|
| DB migrada a la app DB de UNIDATA (11 tablas + 538 filas + 9 enums + user; hoy en RDS `unidata-prod-db`) | ✅ Hecho |
| Subtree `services/flujo-fondos/` como **referencia de código** (NO se deploya) | ✅ Mantenido |
| Backend FastAPI `/api/flujo-fondos/*` (modelos SQLAlchemy + endpoints) | 🟡 En progreso |
| Frontend Next.js `dashboard/finanzas/flujo-fondos/*` | 🟡 En progreso |
| Sidebar entry interno bajo `Cross > Finanzas > Flujo de Fondos` | ✅ Wired |

### Reglas

1. **El subtree `services/flujo-fondos/` es solo referencia.** No deployar. No editar. Las features se portan a `backend/app/services/flujo_fondos/` y `frontend/app/dashboard/finanzas/flujo-fondos/`.
2. **DB compartida con UNIDATA**: las 11 tablas viven en `public` de la app DB de UNIDATA (RDS `unidata-prod-db`). SQLAlchemy del backend las mapea directamente.
3. **Auth**: usar el JWT propio de UNIDATA, no Supabase Auth. La tabla `perfiles` queda obsoleta para el port nativo (Pedro será un user normal de UNIDATA con area_slug=finanzas).
4. **RBAC**: cada endpoint con `require_area(["finanzas", "administracion"])` (admin/gerencia bypass automático).
5. **Lógica compleja a portar**: `proyeccion.ts` (motor central), `pagos-atrasados.ts` (sugerencias), `detectar-patrones.ts`, `DIFERIMIENTO_POR_UNIDAD` (Unistore Mayorista cobra día X+1).

Ver detalle en [docs/FLUJO_FONDOS_INTEGRATION.md](docs/FLUJO_FONDOS_INTEGRATION.md).

---

## Roadmap (estado al 2026-05-16)

100% del scope original cerrado. Sprint adicional (2026-05-13 → 2026-05-16) agregó:

✅ **Dropshipper 360 V2** — pipeline 5-icon con tooltips · combo handling · costos Contabilium · facturas · etiquetas · returns ML · timestamps · gateway · notas equipo · analítica combos · top clientes TN+ML · omnicanal
✅ **MCP server** — local stdio + remoto HTTP/SSE en AWS (ECS Fargate, `mcp.unidatacenter.com.ar`) · 24 tools · token JWT 90d · walkthrough en /account
✅ **Schema fixes** — 5 columnas inexistentes que causaban GMV=$0 silencioso
✅ **SKU Omnichannel** — fixed queries Unidrop TN + MELI (mostraban "Sin ventas registradas")
✅ **Admin RBAC** — sidebar respeta `is_admin` además de `role='admin'`

### 🟡 Pendiente (no urgentes)

- **Meta Ads integration** — esperando token + ad account IDs de Tomi para sync
- **US-XXX** Contabilium drilldown desde modal (link existe, integración profunda pendiente)
- **US-XXX** Forecast con segmentación combo vs individual
- **Flujo de Fondos port nativo** (2026-05-21): pivote a port nativo (NO sub-app). DB ya migrada a Supabase UNIDATA. Subtree `services/flujo-fondos/` como referencia. Pendiente: backend FastAPI + frontend Next.js portados al stack UNIDATA. Fase 1 = home + erogaciones + proyección.
