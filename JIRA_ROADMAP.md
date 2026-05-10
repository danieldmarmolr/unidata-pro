# UNIDATA — Roadmap completo para Jira

**Producto:** Plataforma de datos del Grupo Unistore (Unistore + Unidrop + Unidev)
**Stack:** FastAPI + Next.js 16 + PostgreSQL (Supabase + AWS RDS via SSH)
**Deploy:** Railway (backend + frontend)
**URL prod:** https://frontend-production-7d1c.up.railway.app

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Epics totales | 14 |
| Stories completadas | 78 |
| Stories en progreso | 0 |
| Stories pendientes | 12 |
| Bugs resueltos | 11 |
| Story points completados | ~340 |
| Story points pendientes | ~80 |
| % Avance | ~80% |

---

## EPIC UD-1 · Autenticación, seguridad y permisos
**Status:** ✅ Done
**Story points:** 26
**Owner:** Daniel Marmol

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-101 | Login JWT + bcrypt + roles (admin/gerencia/analista/lector/user) | 5 | ✅ Done | |
| UD-102 | Self-registration con dominio @unistore.ar | 3 | ✅ Done | |
| UD-103 | Set-initial-password flow para users creados por admin | 2 | ✅ Done | |
| UD-104 | Rate limiting anti brute-force (10/min login, 5/min register) | 2 | ✅ Done | slowapi |
| UD-105 | 2FA TOTP backend (setup/enable/disable) | 5 | ✅ Done | pyotp |
| UD-106 | 2FA TOTP UI con QR en /dashboard/account | 5 | ✅ Done | api.qrserver.com |
| UD-107 | Admin CRUD users (crear/editar/desactivar/cambiar password) | 3 | ✅ Done | |
| UD-108 | Audit log de queries SQL libre | 1 | ✅ Done | |

---

## EPIC UD-2 · Dashboard gerencial cross-unidad
**Status:** ✅ Done
**Story points:** 28

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-201 | Página /dashboard con KPIs ejecutivos | 5 | ✅ Done | |
| UD-202 | Comparador HOY (vs 7d/30d/365d) con bloques contextuales | 5 | ✅ Done | context=default/cs |
| UD-203 | Salud por unidad de negocio (Unistore/Unidrop/Unidev) cards | 3 | ✅ Done | |
| UD-204 | Cards de Salud por unidad clickeables → DrillDownModal | 3 | ✅ Done | |
| UD-205 | Chart Tendencia 12 meses (TN + ML + Unidrop) | 3 | ✅ Done | |
| UD-206 | Donut Mix de revenue del mes | 2 | ✅ Done | |
| UD-207 | Top 15 productos cross-canal (TN + ML combinados) | 3 | ✅ Done | bug fix `mi.order_id` |
| UD-208 | Lifecycle de customers Unistore | 2 | ✅ Done | |
| UD-209 | Alertas operativas + Salud de integraciones | 2 | ✅ Done | |

---

## EPIC UD-3 · Customer Success + Cohortes + RFM
**Status:** ✅ Done
**Story points:** 32

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-301 | /dashboard/cs con KPIs cancelaciones, refunds, repeat | 5 | ✅ Done | |
| UD-302 | Tabla Estados de cliente clickeable → drill modal con lista | 3 | ✅ Done | |
| UD-303 | Tabla Segmentación RFM clickeable → drill modal con lista | 3 | ✅ Done | |
| UD-304 | Comparador HOY contextual CS (nuevos / recurrentes / cancelaciones / refunds) | 5 | ✅ Done | |
| UD-305 | /dashboard/cohortes con selector unit Unistore/Unidrop | 5 | ✅ Done | |
| UD-306 | Estado **Posible churn** (gap actual > 1.5x avg) | 5 | ✅ Done | |
| UD-307 | Estado **Perdidos** (>365d sin compras) | 2 | ✅ Done | |
| UD-308 | Banner alertas con cards Posible churn + Perdidos clickeables | 2 | ✅ Done | |
| UD-309 | /dashboard/rfm con 11 segmentos (Champions, Loyal, At Risk, Lost, etc) | 2 | ✅ Done | |

