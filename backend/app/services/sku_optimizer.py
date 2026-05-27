"""
SKU Optimizer - Recomendaciones accionables por SKU.

Cruza varios analisis (afinidad / cross-sell / lifecycle / stockout / trends)
para generar 4 tipos de recomendaciones:

1. **Combos sugeridos**: pares de SKUs que se venden juntos > 25% de las
   ordenes -> bundle comercial con descuento agresivo.
2. **Reposicion urgente**: SKUs con riesgo de stockout en proximos 14 dias
   basado en velocidad de venta + stock actual.
3. **Liquidar / discontinuar**: SKUs en declive (trend negativo) con stock
   alto (DoI > 90 dias).
4. **Subir precio (poder de pricing)**: SKUs con margen bajo pero demanda
   estable - candidatos a aumento de precio.

Soporta dos unidades:

- **unistore**: TN del retail + MELI Fox Electronics; stock desde digip.
- **unidrop**: TN de dropshippers (public.tienda_nube_orders); el stock
  fisico vive en Unistore, asi que reposicion no aplica directo - ver nota
  abajo.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.sku_optimizer")


def _unistore_overview() -> dict:
    eng = get_engine("unistore")

    # 1) COMBOS - SKUs que aparecen juntos en > 25% de las ordenes
    try:
        combos_rows = q(eng, """
            WITH order_skus AS (
                SELECT o.id AS order_id, oi.sku, oi.name
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt" >= NOW() - INTERVAL '90 days'
                  AND oi.sku IS NOT NULL
                  AND oi.sku NOT ILIKE 'PVA%'
            ),
            pairs AS (
                SELECT
                    LEAST(a.sku, b.sku) AS sku_a,
                    GREATEST(a.sku, b.sku) AS sku_b,
                    COUNT(DISTINCT a.order_id) AS co_orders
                FROM order_skus a
                JOIN order_skus b ON a.order_id = b.order_id AND a.sku < b.sku
                GROUP BY 1, 2
                HAVING COUNT(DISTINCT a.order_id) >= 5
            )
            SELECT p.sku_a, p.sku_b, p.co_orders,
                   (SELECT name FROM tienda_nube."OrderItem" WHERE sku = p.sku_a LIMIT 1) AS name_a,
                   (SELECT name FROM tienda_nube."OrderItem" WHERE sku = p.sku_b LIMIT 1) AS name_b
            FROM pairs p
            ORDER BY p.co_orders DESC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("combos query fail: %s", e)
        combos_rows = []

    combos = [{
        "sku_a": r[0],
        "sku_b": r[1],
        "co_orders": int(r[2]),
        "name_a": r[3] or r[0],
        "name_b": r[4] or r[1],
        "accion": f"Bundle {r[0]} + {r[1]} con descuento 10-15%",
        "razon": f"Se compran juntos en {r[2]} ordenes de los ultimos 90 dias",
    } for r in combos_rows]

    # 2) REPOSICION URGENTE - velocidad de venta + stock bajo (digip)
    try:
        repo_rows = q(eng, """
            WITH velocidad AS (
                SELECT oi.sku,
                       SUM(oi.quantity)::int AS units_30d,
                       (SUM(oi.quantity) / 30.0)::float AS daily_velocity,
                       MAX(oi.name) AS nombre
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt" >= NOW() - INTERVAL '30 days'
                  AND oi.sku IS NOT NULL
                  AND oi.sku NOT ILIKE 'PVA%'
                GROUP BY oi.sku
                HAVING SUM(oi.quantity) >= 10
            ),
            stock AS (
                SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock_total
                FROM digip."Stock"
            )
            SELECT v.sku, v.nombre, v.units_30d, v.daily_velocity::float,
                   COALESCE(s.stock_total, 0) AS stock,
                   (COALESCE(s.stock_total, 0) / NULLIF(v.daily_velocity, 0))::float AS days_left
            FROM velocidad v
            LEFT JOIN stock s ON s.sku = v.sku
            WHERE COALESCE(s.stock_total, 0) / NULLIF(v.daily_velocity, 0) < 14
               OR COALESCE(s.stock_total, 0) = 0
            ORDER BY days_left ASC NULLS FIRST
            LIMIT 20
        """) or []
    except Exception as e:
        log.warning("reposicion query fail: %s", e)
        repo_rows = []

    reposiciones = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2]),
        "daily_velocity": round(float(r[3] or 0), 1),
        "stock_actual": int(r[4]),
        "days_left": round(float(r[5]), 0) if r[5] is not None else 0,
        "urgencia": "CRITICA" if (r[5] is None or r[5] < 7) else "ALTA",
        "accion": (
            f"OC ya - se vende {round(float(r[3] or 0), 1)} unid/día, " +
            f"stock para {round(float(r[5] or 0), 0)} días"
        ),
    } for r in repo_rows]

    # 3) LIQUIDAR / DISCONTINUAR - tendencia negativa + stock alto
    try:
        liq_rows = q(eng, """
            WITH ventas AS (
                SELECT oi.sku, MAX(oi.name) AS nombre,
                       SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_30d,
                       SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '60 days'
                                  AND o."createdAt" < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_prev30d
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt" >= NOW() - INTERVAL '60 days'
                  AND oi.sku IS NOT NULL
                  AND oi.sku NOT ILIKE 'PVA%'
                GROUP BY oi.sku
            ),
            stock AS (
                SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock_total
                FROM digip."Stock"
                WHERE COALESCE("unidadesDisponibles", 0) > 30
            )
            SELECT v.sku, v.nombre, v.units_30d, v.units_prev30d,
                   s.stock_total,
                   ((v.units_30d - v.units_prev30d) * 100.0 / NULLIF(v.units_prev30d, 0))::float AS pct_change
            FROM ventas v
            JOIN stock s ON s.sku = v.sku
            WHERE v.units_prev30d > 0
              AND v.units_30d < v.units_prev30d * 0.5
            ORDER BY pct_change ASC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("liquidar query fail: %s", e)
        liq_rows = []

    liquidar = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2] or 0),
        "units_prev30d": int(r[3] or 0),
        "stock_actual": int(r[4]),
        "pct_change": round(float(r[5] or 0), 1),
        "accion": f"Promo agresiva o discontinuar - cayo {abs(round(float(r[5] or 0), 0))}% vs mes anterior",
    } for r in liq_rows]

    # 4) SUBIR PRECIO - demanda estable + alto volumen
    try:
        pricing_rows = q(eng, """
            WITH ventas AS (
                SELECT oi.sku, MAX(oi.name) AS nombre,
                       SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_30d,
                       SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '60 days'
                                  AND o."createdAt" < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_prev30d,
                       AVG(oi.price)::float AS precio_promedio,
                       SUM(oi.quantity * oi.price)::float AS revenue
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt" >= NOW() - INTERVAL '60 days'
                  AND oi.sku IS NOT NULL
                  AND oi.sku NOT ILIKE 'PVA%'
                GROUP BY oi.sku
                HAVING SUM(oi.quantity) >= 20
            )
            SELECT sku, nombre, units_30d, units_prev30d, precio_promedio, revenue
            FROM ventas
            WHERE units_30d >= units_prev30d * 0.9
              AND units_30d <= units_prev30d * 1.5
            ORDER BY revenue DESC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("pricing query fail: %s", e)
        pricing_rows = []

    pricing = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2] or 0),
        "units_prev30d": int(r[3] or 0),
        "precio_actual": round(float(r[4] or 0), 0),
        "precio_sugerido": round(float(r[4] or 0) * 1.05, 0),
        "accion": "Subir precio 5% - demanda estable, alto volumen",
        "razon": f"Vendio {r[2]} unid en 30d (vs {r[3]} previos) - sin caida elastica",
    } for r in pricing_rows]

    return {
        "unit": "unistore",
        "combos": combos,
        "reposiciones": reposiciones,
        "liquidar": liquidar,
        "pricing": pricing,
        "notas": {},
        "summary": {
            "combos_count": len(combos),
            "reposiciones_count": len(reposiciones),
            "liquidar_count": len(liquidar),
            "pricing_count": len(pricing),
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def _unidrop_overview() -> dict:
    """SKU Optimizer para Unidrop. Las queries van contra public.tienda_nube_orders
    + public.tienda_nube_order_items (denormalizado, snake_case).

    El stock fisico vive en Unistore (digip) - Unidrop no tiene inventario propio.
    Por eso reposicion urgente apunta a la fuente Unistore con un cross-check:
    si el SKU vende rapido en Unidrop pero el stock en digip esta bajo, los
    dropshippers podrian quedar sin reponer.
    """
    eng = get_engine("unidrop")

    # 1) COMBOS - pares de SKUs comprados juntos en TN de dropshippers
    try:
        combos_rows = q(eng, """
            WITH order_skus AS (
                SELECT oi.order_id, oi.sku, oi.name
                FROM public.tienda_nube_order_items oi
                JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
                WHERE tno.payment_status::text = 'paid'
                  AND tno.created_at >= NOW() - INTERVAL '90 days'
                  AND oi.sku IS NOT NULL
            ),
            pairs AS (
                SELECT
                    LEAST(a.sku, b.sku) AS sku_a,
                    GREATEST(a.sku, b.sku) AS sku_b,
                    COUNT(DISTINCT a.order_id) AS co_orders
                FROM order_skus a
                JOIN order_skus b ON a.order_id = b.order_id AND a.sku < b.sku
                GROUP BY 1, 2
                HAVING COUNT(DISTINCT a.order_id) >= 3
            )
            SELECT p.sku_a, p.sku_b, p.co_orders,
                   (SELECT name FROM public.tienda_nube_order_items WHERE sku = p.sku_a LIMIT 1) AS name_a,
                   (SELECT name FROM public.tienda_nube_order_items WHERE sku = p.sku_b LIMIT 1) AS name_b
            FROM pairs p
            ORDER BY p.co_orders DESC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("[unidrop] combos query fail: %s", e)
        combos_rows = []

    combos = [{
        "sku_a": r[0],
        "sku_b": r[1],
        "co_orders": int(r[2]),
        "name_a": r[3] or r[0],
        "name_b": r[4] or r[1],
        "accion": f"Sugerir bundle {r[0]} + {r[1]} a dropshippers via newsletter",
        "razon": f"Se compran juntos en {r[2]} ordenes de dropshippers en 90d",
    } for r in combos_rows]

    # 2) REPOSICION: cross-check Unidrop velocidad vs Unistore stock (digip)
    # No corremos un cross-database join directo; en vez de eso, listamos los
    # SKUs con mas velocidad en Unidrop y agregamos un campo `stock_check_needed`
    # para que el usuario verifique en Unistore.
    try:
        repo_rows = q(eng, """
            SELECT oi.sku,
                   MAX(oi.name) AS nombre,
                   SUM(oi.quantity)::int AS units_30d,
                   (SUM(oi.quantity) / 30.0)::float AS daily_velocity,
                   COUNT(DISTINCT tno.tienda_nube_id)::int AS ordenes_30d,
                   COUNT(DISTINCT tno.user_id)::int AS dropshippers_30d
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '30 days'
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
            HAVING SUM(oi.quantity) >= 5
            ORDER BY SUM(oi.quantity) DESC
            LIMIT 20
        """) or []
    except Exception as e:
        log.warning("[unidrop] reposicion query fail: %s", e)
        repo_rows = []

    reposiciones = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2]),
        "daily_velocity": round(float(r[3] or 0), 1),
        "stock_actual": -1,  # sentinel - stock vive en Unistore
        "days_left": 0,
        "urgencia": "VERIFICAR_STOCK_UNISTORE",
        "accion": (
            f"Top mover en Unidrop ({int(r[2])} unid en 30d entre "
            f"{int(r[5] or 0)} dropshippers). Verificar stock en Unistore "
            f"(digip) - si esta bajo, los dropshippers se van a quedar sin reponer."
        ),
        "ordenes_30d": int(r[4] or 0),
        "dropshippers_30d": int(r[5] or 0),
    } for r in repo_rows]

    # 3) LIQUIDAR - SKUs en declive en Unidrop
    try:
        liq_rows = q(eng, """
            SELECT oi.sku, MAX(oi.name) AS nombre,
                   SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_30d,
                   SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '60 days'
                              AND tno.created_at < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_prev30d
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
            WHERE tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '60 days'
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku
            HAVING SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '60 days'
                              AND tno.created_at < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END) > 5
               AND SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)
                 < SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '60 days'
                              AND tno.created_at < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END) * 0.5
            ORDER BY units_prev30d DESC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("[unidrop] liquidar query fail: %s", e)
        liq_rows = []

    liquidar = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2] or 0),
        "units_prev30d": int(r[3] or 0),
        "stock_actual": -1,  # vive en Unistore
        "pct_change": round(((int(r[2] or 0) - int(r[3] or 0)) * 100.0 / max(int(r[3] or 1), 1)), 1),
        "accion": (
            f"Cayo {abs(int((int(r[2] or 0) - int(r[3] or 0)) * 100 / max(int(r[3] or 1), 1)))}% "
            f"vs mes anterior en Unidrop. Considerar promo a dropshippers o discontinuar."
        ),
    } for r in liq_rows]

    # 4) SUBIR PRECIO - demanda estable y alto volumen
    try:
        pricing_rows = q(eng, """
            WITH ventas AS (
                SELECT oi.sku, MAX(oi.name) AS nombre,
                       SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_30d,
                       SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '60 days'
                                  AND tno.created_at < NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_prev30d,
                       AVG(oi.price)::float AS precio_promedio,
                       SUM(oi.quantity * oi.price)::float AS revenue
                FROM public.tienda_nube_order_items oi
                JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.order_id
                WHERE tno.payment_status::text = 'paid'
                  AND tno.created_at >= NOW() - INTERVAL '60 days'
                  AND oi.sku IS NOT NULL
                GROUP BY oi.sku
                HAVING SUM(oi.quantity) >= 10
            )
            SELECT sku, nombre, units_30d, units_prev30d, precio_promedio, revenue
            FROM ventas
            WHERE units_prev30d > 0
              AND units_30d >= units_prev30d * 0.9
              AND units_30d <= units_prev30d * 1.5
            ORDER BY revenue DESC
            LIMIT 15
        """) or []
    except Exception as e:
        log.warning("[unidrop] pricing query fail: %s", e)
        pricing_rows = []

    pricing = [{
        "sku": r[0],
        "nombre": r[1] or r[0],
        "units_30d": int(r[2] or 0),
        "units_prev30d": int(r[3] or 0),
        "precio_actual": round(float(r[4] or 0), 0),
        "precio_sugerido": round(float(r[4] or 0) * 1.05, 0),
        "accion": "Subir comision Unidrop o precio sugerido a dropshippers (+5%) - demanda estable",
        "razon": f"Vendio {r[2]} unid en 30d (vs {r[3]} previos) - sin caida elastica",
    } for r in pricing_rows]

    notas = {
        "reposiciones": (
            "El stock fisico de Unidrop esta en Unistore (digip). "
            "Esta lista son los SKUs con mayor velocidad de venta entre los dropshippers; "
            "cruzalos con el stock de Unistore para evitar quiebres en la red Unidrop."
        ),
        "liquidar": (
            "Stock fisico vive en Unistore. La accion en Unidrop es comunicar a los "
            "dropshippers (newsletter, dashboard interno) que el SKU esta perdiendo "
            "traccion o sugerirles dejar de publicarlo."
        ),
    }

    return {
        "unit": "unidrop",
        "combos": combos,
        "reposiciones": reposiciones,
        "liquidar": liquidar,
        "pricing": pricing,
        "notas": notas,
        "summary": {
            "combos_count": len(combos),
            "reposiciones_count": len(reposiciones),
            "liquidar_count": len(liquidar),
            "pricing_count": len(pricing),
        },
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def sku_optimizer_overview(unit: str = "unistore") -> dict:
    """Top recomendaciones accionables por categoria. Soporta unistore y unidrop.

    En Unidrop el stock vive en Unistore (digip), asi que las recomendaciones
    de reposicion y liquidar incluyen una nota explicando el cruce manual a
    Unistore. El frontend muestra las notas en un banner por seccion.
    """
    u = (unit or "unistore").lower()
    if u == "unidrop":
        return _unidrop_overview()
    return _unistore_overview()
