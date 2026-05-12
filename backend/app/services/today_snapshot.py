"""
Comparador HOY: para cada KPI calcula su valor en HOY y en ANCLAS apples-to-apples.

Los offsets son multiplos de 7 para garantizar comparacion del MISMO dia de la
semana (martes vs martes, no martes vs domingo). Asi el ciclo semanal del retail
no distorsiona la comparacion.

- 7d   = misma semana anterior (1 sem atras, mismo dia)
- 28d  = 4 semanas atras (~1 mes en semanas, mismo dia)
- 336d = 48 semanas atras (~1 ano, mismo dia)
"""
from __future__ import annotations

import datetime as dt

from app.utils.tz import today_ar, now_ar
import logging

from app.db.engines import get_engine
from app.services._utils import scalar

log = logging.getLogger("unidata.today")

ANCHORS_DAYS = {
    "today": 0,
    "w_ago": 7,
    "m_ago": 28,
    "y_ago": 336,
}


def _kpi_block(label: str, values: dict[str, float], *, prefix: str = "", suffix: str = "", hint: str = "") -> dict:
    base = values.get("today", 0) or 0
    out = {
        "label": label,
        "prefix": prefix,
        "suffix": suffix,
        "hint": hint,
        "today": round(base, 0),
        "anchors": [],
    }
    for k in ("w_ago", "m_ago", "y_ago"):
        v = values.get(k, 0) or 0
        delta = ((base - v) / v * 100) if v > 0 else None
        out["anchors"].append({
            "key": k,
            "label": {"w_ago": "hace 7 dias", "m_ago": "hace 28 dias", "y_ago": "hace 336 dias"}[k],
            "value": round(v, 0),
            "delta_pct": round(delta, 1) if delta is not None else None,
        })
    return out


