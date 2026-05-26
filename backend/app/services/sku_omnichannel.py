"""
SKU Omnichannel - Vista 360 de un SKU a traves de los 4 canales del grupo.

UNIDATA es el orquestador: cada canal vive en una base + tabla distinta con
estructura distinta. Esta funcion las normaliza y devuelve una vista
homogenea para detectar inconsistencias.

Canales:
1. Unistore TN     : unistore_api -> tienda_nube."OrderItem" + tienda_nube."Order"
2. Unistore MELI   : unistore_api -> meli.meli_order_items + meli.meli_orders
3. Unidrop  TN     : unidrop_api  -> public.tienda_nube_order_items + public.tienda_nube_orders
4. Unidrop  MELI   : unidrop_api  -> mercado_libre_dev."OrderItemMercadoLibre" + mercado_libre_dev."OrderMercadoLibre"

Todo es agregado al nivel SKU. Detalle (last orders, etc) lo da cada vista
de canal especifica.
"""
from __future__ import annotations

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.sku_omnichannel")

# Pool dedicado para queries paralelas multi-engine. 4 workers = 4 canales
# concurrentes. Cada worker abre su propia conexion del pool DB del engine.
_PARALLEL_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sku-omni")


def _empty_channel() -> dict:
    return {
        "available": False,
        "units_30d": 0,
        "units_90d": 0,
        "units_total": 0,
        "revenue_30d": 0.0,
        "revenue_90d": 0.0,
        "revenue_total": 0.0,
        "orders_total": 0,
        "first_sale": None,
        "last_sale": None,
        "ticket_promedio": 0.0,
        "avg_price": 0.0,
        "name": None,
        "error": None,
    }


def _normalize_row(row, name_col_idx: int = 8) -> dict:
    """Las queries devuelven la misma forma: units_30d, units_90d, units_total,
    revenue_30d, revenue_90d, revenue_total, orders_total, first_sale, last_sale, name, avg_price."""
    if not row:
        return _empty_channel()
    u30, u90, ut, r30, r90, rt, ot, fs, ls, nm, ap = row
    orders = int(ot or 0)
    rt_f = float(rt or 0)
    return {
        "available": (orders > 0) or (int(ut or 0) > 0),
        "units_30d": int(u30 or 0),
        "units_90d": int(u90 or 0),
        "units_total": int(ut or 0),
        "revenue_30d": round(float(r30 or 0), 2),
        "revenue_90d": round(float(r90 or 0), 2),
        "revenue_total": round(rt_f, 2),
        "orders_total": orders,
        "first_sale": str(fs) if fs else None,
        "last_sale": str(ls) if ls else None,
        "ticket_promedio": round(rt_f / orders, 2) if orders else 0.0,
        "avg_price": round(float(ap or 0), 2),
        "name": nm or None,
        "error": None,
    }


def _unistore_tn(eng, sku: str) -> dict:
    try:
        rows = q(eng, """
            SELECT
                SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS u30,
                SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END)::int AS u90,
                SUM(oi.quantity)::int AS ut,
                SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '30 days' THEN oi.quantity * oi.price ELSE 0 END)::float AS r30,
                SUM(CASE WHEN o."createdAt" >= NOW() - INTERVAL '90 days' THEN oi.quantity * oi.price ELSE 0 END)::float AS r90,
                SUM(oi.quantity * oi.price)::float AS rt,
                COUNT(DISTINCT oi."orderId")::int AS orders,
                MIN(o."createdAt")::text AS first_sale,
                MAX(o."createdAt")::text AS last_sale,
                MAX(oi.name) AS name,
                AVG(oi.price)::float AS avg_price
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE oi.sku = :sku
              AND o."paymentStatus" = 'paid'
        """, {"sku": sku}) or []
        return _normalize_row(rows[0] if rows else None)
    except Exception as e:
        log.warning("unistore_tn fail sku=%s err=%s", sku, e)
        d = _empty_channel(); d["error"] = str(e)[:200]; return d