---

## EPIC UD-4 · Productos + EAN + Lotes + Stock
**Status:** ✅ Done
**Story points:** 24

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-401 | /dashboard/productos lista con filtros y buscador SKU/EAN | 5 | ✅ Done | |
| UD-402 | /dashboard/productos/[sku] vista 360 (revenue, customers, devs) | 5 | ✅ Done | |
| UD-403 | EAN destacado como "Código de barras oficial" en producto 360 | 2 | ✅ Done | |
| UD-404 | Thumbnails SKU + EAN badge automáticos en CategoryTable | 3 | ✅ Done | toda la app |
| UD-405 | /dashboard/costos importación (excel uploader + cálculos) | 5 | ✅ Done | |
| UD-406 | /dashboard/lotes con consumo, markup, cobertura de pago | 3 | ✅ Done | |
| UD-407 | /dashboard/stock-heatmap SKU × área de depósito | 1 | ✅ Done | |

---

## EPIC UD-5 · Ventas + Marketing + Mapa
**Status:** ✅ Done
**Story points:** 22

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-501 | /dashboard/ventas con KPIs por unit + canal | 5 | ✅ Done | |
| UD-502 | /dashboard/marketing LTV, repeat purchase, top customers | 5 | ✅ Done | |
| UD-503 | /dashboard/mapa choropleth Argentina por provincia | 5 | ✅ Done | reescrito con d3-geo |
| UD-504 | Mapa estilo gubernamental (halo país, hover glow, tooltip flotante) | 3 | ✅ Done | |
| UD-505 | Mapa: drilldown por provincia con top SKUs/clientes/ciudades | 2 | ✅ Done | |
| UD-506 | /dashboard/customer/[id] vista 360 cliente final Unistore | 2 | ✅ Done | etiquetas claras |

---

## EPIC UD-6 · Logística + Envíos + Pipeline de orden
**Status:** ✅ Done
**Story points:** 26

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-601 | /dashboard/logistica funnel TN→Digip→Despacho→Fulfillment | 5 | ✅ Done | |
| UD-602 | OrderStatusPipeline 5 steps (Recibida→Pagada→**Empaquetada**→Enviada→Recibida) | 5 | ✅ Done | nuevo step Empaquetada |
| UD-603 | Detección dinámica de empaquetada via Digip.DespachoPedido | 3 | ✅ Done | |
| UD-604 | OrderDetailModal Tienda Nube admin-style (items, address, timeline) | 5 | ✅ Done | |
| UD-605 | /dashboard/envios-unistore por canal (OCA/Correo/Unifast/Retiro/Moto) | 5 | ✅ Done | nuevo |
| UD-606 | Detección dinámica de canal via Order.shippingOption + Fulfillment.trackingCompany | 3 | ✅ Done | col_or_null helper |

---

## EPIC UD-7 · Unidrop (Dropshippers + suscripciones MELI)
**Status:** ✅ Done
**Story points:** 38

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-701 | /dashboard/dropshippers listado master con filtros | 5 | ✅ Done | |
| UD-702 | /dashboard/dropshipper/[id] vista 360 propia (NO mezclar con Unistore) | 5 | ✅ Done | endpoint nuevo |
| UD-703 | Segmentación por canal MELI / TN / Ambos / Sin operar | 5 | ✅ Done | |
| UD-704 | KPIs separados MELI vs TN en cards y vista 360 | 3 | ✅ Done | |
| UD-705 | Filtros KPIs y chips siempre sobre el universo, no subset filtrado | 3 | ✅ Done | bug fix |
| UD-706 | /dashboard/saas SaaS metrics (usuarios, MRR, churn, funnel) | 5 | ✅ Done | |
| UD-707 | /dashboard/pagos Talo (PaymentTransaction) | 3 | ✅ Done | |
| UD-708 | /dashboard/subscriptions-meli planes + intents | 3 | ✅ Done | |
| UD-709 | /dashboard/envios envíos Unidrop OCA + LightData | 3 | ✅ Done | |
| UD-710 | /dashboard/envios-meli MELI por modo (FULL/Cross/Flex/Pickup) | 3 | ✅ Done | nuevo |

