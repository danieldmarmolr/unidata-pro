# UNIDATA — Roadmap (Epic única + User Stories)

**Producto:** Plataforma de datos del Grupo Unistore (Unistore + Unidrop + Unidev)
**Stack:** FastAPI + Next.js 16 + PostgreSQL (Supabase + AWS RDS via SSH bastión) + MCP server
**Deploy:** Railway (`backend` + `frontend` + `mcp` services) + Cloudflare DNS
**URLs producción:**
- `https://app.unidatacenter.com.ar` (frontend)
- `https://api.unidatacenter.com.ar` (backend)
- `https://mcp-production-b8c5.up.railway.app` (MCP server, SSE)

---

## EPIC UNIDATA

**Owner:** Daniel Marmol
**Estado:** En producción · sprint adicional cerrado el 16/05/2026
**Convención:** todas las funcionalidades son **User Stories** dentro de esta única épica. Cada feature = 1 story Backlog → In Progress → Done.

---

## Resumen ejecutivo · 16/05/2026

| Métrica | Valor |
|---|---|
| Stories totales | 131 |
| Stories Done | 130 |
| Stories pendientes | 1 (Meta Ads, esperando credenciales) |
| Bugs críticos resueltos | 25 |
| Sprint 13-16/05 | 35 stories nuevas Done |
| Avance global | ~99% |

---

## Stories · estado actual

### 🟢 Infraestructura y deploy

| ID | Story | Status | Notas |
|---|---|---|---|
| US-001 | Login JWT + bcrypt + roles (admin/gerencia/analista/lector/user) | Done | |
| US-002 | Self-registration con dominio @unistore.ar | Done | |
| US-003 | Set-initial-password flow para users creados por admin | Done | |
| US-004 | Rate limiting anti brute-force (10/min login, 5/min register) | Done | slowapi |
| US-005 | 2FA TOTP backend (setup/enable/disable) | Done | pyotp |
| US-006 | 2FA TOTP UI con QR en /dashboard/account | Done | api.qrserver.com |
| US-007 | Admin CRUD users (crear/editar/desactivar/cambiar password) | Done | |
| US-008 | Audit log de queries SQL libre | Done | |
| US-009 | Túneles SSH a 3 bastiones AWS RDS con auto-recovery | Done | sshtunnel + paramiko |
| US-010 | Engines SQLAlchemy reutilizables por unidad | Done | TTLCache |
| US-011 | Deploy automatizado via Railway CLI | Done | |
| US-012 | DNS unidatacenter.com.ar delegado a Cloudflare | Done | nic.ar processed |
| US-013 | SSL Let's Encrypt para app.unidatacenter.com.ar | Done | |
| US-014 | SSL Let's Encrypt para api.unidatacenter.com.ar | Done | |
| US-015 | CORS regex permite *.unidatacenter.com.ar | Done | |

### 🟢 Dashboard gerencial cross-unidad (/dashboard)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-101 | Página /dashboard "Gerencia" con KPIs ejecutivos | Done | |
| US-102 | Comparador HOY (vs 7d/30d/365d) con bloques contextuales | Done | |
| US-103 | Filtros HOY/AYER/7d/30d/90d/12m/Personalizado afectan todo | Done | |
| US-104 | Mix de revenue · 5 fuentes reales | Done | |
| US-105 | Trend chart 12 meses con 5 series | Done | |
| US-106 | Salud por unidad de negocio | Done | |
| US-107 | Card "Facturado a Unidrop" (PaymentIntent ground truth) | Done | |
| US-108 | Análisis Unidev: top causas + resoluciones + SKUs | Done | |
| US-109 | Drilldowns Unidrop separados | Done | |
| US-110 | Salud de integraciones | Done | |
| US-111 | Alertas operativas | Done | |
| US-112 | Reporte ejecutivo mensual PDF descargable | Done | |

