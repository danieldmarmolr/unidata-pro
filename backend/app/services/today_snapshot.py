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

_UTC = dt.timezone.utc


def _day_bounds(days_back: int) -> tuple[dt.datetime, dt.datetime]:
    """
    UTC naive bounds para el dia N dias atras (en hora Argentina).

    from_ts = medianoche Argentina de ese dia convertida a UTC
    to_ts   = mismo momento relativo N dias atras en UTC

    Necesario porque las columnas createdAt/dateCreated en RDS son
    TIMESTAMP WITHOUT TIME ZONE almacenadas en UTC.  Si usaramos
    CURRENT_DATE - N (naive) o datetime Argentina naive, la comparacion
    seria literal y UTC midnight (= 21:00 ART) quedaría incluido en "hoy".
    """
    now_tz = now_ar()
    now_utc = now_tz.astimezone(_UTC).replace(tzinfo=None)
    day_ar = now_tz - dt.timedelta(days=days_back)
    day_start_ar = day_ar.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start_utc = day_start_ar.astimezone(_UTC).replace(tzinfo=None)
    day_end_utc = now_utc - dt.timedelta(days=days_back)
    return day_start_utc, day_end_utc

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
    if context == "finanzas":
        return _today_snapshot_finanzas(unit)
    if context == "devoluciones":
        return _today_snapshot_devoluciones(unit)
    if context == "dropshippers":
        return _today_snapshot_dropshippers(unit)

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
            from_ts, to_ts = _day_bounds(days_back)
            tn = float(scalar(uni, """
                SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END),0)
                FROM tienda_nube."Order"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
            ml = float(scalar(uni, """
                SELECT COALESCE(SUM(COALESCE(total_amount,0)),0)
                FROM meli.meli_orders
                WHERE date_created >= :from_ts AND date_created < :to_ts
                  AND status IN ('paid','confirmed','shipped','delivered')
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "GMV Unistore",
            {k: gmv_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="TN paid + ML paid/confirmed/shipped/delivered",
        ))

        # --- Ordenes Unistore por dia ---
        def orders_for_day(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            tn = int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
            ml = int(scalar(uni, """
                SELECT COUNT(*) FROM meli.meli_orders
                WHERE date_created >= :from_ts AND date_created < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
            return tn + ml

        blocks.append(_kpi_block(
            "Ordenes Unistore",
            {k: orders_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="TN + ML del dia",
        ))

        # --- AOV Unistore (TN paid del dia) ---
        def aov_for_day(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return float(scalar(uni, """
                SELECT COALESCE(AVG(NULLIF(total,0)),0)
                FROM tienda_nube."Order"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                  AND "paymentStatus"='paid'
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

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
            from_ts, to_ts = _day_bounds(days_back)
            return float(scalar(drop, """
                SELECT COALESCE(SUM(amount),0)
                FROM public."PaymentTransaction"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                  AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Pagos Talo (Unidrop)",
            {k: talo_for_day(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Volumen procesado en el dia",
        ))

        # --- Usuarios nuevos Unidrop por dia ---
        def new_users_for_day(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(drop, """
                SELECT COUNT(*) FROM public."User"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

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
                from_ts, to_ts = _day_bounds(days_back)
                return int(scalar(dev, """
                    SELECT COUNT(*) FROM public.devoluciones
                    WHERE fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
                """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
            blocks.append(_kpi_block(
                "Devoluciones (Unidev)",
                {k: dev_for_day(d) for k, d in ANCHORS_DAYS.items()},
                hint="Casos abiertos del dia",
            ))
        except Exception as e:
            log.warning("dev snapshot fail: %s", e)

    now = now_ar()
    return {
        "level": "today",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
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
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(uni, """
                WITH first_orders AS (
                    SELECT "customerId", MIN("createdAt") AS first_at
                    FROM tienda_nube."Order"
                    WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
                    GROUP BY "customerId"
                )
                SELECT COUNT(*) FROM first_orders
                WHERE first_at >= :from_ts AND first_at < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Customers nuevos (Unistore)",
            {k: new_customers(d) for k, d in ANCHORS_DAYS.items()},
            hint="Primera compra paid del dia",
        ))

        # Customers recurrentes que volvieron hoy (paid orders del dia con cliente que ya tenia historial)
        def returning_customers(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(uni, """
                SELECT COUNT(DISTINCT o."customerId")
                FROM tienda_nube."Order" o
                WHERE o."paymentStatus" = 'paid'
                  AND o."customerId" IS NOT NULL
                  AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
                  AND EXISTS (
                    SELECT 1 FROM tienda_nube."Order" o2
                    WHERE o2."customerId" = o."customerId"
                      AND o2."paymentStatus" = 'paid'
                      AND o2."createdAt" < o."createdAt"
                  )
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Customers recurrentes (Unistore)",
            {k: returning_customers(d) for k, d in ANCHORS_DAYS.items()},
            hint="Volvieron a comprar hoy (no es su primera compra)",
        ))

        # Cancelaciones del dia
        def cancellations(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "status" = 'cancelled'
                  AND COALESCE("cancelledAt", "createdAt") >= :from_ts
                  AND COALESCE("cancelledAt", "createdAt") < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Cancelaciones del dia",
            {k: cancellations(d) for k, d in ANCHORS_DAYS.items()},
            hint="Ordenes Unistore que terminaron en cancelled",
        ))

        # Refunds (paymentStatus refunded)
        def refunds_amount(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return float(scalar(uni, """
                SELECT COALESCE(SUM(total),0) FROM tienda_nube."Order"
                WHERE "paymentStatus" = 'refunded'
                  AND COALESCE("cancelledAt", "createdAt") >= :from_ts
                  AND COALESCE("cancelledAt", "createdAt") < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Refunds (monto)",
            {k: refunds_amount(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Suma de ordenes con paymentStatus=refunded",
        ))

    now = now_ar()
    return {
        "level": "today",
        "context": "cs",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }


def _today_snapshot_productos(unit: str | None = None) -> dict:
    """HOY contextual para Productos: 8 bloques operativos + financieros.

    Bloques: SKUs vendidos, Unidades, SKUs/Orden (basket diversity),
    Variedad % (cobertura de catalogo), Ticket unidades, Ganancia neta,
    Margen %, Stock critico (snapshot).
    """
    blocks: list[dict] = []
    try:
        from app.services._utils import q as _q
        from app.services.profit_engine import cost_index_unistore, calc_profit
        uni = get_engine("unistore")

        # Total catalogo publicado (denominador para variedad %)
        total_publicados = int(scalar(uni, """
            SELECT COUNT(*) FROM tienda_nube."Product" WHERE published = TRUE
        """) or 0) or 1

        # Cache de costos para Ganancia/Margen (1 sola lectura)
        cost_idx = cost_index_unistore()

        def day_aggregates(days_back: int) -> dict:
            """Trae los items del dia (sin SUM/GROUP BY, raw) y agrega en Python.
            Antes usaba LATERAL JOIN que daba statement timeout en prod. Despues
            un SELECT con SUM sin GROUP BY (invalido SQL) que tambien colgaba.
            Esta version mueve toda la agregacion a Python — 1 dia de TN ~ <1000
            filas, trivial para iterar."""
            from_ts, to_ts = _day_bounds(days_back)
            sku_rows = _q(uni, """
                SELECT oi.sku, oi."orderId", oi.quantity, oi.price
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."paymentStatus" = 'paid'
                  AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
                  AND oi.sku IS NOT NULL
            """, {"from_ts": from_ts, "to_ts": to_ts}) or []

            skus_set: set[str] = set()
            order_skus: dict = {}
            unidades = 0
            sku_agg: dict[str, tuple[int, float]] = {}  # sku -> (units, revenue)
            for sk, oid, qty, price in sku_rows:
                qty = int(qty or 0)
                line_rev = qty * float(price or 0)
                skus_set.add(sk)
                unidades += qty
                order_skus.setdefault(oid, set()).add(sk)
                prev = sku_agg.get(sk, (0, 0.0))
                sku_agg[sk] = (prev[0] + qty, prev[1] + line_rev)
            skus = len(skus_set)
            ordenes = len(order_skus)
            sku_per_ord = (sum(len(s) for s in order_skus.values()) / ordenes) if ordenes else 0.0
            ganancia = 0.0
            rev_con_costo = 0.0
            for sk, (u, rev) in sku_agg.items():
                rec = cost_idx.get((sk or "").strip().lower())
                if not (rec and rec.get("costo_con_iva") and u > 0 and rev > 0):
                    continue
                sin_iva = float(rec.get("costo_sin_iva") or 0)
                con_iva = float(rec.get("costo_con_iva") or sin_iva)
                pb = calc_profit(
                    ingreso_bruto=rev,
                    costo_sin_iva=sin_iva * u,
                    costo_con_iva=con_iva * u,
                    is_cash=False,
                    iva_aliquot_override=rec.get("iva_aliquot"),
                )
                ganancia += pb.ganancia_neta
                rev_con_costo += rev

            margen_pct = (ganancia / rev_con_costo * 100) if rev_con_costo > 0 else 0.0
            ticket_unidades = (unidades / ordenes) if ordenes > 0 else 0.0
            variedad_pct = (skus / total_publicados * 100) if total_publicados > 0 else 0.0
            return {
                "skus": skus,
                "unidades": unidades,
                "ordenes": ordenes,
                "skus_por_orden": round(sku_per_ord, 2),
                "variedad_pct": round(variedad_pct, 1),
                "ticket_unidades": round(ticket_unidades, 2),
                "ganancia": round(ganancia, 0),
                "margen_pct": round(margen_pct, 1),
            }

        snaps = {k: day_aggregates(d) for k, d in ANCHORS_DAYS.items()}

        blocks.append(_kpi_block(
            "SKUs distintos vendidos",
            {k: s["skus"] for k, s in snaps.items()},
            hint="Productos unicos con al menos una venta paid del dia",
        ))
        blocks.append(_kpi_block(
            "Unidades vendidas",
            {k: s["unidades"] for k, s in snaps.items()},
            hint="Suma de quantity de OrderItem paid del dia",
        ))
        blocks.append(_kpi_block(
            "SKUs por orden",
            {k: s["skus_por_orden"] for k, s in snaps.items()},
            hint="Promedio de SKUs distintos por orden paid (diversidad de carrito)",
        ))
        blocks.append(_kpi_block(
            "Variedad de catalogo",
            {k: s["variedad_pct"] for k, s in snaps.items()},
            suffix="%",
            hint=f"% del catalogo publicado ({total_publicados:,} SKUs) que tuvo venta",
        ))
        blocks.append(_kpi_block(
            "Ticket de unidades",
            {k: s["ticket_unidades"] for k, s in snaps.items()},
            hint="Unidades vendidas / ordenes paid del dia",
        ))
        blocks.append(_kpi_block(
            "Ganancia neta",
            {k: s["ganancia"] for k, s in snaps.items()},
            prefix="$ ",
            hint="Solo SKUs con costo cargado en costs.db",
        ))
        blocks.append(_kpi_block(
            "Margen %",
            {k: s["margen_pct"] for k, s in snaps.items()},
            suffix="%",
            hint="Ganancia neta / revenue (solo SKUs con costo cargado)",
        ))

        # Stock critico: snapshot, no comparable temporalmente
        stock_critico_now = int(scalar(uni, """
            SELECT COUNT(*) FROM (
                SELECT "articuloCodigo"
                FROM digip."StockDetalle"
                GROUP BY 1 HAVING SUM(unidades) BETWEEN 1 AND 5
            ) x
        """) or 0)
        if stock_critico_now:
            blocks.append({
                "label": "SKUs en stock critico",
                "prefix": "",
                "suffix": "",
                "hint": "Stock entre 1 y 5 unidades · necesita reposicion",
                "today": stock_critico_now,
                "anchors": [
                    {"key": "w_ago", "label": "estado", "value": stock_critico_now, "delta_pct": None},
                    {"key": "m_ago", "label": "actual", "value": stock_critico_now, "delta_pct": None},
                    {"key": "y_ago", "label": "snapshot", "value": stock_critico_now, "delta_pct": None},
                ],
            })
    except Exception as e:
        log.warning("today productos snap fail: %s", e)

    now = now_ar()
    return {
        "level": "today",
        "context": "productos",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }


def _today_snapshot_logistica(unit: str | None = None) -> dict:
    """HOY contextual para Logistica: pedidos atascados, despachos del dia,
    fulfillment del dia."""
    blocks: list[dict] = []
    try:
        uni = get_engine("unistore")

        # Pedidos creados hoy
        def created(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(uni, """
                SELECT COUNT(*) FROM tienda_nube."Order"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                  AND "paymentStatus" = 'paid'
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Ordenes pagadas (a despachar)",
            {k: created(d) for k, d in ANCHORS_DAYS.items()},
            hint="Pagadas el dia - entran al funnel de logistica",
        ))

        # Despachos hoy
        def despachados(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(uni, """
                SELECT COUNT(DISTINCT dp."pedidoCodigo")
                FROM digip."DespachoPedido" dp
                WHERE dp.fecha >= :from_ts AND dp.fecha < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

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

    now = now_ar()
    return {
        "level": "today",
        "context": "logistica",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }


def _today_snapshot_finanzas(unit: str | None = None) -> dict:
    """HOY contextual para Finanzas: caja del dia (Unistore GMV + Unidrop Pagos Talo + Refunds)."""
    show_uni = unit in (None, "unistore")
    show_drp = unit in (None, "unidrop")
    blocks: list[dict] = []

    if show_uni:
        try:
            uni = get_engine("unistore")

            def gmv_uni(days_back: int) -> float:
                from_ts, to_ts = _day_bounds(days_back)
                tn = float(scalar(uni, """
                    SELECT COALESCE(SUM(CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END),0)
                    FROM tienda_nube."Order"
                    WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
                ml = float(scalar(uni, """
                    SELECT COALESCE(SUM(COALESCE(total_amount,0)),0)
                    FROM meli.meli_orders
                    WHERE date_created >= :from_ts AND date_created < :to_ts
                      AND status IN ('paid','confirmed','shipped','delivered')
                """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)
                return tn + ml

            blocks.append(_kpi_block(
                "Ingreso Unistore",
                {k: gmv_uni(d) for k, d in ANCHORS_DAYS.items()},
                prefix="$ ",
                hint="GMV bruto TN + ML del dia",
            ))

            def refunds(days_back: int) -> float:
                from_ts, to_ts = _day_bounds(days_back)
                return float(scalar(uni, """
                    SELECT COALESCE(SUM(total),0) FROM tienda_nube."Order"
                    WHERE "paymentStatus" = 'refunded'
                      AND COALESCE("cancelledAt", "createdAt") >= :from_ts
                      AND COALESCE("cancelledAt", "createdAt") < :to_ts
                """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

            blocks.append(_kpi_block(
                "Refunds Unistore",
                {k: refunds(d) for k, d in ANCHORS_DAYS.items()},
                prefix="$ ",
                hint="Suma de ordenes refunded del dia",
            ))
        except Exception as e:
            log.warning("today finanzas uni fail: %s", e)

    if show_drp:
        try:
            drop = get_engine("unidrop")

            def talo(days_back: int) -> float:
                from_ts, to_ts = _day_bounds(days_back)
                return float(scalar(drop, """
                    SELECT COALESCE(SUM(amount),0)
                    FROM public."PaymentTransaction"
                    WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                      AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
                """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

            blocks.append(_kpi_block(
                "Pagos Talo (Unidrop)",
                {k: talo(d) for k, d in ANCHORS_DAYS.items()},
                prefix="$ ",
                hint="Volumen procesado el dia",
            ))
        except Exception as e:
            log.warning("today finanzas drop fail: %s", e)

    now = now_ar()
    return {
        "level": "today",
        "context": "finanzas",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }


def _today_snapshot_devoluciones(unit: str | None = None) -> dict:
    """HOY contextual para Devoluciones: solo casos Unidev del dia."""
    blocks: list[dict] = []
    try:
        dev = get_engine("unidev")

        def dev_for_day(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(dev, """
                SELECT COUNT(*) FROM public.devoluciones
                WHERE fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Devoluciones del dia",
            {k: dev_for_day(d) for k, d in ANCHORS_DAYS.items()},
            hint="Casos abiertos en Unidev",
        ))
    except Exception as e:
        log.warning("today devoluciones snap fail: %s", e)

    now = now_ar()
    return {
        "level": "today",
        "context": "devoluciones",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }


def _today_snapshot_dropshippers(unit: str | None = None) -> dict:
    """HOY contextual para Dropshippers: altas del dia + pagos procesados."""
    blocks: list[dict] = []
    try:
        drop = get_engine("unidrop")

        def new_users(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return int(scalar(drop, """
                SELECT COUNT(*) FROM public."User"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Nuevos dropshippers",
            {k: new_users(d) for k, d in ANCHORS_DAYS.items()},
            hint="Altas en Unidrop del dia",
        ))

        def talo(days_back: int) -> float:
            from_ts, to_ts = _day_bounds(days_back)
            return float(scalar(drop, """
                SELECT COALESCE(SUM(amount),0)
                FROM public."PaymentTransaction"
                WHERE "createdAt" >= :from_ts AND "createdAt" < :to_ts
                  AND status::text IN ('completed','succeeded','approved','paid','PROCESSED','processed')
            """, {"from_ts": from_ts, "to_ts": to_ts}) or 0)

        blocks.append(_kpi_block(
            "Pagos Talo",
            {k: talo(d) for k, d in ANCHORS_DAYS.items()},
            prefix="$ ",
            hint="Volumen procesado el dia",
        ))
    except Exception as e:
        log.warning("today dropshippers snap fail: %s", e)

    now = now_ar()
    return {
        "level": "today",
        "context": "dropshippers",
        "today_date": today_ar().isoformat(),
        "until_time": now.strftime("%H:%M"),
        "blocks": blocks,
        "generated_at": now.isoformat(),
    }