def _unistore_meli(eng, sku: str) -> dict:
    try:
        rows = q(eng, """
            SELECT
                SUM(CASE WHEN mo.date_created >= NOW() - INTERVAL '30 days' THEN mi.quantity ELSE 0 END)::int AS u30,
                SUM(CASE WHEN mo.date_created >= NOW() - INTERVAL '90 days' THEN mi.quantity ELSE 0 END)::int AS u90,
                SUM(mi.quantity)::int AS ut,
                SUM(CASE WHEN mo.date_created >= NOW() - INTERVAL '30 days' THEN mi.quantity * mi.unit_price ELSE 0 END)::float AS r30,
                SUM(CASE WHEN mo.date_created >= NOW() - INTERVAL '90 days' THEN mi.quantity * mi.unit_price ELSE 0 END)::float AS r90,
                SUM(mi.quantity * mi.unit_price)::float AS rt,
                COUNT(DISTINCT mi.order_id)::int AS orders,
                MIN(mo.date_created)::text AS first_sale,
                MAX(mo.date_created)::text AS last_sale,
                MAX(mi.title) AS name,
                AVG(mi.unit_price)::float AS avg_price
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mi.seller_sku = :sku
              AND mo.status IN ('paid','confirmed','shipped','delivered')
        """, {"sku": sku}) or []
        return _normalize_row(rows[0] if rows else None)
    except Exception as e:
        log.warning("unistore_meli fail sku=%s err=%s", sku, e)
        d = _empty_channel(); d["error"] = str(e)[:200]; return d


def _unidrop_tn(eng, sku: str) -> dict:
    """tienda_nube_order_items.tienda_nube_order_id = tienda_nube_orders.tienda_nube_id"""
    try:
        rows = q(eng, """
            SELECT
                SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS u30,
                SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END)::int AS u90,
                SUM(oi.quantity)::int AS ut,
                SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity * oi.price ELSE 0 END)::float AS r30,
                SUM(CASE WHEN tno.created_at >= NOW() - INTERVAL '90 days' THEN oi.quantity * oi.price ELSE 0 END)::float AS r90,
                SUM(oi.quantity * oi.price)::float AS rt,
                COUNT(DISTINCT oi.tienda_nube_order_id)::int AS orders,
                MIN(tno.created_at)::text AS first_sale,
                MAX(tno.created_at)::text AS last_sale,
                MAX(oi.name) AS name,
                AVG(oi.price)::float AS avg_price
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE oi.sku = :sku
              AND tno.payment_status::text = 'paid'
        """, {"sku": sku}) or []
        return _normalize_row(rows[0] if rows else None)
    except Exception as e:
        log.warning("unidrop_tn fail sku=%s err=%s", sku, e)
        d = _empty_channel(); d["error"] = str(e)[:200]; return d


def _unidrop_meli(eng, sku: str) -> dict:
    """OrderItemMercadoLibre + OrderMercadoLibre.
    Schema real (confirmado en unidrop_api):
    - OrderItemMercadoLibre.sellerSku (camelCase)
    - OrderItemMercadoLibre.orderId (bigint, FK -> OML.id)
    - OrderItemMercadoLibre.unitPrice, quantity, title, unitCost
    - OrderMercadoLibre.id (bigint, mismo ID externo de ML)
    - OrderMercadoLibre.dateCreated, status
    """
    try:
        rows = q(eng, """
            SELECT
                SUM(CASE WHEN o."dateCreated" >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS u30,
                SUM(CASE WHEN o."dateCreated" >= NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END)::int AS u90,
                SUM(oi.quantity)::int AS ut,
                SUM(CASE WHEN o."dateCreated" >= NOW() - INTERVAL '30 days' THEN oi.quantity * oi."unitPrice" ELSE 0 END)::float AS r30,
                SUM(CASE WHEN o."dateCreated" >= NOW() - INTERVAL '90 days' THEN oi.quantity * oi."unitPrice" ELSE 0 END)::float AS r90,
                SUM(oi.quantity * oi."unitPrice")::float AS rt,
                COUNT(DISTINCT oi."orderId")::int AS orders,
                MIN(o."dateCreated")::text AS first_sale,
                MAX(o."dateCreated")::text AS last_sale,
                MAX(oi.title) AS name,
                AVG(oi."unitPrice")::float AS avg_price
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" = :sku
              AND (o."status" IN ('paid','confirmed','shipped','delivered')
                   OR o."paidAmount" > 0)
        """, {"sku": sku}) or []
        return _normalize_row(rows[0] if rows else None)
    except Exception as e:
        log.warning("unidrop_meli fail sku=%s err=%s", sku, e)
        d = _empty_channel(); d["error"] = str(e)[:200]; return d


