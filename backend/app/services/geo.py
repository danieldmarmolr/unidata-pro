"""
Geo distribution service.
Cruza orders TN paid + ML por provincia/ciudad de Argentina.
- by_province: agregado por provincia normalizada (24 jurisdicciones)
- province_detail: top SKUs, top customers, top ciudades dentro de una provincia
"""
from __future__ import annotations

import datetime as dt
import logging
import unicodedata

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window

log = logging.getLogger("unidata.geo")


# Las 24 jurisdicciones canonicas
PROVINCES_CANON = {
    "buenos aires": "Buenos Aires",
    "ciudad autonoma de buenos aires": "Ciudad de Buenos Aires",
    "ciudad de buenos aires": "Ciudad de Buenos Aires",
    "capital federal": "Ciudad de Buenos Aires",
    "caba": "Ciudad de Buenos Aires",
    "ba": "Buenos Aires",
    "catamarca": "Catamarca",
    "chaco": "Chaco",
    "chubut": "Chubut",
    "cordoba": "Córdoba",
    "córdoba": "Córdoba",
    "corrientes": "Corrientes",
    "entre rios": "Entre Ríos",
    "entre ríos": "Entre Ríos",
    "formosa": "Formosa",
    "jujuy": "Jujuy",
    "la pampa": "La Pampa",
    "la rioja": "La Rioja",
    "mendoza": "Mendoza",
    "misiones": "Misiones",
    "neuquen": "Neuquén",
    "neuquén": "Neuquén",
    "rio negro": "Río Negro",
    "río negro": "Río Negro",
    "salta": "Salta",
    "san juan": "San Juan",
    "san luis": "San Luis",
    "santa cruz": "Santa Cruz",
    "santa fe": "Santa Fe",
    "santiago del estero": "Santiago del Estero",
    "tierra del fuego": "Tierra del Fuego",
    "tucuman": "Tucumán",
    "tucumán": "Tucumán",
}


def _norm(s: str | None) -> str:
    if not s:
        return ""
    s = s.strip().lower()
    # quitar acentos
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s


def canonical_province(s: str | None) -> str | None:
    if not s:
        return None
    n = _norm(s)
    return PROVINCES_CANON.get(n) or PROVINCES_CANON.get(n.replace("provincia de ", "").replace("provincia ", ""))


def geo_overview(
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
    unit: str = "unistore",
) -> dict:
    """Agregado por provincia para una unidad de negocio.

    unit:
      - unistore -> ventas TN del retail Unistore (tienda_nube.Order + Customer + OrderShippingAddress)
      - unidrop  -> ventas TN de dropshippers (public.tienda_nube_orders en unidrop_api)
                    + ventas MELI (mercado_libre_dev.OrderMercadoLibre) si tienen
                    address. Para MELI no siempre hay provincia, esos quedan en
                    sin_provincia.
      - unidev   -> casos de devolucion abiertos por provincia (public.devoluciones
                    + datos del cliente). Usa engine 'unidev'.
    """
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    from_ts = win["from_ts"]
    to_ts = win["to_ts"]

    if unit == "unidrop":
        return _geo_overview_unidrop(period, days, from_ts, to_ts)
    if unit == "unidev":
        return _geo_overview_unidev(period, days, from_ts, to_ts)
    return _geo_overview_unistore(period, days, from_ts, to_ts)


def _aggregate_by_province(rows: list, fields: tuple) -> tuple[list[dict], dict]:
    """Helper comun: rows -> by_prov dict, sin_prov dict.
    fields: ('orders', 'revenue', 'customers') o similares.
    """
    by_prov: dict[str, dict] = {}
    sin_prov = {"province": "(sin provincia)", **{f: 0 for f in fields}}
    for r in rows:
        cp = canonical_province(r[0])
        target = sin_prov if not cp else by_prov.setdefault(
            cp, {"province": cp, **{f: 0 for f in fields}},
        )
        for i, f in enumerate(fields, start=1):
            if f == "revenue":
                target[f] = float(target.get(f, 0)) + float(r[i] or 0)
            else:
                target[f] = int(target.get(f, 0)) + int(r[i] or 0)
    if "revenue" in fields:
        for p in by_prov.values():
            p["revenue"] = round(p["revenue"], 0)
        sin_prov["revenue"] = round(sin_prov["revenue"], 0)
    items = list(by_prov.values())
    items.sort(key=lambda x: x.get("revenue", x.get("orders", 0)), reverse=True)
    return items, sin_prov


