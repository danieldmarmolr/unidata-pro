"""
SKU 360 extras - vistas enriquecidas para la pagina /dashboard/productos/[sku].

Agrupa varias vistas independientes que se inyectan en product_detail():

1. stock_detail()     - DIGIP stock area -> ubicaciones[] con unidades y ultimo
                        movimiento (MovimientoAjuste.fecha) por (sku, area).

2. forecast_per_channel() - velocity + trend per canal x 4.

3. unidrop_pricing()  - cost_avg + price_retail_avg + markup + stddev por canal
                        Unidrop (TN + MELI).

4. lotes_history()    - todos los lotes en los que aparece el SKU.

5. digip_articulo_info() - Vista ESPEJO de las 3 tablas maestras de DIGIP que
                            definen el articulo:
                              - digip.Articulo (1 row, atributos del SKU)
                              - digip.ArticuloUnidadMedida (N rows, unidades
                                de medida: unidad / caja / pallet ...)
                              - digip.ArticuloUnidadMedidaCodigo (N rows por
                                unidad, codigos escaneables - EAN, UPC, etc)
                            Descubre las columnas via information_schema, asi
                            que toma TODO lo que digip tenga (no hardcodea).

NOTA: cada funcion captura sus excepciones - una falla no rompe la pagina.
Si DIGIP esta caido, stock_detail vuelve vacio pero el resto sigue.
"""
from __future__ import annotations

import datetime as dt
import logging
import math

from app.db.engines import get_engine
from app.services._utils import q

log = logging.getLogger("unidata.sku_360_extras")


# ============================================================
# 1. STOCK DETAIL: area -> ubicaciones
# ============================================================

_STOCK_BREAKDOWN_COLS = [
    "unidadesDisponibles", "unidadesReservadas", "unidadesBloqueadas",
    "unidadesAdespachar", "unidadesADespachar", "unidadesAdespacar",
    "unidadesEnRecepcion", "unidadesTransitoInterno",
    "unidadesVencidas", "unidadesPedidas",
]