def _monthly_by_channel(eng_uni, eng_uni_dropper, sku: str) -> list[dict]:
    """12 ultimos meses, agregado por canal. Devuelve filas con
    mes + 4 columnas de units + 4 de revenue."""
    months: dict[str, dict[str, float]] = {}

    def _add(month: str, channel: str, units: int, revenue: float) -> None:
        if month not in months:
            months[month] = {"unistore_tn": 0, "unistore_meli": 0, "unidrop_tn": 0, "unidrop_meli": 0,
                             "rev_unistore_tn": 0.0, "rev_unistore_meli": 0.0,
                             "rev_unidrop_tn": 0.0, "rev_unidrop_meli": 0.0}
        months[month][channel] = months[month].get(channel, 0) + int(units or 0)
        rev_key = "rev_" + channel
        months[month][rev_key] = months[month].get(rev_key, 0.0) + float(revenue or 0)

    # Unistore TN
    try:
        for r in q(eng_uni, """
            SELECT to_char(date_trunc('month', o."createdAt"), 'YYYY-MM'),
                   SUM(oi.quantity)::int, SUM(oi.quantity * oi.price)::float
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '12 months'
            GROUP BY 1
        """, {"sku": sku}) or []:
            _add(r[0], "unistore_tn", r[1], r[2])
    except Exception as e:
        log.warning("monthly unistore_tn fail: %s", e)

    # Unistore MELI
    try:
        for r in q(eng_uni, """
            SELECT to_char(date_trunc('month', mo.date_created), 'YYYY-MM'),
                   SUM(mi.quantity)::int, SUM(mi.quantity * mi.unit_price)::float
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mi.seller_sku = :sku
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mo.date_created >= NOW() - INTERVAL '12 months'
            GROUP BY 1
        """, {"sku": sku}) or []:
            _add(r[0], "unistore_meli", r[1], r[2])
    except Exception as e:
        log.warning("monthly unistore_meli fail: %s", e)

    # Unidrop TN
    try:
        for r in q(eng_uni_dropper, """
            SELECT to_char(date_trunc('month', tno.created_at), 'YYYY-MM'),
                   SUM(oi.quantity)::int, SUM(oi.quantity * oi.price)::float
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE oi.sku = :sku AND tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '12 months'
            GROUP BY 1
        """, {"sku": sku}) or []:
            _add(r[0], "unidrop_tn", r[1], r[2])
    except Exception as e:
        log.warning("monthly unidrop_tn fail: %s", e)

    # Unidrop MELI — schema real: sellerSku / orderId / unitPrice / quantity
    try:
        for r in q(eng_uni_dropper, """
            SELECT to_char(date_trunc('month', o."dateCreated"), 'YYYY-MM'),
                   SUM(oi.quantity)::int,
                   SUM(oi.quantity * oi."unitPrice")::float
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" = :sku
              AND (o."status" IN ('paid','confirmed','shipped','delivered') OR o."paidAmount" > 0)
              AND o."dateCreated" >= NOW() - INTERVAL '12 months'
            GROUP BY 1
        """, {"sku": sku}) or []:
            _add(r[0], "unidrop_meli", r[1], r[2])
    except Exception as e:
        log.warning("monthly unidrop_meli fail: %s", e)

    return [{"mes": m, **vals} for m, vals in sorted(months.items())]


# Mapeo granularidad -> bucket trunc (PG) + formato de salida.
# day  -> date_trunc('day',  ts), formato YYYY-MM-DD
# week -> date_trunc('week', ts), formato YYYY-MM-DD (lunes de la semana)
# month -> date_trunc('month', ts), formato YYYY-MM
_GRAN_CFG = {
    "day": ("day", "YYYY-MM-DD"),
    "week": ("week", "YYYY-MM-DD"),
    "month": ("month", "YYYY-MM"),
}