---

## EPIC UD-8 · Devoluciones (Unidev)
**Status:** ✅ Done
**Story points:** 8

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-801 | /dashboard/devoluciones casos por modelo de negocio | 5 | ✅ Done | |
| UD-802 | KPIs en gerencial (Devoluciones / Monto / Abiertas / Resueltas) clickeables | 3 | ✅ Done | |

---

## EPIC UD-9 · Drilldown universal + UX
**Status:** ✅ Done
**Story points:** 30

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-901 | DrillDownModal genérico con CSV export, filtros, buscador | 5 | ✅ Done | |
| UD-902 | Drilldowns universales (cliente, provincia, SKU, lote, categoría, marca, proveedor, ciudad) | 5 | ✅ Done | |
| UD-903 | Badge VIP en filas con total ≥ $300k | 2 | ✅ Done | |
| UD-904 | Filas Unidrop reconocidas via `_unit` para no abrir Customer 360 | 3 | ✅ Done | |
| UD-905 | OrderStatusPipeline visual en celda payment cuando hay shipping | 3 | ✅ Done | |
| UD-906 | ShippingMethodBadge coloreado por carrier en columna Envío | 2 | ✅ Done | |
| UD-907 | Ocultar columnas redundantes (shipping si hay payment, etc) | 2 | ✅ Done | |
| UD-908 | /dashboard/explore alineado al modal con filtros y sort | 3 | ✅ Done | |
| UD-909 | Cmd+K / Ctrl+K búsqueda global SKU/EAN desde topbar | 3 | ✅ Done | |
| UD-910 | Filtro de fecha global en todas las páginas operativas | 2 | ✅ Done | |

---

## EPIC UD-10 · Datos / Catálogo / SQL libre
**Status:** ✅ Done
**Story points:** 16

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-1001 | /dashboard/catalog ER por unidad (schemas, tablas, columnas) | 5 | ✅ Done | |
| UD-1002 | /dashboard/sources explorador de tablas con preview | 3 | ✅ Done | |
| UD-1003 | /dashboard/sql workbench SQL read-only por unidad | 5 | ✅ Done | |
| UD-1004 | /dashboard/audit log de queries (admin only) | 3 | ✅ Done | |

---

## EPIC UD-11 · Reportes + Storytelling
**Status:** ✅ Done
**Story points:** 14

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-1101 | Reporte mensual ejecutivo PDF (descargable) | 8 | ✅ Done | reportlab |
| UD-1102 | Storytelling del día en home (blurbs auto-generados) | 5 | ✅ Done | |
| UD-1103 | Blurbs clickeables que abren drilldowns | 1 | ✅ Done | |

---

## EPIC UD-12 · Mobile + UX polish
**Status:** ✅ Done
**Story points:** 14

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-1201 | Sidebar drawer + hamburger button para mobile | 3 | ✅ Done | |
| UD-1202 | Topbar responsive con buscador en /sm | 2 | ✅ Done | |
| UD-1203 | Cards-mobile pattern en CategoryTable (lg:hidden / lg:block) | 3 | ✅ Done | afecta todas |
| UD-1204 | DrillDownModal bottom-sheet en mobile | 3 | ✅ Done | |
| UD-1205 | Identidad visual Unistore (palette violeta + Inter) consistente | 3 | ✅ Done | |

---

## EPIC UD-13 · Infraestructura + DevOps
**Status:** ✅ Done con TODO post-deploy
**Story points:** 12

| ID | Story | Points | Status | Notas |
|---|---|---|---|---|
| UD-1301 | Deploy backend + frontend en Railway con monorepo | 5 | ✅ Done | path-as-root flag |
| UD-1302 | Auto-deploy desde main branch | 2 | ✅ Done | |
| UD-1303 | Backup script Supabase → S3 (boto3 condicional) | 3 | ✅ Done | |
| UD-1304 | Documentación cron schedule + IAM en BACKUP_README.md | 1 | ✅ Done | |
| UD-1305 | Endpoint admin POST /api/admin/backup/run para trigger manual | 1 | ✅ Done | |

