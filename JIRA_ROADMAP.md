# UNIDATA — Roadmap (Epic única + User Stories)

**Producto:** Plataforma de datos del Grupo Unistore (Unistore + Unidrop + Unidev)
**Stack:** FastAPI + Next.js 16 + PostgreSQL (Supabase + AWS RDS via SSH bastión)
**Deploy:** Railway (backend + frontend) + Cloudflare DNS
**URLs producción:**
- `https://app.unidatacenter.com.ar` (frontend)
- `https://api.unidatacenter.com.ar` (backend)
- Fallback Railway: `https://frontend-production-7d1c.up.railway.app`

---

## EPIC UNIDATA

**Owner:** Daniel Marmol
**Estado:** En curso (producción)
**Convención:** todas las funcionalidades son **User Stories** dentro de esta única épica. No hay sub-epics, no hay milestones intermedios. Cada feature = 1 story que pasa de Backlog → In Progress → Done.

---

## Resumen ejecutivo · 12/05/2026

| Métrica | Valor |
|---|---|
| Stories totales | 96 |
| Stories Done | 92 |
| Stories pendientes | 4 |
| Bugs críticos resueltos | 18 |
| Últimos 14 días | 35 stories Done |
| Avance global | ~96% |

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
| US-010 | Engines SQLAlchemy reutilizables por unidad (unistore/unidrop/unidev) | Done | TTLCache |
| US-011 | Deploy automatizado via Railway CLI (`railway up --path-as-root`) | Done | |
| US-012 | DNS unidatacenter.com.ar delegado a Cloudflare (corey/miki) | Done | nic.ar processed |
| US-013 | SSL Let's Encrypt para app.unidatacenter.com.ar | Done | port 8080 fix |
| US-014 | SSL Let's Encrypt para api.unidatacenter.com.ar | Done | port 8080 fix backend |
| US-015 | CORS regex permite *.unidatacenter.com.ar | Done | |

### 🟢 Dashboard gerencial cross-unidad (/dashboard)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-101 | Página /dashboard "Gerencia" con KPIs ejecutivos | Done | Renombrada de "Gerencial" |
| US-102 | Comparador HOY (vs 7d/30d/365d) con bloques contextuales | Done | context=default/cs |
| US-103 | Filtros HOY/AYER/7d/30d/90d/12m/Personalizado afectan todo | Done | period_label dinámico |
| US-104 | Mix de revenue · 5 fuentes reales (TN/ML Unistore + TN/ML Unidrop + Suscripciones) | Done | sin "Talo pagos" (doble conteo) |
| US-105 | Trend chart 12 meses con 5 series (TN/ML Unistore + TN/ML/Subs Unidrop) | Done | |
| US-106 | Salud por unidad de negocio (Unistore + Unidrop + Unidev) | Done | métricas dinámicas por periodo |
| US-107 | Card "Facturado a Unidrop" (PaymentIntent ground truth) | Done | nueva card |
| US-108 | Análisis Unidev: top causas + resoluciones + SKUs más devueltos | Done | bloque rosa nuevo |
| US-109 | Drilldowns Unidrop separados (NO mezclan con Unistore) | Done | /unidrop/orders-tn /orders-ml /intents-processed |
| US-110 | Salud de integraciones (TN/ML/digip/contabilium/talo/webhooks) | Done | |
| US-111 | Alertas operativas (pedidos atascados, suscripciones próximas a vencer, publicaciones con error) | Done | |
| US-112 | Reporte ejecutivo mensual PDF descargable | Done | |