def series_by_channel(sku: str, granularity: str = "day", days: int = 90) -> dict:
    """Serie agregada por bucket (dia / semana / mes) en los 4 canales del SKU.

    Generaliza _monthly_by_channel para granularidades mas finas. Devuelve la
    misma forma de fila que el endpoint mensual (`{period, unistore_tn,
    unidrop_meli, ..., rev_unistore_tn, ...}`) para que el grafico apilado del
    frontend pueda reutilizar la misma logica.

    Args:
        sku: SKU canonico.
        granularity: 'day' | 'week' | 'month'.
        days: ventana hacia atras desde NOW().
    """
    if not sku:
        return {"sku": "", "granularity": granularity, "days": days, "rows": []}
    if granularity not in _GRAN_CFG:
        granularity = "day"
    bucket, fmt = _GRAN_CFG[granularity]

    eng_uni = get_engine("unistore")
    eng_drp = get_engine("unidrop")

    series: dict[str, dict[str, float]] = {}

    def _add(period: str, channel: str, units: int, revenue: float) -> None:
        if period not in series:
            series[period] = {
                "unistore_tn": 0, "unistore_meli": 0, "unidrop_tn": 0, "unidrop_meli": 0,
                "rev_unistore_tn": 0.0, "rev_unistore_meli": 0.0,
                "rev_unidrop_tn": 0.0, "rev_unidrop_meli": 0.0,
            }
        series[period][channel] = series[period].get(channel, 0) + int(units or 0)
        rev_key = "rev_" + channel
        series[period][rev_key] = series[period].get(rev_key, 0.0) + float(revenue or 0)

    days_int = max(1, int(days or 90))

    # Unistore TN
    try:
        rows = q(eng_uni, f"""
            SELECT to_char(date_trunc('{bucket}', o."createdAt"), '{fmt}'),
                   SUM(oi.quantity)::int,
                   SUM(oi.quantity * oi.price)::float
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - make_interval(days => :d)
            GROUP BY 1
        """, {"sku": sku, "d": days_int}) or []
        for r in rows:
            _add(r[0], "unistore_tn", r[1], r[2])
    except Exception as e:
        log.warning("series unistore_tn fail: %s", e)

    # Unistore MELI
    try:
        rows = q(eng_uni, f"""
            SELECT to_char(date_trunc('{bucket}', mo.date_created), '{fmt}'),
                   SUM(mi.quantity)::int,
                   SUM(mi.quantity * mi.unit_price)::float
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mi.seller_sku = :sku
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mo.date_created >= NOW() - make_interval(days => :d)
            GROUP BY 1
        """, {"sku": sku, "d": days_int}) or []
        for r in rows:
            _add(r[0], "unistore_meli", r[1], r[2])
    except Exception as e:
        log.warning("series unistore_meli fail: %s", e)

    # Unidrop TN
    try:
        rows = q(eng_drp, f"""
            SELECT to_char(date_trunc('{bucket}', tno.created_at), '{fmt}'),
                   SUM(oi.quantity)::int,
                   SUM(oi.quantity * oi.price)::float
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE oi.sku = :sku AND tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - make_interval(days => :d)
            GROUP BY 1
        """, {"sku": sku, "d": days_int}) or []
        for r in rows:
            _add(r[0], "unidrop_tn", r[1], r[2])
    except Exception as e:
        log.warning("series unidrop_tn fail: %s", e)

    # Unidrop MELI
    try:
        rows = q(eng_drp, f"""
            SELECT to_char(date_trunc('{bucket}', o."dateCreated"), '{fmt}'),
                   SUM(oi.quantity)::int,
                   SUM(oi.quantity * oi."unitPrice")::float
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" = :sku
              AND (o.status IN ('paid','confirmed','shipped','delivered') OR o."paidAmount" > 0)
              AND o."dateCreated" >= NOW() - make_interval(days => :d)
            GROUP BY 1
        """, {"sku": sku, "d": days_int}) or []
        for r in rows:
            _add(r[0], "unidrop_meli", r[1], r[2])
    except Exception as e:
        log.warning("series unidrop_meli fail: %s", e)

    return {
        "sku": sku,
        "granularity": granularity,
        "days": days_int,
        "rows": [{"period": p, **vals} for p, vals in sorted(series.items())],
    }


