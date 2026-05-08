"""
Logistica Unidrop: envios OCA + LightData + estados de orders TN/ML.
Espejo del dashboard logistica de Unistore.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def logistica_unidrop(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    cards: list[dict] = []

    # Pedidos pendientes (TN orders paid + open)
    pendientes = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE status::text='open' AND payment_status::text='paid'
    """) or 0)

    # Despachados periodo
    desp = int(scalar(eng, """
        SELECT (
            (SELECT COUNT(*) FROM public.oca_shipments
              WHERE created_at >= NOW() - make_interval(days => :days)) +
            (SELECT COUNT(*) FROM public.lightdata_shipments
              WHERE creado_en >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)
    desp_prev = int(scalar(eng, """
        SELECT (
            (SELECT COUNT(*) FROM public.oca_shipments
              WHERE created_at >= NOW() - make_interval(days => :days2)
                AND created_at <  NOW() - make_interval(days => :days)) +
            (SELECT COUNT(*) FROM public.lightdata_shipments
              WHERE creado_en >= NOW() - make_interval(days => :days2)
                AND creado_en <  NOW() - make_interval(days => :days))
        )
    """, p2) or 0)
    delta_desp = ((desp - desp_prev) / desp_prev * 100) if desp_prev > 0 else None

    # Lead time avg OCA
    lead_oca = scalar(eng, """
        SELECT AVG(EXTRACT(EPOCH FROM (fecha_entrega - created_at))/86400.0)::float
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND fecha_entrega IS NOT NULL
    """, p)

    # Pedidos atascados (paid sin etiqueta descargada hace > 5d)
    stuck = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE payment_status::text='paid'
          AND label_downloaded IS NOT TRUE
          AND created_at < NOW() - INTERVAL '5 days'
          AND status::text != 'cancelled'
    """) or 0)

    # ML missing SKU
    missing_sku = int(scalar(eng, """
        SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre"
        WHERE missing_sku IS NOT NULL
          AND array_length(missing_sku, 1) > 0
    """) or 0)

    # Costo total envios periodo
    cost_total = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(costo_envio),0)::float FROM public.oca_shipments
              WHERE created_at >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM(costo_envio_ars),0)::float FROM public.lightdata_shipments
              WHERE creado_en >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)

    cards.append({"label": "Pedidos pendientes", "value": pendientes, "hint": "Open + paid sin despacho"})
    cards.append({"label": f"Despachos ({period})", "value": desp,
                  "delta": round(delta_desp, 1) if delta_desp is not None else None,
                  "hint": "OCA + LightData"})
    cards.append({"label": "Lead time avg OCA", "value": round(float(lead_oca), 1) if lead_oca else 0,
                  "suffix": " dias", "hint": "Solo entregados con fecha"})
    cards.append({"label": "Pedidos atascados", "value": stuck,
                  "hint": "Pagados sin etiqueta descargada >5d"})
    cards.append({"label": "ML con missing SKU", "value": missing_sku,
                  "hint": "Ordenes ML donde falta el SKU mapeado"})
    cards.append({"label": f"Costo envios ({period})", "value": round(cost_total, 0),
                  "prefix": "$ ", "hint": "Suma OCA + LightData"})

    # Funnel: TN order paid -> con etiqueta -> despacho OCA o LD -> entregado
    f1 = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND payment_status::text = 'paid'
    """, p) or 0)
    f2 = int(scalar(eng, """
        SELECT COUNT(*) FROM public.tienda_nube_orders
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND payment_status::text='paid'
          AND label_downloaded = TRUE
    """, p) or 0)
    f3 = int(scalar(eng, """
        SELECT (
            (SELECT COUNT(DISTINCT order_tienda_nube_id) FROM public.oca_shipments
              WHERE created_at >= NOW() - make_interval(days => :days)) +
            (SELECT COUNT(DISTINCT orden_tn_id) FROM public.lightdata_shipments
              WHERE creado_en >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)
    f4_oca = int(scalar(eng, """
        SELECT COUNT(*) FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
          AND (status::text ILIKE '%entregado%' OR ultimo_estado_oca ILIKE '%entregado%')
    """, p) or 0)
    f4_ld = int(scalar(eng, """
        SELECT COUNT(*) FROM public.lightdata_shipments
        WHERE creado_en >= NOW() - make_interval(days => :days)
          AND estado ILIKE '%entregado%'
    """, p) or 0)

    funnel = [
        {"category": "1. Order paga", "value": float(f1)},
        {"category": "2. Etiqueta lista", "value": float(f2)},
        {"category": "3. Despachada", "value": float(f3)},
        {"category": "4. Entregada", "value": float(f4_oca + f4_ld)},
    ]

    # Daily despachos 60d
    rows = q(eng, """
        SELECT day::date, COALESCE(SUM(n),0)::float FROM (
            SELECT date_trunc('day', created_at) AS day, 1 AS n
            FROM public.oca_shipments
            WHERE created_at >= NOW() - INTERVAL '60 days'
            UNION ALL
            SELECT date_trunc('day', creado_en) AS day, 1
            FROM public.lightdata_shipments
            WHERE creado_en >= NOW() - INTERVAL '60 days'
        ) x GROUP BY 1 ORDER BY 1
    """) or []
    daily = [{"date": r[0].strftime("%Y-%m-%d") if r[0] else "", "value": float(r[1] or 0)} for r in rows]

    # Provincias con mas envios OCA
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(destinatario_provincia),''),'(sin)'),
               COUNT(*)::int, COALESCE(SUM(costo_envio),0)::float
        FROM public.oca_shipments
        WHERE created_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """, p) or []
    top_provinces = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"costo": float(r[2] or 0)},
    } for r in rows]

    # Stuck orders detalle
    rows = q(eng, """
        SELECT tienda_nube_id, order_number, total::float,
               payment_status::text, status::text, created_at::text,
               EXTRACT(DAY FROM (NOW() - created_at))::int AS dias
        FROM public.tienda_nube_orders
        WHERE payment_status::text='paid'
          AND label_downloaded IS NOT TRUE
          AND created_at < NOW() - INTERVAL '5 days'
          AND status::text != 'cancelled'
        ORDER BY created_at ASC LIMIT 20
    """) or []
    stuck_orders = [{
        "category": str(r[1] or r[0]),
        "value": float(r[2] or 0),
        "extra": {
            "id": int(r[0]),
            "payment": r[3] or "", "status": r[4] or "",
            "fecha": r[5][:10] if r[5] else None,
            "dias_atrasado": int(r[6] or 0),
        },
    } for r in rows]

    return {
        "unit": "unidrop",
        "period": period,
        "cards": cards,
        "funnel": funnel,
        "daily_dispatch": daily,
        "top_provinces": top_provinces,
        "stuck_orders": stuck_orders,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