def _digip_stock_summary(eng, sku: str) -> dict:
    """Lee digip."Stock" para tomar el panorama completo agregado del SKU
    (disponibles / reservadas / bloqueadas / a despachar / en recepcion /
    transito interno / vencidas / pedidas + updatedAt).

    digip.Stock es 1 row por SKU (resumen consolidado). digip.StockDetalle
    es per (sku, area, ubicacion). Las dos son complementarias.

    Como el schema digip es inconsistente (PascalCase, camelCase, lowercase
    mezclados), descubrimos las columnas reales via information_schema en
    vez de hardcodearlas y rezar.
    """
    out = {
        "available": False,
        "disponibles": 0, "reservadas": 0, "bloqueadas": 0,
        "a_despachar": 0, "en_recepcion": 0, "transito_interno": 0,
        "vencidas": 0, "pedidas": 0,
        "total_fisico": 0,    # disponibles + reservadas + bloqueadas + a_despachar (lo que ya esta en deposito)
        "total_pipeline": 0,  # en_recepcion + transito_interno + pedidas (lo que viene)
        "updated_at": None,
    }
    try:
        # Descubrir el nombre real de la columna SKU + columnas de unidades
        cols_rows = q(eng, """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='digip' AND table_name='Stock'
        """) or []
        cols = {r[0] for r in cols_rows}
        # SKU column: probar variantes en orden
        sku_col = None
        for candidate in ("CodigoArticulo", "codigoArticulo", "articuloCodigo"):
            if candidate in cols:
                sku_col = candidate
                break
        if not sku_col:
            log.warning("digip.Stock: no SKU column found, available cols=%s", sorted(cols))
            return out

        # digip.Stock es 1 row por SKU (resumen consolidado). Por eso no usamos
        # GROUP BY ni aggregates - SELECT simple sobre 1 fila. Si llegara a
        # haber duplicados, tomamos la primera (no debiera pasar segun el
        # diseno de digip).
        select_parts = []
        col_map = {}  # nombre canonico -> nombre real
        canonical_to_db = {
            "disponibles": ["unidadesDisponibles"],
            "reservadas": ["unidadesReservadas"],
            "bloqueadas": ["unidadesBloqueadas"],
            "a_despachar": ["unidadesAdespachar", "unidadesADespachar"],
            "en_recepcion": ["unidadesEnRecepcion"],
            "transito_interno": ["unidadesTransitoInterno"],
            "vencidas": ["unidadesVencidas"],
            "pedidas": ["unidadesPedidas"],
        }
        for canonical, candidates in canonical_to_db.items():
            for cand in candidates:
                if cand in cols:
                    col_map[canonical] = cand
                    select_parts.append(f'COALESCE("{cand}", 0)::int AS {canonical}')
                    break
        upd_col = "updatedAt" if "updatedAt" in cols else ("updated_at" if "updated_at" in cols else None)
        if upd_col:
            select_parts.append(f'"{upd_col}" AS upd')

        if not select_parts:
            return out

        sql = f'''
            SELECT {", ".join(select_parts)}
            FROM digip."Stock"
            WHERE "{sku_col}" = :sku
            LIMIT 1
        '''
        rows = q(eng, sql, {"sku": sku}) or []
        if not rows:
            return out
        row = rows[0]
        # Mapping posicional - el orden del SELECT lo respeta
        idx = 0
        for canonical in canonical_to_db:
            if canonical in col_map:
                out[canonical] = int(row[idx] or 0)
                idx += 1
        if upd_col and idx < len(row):
            v = row[idx]
            if v:
                try:
                    out["updated_at"] = v.strftime("%Y-%m-%d %H:%M") if hasattr(v, "strftime") else str(v)[:16]
                except Exception:
                    out["updated_at"] = str(v)[:16]

        out["total_fisico"] = out["disponibles"] + out["reservadas"] + out["bloqueadas"] + out["a_despachar"]
        out["total_pipeline"] = out["en_recepcion"] + out["transito_interno"] + out["pedidas"]
        out["available"] = (out["total_fisico"] + out["total_pipeline"] + out["vencidas"]) > 0
        return out
    except Exception as e:
        log.warning("_digip_stock_summary fail sku=%s err=%s", sku, e)
        return out


def stock_detail(sku: str) -> dict:
    """Stock DIGIP del SKU: panorama agregado (digip.Stock) +
    desglose area -> ubicaciones[] (digip.StockDetalle).

    breakdown: 1 row de digip.Stock con disponibles/reservadas/bloqueadas/
    a_despachar/en_recepcion/transito_interno/vencidas/pedidas + updated_at.

    areas: per (area, ubicacion) sumando unidades + last_movement de
    MovimientoAjuste por (sku, area).

    Las dos vistas son complementarias: breakdown te dice el panorama
    operativo; areas te dice donde fisicamente esta cada unidad.
    """
    out = {
        "sku": sku, "total": 0, "total_ubicaciones": 0, "areas_count": 0,
        "areas": [], "breakdown": None,
    }
    try:
        eng = get_engine("unistore")
    except Exception as e:
        log.warning("stock_detail engine fail: %s", e)
        return out

    # Panorama agregado del SKU (digip.Stock)
    out["breakdown"] = _digip_stock_summary(eng, sku)

    # Stock por area + ubicacion
    try:
        rows = q(eng, """
            SELECT COALESCE(NULLIF("areaDescripcion", ''), '(sin area)') AS area,
                   COALESCE(NULLIF(ubicacion, ''), '(sin ubicacion)') AS ubicacion,
                   SUM(unidades)::int AS units
            FROM digip."StockDetalle"
            WHERE "articuloCodigo" = :sku
            GROUP BY 1, 2
            ORDER BY area ASC, units DESC
        """, {"sku": sku}) or []
    except Exception as e:
        log.warning("stock_detail rows fail: %s", e)
        rows = []

    by_area: dict[str, dict] = {}
    for area, ubic, units in rows:
        u = int(units or 0)
        if u == 0:
            continue
        ent = by_area.setdefault(area, {
            "area": area, "total": 0, "ubicaciones": [],
            "last_movement": None, "movements_count": 0,
        })
        ent["total"] += u
        ent["ubicaciones"].append({"ubicacion": ubic, "units": u})

    # Movimientos por area (proxy de 'edad')
    try:
        mv_rows = q(eng, """
            SELECT COALESCE(NULLIF(ma."areaDescripcion", ''), '(sin area)') AS area,
                   MAX(ma.fecha) AS last_mv,
                   COUNT(*)::int AS mv_count
            FROM digip."MovimientoAjuste" ma
            WHERE ma."articuloCodigo" = :sku
            GROUP BY 1
        """, {"sku": sku}) or []
        for area, last_mv, mv_count in mv_rows:
            ent = by_area.get(area)
            if not ent:
                continue
            if last_mv:
                try:
                    ent["last_movement"] = last_mv.strftime("%Y-%m-%d") if hasattr(last_mv, "strftime") else str(last_mv)[:10]
                except Exception:
                    ent["last_movement"] = str(last_mv)[:10]
            ent["movements_count"] = int(mv_count or 0)
    except Exception as e:
        log.warning("stock_detail movements fail: %s", e)

    areas_sorted = sorted(by_area.values(), key=lambda a: -a["total"])
    out["areas"] = areas_sorted
    out["areas_count"] = len(areas_sorted)
    out["total"] = sum(a["total"] for a in areas_sorted)
    out["total_ubicaciones"] = sum(len(a["ubicaciones"]) for a in areas_sorted)
    return out