### 🟢 Customer Success (/dashboard/cs)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-201 | Vista general CS con KPIs | Done | |
| US-202 | Análisis de cohortes | Done | |
| US-203 | Cohortes drill inline | Done | |
| US-204 | Cohortes para Unidrop (dropshippers) | Done | |
| US-205 | Segmentación RFM con 11 segmentos | Done | |
| US-206 | RFM aplicado a Unidrop | Done | |
| US-207 | RFM Flows · migración mes a mes | Done | |
| US-208 | Popup educativo por segmento RFM | Done | |
| US-209 | Popup transición con lista | Done | |
| US-210 | NLP cancelaciones · clustering | Done | |
| US-211 | NLP devoluciones · clustering | Done | |
| US-212 | SmartSearch autocomplete en CS | Done | |
| US-213 | Buscar clientes (Unistore + Unidrop) | Done | |

### 🟢 Producto / SKU analytics

| ID | Story | Status | Notas |
|---|---|---|---|
| US-301 | Vista general producto | Done | |
| US-302 | Análisis ABC + más | Done | |
| US-303 | ABC con unit=unidrop | Done | |
| US-304 | SKU Optimizer | Done | |
| US-305 | SKU Optimizer cards-filtro | Done | |
| US-306 | SKU Optimizer con unit=unidrop | Done | |
| US-307 | Forecast batch 30/60d | Done | |
| US-308 | Producto 360 (/dashboard/productos/[sku]) | Done | |
| US-309 | SKU Omnichannel · 4 canales orquestados | Done | |
| US-310 | SmartSearch autocomplete en Producto | Done | |
| US-311 | Fix Producto 360 Unidrop TN/MELI mostraban "Sin ventas" | **Done · sprint 13-16/05** | columnas reales `sellerSku`, `tienda_nube_order_id` |

### 🟢 Unidrop SaaS (dropshippers) — V1

| ID | Story | Status | Notas |
|---|---|---|---|
| US-401 | SaaS Metrics (usuarios, MRR, churn) | Done | |
| US-402 | Dropshippers master list con filtros | Done | |
| US-403 | Dropshipper 360 (vista completa por user_id) | Done | |
| US-404 | Bloque "Ventas pagadas a Unidrop" TN/ML | Done | |
| US-405 | Suscripciones Talo Pay | Done | |
| US-406 | Ventas MELI desde mlOrderIds | Done | |
| US-407 | Tabla TN nueva con linkage `DROP-{dni}-{seq}` | Done | |
| US-408 | Link a panel Unidrop por cada orden | Done | |
| US-409 | Pagos Talo: "Órdenes pagadas" | Done | |
| US-410 | Suscripciones MELI list page | Done | |
| US-411 | Envíos Unidrop | Done | |
| US-412 | RFM Flows con popups (Unidrop) | Done | |

