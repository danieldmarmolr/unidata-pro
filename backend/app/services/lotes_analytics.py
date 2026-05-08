"""
Gestion de Lotes - replica de PowerBI ERP Analytics.

Cruza:
- cost_lote / cost_item (Supabase) -> Excel "VALOR PRODUCTO.xlsx" cargado por admin
- tienda_nube.OrderItem + Order paid (Unistore RDS) -> ventas TN
- meli.meli_order_items + meli_orders status paid (Unistore RDS) -> ventas MELI

Calcula por lote: U.C., U.V., Consumo, Markup, Cobertura, Stock Inicial/Actual, etc.

Metodologia:
- "U.V. del lote" = ventas de SKUs del lote, en el periodo desde fecha_ingreso
  hasta min(today, fecha_ingreso del siguiente lote con mismo SKU - 1 dia).
  Esto evita doble conteo cuando un SKU aparece en multiples lotes.
- "Stock Actual" = U.C. - U.V. del lote (no toca DIGIP/Contabillium real, es estimacion).
- "Cobertura de Pago" = Facturacion / Costo Total * 100. Indica que % del lote ya se
  recupero con ventas reales.
- TC para convertir USD->ARS: usa el USD rate cacheado en costs.usd_rate_cache.
"""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import text

from app.db import costs_db
from app.db.engines import get_engine
from app.db.local_persistence import get_conn

log = logging.getLogger(__name__)


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def _get_usd_rate() -> float:
    """TC USD->ARS desde el cache (default 1100 si no hay)."""
    rate = costs_db.get_cached_rate()
    return float(rate.get("venta") or 1100.0) if rate else 1100.0


def _parse_date(v) -> dt.date | None:
    if v is None or v == "":
        return None
    if isinstance(v, dt.date) and not isinstance(v, dt.datetime):
        return v
    if isinstance(v, dt.datetime):
        return v.date()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def _filter_clause(filters: dict) -> tuple[str, dict]:
    """Construye la clausula WHERE para cost_lote segun filters.

    Filters soportados:
      - proveedor: str
      - origen: str
      - lote: str (busqueda exacta o LIKE)
      - fecha_desde: ISO date (filtra por lote.imported_at o fecha_ingreso)
      - fecha_hasta: ISO date
    """
    clauses = ["1=1"]
    params: dict = {}
    if filters.get("proveedor"):
        clauses.append("LOWER(l.proveedor) = LOWER(%(proveedor)s)")
        params["proveedor"] = filters["proveedor"]
    if filters.get("origen"):
        clauses.append("LOWER(l.origen) = LOWER(%(origen)s)")
        params["origen"] = filters["origen"]
    if filters.get("lote"):
        clauses.append("LOWER(l.lote) ILIKE LOWER(%(lote)s)")
        params["lote"] = f"%{filters['lote']}%"
    if filters.get("fecha_desde"):
        clauses.append("l.fecha_ingreso >= %(fecha_desde)s")
        params["fecha_desde"] = filters["fecha_desde"]
    if filters.get("fecha_hasta"):
        clauses.append("l.fecha_ingreso <= %(fecha_hasta)s")
        params["fecha_hasta"] = filters["fecha_hasta"]
    return " AND ".join(clauses), params


# ------------------------------------------------------------
# Carga de cost_lote + cost_item desde Supabase
# ------------------------------------------------------------

