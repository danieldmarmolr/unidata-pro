"""
Distribucion de envios MELI de los dropshippers Unidrop.

Mercado Libre clasifica los envios en:
- Mercado Envios (ME2) flex / drop_off / cross_docking / fulfillment
- Self service (envio por cuenta del seller)
- Pickup en sucursal MELI
- not_specified (sin info)

Como el schema de meli.meli_orders puede variar, se detectan dinamicamente
las columnas existentes con information_schema y se usan defensivamente.
"""
from __future__ import annotations

import logging

from app.utils.tz import now_ar
from app.db.engines import get_engine
from app.services._utils import q, resolve_window, col_or_null

log = logging.getLogger("unidata.envios_meli")


# Columnas candidatas para "modo de envio" en orden de preferencia.
# La primera que exista en el schema real se usa.
_SHIPPING_MODE_CANDIDATES = [
    "shipping_logistic_type",
    "logistic_type",
    "shipping_mode",
    "shipping_type",
    "mode",
]


def envios_meli_unidrop(
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """Distribucion de ordenes MELI de Unidrop por modo de envio."""
    eng = get_engine("unidrop")
    days = resolve_window(period, from_iso, to_iso)["days"]

    # Detectar la columna real
    mode_col_expr = col_or_null(eng, "meli", "meli_orders", "mo", _SHIPPING_MODE_CANDIDATES)
    has_mode = mode_col_expr != "NULL::text"

    if not has_mode:
        # No hay columna de shipping mode disponible. Devolver respuesta vacia
        # con mensaje explicito para que el frontend muestre "datos no disponibles".
        return {
            "period": period,
            "days": days,
            "available": False,
            "message": (
                "El schema actual de meli.meli_orders no tiene columna de "
                "shipping mode. Necesitas agregar shipping_logistic_type o "
                "shipping_mode al sync para poder segmentar."
            ),
            "totals": {"ordenes": 0, "gmv": 0, "modos": 0},
            "modos": [],
            "generated_at": now_ar().isoformat(),
        }

    # Clasificar el modo de envio en buckets human-readable
    canal_sql = f"""
        CASE
          WHEN {mode_col_expr} ILIKE '%fulfillment%' THEN 'Mercado Envios FULL'
          WHEN {mode_col_expr} ILIKE '%cross_docking%' THEN 'Cross Docking'
          WHEN {mode_col_expr} ILIKE '%xd_drop_off%' OR {mode_col_expr} ILIKE '%drop_off%' THEN 'Drop Off (sucursal)'
          WHEN {mode_col_expr} ILIKE '%flex%' OR {mode_col_expr} ILIKE '%self_service%' THEN 'Flex / Self Service'
          WHEN {mode_col_expr} ILIKE '%me2%' THEN 'Mercado Envios ME2'
          WHEN {mode_col_expr} ILIKE '%me1%' THEN 'Mercado Envios ME1'
          WHEN {mode_col_expr} ILIKE '%pickup%' OR {mode_col_expr} ILIKE '%mexico%' THEN 'Pickup'
          WHEN {mode_col_expr} ILIKE '%custom%' THEN 'Personalizado'
          WHEN {mode_col_expr} IS NULL OR TRIM({mode_col_expr}::text) = '' THEN 'Sin especificar'
          ELSE 'Otro'
        END
    """

    rows = q(eng, f"""
        SELECT {canal_sql} AS modo,
               COUNT(*)::int AS ordenes,
               COALESCE(SUM(mo.total_amount),0)::float AS gmv,
               COUNT(*) FILTER (WHERE mo.status = 'paid')::int AS pagadas,
               COUNT(*) FILTER (WHERE mo.status = 'delivered')::int AS entregadas,
               COUNT(*) FILTER (WHERE mo.status = 'shipped')::int AS enviadas,
               COUNT(*) FILTER (WHERE mo.status = 'cancelled')::int AS canceladas
        FROM meli.meli_orders mo
        WHERE mo.date_created >= NOW() - make_interval(days => :d)
        GROUP BY 1
        ORDER BY ordenes DESC
    """, {"d": days}) or []

    total_orders = sum(int(r[1] or 0) for r in rows) or 1
    total_gmv = sum(float(r[2] or 0) for r in rows)

    modos = []
    for r in rows:
        modo, ordenes, gmv, pagadas, entregadas, enviadas, canceladas = r
        modos.append({
            "modo": modo or "Sin especificar",
            "ordenes": int(ordenes or 0),
            "gmv": round(float(gmv or 0), 2),
            "pagadas": int(pagadas or 0),
            "entregadas": int(entregadas or 0),
            "enviadas": int(enviadas or 0),
            "canceladas": int(canceladas or 0),
            "pct_ordenes": round(int(ordenes or 0) / total_orders * 100, 1),
            "fulfillment_rate": round(int(entregadas or 0) / int(ordenes or 1) * 100, 1) if ordenes else 0,
        })

    return {
        "period": period,
        "days": days,
        "available": True,
        "totals": {
            "ordenes": total_orders,
            "gmv": round(total_gmv, 2),
            "modos": len(modos),
        },
        "modos": modos,
        "generated_at": now_ar().isoformat(),
    }
