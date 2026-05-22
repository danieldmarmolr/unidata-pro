# Análisis omnicanal mayorista de productos

## Contexto

Unistore vende los mismos SKUs en cuatro puntos distintos del grupo:

| Canal | Rol | Schema | Tabla items | Tabla orders |
|---|---|---|---|---|
| **Unistore TN** | Retail propio | `unistore_api.tienda_nube` | `OrderItem` | `Order` |
| **Unistore MELI** | Retail Fox Electronics | `unistore_api.meli` | `meli_order_items` | `meli_orders` |
| **Unidrop TN** | Dropshippers reventa | `unidrop_api.public` | `tienda_nube_order_items` | `tienda_nube_orders` |
| **Unidrop MELI** | Dropshippers reventa | `unidrop_api.mercado_libre_dev` | `OrderItemMercadoLibre` | `OrderMercadoLibre` |

El caso especial es **Unidrop**: los dropshippers compran a Unistore (a precio mayorista) y revenden a su cliente final. Por eso `OrderItemMercadoLibre` tiene dos campos clave:

- **`unitCost`** = precio mayorista que el dropshipper pagó a Unistore por la unidad
- **`unitPrice`** = precio retail que el dropshipper le cobró al consumidor final

La diferencia `unitPrice - unitCost` es el margen bruto del dropshipper. Y `unitCost` es el ingreso mayorista de Unistore por esa venta.

## Vista en producción — qué hay disponible

`/dashboard/productos/omnicanal` tiene 4 sub-tabs:

### Tab 1 — Tabla SKU cross-canal
Endpoint: `GET /api/dashboards/products/omnicanal-table?period=...&from=...&to=...`

Una fila por SKU activo en el período seleccionado (respeta el selector global HOY/AYER/7d/30d/90d/12m/Personalizado). Sin límite duro; el frontend pagina cliente (150 + "ver más"). 17 columnas con tooltips:

- Volumen + share `% Unistore` y `% Unidrop` (sortable, separadas)
- Costo de importación (`cost_index_unistore`)
- Precio retail Unistore promedio (ponderado por unidades TN+ML)
- Precio retail Unidrop promedio (ponderado por unidades TN+ML)
- Precio mayorista promedio = avg de `unitCost` ML + `cost` TN del dropshipper
- Markup retail Unistore, markup mayorista, markup DRP
- Margen retail Unistore (vía `calc_profit`, descontando IVA + comisiones + gateway)
- Margen dropshipper, spread retail
- Ganancia retail Unistore, ganancia mayorista, ganancia total
- Imagen + EAN del producto

KPIs superiores (6): SKUs activos · Unidades total · Revenue retail Unistore · Ganancia mayorista · Ganancia total Unistore · Margen DRP promedio.

Filtros chip (11): Todos / Ambos / Solo Uni / Solo Drp / Dominante ≥70% por lado / Con costo importación / Con dato mayorista / Margen DRP alto-bajo / Spread positivo-negativo.

### Tab 2 — Elasticidad retail vs mayorista
Endpoints:
- `GET /api/dashboards/products/elasticity-comparison?months=12&top_n=80&min_units=20` — tabla
- `GET /api/dashboards/products/wholesale-curve/{sku}?months=12` — drill por SKU

Por cada SKU con suficiente data (≥4 meses con varianza de precio + ≥20 unidades en el período), corre dos regresiones log-log:

- **Elasticidad retail** = `ln(unidades_unistore_tn) ~ a + b·ln(precio_retail_unistore)`
- **Elasticidad mayorista** = `ln(unidades_unidrop_ml) ~ a + b·ln(unitCost)`

Devuelve coeficiente `b` (elasticidad), `r²` y `n_points`. Compara las dos elasticidades:

- Mayorista significativamente más inelástica que retail → **Poder de pricing Unistore** (puede subir PVP mayorista sin perder volumen)
- Mayorista significativamente más elástica → **Riesgo churn dropshippers** (cualquier suba los hace cambiar de fuente)
- Diferencia chica → **Balanceado**

Click en una fila abre el drill con scatter precio-volumen de ambos canales lado a lado.

### Tab 3 — Cambios de precio mayorista (escalones)
Endpoint: `GET /api/dashboards/products/wholesale-steps?months=18&top_n=80&min_units_total=30`

