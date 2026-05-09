"""
Segmentacion de envios Unistore por canal: OCA, Correo Argentino, Unifast,
Retiro presencial, Moto/cadeteria, Andreani, Personalizado, Otro.

Cruza tienda_nube.Order + Fulfillment para detectar el metodo declarado por
el cliente y/o el carrier real ya despachado.
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q, resolve_window
from app.services.drilldowns import _shipping_method_expr, _classify_channel_sql

log = logging.getLogger("unidata.envios_unistore")


def envios_unistore_overview(
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Distribucion de ordenes por canal de envio en Unistore."""
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]
    method_expr = _shipping_method_expr(eng)
    canal_sql = _classify_channel_sql("m.metodo_envio")

    rows = q(eng, f"""
        WITH base AS (
          SELECT o.id,
                 o."paymentStatus" AS payment,
                 o."shippingStatus" AS shipping,
                 o.total::float AS total,
                 {method_expr}
          FROM tienda_nube."Order" o
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE o."createdAt" >= NOW() - make_interval(days => :d)
        )
        SELECT {canal_sql} AS canal,
               COUNT(*)::int AS ordenes,
               SUM(total)::float AS gmv,
               SUM(CASE WHEN payment = 'paid' THEN 1 ELSE 0 END)::int AS pagadas,
               SUM(CASE WHEN shipping = 'delivered' THEN 1 ELSE 0 END)::int AS entregadas
        FROM base m
        GROUP BY 1
        ORDER BY ordenes DESC
    """, {"d": days}) or []

    total_orders = sum(int(r[1] or 0) for r in rows) or 1
    total_gmv = sum(float(r[2] or 0) for r in rows)

    canales = []
    for r in rows:
        canal, ordenes, gmv, pagadas, entregadas = r
        canales.append({
            "canal": canal or "(sin metodo)",
            "ordenes": int(ordenes or 0),
            "gmv": round(float(gmv or 0), 2),
            "pagadas": int(pagadas or 0),
            "entregadas": int(entregadas or 0),
            "pct_ordenes": round(int(ordenes or 0) / total_orders * 100, 1),
            "fulfillment_rate": round(int(entregadas or 0) / int(ordenes or 1) * 100, 1) if ordenes else 0,
        })

    return {
        "period": period,
        "days": days,
        "totals": {
            "ordenes": total_orders,
            "gmv": round(total_gmv, 2),
            "canales": len(canales),
        },
        "canales": canales,
        "generated_at": now_ar().isoformat(),
    }