### 🟢 Customer Success (/dashboard/cs)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-201 | Vista general CS con KPIs (retención, churn, cancelaciones, refunds) | Done | |
| US-202 | Análisis de cohortes (Nuevo → 2da → Recurrente → Recuperado) | Done | con alertas Posible churn / Perdidos |
| US-203 | Cohortes drill inline (click etiqueta → tabla arriba) | Done | reemplaza modal |
| US-204 | Cohortes para Unidrop (dropshippers como clientes) | Done | PaymentIntent ground truth |
| US-205 | Segmentación RFM con quintiles + 11 segmentos | Done | Champions, Loyal, At Risk, etc |
| US-206 | RFM aplicado a Unidrop (dropshippers) | Done | PaymentIntent ground truth |
| US-207 | RFM Flows · migración mes a mes entre segmentos | Done | alertas de fuga y reactivación |
| US-208 | Popup educativo por segmento RFM ("qué hacer") | Done | 11 acciones definidas |
| US-209 | Popup transición con lista de customers afectados | Done | drill desde RFM Flows |
| US-210 | NLP cancelaciones · clustering por keywords | Done | 9 clusters lexicon |
| US-211 | NLP devoluciones · clustering causas (12 categorías) | Done | top SKUs por causa + samples |
| US-212 | SmartSearch autocomplete en CS (compradores TN) | Done | |
| US-213 | Buscar clientes en /dashboard/clientes (Unistore + Unidrop) | Done | fix MELI nickname + espacios |

### 🟢 Producto / SKU analytics

| ID | Story | Status | Notas |
|---|---|---|---|
| US-301 | Vista general producto (top SKUs, sin movimiento, stock crítico) | Done | |
| US-302 | Análisis ABC + más (categorización A/B/C por revenue) | Done | |
| US-303 | ABC con unit=unidrop (catálogo dropshipping) | Done | |
| US-304 | SKU Optimizer · combos + reposición + liquidar + pricing | Done | recomendaciones accionables |
| US-305 | SKU Optimizer cards-filtro clickeables | Done | UX mejora |
| US-306 | SKU Optimizer con unit=unidrop | Done | notas amarillas: stock vive en Unistore |
| US-307 | Forecast batch 30/60d con PO sugerida + alertas stockout | Done | media móvil + factor tendencia |
| US-308 | Producto 360 (/dashboard/productos/[sku]) | Done | KPIs + ventas mensuales + clientes |
| US-309 | SKU Omnichannel · 4 canales orquestados (Unistore TN/ML + Unidrop TN/ML) | Done | inconsistencias detectadas |
| US-310 | SmartSearch autocomplete en Producto | Done | |

### 🟢 Unidrop (SaaS de dropshippers)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-401 | SaaS Metrics (usuarios, suscripciones, MRR, churn) | Done | |
| US-402 | Dropshippers master list con filtros (plan/riesgo/actividad/canal) | Done | |
| US-403 | Dropshipper 360 (vista completa por user_id) | Done | KPIs MELI + TN + Pagos + Publicaciones |
| US-404 | Dropshipper 360 · bloque "Ventas pagadas a Unidrop" TN/ML | Done | PaymentIntent.paidAmount split |
| US-405 | Dropshipper 360 · suscripciones Talo Pay (período + plan) | Done | PaymentTransactionSubscription |
| US-406 | Dropshipper 360 · ventas MELI desde mlOrderIds (no solo OML) | Done | Tienda Pini: 0→28 ventas |
| US-407 | Dropshipper 360 · tabla TN nueva con linkage `DROP-{dni}-{seq}` | Done | |
| US-408 | Dropshipper 360 · link a panel Unidrop por cada orden | Done | `panel/unified-orders?search=DROP-...` |
| US-409 | Pagos Talo: "Órdenes pagadas" en vez de "Transacciones" | Done | unfold mlOrderIds + orderIds |
| US-410 | Suscripciones MELI list page | Done | |
| US-411 | Envíos Unidrop (por modo MELI) | Done | |
| US-412 | RFM Flows con popups (Unidrop) | Pendiente | hoy solo Unistore |

### 🟢 Unidev (Devoluciones)

| ID | Story | Status | Notas |
|---|---|---|---|
| US-501 | Vista general devoluciones | Done | |
| US-502 | NLP causas devoluciones · /dashboard/dev-nlp | Done | 12 clusters + top SKUs |
| US-503 | Análisis devoluciones en Gerencia (causas + resoluciones + SKUs) | Done | nuevo bloque rosa |

### 🟢 Onboarding y comunidad interna