### 🟢 Dropshipper 360 V2 (sprint 13-16/05)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-501 | DROP number resolution via OML.userId | Done | Reemplaza join roto con `_OrderMercadoLibreToPaymentIntent` |
| US-502 | Combo handling: detección, badge, filtro Combo/Individual | Done | `OML.orderType='COMBO'` |
| US-503 | Combo pricing redistribution proporcional al costo | Done | Fix bug 3× inflación combos ML |
| US-504 | SKU image fix: usar `OrderItemMercadoLibre.imagesUrls[0]` | Done | Fallback al join `Variant→Image` |
| US-505 | Pipeline auto-complete (Entregada → backfill En camino + Empaquetado) | Done | |
| US-506 | Pipeline 5-icon compact en tabla con tooltip status+fecha+hora | Done | Replica formato Unistore |
| US-507 | Pipeline 5-step detail en modal con fechas debajo | Done | Creada/Pagada/Empaquetado/En camino/Entregada |
| US-508 | Backend ML enrichment: shipping_address_detail JSONB | Done | Parseado a calle/ciudad/CP/comment/receiver |
| US-509 | Backend ML enrichment: tags, statusDetail, dateClosed | Done | Tags como chips en modal |
| US-510 | Backend ML enrichment: notification_pack/ship, cancel_by_unidrop | Done | |
| US-511 | Backend ML enrichment: label_downloaded + date_label_downloaded | Done | Operativa block en modal |
| US-512 | Backend TN enrichment: shipping_address JSONB | Done | Calle, número, piso, locality |
| US-513 | Backend TN enrichment: items.cost + order_type (combos TN) | Done | Antes era 0 |
| US-514 | Backend TN enrichment: gateway, gateway_name, gateway_link | Done | Link "Ver pago" en modal |
| US-515 | Backend TN enrichment: timestamps (paid_at, completed_at, closed_at, cancelled_at) | Done | Grid de timestamps en modal |
| US-516 | Backend TN enrichment: notas (note + owner_note) | Done | Bloques amber/blue en modal |
| US-517 | Carrier enrichment: OCA tracking_number + address + ultima_actualizacion | Done | |
| US-518 | Carrier enrichment: Lightdata tracking_url + tracking_qr + numero_envio | Done | Botón "Seguir envío" |
| US-519 | Carrier shipped_at / delivered_at inferidos desde status text | Done | OCA "Entregado" / "viaje" / Lightdata "ENTREGADO" / "EN_CAMINO" |
| US-520 | Contabilium invoice integration | Done | `ContabilliumInvoice.idVentaIntegracion` = OML.id o TN.tienda_nube_id |
| US-521 | "Ver Factura" button en modal abre linkPublico | Done | 3789 invoices linkeadas |
| US-522 | Bloque "Factura emitida" con tipo/número/CAE/total | Done | |
| US-523 | Label PDF download endpoint (ML/TN) | Done | `GET /api/dashboards/orders/{ml\|tn}/{id}/label` |
| US-524 | "Etiqueta" button en modal descarga PDF | Done | Maneja FLEXI/PR/Full/OCA/Lightdata |
| US-525 | MercadoLibreReturn detail enrichment | Done | status, motivo, monto, tracking, photos |
| US-526 | Bloque "Devoluciones MELI" en modal | Done | |
| US-527 | Modal redesign max-w-5xl con header sticky | Done | |
| US-528 | Tabla productos con Costo/Precio/Ganancia per línea + totales | Done | |
| US-529 | Row expandido replica tabla productos del modal | Done | "Como detalle completo" |
| US-530 | SKU clickeable → /dashboard/productos/{sku} | Done | En modal e inline |
| US-531 | Método envío clean (FLEXI/ML FLEX/FULL/PR/OCA) | Done | Filtra valores que sean status |
| US-532 | Columna Costo (= invoice.total Contabilium) | Done | Alineado con finanzas |
| US-533 | Columna Ganancia (Ingreso − Costo) | Done | Verde/rosa según signo |
| US-534 | Combo analytics en dropshipper 360 (combo vs ind + top SKUs) | Done | Dual bar + top 10 con foto |
| US-535 | Top clientes finales combinados TN + ML | Done | Antes solo TN, ahora con columna Canal |
| US-536 | Ingreso omnicanal KPI (siempre ML + TN sumados) | Done | Antes mostraba "Solo MELI" o "Solo TN" |
| US-537 | Segmentación omnicanal cards ML/TN visible siempre | Done | Badge ACTIVO/SIN VENTAS por canal |
| US-538 | Vista omnicanal — no limitar dropshipper a un canal | Done | |

### 🟢 Notas del equipo + Reminders (sprint 13-16/05)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-601 | Tabla `dropshipper_notes` en Supabase | Done | 7 categorías + soft-archive |
| US-602 | CRUD `/api/dropshipper-notes` (GET/POST/PATCH/archive) | Done | |
| US-603 | Componente `<DropshipperNotes>` inline en vista 360 | Done | Form compacto con selector categoría |
| US-604 | RBAC: autor o admin para editar; cualquier user para crear/leer/archive | Done | |
| US-605 | Tabla `reminders` en Supabase | Done | target_type opcional + due_at |
| US-606 | CRUD `/api/reminders` con filtros status (pending/overdue/upcoming/done) | Done | |
| US-607 | RBAC: cada user ve solo los suyos | Done | |

