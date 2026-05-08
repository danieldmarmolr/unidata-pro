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


def geo_overview(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Agregado por provincia: revenue, orders, customers, top_sku."""
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    # --- TN: orders TN paid + provincia desde Customer.billingProvince OR OrderShippingAddress.province ---
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(c."billingProvince"),''), NULLIF(TRIM(osa.province),''), '(sin provincia)') AS prov,
               COUNT(DISTINCT o.id)::int AS orders,
               SUM(o.total)::float AS revenue,
               COUNT(DISTINCT o."customerId")::int AS customers
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
        GROUP BY 1
        ORDER BY 3 DESC NULLS LAST
    """, p) or []

    by_prov: dict[str, dict] = {}
    sin_prov = {"province": "(sin provincia)", "orders": 0, "revenue": 0.0, "customers": 0}
    for r in rows:
        cp = canonical_province(r[0])
        if not cp:
            sin_prov["orders"] += int(r[1] or 0)
            sin_prov["revenue"] += float(r[2] or 0)
            sin_prov["customers"] += int(r[3] or 0)
            continue
        if cp not in by_prov:
            by_prov[cp] = {"province": cp, "orders": 0, "revenue": 0.0, "customers": 0}
        by_prov[cp]["orders"] += int(r[1] or 0)
        by_prov[cp]["revenue"] += float(r[2] or 0)
        by_prov[cp]["customers"] += int(r[3] or 0)

    # Round revenue
    for p_data in by_prov.values():
        p_data["revenue"] = round(p_data["revenue"], 0)

    items = list(by_prov.values())
    items.sort(key=lambda x: x["revenue"], reverse=True)

    # KPIs cabecera
    total_orders = sum(p["orders"] for p in items)
    total_revenue = sum(p["revenue"] for p in items)
    total_customers = sum(p["customers"] for p in items)

    return {
        "level": "argentina",
        "period": period,
        "window": {"days": days},
        "totals": {
            "orders": total_orders,
            "revenue": round(total_revenue, 0),
            "customers": total_customers,
            "provinces_with_data": len(items),
        },
        "by_province": items,
        "sin_provincia": sin_prov,
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