def _load_lotes_with_items(filters: dict) -> list[dict]:
    """Devuelve lotes (con sus items) que matchean los filtros.

    Returns: [
      {
        "lote_id": int, "lote": str, "proveedor": str|None,
        "fecha_ingreso": str|None, "origen": str|None,
        "items": [
          {"sku": str, "cantidad": int|None, "precio_ars": float|None,
           "costo_total_sin_iva_usd": float|None, "costo_con_iva_usd": float|None,
           "valor_max_usd": float|None, ...}
        ]
      }
    ]
    """
    where, params = _filter_clause(filters)
    with get_conn() as c, c.cursor() as cur:
        cur.execute(f"""
            SELECT l.id, l.lote, l.proveedor, l.fecha_ingreso, l.origen, l.envio,
                   l.moneda, l.imported_at, l.items_count,
                   COALESCE(json_agg(json_build_object(
                       'sku', i.sku,
                       'producto', i.producto,
                       'categoria', i.categoria,
                       'cantidad', i.cantidad,
                       'valor_max_usd', i.valor_max_usd,
                       'valor_min_usd', i.valor_min_usd,
                       'costo_total_sin_iva_usd', i.costo_total_sin_iva_usd,
                       'costo_con_iva_usd', i.costo_con_iva_usd,
                       'precio_ars', i.precio_ars
                   )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
            FROM cost_lote l
            LEFT JOIN cost_item i ON i.lote_id = l.id
            WHERE {where}
            GROUP BY l.id
            ORDER BY l.fecha_ingreso DESC NULLS LAST, l.lote
        """, params)
        rows = cur.fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["lote_id"] = d.pop("id")
        # ISO format
        if d.get("fecha_ingreso") and not isinstance(d["fecha_ingreso"], str):
            d["fecha_ingreso"] = d["fecha_ingreso"].isoformat() if d["fecha_ingreso"] else None
        if d.get("imported_at") and not isinstance(d["imported_at"], str):
            d["imported_at"] = d["imported_at"].isoformat()
        out.append(d)
    return out


# ------------------------------------------------------------
# Ventas reales por SKU desde Unistore RDS (TN + MELI)
# ------------------------------------------------------------