### 🟢 MCP Server (sprint 13-16/05)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-701 | Paquete Python `unidata-mcp` con FastMCP | Done | `mcp/` en repo |
| US-702 | 10 read tools (whoami, dropshippers, dashboards, run_sql, etc.) | Done | |
| US-703 | Transport stdio (`unidata-mcp` CLI) | Done | Para uso local |
| US-704 | Endpoint `POST /api/auth/mcp-token` (JWT 90 días) | Done | Reusa issue_token con scope=mcp |
| US-705 | Sección "Token para Claude (MCP)" en /dashboard/account | Done | Walkthrough + JSON copy |
| US-706 | Transport HTTP/SSE deployable | Done | Servicio Railway `mcp` |
| US-707 | Middleware per-request: extrae JWT de Authorization, inyecta en contextvar | Done | http_server.py + server.py |
| US-708 | Test concurrencia: 3 requests paralelos no se pisan los tokens | Done | contextvars.ContextVar isolation |
| US-709 | 6 write tools CS actions (list/take/complete/cancel/create/update_note) | Done | |
| US-710 | 3 write tools IT Alerts (list/resolve/unresolve) | Done | |
| US-711 | 3 write tools Dropshipper Notes (add/list/archive) | Done | |
| US-712 | 3 write tools Reminders (create/list_my/complete) | Done | |
| US-713 | Config snippet remoto via `mcp-remote` bridge (npx) | Done | Compatible con Claude Desktop actuales |
| US-714 | Custom domain (opcional, no hecho) | Pending | URL Railway directa funciona OK |

### 🟢 Admin & RBAC (sprint 13-16/05)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-801 | Sidebar respeta `is_admin=TRUE` además de `role='admin'` | Done | Admins via flag ven Usuarios menu |
| US-802 | Múltiples admins habilitados (todos ven panel /admin/users) | Done | Backend ya lo soportaba |

### 🟢 Unidev (Devoluciones)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-901 | Vista general devoluciones | Done | |
| US-902 | NLP causas devoluciones | Done | |
| US-903 | Análisis devoluciones en Gerencia | Done | |

### 🟢 Onboarding y comunidad interna

| ID | Story | Status | Notas |
|---|---|---|---|
| US-1001 | DB migration: tabla areas + columnas perfil | Done | |
| US-1002 | Seed 9 áreas operativas | Done | |
| US-1003 | Onboarding modal al primer login | Done | |
| US-1004 | Página /dashboard/perfil | Done | |
| US-1005 | Stories panel en /home | Done | |
| US-1006 | Sidebar entry "Mi perfil" | Done | |
| US-1007 | Admin asigna `role=gerencia` | Done | |
| US-1008 | RBAC enforcement por área | Done | ~50 endpoints + sidebar |

### 🟢 Fixes críticos y bugs resueltos

