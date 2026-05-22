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

## Qué entrega la primera versión

`services/wholesale_elasticity.py::wholesale_sku_table(period_days, limit)` devuelve, por SKU:

- Unidades + revenue + precio promedio en cada uno de los 4 canales
- `precio_mayorista_avg` = avg de `unitCost` en Unidrop ML
- `precio_retail_unistore_avg` = avg de precio retail propio (TN + ML promediados)
- `precio_retail_unidrop_avg` = avg de precio retail del dropshipper (TN + ML promediados)
- `spread_retail_pct` = cuánto más caro (o barato) vende el dropshipper vs Unistore directo
- `margen_drp_ml_pct` = margen bruto del dropshipper en MELI

Endpoint: `GET /api/dashboards/products/wholesale-table?period_days=90&limit=200`
Frontend: `/dashboard/productos/omnicanal`

## Qué FALTA — roadmap

### 1. Curva precio-volumen mayorista por SKU

Para estimar elasticidad real (¿cuánto cambia el volumen Unidrop cuando Unistore sube el PVP mayorista?) necesitamos serie temporal de `unitCost` agregada por mes y por SKU, cruzada con unidades movidas:

```sql
SELECT DATE_TRUNC('month', o."dateCreated") AS mes,
       oi."sellerSku",
       AVG(oi."unitCost")  AS precio_mayorista_avg,
       SUM(oi.quantity)    AS unidades_mes
FROM mercado_libre_dev."OrderItemMercadoLibre" oi
JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
WHERE o."dateCreated" >= NOW() - INTERVAL '12 months'
GROUP BY 1, 2
```

Después regresión simple `ln(unidades) ~ ln(precio_mayorista)` por SKU → coeficiente = elasticidad.

### 2. Detectar cambios escalón de `unitCost`

Cuando Unistore sube su PVP mayorista, suele ser un escalón discreto (un día se cambia el precio interno y todos los dropshippers nuevos lo ven). Detectar esos puntos y medir el impacto sobre el volumen del mes siguiente sería mucho más limpio que regresión cruda.

### 3. SKUs con mapeo cross-canal no trivial

Hay casos donde el mismo producto físico tiene SKU distinto entre canales (legacy, refactor de codificación, variantes). La función actual asume que `sku` matchea exacto. Si no, el SKU aparece como "solo Unistore" o "solo Unidrop" cuando en realidad es el mismo producto.

Necesitamos una tabla de equivalencias `sku_omnichannel_map(sku_canonical, channel, sku_canal)` y joinear contra eso, no contra el string del SKU directamente.

### 4. Canal suscripciones MELI Unidrop

Existe un quinto canal: las suscripciones MELI que Unidrop vende a los dropshippers. Si la suscripción está asociada a SKU del catálogo (planes con descuento sobre productos específicos), habría que sumarlo.

### 5. Comparación elasticidad retail vs mayorista

Una vez calculada la elasticidad mayorista (cómo Unidrop reacciona al precio que paga), compararla con la elasticidad retail de Unistore (cómo el consumidor final reacciona al precio Unistore directo). Si la mayorista es menor que la retail, Unistore tiene poder de pricing sobre los dropshippers (subir precio sin perder volumen). Si es mayor, los dropshippers cambian fácil de fuente.

## Decisiones de diseño

- **Una sola query maestra cross-canal por canal** (cuatro queries totales). Mergeo en Python en vez de hacer un join SQL cross-database imposible (los dos engines son DBs separadas).
- **`limit=200` por default**: la tabla con todos los SKUs sería >1000 filas y el promedio del usuario solo le importa lo top. Si hace falta, se puede subir el query param.
- **Cache 60s** en el endpoint igual que el resto del dashboard.
- **Permission**: `require_area(["ventas", "compras", "finanzas"])`.

## Schema gotchas relevantes

(Ver también `CLAUDE.md` raíz para el catálogo completo)

- `OrderItemMercadoLibre.sellerSku` es camelCase (NO `sellerSKU` ni `seller_sku`).
- `OrderItemMercadoLibre.unitCost` y `OrderItemMercadoLibre.unitPrice` existen y son los campos clave acá.
- `tienda_nube_orders.payment_status` es enum; comparar como `::text = 'paid'`.
- `tienda_nube_order_items.order_id` joinea contra `tienda_nube_orders.tienda_nube_id` (NO contra `id`).