Detecta puntos donde el `unitCost` promedio mensual cambia ≥5% vs el mes anterior (umbral configurable en `wholesale_steps.py::UMBRAL_CAMBIO_PCT`). Para cada cambio detectado:

- Precio anterior + precio nuevo + delta %
- Baseline de unidades = promedio de los 3 meses previos
- Impacto en volumen = (unidades del mes nuevo − baseline) / baseline

Permite ver retro si una suba de PVP mayorista produjo churn (impacto < −X%) o si una baja no produjo aumento de volumen (impacto ≈ 0% — baja no justificada).

Click una fila para expandir el historial completo de cambios del SKU.

### Tab 4 — Mapeo SKU cross-canal
Endpoint: `GET /api/dashboards/products/sku-equivalence?period_months=6&min_units=5`

Detecta SKUs huérfanos de Unidrop (no aparecen exactos en Unistore) y propone match candidato. Dos heurísticas:

1. **Alta confianza** (`alta_normalizado`): match exacto post-normalizar (uppercase + sin separadores). Ej `M25-N` ↔ `M25N`.
2. **Media confianza** (`media_prefijo_nombre`): prefijo común ≥4 chars + nombre del producto similar (distancia Levenshtein ≤5).

Devuelve propuestas para revisar/aceptar manualmente y poblar una tabla canónica `sku_omnichannel_map`.

KPIs: total Unistore activos, total Unidrop ML/TN activos, matches exactos, huérfanos por canal, propuestas total, propuestas alta confianza.

Filtros: por nivel de confianza + por canal de origen + buscador SKU/nombre. Export CSV/XLSX.

## Backend — archivos

- `backend/app/services/wholesale_elasticity.py` — tabla cross-canal (tab 1)
- `backend/app/services/wholesale_curve.py` — curva precio-volumen + comparación elasticidades (tab 2)
- `backend/app/services/wholesale_steps.py` — detección de cambios escalón (tab 3)
- `backend/app/services/sku_equivalence.py` — mapeo cross-canal de SKUs (tab 4)

Endpoints registrados en `backend/app/api/dashboards/routers.py`.

## Qué FALTA — roadmap

### Tabla canónica `sku_omnichannel_map`
La tab 4 propone matches automáticos, pero todavía no hay tabla en DB que los persista. Próximo paso: schema + endpoint POST para confirmar/rechazar propuestas + uso de esa tabla en el resto del análisis omnicanal (en vez de matching por string del SKU). Mientras tanto, el resto de las queries asumen string-match exacto.

### Canal suscripciones MELI Unidrop
Existe un quinto canal: las suscripciones MELI que Unidrop vende a los dropshippers. Si la suscripción está asociada a SKU del catálogo (planes con descuento sobre productos específicos), habría que sumarlo.

### Detectar promociones / outliers en la regresión
La regresión log-log asume relación monotónica entre precio y volumen. Si hay meses con promoción agresiva (precio bajo + volumen explosivo) la elasticidad sale exagerada. Considerar filtrar outliers o agregar variable dummy de "mes con promo".

### Forecast post-suba PVP mayorista
Con la elasticidad mayorista estimada + un cambio de PVP propuesto, predecir el volumen Unidrop esperado en los próximos 3 meses. Útil para decidir cuándo subir un PVP mayorista.

## Schema gotchas relevantes

(Ver también `CLAUDE.md` raíz para el catálogo completo)

- `OrderMercadoLibre.status` (NO `estado`). Valores reales: `'paid'`, `'cancelled'`, `'partially_refunded'`.
- `OrderItemMercadoLibre.sellerSku` es camelCase (NO `sellerSKU` ni `seller_sku`).
- `OrderItemMercadoLibre.unitCost` y `OrderItemMercadoLibre.unitPrice` son los campos clave del análisis mayorista.
- `tienda_nube_orders.payment_status` es enum; comparar como `::text = 'paid'`.
- `tienda_nube_order_items.order_id` joinea contra `tienda_nube_orders.tienda_nube_id` (NO contra `id`).
- `tienda_nube_order_items.cost` existe (precio mayorista TN), usado por tab 1 para el dato mayorista TN.