def _geo_overview_unistore(period: str, days: int, from_ts, to_ts) -> dict:
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(c."billingProvince"),''), NULLIF(TRIM(osa.province),''), '(sin provincia)') AS prov,
               COUNT(DISTINCT o.id)::int AS orders,
               SUM(o.total)::float AS revenue,
               COUNT(DISTINCT o."customerId")::int AS customers
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
          AND o."paymentStatus" = 'paid'
        GROUP BY 1 ORDER BY 3 DESC NULLS LAST
    """, {"from_ts": from_ts, "to_ts": to_ts}) or []
    items, sin_prov = _aggregate_by_province(rows, ("orders", "revenue", "customers"))
    totals = {
        "orders": sum(p["orders"] for p in items),
        "revenue": round(sum(p["revenue"] for p in items), 0),
        "customers": sum(p["customers"] for p in items),
        "provinces_with_data": len(items),
    }
    return {
        "level": "argentina", "unit": "unistore", "period": period,
        "window": {"days": days},
        "totals": totals, "by_province": items, "sin_provincia": sin_prov,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def _geo_overview_unidrop(period: str, days: int, from_ts, to_ts) -> dict:
    """Ventas dropshippers por provincia del COMPRADOR FINAL.
    Solo TN (tienda_nube_orders.billing_province) - MELI no tiene provincia en
    la tabla actual. Si se agrega despues se suma aca.
    """
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(billing_province),''), '(sin provincia)') AS prov,
               COUNT(*)::int AS orders,
               SUM(total)::float AS revenue,
               COUNT(DISTINCT contact_identification)::int AS customers
        FROM public.tienda_nube_orders
        WHERE payment_status::text = 'paid'
          AND created_at >= :from_ts AND created_at < :to_ts
        GROUP BY 1 ORDER BY 3 DESC NULLS LAST
    """, {"from_ts": from_ts, "to_ts": to_ts}) or []
    items, sin_prov = _aggregate_by_province(rows, ("orders", "revenue", "customers"))
    totals = {
        "orders": sum(p["orders"] for p in items),
        "revenue": round(sum(p["revenue"] for p in items), 0),
        "customers": sum(p["customers"] for p in items),
        "provinces_with_data": len(items),
    }
    return {
        "level": "argentina", "unit": "unidrop", "period": period,
        "window": {"days": days},
        "totals": totals, "by_province": items, "sin_provincia": sin_prov,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def _geo_overview_unidev(period: str, days: int, from_ts, to_ts) -> dict:
    """Devoluciones Unidev por provincia. Engine unidev, tabla public.devoluciones.
    Si el engine o tabla no existe, devuelve estructura vacia.
    """
    try:
        eng = get_engine("unidev")
    except Exception:
        return {
            "level": "argentina", "unit": "unidev", "period": period,
            "window": {"days": days},
            "totals": {"orders": 0, "revenue": 0, "customers": 0, "provinces_with_data": 0},
            "by_province": [], "sin_provincia": {"province": "(sin provincia)", "orders": 0, "revenue": 0.0, "customers": 0},
            "error": "Unidev engine no disponible",
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
    # public.devoluciones tiene fecha_creacion, monto_total_devolver, provincia (si esta)
    try:
        rows = q(eng, """
            SELECT COALESCE(NULLIF(TRIM(provincia),''), '(sin provincia)') AS prov,
                   COUNT(*)::int AS orders,
                   COALESCE(SUM(monto_total_devolver),0)::float AS revenue,
                   COUNT(DISTINCT cliente_id)::int AS customers
            FROM public.devoluciones
            WHERE fecha_creacion >= :from_ts AND fecha_creacion < :to_ts
            GROUP BY 1 ORDER BY 3 DESC NULLS LAST
        """, {"from_ts": from_ts, "to_ts": to_ts}) or []
    except Exception as e:
        log.warning("geo unidev fail: %s", e)
        rows = []
    items, sin_prov = _aggregate_by_province(rows, ("orders", "revenue", "customers"))
    totals = {
        "orders": sum(p["orders"] for p in items),
        "revenue": round(sum(p["revenue"] for p in items), 0),
        "customers": sum(p["customers"] for p in items),
        "provinces_with_data": len(items),
    }
    return {
        "level": "argentina", "unit": "unidev", "period": period,
        "window": {"days": days},
        "totals": totals, "by_province": items, "sin_provincia": sin_prov,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def province_detail(
    province: str,
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Drill: top SKUs, top customers y top ciudades dentro de una provincia."""
    cp = canonical_province(province) or province
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    # ILIKE matches con y sin acento (postgres unaccent no esta garantizado; usamos LOWER + variantes)
    p = {"days": days, "p1": cp, "p2": _norm(cp)}

    # Top SKUs
    skus = q(eng, """
        SELECT oi.sku, MAX(oi.name) AS name,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               COUNT(DISTINCT oi."orderId")::int AS orders
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND oi.sku IS NOT NULL
          AND oi.sku NOT ILIKE '%PVA%'
          AND (
            LOWER(TRIM(c."billingProvince")) = LOWER(:p1)
            OR LOWER(TRIM(osa.province)) = LOWER(:p1)
            OR LOWER(TRIM(c."billingProvince")) = :p2
            OR LOWER(TRIM(osa.province)) = :p2
          )
        GROUP BY oi.sku
        ORDER BY revenue DESC LIMIT 15
    """, p) or []
    top_skus = [{
        "category": (r[1] or r[0])[:60],
        "value": float(r[3] or 0),
        "extra": {"sku": r[0], "units": int(r[2] or 0), "orders": int(r[4] or 0)},
    } for r in skus]

    # Top customers
    custs = q(eng, """
        SELECT c.id, COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
               COUNT(DISTINCT o.id)::int AS orders,
               SUM(o.total)::float AS revenue,
               COALESCE(NULLIF(TRIM(c."billingCity"),''),'-') AS ciudad
        FROM tienda_nube."Order" o
        JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND (
            LOWER(TRIM(c."billingProvince")) = LOWER(:p1)
            OR LOWER(TRIM(osa.province)) = LOWER(:p1)
            OR LOWER(TRIM(c."billingProvince")) = :p2
            OR LOWER(TRIM(osa.province)) = :p2
          )
        GROUP BY c.id, c.name, c.email, c."billingCity"
        ORDER BY revenue DESC LIMIT 15
    """, p) or []
    top_customers = [{
        "category": r[1],
        "value": float(r[3] or 0),
        "extra": {"customer_id": int(r[0] or 0), "orders": int(r[2] or 0), "ciudad": r[4]},
    } for r in custs]

    # Top ciudades
    cities = q(eng, """
        SELECT COALESCE(
                 NULLIF(TRIM(osa.city),''),
                 NULLIF(TRIM(c."billingCity"),''),
                 '(sin ciudad)') AS ciudad,
               COUNT(DISTINCT o.id)::int AS orders,
               SUM(o.total)::float AS revenue,
               COUNT(DISTINCT o."customerId")::int AS customers
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND (
            LOWER(TRIM(c."billingProvince")) = LOWER(:p1)
            OR LOWER(TRIM(osa.province)) = LOWER(:p1)
            OR LOWER(TRIM(c."billingProvince")) = :p2
            OR LOWER(TRIM(osa.province)) = :p2
          )
        GROUP BY 1
        ORDER BY revenue DESC LIMIT 25
    """, p) or []
    top_cities = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"orders": int(r[1] or 0), "customers": int(r[3] or 0)},
    } for r in cities]

    # Stats agregadas provincia
    stats = q(eng, """
        SELECT COUNT(DISTINCT o.id)::int, SUM(o.total)::float, COUNT(DISTINCT o."customerId")::int
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
          AND (
            LOWER(TRIM(c."billingProvince")) = LOWER(:p1)
            OR LOWER(TRIM(osa.province)) = LOWER(:p1)
            OR LOWER(TRIM(c."billingProvince")) = :p2
            OR LOWER(TRIM(osa.province)) = :p2
          )
    """, p) or [(0, 0, 0)]
    s = stats[0]

    return {
        "province": cp,
        "period": period,
        "totals": {
            "orders": int(s[0] or 0),
            "revenue": round(float(s[1] or 0), 0),
            "customers": int(s[2] or 0),
        },
        "top_skus": top_skus,
        "top_customers": top_customers,
        "top_cities": top_cities,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