| ID | Bug | Resolución | Notas |
|---|---|---|---|
| BUG-001 | MRR Unidrop $0 por bug de schema | Fixed | mercado_libre_dev → public |
| BUG-002 | Tienda Pini "0 ventas MELI" con $1M pagos | Fixed | PaymentIntent ground truth |
| BUG-003 | Cohortes Unidrop devolvía 0/0/0 | Fixed | PaymentIntent ground truth |
| BUG-004 | RFM Unidrop devolvía 0 customers | Fixed | misma raíz |
| BUG-005 | RFM Flows popup "Sin clientes" con count > 0 | Fixed | bug SQLAlchemy `:ids::int[]` |
| BUG-006 | Buscar dropshippers no encontraba "tiendapi" | Fixed | + MELI nickname |
| BUG-007 | NameError `log` en search_customers | Fixed | import logging faltante |
| BUG-008 | Header "Datos al" mostraba hora del browser | Fixed | timeZone AR |
| BUG-009 | Drilldowns Unidrop mostraban Unistore | Fixed | endpoints separados |
| BUG-010 | Filtros de fecha label "(mes)" hardcoded | Fixed | period_label dinámico |
| BUG-011 | Pagos Talo contaba transacciones en vez de órdenes | Fixed | unfold mlOrderIds |
| BUG-012 | Gerencia "GMV Unidrop $0" | Fixed | + Facturado a Unidrop card |
| BUG-013 | Backend SSL 502 por port 5433 | Fixed | port 8080 |
| BUG-014 | Cohortes inline rows en 0 | Fixed | customers[] + rows[] |
| BUG-015 | Productos analytics React Error #310 | Fixed | useSkuEnrichment movido |
| BUG-016 | DNS nic.ar tardó 24+ hs | Resolved | propagado |
| BUG-017 | Cloudflare puso CNAMEs en proxy ON | Fixed | DNS only |
| BUG-018 | Dropshippers list "0 ventas" para muchos | Fixed | MAX(OML, PaymentIntent) |
| BUG-019 | DROP-{dni}-{seq} nunca se resolvía | Fixed · sprint 13-16/05 | OML.id directo, no mlOrderId |
| BUG-020 | Combos ML mostraban 3× el precio total | Fixed · sprint 13-16/05 | Redistribución proporcional al costo |
| BUG-021 | Imágenes de SKUs en combos no cargaban | Fixed · sprint 13-16/05 | OrderItemMercadoLibre.imagesUrls primary |
| BUG-022 | `q()` helper traga errores de schema | Mitigado | Logging mejorado + columnas verificadas |
| BUG-023 | `MercadoLibreUserAccount.userId` no existe (causaba GMV=$0) | Fixed · sprint 13-16/05 | Query usa `OML.userId` + `MLA.mlUserId via User` |
| BUG-024 | `PaymentMercadoLibre.totalAmount` no existe (causaba SUM fallido) | Fixed · sprint 13-16/05 | Usa `OML.totalAmount` directo |
| BUG-025 | SKU Omnichannel Unidrop mostraba "Sin ventas" siempre | Fixed · sprint 13-16/05 | columnas `sellerSku`, `tienda_nube_order_id` |

### 🟡 Pendiente

| ID | Story | Notas |
|---|---|---|
| US-1101 | Meta Ads integration (sync spend + métricas) | **Pending** · esperando token + ad account IDs de Tomi. Plan: tablas `meta_ad_accounts/campaigns/adsets/ads/insights_daily` + sync diario 1am ART + MCP tools |

---

## Decisiones arquitectónicas clave

1. **PaymentIntent es ground truth para actividad Unidrop**. OrderMercadoLibre y tienda_nube_orders se usan solo para enriquecimiento.

2. **Linkage canónico dropshipper ↔ orden = `number LIKE 'DROP-{dni}-%'`**, NO user_id (para tablas operativas TN). Para OML usar `OML.userId` directo (link nuevo) o vía `User.mercadoLibreAccountId → MLA.id → MLA.mlUserId → OML.sellerId` (link viejo).

3. **`OML.totalAmount` es la fuente de verdad para GMV per-order**. NO usar `PaymentMercadoLibre.totalAmount` (no existe, es `transaction_amount`).

4. **`MercadoLibreUserAccount` NO tiene columna `userId`**. El link a User es via `User.mercadoLibreAccountId = MLA.id`. Queries que usaban `mla.userId` fallaban silenciosamente.

5. **`OrderItemMercadoLibre`: `sellerSku` (camelCase, lowercase 'k'), `orderId` (FK OML.id), `unitPrice`, `unitCost`, `orderType`, `imagesUrls` (JSONB)**. NO existen `sellerCustomField`, `mlOrderId`, `type`, `cost`.