def today_snapshot(unit: str | None = None, context: str | None = None) -> dict:
    """Snapshot HOY vs 7d/30d/365d.

    - Si unit es None: muestra TODOS los KPIs (vista cross-unidad / Gerencial).
    - Si unit='unistore': solo Unistore (incluye Devoluciones/Unidev por ser parte del dominio).
    - Si unit='unidrop': solo Unidrop.

    context: cambia qué bloques se muestran segun la pagina:
    - None / 'gerencial' / 'ventas' (default): GMV, Ordenes, Ticket promedio, Devoluciones
    - 'cs' (Customer Success): Customers nuevos, Recurrentes que volvieron, Cancelaciones, Refunds
    - 'productos': Top SKU del dia, productos nuevos vendidos, stock critico hoy
    - 'logistica': Pedidos atascados, despachos del dia, fulfillment rate
    """
    if context == "cs":
        return _today_snapshot_cs(unit)
    if context == "productos":
        return _today_snapshot_productos(unit)
    if context == "logistica":
        return _today_snapshot_logistica(unit)

    show_unistore = unit in (None, "unistore")
    show_unidrop = unit in (None, "unidrop")
    show_unidev = unit in (None, "unistore")  # Unidev pertenece al dominio Unistore

    uni = get_engine("unistore") if show_unistore else None
    drop = get_engine("unidrop") if show_unidrop else None

    blocks: list[dict] = []

    # === Bloques de UNISTORE ===
    if show_unistore and uni is not None:
        # --- GMV Unistore (TN paid + ML paid/conf/ship/del) por dia ---
        def gmv_for_day(days_back: int) -> float:
            tn = float(scalar(uni, """
                SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END),0)
                FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            ml = float(scalar(uni, """
                SELECT COALESCE(SUM(COALESCE(total_amount,0)),0)
                FROM meli.meli_orders
                WHERE date_created::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND status IN ('paid','confirmed','shipped','delivered')
            """, {"d": days_back}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "GMV Unistore",
            {k: gmv_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="TN paid + ML paid/confirmed/shipped/delivered",
        ))

        # --- Ordenes Unistore por dia ---
        def orders_for_day(days_back: int) -> float:
            tn = int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            ml = int(scalar(uni, """
                SELECT COUNT(*) FROM meli.meli_orders
                WHERE date_created::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "Ordenes Unistore",
            {k: orders_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="TN + ML del dia",
        ))

        # --- AOV Unistore (TN paid del dia) ---
        def aov_for_day(days_back: int) -> float:
            return float(scalar(uni, """
                SELECT COALESCE(AVG(NULLIF(total,0)),0)
                FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND "paymentStatus"='paid'
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Ticket promedio (TN)",
            {k: aov_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="AOV de TN paid",
        ))

    # === Bloques de UNIDROP ===
    if show_unidrop and drop is not None:
        # --- Pagos Talo Unidrop por dia ---
        def talo_for_day(days_back: int) -> float:
            return float(scalar(drop, """
                SELECT COALESCE(SUM(amount),0)
                FROM public."PaymentTransaction"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Pagos Talo (Unidrop)",
            {k: talo_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Volumen procesado en el dia",
        ))

        # --- Usuarios nuevos Unidrop por dia ---
        def new_users_for_day(days_back: int) -> float:
            return int(scalar(drop, """
                SELECT COUNT(*) FROM public."User"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Usuarios nuevos (Unidrop)",
            {k: new_users_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="Altas del dia",
        ))

    # === Bloque de UNIDEV (parte del dominio Unistore) ===
    if show_unidev:
        try:
            dev = get_engine("unidev")
            def dev_for_day(days_back: int) -> float:
                return int(scalar(dev, """
                    SELECT COUNT(*) FROM public.devoluciones
                    WHERE fecha_creacion::date = (CURRENT_DATE - CAST(:d AS integer))
                """, {"d": days_back}) or 0)
            blocks.append(_kpi_block(
                "Devoluciones (Unidev)",
                {k: dev_for_day(d) for k, d in ANCHORS_DAYS.items()},
                hint="Casos abiertos del dia",
            ))
        except Exception as e:
            log.warning("dev snapshot fail: %s", e)

    return {
        "level": "today",
        "today_date": today_ar().isoformat(),
        "blocks": blocks,
        "generated_at": now_ar().isoformat(),
    }


def _today_snapshot_cs(unit: str | None = None) -> dict:
    """Snapshot HOY contextual para Customer Success.

    Bloques (por defecto unit=unistore que es donde tenemos data de customers):
    - Customers nuevos (primera compra hoy)
    - Customers que volvieron (compraron antes y otra vez hoy)
    - Cancelaciones del dia
    - Refunds del dia (monto)
    """
    show_unistore = unit in (None, "unistore")
    blocks: list[dict] = []

    if show_unistore:
        uni = get_engine("unistore")

        # Customers nuevos del dia (primera compra paid)
        def new_customers(days_back: int) -> float:
            return int(scalar(uni, """
                WITH first_orders AS (
                    SELECT "customerId", MIN("createdAt"::date) AS first_at
                    FROM tienda_nube."Order"
                    WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
                    GROUP BY "customerId"
                )
                SELECT COUNT(*) FROM first_orders
                WHERE first_at = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Customers nuevos (Unistore)",
            {k: new_customers(d) for k, d in ANCHORS_DAYS.items()},
            hint="Primera compra paid del dia",
        ))

        # Customers recurrentes que volvieron hoy (paid orders del dia con cliente que ya tenia historial)
        def returning_customers(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COUNT(DISTINCT o."customerId")
                FROM tienda_nube."Order" o
                WHERE o."paymentStatus" = 'paid'
                  AND o."customerId" IS NOT NULL
                  AND o."createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND EXISTS (
                    SELECT 1 FROM tienda_nube."Order" o2
                    WHERE o2."customerId" = o."customerId"
                      AND o2."paymentStatus" = 'paid'
                      AND o2."createdAt" < o."createdAt"
                  )
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Customers recurrentes (Unistore)",
            {k: returning_customers(d) for k, d in ANCHORS_DAYS.items()},
            hint="Volvieron a comprar hoy (no es su primera compra)",
        ))

        # Cancelaciones del dia
        def cancellations(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "status" = 'cancelled'
                  AND COALESCE("cancelledAt", "createdAt")::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Cancelaciones del dia",
            {k: cancellations(d) for k, d in ANCHORS_DAYS.items()},
            hint="Ordenes Unistore que terminaron en cancelled",
        ))

        # Refunds (paymentStatus refunded)
        def refunds_amount(days_back: int) -> float:
            return float(scalar(uni, """
                SELECT COALESCE(SUM(total),0) FROM tienda_nube."Order"
                WHERE "paymentStatus" = 'refunded'
                  AND COALESCE("cancelledAt", "createdAt")::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Refunds (monto)",
            {k: refunds_amount(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Suma de ordenes con paymentStatus=refunded",
        ))

    return {
        "level": "today",
        "context": "cs",
        "today_date": today_ar().isoformat(),
        "blocks": blocks,
        "generated_at": now_ar().isoformat(),
    }


def _today_snapshot_productos(unit: str | None = None) -> dict:
    """HOY contextual para Productos: SKUs vendidos hoy, productos nuevos
    activos, alertas de stock critico que dispararon."""
    blocks: list[dict] = []
    try:
        uni = get_engine("unistore")

        # Distintos SKUs vendidos hoy (paid)
        def skus_vendidos(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COUNT(DISTINCT oi.sku) FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND oi.sku IS NOT NULL
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "SKUs distintos vendidos",
            {k: skus_vendidos(d) for k, d in ANCHORS_DAYS.items()},
            hint="Productos unicos con al menos una venta paid del dia",
        ))

        # Unidades vendidas
        def unidades(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COALESCE(SUM(oi.quantity),0) FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Unidades vendidas",
            {k: unidades(d) for k, d in ANCHORS_DAYS.items()},
            hint="Suma de quantity de OrderItem paid del dia",
        ))

        # SKUs en stock critico (<= 5 unidades)
        def stock_critico(days_back: int) -> float:
            # No depende del dia - es estado actual
            if days_back == 0:
                return int(scalar(uni, """
                    SELECT COUNT(DISTINCT "articuloCodigo")
                    FROM digip."StockDetalle"
                    GROUP BY "articuloCodigo"
                    HAVING SUM(unidades) BETWEEN 1 AND 5
                """) or 0)
            return 0

        # No mostramos comparativo - es snapshot actual
        sc = stock_critico(0)
        if sc:
            blocks.append({
                "label": "SKUs en stock critico",
                "prefix": "",
                "suffix": "",
                "hint": "Stock entre 1 y 5 unidades · necesita reposicion",
                "today": sc,
                "anchors": [
                    {"key": "w_ago", "label": "estado", "value": sc, "delta_pct": None},
                    {"key": "m_ago", "label": "actual", "value": sc, "delta_pct": None},
                    {"key": "y_ago", "label": "snapshot", "value": sc, "delta_pct": None},
                ],
            })
    except Exception as e:
        log.warning("today productos snap fail: %s", e)

    return {
        "level": "today",
        "context": "productos",
        "today_date": today_ar().isoformat(),
        "blocks": blocks,
        "generated_at": now_ar().isoformat(),
    }


def _today_snapshot_logistica(unit: str | None = None) -> dict:
    """HOY contextual para Logistica: pedidos atascados, despachos del dia,
    fulfillment del dia."""
    blocks: list[dict] = []
    try:
        uni = get_engine("unistore")

        # Pedidos creados hoy
        def created(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "createdAt"::date = (CURRENT_DATE - CAST(:d AS integer))
                  AND "paymentStatus" = 'paid'
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Ordenes pagadas (a despachar)",
            {k: created(d) for k, d in ANCHORS_DAYS.items()},
            hint="Pagadas el dia - entran al funnel de logistica",
        ))

        # Despachos hoy
        def despachados(days_back: int) -> float:
            return int(scalar(uni, """
                SELECT COUNT(DISTINCT dp."pedidoCodigo")
                FROM digip."DespachoPedido" dp
                WHERE dp.fecha::date = (CURRENT_DATE - CAST(:d AS integer))
            """, {"d": days_back}) or 0)

        blocks.append(_kpi_block(
            "Despachos Digip",
            {k: despachados(d) for k, d in ANCHORS_DAYS.items()},
            hint="Pedidos despachados fisicamente del deposito",
        ))

        # Pedidos atascados (estado actual, no comparativo dia)
        stuck = int(scalar(uni, """
            SELECT COUNT(*) FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid'
              AND "shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
              AND "createdAt" < NOW() - INTERVAL '5 days'
        """) or 0)
        if stuck > 0:
            blocks.append({
                "label": "Pedidos atascados (>5d)",
                "prefix": "",
                "suffix": "",
                "hint": "Paid sin fulfillment hace mas de 5 dias",
                "today": stuck,
                "anchors": [
                    {"key": "w_ago", "label": "estado", "value": stuck, "delta_pct": None},
                    {"key": "m_ago", "label": "actual", "value": stuck, "delta_pct": None},
                    {"key": "y_ago", "label": "snapshot", "value": stuck, "delta_pct": None},
                ],
            })
    except Exception as e:
        log.warning("today logistica snap fail: %s", e)

    return {
        "level": "today",
        "context": "logistica",
        "today_date": today_ar().isoformat(),
        "blocks": blocks,
        "generated_at": now_ar().isoformat(),
    }