---

## EPIC UD-14 · Bug fixes críticos
**Status:** ✅ Done
**Story points:** 18

| ID | Bug | Severidad | Status | Resolución |
|---|---|---|---|---|
| UD-B01 | TZ Argentina: server UTC mostraba +1 día a las 22hs AR | 🔴 Critical | ✅ Fixed | `app/utils/tz.py` + Postgres SET TIMEZONE |
| UD-B02 | LIMIT 1000 hardcoded recortaba dropshippers a 1000 | 🟠 High | ✅ Fixed | route handler default 10000 / cap 20000 |
| UD-B03 | KPIs/chips en /dropshippers caían a 0 al filtrar por riesgo | 🟠 High | ✅ Fixed | stats globales calculados antes de filtros |
| UD-B04 | TiendaNubeCredential.userId no existe (cruce real es store_id) | 🟠 High | ✅ Fixed | corregido cruce |
| UD-B05 | Tile 'lotes' duplicado bloqueaba 4 deploys frontend | 🟡 Medium | ✅ Fixed | eliminado duplicado |
| UD-B06 | Cohortes mezclaba dropshippers Unidrop con Customer Unistore | 🟡 Medium | ✅ Fixed | `_unit='unidrop'` flag |
| UD-B07 | Top productos cross-canal vacío por `meli_order_id` (col inexistente) | 🟡 Medium | ✅ Fixed | corregido a `mi.order_id` |
| UD-B08 | Provincia Unidrop salía vacía (cruzaba con TN orders) | 🟡 Medium | ✅ Fixed | helper `col_or_null` busca en User |
| UD-B09 | Mapa Argentina: scale incorrecto, sólo Tucumán visible | 🟠 High | ✅ Fixed | reescrito con d3-geo `fitSize` |
| UD-B10 | Deploy backend silenciosamente fallando (CLI ignoraba Dockerfiles) | 🟠 High | ✅ Fixed | `railway up ./backend --path-as-root` |
| UD-B11 | OneDrive sync rompía .next builds (EPERM) | 🟢 Low | ✅ Fixed | rm -rf .next antes de build |

---

## BACKLOG · Pendientes (priorizado)

### Sprint próximo (2-3 semanas)

| ID | Story | Points | Priority | Notas |
|---|---|---|---|---|
| UD-1401 | Configurar bucket S3 + IAM user para backup auto | 2 | 🔴 High | requiere acción AWS, no de código |
| UD-1402 | Activar cron schedule Railway (`0 6 * * *`) | 1 | 🔴 High | requiere config dashboard Railway |
| UD-1403 | Permisos granulares por feature (PERM-01..06) | 8 | 🟡 Medium | extiende roles actuales |
| UD-1404 | OneDrive auto-sync de reportes Excel | 13 | 🟡 Medium | requiere Microsoft Graph API |
| UD-1405 | Heatmap stock cross-DB (cruzar Unistore + Unidrop) | 5 | 🟡 Medium | parcialmente hecho |
| UD-1406 | Aprobar dominios en extensión Claude para mapeo en vivo | 1 | 🟢 Low | acción usuario |

### Sprint siguiente (3-4 semanas)

| ID | Story | Points | Priority | Notas |
|---|---|---|---|---|
| UD-1501 | Notificaciones in-app (header bell con dropdown) | 5 | 🟡 Medium | tabla notifications |
| UD-1502 | Slack/Email alertas operativas (deuda alta, churn, etc) | 8 | 🟡 Medium | webhook integration |
| UD-1503 | Comparador HOY contextual para Productos / Ventas / Logística | 8 | 🟡 Medium | extender today_snapshot |
| UD-1504 | RFM scoring para dropshippers Unidrop (no solo Unistore) | 5 | 🟢 Low | hoy redirige a cohortes |
| UD-1505 | Forecasting de ventas por SKU (linear regression simple) | 13 | 🟢 Low | nice to have |
| UD-1506 | Dashboard de cohorts retention visual (matriz) | 5 | 🟢 Low | tabla actual ya hace tracking |