| ID | Story | Status | Notas |
|---|---|---|---|
| US-601 | DB migration: tabla areas + columnas perfil en users | Done | idempotente |
| US-602 | Seed 9 áreas operativas (sin Gerencia · es ROL) | Done | Admin/Compras/Finanzas/Ventas/Logística/CS/Marketing/People/IT-Data |
| US-603 | Onboarding modal al primer login (4 pasos) | Done | área + cumple + aniversario + opcionales |
| US-604 | Página /dashboard/perfil para editar después | Done | |
| US-605 | Stories panel en /home (cumples + aniversarios del mes) | Done | banner ámbar |
| US-606 | Sidebar entry "Mi perfil" en grupo Principal | Done | |
| US-607 | Admin asigna `role=gerencia` desde /admin/users (cross-area access) | Done | |
| US-608 | RBAC enforcement por área (colaboradores ven solo su área) | Pendiente | infraestructura lista, falta enforcement |

### 🟢 Fixes críticos y bugs resueltos

| ID | Bug | Resolución | Notas |
|---|---|---|---|
| BUG-001 | MRR Unidrop $0 por bug de schema | Fixed | mercado_libre_dev → public |
| BUG-002 | Tienda Pini "0 ventas MELI" con $1M pagos | Fixed | PaymentIntent ground truth + linkage DROP-{dni} |
| BUG-003 | Cohortes Unidrop devolvía 0/0/0 todos los segmentos | Fixed | PaymentIntent ground truth |
| BUG-004 | RFM Unidrop devolvía 0 customers | Fixed | misma raíz |
| BUG-005 | RFM Flows popup decía "Sin clientes" con count > 0 | Fixed | bug SQLAlchemy `:ids::int[]` |
| BUG-006 | Buscar dropshippers no encontraba "tiendapi" | Fixed | + MELI nickname + collapse spaces |
| BUG-007 | NameError `log` en search_customers.py | Fixed | import logging faltante |
| BUG-008 | Header "Datos al" mostraba hora del browser | Fixed | timeZone AR forzado |
| BUG-009 | Drilldowns Unidrop "GMV TN/ML" mostraban Unistore | Fixed | endpoints separados + routing en kpi-drill |
| BUG-010 | Filtros de fecha en Gerencia con label "(mes)" hardcoded | Fixed | period_label dinámico en todos los cards |
| BUG-011 | Pagos Talo contaba transacciones en vez de órdenes | Fixed | unfold de arrays mlOrderIds + orderIds |
| BUG-012 | Gerencia mostraba "GMV Unidrop $0" cuando OML estaba desincronizado | Fixed | + Facturado a Unidrop card |
| BUG-013 | Backend SSL 502 por port 5433 (debería 8080) | Fixed | edit custom domain port en Railway |
| BUG-014 | Cohortes inline mostraba filas con todos los campos en 0 | Fixed | endpoint devuelve customers[] + rows[] |
| BUG-015 | Productos analytics React Error #310 (conditional hook) | Fixed | useSkuEnrichment movido antes del early return |
| BUG-016 | DNS nic.ar tardó 24+ hs en aprobar delegación | Resolved | propagado, Cloudflare active |
| BUG-017 | Cloudflare puso CNAMEs en proxy ON post-Connect | Fixed | manually changed to DNS only |
| BUG-018 | Dropshippers list mostraba "0 ventas" para muchos dropshippers | Fixed | MAX(OML.count, PaymentIntent.count) |

### 🟡 Pendiente

| ID | Story | Notas |
|---|---|---|
| US-412 | RFM Flows toggle Unidrop | Hoy solo Unistore funciona |
| US-608 | RBAC enforcement por área | Infraestructura lista (areas + role), falta filtrado |
| US-XXX | Sistema notificaciones in-app (banner + bandeja "marcar revisada") | Diseñado, no implementado |
| US-XXX | Apex redirect `unidatacenter.com.ar` → `app.unidatacenter.com.ar` | En curso · Cloudflare Redirect Rule |

---

## Decisiones arquitectónicas clave