def _get_sales_by_sku_in_period(skus: list[str], from_date: dt.date | None, to_date: dt.date | None) -> dict[str, dict]:
    """Consulta TN + MELI y devuelve por SKU:
      {
        "sold_qty": int,
        "revenue_ars": float,
        "first_sale": str|None,
        "last_sale": str|None,
        "orders_count": int,
        "channel_breakdown": {"tn": {qty, revenue}, "ml": {qty, revenue}}
      }
    """
    if not skus:
        return {}

    eng = get_engine("unistore")
    skus_clean = list({s.strip() for s in skus if s and s.strip()})

    params = {
        "skus": skus_clean,
        "from_date": from_date,
        "to_date": to_date or dt.date.today(),
    }
    date_filter_tn = ""
    date_filter_ml = ""
    if from_date:
        date_filter_tn += ' AND o."createdAt"::date >= :from_date'
        date_filter_ml += " AND mo.date_created::date >= :from_date"
    if to_date:
        date_filter_tn += ' AND o."createdAt"::date <= :to_date'
        date_filter_ml += " AND mo.date_created::date <= :to_date"

    with eng.connect() as c:
        # TN
        rows_tn = c.execute(text(f"""
            SELECT oi.sku,
                   SUM(oi.quantity)::int AS qty,
                   SUM(oi.quantity * oi.price)::float AS revenue,
                   MIN(o."createdAt")::date AS first_sale,
                   MAX(o."createdAt")::date AS last_sale,
                   COUNT(DISTINCT o.id)::int AS orders_count
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE oi.sku = ANY(:skus)
              AND o."paymentStatus" = 'paid'
              {date_filter_tn}
            GROUP BY oi.sku
        """), params).mappings().all()

        # MELI
        rows_ml = c.execute(text(f"""
            SELECT mi.seller_sku AS sku,
                   SUM(mi.quantity)::int AS qty,
                   SUM(mi.unit_price * mi.quantity)::float AS revenue,
                   MIN(mo.date_created)::date AS first_sale,
                   MAX(mo.date_created)::date AS last_sale,
                   COUNT(DISTINCT mo.id)::int AS orders_count
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mi.seller_sku = ANY(:skus)
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              {date_filter_ml}
            GROUP BY mi.seller_sku
        """), params).mappings().all()

    # Mergear por SKU
    by_sku: dict[str, dict] = {}
    for r in rows_tn:
        sku = r["sku"]
        by_sku.setdefault(sku, {
            "sold_qty": 0, "revenue_ars": 0.0, "first_sale": None,
            "last_sale": None, "orders_count": 0,
            "channel_breakdown": {"tn": {"qty": 0, "revenue": 0.0}, "ml": {"qty": 0, "revenue": 0.0}},
        })
        by_sku[sku]["sold_qty"] += int(r["qty"] or 0)
        by_sku[sku]["revenue_ars"] += float(r["revenue"] or 0)
        by_sku[sku]["orders_count"] += int(r["orders_count"] or 0)
        by_sku[sku]["channel_breakdown"]["tn"]["qty"] += int(r["qty"] or 0)
        by_sku[sku]["channel_breakdown"]["tn"]["revenue"] += float(r["revenue"] or 0)
        if r["first_sale"]:
            fs = r["first_sale"].isoformat() if hasattr(r["first_sale"], "isoformat") else str(r["first_sale"])
            cur_fs = by_sku[sku]["first_sale"]
            by_sku[sku]["first_sale"] = fs if not cur_fs or fs < cur_fs else cur_fs
        if r["last_sale"]:
            ls = r["last_sale"].isoformat() if hasattr(r["last_sale"], "isoformat") else str(r["last_sale"])
            cur_ls = by_sku[sku]["last_sale"]
            by_sku[sku]["last_sale"] = ls if not cur_ls or ls > cur_ls else cur_ls

    for r in rows_ml:
        sku = r["sku"]
        by_sku.setdefault(sku, {
            "sold_qty": 0, "revenue_ars": 0.0, "first_sale": None,
            "last_sale": None, "orders_count": 0,
            "channel_breakdown": {"tn": {"qty": 0, "revenue": 0.0}, "ml": {"qty": 0, "revenue": 0.0}},
        })
        by_sku[sku]["sold_qty"] += int(r["qty"] or 0)
        by_sku[sku]["revenue_ars"] += float(r["revenue"] or 0)
        by_sku[sku]["orders_count"] += int(r["orders_count"] or 0)
        by_sku[sku]["channel_breakdown"]["ml"]["qty"] += int(r["qty"] or 0)
        by_sku[sku]["channel_breakdown"]["ml"]["revenue"] += float(r["revenue"] or 0)
        if r["first_sale"]:
            fs = r["first_sale"].isoformat() if hasattr(r["first_sale"], "isoformat") else str(r["first_sale"])
            cur_fs = by_sku[sku]["first_sale"]
            by_sku[sku]["first_sale"] = fs if not cur_fs or fs < cur_fs else cur_fs
        if r["last_sale"]:
            ls = r["last_sale"].isoformat() if hasattr(r["last_sale"], "isoformat") else str(r["last_sale"])
            cur_ls = by_sku[sku]["last_sale"]
            by_sku[sku]["last_sale"] = ls if not cur_ls or ls > cur_ls else cur_ls

    return by_sku


# ------------------------------------------------------------
# Logica de "fecha de corte por SKU" — atribuir ventas al lote correcto
# ------------------------------------------------------------

def _build_sku_period_map(lotes: list[dict]) -> dict[tuple[str, int], tuple[dt.date | None, dt.date | None]]:
    """Para cada (sku, lote_id) calcula el periodo en que las ventas del SKU
    se atribuyen a ESE lote: desde fecha_ingreso del lote hasta el dia anterior
    al fecha_ingreso del proximo lote con el mismo SKU.

    Si el SKU no se repite, el periodo va hasta hoy.
    """
    # 1. Agrupar lotes por SKU, ordenados por fecha_ingreso ASC
    sku_lotes: dict[str, list[tuple[dt.date | None, int]]] = {}
    for lote in lotes:
        fi = _parse_date(lote.get("fecha_ingreso"))
        if not fi:
            continue
        for item in (lote.get("items") or []):
            sku = (item.get("sku") or "").strip()
            if not sku:
                continue
            sku_lotes.setdefault(sku, []).append((fi, lote["lote_id"]))

    # 2. Para cada SKU, ordenar por fecha y armar tuplas (start, end)
    today = dt.date.today()
    period_map: dict[tuple[str, int], tuple[dt.date | None, dt.date | None]] = {}
    for sku, dates in sku_lotes.items():
        dates.sort(key=lambda x: x[0])
        for i, (start, lote_id) in enumerate(dates):
            end = (dates[i + 1][0] - dt.timedelta(days=1)) if i + 1 < len(dates) else today
            period_map[(sku, lote_id)] = (start, end)
    return period_map