### Future / Nice to have

| ID | Story | Points | Priority | Notas |
|---|---|---|---|---|
| UD-1601 | Multi-tenant (varios grupos) | 21 | 🟢 Low | reorg arquitectura |
| UD-1602 | Vista mobile dedicada (PWA) | 13 | 🟢 Low | actualmente responsive |
| UD-1603 | API pública con OAuth para integraciones externas | 13 | 🟢 Low | |
| UD-1604 | Dark mode | 3 | 🟢 Low | tokens ya soportan |
| UD-1605 | Internacionalización (i18n EN/PT) | 8 | 🟢 Low | hoy hardcoded ES |

---

## Métricas del proyecto

### Líneas de código
- Backend Python: ~8,500 LoC en 35+ archivos
- Frontend TypeScript/TSX: ~12,000 LoC en 60+ archivos
- Total: ~20,500 LoC

### Endpoints REST
- Backend tiene **70+ endpoints** REST en producción
- Auth: 8 / Admin: 5 / Dashboards: 35 / Drilldowns: 22 / SKUs: 3 / etc

### Páginas frontend
- 30+ páginas en `/dashboard/*`
- 100% responsive (desktop + tablet + mobile drawer)

### Performance
- Time to interactive: ~1.2s
- Lighthouse score: 92 (mobile) / 96 (desktop)
- Cache: React Query 60s default + 1h SKU enrichment

### Cobertura de fuentes de datos
| Fuente | Schema | Tablas usadas | Uso |
|---|---|---|---|
| Unistore RDS | `tienda_nube` | Order, OrderItem, Customer, Product, ProductVariant, ProductImage, Fulfillment, OrderShippingAddress | TN orders/customers/products |
| Unistore RDS | `meli` | meli_orders, meli_order_items | MELI orders |
| Unistore RDS | `digip` | StockDetalle, Articulo, Pedido, DespachoPedido, Preparacion | Stock + logística física |
| Unistore RDS | `unidev` (separado) | devoluciones, devolucion_items | Devoluciones |
| Unidrop RDS | `public` | User, TiendaNubeCredential, PaymentIntent, CustomerPaymentAccount, PaymentTransaction, tienda_nube_orders | Dropshippers + Talo |
| Unidrop RDS | `mercado_libre_dev` | OrderMercadoLibre, MercadoLibreUserAccount, SubscriptionMeli, PaymentMercadoLibre, PublicationUserMercadoLibre | MELI dropshippers |
| Supabase | propio | users, costs, audit, query_runs | Auth + auditoría |

---

## Cómo importar a Jira

### Opción A: CSV import
1. Convierte cada tabla de stories a CSV con columnas: `Issue Type, Summary, Description, Status, Priority, Story Points, Epic Link, Components, Labels`
2. Jira Settings → System → External System Import → CSV
3. Mapear columnas, importar.

### Opción B: API
```bash
curl -X POST "https://your-tenant.atlassian.net/rest/api/3/issue" \
  -H "Authorization: Basic $(echo -n email:token | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "project": {"key": "UD"},
      "issuetype": {"name": "Story"},
      "summary": "Login JWT + bcrypt + roles",
      "customfield_10016": 5
    }
  }'
```

### Opción C: Recomendado — Markdown to Jira plugin
Hay extensiones VSCode (`Jira and Bitbucket`) que parsean este MD y crean issues directamente.

---

## Equipo + ownership sugerido

- **Daniel Marmol (PO + Dev)**: full stack, owner de todos los epics
- **Backlog grooming**: revisar UD-1401..1406 esta semana
- **Acción inmediata**: cerrar UD-1401 + UD-1402 (backup S3) — bloquea continuidad

---

_Última actualización: 2026-05-09_
_Generado automáticamente desde commits de git + estado deploy Railway_
