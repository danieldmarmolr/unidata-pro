"""
Dashboard Envios - Unidrop.
Comparativa OCA vs LightData: volumen, tasa de exito, costos, tiempos.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def envios_unidrop(period: str = "30d", courier: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """courier: all | oca | lightdata"""
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}

    use_oca = courier in ("all", "oca")
    use_ld = courier in ("all", "lightdata")

    cards: list[dict] = []

    n_oca = int(scalar(eng, """
        SELECT COUNT(*) FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_oca else 0
    n_ld = int(scalar(eng, """
        SELECT COUNT(*) FROM public.lightdata_shipments
        WHERE creado_en >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_ld else 0
    n_total = n_oca + n_ld

    # entregados (OCA: status entregado / LD: estado entregado)
    delivered_oca = int(scalar(eng, """
        SELECT COUNT(*) FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND (status::text ILIKE '%entregado%' OR ultimo_estado_oca ILIKE '%entregado%')
    """, p) or 0) if use_oca else 0
    delivered_ld = int(scalar(eng, """
        SELECT COUNT(*) FROM public.lightdata_shipments
        WHERE creado_en >= NOW() - make_interval(days => :days)
          AND estado ILIKE '%entregado%'
    """, p) or 0) if use_ld else 0
    delivered = delivered_oca + delivered_ld
    delivery_rate = (delivered / n_total * 100) if n_total > 0 else 0

    # costo total
    cost_oca = float(scalar(eng, """
        SELECT COALESCE(SUM(costo_envio), 0)::float
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_oca else 0.0
    cost_ld = float(scalar(eng, """
        SELECT COALESCE(SUM(costo_envio_ars), 0)::float
        FROM public.lightdata_shipments
        WHERE creado_en >= NOW() - make_interval(days => :days)
    """, p) or 0) if use_ld else 0.0
    cost_total = cost_oca + cost_ld
    avg_cost = (cost_total / n_total) if n_total > 0 else 0

    # tiempo promedio entrega OCA (created_at -> fecha_entrega)
    avg_delivery_oca = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (fecha_entrega - created_at))/86400.0)::float
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND fecha_entrega IS NOT NULL
    """, p)

    cards.append({"label": f"Envios totales ({period})", "value": n_total,
                  "hint": f"OCA {n_oca:,} / LightData {n_ld:,}"})
    cards.append({"label": "Tasa de entrega", "value": round(delivery_rate, 1),
                  "suffix": "%", "hint": f"{delivered:,} de {n_total:,}"})
    cards.append({"label": "Costo total envios", "value": round(cost_total, 0),
                  "prefix": "$ ", "hint": f"Avg $ {avg_cost:,.0f}"})
    cards.append({"label": "Tiempo entrega OCA avg",
                  "value": round(float(avg_delivery_oca), 1) if avg_delivery_oca else 0,
                  "suffix": " dias", "hint": "Solo entregados con fecha"})

    # diario por courier
    daily_oca = []
    if use_oca:
        rows = q(eng, """
            SELECT date_trunc('day', created_at)::date, COUNT(*)::int
            FROM public.oca_shipments
            WHERE created_at >= NOW() - make_interval(days => :days)
            GROUP BY 1 ORDER BY 1
        """, p) or []
        daily_oca = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                      "value": float(r[1] or 0)} for r in rows]

    daily_ld = []
    if use_ld:
        rows = q(eng, """
            SELECT date_trunc('day', creado_en)::date, COUNT(*)::int
            FROM public.lightdata_shipments
            WHERE creado_en >= NOW() - make_interval(days => :days)
            GROUP BY 1 ORDER BY 1
        """, p) or []
        daily_ld = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "",
                     "value": float(r[1] or 0)} for r in rows]

    # comparacion couriers
    courier_compare = [
        {"category": "OCA", "value": float(n_oca), "extra": {"costo": cost_oca, "entregados": delivered_oca}},
        {"category": "LightData", "value": float(n_ld), "extra": {"costo": cost_ld, "entregados": delivered_ld}},
    ]

    # estados
    rows_oca = q(eng, """
        SELECT COALESCE(status::text, ultimo_estado_oca, 'sin estado'), COUNT(*)::int
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or [] if use_oca else []
    estados_oca = [{"category": r[0] or "?", "value": float(r[1] or 0)} for r in rows_oca]

    rows_ld = q(eng, """
        SELECT COALESCE(estado, 'sin estado'), COUNT(*)::int
        FROM public.lightdata_shipments
        WHERE creado_en >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or [] if use_ld else []
    estados_ld = [{"category": r[0] or "?", "value": float(r[1] or 0)} for r in rows_ld]

    # provincias OCA
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(destinatario_provincia),''),'(sin provincia)'),
               COUNT(*)::int, COALESCE(SUM(costo_envio),0)::float
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """, p) or [] if use_oca else []
    top_provincias = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"costo": float(r[2] or 0)},
    } for r in rows]

    return {
        "period": period,
        "courier": courier,
        "cards": cards,
        "daily_oca": daily_oca,
        "daily_ld": daily_ld,
        "courier_compare": courier_compare,
        "estados_oca": estados_oca,
        "estados_ld": estados_ld,
        "top_provincias": top_provincias,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