# ------------------------------------------------------------
# Calculo de metricas por lote
# ------------------------------------------------------------

def _calc_lote_metrics(lote: dict, period_map: dict, sales_by_sku_period: dict) -> dict:
    """Calcula KPIs del lote:
      U.C., U.V., Consumo, Total Costo, Total Facturacion, Markup, Cobertura, Stock Actual.
    """
    items = lote.get("items") or []
    usd_rate = _get_usd_rate()

    u_compradas = 0
    total_costo = 0.0
    total_facturacion = 0.0
    u_vendidas = 0
    skus_count = 0
    items_detail = []

    for item in items:
        sku = (item.get("sku") or "").strip()
        if not sku:
            continue
        skus_count += 1

        cantidad = int(item.get("cantidad") or 0)
        # Costo por unidad en ARS = costo_con_iva_usd * TC (si esta), sino costo_total_sin_iva_usd * TC
        costo_unit_usd = item.get("costo_con_iva_usd") or item.get("costo_total_sin_iva_usd") or 0
        costo_unit_ars = float(costo_unit_usd or 0) * usd_rate
        costo_total_lote_item = costo_unit_ars * cantidad

        precio_unit = float(item.get("precio_ars") or 0)
        markup_unit = precio_unit - costo_unit_ars if precio_unit and costo_unit_ars else 0
        markup_pct = (markup_unit / costo_unit_ars * 100) if costo_unit_ars else 0

        # Ventas atribuidas a ESTE lote para este SKU (con period_map)
        sales_data = sales_by_sku_period.get((sku, lote["lote_id"]), {})
        uv = int(sales_data.get("sold_qty") or 0)
        rev = float(sales_data.get("revenue_ars") or 0)

        u_compradas += cantidad
        total_costo += costo_total_lote_item
        total_facturacion += rev
        u_vendidas += uv

        consumo_pct = (uv / cantidad * 100) if cantidad else 0
        stock_actual = max(0, cantidad - uv)
        markup_real = markup_unit * uv  # markup ya realizado por ventas

        items_detail.append({
            "sku": sku,
            "producto": item.get("producto"),
            "categoria": item.get("categoria"),
            "u_comprada": cantidad,
            "precio_unit_ars": precio_unit,
            "costo_unit_ars": costo_unit_ars,
            "markup_unit_ars": markup_unit,
            "markup_pct": markup_pct,
            "stock_inicial": cantidad,
            "stock_actual": stock_actual,
            "u_vendida": uv,
            "consumo_pct": consumo_pct,
            "total_costo_item": costo_total_lote_item,
            "total_facturacion_item": rev,
            "markup_real_item": markup_real,
            "first_sale": sales_data.get("first_sale"),
            "last_sale": sales_data.get("last_sale"),
        })

    consumo_lote_pct = (u_vendidas / u_compradas * 100) if u_compradas else 0
    cobertura_pago_pct = (total_facturacion / total_costo * 100) if total_costo else 0
    markup_total = total_facturacion - (total_costo * (u_vendidas / u_compradas if u_compradas else 0))
    markup_pct_lote = (markup_total / total_costo * 100) if total_costo else 0

    # Estado heuristico
    estado = _calc_estado(consumo_lote_pct, lote.get("fecha_ingreso"))

    return {
        "lote_id": lote["lote_id"],
        "lote": lote["lote"],
        "proveedor": lote.get("proveedor"),
        "fecha_ingreso": lote.get("fecha_ingreso"),
        "origen": lote.get("origen"),
        "envio": lote.get("envio"),
        "moneda": lote.get("moneda"),
        "imported_at": lote.get("imported_at"),
        "skus_count": skus_count,
        # KPIs principales (replica PowerBI)
        "u_compradas": u_compradas,
        "u_vendidas": u_vendidas,
        "consumo_lote_pct": round(consumo_lote_pct, 2),
        "total_costo_ars": round(total_costo, 2),
        "total_facturacion_ars": round(total_facturacion, 2),
        "markup_total_ars": round(markup_total, 2),
        "markup_pct": round(markup_pct_lote, 2),
        "cobertura_pago_pct": round(cobertura_pago_pct, 2),
        "estado": estado,
        # Detail items (uso opcional, para drilldown)
        "items": items_detail,
    }