# ============================================================
# 2. FORECAST PER-CHANNEL: velocity + trend por canal
# ============================================================

def _forecast_one(units_30d: int, units_prev30d: int, units_90d: int) -> dict:
    """Mismo motor que forecast_batch.forecast_all_skus. 90d velocity + trend
    acotado a [-0.5, 0.5]. Devuelve forecast 30d / 60d en unidades."""
    daily_velocity = units_90d / 90.0 if units_90d else 0.0
    if units_prev30d > 0:
        factor = (units_30d - units_prev30d) / units_prev30d
        factor = max(-0.5, min(0.5, factor))
    else:
        factor = 0.5 if units_30d > 0 else 0.0
    f30 = max(0, daily_velocity * 30 * (1 + factor))
    f60 = max(0, daily_velocity * 60 * (1 + factor))
    return {
        "daily_velocity": round(daily_velocity, 3),
        "trend_pct": round(factor * 100, 1),
        "forecast_30d": round(f30, 0),
        "forecast_60d": round(f60, 0),
    }


def forecast_per_channel(sku: str) -> dict:
    """Forecast 30d/60d per canal: Unistore TN, Unistore MELI, Unidrop TN, Unidrop MELI."""
    out = {
        "sku": sku,
        "unistore_tn": _forecast_one(0, 0, 0),
        "unistore_meli": _forecast_one(0, 0, 0),
        "unidrop_tn": _forecast_one(0, 0, 0),
        "unidrop_meli": _forecast_one(0, 0, 0),
        "total": _forecast_one(0, 0, 0),
    }

    try:
        eng_uni = get_engine("unistore")
    except Exception as e:
        log.warning("forecast eng_uni fail: %s", e)
        eng_uni = None
    try:
        eng_drp = get_engine("unidrop")
    except Exception as e:
        log.warning("forecast eng_drp fail: %s", e)
        eng_drp = None

    # Unistore TN
    if eng_uni:
        try:
            rows = q(eng_uni, """
                SELECT
                    SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '60 days'
                                            AND o."createdAt" < NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days')::int,
                    AVG(oi.price) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days')::float
                FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
            """, {"sku": sku}) or []
            if rows:
                u30, up30, u90, price_avg = rows[0]
                fc = _forecast_one(int(u30 or 0), int(up30 or 0), int(u90 or 0))
                fc["revenue_forecast_30d"] = round(float(fc["forecast_30d"]) * float(price_avg or 0), 0)
                out["unistore_tn"] = fc
        except Exception as e:
            log.warning("forecast unistore_tn fail: %s", e)

        # Unistore MELI
        try:
            rows = q(eng_uni, """
                SELECT
                    SUM(mi.quantity) FILTER (WHERE mo.date_created >= NOW() - INTERVAL '30 days')::int,
                    SUM(mi.quantity) FILTER (WHERE mo.date_created >= NOW() - INTERVAL '60 days'
                                            AND mo.date_created < NOW() - INTERVAL '30 days')::int,
                    SUM(mi.quantity) FILTER (WHERE mo.date_created >= NOW() - INTERVAL '90 days')::int,
                    AVG(mi.unit_price) FILTER (WHERE mo.date_created >= NOW() - INTERVAL '90 days')::float
                FROM meli.meli_order_items mi
                JOIN meli.meli_orders mo ON mo.id = mi.order_id
                WHERE mi.seller_sku = :sku
                  AND mo.status IN ('paid','confirmed','shipped','delivered')
            """, {"sku": sku}) or []
            if rows:
                u30, up30, u90, price_avg = rows[0]
                fc = _forecast_one(int(u30 or 0), int(up30 or 0), int(u90 or 0))
                fc["revenue_forecast_30d"] = round(float(fc["forecast_30d"]) * float(price_avg or 0), 0)
                out["unistore_meli"] = fc
        except Exception as e:
            log.warning("forecast unistore_meli fail: %s", e)

    # Unidrop TN
    if eng_drp:
        try:
            rows = q(eng_drp, """
                SELECT
                    SUM(oi.quantity) FILTER (WHERE tno.created_at >= NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE tno.created_at >= NOW() - INTERVAL '60 days'
                                            AND tno.created_at < NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE tno.created_at >= NOW() - INTERVAL '90 days')::int,
                    AVG(oi.price) FILTER (WHERE tno.created_at >= NOW() - INTERVAL '90 days')::float
                FROM public.tienda_nube_order_items oi
                JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
                WHERE oi.sku = :sku AND tno.payment_status::text = 'paid'
            """, {"sku": sku}) or []
            if rows:
                u30, up30, u90, price_avg = rows[0]
                fc = _forecast_one(int(u30 or 0), int(up30 or 0), int(u90 or 0))
                fc["revenue_forecast_30d"] = round(float(fc["forecast_30d"]) * float(price_avg or 0), 0)
                out["unidrop_tn"] = fc
        except Exception as e:
            log.warning("forecast unidrop_tn fail: %s", e)

        # Unidrop MELI
        try:
            rows = q(eng_drp, """
                SELECT
                    SUM(oi.quantity) FILTER (WHERE o."dateCreated" >= NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE o."dateCreated" >= NOW() - INTERVAL '60 days'
                                            AND o."dateCreated" < NOW() - INTERVAL '30 days')::int,
                    SUM(oi.quantity) FILTER (WHERE o."dateCreated" >= NOW() - INTERVAL '90 days')::int,
                    AVG(oi."unitPrice") FILTER (WHERE o."dateCreated" >= NOW() - INTERVAL '90 days')::float
                FROM mercado_libre_dev."OrderItemMercadoLibre" oi
                JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
                WHERE oi."sellerSku" = :sku
                  AND (o.status IN ('paid','confirmed','shipped','delivered') OR o."paidAmount" > 0)
            """, {"sku": sku}) or []
            if rows:
                u30, up30, u90, price_avg = rows[0]
                fc = _forecast_one(int(u30 or 0), int(up30 or 0), int(u90 or 0))
                fc["revenue_forecast_30d"] = round(float(fc["forecast_30d"]) * float(price_avg or 0), 0)
                out["unidrop_meli"] = fc
        except Exception as e:
            log.warning("forecast unidrop_meli fail: %s", e)

    # Total = suma de los 4 canales
    total_30 = sum(out[k]["forecast_30d"] for k in ("unistore_tn", "unistore_meli", "unidrop_tn", "unidrop_meli"))
    total_60 = sum(out[k]["forecast_60d"] for k in ("unistore_tn", "unistore_meli", "unidrop_tn", "unidrop_meli"))
    total_rev_30 = sum(out[k].get("revenue_forecast_30d", 0) or 0 for k in ("unistore_tn", "unistore_meli", "unidrop_tn", "unidrop_meli"))
    out["total"] = {
        "forecast_30d": round(total_30, 0),
        "forecast_60d": round(total_60, 0),
        "revenue_forecast_30d": round(total_rev_30, 0),
    }
    return out