def sku_omnichannel(sku: str) -> dict:
    """Devuelve agregados del SKU en los 4 canales + serie mensual + alertas
    de inconsistencia."""
    if not sku:
        return {"error": "SKU vacio"}

    eng_uni = get_engine("unistore")
    eng_drop = get_engine("unidrop")

    # Antes: 4 queries seriales (2 contra unistore, 2 contra unidrop) -> ~2s.
    # Ahora: las 4 corren en paralelo en threads. Cada thread abre su propia
    # conexion del pool del engine correspondiente. ~500-800ms total.
    f_uni_tn = _PARALLEL_POOL.submit(_unistore_tn, eng_uni, sku)
    f_uni_meli = _PARALLEL_POOL.submit(_unistore_meli, eng_uni, sku)
    f_drop_tn = _PARALLEL_POOL.submit(_unidrop_tn, eng_drop, sku)
    f_drop_meli = _PARALLEL_POOL.submit(_unidrop_meli, eng_drop, sku)
    unistore_tn = f_uni_tn.result()
    unistore_meli = f_uni_meli.result()
    unidrop_tn = f_drop_tn.result()
    unidrop_meli = f_drop_meli.result()

    channels = {
        "unistore_tn": unistore_tn,
        "unistore_meli": unistore_meli,
        "unidrop_tn": unidrop_tn,
        "unidrop_meli": unidrop_meli,
    }

    # Totales agregados
    totales = {
        "units_30d": sum(c["units_30d"] for c in channels.values()),
        "units_90d": sum(c["units_90d"] for c in channels.values()),
        "units_total": sum(c["units_total"] for c in channels.values()),
        "revenue_30d": round(sum(c["revenue_30d"] for c in channels.values()), 2),
        "revenue_90d": round(sum(c["revenue_90d"] for c in channels.values()), 2),
        "revenue_total": round(sum(c["revenue_total"] for c in channels.values()), 2),
        "orders_total": sum(c["orders_total"] for c in channels.values()),
        "channels_activos": sum(1 for c in channels.values() if c["available"]),
    }

    # Nombre representativo: el de mayor revenue_total
    best_name = None
    best_rev = -1.0
    for c in channels.values():
        if c.get("name") and c["revenue_total"] > best_rev:
            best_name = c["name"]
            best_rev = c["revenue_total"]

    # Detector de inconsistencias
    inconsistencias: list[dict] = []
    # 1) Vendido en Unistore pero no en Unidrop (oportunidad de listar)
    sold_unistore = unistore_tn["available"] or unistore_meli["available"]
    sold_unidrop = unidrop_tn["available"] or unidrop_meli["available"]
    if sold_unistore and not sold_unidrop:
        inconsistencias.append({
            "tipo": "sin_listar_unidrop",
            "severity": "warning",
            "mensaje": "Se vende en Unistore pero los dropshippers no lo tienen listado. Evaluar agregarlo al catalogo Unidrop.",
        })
    if sold_unidrop and not sold_unistore:
        inconsistencias.append({
            "tipo": "solo_unidrop",
            "severity": "info",
            "mensaje": "Se vende en Unidrop pero no en el retail Unistore. Producto exclusivo de dropshipping o no esta listado en retail.",
        })
    # 2) Solo en uno de los dos canales MELI vs TN
    if unistore_tn["available"] and not unistore_meli["available"]:
        inconsistencias.append({
            "tipo": "unistore_solo_tn",
            "severity": "info",
            "mensaje": "Unistore lo vende en TN pero no en MELI. Posible publicacion pausada o no listado en Fox Electronics MELI.",
        })
    if unidrop_meli["available"] and not unidrop_tn["available"]:
        inconsistencias.append({
            "tipo": "unidrop_solo_meli",
            "severity": "info",
            "mensaje": "Unidrop lo vende solo en MELI, ningun dropshipper lo activo en TN.",
        })
    # 3) Diferencia de precio promedio entre canales (alerta si > 25%)
    prices = [(k, c["avg_price"]) for k, c in channels.items() if c["avg_price"] > 0]
    if len(prices) >= 2:
        mn = min(p for _, p in prices)
        mx = max(p for _, p in prices)
        if mn > 0 and (mx - mn) / mn > 0.25:
            ch_min = next(k for k, p in prices if p == mn)
            ch_max = next(k for k, p in prices if p == mx)
            inconsistencias.append({
                "tipo": "precio_disparado",
                "severity": "warning",
                "mensaje": f"Diferencia de precio >25% entre canales: {ch_min}=${mn:.0f} vs {ch_max}=${mx:.0f} ({(mx-mn)/mn*100:.0f}% gap).",
            })
    # 4) Errores de query (tabla rota / esquema cambiado)
    for canal, c in channels.items():
        if c.get("error"):
            inconsistencias.append({
                "tipo": "fuente_inaccesible",
                "severity": "error",
                "mensaje": f"Canal {canal}: {c['error']}",
            })

    monthly = _monthly_by_channel(eng_uni, eng_drop, sku)

    return {
        "sku": sku,
        "nombre": best_name,
        "channels": channels,
        "totales": totales,
        "inconsistencias": inconsistencias,
        "monthly_by_channel": monthly,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