1. **PaymentIntent es ground truth para actividad Unidrop**. OrderMercadoLibre y tienda_nube_orders se usan solo para enriquecimiento. Esto resuelve el problema de dropshippers cuyas ventas no están sincronizadas en las tablas operativas.

2. **Linkage canónico dropshipper ↔ orden = `number LIKE 'DROP-{dni}-%'`**, NO user_id. Replica exactamente la convención del panel Unidrop. Cada orden mostrada en UNIDATA tiene link directo a `https://www.unidrop.com.ar/panel/unified-orders?search=...`.

3. **Gerencia es un rol (`role='gerencia'`), no un área**. Cualquier user marcado tiene acceso a TODAS las áreas + el dashboard de Gerencia. Áreas operativas quedaron en 9 (Admin/Compras/Finanzas/Ventas/Logística/CS/Marketing/People/IT-Data).

4. **Timezone Argentina forzado en toda la app**. PG connection: `timezone=America/Argentina/Buenos_Aires`. Frontend: `fmtArDateTime()` con `timeZone: "America/Argentina/Buenos_Aires"` explícito.

5. **NLP lexicon-based, no embeddings**. 9 clusters para cancelaciones, 12 para devoluciones. Diseño robusto y suficiente para el volumen actual. Cuando UNIDATA tenga una fuente de texto más rica (chat CS, emails), se puede extender.

6. **Cloudflare en modo DNS only durante el provisioning de SSL en Railway**. Una vez que ambos certs queden Active, se puede prender proxy (orange) para ganar caching/CDN, pero requiere SSL mode = "Full (strict)" en Cloudflare.

---

## Stack del repositorio

```
unidata-pro/
├── backend/                      # FastAPI 0.111
│   ├── app/
│   │   ├── api/                  # Endpoints REST
│   │   │   ├── dashboards/       # routers + executive + sales
│   │   │   ├── admin.py          # CRUD users (admin only)
│   │   │   ├── auth.py           # login + register
│   │   │   ├── drilldowns.py     # tablas de detalle
│   │   │   └── profile.py        # /api/users/me, /areas, /stories
│   │   ├── services/             # Lógica de negocio
│   │   │   ├── cohorts_analytics.py
│   │   │   ├── rfm_analytics.py
│   │   │   ├── rfm_flows.py
│   │   │   ├── cancel_nlp.py
│   │   │   ├── dev_nlp.py        # NUEVO
│   │   │   ├── dropshippers.py
│   │   │   ├── sku_omnichannel.py
│   │   │   ├── sku_optimizer.py
│   │   │   ├── forecast_batch.py
│   │   │   └── ...
│   │   └── db/
│   │       ├── engines.py        # SSH tunnels + SQLAlchemy
│   │       ├── users_db.py       # auth + roles
│   │       └── areas_db.py       # NUEVO
│   └── main.py
└── frontend/                     # Next.js 16 + Tailwind
    ├── app/dashboard/
    │   ├── page.tsx              # Gerencia (cross-unidad)
    │   ├── home/page.tsx         # Home con Stories
    │   ├── perfil/page.tsx       # NUEVO
    │   ├── cohortes/page.tsx
    │   ├── rfm/page.tsx
    │   ├── rfm-flows/page.tsx
    │   ├── cancel-nlp/page.tsx
    │   ├── dev-nlp/page.tsx      # NUEVO
    │   ├── sku-optimizer/page.tsx
    │   ├── forecast/page.tsx
    │   ├── productos/[sku]/page.tsx  # con SkuOmnichannel
    │   ├── dropshippers/page.tsx
    │   ├── dropshipper/[id]/page.tsx # con linkage DROP-{dni}
    │   └── ...
    └── components/
        ├── onboarding-modal.tsx  # NUEVO
        ├── stories-panel.tsx     # NUEVO
        ├── sku-omnichannel.tsx   # NUEVO
        ├── cohort-inline-table.tsx # NUEVO
        └── ...
```

---

**Última actualización:** 12/05/2026 · final de sesión deploy Cloudflare + SSL + NLP devoluciones + alineación Unidrop.