# ============================================================
# 3. UNIDROP PRICING: cost + price + markup + stddev por canal
# ============================================================

def _stddev_units(prices: list[float], units: list[int]) -> float:
    """Desviacion estandar ponderada por unidades. Si todos son 0 -> 0."""
    total_u = sum(units)
    if total_u <= 1:
        return 0.0
    mean = sum(p * u for p, u in zip(prices, units)) / total_u
    var = sum(u * (p - mean) ** 2 for p, u in zip(prices, units)) / total_u
    return math.sqrt(var) if var > 0 else 0.0


def unidrop_pricing(sku: str) -> dict:
    """Costo mayorista + precio retail dropshipper + markup + desviacion por canal.

    Periodo: ultimos 90 dias para tener volumen suficiente; tambien lifetime.

    Devuelve por canal {tn, meli}:
        cost_avg, cost_stddev,
        price_retail_avg, price_retail_stddev,
        markup_pct, units, orders,
        cost_min, cost_max, price_min, price_max,
        pricing_consistency: 'tight' | 'moderate' | 'dispersed'
    """
    out = {
        "sku": sku,
        "tn": _empty_pricing(),
        "meli": _empty_pricing(),
    }
    try:
        eng = get_engine("unidrop")
    except Exception as e:
        log.warning("unidrop_pricing engine fail: %s", e)
        return out

    # ---------- Unidrop TN ----------
    try:
        rows = q(eng, """
            SELECT oi.price::float, COALESCE(oi.cost, 0)::float, oi.quantity::int,
                   tno.created_at
            FROM public.tienda_nube_order_items oi
            JOIN public.tienda_nube_orders tno ON tno.tienda_nube_id = oi.tienda_nube_order_id
            WHERE oi.sku = :sku AND tno.payment_status::text = 'paid'
              AND tno.created_at >= NOW() - INTERVAL '180 days'
        """, {"sku": sku}) or []
        if rows:
            out["tn"] = _aggregate_pricing(rows)
    except Exception as e:
        log.warning("unidrop_pricing tn fail: %s", e)

    # ---------- Unidrop MELI ----------
    try:
        rows = q(eng, """
            SELECT oi."unitPrice"::float, COALESCE(oi."unitCost", 0)::float, oi.quantity::int,
                   o."dateCreated"
            FROM mercado_libre_dev."OrderItemMercadoLibre" oi
            JOIN mercado_libre_dev."OrderMercadoLibre" o ON o.id = oi."orderId"
            WHERE oi."sellerSku" = :sku
              AND (o.status IN ('paid','confirmed','shipped','delivered') OR o."paidAmount" > 0)
              AND o."dateCreated" >= NOW() - INTERVAL '180 days'
        """, {"sku": sku}) or []
        if rows:
            out["meli"] = _aggregate_pricing(rows)
    except Exception as e:
        log.warning("unidrop_pricing meli fail: %s", e)

    return out