6. **`tienda_nube_order_items.tienda_nube_order_id`** (no `order_id`) → join con `tienda_nube_orders.tienda_nube_id`.

7. **Gerencia es un rol (`role='gerencia'`), no un área**. Admin se puede ser por `role='admin'` (legacy) o `is_admin=TRUE` (flag nuevo, permite gerencia+admin).

8. **Timezone Argentina forzado en toda la app**. PG connection + frontend `fmtArDateTime()`.

9. **NLP lexicon-based, no embeddings**. 9 clusters cancelaciones + 12 devoluciones.

10. **Contabilium invoice linkage:** `ContabilliumInvoice.idVentaIntegracion` matchea con `OML.id` (ML) o `tienda_nube_orders.tienda_nube_id` (TN). `linkPublico` es URL directa a la factura. 3789 invoices linkeadas en la BD.

11. **Etiqueta PDF storage:** `OML.etiqueta_pdf_base64` (924 rows · ML FLEX/PR/Full), `oca_shipments.etiqueta_pdf_base64` (80), `lightdata_shipments.etiqueta_pdf_base64` (37). Endpoint serving via `GET /api/dashboards/orders/{ml|tn}/{id}/label`.

12. **MCP architecture:** stdio singleton + HTTP/SSE per-request via `contextvars.ContextVar`. Middleware Starlette extrae `Authorization: Bearer` y lo deposita en contextvar; `get_client()` lo lee. En stdio cae al singleton con env var. Concurrencia testeada — 3 requests paralelos no se pisan.

---

## Stack del repositorio (actualizado · sprint 13-16/05)

```
unidata-pro/
├── backend/                          # FastAPI 0.115
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py               # login + register + 2FA + mcp-token
│   │   │   ├── admin.py
│   │   │   ├── notifications.py
│   │   │   ├── cs_actions.py
│   │   │   ├── dropshipper_notes.py  # NUEVO · sprint 13-16/05
│   │   │   ├── reminders.py          # NUEVO · sprint 13-16/05
│   │   │   ├── dashboards/routers.py # + label download endpoints
│   │   │   ├── drilldowns.py
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── dropshippers.py       # MASSIVE refactor 13-16/05 (~2700 líneas)
│   │   │   ├── end_consumers_unidrop.py # extendido a TN+ML
│   │   │   ├── sku_omnichannel.py    # queries Unidrop arregladas
│   │   │   └── ...
│   │   └── db/
│   │       ├── engines.py
│   │       ├── users_db.py
│   │       ├── notifications_db.py
│   │       ├── cs_actions_db.py
│   │       ├── dropshipper_notes_db.py # NUEVO
│   │       ├── reminders_db.py       # NUEVO
│   │       └── ...
│   └── main.py                       # routers nuevos registrados
├── frontend/                         # Next.js 16 + React 19 + Tailwind 4
│   ├── app/dashboard/
│   │   ├── dropshipper/[id]/page.tsx # ~2000 líneas, modal+tabla+analytics
│   │   ├── productos/[sku]/page.tsx  # con SKU omnichannel arreglado
│   │   ├── account/page.tsx          # + sección MCP token con walkthrough
│   │   ├── admin/users/page.tsx
│   │   └── ...
│   └── components/
│       ├── sidebar.tsx               # respeta is_admin además de role
│       └── ...
├── mcp/                              # NUEVO · paquete Python MCP server
│   ├── unidata_mcp/
│   │   ├── server.py                 # FastMCP + 24 tools
│   │   ├── client.py                 # httpx async
│   │   ├── config.py
│   │   ├── http_server.py            # Starlette + AuthMiddleware + ctx vars
│   │   └── __main__.py
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── railway.toml
│   └── README.md
└── docs/
```

---

**Última actualización:** 16/05/2026 · cierre sprint Dropshipper 360 V2 + MCP server + schema fixes + omnicanal + analytics combo.