def _calc_estado(consumo_pct: float, fecha_ingreso: str | None) -> str:
    """Categoria heuristica del lote."""
    if consumo_pct >= 100:
        return "agotado"
    fi = _parse_date(fecha_ingreso)
    if not fi:
        return "sin_fecha"
    days = (dt.date.today() - fi).days
    if days <= 0:
        return "nuevo"
    expected_at_days = (days / 180) * 100  # se "espera" 100% consumido en 6 meses
    if consumo_pct >= expected_at_days:
        return "saludable"
    if consumo_pct < expected_at_days * 0.5:
        if days > 90 and consumo_pct < 5:
            return "stuck"
        return "lento"
    if consumo_pct < expected_at_days * 0.8:
        return "lento"
    return "saludable"


# ------------------------------------------------------------
# API publica del modulo
# ------------------------------------------------------------

def lotes_overview(filters: dict | None = None) -> dict:
    """Devuelve KPIs cabecera + tabla de lotes con sus metricas.

    filters: {proveedor, origen, lote, fecha_desde, fecha_hasta}
    """
    filters = filters or {}
    lotes = _load_lotes_with_items(filters)
    if not lotes:
        return {
            "totals": {
                "u_compradas": 0, "u_vendidas": 0,
                "total_costo_ars": 0, "total_facturacion_ars": 0,
                "markup_total_ars": 0, "markup_pct": 0,
                "consumo_lote_pct": 0, "cobertura_pago_pct": 0,
                "lotes_count": 0, "skus_count": 0,
            },
            "lotes": [],
            "filters_available": _get_filters_available(),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }

    # Build period_map para atribuir ventas al lote correcto
    period_map = _build_sku_period_map(lotes)

    # Para cada (sku, lote_id), traer sus ventas en el periodo correspondiente
    # Para no hacer una query por SKU, hacemos batches por (from_date, to_date) similar
    # Simplification: una sola query con TODAS las ventas, despues filtramos en Python por periodo
    all_skus = list({k[0] for k in period_map.keys()})

    if not all_skus:
        sales_all = {}
    else:
        # Earliest fecha_ingreso = inicio del rango global
        earliest = min((p[0] for p in period_map.values() if p[0]), default=None)
        # NO usamos to_date en la query global, filtramos por periodo despues
        sales_all = _get_sales_by_sku_in_period(all_skus, earliest, None)

    # Atribuir ventas al lote correcto necesita queries por (sku, periodo).
    # Como la mayoria de SKUs no se repite, simplificamos:
    # - Si el SKU aparece en 1 solo lote: usar sales_all directo
    # - Si aparece en >1 lote: hacer query especifica por periodo
    sku_count = {}
    for sku, _ in period_map.keys():
        sku_count[sku] = sku_count.get(sku, 0) + 1

    sales_by_period: dict[tuple[str, int], dict] = {}
    repeated_skus = [s for s, n in sku_count.items() if n > 1]

    # SKUs que aparecen 1 sola vez: ventas totales = ventas del lote
    for (sku, lote_id), (start, end) in period_map.items():
        if sku_count[sku] == 1:
            sales_by_period[(sku, lote_id)] = sales_all.get(sku, {})

    # SKUs repetidos: query specifica por periodo
    if repeated_skus:
        # Optimizacion: una query por SKU con todos sus periodos
        for sku in repeated_skus:
            periods_for_sku = [(lid, p) for (s, lid), p in period_map.items() if s == sku]
            for lote_id, (start, end) in periods_for_sku:
                period_sales = _get_sales_by_sku_in_period([sku], start, end)
                sales_by_period[(sku, lote_id)] = period_sales.get(sku, {})

    # Calcular metricas por lote
    rows = [_calc_lote_metrics(lote, period_map, sales_by_period) for lote in lotes]

    # Totales
    totals = {
        "u_compradas": sum(r["u_compradas"] for r in rows),
        "u_vendidas": sum(r["u_vendidas"] for r in rows),
        "total_costo_ars": sum(r["total_costo_ars"] for r in rows),
        "total_facturacion_ars": sum(r["total_facturacion_ars"] for r in rows),
        "markup_total_ars": sum(r["markup_total_ars"] for r in rows),
        "lotes_count": len(rows),
        "skus_count": sum(r["skus_count"] for r in rows),
    }
    totals["consumo_lote_pct"] = round(
        (totals["u_vendidas"] / totals["u_compradas"] * 100) if totals["u_compradas"] else 0, 2
    )
    totals["cobertura_pago_pct"] = round(
        (totals["total_facturacion_ars"] / totals["total_costo_ars"] * 100) if totals["total_costo_ars"] else 0, 2
    )
    totals["markup_pct"] = round(
        (totals["markup_total_ars"] / totals["total_costo_ars"] * 100) if totals["total_costo_ars"] else 0, 2
    )

    # Lotes en respuesta sin items (para listado liviano)
    lotes_summary = [{k: v for k, v in r.items() if k != "items"} for r in rows]

    return {
        "totals": totals,
        "lotes": lotes_summary,
        "filters_available": _get_filters_available(),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def lote_detail(lote_id: int, filters: dict | None = None) -> dict | None:
    """Detalle de un lote con todos sus items + ventas atribuidas."""
    filters = filters or {}
    lotes = _load_lotes_with_items({**filters, "lote_id": lote_id})
    # _load_lotes ignora lote_id por ahora, filtramos manual
    target = next((l for l in _load_lotes_with_items({}) if l["lote_id"] == lote_id), None)
    if not target:
        return None

    period_map = _build_sku_period_map([target])
    skus = list({k[0] for k in period_map.keys()})
    earliest = min((p[0] for p in period_map.values() if p[0]), default=None)
    sales_all = _get_sales_by_sku_in_period(skus, earliest, None) if skus else {}
    sales_by_period = {(s, target["lote_id"]): sales_all.get(s, {}) for s in skus}
    metrics = _calc_lote_metrics(target, period_map, sales_by_period)
    return metrics


def _get_filters_available() -> dict:
    """Devuelve listas de proveedores / origenes / lotes para los filtros del frontend."""
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT DISTINCT proveedor FROM cost_lote WHERE proveedor IS NOT NULL ORDER BY 1")
        proveedores = [r["proveedor"] for r in cur.fetchall()]
        cur.execute("SELECT DISTINCT origen FROM cost_lote WHERE origen IS NOT NULL ORDER BY 1")
        origenes = [r["origen"] for r in cur.fetchall()]
        cur.execute("SELECT lote, fecha_ingreso FROM cost_lote ORDER BY fecha_ingreso DESC NULLS LAST LIMIT 200")
        lotes = [{"lote": r["lote"], "fecha_ingreso": r["fecha_ingreso"].isoformat() if r["fecha_ingreso"] and not isinstance(r["fecha_ingreso"], str) else r["fecha_ingreso"]} for r in cur.fetchall()]
    return {
        "proveedores": proveedores,
        "origenes": origenes,
        "lotes": lotes,
    }