def _empty_pricing() -> dict:
    return {
        "available": False,
        "units": 0, "orders": 0,
        "cost_avg": 0.0, "cost_stddev": 0.0, "cost_min": 0.0, "cost_max": 0.0,
        "price_retail_avg": 0.0, "price_retail_stddev": 0.0,
        "price_min": 0.0, "price_max": 0.0,
        "markup_pct": None,
        "pricing_consistency": None,
    }


def _aggregate_pricing(rows: list) -> dict:
    """rows: [(price, cost, quantity, date), ...]"""
    prices = []
    costs = []
    units = []
    for price, cost, qty, _date in rows:
        try:
            p = float(price or 0)
            c = float(cost or 0)
            q_ = int(qty or 0)
        except (TypeError, ValueError):
            continue
        if q_ <= 0:
            continue
        prices.append(p)
        costs.append(c)
        units.append(q_)

    total_u = sum(units)
    if total_u == 0:
        return _empty_pricing()

    # Promedios ponderados por unidades
    price_avg = sum(p * u for p, u in zip(prices, units)) / total_u
    cost_avg = sum(c * u for c, u in zip(costs, units)) / total_u
    price_std = _stddev_units(prices, units)
    cost_std = _stddev_units(costs, units)

    # Min/Max (filtrando ceros para que no contamine cuando cost no esta cargado)
    nonzero_costs = [c for c in costs if c > 0]
    cost_min = min(nonzero_costs) if nonzero_costs else 0.0
    cost_max = max(nonzero_costs) if nonzero_costs else 0.0
    nonzero_prices = [p for p in prices if p > 0]
    price_min = min(nonzero_prices) if nonzero_prices else 0.0
    price_max = max(nonzero_prices) if nonzero_prices else 0.0

    # Markup: precio retail vs costo mayorista
    if cost_avg > 0 and price_avg > 0:
        markup_pct = round((price_avg - cost_avg) / cost_avg * 100, 1)
    else:
        markup_pct = None

    # Consistencia: coef variacion del precio retail (stddev/mean)
    cv = (price_std / price_avg) if price_avg > 0 else 0
    if cv < 0.05:
        consistency = "tight"        # <5% dispersion = todos venden a un precio similar
    elif cv < 0.20:
        consistency = "moderate"     # 5-20%
    else:
        consistency = "dispersed"    # >20% = guerra de precios o mercados muy distintos

    return {
        "available": True,
        "units": total_u,
        "orders": len(rows),
        "cost_avg": round(cost_avg, 0),
        "cost_stddev": round(cost_std, 0),
        "cost_min": round(cost_min, 0),
        "cost_max": round(cost_max, 0),
        "price_retail_avg": round(price_avg, 0),
        "price_retail_stddev": round(price_std, 0),
        "price_min": round(price_min, 0),
        "price_max": round(price_max, 0),
        "markup_pct": markup_pct,
        "pricing_consistency": consistency,
    }


# ============================================================
# LOTES HISTORY: passthrough enriquecido de cost_by_sku.history
# ============================================================

# ============================================================
# DIGIP ARTICULO INFO: vista espejo de las 3 tablas maestras
# ============================================================

# Columnas con datos sensibles o ruido que no aportan al usuario final.
# Se filtran del payload aunque existan en la tabla.
_ARTICULO_HIDE_COLS = {
    "createdBy", "updatedBy", "deletedBy",
    "deletedAt", "isDeleted",
    # digip serializa el payload completo en `raw` (str dict), redundante
    # con el resto de las columnas y muy ruidoso para la UI
    "raw",
}


def _digip_table_columns(eng, table: str) -> list[str]:
    """Devuelve las columnas reales de digip.<table> usando information_schema.
    Respeta el orden ordinal (que es el orden visible en pgAdmin / DBeaver).
    """
    try:
        rows = q(eng, """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'digip' AND table_name = :t
            ORDER BY ordinal_position
        """, {"t": table}) or []
        return [r[0] for r in rows]
    except Exception as e:
        log.warning("_digip_table_columns(%s) fail: %s", table, e)
        return []


def _serialize_value(v):
    """Convierte tipos PG a json-friendly. Datetimes -> ISO str. Decimal -> float.
    bool -> bool. None -> None. Resto -> str."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, dt.datetime):
        try:
            return v.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            return str(v)
    if isinstance(v, dt.date):
        return v.isoformat()
    # decimal.Decimal y otros numericos
    try:
        from decimal import Decimal
        if isinstance(v, Decimal):
            return float(v)
    except Exception:
        pass
    return str(v)


def _row_to_dict(cols: list[str], row) -> dict:
    """Mapea posicionalmente una row tupla a {col_name: serialized_value},
    filtrando columnas en _ARTICULO_HIDE_COLS."""
    out: dict = {}
    for i, c in enumerate(cols):
        if c in _ARTICULO_HIDE_COLS:
            continue
        try:
            out[c] = _serialize_value(row[i])
        except Exception:
            out[c] = None
    return out


def _ean_kind(codigo: str | None) -> str | None:
    """Detecta tipo de codigo escaneable por longitud (heuristica GS1).
    El campo `tipo` no siempre esta cargado, asi que damos un hint."""
    if not codigo:
        return None
    s = str(codigo).strip()
    if not s.isdigit():
        return "OTRO"
    L = len(s)
    if L == 13:
        return "EAN-13"
    if L == 12:
        return "UPC-A"
    if L == 8:
        return "EAN-8"
    if L == 14:
        return "GTIN-14"
    return "OTRO"


def digip_articulo_info(sku: str) -> dict:
    """Vista ESPEJO de las 3 tablas maestras DIGIP que definen el articulo.

    Devuelve TODO lo que digip tenga del SKU, descubriendo las columnas via
    information_schema (no hardcodea schema porque cambia).

    Estructura:
        {
            "sku": str,
            "available": bool,
            "articulo": {col: val, ...} | None,   # 1 row de digip.Articulo
            "articulo_columns": [str],            # orden visible
            "unidades_medida": [                  # N rows
                {
                    "id": int,
                    ... (resto de columnas),
                    "codigos": [                  # N codigos escaneables
                        {"id": int, "Codigo": str, "ean_kind": "EAN-13"|..., ...}
                    ]
                }
            ],
            "unidad_medida_columns": [str],
            "codigo_columns": [str],
            "ean_principal": str | None,          # EAN-13 mejor candidato
            "ean_principal_kind": str | None,
        }
    """
    out = {
        "sku": sku,
        "available": False,
        "articulo": None,
        "articulo_columns": [],
        "unidades_medida": [],
        "unidad_medida_columns": [],
        "codigo_columns": [],
        "ean_principal": None,
        "ean_principal_kind": None,
    }
    try:
        eng = get_engine("unistore")
    except Exception as e:
        log.warning("digip_articulo_info engine fail: %s", e)
        return out

    # 1) digip.Articulo (1 row)
    art_cols = _digip_table_columns(eng, "Articulo")
    if not art_cols:
        return out

    visible_art_cols = [c for c in art_cols if c not in _ARTICULO_HIDE_COLS]
    out["articulo_columns"] = visible_art_cols

    try:
        quoted = ", ".join(f'"{c}"' for c in art_cols)
        rows = q(eng, f'''
            SELECT {quoted}
            FROM digip."Articulo"
            WHERE "CodigoArticulo" = :sku
            LIMIT 1
        ''', {"sku": sku}) or []
        if rows:
            out["articulo"] = _row_to_dict(art_cols, rows[0])
            out["available"] = True
    except Exception as e:
        log.warning("digip_articulo_info articulo fail sku=%s err=%s", sku, e)

    # 2) digip.ArticuloUnidadMedida (N rows: unidad / caja / pallet ...)
    um_cols = _digip_table_columns(eng, "ArticuloUnidadMedida")
    cod_cols = _digip_table_columns(eng, "ArticuloUnidadMedidaCodigo")
    out["unidad_medida_columns"] = [c for c in um_cols if c not in _ARTICULO_HIDE_COLS]
    out["codigo_columns"] = [c for c in cod_cols if c not in _ARTICULO_HIDE_COLS]

    um_by_id: dict = {}
    if um_cols:
        try:
            quoted = ", ".join(f'"{c}"' for c in um_cols)
            # ordering preferente: principal/unidad antes que pallet/caja si existe el flag
            order_clause = "id ASC"
            if "esPrincipal" in um_cols:
                order_clause = '"esPrincipal" DESC NULLS LAST, id ASC'
            elif "factor" in um_cols:
                order_clause = "factor ASC NULLS FIRST, id ASC"
            rows = q(eng, f'''
                SELECT {quoted}
                FROM digip."ArticuloUnidadMedida"
                WHERE "articuloCodigo" = :sku
                ORDER BY {order_clause}
            ''', {"sku": sku}) or []
            for r in rows:
                d = _row_to_dict(um_cols, r)
                d["codigos"] = []
                if "id" in d and d["id"] is not None:
                    um_by_id[int(d["id"])] = d
                    out["unidades_medida"].append(d)
            if rows:
                out["available"] = True
        except Exception as e:
            log.warning("digip_articulo_info unidad_medida fail sku=%s err=%s", sku, e)

    # 3) digip.ArticuloUnidadMedidaCodigo (N rows por unidad: EAN / UPC / interno)
    if cod_cols and um_by_id:
        try:
            quoted = ", ".join(f'c."{c}"' for c in cod_cols)
            rows = q(eng, f'''
                SELECT {quoted}
                FROM digip."ArticuloUnidadMedidaCodigo" c
                JOIN digip."ArticuloUnidadMedida" u ON u.id = c."unidadMedidaId"
                WHERE u."articuloCodigo" = :sku
                ORDER BY c.id ASC
            ''', {"sku": sku}) or []
            for r in rows:
                d = _row_to_dict(cod_cols, r)
                cod_val = d.get("Codigo") or d.get("codigo")
                d["ean_kind"] = _ean_kind(cod_val)
                um_id = d.get("unidadMedidaId")
                if um_id is not None:
                    try:
                        um_id_int = int(um_id)
                    except (TypeError, ValueError):
                        um_id_int = None
                    if um_id_int is not None and um_id_int in um_by_id:
                        um_by_id[um_id_int]["codigos"].append(d)
        except Exception as e:
            log.warning("digip_articulo_info codigos fail sku=%s err=%s", sku, e)

    # 4) EAN principal: prioriza EAN-13 > UPC-A > EAN-8 > GTIN-14 > resto.
    #    Mismo criterio que sku_enrichment.enrich_skus_unistore para que sea
    #    consistente con el codigo de barras que muestra el header del SKU 360.
    priority_kind = {"EAN-13": 0, "UPC-A": 1, "EAN-8": 2, "GTIN-14": 3, "OTRO": 4}
    candidates: list[tuple[int, str, str]] = []
    for um in out["unidades_medida"]:
        for cod in um.get("codigos", []):
            v = cod.get("Codigo") or cod.get("codigo")
            if not v:
                continue
            kind = cod.get("ean_kind") or "OTRO"
            candidates.append((priority_kind.get(kind, 99), str(v), kind))
    if candidates:
        candidates.sort()
        out["ean_principal"] = candidates[0][1]
        out["ean_principal_kind"] = candidates[0][2]

    return out


# ============================================================
# LOTES HISTORY: passthrough enriquecido de cost_by_sku.history
# ============================================================

def lotes_history(sku: str) -> list[dict]:
    """Devuelve TODOS los lotes en los que aparece el SKU, ordenados por
    fecha de importacion descendente. Cada lote trae cantidad, costo unitario
    USD/ARS, precio sugerido, rentabilidad — datos suficientes para entender
    como evolucionaron los costos del SKU lote a lote."""
    from app.db import costs_db
    rec = costs_db.cost_by_sku(sku)
    if not rec or not rec.get("history"):
        return []
    out = []
    for item in rec["history"]:
        out.append({
            "lote": item.get("lote"),
            "proveedor": item.get("proveedor"),
            "fecha_ingreso": item.get("fecha_ingreso"),
            "imported_at": item.get("imported_at"),
            "cantidad": item.get("cantidad"),
            "costo_unit_usd": item.get("costo_unit_usd_max"),
            "costo_unit_ars": item.get("costo_unit_ars"),
            "costo_con_iva_unit_ars": item.get("costo_con_iva_unit_ars"),
            "precio_ars": item.get("precio_ars"),
            "rentabilidad_ars": item.get("rentabilidad_ars"),
            "pct_rentabilidad": item.get("pct_rentabilidad"),
            "categoria": item.get("categoria"),
            "sub_categoria": item.get("sub_categoria"),
            "ncm": item.get("ncm"),
            "peso_kg": item.get("peso_kg"),
            "cbm_un": item.get("cbm_un"),
        })
    return out
